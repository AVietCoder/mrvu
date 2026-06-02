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
  logActivity,
} from "./supabase";

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
  // Xóa tất cả phiếu thu/chi liên quan đến mã đơn hàng này
  const { data: vouchers } = await supabase
    .from("cash_vouchers")
    .select("id, code, note")
    .like("note", `%${orderCode}%`);
  if (vouchers && vouchers.length > 0) {
    for (const v of vouchers) {
      await deleteWhere("cash_vouchers", { id: v.id }).catch(() => undefined);
    }
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

async function autoCreateReceiptForOrder({
  orderCode,
  customerId,
  branchId,
  employeeId,
  amount,
  fundType,
  paymentMethodLabel,
  createdAt,
  notePrefix,
}: {
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
  if (!amount || amount <= 0) return null;
  const code = await nextCashCode("thu");
  const label = notePrefix ?? "Thu từ đơn";
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
    note: `${label} ${orderCode} — Hình thức: ${paymentMethodLabel}`,
    accounting: true,
    status: "active",
    created_by: employeeId || null,
    created_at: createdAt,
  });
  return voucher;
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const [orders, items, products, customers, employees, branches, schedules, schedule_assignments, users, stock] =
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
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchAllRows("stock"),
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
    stock,
  };
});

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
  .handler(async ({ data }: { data: { id: string; status: string; paid?: number; payment_method?: string; actor_id?: string } }) => {
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

    // effectivePaid = paid mới từ UI hoặc giá trị cũ trong DB
    const effectivePaid = typeof data.paid === "number" ? data.paid : Number(currentOrder.paid || 0);
    const effectivePaymentMethod: "tien_mat" | "ngan_hang" =
      (data.payment_method === "ngan_hang" || (!data.payment_method && currentOrder.payment_method === "ngan_hang"))
        ? "ngan_hang" : "tien_mat";

    if (data.status === "completed" && currentOrder.status !== "completed") {
      // ✅ Truyền effectivePaid thay vì currentOrder.paid (đọc trước khi updateWhere)
      await applyCompletedOrderSideEffects({ ...currentOrder, paid: effectivePaid }, currentItems as any);

      // Tạo phiếu thu = đúng số tiền khách trả lần này (effectivePaid)
      // Phần còn thiếu (nếu có) sẽ tự động cộng vào công nợ qua applyCompletedOrderSideEffects
      const paymentMethod = effectivePaymentMethod;
      const paymentMethodLabel =
        paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt";

      await autoCreateReceiptForOrder({
        orderCode: currentOrder.code,
        customerId: currentOrder.customer_id || null,
        branchId: currentOrder.branch_id,
        employeeId: currentOrder.employee_id || null,
        amount: effectivePaid,
        fundType: paymentMethod,
        paymentMethodLabel,
        createdAt: now(),
        notePrefix: "Hoàn tất đơn",
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
      await logActivity({ action: "complete_order", detail: `Hoàn tất đơn ${currentOrder.code}` });
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
      await logActivity({ action: "cancel_order", detail: `Hủy đơn ${currentOrder.code} — đã rollback phiếu thu chi` });
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

        // Nếu chuyển sang completed từ trạng thái khác → tạo phiếu thu phần còn lại
        if (existingStatus !== "completed") {
          const remaining = Math.max(0, total - Number(data.deposit || 0) - Number(data.paid || 0));
          await autoCreateReceiptForOrder({
            orderCode: existingOrder.code,
            customerId: data.customer_id || null,
            branchId: data.branch_id,
            employeeId: data.employee_id || null,
            amount: remaining,
            fundType: paymentMethod,
            paymentMethodLabel:
              paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt",
            createdAt: now(),
            notePrefix: "Hoàn tất đơn",
          });
        }
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
    // data: { original_order_id, items: [{product_id, qty, unit_price, discount}], discount, refunded_to_customer, note, branch_id, customer_id, employee_id }
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
    await insertRow("orders", {
      id: returnId,
      code: returnCode,
      customer_id: data.customer_id || originalOrder.customer_id || null,
      branch_id: data.branch_id || originalOrder.branch_id,
      employee_id: data.employee_id || originalOrder.employee_id || null,
      status: "returned",
      subtotal,
      discount,
      total,
      deposit: 0,
      paid: refundedToCustomer,
      payment_method: originalOrder.payment_method || "tien_mat",
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
    const branchId = data.branch_id || originalOrder.branch_id;
    for (const it of data.items) {
      await adjustStock(it.product_id, branchId, Number(it.qty));
    }

    // Cập nhật công nợ khách hàng (giảm total_buy, giảm debt)
    const customerId = data.customer_id || originalOrder.customer_id;
    if (customerId) {
      const custRows = await fetchRows<{ debt: number; total_buy: number }>("customers", {
        eq: { id: customerId },
        select: "debt, total_buy",
        limit: 1,
      });
      const currentDebt = custRows[0]?.debt ?? 0;
      const currentTotalBuy = custRows[0]?.total_buy ?? 0;
      await updateWhere("customers", {
        total_buy: Math.max(0, currentTotalBuy - total),
        debt: Math.max(0, currentDebt - total),
      }, { id: customerId });
    }

    // Tạo phiếu chi nếu đã trả tiền cho khách
    if (refundedToCustomer > 0) {
      const cashCode = await nextCashCode("chi");
      const pm = originalOrder.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat";
      await insertRow("cash_vouchers", {
        id: uid(),
        code: cashCode,
        type: "chi",
        fund_type: pm,
        branch_id: branchId,
        amount: refundedToCustomer,
        voucher_type_id: null,
        collector_user_id: data.employee_id || originalOrder.employee_id || null,
        payer_customer_id: null,
        payer_user_id: null,
        receiver_customer_id: customerId || null,
        note: `Hoàn tiền trả hàng ${returnCode} (đơn gốc ${originalOrder.code})`,
        accounting: true,
        status: "active",
        created_by: data.employee_id || originalOrder.employee_id || null,
        created_at: createdAt,
      });
    }

    // Cập nhật trạng thái đơn gốc thành partially_returned hoặc returned
    // (đơn gốc vẫn giữ nguyên trạng thái, chỉ ghi chú)
    await updateWhere("orders", {
      note: originalOrder.note
        ? `${originalOrder.note} | Đã trả hàng: ${returnCode}`
        : `Đã trả hàng: ${returnCode}`,
    }, { id: data.original_order_id });

    await logActivity({ action: "create_return", detail: `Trả hàng ${returnCode} từ đơn ${originalOrder.code}` });

    return { ok: true, code: returnCode, id: returnId };
  });
