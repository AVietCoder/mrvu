// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import {
  countRows,
  deleteWhere,
  fetchAllRows,
  fetchRows,
  insertRow,
  insertRowSafe,
  now,
  supabase,
  uid,
  updateWhere,
  logActivity,
} from "./supabase";
import { recalculateCustomerDebt } from "./customers.functions";
import { enqueueOrderCompletedZns } from "./zalo/enqueue";

// ─── Gửi email thông báo admin ─────────────────────────────────────────────
async function getAdminEmail(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "admin_email")
      .single();
    return data?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function getSiteName(): Promise<string> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "site_name")
      .single();
    return data?.value?.trim() || "Mr.Vũ POS";
  } catch {
    return "Mr.Vũ POS";
  }
}

async function sendOrderNotificationEmail(params: {
  adminEmail: string;
  siteName: string;
  orderCode: string;
  eventType: "new_order" | "completed";
  customerName?: string;
  branchName?: string;
  total: number;
  items: Array<{ productName: string; qty: number; unitPrice: number }>;
  note?: string;
  paymentMethodLabel?: string;
}) {
  const moneyFmt = (n: number) =>
    new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";

  const eventLabel =
    params.eventType === "new_order" ? "🛒 ĐƠN HÀNG MỚI" : "✅ ĐƠN HOÀN THÀNH";

  const itemsHtml = params.items
    .map(
      (it, i) =>
        `<tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:8px 12px;color:#666">${i + 1}</td>
          <td style="padding:8px 12px;font-weight:500">${it.productName}</td>
          <td style="padding:8px 12px;text-align:center">${it.qty}</td>
          <td style="padding:8px 12px;text-align:right">${moneyFmt(it.unitPrice)}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600;color:#111">${moneyFmt(it.qty * it.unitPrice)}</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${eventLabel}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:#111;padding:24px 32px;color:#fff">
          <div style="font-size:13px;opacity:0.85;margin-bottom:4px">${params.siteName}</div>
          <div style="font-size:22px;font-weight:700">${eventLabel}</div>
          <div style="font-size:13px;opacity:0.85;margin-top:6px">
            Mã đơn: <strong style="font-family:monospace">${params.orderCode}</strong>
            &nbsp;|&nbsp; ${new Date().toLocaleString("vi-VN")}
          </div>
        </td></tr>
        <!-- Info grid -->
        <tr><td style="padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 12px 16px 0;vertical-align:top;width:50%">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Khách hàng</div>
                <div style="font-weight:600;font-size:15px">${params.customerName || "Khách lẻ"}</div>
              </td>
              <td style="padding:0 0 16px 12px;vertical-align:top">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Chi nhánh</div>
                <div style="font-weight:600;font-size:15px">${params.branchName || "—"}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 12px 0 0;vertical-align:top">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Thanh toán</div>
                <div style="font-weight:600">${params.paymentMethodLabel || "—"}</div>
              </td>
              <td style="padding:0 0 0 12px;vertical-align:top">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Tổng tiền</div>
                <div style="font-weight:700;font-size:18px;color:#111">${moneyFmt(params.total)}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Items table -->
        <tr><td style="padding:0 32px 24px">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:8px">Sản phẩm</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f9fafb;font-size:12px;color:#888;text-transform:uppercase">
                <th style="padding:8px 12px;text-align:left;font-weight:600">#</th>
                <th style="padding:8px 12px;text-align:left;font-weight:600">Sản phẩm</th>
                <th style="padding:8px 12px;text-align:center;font-weight:600">SL</th>
                <th style="padding:8px 12px;text-align:right;font-weight:600">Đơn giá</th>
                <th style="padding:8px 12px;text-align:right;font-weight:600">Thành tiền</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </td></tr>
        ${params.note ? `<tr><td style="padding:0 32px 24px"><div style="background:#fafafa;border:1px solid #e5e7eb;border-left:4px solid #111;border-radius:8px;padding:12px 16px;font-size:14px"><strong>Ghi chú:</strong> ${params.note}</div></td></tr>` : ""}
        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
          <div style="font-size:12px;color:#9ca3af;text-align:center">
            Email tự động từ ${params.siteName} — Không trả lời email này
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const subject =
    params.eventType === "new_order"
      ? `[${params.siteName}] Đơn hàng mới: ${params.orderCode} — ${params.customerName || "Khách lẻ"}`
      : `[${params.siteName}] Hoàn thành đơn: ${params.orderCode} — ${params.customerName || "Khách lẻ"}`;

  // Gửi qua Supabase edge function "send-email" (nếu có)
  // hoặc qua SMTP bằng fetch nếu tự cấu hình
  // Hiện tại dùng Resend API nếu có RESEND_API_KEY trong env
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return; // Chưa cấu hình — bỏ qua

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${params.siteName} <noreply@ttv.vn>`,
      to: [params.adminEmail],
      subject,
      html,
    }),
  });
}

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
    const customerRows = await fetchRows<{ debt: number; total_buy: number }>("customers", {
      eq: { id: order.customer_id },
      select: "debt, total_buy",
      limit: 1,
    });
    const currentDebt = customerRows[0]?.debt ?? 0;
    const currentTotalBuy = customerRows[0]?.total_buy ?? 0;
    const owed = Math.max(0, Number(order.total || 0) - Number(order.deposit || 0) - Number(order.paid || 0));
    const orderTotal = Number(order.total || 0);

    const updates: Record<string, number> = {
      total_buy: currentTotalBuy + orderTotal,
    };
    if (owed > 0) {
      updates.debt = currentDebt + owed;
    }
    await updateWhere("customers", updates, { id: order.customer_id });
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
    const customerRows = await fetchRows<{ debt: number; total_buy: number }>("customers", {
      eq: { id: order.customer_id },
      select: "debt, total_buy",
      limit: 1,
    });
    const currentDebt = customerRows[0]?.debt ?? 0;
    const currentTotalBuy = customerRows[0]?.total_buy ?? 0;
    const owed = Math.max(0, Number(order.total || 0) - Number(order.deposit || 0) - Number(order.paid || 0));
    const orderTotal = Number(order.total || 0);

    const updates: Record<string, number> = {
      total_buy: Math.max(0, currentTotalBuy - orderTotal),
    };
    if (owed > 0) {
      updates.debt = Math.max(0, currentDebt - owed);
    }
    await updateWhere("customers", updates, { id: order.customer_id });
  }
}


