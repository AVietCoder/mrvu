// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchAllRows, fetchRow, fetchRows, insertRow, now, supabase, uid, updateWhere, logActivity } from "./supabase";

type StockItem = { product_id: string; qty: number };

async function getStockMap(branchId: string, productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
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

async function ensureStockAvailable(branchId: string, items: StockItem[], mode: "out" | "transfer") {
  const required = new Map<string, number>();
  for (const item of items) {
    const key = item.product_id;
    required.set(key, (required.get(key) ?? 0) + Number(item.qty || 0));
  }

  const available = await getStockMap(branchId, [...required.keys()]);
  const shortfalls: string[] = [];

  for (const [productId, qtyNeeded] of required.entries()) {
    const current = available.get(productId) ?? 0;
    if (current < qtyNeeded) {
      shortfalls.push(`${productId}: còn ${current}, cần ${qtyNeeded}`);
    }
  }

  if (shortfalls.length) {
    throw new Error(
      mode === "transfer"
        ? `Không đủ tồn kho để chuyển: ${shortfalls.join(" | ")}`
        : `Không đủ tồn kho để xuất: ${shortfalls.join(" | ")}`,
    );
  }
}

async function adjustStock(productId: string, branchId: string, delta: number) {
  const row = await fetchRow<{ qty: number }>("stock", {
    eq: { product_id: productId, branch_id: branchId },
    select: "qty",
  });

  const nextQty = Math.max(0, (row?.qty ?? 0) + delta);

  if (row) {
    await updateWhere("stock", { qty: nextQty }, { product_id: productId, branch_id: branchId });
  } else {
    await insertRow("stock", {
      product_id: productId,
      branch_id: branchId,
      qty: nextQty,
    });
  }
}



type PendingOrderSummary = {
  product_id: string;
  branch_id: string;
  qty: number;
  order_count: number;
};

function buildPendingOrderSummaries(
  orders: { id: string; branch_id?: string | null; status: string }[],
  items: { order_id: string; product_id: string; qty: number }[],
): PendingOrderSummary[] {
  const activeOrderIds = new Set(
    orders
      .filter((order) => order.status !== "completed" && order.status !== "cancelled")
      .map((order) => order.id),
  );

  const orderBranchById = new Map(
    orders.map((order) => [order.id, order.branch_id ?? ""]),
  );

  const agg = new Map<string, { qty: number; orderIds: Set<string> }>();

  for (const item of items) {
    if (!activeOrderIds.has(item.order_id)) continue;

    const branchId = orderBranchById.get(item.order_id) ?? "";
    const key = `${item.product_id}__${branchId}`;
    const current = agg.get(key) ?? { qty: 0, orderIds: new Set<string>() };
    current.qty += Number(item.qty || 0);
    current.orderIds.add(item.order_id);
    agg.set(key, current);
  }

  return [...agg.entries()].map(([key, value]) => {
    const [product_id, branch_id] = key.split("__");
    return {
      product_id,
      branch_id,
      qty: value.qty,
      order_count: value.orderIds.size,
    };
  });
}

export const listInventory = createServerFn({ method: "GET" }).handler(async () => {
  const [products, branches, stock, movements, transfers, transfer_items, orders, order_items] = await Promise.all([
    fetchRows("products", { orderBy: "name" }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("stock"),
    fetchRows("stock_movements", { orderBy: "created_at", ascending: false, limit: 100 }),
    fetchRows("stock_transfers", { orderBy: "created_at", ascending: false }),
    fetchRows("stock_transfer_items"),
    fetchAllRows("orders", { select: "id, branch_id, status", orderBy: "created_at", ascending: false }),
    fetchAllRows("order_items", { select: "order_id, product_id, qty" }),
  ]);

  const pending_order_summaries = buildPendingOrderSummaries(orders as any, order_items as any);

  return { products, branches, stock, movements, transfers, transfer_items, pending_order_summaries };
});

// Nhập / Xuất kho — nhận branch_id (cho cả nhập và xuất)
export const createMovement = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      type: "in" | "out";
      product_id: string;
      branch_id: string;
      qty: number;
      unit_cost?: number;
      note?: string;
      created_by?: string;
      actor_id?: string;
    };
  }) => {
    const branchId = data.branch_id;
    const createdBy = data.created_by || data.actor_id || null;
    const qty = Number(data.qty || 0);
    const delta = data.type === "in" ? qty : -qty;

    if (data.type === "out") {
      await ensureStockAvailable(branchId, [{ product_id: data.product_id, qty }], "out");
    }

    await adjustStock(data.product_id, branchId, delta);

    await insertRow("stock_movements", {
      id: uid(),
      type: data.type,
      product_id: data.product_id,
      from_branch: data.type === "out" ? branchId : null,
      to_branch: data.type === "in" ? branchId : null,
      qty,
      unit_cost: Number(data.unit_cost || 0),
      note: data.note || null,
      created_at: now(),
      created_by: createdBy,
    });

    await logActivity({ action: `stock_${data.type}`, detail: `${data.type === 'in' ? 'Nhập kho' : 'Xuất kho'} ${qty} SP tại chi nhánh ${data.branch_id}${data.note ? ' — ' + data.note : ''}`, employee_id: createdBy });
    return { ok: true };
  });

