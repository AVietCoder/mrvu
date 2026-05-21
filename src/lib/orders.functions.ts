// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import {
  countRows,
  deleteWhere,
  fetchAllRows,
  fetchRows,
  insertRow,
  now,
  supabase,
  uid,
  updateWhere,
} from "./supabase";

type LineItem = { product_id: string; qty: number; unit_price: number; discount?: number };
type ProductBrief = { id: string; name: string; sku?: string };
type StockBrief = { product_id: string; qty: number };

function groupItems(items: LineItem[]) {
  const map = new Map<string, number>();
  for (const item of items ?? []) {
    map.set(item.product_id, (map.get(item.product_id) ?? 0) + Number(item.qty || 0));
  }
  return map;
}

async function loadProductNames(productIds: string[]): Promise<Map<string, ProductBrief>> {
  if (!productIds.length) return new Map();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku")
    .in("id", productIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p: any) => [p.id, p]));
}

async function loadStock(branchId: string, productIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const { data, error } = await supabase
    .from("stock")
    .select("product_id, qty")
    .eq("branch_id", branchId)
    .in("product_id", productIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.product_id, Number(row.qty || 0));
  }
  return map;
}

async function ensureStockAvailable(branchId: string, items: LineItem[]) {
  const required = groupItems(items);
  if (!required.size) return;

  const [stock, products] = await Promise.all([
    loadStock(branchId, [...required.keys()]),
    loadProductNames([...required.keys()]),
  ]);

  const shortages: string[] = [];
  for (const [productId, qtyNeeded] of required.entries()) {
    const current = stock.get(productId) ?? 0;
    if (current < qtyNeeded) {
      const meta = products.get(productId);
      shortages.push(`${meta?.name ?? productId} (${meta?.sku ?? "no-sku"}): còn ${current}, cần ${qtyNeeded}`);
    }
  }

  if (shortages.length) {
    throw new Error(`Không đủ tồn kho để hoàn tất đơn: ${shortages.join(" | ")}`);
  }
}

async function adjustStock(productId: string, branchId: string, delta: number) {
  const rows = await fetchRows<StockBrief>("stock", {
    eq: { product_id: productId, branch_id: branchId },
    select: "qty",
    limit: 1,
  });
  const current = rows[0]?.qty ?? 0;
  const next = Math.max(0, current + delta);

  if (rows.length) {
    await updateWhere("stock", { qty: next }, { product_id: productId, branch_id: branchId });
  } else {
    await insertRow("stock", { product_id: productId, branch_id: branchId, qty: next });
  }
}

async function applyStockDeltaMap(branchId: string, deltas: Map<string, number>) {
  const entries = [...deltas.entries()];
  for (const [productId, delta] of entries) {
    if (delta === 0) continue;
    await adjustStock(productId, branchId, delta);
  }
}

async function applyCompletedOrderSideEffects(order: any, lineItems: LineItem[]) {
  if (!order) return;
  const required = groupItems(lineItems);
  if (!required.size) return;
  await ensureStockAvailable(order.branch_id, lineItems);
  const deltas = new Map([...required.entries()].map(([productId, qty]) => [productId, -qty]));
  await applyStockDeltaMap(order.branch_id, deltas);

  if (order.customer_id) {
    const customerRows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: order.customer_id },
      select: "debt",
      limit: 1,
    });
    const currentDebt = customerRows[0]?.debt ?? 0;
    const owed = Math.max(0, Number(order.total || 0) - Number(order.deposit || 0) - Number(order.paid || 0));
    if (owed > 0) {
      await updateWhere("customers", { debt: currentDebt + owed }, { id: order.customer_id });
    }
  }
}

async function revertCompletedOrderSideEffects(order: any, lineItems: LineItem[]) {
  if (!order) return;

  const required = groupItems(lineItems);
  if (required.size) {
    const deltas = new Map([...required.entries()].map(([productId, qty]) => [productId, qty]));
    await applyStockDeltaMap(order.branch_id, deltas);
  }

  if (order.customer_id) {
    const customerRows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: order.customer_id },
      select: "debt",
      limit: 1,
    });
    const currentDebt = customerRows[0]?.debt ?? 0;
    const owed = Math.max(0, Number(order.total || 0) - Number(order.deposit || 0) - Number(order.paid || 0));
    if (owed > 0) {
      await updateWhere("customers", { debt: Math.max(0, currentDebt - owed) }, { id: order.customer_id });
    }
  }
}

async function nextOrderCode() {
  const count = await countRows("orders");
  return "HD" + String(count + 1).padStart(6, "0");
}

