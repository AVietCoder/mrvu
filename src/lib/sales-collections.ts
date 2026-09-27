// @ts-nocheck
import { getSupabaseAdmin } from "./zalo/admin-client";
import { fetchAllPaged } from "./reports.functions";

/**
 * DOANH THU THỰC THU THEO NGƯỜI BÁN trong một tháng (giờ VN) — nền cho
 * DS bán hàng / DS kinh doanh.
 *
 * "Thực thu" = tiền THU VÀO trong tháng (theo ngày lập phiếu thu), gán cho
 * người bán (orders.employee_id) như sau:
 *
 *  1. Phiếu thu tại đơn — nội dung "Thanh toán đơn <mã>" / "Đặt cọc đơn <mã>"
 *     / "Thu từ đơn <mã>" (do luồng đơn hàng tự tạo) → người bán đơn đó.
 *  2. Phiếu hoàn tiền trả hàng — "Hoàn tiền trả hàng … (đơn gốc <mã>)" → TRỪ
 *     vào người bán đơn gốc.
 *  3. Phiếu thu gắn KHÁCH HÀNG nhưng không ghi mã đơn = khách trả nợ → trừ vào
 *     các đơn còn nợ CŨ NHẤT của khách đó trước (FIFO, tính trên toàn bộ lịch
 *     sử trả nợ của khách), rồi tính cho người bán các đơn ấy. Phần trả dư
 *     (khách trả nhiều hơn số nợ theo đơn — vd nợ đầu kỳ nhập tay) không gán
 *     được cho ai → ghi vào `unattributed`.
 *  4. Phiếu thu không gắn khách, không ghi mã đơn → không gán được → `unattributed`.
 *
 * "Nợ theo đơn" = tổng tiền − cọc − đã trả của các đơn HOÀN TẤT (cọc / trả tại
 * đơn đã là phiếu loại 1 nên không tính lại).
 */

const ORDER_NOTE_RE = /(?:Thanh toán đơn|Đặt cọc đơn|Thu từ đơn)\s+([A-Za-z0-9_-]+)/i;
const REFUND_NOTE_RE = /\(đơn gốc\s+([A-Za-z0-9_-]+)\)/i;

export type CollectionLine = {
  date: string;
  kind: "order" | "debt" | "refund";
  order_code: string | null;
  customer_name: string | null;
  voucher_code: string;
  amount: number;
};

export type SellerCollections = {
  bySeller: Map<string, { total: number; lines: CollectionLine[] }>;
  unattributed: number;
};

const num = (v: any) => Number(v) || 0;
const chunk = <T,>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const ts = (d: any) => Date.parse(String(d ?? "")) || 0;
const customerOf = (v: any) => (v.from_kind === "customer" ? v.from_id : null) || v.payer_customer_id || null;

