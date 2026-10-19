// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { fetchAllPaged } from "./reports.functions";
import { todayVN } from "./date-vn";
// Cùng cách tính với Sổ quỹ (cash.functions.ts).
import { branchDelta, systemDelta, voucherBranchIds } from "./cash-math";

/**
 * BÁO CÁO 1 NGÀY — mọi chỉ số của một ngày (giờ Việt Nam) trên một màn hình.
 * Chỉ admin (như trang Báo cáo). Lọc được theo chi nhánh.
 *
 * Cách tính (giữ ĐÚNG như các trang gốc để số khớp nhau):
 *   - Doanh thu bán hàng = đơn HOÀN TẤT theo ngày hoàn tất (completed_at; đơn cũ
 *     thiếu thì lấy ngày tạo) − phiếu TRẢ HÀNG tạo trong ngày  (= trang Báo cáo).
 *   - Đơn đặt hàng = đơn đang ở trạng thái "Đặt hàng" (reserved) TẠO trong ngày.
 *     Không có lịch sử trạng thái: đơn đặt hôm nay rồi hoàn tất sau sẽ chuyển
 *     sang "đơn bán hàng" của ngày hoàn tất.
 *   - Quạt / phụ kiện bán ra = số lượng trên đơn hoàn tất trong ngày. Quạt = hàng
 *     "tính vào tổng số hàng hóa" (count_in_total); nhóm "DỊCH VỤ" tách riêng;
 *     còn lại là phụ kiện.
 *   - Tiền thu / chi = phiếu thu / chi ĐANG HIỆU LỰC trong Sổ quỹ tạo trong ngày,
 *     tách tiền mặt / ngân hàng (= "Tổng thu / Tổng chi" ở Sổ quỹ cùng bộ lọc).
 *   - Ca bảo hành mới = phiếu bảo hành có NGÀY GỬI trong ngày.
 *   - Lịch = lịch làm việc có ngày hẹn là ngày đó (không tính lịch đã huỷ).
 */

const db = () => getSupabaseAdmin();
const num = (v: any) => Number(v) || 0;
const chunk = <T,>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function assertAdmin(actorId?: string) {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const { data } = await db().from("users").select("id, is_admin").eq("id", actorId).limit(1);
  if (Number((data ?? [])[0]?.is_admin) !== 1) throw new Error("Chỉ quản trị viên được xem báo cáo ngày");
}

/** Bảng có thể chưa có (chưa chạy migration) → trả rỗng thay vì làm hỏng cả báo cáo. */
async function safe<T>(p: Promise<T[]>, onMissing: () => void): Promise<T[]> {
  try {
    return await p;
  } catch (e: any) {
    if (/does not exist|schema cache/i.test(String(e?.message))) {
      onMissing();
      return [];
    }
    throw e;
  }
}