async function nextCashCode(type: "thu" | "chi") {
  const prefix = type === "thu" ? "PT" : "PC";
  const { count } = await supabase
    .from("cash_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("type", type);
  return prefix + String((count ?? 0) + 1).padStart(6, "0");
}

async function autoCreateReceiptForOrder({
  orderCode,
  customerId,
  branchId,
  employeeId,
  amount,
  fundType,
  paymentMethodLabel,
  createdAt,
}: {
  orderCode: string;
  customerId: string | null;
  branchId: string;
  employeeId: string | null;
  amount: number;
  fundType: "tien_mat" | "ngan_hang";
  paymentMethodLabel: string;
  createdAt: string;
}) {
  if (!amount || amount <= 0) return null;
  const code = await nextCashCode("thu");
  const voucher = await insertRow("cash_vouchers", {
    id: uid(),
    code,
    type: "thu",
    fund_type: fundType,
    branch_id: branchId,
    amount: Number(amount),
    voucher_type_id: null,
    collector_user_id: employeeId || null,
    payer_customer_id: customerId || null,
    payer_user_id: null,
    receiver_customer_id: null,
    note: `Thu từ đơn ${orderCode} — Hình thức: ${paymentMethodLabel}`,
    accounting: true,
    status: "active",
    created_by: employeeId || null,
    created_at: createdAt,
  });
  return voucher;
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const [orders, items, products, customers, employees, branches, schedules, schedule_assignments, users] =
    await Promise.all([
      fetchAllRows("orders", { orderBy: "created_at", ascending: false }),
      fetchAllRows("order_items"),
      fetchAllRows("products", { orderBy: "name" }),
      fetchAllRows("customers", { orderBy: "name" }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchRows("branches", { orderBy: "name" }),
      fetchAllRows("schedules", {
        select: "id, title, type, status, scheduled_date, scheduled_time, order_id, created_at",
        orderBy: "created_at",
        ascending: false,
      }),
      fetchAllRows("schedule_assignments"),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
    ]);

  const linkedSchedules = schedules.filter((s: any) => s.order_id != null);

  return {
    orders,
    items,
    products,
    customers,
    employees: employees.map((u: any) => ({ id: u.id, name: u.full_name })),
    branches,
    schedules: linkedSchedules,
    schedule_assignments,
    users,
  };
});

export const createOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const total = Math.max(0, subtotal - (data.discount || 0));
    const oid = uid();
    const code = await nextOrderCode();
    const createdAt = data.created_at || now();

    const status: "reserved" | "completed" | "draft" | "cancelled" =
      data.status || "reserved";

    const paymentMethod: "tien_mat" | "ngan_hang" =
      data.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat";
    const paymentMethodLabel =
      paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

    const deposit = Number(data.deposit || 0);
    const paid = Number(data.paid || 0);

    const context = {
      branch_id: data.branch_id,
      customer_id: data.customer_id || null,
      total,
      deposit,
      paid,
    };

    let receipt: any = null;
    let stockApplied = false;

    try {
      if (status === "completed") {
        await ensureStockAvailable(data.branch_id, data.items);
      }

      await insertRow("orders", {
        id: oid,
        code,
        customer_id: data.customer_id || null,
        branch_id: data.branch_id,
        employee_id: data.employee_id || null,
        status,
        subtotal,
        discount: Number(data.discount || 0),
        total,
        deposit,
        paid,
        payment_method: paymentMethod,
        note: data.note || null,
        created_at: createdAt,
      });

      for (const it of data.items) {
        const itemTotal = it.qty * it.unit_price - (it.discount || 0);
        await insertRow("order_items", {
          id: uid(),
          order_id: oid,
          product_id: it.product_id,
          qty: Number(it.qty),
          unit_price: Number(it.unit_price),
          discount: Number(it.discount || 0),
          total: itemTotal,
        });
      }

      if (status === "completed") {
        await applyCompletedOrderSideEffects(context, data.items);
        stockApplied = true;
      }

      const receiptAmount = deposit + paid;
      receipt = await autoCreateReceiptForOrder({
        orderCode: code,
        customerId: data.customer_id || null,
        branchId: data.branch_id,
        employeeId: data.employee_id || null,
        amount: receiptAmount,
        fundType: paymentMethod,
        paymentMethodLabel,
        createdAt,
      });

      await insertRow("activity_logs", {
        id: uid(),
        employee_id: data.employee_id || null,
        action: "create_order",
        detail: receipt ? `${code} (+phiếu thu ${receipt.code})` : code,
        created_at: createdAt,
      });

      return { ok: true, code, receipt_code: receipt?.code ?? null };
    } catch (err) {
      if (receipt?.id) {
        await deleteWhere("cash_vouchers", { id: receipt.id }).catch(() => undefined);
      }
      if (stockApplied) {
        await revertCompletedOrderSideEffects(context, data.items).catch(() => undefined);
      }
      await deleteWhere("order_items", { order_id: oid }).catch(() => undefined);
      await deleteWhere("orders", { id: oid }).catch(() => undefined);
      throw err;
    }
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string } }) => {
    const currentRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
      select: "id, customer_id, branch_id, employee_id, subtotal, discount, total, deposit, paid, payment_method, note, status",
      limit: 1,
    });
    const currentOrder = currentRows[0];
    if (!currentOrder) return { ok: true };

    const currentItems = await fetchRows<any>("order_items", {
      eq: { order_id: data.id },
      select: "id, product_id, qty, unit_price, discount, total",
    });

    if (currentOrder.status === "completed" && data.status !== "completed") {
      await revertCompletedOrderSideEffects(currentOrder, currentItems);
    }

    if (data.status === "completed" && currentOrder.status !== "completed") {
      await ensureStockAvailable(currentOrder.branch_id, currentItems as any);
    }

    await updateWhere("orders", { status: data.status }, { id: data.id });

    if (data.status === "completed" && currentOrder.status !== "completed") {
      await applyCompletedOrderSideEffects(currentOrder, currentItems as any);
    }

    return { ok: true };
  });