// Tạo phiếu chuyển kho (kho gửi trừ ngay, kho nhận chờ xác nhận)
export const createTransfer = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      from_branch: string;
      to_branch: string;
      items: { product_id: string; qty: number }[];
      note?: string;
      created_by?: string;
    };
  }) => {
    if (data.from_branch === data.to_branch) {
      throw new Error("Chi nhánh nguồn và đích không được giống nhau");
    }

    await ensureStockAvailable(data.from_branch, data.items, "transfer");

    const tid = uid();

    await insertRow("stock_transfers", {
      id: tid,
      from_branch: data.from_branch,
      to_branch: data.to_branch,
      status: "pending",
      note: data.note || null,
      created_by: data.created_by || null,
      created_at: now(),
    });

    for (const item of data.items) {
      await insertRow("stock_transfer_items", {
        id: uid(),
        transfer_id: tid,
        product_id: item.product_id,
        qty: Number(item.qty),
      });

      await adjustStock(item.product_id, data.from_branch, -Number(item.qty));

      await insertRow("stock_movements", {
        id: uid(),
        type: "transfer",
        product_id: item.product_id,
        from_branch: data.from_branch,
        to_branch: data.to_branch,
        qty: Number(item.qty),
        unit_cost: 0,
        note: `Phiếu chuyển kho ${tid}`,
        created_at: now(),
        created_by: data.created_by || null,
      });
    }

    await logActivity({ action: "stock_transfer", detail: `Chuyển kho: ${data.from_branch} → ${data.to_branch} (${data.items.length} mặt hàng)${data.note ? ' — ' + data.note : ''}`, employee_id: data.created_by || null });
    return { id: tid };
  });

// Chi nhánh nhận bấm xác nhận → kho nhận tăng lên
export const confirmTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string } }) => {
    const transfer = await fetchRow<any>("stock_transfers", { eq: { id: data.transfer_id } });
    if (!transfer) throw new Error("Không tìm thấy phiếu chuyển kho");
    if (transfer.status !== "pending") throw new Error("Phiếu này đã được xử lý");

    const items = await fetchRows<any>("stock_transfer_items", { eq: { transfer_id: data.transfer_id } });

    for (const item of items) {
      await adjustStock(item.product_id, transfer.to_branch, Number(item.qty));
    }

    await updateWhere(
      "stock_transfers",
      { status: "confirmed", confirmed_at: now() },
      { id: data.transfer_id },
    );
    await logActivity({ action: "confirm_transfer", detail: `Xác nhận phiếu chuyển kho ${data.transfer_id}` });
    return { ok: true };
  });

export const cancelTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string } }) => {
    const transfer = await fetchRow<any>("stock_transfers", { eq: { id: data.transfer_id } });
    if (!transfer || transfer.status !== "pending") throw new Error("Không thể hủy phiếu này");

    const items = await fetchRows<any>("stock_transfer_items", { eq: { transfer_id: data.transfer_id } });

    for (const item of items) {
      await adjustStock(item.product_id, transfer.from_branch, Number(item.qty));
    }

    await updateWhere("stock_transfers", { status: "cancelled" }, { id: data.transfer_id });
    await logActivity({ action: "cancel_transfer", detail: `Hủy phiếu chuyển kho ${data.transfer_id}` });
    return { ok: true };
  });