export async function buildDailyReport(args: { date?: string; branchId?: string }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.date ?? "")) ? String(args.date) : todayVN();
  const branchId = args?.branchId || "";
  const fromTs = `${date}T00:00:00+07:00`;
  const toTs = `${date}T23:59:59.999+07:00`;
  const missing: string[] = [];
  const byBranch = (q: any) => (branchId ? q.eq("branch_id", branchId) : q);
  const ORDER_COLS = "id, code, status, total, deposit, paid, created_at, completed_at, branch_id, employee_id, customer_id, payment_method";

  const [completedA, completedB, reserved, returned, cancelled, vouchers, vTypes, newCustomers, tickets, schedules, branches, users] = await Promise.all([
    fetchAllPaged(() => byBranch(db().from("orders").select(ORDER_COLS).eq("status", "completed").not("completed_at", "is", null).gte("completed_at", fromTs).lte("completed_at", toTs)).order("completed_at", { ascending: true })),
    fetchAllPaged(() => byBranch(db().from("orders").select(ORDER_COLS).eq("status", "completed").is("completed_at", null).gte("created_at", fromTs).lte("created_at", toTs)).order("created_at", { ascending: true })),
    fetchAllPaged(() => byBranch(db().from("orders").select(ORDER_COLS).eq("status", "reserved").gte("created_at", fromTs).lte("created_at", toTs)).order("created_at", { ascending: true })),
    fetchAllPaged(() => byBranch(db().from("orders").select(ORDER_COLS).eq("status", "returned").gte("created_at", fromTs).lte("created_at", toTs)).order("created_at", { ascending: true })),
    fetchAllPaged(() => byBranch(db().from("orders").select("id, total").eq("status", "cancelled").gte("created_at", fromTs).lte("created_at", toTs)).order("created_at", { ascending: true })),
    fetchAllPaged(() => db().from("cash_vouchers").select("id, code, type, fund_type, amount, status, voucher_type_id, branch_id, from_kind, from_id, to_kind, to_id, note, created_at").eq("status", "active").gte("created_at", fromTs).lte("created_at", toTs).order("created_at", { ascending: true })),
    fetchAllPaged(() => db().from("cash_voucher_types").select("id, name").order("name")),
    fetchAllPaged(() => db().from("customers").select("id, name, phone, group_name, company_name, source, created_at").gte("created_at", fromTs).lte("created_at", toTs).order("created_at", { ascending: true })),
    safe(fetchAllPaged(() => byBranch(db().from("warranty_tickets").select("id, code, kind, stage, customer_name, product_model, branch_id, sent_date").gte("sent_date", fromTs).lte("sent_date", toTs)).order("sent_date", { ascending: true })), () => missing.push("warranty")),
    fetchAllPaged(() => byBranch(db().from("schedules").select("id, title, type, status, scheduled_date, scheduled_time, branch_id, customer_id").gte("scheduled_date", date).lte("scheduled_date", `${date}T23:59:59`).neq("status", "cancelled")).order("scheduled_time", { ascending: true })),
    fetchAllPaged(() => db().from("branches").select("id, name").order("name")),
    fetchAllPaged(() => db().from("users").select("id, full_name").order("full_name")),
  ]);
  const completed = [...completedA, ...completedB];

  // ── Số lượng hàng bán ra (đơn hoàn tất) và trả lại ────────────────────────
  const itemsOf = async (ids: string[]) => {
    const out: any[] = [];
    for (const part of chunk(ids)) {
      const { data, error } = await db().from("order_items").select("order_id, product_id, qty, total").in("order_id", part);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
    }
    return out;
  };
  const [soldItems, returnItems] = await Promise.all([itemsOf(completed.map((o) => o.id)), itemsOf(returned.map((o) => o.id))]);
  const productIds = [...new Set([...soldItems, ...returnItems].map((i) => i.product_id).filter(Boolean))];
  const products = new Map<string, any>();
  for (const part of chunk(productIds)) {
    let r = await db().from("products").select("id, name, sku, category_id, count_in_total").in("id", part);
    if (r.error) r = await db().from("products").select("id, name, sku, category_id").in("id", part);
    for (const p of r.data ?? []) products.set(p.id, p);
  }
  const { data: cats } = await db().from("categories").select("id, name");
  const serviceCats = new Set(((cats ?? []) as any[]).filter((c) => String(c.name).trim().toUpperCase() === "DỊCH VỤ").map((c) => c.id));
  const kindOf = (pid: string) => {
    const p = products.get(pid);
    if (p && serviceCats.has(p.category_id)) return "service";
    return p?.count_in_total === false ? "accessory" : "fan";
  };
  const units = { fan: 0, accessory: 0, service: 0, fanReturned: 0, accessoryReturned: 0 };
  const soldBy = new Map<string, { product_id: string; name: string; kind: string; qty: number; amount: number }>();
  for (const it of soldItems) {
    const k = kindOf(it.product_id);
    units[k] += num(it.qty);
    const row = soldBy.get(it.product_id) ?? { product_id: it.product_id, name: products.get(it.product_id)?.name ?? "(hàng đã xoá)", kind: k, qty: 0, amount: 0 };
    row.qty += num(it.qty);
    row.amount += num(it.total);
    soldBy.set(it.product_id, row);
  }
  for (const it of returnItems) {
    const k = kindOf(it.product_id);
    if (k === "fan") units.fanReturned += num(it.qty);
    else if (k === "accessory") units.accessoryReturned += num(it.qty);
  }

  // ── Tên khách của các đơn ─────────────────────────────────────────────────
  const custIds = [...new Set([...completed, ...reserved, ...returned].map((o) => o.customer_id).filter(Boolean))];
  const custById = new Map<string, any>();
  for (const part of chunk(custIds)) {
    const { data } = await db().from("customers").select("id, name, company_name").in("id", part);
    for (const c of data ?? []) custById.set(c.id, c);
  }
  const branchName = new Map<string, string>(branches.map((b: any) => [b.id, b.name]));
  const userName = new Map<string, string>(users.map((u: any) => [u.id, u.full_name]));
  const orderRow = (o: any) => ({
    id: o.id, code: o.code, status: o.status, total: num(o.total), collected: num(o.deposit) + num(o.paid),
    customer_name: custById.get(o.customer_id)?.name ?? "Khách lẻ",
    customer_company: custById.get(o.customer_id)?.company_name || null,
    branch_name: branchName.get(o.branch_id) ?? "",
    employee_name: userName.get(o.employee_id) ?? "",
  });
  const sum = (rows: any[], f = (x: any) => num(x.total)) => rows.reduce((s, x) => s + f(x), 0);

  // ── Sổ quỹ: thu / chi theo tiền mặt / ngân hàng ───────────────────────────
  const typeName = new Map<string, string>(vTypes.map((t: any) => [t.id, t.name]));
  const cash = {
    thu: { tien_mat: 0, ngan_hang: 0, total: 0, count: 0 },
    chi: { tien_mat: 0, ngan_hang: 0, total: 0, count: 0 },
    internalThu: 0, internalChi: 0,
  };
  const byType = new Map<string, { type: string; name: string; count: number; amount: number; vouchers: any[] }>();
  const inScope = vouchers.filter((v: any) => !branchId || voucherBranchIds(v).includes(branchId));
  for (const v of inScope) {
    // Có lọc: mức cộng / trừ quỹ của chi nhánh đó. Không lọc: tác động lên toàn công ty
    // (chuyển tiền giữa hai chi nhánh = 0 → không tính là thu hay chi).
    const delta = branchId ? branchDelta(v, branchId) : systemDelta(v);
    if (!delta) continue;
    const side = delta > 0 ? cash.thu : cash.chi;
    const amt = Math.abs(delta);
    const fund = v.fund_type === "ngan_hang" ? "ngan_hang" : "tien_mat";
    side[fund] += amt;
    side.total += amt;
    side.count++;
    const name = typeName.get(v.voucher_type_id) ?? "(chưa phân loại)";
    // Chuyển tiền giữa các quỹ / chi nhánh: có trong tổng (để khớp Sổ quỹ) nhưng nêu riêng.
    if ((v.from_kind === "branch" && v.to_kind === "branch") || /chuyển quỹ nội bộ/i.test(name)) {
      if (delta > 0) cash.internalThu += amt;
      else cash.internalChi += amt;
    }
    const key = `${delta > 0 ? "thu" : "chi"}|${name}`;
    const row = byType.get(key) ?? { type: delta > 0 ? "thu" : "chi", name, count: 0, amount: 0, vouchers: [] };
    row.count++;
    row.amount += amt;
    // Từng phiếu để bấm mở trong Sổ quỹ.
    row.vouchers.push({ id: v.id, code: v.code, amount: amt, fund, note: String(v.note ?? "").slice(0, 120), created_at: v.created_at });
    byType.set(key, row);
  }

  // ── Lịch làm việc theo loại ───────────────────────────────────────────────
  const sched: Record<string, { total: number; done: number }> = {};
  for (const s of schedules) {
    const r = (sched[s.type] ??= { total: 0, done: 0 });
    r.total++;
    if (s.status === "done") r.done++;
  }

  const salesTotal = sum(completed);
  const returnsTotal = sum(returned);
  return {
    date,
    branchId,
    branches,
    missing,
    revenue: { net: salesTotal - returnsTotal, sales: salesTotal, returns: returnsTotal, returnCount: returned.length },
    sales: { count: completed.length, total: salesTotal, collected: sum(completed, (o) => num(o.deposit) + num(o.paid)) },
    reserved: { count: reserved.length, total: sum(reserved), deposit: sum(reserved, (o) => num(o.deposit) + num(o.paid)) },
    cancelled: { count: cancelled.length, total: sum(cancelled) },
    units,
    newCustomers: { count: newCustomers.length, rows: newCustomers.slice(0, 50) },
    warranty: { count: tickets.length, retail: tickets.filter((t: any) => t.kind !== "dealer").length, dealer: tickets.filter((t: any) => t.kind === "dealer").length, rows: tickets.slice(0, 50) },
    schedules: {
      total: schedules.length, byType: sched,
      rows: schedules.slice(0, 80).map((s: any) => ({ id: s.id, title: s.title, type: s.type, status: s.status, time: s.scheduled_time, branch_name: branchName.get(s.branch_id) ?? "" })),
    },
    cash: { ...cash, byType: [...byType.values()].sort((a, b) => b.amount - a.amount) },
    orders: {
      completed: completed.map(orderRow).sort((a, b) => b.total - a.total).slice(0, 100),
      reserved: reserved.map(orderRow).sort((a, b) => b.total - a.total).slice(0, 100),
      returned: returned.map(orderRow).slice(0, 50),
    },
    topProducts: [...soldBy.values()].filter((p) => p.kind !== "service").sort((a, b) => b.qty - a.qty).slice(0, 15),
  };
}

export const getDailyReportFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; date?: string; branchId?: string } }) => {
    await assertAdmin(data?.actorId);
    return buildDailyReport({ date: data?.date, branchId: data?.branchId });
  },
);
