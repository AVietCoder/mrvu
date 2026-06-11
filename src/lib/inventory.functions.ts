// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchAllRows, fetchRow, fetchRows, insertRow, deleteWhere, now, supabase, uid, updateWhere, logActivity } from "./supabase";

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

/**
 * FIX: Chỉ các đơn THỰC SỰ đang chờ xử lý (chưa hoàn thành, chưa hủy, chưa trả hàng)
 * mới được tính vào cột "đang đặt hàng" trên màn hình kho.
 *
 * Trước đây filter chỉ loại trừ "completed" và "cancelled", dẫn đến:
 *   - Đơn "returned"  → vẫn bị đếm vào pending  ❌
 *   - Đơn đã hoàn thành nhưng kho chưa trừ đúng → hiển thị sai số đặt hàng ❌
 *
 * Danh sách trạng thái "đang hoạt động" (cần giữ tồn kho):
 *   - "reserved"  : đơn đặt, đã cọc hoặc chưa thanh toán
 *   - "draft"     : đơn nháp
 * Các trạng thái KHÔNG tính pending:
 *   - "completed"           : đơn hoàn thành → kho đã bị trừ bởi applyCompletedOrderSideEffects
 *   - "cancelled"           : đơn hủy
 *   - "returned"            : đơn trả hàng → kho đã được hoàn lại bởi adjustStock
 *   - "partially_returned"  : đơn trả một phần (nếu có trong tương lai)
 */
const ACTIVE_ORDER_STATUSES = new Set(["reserved", "draft"]);

function buildPendingOrderSummaries(
  orders: { id: string; branch_id?: string | null; status: string }[],
  items: { order_id: string; product_id: string; qty: number }[],
): PendingOrderSummary[] {
  // FIX: dùng whitelist thay vì blacklist để tránh bỏ sót trạng thái mới
  const activeOrderIds = new Set(
    orders
      .filter((order) => ACTIVE_ORDER_STATUSES.has(order.status))
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

// ─────────────────────────────────────────────────────────────────────────
// PHÂN TRANG PHÍA SERVER cho bảng tồn kho (mẫu giống listCustomers).
// Mỗi trang ~20 sản phẩm kèm tổng tồn + đơn chờ + chi tiết theo chi nhánh (JSON).
// ─────────────────────────────────────────────────────────────────────────
export const searchInventoryPage = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { page?: number; pageSize?: number; search?: string; branch?: string; sort?: string } | undefined }) => {
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.max(1, data?.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    const { data: rows, error } = await supabase.rpc("search_inventory_page", {
      p_search: data?.search || null,
      p_branch: data?.branch || null,
      p_sort: data?.sort || "name",
      p_limit: pageSize,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);

    const products = (rows ?? []) as any[];
    const totalFiltered = products[0]?.filtered_count
      ? Number(products[0].filtered_count)
      : 0;
    return { products, meta: { totalFiltered } };
  },
);

// Dữ liệu phụ trợ (KHÔNG kèm toàn bộ stock/orders): chi nhánh, sản phẩm gọn cho
// ô chọn ở phiếu nhập/chuyển, 100 lượt nhập-xuất gần nhất, và phiếu chuyển ĐANG CHỜ.
// Bổ sung: 100 đơn bán hàng hoàn thành (completed) gần nhất để hiển thị trong lịch sử xuất kho.
export const getInventoryRefs = createServerFn({ method: "GET" }).handler(
  async () => {
    const [products, branches, movements, transfers, completedOrders] = await Promise.all([
      fetchAllRows("products", { select: "id, name, sku", orderBy: "name" }),
      fetchRows("branches", { orderBy: "name" }),
      fetchRows("stock_movements", { orderBy: "created_at", ascending: false, limit: 100 }),
      fetchRows("stock_transfers", { eq: { status: "pending" }, orderBy: "created_at", ascending: false }),
      fetchRows("orders", {
        eq: { status: "completed" },
        select: "id, code, branch_id, status, total, customer_id, completed_at, created_at, note",
        orderBy: "completed_at",
        ascending: false,
        limit: 100,
      }),
    ]);
    const transferIds = (transfers ?? []).map((t: any) => t.id);
    const transfer_items = transferIds.length
      ? await fetchRows("stock_transfer_items", { eq: { transfer_id: transferIds } })
      : [];

    // Lấy order_items cho các đơn hoàn thành để hiển thị chi tiết
    const completedOrderIds = (completedOrders ?? []).map((o: any) => o.id);
    const completed_order_items = completedOrderIds.length
      ? await fetchRows("order_items", { eq: { order_id: completedOrderIds }, select: "order_id, product_id, qty, unit_price, discount, total" })
      : [];

    return { products, branches, movements, transfers, transfer_items, completed_orders: completedOrders ?? [], completed_order_items };
  },
);

// Xuất Excel tồn kho: tải toàn bộ stock CHỈ khi bấm nút (không tải lúc vào trang).
export const getStockExport = createServerFn({ method: "GET" }).handler(
  async () => {
    const [products, stock] = await Promise.all([
      fetchAllRows("products", { select: "id, sku, name", orderBy: "name" }),
      fetchAllRows("stock"),
    ]);
    return { products, stock };
  },
);

export const listInventory = createServerFn({ method: "GET" }).handler(async () => {
  const [products, branches, stock, movements, transfers, transfer_items, orders, order_items] = await Promise.all([
    // products & stock có thể > 1000 dòng (products × branches) -> phải dùng fetchAllRows,
    // nếu không stock bị cắt ở 1000 dòng và nhiều sản phẩm hiển thị Tồn 0.
    fetchAllRows("products", { orderBy: "name" }),
    fetchRows("branches", { orderBy: "name" }),
    fetchAllRows("stock"),
    fetchRows("stock_movements", { orderBy: "created_at", ascending: false, limit: 100 }),
    // stock_transfers có thể vượt 1000 dòng → fetchAllRows để không mất phiếu cũ.
    fetchAllRows("stock_transfers", { orderBy: "created_at", ascending: false }),
    fetchAllRows("stock_transfer_items"),
    // FIX: chỉ tải đơn có trạng thái active để giảm dữ liệu thừa
    // Lưu ý: fetchAllRows không hỗ trợ `in` filter trực tiếp nên vẫn tải tất cả
    // nhưng buildPendingOrderSummaries sẽ lọc đúng bằng ACTIVE_ORDER_STATUSES
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

// Cập nhật SL sản phẩm trong phiếu chuyển kho (chỉ khi còn pending)
export const updateTransferItems = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string; items: { product_id: string; qty: number }[] } }) => {
    const transfer = await fetchRow<any>("stock_transfers", { eq: { id: data.transfer_id } });
    if (!transfer) throw new Error("Không tìm thấy phiếu chuyển kho");
    if (transfer.status !== "pending") throw new Error("Chỉ có thể chỉnh sửa phiếu đang chờ xác nhận");

    // Lấy items cũ để hoàn tồn kho nguồn
    const oldItems = await fetchRows<any>("stock_transfer_items", { eq: { transfer_id: data.transfer_id } });

    // Hoàn lại tồn kho nguồn theo items cũ
    for (const old of oldItems) {
      await adjustStock(old.product_id, transfer.from_branch, Number(old.qty));
    }

    // Xóa items cũ
    for (const old of oldItems) {
      await deleteWhere("stock_transfer_items", { id: old.id });
    }

    // Thêm items mới + trừ tồn kho nguồn
    for (const item of data.items) {
      if (!item.product_id || item.qty <= 0) continue;
      await insertRow("stock_transfer_items", {
        id: uid(),
        transfer_id: data.transfer_id,
        product_id: item.product_id,
        qty: Number(item.qty),
      });
      await adjustStock(item.product_id, transfer.from_branch, -Number(item.qty));
    }

    return { ok: true };
  });

// Chi nhánh nhận bấm xác nhận → kho nhận tăng lên
export const confirmTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string; actor_id?: string } }) => {
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
    await logActivity({ action: "confirm_transfer", detail: `Xác nhận phiếu chuyển kho ${data.transfer_id}`, employee_id: data.actor_id || transfer.created_by || null });
    return { ok: true };
  });