export async function sellerCollections(month: string): Promise<SellerCollections> {
  const [y, m] = month.split("-").map(Number);
  const fromTs = `${month}-01T00:00:00+07:00`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const nextTs = `${next}-01T00:00:00+07:00`;
  const fromMs = Date.parse(fromTs);
  const nextMs = Date.parse(nextTs);
  const db = getSupabaseAdmin();
  const SEL = "id, code, type, amount, note, created_at, from_kind, from_id, payer_customer_id";

  const vouchers = await fetchAllPaged(() =>
    db.from("cash_vouchers").select(SEL).eq("status", "active").gte("created_at", fromTs).lt("created_at", nextTs),
  );

  const bySeller = new Map<string, { total: number; lines: CollectionLine[] }>();
  let unattributed = 0;
  const add = (seller: string | null, line: CollectionLine) => {
    if (!seller) {
      unattributed += line.amount;
      return;
    }
    const r = bySeller.get(seller) ?? { total: 0, lines: [] };
    r.total += line.amount;
    r.lines.push(line);
    bySeller.set(seller, r);
  };

  // Phân loại phiếu trong tháng
  const orderReceipts: any[] = [];
  const refunds: any[] = [];
  const debtCustomers = new Set<string>();
  for (const v of vouchers) {
    if (v.type === "thu") {
      const mm = String(v.note ?? "").match(ORDER_NOTE_RE);
      if (mm) orderReceipts.push({ ...v, order_code: mm[1] });
      else if (customerOf(v)) debtCustomers.add(customerOf(v));
      else unattributed += num(v.amount);
    } else if (v.type === "chi") {
      const mm = String(v.note ?? "").match(REFUND_NOTE_RE);
      if (mm) refunds.push({ ...v, order_code: mm[1] });
    }
  }

  // Tra đơn theo mã (người bán + khách)
  const codes = [...new Set([...orderReceipts, ...refunds].map((v) => v.order_code))];
  const orderByCode = new Map<string, any>();
  for (const part of chunk(codes)) {
    const { data } = await db.from("orders").select("code, employee_id, customer_id").in("code", part);
    for (const o of data ?? []) orderByCode.set(o.code, o);
  }

  // ── Khách trả nợ: FIFO trên toàn bộ lịch sử của các khách có trả nợ trong tháng ──
  // Nợ còn lại của mỗi đơn tính theo PHIẾU THU CÒN HIỆU LỰC ghi mã đơn đó (không
  // tin cột cọc/đã trả trên đơn: thực tế có phiếu cọc bị huỷ rồi thu lại bằng
  // chuyển khoản không ghi mã đơn, trong khi đơn vẫn ghi "đã cọc"). Chỉ đơn cũ
  // CHƯA TỪNG có phiếu thu nào (dữ liệu trước khi có sổ quỹ) mới dùng cột cọc/đã trả.
  const custIds = [...debtCustomers];
  const ordersByCust = new Map<string, any[]>();
  const receiptsByCust = new Map<string, any[]>();
  const push = (m: Map<string, any[]>, k: string, v: any) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  const RSEL = `${SEL}, status`;
  for (const part of chunk(custIds)) {
    const [os, p1, p2] = await Promise.all([
      fetchAllPaged(() =>
        db.from("orders")
          .select("id, code, customer_id, employee_id, total, deposit, paid, completed_at, created_at")
          // Cả đơn đặt hàng: khách hay trả trước cho đơn chưa giao.
          .in("status", ["completed", "reserved"])
          .in("customer_id", part)
          .lt("created_at", nextTs),
      ),
      fetchAllPaged(() =>
        db.from("cash_vouchers").select(RSEL).eq("type", "thu")
          .eq("from_kind", "customer").in("from_id", part).lt("created_at", nextTs),
      ),
      fetchAllPaged(() =>
        db.from("cash_vouchers").select(RSEL).eq("type", "thu")
          .in("payer_customer_id", part).lt("created_at", nextTs),
      ),
    ]);
    for (const o of os) push(ordersByCust, o.customer_id, o);
    const seen = new Set<string>();
    for (const v of [...p1, ...p2]) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const c = customerOf(v);
      if (c) push(receiptsByCust, c, v);
    }
  }

  const custNames = new Map<string, string>();
  for (const part of chunk(custIds)) {
    const { data } = await db.from("customers").select("id, name").in("id", part);
    for (const c of data ?? []) custNames.set(c.id, c.name);
  }

  for (const c of custIds) {
    const receipts = receiptsByCust.get(c) ?? [];
    const codedActive = new Map<string, number>(); // mã đơn → tổng phiếu thu còn hiệu lực
    const everCoded = new Set<string>();           // mã đơn từng có phiếu thu (kể cả đã huỷ)
    const debtPays: any[] = [];
    for (const v of receipts) {
      const mm = String(v.note ?? "").match(ORDER_NOTE_RE);
      if (mm) {
        everCoded.add(mm[1]);
        if (v.status === "active") codedActive.set(mm[1], (codedActive.get(mm[1]) ?? 0) + num(v.amount));
      } else if (v.status === "active") {
        debtPays.push(v);
      }
    }
    const queue = (ordersByCust.get(c) ?? [])
      .map((o) => {
        const paidAtOrder = everCoded.has(o.code) ? codedActive.get(o.code) ?? 0 : num(o.deposit) + num(o.paid);
        return { ...o, remaining: Math.max(0, num(o.total) - paidAtOrder) };
      })
      .filter((o) => o.remaining > 0)
      .sort((a, b) => ts(a.completed_at || a.created_at) - ts(b.completed_at || b.created_at));
    debtPays.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    let qi = 0;
    for (const p of debtPays) {
      let left = num(p.amount);
      const inMonth = ts(p.created_at) >= fromMs && ts(p.created_at) < nextMs;
      while (left > 0 && qi < queue.length) {
        const o = queue[qi];
        const use = Math.min(left, o.remaining);
        o.remaining -= use;
        left -= use;
        if (inMonth) {
          add(o.employee_id || null, {
            date: p.created_at, kind: "debt", order_code: o.code, customer_name: custNames.get(c) ?? null,
            voucher_code: p.code, amount: use,
          });
        }
        if (o.remaining <= 0) qi++;
      }
      if (left > 0 && inMonth) unattributed += left;
    }
  }

  for (const v of orderReceipts) {
    const o = orderByCode.get(v.order_code);
    add(o?.employee_id || null, {
      date: v.created_at, kind: "order", order_code: v.order_code, customer_name: null,
      voucher_code: v.code, amount: num(v.amount),
    });
  }
  for (const v of refunds) {
    const o = orderByCode.get(v.order_code);
    add(o?.employee_id || null, {
      date: v.created_at, kind: "refund", order_code: v.order_code, customer_name: null,
      voucher_code: v.code, amount: -num(v.amount),
    });
  }

  for (const r of bySeller.values()) r.lines.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { bySeller, unattributed };
}