export const updateOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const existingRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
      select: "id, customer_id, branch_id, employee_id, subtotal, discount, total, deposit, paid, payment_method, note, status",
      limit: 1,
    });
    const existingOrder = existingRows[0];
    if (!existingOrder) return { ok: true };

    const existingItems = await fetchRows<any>("order_items", {
      eq: { order_id: data.id },
      select: "id, product_id, qty, unit_price, discount, total",
    });
    const existingStatus = existingOrder.status;

    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const total = Math.max(0, subtotal - (data.discount || 0));

    const paymentMethod: "tien_mat" | "ngan_hang" =
      data.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat";

    const nextOrder = {
      ...existingOrder,
      customer_id: data.customer_id || null,
      branch_id: data.branch_id,
      employee_id: data.employee_id || null,
      status: data.status,
      subtotal,
      discount: Number(data.discount || 0),
      total,
      deposit: Number(data.deposit || 0),
      paid: Number(data.paid || 0),
      payment_method: paymentMethod,
      note: data.note || null,
    };

    if (existingStatus === "completed") {
      await revertCompletedOrderSideEffects(
        {
          ...existingOrder,
          branch_id: existingOrder.branch_id,
        },
        existingItems,
      );
    }

    try {
      if (data.status === "completed") {
        await ensureStockAvailable(data.branch_id, data.items);
      }

      await updateWhere(
        "orders",
        {
          customer_id: data.customer_id || null,
          branch_id: data.branch_id,
          employee_id: data.employee_id || null,
          status: data.status,
          subtotal,
          discount: Number(data.discount || 0),
          total,
          deposit: Number(data.deposit || 0),
          paid: Number(data.paid || 0),
          payment_method: paymentMethod,
          note: data.note || null,
        },
        { id: data.id },
      );

      await deleteWhere("order_items", { order_id: data.id });
      for (const it of data.items) {
        const itemTotal = it.qty * it.unit_price - (it.discount || 0);
        await insertRow("order_items", {
          id: uid(),
          order_id: data.id,
          product_id: it.product_id,
          qty: Number(it.qty),
          unit_price: Number(it.unit_price),
          discount: Number(it.discount || 0),
          total: itemTotal,
        });
      }

      if (data.status === "completed") {
        await applyCompletedOrderSideEffects(
          {
            ...nextOrder,
            branch_id: data.branch_id,
          },
          data.items,
        );
      }

      return { ok: true };
    } catch (err) {
      const restoreOrder = {
        branch_id: existingOrder.branch_id,
        customer_id: existingOrder.customer_id || null,
        total: Number(existingOrder.total || 0),
        deposit: Number(existingOrder.deposit || 0),
        paid: Number(existingOrder.paid || 0),
      };
      if (existingStatus === "completed") {
        await applyCompletedOrderSideEffects(restoreOrder, existingItems as any).catch(() => undefined);
      }
      await updateWhere(
        "orders",
        {
          customer_id: existingOrder.customer_id || null,
          branch_id: existingOrder.branch_id,
          employee_id: existingOrder.employee_id || null,
          status: existingOrder.status,
          subtotal: Number(existingOrder.subtotal || 0),
          discount: Number(existingOrder.discount || 0),
          total: Number(existingOrder.total || 0),
          deposit: Number(existingOrder.deposit || 0),
          paid: Number(existingOrder.paid || 0),
          payment_method: existingOrder.payment_method || "tien_mat",
          note: existingOrder.note || null,
        },
        { id: data.id },
      ).catch(() => undefined);
      await deleteWhere("order_items", { order_id: data.id }).catch(() => undefined);
      for (const item of existingItems as any[]) {
        await insertRow("order_items", item).catch(() => undefined);
      }
      throw err;
    }
  });