export const cancelTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string; actor_id?: string } }) => {
    const transfer = await fetchRow<any>("stock_transfers", { eq: { id: data.transfer_id } });
    if (!transfer || transfer.status !== "pending") throw new Error("Không thể hủy phiếu này");

    const items = await fetchRows<any>("stock_transfer_items", { eq: { transfer_id: data.transfer_id } });

    for (const item of items) {
      await adjustStock(item.product_id, transfer.from_branch, Number(item.qty));
    }

    await updateWhere("stock_transfers", { status: "cancelled" }, { id: data.transfer_id });
    await logActivity({ action: "cancel_transfer", detail: `Hủy phiếu chuyển kho ${data.transfer_id}`, employee_id: data.actor_id || transfer.created_by || null });
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: Chỉnh số lượng tồn kho trực tiếp theo từng chi nhánh
// Chỉ dùng để điều chỉnh sai lệch; tạo movement ghi lịch sử để truy vết.
// ─────────────────────────────────────────────────────────────────────────
export const adjustStockDirect = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      product_id: string;
      branch_id: string;
      new_qty: number;
      note?: string;
      actor_id?: string;
    };
  }) => {
    const newQty = Math.max(0, Math.round(Number(data.new_qty)));

    // Lấy tồn hiện tại
    const row = await fetchRow<{ qty: number }>("stock", {
      eq: { product_id: data.product_id, branch_id: data.branch_id },
      select: "qty",
    });
    const oldQty = Number(row?.qty ?? 0);

    if (oldQty === newQty) return { ok: true, changed: false };

    // Ghi thẳng vào bảng stock
    if (row) {
      await updateWhere("stock", { qty: newQty }, { product_id: data.product_id, branch_id: data.branch_id });
    } else {
      await insertRow("stock", {
        product_id: data.product_id,
        branch_id: data.branch_id,
        qty: newQty,
      });
    }

    const delta = newQty - oldQty;

    // Ghi lịch sử movement để truy vết
    await insertRow("stock_movements", {
      id: uid(),
      type: delta > 0 ? "in" : "out",
      product_id: data.product_id,
      from_branch: delta < 0 ? data.branch_id : null,
      to_branch: delta > 0 ? data.branch_id : null,
      qty: Math.abs(delta),
      unit_cost: 0,
      note: data.note || `Admin điều chỉnh tồn kho: ${oldQty} → ${newQty}`,
      created_at: now(),
      created_by: data.actor_id || null,
    });

    await logActivity({
      action: "stock_adjust",
      detail: `Điều chỉnh tồn kho SP ${data.product_id} tại ${data.branch_id}: ${oldQty} → ${newQty}${data.note ? ' — ' + data.note : ''}`,
      employee_id: data.actor_id || null,
    });

    return { ok: true, changed: true, oldQty, newQty };
  });