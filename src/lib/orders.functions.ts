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

async function adjustStock(productId: string, branchId: string, delta: number) {
  const rows = await fetchRows<{ qty: number }>("stock", {
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

async function applyCompletedOrderSideEffects(order: any, lineItems: any[]) {
  if (!order) return;

  for (const item of lineItems) {
    await adjustStock(item.product_id, order.branch_id, -Number(item.qty || 0));
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
      await updateWhere("customers", { debt: currentDebt + owed }, { id: order.customer_id });
    }
  }
}

async function revertCompletedOrderSideEffects(order: any, lineItems: any[]) {
  if (!order) return;

  for (const item of lineItems) {
    await adjustStock(item.product_id, order.branch_id, Number(item.qty || 0));
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

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  // ❗ Tất cả các bảng có thể vượt 1000 dòng đều dùng fetchAllRows.
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

/**
 * Tạo phiếu thu tự động cho khách hàng khi tạo/hoàn tất đơn.
 * - fund_type lấy theo hình thức thanh toán (tien_mat | ngan_hang).
 * - amount = đặt cọc + đã thanh toán (số tiền khách đã đưa thực tế).
 */
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
  await insertRow("cash_vouchers", {
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
  return code;
}

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

    // Mặc định: đơn đặt hàng / chưa giao.
    const status: "reserved" | "completed" | "draft" | "cancelled" =
      data.status || "reserved";

    const paymentMethod: "tien_mat" | "ngan_hang" =
      data.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat";
    const paymentMethodLabel =
      paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

    const deposit = Number(data.deposit || 0);
    const paid = Number(data.paid || 0);

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
      await applyCompletedOrderSideEffects(
        {
          branch_id: data.branch_id,
          customer_id: data.customer_id || null,
          total,
          deposit,
          paid,
        },
        data.items,
      );
    }

    // ✨ Tự động tạo phiếu thu khi khách đã đưa tiền (cọc + đã thanh toán)
    const receiptAmount = deposit + paid;
    const receiptCode = await autoCreateReceiptForOrder({
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
      detail: receiptCode ? `${code} (+phiếu thu ${receiptCode})` : code,
      created_at: createdAt,
    });

    return { ok: true, code, receipt_code: receiptCode };
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string } }) => {
    const currentRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
      select: "id, customer_id, branch_id, total, deposit, paid, status",
      limit: 1,
    });
    const currentOrder = currentRows[0];
    if (!currentOrder) return { ok: true };

    const currentItems = await fetchRows<any>("order_items", {
      eq: { order_id: data.id },
      select: "product_id, qty",
    });

    if (currentOrder.status === "completed" && data.status !== "completed") {
      await revertCompletedOrderSideEffects(currentOrder, currentItems);
    }

    await updateWhere("orders", { status: data.status }, { id: data.id });

    if (data.status === "completed" && currentOrder.status !== "completed") {
      await applyCompletedOrderSideEffects(currentOrder, currentItems);
    }

    return { ok: true };
  });

export const updateOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const existingRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
      select: "id, customer_id, branch_id, total, deposit, paid, status",
      limit: 1,
    });
    const existingOrder = existingRows[0];
    if (!existingOrder) return { ok: true };

    const existingItems = await fetchRows<any>("order_items", {
      eq: { order_id: data.id },
      select: "product_id, qty",
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
  });