async function revertCashVouchersForOrder(orderCode: string) {
  // Xóa các phiếu thu/chi liên quan đến mã đơn hàng này.
  // ⚠ Trước đây lọc bằng `.like('%code%')` gây xóa NHẦM: mã đơn là tiền tố của
  //   nhau ("HD000001" nằm trong "HD0000010") → hủy/sửa đơn HD000001 xóa luôn
  //   phiếu của HD0000010..HD0000019 (và HD000010x...). Vì vậy sau khi truy vấn
  //   theo LIKE, ta lọc lại trong JS: mã chỉ khớp khi đứng thành "token" (không
  //   bị một chữ số khác dính liền ngay sau).
  const { data: vouchers } = await supabase
    .from("cash_vouchers")
    .select("id, code, note")
    .like("note", `%${orderCode}%`);
  if (!vouchers || vouchers.length === 0) return;
  const escaped = orderCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenRe = new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9]|$)`);
  for (const v of vouchers) {
    if (!tokenRe.test(String(v.note ?? ""))) continue;
    await deleteWhere("cash_vouchers", { id: v.id }).catch(() => undefined);
  }
}

async function nextOrderCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const count = await countRows("orders");
    const candidate = "HD" + String(count + 1 + attempt).padStart(6, "0");
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  const ts = Date.now().toString().slice(-6);
  return "HD" + ts;
}

async function nextCashCode(type: "thu" | "chi"): Promise<string> {
  const prefix = type === "thu" ? "PT" : "PC";
  // Retry up to 10 times to handle concurrent inserts (race condition)
  for (let attempt = 0; attempt < 10; attempt++) {
    const { count } = await supabase
      .from("cash_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("type", type);
    const candidate = prefix + String((count ?? 0) + 1 + attempt).padStart(6, "0");
    const { data: existing } = await supabase
      .from("cash_vouchers")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  // Absolute fallback: timestamp+random to guarantee uniqueness
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return prefix + ts + rand;
}

// ─── Loại phiếu tự động (cache trong tiến trình để khỏi truy vấn lặp) ─────────
let _orderReceiptTypeId: string | null | undefined; // 'thu' — Thu tiền đơn hàng / công nợ
let _orderRefundTypeId: string | null | undefined;  // 'chi' — Hoàn tiền trả hàng

async function ensureVoucherType(
  kind: "thu" | "chi",
  keywords: RegExp,
  defaultName: string,
): Promise<string | null> {
  try {
    const types = await fetchRows<any>("cash_voucher_types", {
      eq: { kind },
      select: "id, name, kind",
    });
    const found = (types || []).find((t: any) => keywords.test(String(t.name || "")));
    if (found) return found.id;
    const id = uid();
    await insertRow("cash_voucher_types", { id, name: defaultName, kind });
    return id;
  } catch {
    // Không chặn luồng chính nếu bảng loại phiếu gặp sự cố
    return null;
  }
}

async function getOrderReceiptTypeId(): Promise<string | null> {
  if (_orderReceiptTypeId === undefined) {
    _orderReceiptTypeId = await ensureVoucherType(
      "thu",
      /công\s*nợ|đơn\s*hàng|bán\s*hàng/i,
      "Thu tiền đơn hàng",
    );
  }
  return _orderReceiptTypeId ?? null;
}

async function getOrderRefundTypeId(): Promise<string | null> {
  if (_orderRefundTypeId === undefined) {
    _orderRefundTypeId = await ensureVoucherType(
      "chi",
      /trả\s*hàng|hoàn\s*tiền/i,
      "Hoàn tiền trả hàng",
    );
  }
  return _orderRefundTypeId ?? null;
}

/**
 * Tạo 1 phiếu THU/CHI cho đơn hàng và ghi vào Sổ quỹ.
 *
 * - Set ĐẦY ĐỦ mô hình Bên A (quỹ/chi nhánh) → Bên B (khách hàng) để hiển thị
 *   đúng trên trang Sổ quỹ (giống phiếu tạo tay), đồng thời vẫn giữ các cột cũ
 *   (payer_customer_id / receiver_customer_id) để phần công nợ tính chính xác.
 * - Gắn "Loại phiếu" = Thu tiền đơn hàng / Hoàn tiền trả hàng để dễ lọc.
 * - `recalcDebt`: nếu true thì tính lại công nợ khách ngay (mặc định false để
 *   giữ nguyên cách hạch toán công nợ hiện có của luồng đơn hàng).
 */
async function createOrderCashVoucher({
  kind,
  orderCode,
  customerId,
  branchId,
  employeeId,
  amount,
  fundType,
  paymentMethodLabel,
  createdAt,
  notePrefix,
  noteOverride,
  recalcDebt = false,
  bankAccountIdx = null,
}: {
  kind: "thu" | "chi";
  orderCode: string;
  customerId: string | null;
  branchId: string;
  employeeId: string | null;
  amount: number;
  fundType: "tien_mat" | "ngan_hang";
  paymentMethodLabel: string;
  createdAt: string;
  notePrefix?: string;
  noteOverride?: string;
  recalcDebt?: boolean;
  /** Số thứ tự tài khoản ngân hàng (chỉ dùng khi fundType = "ngan_hang"). */
  bankAccountIdx?: number | null;
}) {
  if (!amount || amount <= 0) return null;
  const code = await nextCashCode(kind);
  const isThu = kind === "thu";
  const label = notePrefix ?? (isThu ? "Thu từ đơn" : "Chi cho đơn");
  const voucherTypeId = isThu ? await getOrderReceiptTypeId() : await getOrderRefundTypeId();
  const hasCustomer = !!customerId;

  const voucher = await insertRowSafe("cash_vouchers", {
    id: uid(),
    code,
    type: kind, // 'thu' | 'chi'
    fund_type: fundType, // 'tien_mat' | 'ngan_hang'
    branch_id: branchId,
    amount: Number(amount),
    voucher_type_id: voucherTypeId,
    // Số tài khoản ngân hàng dùng cho phiếu (chỉ có ý nghĩa khi chuyển khoản).
    // insertRowSafe sẽ tự bỏ cột này nếu DB chưa có (chưa chạy migration v6).
    bank_account_idx: fundType === "ngan_hang" ? (bankAccountIdx ?? null) : null,
    // ── Mô hình A → B (Bên A LUÔN là chi nhánh/quỹ, Bên B là khách) ──
    from_kind: "branch",
    from_id: branchId,
    from_name: null,
    to_kind: hasCustomer ? "customer" : "other",
    to_id: hasCustomer ? customerId : null,
    to_name: hasCustomer ? null : "Khách lẻ",
    // ── Cột cũ (để tính công nợ khách trong recalculateCustomerDebt) ──
    collector_user_id: isThu ? employeeId || null : null,
    payer_customer_id: isThu ? customerId || null : null,
    payer_user_id: null,
    receiver_customer_id: isThu ? null : customerId || null,
    note: noteOverride ?? `${label} ${orderCode} — Hình thức: ${paymentMethodLabel}`,
    accounting: true,
    status: "active",
    created_by: employeeId || null,
    created_at: createdAt,
  });

  if (recalcDebt && customerId) {
    await recalculateCustomerDebt(customerId).catch(() => undefined);
  }
  return voucher;
}

// Tương thích tên cũ: tạo phiếu THU cho đơn.
async function autoCreateReceiptForOrder(args: {
  orderCode: string;
  customerId: string | null;
  branchId: string;
  employeeId: string | null;
  amount: number;
  fundType: "tien_mat" | "ngan_hang";
  paymentMethodLabel: string;
  createdAt: string;
  notePrefix?: string;
}) {
  return createOrderCashVoucher({ kind: "thu", ...args });
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  // ⚡ users được fetch 1 LẦN rồi tái sử dụng cho cả `employees` và `users`
  // (trước đây gọi 2 lần giống hệt → 1 round-trip thừa). Dữ liệu y hệt.
  const [orders, items, products, customers, users, branches, schedules, schedule_assignments, stock] =
    await Promise.all([
      fetchAllRows("orders", { orderBy: "created_at", ascending: false }),
      fetchAllRows("order_items"),
      fetchAllRows("products", { orderBy: "name" }),
      fetchAllRows("customers", { orderBy: "created_at", ascending: false }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchRows("branches", { orderBy: "name" }),
      fetchAllRows("schedules", {
        select: "id, title, type, status, scheduled_date, scheduled_time, order_id, created_at",
        orderBy: "created_at",
        ascending: false,
      }),
      fetchAllRows("schedule_assignments"),
      fetchAllRows("stock"),
    ]);

  const linkedSchedules = schedules.filter((s: any) => s.order_id != null);

  return {
    orders,
    items,
    products,
    customers,
    employees: users.map((u: any) => ({ id: u.id, name: u.full_name })),
    branches,
    schedules: linkedSchedules,
    schedule_assignments,
    users,
    stock,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// PHÂN TRANG PHÍA SERVER (mẫu giống listCustomers) — dùng cho danh sách đơn.
// Trang Đơn hàng KHÔNG còn tải toàn bộ orders/order_items/schedules về client.
// ─────────────────────────────────────────────────────────────────────────
interface SearchOrdersArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  branch?: string;
  tab?: "orders" | "reserved";
  branchIds?: string[] | null;
  sortBy?: string;
  customer?: string;
  employee?: string;
  fromDate?: string;
  toDate?: string;
}

export const searchOrdersPage = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: SearchOrdersArgs | undefined }) => {
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.max(1, data?.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    const { data: rows, error } = await supabase.rpc("search_orders_page", {
      p_search: data?.search || null,
      p_status: data?.status || null,
      p_branch: data?.branch || null,
      p_tab: data?.tab || "orders",
      p_branch_ids:
        data?.branchIds && data.branchIds.length ? data.branchIds : null,
      p_employee: data?.employee || null,
      p_customer: data?.customer || null,
      p_from: data?.fromDate || null,
      p_to: data?.toDate || null,
      p_sort: data?.sortBy || "newest",
      p_limit: pageSize,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);

    const orders = (rows ?? []) as any[];
    const totalFiltered = orders[0]?.filtered_count
      ? Number(orders[0].filtered_count)
      : 0;

    return { orders, meta: { totalFiltered } };
  },
);

export const getOrderStats = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { branchIds?: string[] | null } | undefined }) => {
    const [statsRes, branches, users] = await Promise.all([
      supabase.rpc("orders_stats", {
        p_branch_ids:
          data?.branchIds && data.branchIds.length ? data.branchIds : null,
      }),
      fetchRows("branches", { orderBy: "name" }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
    ]);
    if (statsRes.error) throw new Error(statsRes.error.message);
    const r = statsRes.data;
    const row = (Array.isArray(r) ? r[0] : r) ?? {};
    return {
      reservedCount: Number(row.reserved_count ?? 0),
      totalOrders: Number(row.total_orders ?? 0),
      branches: branches ?? [],
      employees: ((users ?? []) as any[]).map((u: any) => ({ id: u.id, name: u.full_name })),
    };
  },
);

// Dữ liệu tra cứu cho FORM tạo đơn (sản phẩm, tồn kho, chi nhánh, nhân viên).
// KHÔNG còn tải toàn bộ khách hàng — ô chọn khách dùng tìm-kiếm-theo-server.
export const getOrderFormRefs = createServerFn({ method: "GET" }).handler(
  async () => {
    const [products, users, branches, stock] = await Promise.all([
      fetchAllRows("products", { orderBy: "name" }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchRows("branches", { orderBy: "name" }),
      fetchAllRows("stock"),
    ]);

    return {
      products,
      employees: users.map((u: any) => ({ id: u.id, name: u.full_name })),
      branches,
      stock,
    };
  },
);

// Chi tiết 1 ĐƠN — thay cho việc tải cả DB ở trang /orders/$id.
// Trả đúng dữ liệu cần để XEM: đơn + items + lịch liên kết, kèm sản phẩm/tồn
// chỉ cho các SP trong đơn (cho phần xem tồn theo chi nhánh) + khách của đơn.
export const getOrderDetail = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { id: string } }) => {
    const id = data?.id;
    if (!id) {
      return {
        orders: [],
        items: [],
        products: [],
        stock: [],
        branches: [],
        customers: [],
        employees: [],
        users: [],
        schedules: [],
        schedule_assignments: [],
      };
    }

    const [orderRows, items, branches, users, linkedSchedules] =
      await Promise.all([
        fetchRows("orders", { eq: { id }, limit: 1 }),
        fetchRows("order_items", { eq: { order_id: id } }),
        fetchRows("branches", { orderBy: "name" }),
        fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
        fetchRows("schedules", {
          eq: { order_id: id },
          orderBy: "created_at",
          ascending: false,
        }),
      ]);

    const order = orderRows?.[0] ?? null;
    const productIds = [...new Set((items ?? []).map((i: any) => i.product_id).filter(Boolean))];
    const scheduleIds = (linkedSchedules ?? []).map((s: any) => s.id);

    const [products, stock, customerRows, schedule_assignments] =
      await Promise.all([
        productIds.length
          ? fetchRows("products", { eq: { id: productIds } })
          : Promise.resolve([]),
        productIds.length
          ? fetchRows("stock", { eq: { product_id: productIds } })
          : Promise.resolve([]),
        order?.customer_id
          ? fetchRows("customers", { eq: { id: order.customer_id }, limit: 1 })
          : Promise.resolve([]),
        scheduleIds.length
          ? fetchRows("schedule_assignments", { eq: { schedule_id: scheduleIds } })
          : Promise.resolve([]),
      ]);

    return {
      orders: order ? [order] : [],
      items: items ?? [],
      products: products ?? [],
      stock: stock ?? [],
      branches: branches ?? [],
      customers: customerRows ?? [],
      employees: (users ?? []).map((u: any) => ({ id: u.id, name: u.full_name })),
      users: users ?? [],
      schedules: linkedSchedules ?? [],
      schedule_assignments: schedule_assignments ?? [],
    };
  },
);

// Dữ liệu tra cứu ĐẦY ĐỦ cho chế độ SỬA đơn ở /orders/$id (tải lười khi bấm Sửa):
// sản phẩm/tồn/khách đầy đủ + lịch (để liên kết) + phân công + chi nhánh + NV.
export const getOrderEditRefs = createServerFn({ method: "GET" }).handler(
  async () => {
    const [products, customers, users, branches, stock, schedules, schedule_assignments] =
      await Promise.all([
        fetchAllRows("products", { orderBy: "name" }),
        fetchAllRows("customers", {
          select: "id, name, phone, address, ward, district, province",
          orderBy: "created_at",
          ascending: false,
        }),
        fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
        fetchRows("branches", { orderBy: "name" }),
        fetchAllRows("stock"),
        fetchAllRows("schedules", {
          select: "id, title, type, status, scheduled_date, scheduled_time, order_id, created_at",
          orderBy: "created_at",
          ascending: false,
        }),
        fetchAllRows("schedule_assignments"),
      ]);

    return {
      products,
      customers,
      employees: users.map((u: any) => ({ id: u.id, name: u.full_name })),
      users,
      branches,
      stock,
      schedules,
      schedule_assignments,
    };
  },
);

export const createOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const vatAmount = Number(data.vat_amount || 0);
    const total = Math.max(0, subtotal - (data.discount || 0) + vatAmount);
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
        discount_type: data.discount_type || "amount",    // 'amount' | 'percent'
        discount_pct: Number(data.discount_pct || 0),
        vat_rate: Number(data.vat_rate || 0),             // e.g. 0.08, 0.10
        vat_amount: vatAmount,
        total,
        deposit,
        paid,
        payment_method: paymentMethod,
        note: data.note || null,
        created_at: createdAt,
        completed_at: status === "completed" ? now() : null,
      });

      // zalo_notify ghi RIÊNG, không nhét vào insertRow ở trên. Lý do: insertRow
      // là bản nghiêm ngặt — nếu DB chưa chạy migration v10 thì cả câu insert
      // hỏng, tức là KHÔNG TẠO ĐƯỢC ĐƠN NÀO. Bán hàng không được phép chết chỉ
      // vì thiếu một cột của tính năng phụ.
      // Chỉ ghi khi = true; NULL và false đều được hiểu là "không gửi".
      if (data.zalo_notify === true) {
        await updateWhere("orders", { zalo_notify: true }, { id: oid }).catch(() => undefined);
      }

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
      // Ghi rõ là "Đặt cọc đơn" nếu chỉ có tiền cọc (đơn mới đặt), ngược lại là thanh toán.
      const createNotePrefix =
        status !== "completed" && deposit > 0 && paid === 0 ? "Đặt cọc đơn" : "Thanh toán đơn";
      receipt = await autoCreateReceiptForOrder({
        orderCode: code,
        customerId: data.customer_id || null,
        branchId: data.branch_id,
        employeeId: data.employee_id || null,
        amount: receiptAmount,
        fundType: paymentMethod,
        paymentMethodLabel,
        createdAt,
        notePrefix: createNotePrefix,
      });

      await insertRow("activity_logs", {
        id: uid(),
        employee_id: data.employee_id || null,
        action: "create_order",
        detail: receipt ? `${code} (+phiếu thu ${receipt.code})` : code,
        created_at: createdAt,
      });

      // Gửi email thông báo admin
      try {
        const [adminEmail, siteName] = await Promise.all([getAdminEmail(), getSiteName()]);
        if (adminEmail) {
          const productIds = data.items.map((it: any) => it.product_id);
          const productMap = await loadProductNames(productIds);
          let customerName: string | undefined;
          if (data.customer_id) {
            const custRows = await fetchRows<any>("customers", { eq: { id: data.customer_id }, select: "name", limit: 1 });
            customerName = custRows[0]?.name;
          }
          let branchName: string | undefined;
          if (data.branch_id) {
            const branchRows = await fetchRows<any>("branches", { eq: { id: data.branch_id }, select: "name", limit: 1 });
            branchName = branchRows[0]?.name;
          }
          await sendOrderNotificationEmail({
            adminEmail,
            siteName,
            orderCode: code,
            eventType: "new_order",
            customerName,
            branchName,
            total,
            paymentMethodLabel,
            note: data.note,
            items: data.items.map((it: any) => ({
              productName: productMap.get(it.product_id)?.name ?? it.product_id,
              qty: it.qty,
              unitPrice: it.unit_price,
            })),
          });
        }
      } catch (_emailErr) {
        // Lỗi email không ảnh hưởng đơn hàng
      }

      // Hóa đơn nhanh (tạo thẳng ở trạng thái hoàn tất) cũng phải nhắn khách.
      // Đặt SÁT return: mọi bước có thể ném lỗi đã qua hết, nên không có
      // chuyện đơn bị rollback mà job gửi tin vẫn nằm lại trong hàng đợi.
      if (status === "completed") {
        await enqueueOrderCompletedZns(oid);
      }

      return { ok: true, code, receipt_code: receipt?.code ?? null, id: oid };
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
  .handler(async ({ data }: { data: { id: string; status: string; paid?: number; payment_method?: string; actor_id?: string; zalo_notify?: boolean } }) => {
    const currentRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
    select: "id, code, customer_id, branch_id, employee_id, subtotal, discount, total, deposit, paid, payment_method, note, status",
      limit: 1,
    });
    const currentOrder = currentRows[0];
    if (!currentOrder) return { ok: true };

    // ── Server-side permission check khi hủy đơn ──
    if (data.status === "cancelled" && data.actor_id) {
      const actorRows = await fetchRows<any>("users", {
        eq: { id: data.actor_id },
        select: "id, is_admin",
        limit: 1,
      });
      const actor = actorRows[0];
      if (!actor) throw new Error("Người dùng không tồn tại");
      if (!actor.is_admin) {
        // Phải là người tạo đơn VÀ có quyền create_order
        if (currentOrder.employee_id !== data.actor_id) {
          throw new Error("Bạn không có quyền hủy đơn của người khác");
        }
        const perms = await fetchRows<any>("user_permissions", {
          eq: { user_id: data.actor_id },
          select: "permission",
        });
        const hasCreate = perms.some((p: any) => p.permission === "create_order");
        if (!hasCreate) throw new Error("Bạn không có quyền hủy đơn");
      }
    }


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

    // Cập nhật paid + payment_method nếu được truyền từ UI thanh toán
    const updateFields: Record<string, any> = { status: data.status };
    if (typeof data.paid === "number") updateFields.paid = data.paid;
    if (data.payment_method) updateFields.payment_method = data.payment_method;
    // ✅ Ghi completed_at = thời điểm nhấn "Tạo hóa đơn"
    if (data.status === "completed") updateFields.completed_at = now();
    await updateWhere("orders", updateFields, { id: data.id });

    // Lựa chọn "Gửi thông báo Zalo" ở màn hình Tạo hóa đơn (đơn đặt hàng ->
    // hoàn tất). Phải ghi TRƯỚC khối completed bên dưới, vì enqueue đọc lại
    // đơn từ DB — ghi sau thì nó vẫn thấy giá trị cũ và bỏ qua tin.
    // Ghi riêng, có .catch(): updateWhere là bản nghiêm ngặt, thiếu cột là
    // hỏng cả thao tác hoàn tất đơn.
    if (data.zalo_notify !== undefined) {
      await updateWhere(
        "orders",
        { zalo_notify: data.zalo_notify === true },
        { id: data.id },
      ).catch(() => undefined);
    }

    // effectivePaid = paid mới từ UI hoặc giá trị cũ trong DB
    const effectivePaid = typeof data.paid === "number" ? data.paid : Number(currentOrder.paid || 0);
    const effectivePaymentMethod: "tien_mat" | "ngan_hang" =
      (data.payment_method === "ngan_hang" || (!data.payment_method && currentOrder.payment_method === "ngan_hang"))
        ? "ngan_hang" : "tien_mat";

    if (data.status === "completed" && currentOrder.status !== "completed") {
      // ✅ Truyền effectivePaid thay vì currentOrder.paid (đọc trước khi updateWhere)
      await applyCompletedOrderSideEffects({ ...currentOrder, paid: effectivePaid }, currentItems as any);

      // Tạo phiếu thu = số tiền khách TRẢ THÊM lần này (effectivePaid - đã trả trước đó).
      // Tiền cọc (nếu có) đã được tạo phiếu thu ngay lúc tạo đơn nên không cộng lại.
      // Phần còn thiếu (nếu có) sẽ tự cộng vào công nợ qua applyCompletedOrderSideEffects.
      const paymentMethod = effectivePaymentMethod;
      const paymentMethodLabel =
        paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

      const paidDelta = Math.max(0, effectivePaid - Number(currentOrder.paid || 0));
      await autoCreateReceiptForOrder({
        orderCode: currentOrder.code,
        customerId: currentOrder.customer_id || null,
        branchId: currentOrder.branch_id,
        employeeId: currentOrder.employee_id || null,
        amount: paidDelta,
        fundType: paymentMethod,
        paymentMethodLabel,
        createdAt: now(),
        notePrefix: "Thanh toán đơn",
      });

      // Gửi email thông báo admin khi hoàn thành đơn
      try {
        const [adminEmail, siteName] = await Promise.all([getAdminEmail(), getSiteName()]);
        if (adminEmail) {
          const productIds = currentItems.map((it: any) => it.product_id);
          const productMap = await loadProductNames(productIds);
          let customerName: string | undefined;
          if (currentOrder.customer_id) {
            const custRows = await fetchRows<any>("customers", { eq: { id: currentOrder.customer_id }, select: "name", limit: 1 });
            customerName = custRows[0]?.name;
          }
          let branchName: string | undefined;
          if (currentOrder.branch_id) {
            const branchRows = await fetchRows<any>("branches", { eq: { id: currentOrder.branch_id }, select: "name", limit: 1 });
            branchName = branchRows[0]?.name;
          }
          const pm: "tien_mat" | "ngan_hang" =
            currentOrder.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat";
          await sendOrderNotificationEmail({
            adminEmail,
            siteName,
            orderCode: currentOrder.code,
            eventType: "completed",
            customerName,
            branchName,
            total: Number(currentOrder.total || 0),
            paymentMethodLabel: pm === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt",
            note: currentOrder.note,
            items: currentItems.map((it: any) => ({
              productName: productMap.get(it.product_id)?.name ?? it.product_id,
              qty: it.qty,
              unitPrice: it.unit_price,
            })),
          });
        }
      } catch (_emailErr) {
        // Lỗi email không ảnh hưởng việc cập nhật trạng thái
      }
      await logActivity({ action: "complete_order", detail: `Hoàn tất đơn ${currentOrder.code}`, employee_id: data.actor_id || currentOrder.employee_id || null });

      // Đẩy tin ZNS "mua hàng thành công" vào hàng đợi. Hàm này tự nuốt mọi
      // lỗi — Zalo hỏng thì đơn vẫn hoàn tất bình thường.
      await enqueueOrderCompletedZns(currentOrder.id);
    }

    if (data.status === "cancelled") {
      // Rollback: hoàn lại công nợ khách hàng nếu đơn đang là reserved (đặt cọc)
      if (currentOrder.status === "reserved" || currentOrder.status === "draft") {
        if (currentOrder.customer_id) {
          const customerRows = await fetchRows<{ debt: number; total_buy: number }>("customers", {
            eq: { id: currentOrder.customer_id },
            select: "debt, total_buy",
            limit: 1,
          });
          const currentDebt = customerRows[0]?.debt ?? 0;
          const currentTotalBuy = customerRows[0]?.total_buy ?? 0;
          const deposit = Number(currentOrder.deposit || 0);
          // Hoàn lại tiền cọc đã trừ vào công nợ (nếu có)
          const updates: Record<string, number> = {};
          if (deposit > 0) {
            // Nếu đặt cọc đã tạo thành công nợ thì hoàn lại
            updates.debt = Math.max(0, currentDebt - deposit);
          }
          if (Object.keys(updates).length) {
            await updateWhere("customers", updates, { id: currentOrder.customer_id });
          }
        }
      }
      // Xóa phiếu thu chi liên quan đến đơn hàng bị hủy
      await revertCashVouchersForOrder(currentOrder.code);
      await logActivity({ action: "cancel_order", detail: `Hủy đơn ${currentOrder.code} — đã rollback phiếu thu chi`, employee_id: data.actor_id || currentOrder.employee_id || null });
    }

    return { ok: true };
  });

export const updateOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const existingRows = await fetchRows<any>("orders", {
      eq: { id: data.id },
      select: "id, code, customer_id, branch_id, employee_id, subtotal, discount, total, deposit, paid, payment_method, note, status",
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
    const vatAmount = Number(data.vat_amount || 0);
    const total = Math.max(0, subtotal - (data.discount || 0) + vatAmount);

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
      discount_type: data.discount_type || "amount",
      discount_pct: Number(data.discount_pct || 0),
      vat_rate: Number(data.vat_rate || 0),
      vat_amount: vatAmount,
      total,
      deposit: Number(data.deposit || 0),
      paid: Number(data.paid || 0),
      payment_method: paymentMethod,
      note: data.note || null,
    };
    // Cũng ghi riêng như lúc tạo đơn, vì cùng lý do: updateWhere nghiêm ngặt,
    // thiếu cột là hỏng cả thao tác sửa đơn. Form sửa không gửi trường này thì
    // giữ nguyên lựa chọn cũ — sửa ghi chú không được vô tình bật/tắt nhắn khách.
    const zaloNotifyChange =
      data.zalo_notify === undefined ? null : { zalo_notify: data.zalo_notify === true };

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

      if (zaloNotifyChange) {
        await updateWhere("orders", zaloNotifyChange, { id: data.id }).catch(() => undefined);
      }

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

      // ✅ Khi SỬA đơn: nếu số tiền khách đã trả (đặt cọc + thanh toán) thay đổi
      //    thì ghi nhận vào Sổ quỹ phần CHÊNH LỆCH.
      //    - Trả thêm  → tạo PHIẾU THU phần tăng thêm.
      //    - Trả ít đi → tạo PHIẾU CHI (điều chỉnh giảm) phần giảm.
      const oldCollected = Number(existingOrder.deposit || 0) + Number(existingOrder.paid || 0);
      const newCollected = Number(data.deposit || 0) + Number(data.paid || 0);
      const collectedDelta = newCollected - oldCollected;
      const editPmLabel =
        paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

      if (collectedDelta > 0) {
        await createOrderCashVoucher({
          kind: "thu",
          orderCode: existingOrder.code,
          customerId: data.customer_id || null,
          branchId: data.branch_id,
          employeeId: data.employee_id || null,
          amount: collectedDelta,
          fundType: paymentMethod,
          paymentMethodLabel: editPmLabel,
          createdAt: now(),
          notePrefix: "Thu thêm (sửa đơn)",
        });
      } else if (collectedDelta < 0) {
        await createOrderCashVoucher({
          kind: "chi",
          orderCode: existingOrder.code,
          customerId: data.customer_id || null,
          branchId: data.branch_id,
          employeeId: data.employee_id || null,
          amount: -collectedDelta,
          fundType: paymentMethod,
          paymentMethodLabel: editPmLabel,
          createdAt: now(),
          notePrefix: "Điều chỉnh giảm thu (sửa đơn)",
        });
      }

      // Sửa đơn từ trạng thái khác sang hoàn tất cũng là một lần "mua hàng
      // thành công". Đơn vốn đã hoàn tất từ trước thì bỏ qua, tránh nhắn lại
      // chỉ vì người dùng sửa ghi chú.
      if (data.status === "completed" && existingStatus !== "completed") {
        await enqueueOrderCompletedZns(data.id);
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

export const createReturnOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    // data: { original_order_id, items: [{product_id, qty, unit_price, discount}], discount, refunded_to_customer, refund_fund_type, refund_bank_account_idx, note, branch_id, customer_id, employee_id }
    const originalRows = await fetchRows<any>("orders", {
      eq: { id: data.original_order_id },
      select: "id, code, customer_id, branch_id, employee_id, total, deposit, paid, payment_method, status",
      limit: 1,
    });
    const originalOrder = originalRows[0];
    if (!originalOrder) throw new Error("Không tìm thấy đơn hàng gốc");

    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const discount = Number(data.discount || 0);
    const total = Math.max(0, subtotal - discount);
    const refundedToCustomer = Number(data.refunded_to_customer || 0);

    // Hình thức chi trả: ưu tiên từ form, fallback theo đơn gốc
    const refundFundType: "tien_mat" | "ngan_hang" =
      data.refund_fund_type === "ngan_hang" ? "ngan_hang" : "tien_mat";
    const refundBankAccountIdx: number | null =
      refundFundType === "ngan_hang" && data.refund_bank_account_idx != null
        ? Number(data.refund_bank_account_idx)
        : null;
    const refundPmLabel =
      refundFundType === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

    // Chi nhánh nhận tiền chi = chi nhánh của đơn hàng gốc
    const branchId = data.branch_id || originalOrder.branch_id;

    // Tạo mã phiếu trả hàng
    // Retry loop to avoid duplicate key race condition for return order code
    let returnCode: string = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const { count: returnCount } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .like("code", "TH%");
      const candidate = "TH" + String((returnCount ?? 0) + 1 + attempt).padStart(6, "0");
      const { data: existingReturn } = await supabase
        .from("orders")
        .select("id")
        .eq("code", candidate)
        .maybeSingle();
      if (!existingReturn) { returnCode = candidate; break; }
    }
    if (!returnCode) {
      const ts = Date.now().toString().slice(-6);
      returnCode = "TH" + ts;
    }

    const returnId = uid();
    const createdAt = now();

    // Tạo đơn trả hàng (status = "returned")
    // Dùng insertRowSafe: nếu DB chưa có cột bank_account_idx (chưa chạy
    // migration v6) thì cột này tự được bỏ qua thay vì làm sập cả phiếu trả.
    await insertRowSafe("orders", {
      id: returnId,
      code: returnCode,
      customer_id: data.customer_id || originalOrder.customer_id || null,
      branch_id: branchId,
      employee_id: data.employee_id || originalOrder.employee_id || null,
      status: "returned",
      subtotal,
      discount,
      total,
      deposit: 0,
      paid: refundedToCustomer,
      payment_method: refundFundType,
      bank_account_idx: refundBankAccountIdx,
      note: data.note ? `[Trả hàng đơn ${originalOrder.code}] ${data.note}` : `[Trả hàng đơn ${originalOrder.code}]`,
      created_at: createdAt,
    });

    for (const it of data.items) {
      const itemTotal = it.qty * it.unit_price - (it.discount || 0);
      await insertRow("order_items", {
        id: uid(),
        order_id: returnId,
        product_id: it.product_id,
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
        discount: Number(it.discount || 0),
        total: itemTotal,
      });
    }

    // Hoàn lại tồn kho
    for (const it of data.items) {
      await adjustStock(it.product_id, branchId, Number(it.qty));
    }

    // ── XỬ LÝ TIỀN HOÀN: tách làm 2 phần rõ ràng ─────────────────────────────
    //
    //   Khách cần nhận lại (total)        = giá trị hàng trả  (vd 6.990.000)
    //   ├─ A) Đã trả lại khách            = refundedToCustomer (vd 5.990.000)
    //   │      → LẬP PHIẾU CHI trong Sổ quỹ (theo đúng hình thức tiền mặt /
    //   │        chuyển khoản đã chọn). Đây là tiền THỰC TẾ ra khỏi quỹ.
    //   └─ B) Phần còn phải trả khách     = total - refundedToCustomer (vd 1.000.000)
    //          → KHÔNG lập phiếu thu/chi. Phần này được TRỪ THẲNG vào CÔNG NỢ:
    //            recalculateCustomerDebt tính debt = ... - totalReturned
    //            + totalPaidBack ..., nên riêng nghiệp vụ trả hàng đóng góp vào
    //            công nợ đúng bằng (−total + refundedToCustomer) = −(phần B).
    //            ⇒ Công nợ khách giảm thêm đúng phần B (hoặc thành số âm = shop
    //              nợ lại khách phần B), mà không sinh thêm chứng từ quỹ nào.
    const customerId = data.customer_id || originalOrder.customer_id;
    const remainingToDebt = Math.max(0, total - refundedToCustomer); // phần B (chỉ để log)

    // 1) Giảm "tổng mua" (total_buy) theo giá trị hàng trả
    if (customerId) {
      const custRows = await fetchRows<{ total_buy: number }>("customers", {
        eq: { id: customerId },
        select: "total_buy",
        limit: 1,
      });
      const currentTotalBuy = custRows[0]?.total_buy ?? 0;
      await updateWhere(
        "customers",
        { total_buy: Math.max(0, currentTotalBuy - total) },
        { id: customerId },
      );
    }

    // 2) A) PHIẾU CHI cho phần tiền THỰC TẾ đã hoàn cho khách.
    //    Số tài khoản ngân hàng (nếu chuyển khoản) được lưu thẳng trên phiếu chi.
    //    Chi nhánh chi tiền = chi nhánh đơn hàng gốc.
    if (refundedToCustomer > 0) {
      await createOrderCashVoucher({
        kind: "chi",
        orderCode: returnCode,
        customerId: customerId || null,
        branchId,
        employeeId: data.employee_id || originalOrder.employee_id || null,
        amount: refundedToCustomer,
        fundType: refundFundType,
        paymentMethodLabel: refundPmLabel,
        bankAccountIdx: refundBankAccountIdx, // lưu ngay khi tạo phiếu, không cần update lại
        createdAt,
        noteOverride: `Hoàn tiền trả hàng ${returnCode} (đơn gốc ${originalOrder.code})`,
      });
    }

    // 3) B) Tính lại CÔNG NỢ về giá trị ĐÚNG (đồng bộ Báo cáo công nợ & Sổ quỹ).
    //    Bước này tự động đưa phần còn phải trả khách vào công nợ — KHÔNG tạo
    //    phiếu thu/chi cho phần đó.
    if (customerId) {
      await recalculateCustomerDebt(customerId);
    }

    // Cập nhật trạng thái đơn gốc thành partially_returned hoặc returned
    await updateWhere("orders", {
      note: originalOrder.note
        ? `${originalOrder.note} | Đã trả hàng: ${returnCode}`
        : `Đã trả hàng: ${returnCode}`,
    }, { id: data.original_order_id });

    await logActivity({
      action: "create_return",
      detail: `Trả hàng ${returnCode} từ đơn ${originalOrder.code}`
        + (refundedToCustomer > 0 ? ` — hoàn ${Number(refundedToCustomer).toLocaleString("vi-VN")}₫ (${refundPmLabel})` : "")
        + (remainingToDebt > 0 ? ` — ghi công nợ ${remainingToDebt.toLocaleString("vi-VN")}₫` : ""),
      employee_id: data.actor_id || data.employee_id || originalOrder.employee_id || null,
    });

    return { ok: true, code: returnCode, id: returnId };
  });
// ════════════════════════════════════════════════════════════════════════════
// XUẤT EXCEL — Báo cáo bán hàng theo bộ lọc đang xem ở trang "Bán hàng".
// ────────────────────────────────────────────────────────────────────────────
// Trả về TOÀN BỘ đơn khớp bộ lọc hiện tại (khoảng ngày + khách / nhân viên /
// chi nhánh / trạng thái / từ khoá) kèm:
//   • tiền đã thu (đặt cọc + thanh toán) và còn lại (công nợ đơn);
//   • nhân viên bán; và DANH SÁCH SẢN PHẨM đã bán (gộp theo sản phẩm).
//
// DÙNG LẠI RPC `search_orders_page` để lấy danh sách id đơn → bảo đảm logic lọc
// và quy ước ngày (đơn hoàn tất theo completed_at, còn lại theo created_at,
// theo giờ VN) GIỐNG HỆT bảng đang hiển thị. Hàm CHỈ ĐỌC, KHÔNG ghi/sửa dữ
// liệu và KHÔNG đụng tới bất kỳ RPC / tính năng nào đang có.
// ════════════════════════════════════════════════════════════════════════════
interface ExportSalesArgs {
  search?: string;
  status?: string;
  branch?: string;
  tab?: "orders" | "reserved";
  branchIds?: string[] | null;
  employee?: string;
  customer?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const getOrdersForExport = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: ExportSalesArgs | undefined }) => {
    // 1) Danh sách đơn khớp bộ lọc — dùng lại RPC (lọc/ngày y hệt UI), lấy hết.
    const { data: rows, error } = await supabase.rpc("search_orders_page", {
      p_search: data?.search || null,
      p_status: data?.status || null,
      p_branch: data?.branch || null,
      p_tab: data?.tab || "orders",
      p_branch_ids:
        data?.branchIds && data.branchIds.length ? data.branchIds : null,
      p_employee: data?.employee || null,
      p_customer: data?.customer || null,
      p_from: data?.fromDate || null,
      p_to: data?.toDate || null,
      p_sort: data?.sortBy || "newest",
      p_limit: 100000, // lấy hết, không phân trang
      p_offset: 0,
    });
    if (error) throw new Error(error.message);

    const baseOrders = (rows ?? []) as any[];
    if (baseOrders.length === 0) {
      return {
        orders: [],
        products: [],
        summary: {
          orderCount: 0,
          totalAmount: 0,
          totalCollected: 0,
          totalRemaining: 0,
        },
      };
    }

    const orderIds = baseOrders.map((o) => o.id);
    const idChunks = chunkArray(orderIds, 300);

    // 2) deposit / paid / employee_id của các đơn (RPC không trả các cột này).
    const orderExtra = new Map<
      string,
      { deposit: number; paid: number; employee_id: string | null }
    >();
    for (const ids of idChunks) {
      const part = await fetchRows<any>("orders", {
        select: "id, deposit, paid, employee_id",
        eq: { id: ids },
      });
      for (const r of part) {
        orderExtra.set(r.id, {
          deposit: Number(r.deposit || 0),
          paid: Number(r.paid || 0),
          employee_id: r.employee_id ?? null,
        });
      }
    }

    // 3) order_items của các đơn (dùng fetchAllRows để vượt giới hạn 1000 dòng).
    const items: any[] = [];
    for (const ids of idChunks) {
      const part = await fetchAllRows<any>("order_items", {
        select: "order_id, product_id, qty, unit_price, discount, total",
        eq: { order_id: ids },
      });
      items.push(...part);
    }

    // 4) Tên + SKU sản phẩm.
    const productIds = Array.from(
      new Set(items.map((it) => it.product_id).filter(Boolean)),
    );
    const productMap = new Map<string, { sku: string; name: string }>();
    for (const ids of chunkArray(productIds, 300)) {
      if (ids.length === 0) continue;
      const part = await fetchRows<any>("products", {
        select: "id, sku, name",
        eq: { id: ids },
      });
      for (const p of part)
        productMap.set(p.id, { sku: p.sku ?? "", name: p.name ?? "" });
    }

    // 5) Tên nhân viên bán.
    const empMap = new Map<string, string>();
    const empIds = Array.from(
      new Set(
        Array.from(orderExtra.values())
          .map((e) => e.employee_id)
          .filter(Boolean) as string[],
      ),
    );
    for (const ids of chunkArray(empIds, 300)) {
      if (ids.length === 0) continue;
      const us = await fetchRows<any>("users", {
        select: "id, full_name",
        eq: { id: ids },
      });
      for (const u of us) empMap.set(u.id, u.full_name ?? "");
    }

    // 6) Gộp đơn + thông tin bổ sung.
    let totalAmount = 0,
      totalCollected = 0,
      totalRemaining = 0;
    const orders = baseOrders.map((o) => {
      const extra =
        orderExtra.get(o.id) ?? { deposit: 0, paid: 0, employee_id: null };
      const total = Number(o.total || 0);
      const collected = extra.deposit + extra.paid;
      const remaining = Math.max(0, total - collected);
      totalAmount += total;
      totalCollected += collected;
      totalRemaining += remaining;
      return {
        id: o.id,
        code: o.code,
        status: o.status,
        date: o.completed_at || o.created_at,
        customer_name: o.customer_name ?? "",
        branch_name: o.branch_name ?? "",
        employee_name: extra.employee_id
          ? empMap.get(extra.employee_id) ?? ""
          : "",
        total,
        deposit: extra.deposit,
        paid: extra.paid,
        collected,
        remaining,
      };
    });

    // 7) Gộp sản phẩm đã bán (theo product_id).
    const prodAgg = new Map<
      string,
      { sku: string; name: string; qty: number; revenue: number }
    >();
    for (const it of items) {
      const key = it.product_id || "__unknown__";
      const info =
        productMap.get(it.product_id) ?? { sku: "", name: "(Không xác định)" };
      const cur =
        prodAgg.get(key) ?? { sku: info.sku, name: info.name, qty: 0, revenue: 0 };
      cur.qty += Number(it.qty || 0);
      cur.revenue += Number(it.total || 0);
      prodAgg.set(key, cur);
    }
    const products = Array.from(prodAgg.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );

    return {
      orders,
      products,
      summary: {
        orderCount: orders.length,
        totalAmount,
        totalCollected,
        totalRemaining,
      },
    };
  },
);