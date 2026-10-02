// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { normalizePhoneForStorage } from "./zalo/phone";
import { uid, now, logActivity } from "./supabase";
import {
  FACTORY_RETURN_STATUSES,
  FACTORY_SOLUTIONS,
  OPEN_WARRANTY_STAGES,
  WARRANTY_FAULT_PARTS,
  WARRANTY_FINAL_ACTIONS,
  WARRANTY_ISSUE_TYPES,
  WARRANTY_STAGES,
} from "./types";
import { warrantyState, vnDay as vnDayOf, DEFAULT_WARRANTY_MONTHS, DEFAULT_MOTOR_MONTHS } from "./warranty-rules";

/**
 * QUẢN LÝ BẢO HÀNH (migration v23).
 *
 *   - warranty_tickets : phiếu bảo hành của KHÁCH LẺ (kind = retail) và ĐẠI LÝ
 *                        (kind = dealer). Mã BH-YYYYMMDD-NNN.
 *   - factory_claims   : yêu cầu bảo hành hàng lỗi gửi NHÀ MÁY. Mã NM-YYYYMM-NNN.
 *   - warranty_activities : lịch sử xử lý + trao đổi nội bộ.
 *
 * Quyền (kiểm ở server — các bảng bật RLS deny-all):
 *   - Phiếu khách lẻ / đại lý: nhân viên CHỈ xem / xử lý phiếu thuộc chi nhánh
 *     mình được gán (user_branches). Admin thấy hết. Xoá phiếu: admin.
 *   - Nhà máy (danh mục, yêu cầu, báo cáo) + cài đặt hạn bảo hành: CHỈ admin.
 *
 * Hạn bảo hành HAI MỨC theo mẫu (v24): động cơ (`warranty_motor_months`, mặc định
 * 120 tháng) và phụ kiện (`warranty_months`, mặc định 12). Phiếu chọn "bộ phận
 * lỗi" (`fault_part`) để biết tính theo mức nào. Còn hạn / hết hạn KHÔNG lưu —
 * xem `warrantyState` trong warranty-rules.ts (so với ngày gửi, giờ VN).
 */

const DEALER_GROUP = "dai_ly";
const RESPONSE_SLA_HOURS = 24;
const DEFAULT_MONTHS = DEFAULT_WARRANTY_MONTHS;
const DEFAULT_MOTOR = DEFAULT_MOTOR_MONTHS;
const DEFAULT_FACTORY_SLA_DAYS = 14;
const db = () => getSupabaseAdmin();
const vnDay = (ts: any) => vnDayOf(ts);
const todayVN = () => vnDay(Date.now());
const digits = (p: any) => String(p ?? "").replace(/\D/g, "");
const text = (v: any) => String(v ?? "").trim();
const isDate = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
const safeLike = (v: string) => v.replace(/[,()%*]/g, " ").trim();

type Scope = { actorId: string; isAdmin: boolean; branchIds: Set<string>; perms: Set<string> };

async function scopeOf(actorId?: string): Promise<Scope> {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const [uRes, bRes, pRes] = await Promise.all([
    db().from("users").select("id, is_admin").eq("id", actorId).limit(1),
    db().from("user_branches").select("branch_id").eq("user_id", actorId),
    db().from("user_permissions").select("permission").eq("user_id", actorId),
  ]);
  const u = (uRes.data ?? [])[0];
  if (!u) throw new Error("Người dùng không tồn tại");
  return {
    actorId,
    isAdmin: Number(u.is_admin) === 1,
    branchIds: new Set(((bRes.data ?? []) as any[]).map((b) => b.branch_id)),
    perms: new Set(((pRes.data ?? []) as any[]).map((p) => p.permission)),
  };
}

const canSee = (s: Scope, t: any) => s.isAdmin || s.branchIds.has(t.branch_id);
function assertAdmin(s: Scope) {
  if (!s.isAdmin) throw new Error("Chỉ quản trị viên được quản lý bảo hành với nhà máy và cài đặt bảo hành");
}
function applyScope(q: any, s: Scope) {
  if (s.isAdmin) return q;
  const ids = [...s.branchIds];
  // Chưa được gán chi nhánh nào → không thấy phiếu nào.
  return ids.length ? q.in("branch_id", ids) : q.eq("id", "__khong_co_chi_nhanh__");
}

const NOT_MIGRATED = "Chưa chạy sql_migration_v23_warranty.sql";
const isMissingTable = (error: any) =>
  !!error &&
  /warranty_tickets|factory_claims|warranty_activities|factories|warranty_months|issue_type/.test(error.message ?? "") &&
  /does not exist|schema cache/i.test(error.message ?? "");
function tableError(error: any) {
  if (!error) return;
  throw new Error(isMissingTable(error) ? NOT_MIGRATED : error.message);
}

// Cột của migration v24 (hạn động cơ + bộ phận lỗi) được đọc / ghi RIÊNG để mọi
// thứ vẫn chạy khi v24 chưa chạy (lúc đó chỉ thiếu mức "động cơ").
const isMissingV24 = (error: any) =>
  !!error && /warranty_motor_months|fault_part/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
async function saveV24(id: string, patch: { fault_part: string | null; warranty_motor_months: number }) {
  const { error } = await db().from("warranty_tickets").update(patch).eq("id", id);
  if (error && !isMissingV24(error)) throw new Error(error.message);
}

/** Đọc hết (PostgREST giới hạn 1000 dòng / lần). `build` phải có ORDER BY ổn định. */
async function fetchAll(build: () => any) {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build().range(off, off + 999);
    tableError(error);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** "YYYY-MM-DDTHH:mm" (giờ VN, từ ô datetime-local) / "YYYY-MM-DD" / ISO có múi giờ → ISO. */
function parseVN(v: any): string | null {
  const s = text(v);
  if (!s) return null;
  let iso = s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = `${s}T00:00:00+07:00`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) iso = `${s}:00+07:00`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) iso = `${s}+07:00`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Ngày giờ không hợp lệ: ${s}`);
  return new Date(t).toISOString();
}

function decorateTicket(t: any) {
  const st = warrantyState(t);
  const open = OPEN_WARRANTY_STAGES.includes(t.stage);
  const waitedMs = Date.now() - Date.parse(t.sent_date);
  return {
    ...t,
    ...st,
    // SLA: quá 24h kể từ ngày gửi mà chưa có ngày phản hồi.
    overdue: open && !t.response_date && waitedMs > RESPONSE_SLA_HOURS * 3600_000,
    hours_waiting: !t.response_date ? Math.max(0, Math.floor(waitedMs / 3600_000)) : null,
  };
}

function decorateClaim(c: any, factoryById: Map<string, any>) {
  const sol = FACTORY_SOLUTIONS.find((x) => x.key === c.factory_solution);
  const f = factoryById.get(c.factory_id);
  const sla = Number(f?.sla_days) > 0 ? Number(f.sla_days) : DEFAULT_FACTORY_SLA_DAYS;
  // "Chờ nhà máy trả hàng": nhà máy nhận đổi mới nhưng chưa gửi trả.
  const awaiting = Boolean(sol?.accept) && c.return_status === "waiting";
  const since = c.solution_at ? Date.parse(c.solution_at) : NaN;
  const days = awaiting && !Number.isNaN(since) ? Math.max(0, Math.floor((Date.now() - since) / 86400_000)) : 0;
  return { ...c, factory_name: f?.name ?? null, sla_days: sla, awaiting, days_waiting: days, overdue: awaiting && days > sla };
}

/** Mã tự sinh: tiền tố + số thứ tự 3 chữ số (tăng theo mã lớn nhất cùng tiền tố). */
async function nextCode(table: string, prefix: string) {
  const { data, error } = await db().from(table).select("code").like("code", `${prefix}%`).order("code", { ascending: false }).limit(1);
  tableError(error);
  const last = Number(String((data ?? [])[0]?.code ?? "").slice(prefix.length)) || 0;
  return `${prefix}${String(last + 1).padStart(3, "0")}`;
}
async function insertWithCode(table: string, prefix: string, row: any) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = await nextCode(table, prefix);
    const { error } = await db().from(table).insert({ ...row, code });
    if (!error) return code;
    // Hai người tạo cùng lúc trùng mã → lấy số kế tiếp rồi thử lại.
    if (error.code === "23505" && /code/.test(`${error.message} ${error.details ?? ""}`)) continue;
    tableError(error);
  }
  throw new Error("Không tạo được mã phiếu, vui lòng thử lại");
}

async function addActivity(target: { ticketId?: string; claimId?: string }, userId: string | null, kind: string, content: string) {
  await db().from("warranty_activities").insert({
    id: uid(), ticket_id: target.ticketId ?? null, claim_id: target.claimId ?? null, at: now(), user_id: userId, kind, content,
  });
}

async function loadTicket(id: string) {
  const { data, error } = await db().from("warranty_tickets").select("*").eq("id", id).limit(1);
  tableError(error);
  const t = (data ?? [])[0];
  if (!t) throw new Error("Không tìm thấy phiếu bảo hành");
  return t;
}
async function loadClaim(id: string) {
  const { data, error } = await db().from("factory_claims").select("*").eq("id", id).limit(1);
  tableError(error);
  const c = (data ?? [])[0];
  if (!c) throw new Error("Không tìm thấy yêu cầu bảo hành nhà máy");
  return c;
}

const CUSTOMER_COLS = "id, name, phone, company_name, group_name, address, ward, district, province";
const fullAddress = (c: any) => [c?.address, c?.ward, c?.district, c?.province].filter(Boolean).join(", ");

/** Tìm khách hàng theo SĐT (đã chuẩn hoá). Khớp đúng trước, rồi khớp theo 9 số cuối. */
async function customerByPhone(phone?: string | null) {
  const d = digits(phone);
  if (d.length < 9) return null;
  const { data: exact } = await db().from("customers").select(CUSTOMER_COLS).eq("phone", phone).limit(1);
  if (exact?.length) return exact[0];
  const { data: loose } = await db().from("customers").select(CUSTOMER_COLS).ilike("phone", `%${d.slice(-9)}%`).limit(3);
  return (loose ?? []).find((c: any) => digits(c.phone).endsWith(d.slice(-9))) ?? null;
}

async function productInfo(id?: string | null) {
  if (!id) return null;
  // Thiếu cột (chưa chạy v24 / v23) → lùi dần, vẫn đọc được tên mẫu.
  for (const cols of ["id, name, sku, warranty_months, warranty_motor_months", "id, name, sku, warranty_months", "id, name, sku"]) {
    const r = await db().from("products").select(cols).eq("id", id).limit(1);
    if (!r.error) return (r.data ?? [])[0] ?? null;
  }
  return null;
}

function cleanMedia(list: any): { url: string; kind: string; name: string }[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => ({
      url: text(m?.url),
      kind: ["image", "video", "link"].includes(m?.kind) ? m.kind : "link",
      name: text(m?.name).slice(0, 200),
    }))
    .filter((m) => /^https?:\/\//i.test(m.url))
    .slice(0, 30);
}

// ═══════════════════════════════════════════════════════════════════════════
// Danh mục cho form
// ═══════════════════════════════════════════════════════════════════════════

export const getWarrantyMetaFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  const s = await scopeOf(data?.actorId);
  const [br, us, ub, up, pr, fa] = await Promise.all([
    db().from("branches").select("id, name").order("name"),
    db().from("users").select("id, full_name, position_id, active, is_admin").order("full_name"),
    db().from("user_branches").select("user_id, branch_id"),
    db().from("user_permissions").select("user_id").eq("permission", "technician"),
    db().from("products").select("id, name, sku, is_hidden, warranty_months").order("name"),
    s.isAdmin ? db().from("factories").select("*").order("name") : Promise.resolve({ data: [] }),
  ]);
  const migrated = !pr.error && !(fa as any).error;
  const pr24 = await db().from("products").select("id, warranty_motor_months");
  const motorOf = new Map<string, number>(((pr24.data ?? []) as any[]).map((p) => [p.id, Number(p.warranty_motor_months)]));
  const products = (pr.error ? ((await db().from("products").select("id, name, sku").order("name")).data ?? []) : (pr.data ?? [])) as any[];
  const userBranches = new Map<string, string[]>();
  for (const r of (ub.data ?? []) as any[]) userBranches.set(r.user_id, [...(userBranches.get(r.user_id) ?? []), r.branch_id]);
  const techIds = new Set(((up.data ?? []) as any[]).map((r) => r.user_id));
  return {
    migrated,
    migratedV24: !pr24.error,
    branches: ((br.data ?? []) as any[]).filter((b) => s.isAdmin || s.branchIds.has(b.id)),
    allBranches: (br.data ?? []) as any[],
    staff: ((us.data ?? []) as any[])
      .filter((u) => u.active !== false)
      .map((u) => ({
        id: u.id, full_name: u.full_name, position_id: u.position_id,
        branch_ids: userBranches.get(u.id) ?? [],
        is_technician: techIds.has(u.id) || u.position_id === "pos_technician",
      })),
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, is_hidden: p.is_hidden === true, warranty_months: Number(p.warranty_months) > 0 ? Number(p.warranty_months) : DEFAULT_MONTHS, warranty_motor_months: motorOf.get(p.id) > 0 ? motorOf.get(p.id) : DEFAULT_MOTOR })),
    factories: (((fa as any).data ?? []) as any[]),
    me: {
      isAdmin: s.isAdmin,
      branchIds: [...s.branchIds],
      canSchedule: s.isAdmin || s.perms.has("create_schedule") || s.perms.has("approve_schedule"),
    },
  };
});

/**
 * Ô chọn đại lý. Không gõ gì → khách nhóm "Đại lý". Gõ tìm → MỌI khách khớp, nhóm
 * "Đại lý" lên đầu (nhiều đại lý cũ đang nằm ở nhóm "Khách lẻ"). `ids` → nạp lại
 * lựa chọn đang có. Mỗi dòng kèm `group_label` để nhân viên biết khách thuộc nhóm nào.
 */
export const searchDealersFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; q?: string; ids?: string[] } }) => {
    await scopeOf(data?.actorId);
    const { data: gs } = await db().from("customer_groups").select("code, name");
    const groupLabel = new Map<string, string>(((gs ?? []) as any[]).map((g) => [g.code, g.name]));
    const withLabel = (rows: any[]) => rows.map((c) => ({ ...c, is_dealer: c.group_name === DEALER_GROUP, group_label: groupLabel.get(c.group_name) ?? c.group_name ?? "" }));
    if (data?.ids?.length) {
      const { data: rows } = await db().from("customers").select(CUSTOMER_COLS).in("id", data.ids.slice(0, 50));
      return { customers: withLabel(rows ?? []) };
    }
    const term = safeLike(text(data?.q));
    const d = digits(term);
    const match = d.length >= 4 ? `name.ilike.%${term}%,company_name.ilike.%${term}%,phone.ilike.%${d}%` : `name.ilike.%${term}%,company_name.ilike.%${term}%`;
    let dq = db().from("customers").select(CUSTOMER_COLS).eq("group_name", DEALER_GROUP).order("name").limit(20);
    if (term) dq = dq.or(match);
    const [dealers, others] = await Promise.all([
      dq,
      term ? db().from("customers").select(CUSTOMER_COLS).neq("group_name", DEALER_GROUP).or(match).order("name").limit(20) : Promise.resolve({ data: [] }),
    ]);
    if (dealers.error) throw new Error(dealers.error.message);
    return { customers: withLabel([...(dealers.data ?? []), ...(((others as any).data ?? []) as any[])].slice(0, 25)) };
  },
);

/**
 * Tự tìm NGÀY MUA: các đơn đã hoàn tất của khách (theo id hoặc SĐT) kèm mẫu đã
 * mua. Form tự điền đơn gần nhất có đúng mẫu; nhân viên vẫn sửa tay được (hàng
 * mua nơi khác / trước khi dùng phần mềm).
 */
export const lookupPurchaseFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; customerId?: string; phone?: string; productId?: string } }) => {
    await scopeOf(data?.actorId);
    let customer: any = null;
    if (data?.customerId) {
      const { data: cs } = await db().from("customers").select(CUSTOMER_COLS).eq("id", data.customerId).limit(1);
      customer = (cs ?? [])[0] ?? null;
    } else if (data?.phone) {
      customer = await customerByPhone(normalizePhoneForStorage(data.phone) ?? data.phone);
    }
    if (!customer) return { customer: null, purchases: [] };

    const { data: orders } = await db()
      .from("orders")
      .select("id, code, status, created_at, completed_at")
      .eq("customer_id", customer.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(300);
    const orderById = new Map<string, any>(((orders ?? []) as any[]).map((o) => [o.id, o]));
    const ids = [...orderById.keys()];
    const purchases: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      let q = db().from("order_items").select("order_id, product_id, qty").in("order_id", ids.slice(i, i + 200));
      if (data?.productId) q = q.eq("product_id", data.productId);
      const { data: items } = await q;
      for (const it of items ?? []) {
        const o = orderById.get(it.order_id);
        if (!o || Number(it.qty) <= 0) continue;
        purchases.push({ order_id: o.id, order_code: o.code, date: vnDay(o.completed_at || o.created_at), product_id: it.product_id, qty: Number(it.qty) });
      }
    }
    purchases.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      customer: { id: customer.id, name: customer.name, phone: customer.phone, company_name: customer.company_name, address: fullAddress(customer) },
      purchases,
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Phiếu bảo hành khách lẻ / đại lý
// ═══════════════════════════════════════════════════════════════════════════

type TicketListArgs = {
  actorId?: string;
  kind?: string; // retail | dealer | "" (cả hai)
  from?: string;
  to?: string;
  branchId?: string;
  stage?: string; // "open" | "all" | stage key
  warranty?: string; // "in" | "out" | "unknown"
  technicianId?: string;
  customerId?: string;
  productId?: string;
  overdue?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
};

function ticketQuery(s: Scope, a: TicketListArgs) {
  let q = applyScope(db().from("warranty_tickets").select("*"), s);
  if (a.kind === "retail" || a.kind === "dealer") q = q.eq("kind", a.kind);
  if (isDate(a.from)) q = q.gte("sent_date", `${a.from}T00:00:00+07:00`);
  if (isDate(a.to)) q = q.lte("sent_date", `${a.to}T23:59:59.999+07:00`);
  if (a.branchId) q = q.eq("branch_id", a.branchId);
  if (a.technicianId) q = a.technicianId === "__none" ? q.is("technician_id", null) : q.eq("technician_id", a.technicianId);
  if (a.customerId) q = q.eq("customer_id", a.customerId);
  if (a.productId) q = q.eq("product_id", a.productId);
  const term = safeLike(text(a.q));
  if (term) {
    const d = digits(term);
    const parts = [`code.ilike.%${term}%`, `customer_name.ilike.%${term}%`, `product_model.ilike.%${term}%`];
    if (d.length >= 4) parts.push(`phone.ilike.%${d}%`);
    q = q.or(parts.join(","));
  }
  return q.order("sent_date", { ascending: false }).order("id", { ascending: true });
}

async function companyOf(ids: any[]) {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 300) {
    const { data } = await db().from("customers").select("id, company_name").in("id", uniq.slice(i, i + 300));
    for (const c of data ?? []) if (text(c.company_name)) out.set(c.id, text(c.company_name));
  }
  return out;
}

export const listTicketsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: TicketListArgs }) => {
  const s = await scopeOf(data?.actorId);
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(data.pageSize) || 30));

  // Còn hạn / quá 24h là số TÍNH RA nên lọc sau khi đọc; số phiếu bảo hành không
  // lớn (vài trăm / quý) nên đọc hết theo bộ lọc rồi phân trang trong bộ nhớ.
  const all = (await fetchAll(() => ticketQuery(s, data))).map(decorateTicket);
  const base = all.filter((t) => (!data.warranty || t.warranty === data.warranty) && (!data.overdue || t.overdue));

  const stageCounts: Record<string, number> = {};
  for (const t of base) stageCounts[t.stage] = (stageCounts[t.stage] ?? 0) + 1;
  const rows = base.filter((t) =>
    !data.stage || data.stage === "open" ? OPEN_WARRANTY_STAGES.includes(t.stage) : data.stage === "all" ? true : t.stage === data.stage,
  );
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const company = await companyOf(pageRows.map((t) => t.customer_id));
  return {
    rows: pageRows.map((t) => ({ ...t, customer_company: company.get(t.customer_id) ?? null })),
    total: rows.length,
    stageCounts,
    overdueCount: base.filter((t) => t.overdue).length,
    page,
    pageSize,
    noBranch: !s.isAdmin && s.branchIds.size === 0,
  };
});

export const getTicketFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  const s = await scopeOf(data?.actorId);
  const t = await loadTicket(data.id);
  if (!canSee(s, t)) throw new Error("Bạn không có quyền xem phiếu bảo hành này");
  const orderIds = [t.purchase_order_id, t.part_order_id].filter(Boolean);
  const [acts, cust, orders, claims, sched] = await Promise.all([
    db().from("warranty_activities").select("*").eq("ticket_id", t.id).order("at", { ascending: false }),
    t.customer_id ? db().from("customers").select(CUSTOMER_COLS).eq("id", t.customer_id).limit(1) : Promise.resolve({ data: [] }),
    orderIds.length ? db().from("orders").select("id, code, total, status, created_at").in("id", orderIds) : Promise.resolve({ data: [] }),
    // Yêu cầu nhà máy là phần của admin — nhân viên chỉ biết phiếu đã gửi nhà máy hay chưa.
    db().from("factory_claims").select("id, code, factory_id, factory_solution, return_status, returned_date").eq("ticket_id", t.id),
    t.schedule_id ? db().from("schedules").select("id, title, status, scheduled_date, scheduled_time").eq("id", t.schedule_id).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const orderById = new Map<string, any>((((orders as any).data ?? []) as any[]).map((o) => [o.id, o]));
  const c = ((cust as any).data ?? [])[0] ?? null;
  return {
    ticket: { ...decorateTicket(t), customer_company: c?.company_name ?? null },
    activities: acts.data ?? [],
    customer: c ? { ...c, full_address: fullAddress(c) } : null,
    purchase_order: orderById.get(t.purchase_order_id) ?? null,
    part_order: orderById.get(t.part_order_id) ?? null,
    claims: (((claims as any).data ?? []) as any[]).map((x) => (s.isAdmin ? x : { id: x.id, code: x.code, return_status: x.return_status })),
    schedule: ((sched as any).data ?? [])[0] ?? null,
    can_delete: s.isAdmin,
  };
});

/** Lịch sử bảo hành của 1 khách (trang chi tiết khách) — trong phạm vi chi nhánh. */
export const listCustomerTicketsFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; customerId: string } }) => {
    const s = await scopeOf(data?.actorId);
    const q = applyScope(db().from("warranty_tickets").select("*").eq("customer_id", data.customerId), s).order("sent_date", { ascending: false }).limit(100);
    const { data: rows, error } = await q;
    if (isMissingTable(error)) return { rows: [] };
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []).map(decorateTicket) };
  },
);

function checkAction(action: string | null, price: number) {
  if (action && !WARRANTY_FINAL_ACTIONS.some((x) => x.key === action)) throw new Error("Kết quả xử lý không hợp lệ");
  if (action === "buy_part" && !(price > 0)) throw new Error('Kết quả "Mua linh kiện mới" bắt buộc nhập giá linh kiện');
}
const stageLabel = (k: string) => WARRANTY_STAGES.find((x) => x.key === k)?.label ?? k;

export const upsertTicketFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const s = await scopeOf(data?.actorId);
  const existing = data.id ? await loadTicket(data.id) : null;
  if (existing && !canSee(s, existing)) throw new Error("Bạn không có quyền sửa phiếu bảo hành này");

  const kind = existing?.kind ?? (data.kind === "dealer" ? "dealer" : "retail");
  const branchId = data.branch_id || existing?.branch_id;
  if (!branchId) throw new Error("Chọn showroom tiếp nhận");
  if (!s.isAdmin && !s.branchIds.has(branchId)) throw new Error("Bạn chỉ tạo / sửa được phiếu của chi nhánh mình được gán");

  // ── Khách ──
  let customerId: string | null = data.customer_id || null;
  let customerName = text(data.customer_name);
  let phone = text(data.phone) ? normalizePhoneForStorage(data.phone) ?? text(data.phone) : null;
  let address = text(data.address) || null;
  if (kind === "dealer") {
    if (!customerId) throw new Error("Chọn đại lý gửi bảo hành");
    const { data: cs } = await db().from("customers").select(CUSTOMER_COLS).eq("id", customerId).limit(1);
    const c = (cs ?? [])[0];
    if (!c) throw new Error("Không tìm thấy đại lý");
    customerName = c.name;
    phone = phone || c.phone || null;
    address = address || fullAddress(c) || null;
  } else {
    if (!customerName) throw new Error("Nhập tên khách");
    if (!customerId && phone) customerId = (await customerByPhone(phone))?.id ?? null;
  }

  // ── Mẫu quạt + hạn bảo hành theo mẫu ──
  const productId: string | null = data.product_id || null;
  const product = await productInfo(productId);
  if (productId && !product) throw new Error("Không tìm thấy mẫu quạt");
  const productModel = text(data.product_model) || product?.name || "";
  if (!productModel) throw new Error("Chọn hoặc nhập mẫu quạt");
  const closedBefore = existing && !OPEN_WARRANTY_STAGES.includes(existing.stage);
  const months =
    closedBefore && existing.product_id === productId
      ? Number(existing.warranty_months) || DEFAULT_MONTHS // phiếu đã xong giữ nguyên hạn lúc xử lý
      : Number(product?.warranty_months) > 0
        ? Number(product.warranty_months)
        : Number(existing?.warranty_months) || DEFAULT_MONTHS;

  const motorMonths =
    closedBefore && existing.product_id === productId
      ? Number(existing.warranty_motor_months) || DEFAULT_MOTOR
      : Number(product?.warranty_motor_months) > 0
        ? Number(product.warranty_motor_months)
        : Number(existing?.warranty_motor_months) || DEFAULT_MOTOR;
  const faultPart: string | null = data.fault_part === undefined ? existing?.fault_part ?? null : data.fault_part || null;
  if (faultPart && !WARRANTY_FAULT_PARTS.some((x) => x.key === faultPart)) throw new Error("Bộ phận lỗi không hợp lệ");

  // ── Ngày ──
  const sentDate = parseVN(data.sent_date) ?? existing?.sent_date ?? now();
  if (Date.parse(sentDate) > Date.now() + 5 * 60_000) throw new Error("Ngày gửi bảo hành không thể ở tương lai");
  const purchaseDate = data.purchase_date === undefined ? existing?.purchase_date ?? null : isDate(data.purchase_date) ? data.purchase_date : null;
  if (purchaseDate && purchaseDate > vnDay(sentDate)) throw new Error("Ngày mua không thể sau ngày gửi bảo hành");

  // ── Kết quả xử lý + tiền linh kiện ──
  const action: string | null = data.final_action === undefined ? existing?.final_action ?? null : data.final_action || null;
  let price = Math.max(0, Math.round(Number(data.spare_part_price === undefined ? existing?.spare_part_price : data.spare_part_price) || 0));
  if (action === "free_support") price = 0; // hỗ trợ miễn phí → không thu tiền linh kiện
  checkAction(action, price);

  const stage: string = data.stage || existing?.stage || "new";
  if (!WARRANTY_STAGES.some((x) => x.key === stage)) throw new Error("Trạng thái phiếu không hợp lệ");
  if (stage === "done" && !action) throw new Error('Chọn "Kết quả xử lý" trước khi hoàn tất phiếu');

  const advice = data.solution_advice === undefined ? existing?.solution_advice ?? null : text(data.solution_advice) || null;
  let responseDate = data.response_date === undefined ? existing?.response_date ?? null : parseVN(data.response_date);
  // Lần đầu có tư vấn / phiếu rời "Mới tiếp nhận" → coi như đã phản hồi.
  if (!responseDate && (advice || stage !== "new")) responseDate = now();
  if (responseDate && Date.parse(responseDate) < Date.parse(sentDate)) responseDate = sentDate;

  const issueType = data.issue_type === undefined ? existing?.issue_type ?? null : data.issue_type || null;
  if (issueType && !WARRANTY_ISSUE_TYPES.some((x) => x.key === issueType)) throw new Error("Loại lỗi không hợp lệ");

  const row: any = {
    kind,
    branch_id: branchId,
    customer_id: customerId,
    customer_name: customerName,
    phone,
    address,
    product_id: productId,
    product_model: productModel,
    purchase_date: purchaseDate,
    purchase_order_id: data.purchase_order_id === undefined ? existing?.purchase_order_id ?? null : data.purchase_order_id || null,
    warranty_months: months,
    sent_date: sentDate,
    response_date: responseDate,
    receptionist_id: data.receptionist_id === undefined ? existing?.receptionist_id ?? s.actorId : data.receptionist_id || null,
    technician_id: data.technician_id === undefined ? existing?.technician_id ?? null : data.technician_id || null,
    issue_type: issueType,
    issue_note: data.issue_note === undefined ? existing?.issue_note ?? null : text(data.issue_note) || null,
    attachments: data.attachments === undefined ? existing?.attachments ?? [] : cleanMedia(data.attachments),
    solution_advice: advice,
    final_action: action,
    spare_part_price: price,
    stage,
    done_at: stage === "done" ? existing?.done_at ?? now() : OPEN_WARRANTY_STAGES.includes(stage) ? null : existing?.done_at ?? null,
    updated_at: now(),
  };

  if (existing) {
    const { error } = await db().from("warranty_tickets").update(row).eq("id", existing.id);
    tableError(error);
    await saveV24(existing.id, { fault_part: faultPart, warranty_motor_months: motorMonths });
    const notes: string[] = [];
    if ((existing.fault_part ?? null) !== faultPart && faultPart) notes.push(`Bộ phận lỗi: ${WARRANTY_FAULT_PARTS.find((x) => x.key === faultPart)?.label}`);
    if (existing.stage !== stage) notes.push(`Trạng thái: ${stageLabel(existing.stage)} → ${stageLabel(stage)}`);
    if ((existing.final_action ?? null) !== action && action) notes.push(`Kết quả xử lý: ${WARRANTY_FINAL_ACTIONS.find((x) => x.key === action)?.label}${price > 0 ? ` (${price.toLocaleString("vi-VN")}đ)` : ""}`);
    if ((existing.solution_advice ?? "") !== (advice ?? "") && advice) notes.push(`Tư vấn hướng xử lý: ${advice}`);
    if (notes.length) await addActivity({ ticketId: existing.id }, s.actorId, existing.stage !== stage ? "stage" : "system", notes.join(" · "));
    return { id: existing.id, code: existing.code };
  }

  // Tạo từ đơn hàng (cách làm cũ: đơn "Bảo hành VIP" + linh kiện) → gắn sẵn đơn + lịch của đơn.
  let partOrderId: string | null = data.part_order_id || null;
  if (partOrderId) {
    const { data: os } = await db().from("orders").select("id").eq("id", partOrderId).limit(1);
    if (!os?.length) partOrderId = null;
  }
  const id = uid();
  const code = await insertWithCode("warranty_tickets", `BH-${todayVN().replace(/-/g, "")}-`, {
    ...row, id, part_order_id: partOrderId, schedule_id: data.schedule_id || null, created_by: s.actorId, created_at: now(),
  });
  await saveV24(id, { fault_part: faultPart, warranty_motor_months: motorMonths });
  await addActivity({ ticketId: id }, s.actorId, "system", `Tạo phiếu bảo hành ${kind === "dealer" ? "đại lý" : "khách lẻ"}${row.issue_note ? ` — ${row.issue_note}` : ""}`);
  await logActivity({ action: "create_warranty_ticket", detail: `Tạo phiếu bảo hành ${code}: ${customerName} — ${productModel}`, employee_id: s.actorId });
  return { id, code };
});

/** Đổi nhanh trạng thái (kèm kết quả xử lý / giá linh kiện khi hoàn tất). */
export const setTicketStageFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; stage: string; final_action?: string; spare_part_price?: number; note?: string } }) => {
    const s = await scopeOf(data?.actorId);
    const t = await loadTicket(data.id);
    if (!canSee(s, t)) throw new Error("Bạn không có quyền sửa phiếu bảo hành này");
    if (!WARRANTY_STAGES.some((x) => x.key === data.stage)) throw new Error("Trạng thái phiếu không hợp lệ");
    const action = data.final_action === undefined ? t.final_action ?? null : data.final_action || null;
    let price = Math.max(0, Math.round(Number(data.spare_part_price === undefined ? t.spare_part_price : data.spare_part_price) || 0));
    if (action === "free_support") price = 0;
    checkAction(action, price);
    if (data.stage === "done" && !action) throw new Error('Chọn "Kết quả xử lý" trước khi hoàn tất phiếu');
    const patch: any = {
      stage: data.stage,
      final_action: action,
      spare_part_price: price,
      response_date: t.response_date ?? (data.stage !== "new" ? now() : null),
      done_at: data.stage === "done" ? t.done_at ?? now() : OPEN_WARRANTY_STAGES.includes(data.stage) ? null : t.done_at ?? null,
      updated_at: now(),
    };
    const { error } = await db().from("warranty_tickets").update(patch).eq("id", t.id);
    tableError(error);
    const extra = [
      action && action !== t.final_action ? `Kết quả: ${WARRANTY_FINAL_ACTIONS.find((x) => x.key === action)?.label}${price > 0 ? ` (${price.toLocaleString("vi-VN")}đ)` : ""}` : "",
      text(data.note),
    ].filter(Boolean);
    await addActivity({ ticketId: t.id }, s.actorId, "stage", [`Trạng thái: ${stageLabel(t.stage)} → ${stageLabel(data.stage)}`, ...extra].join(" · "));
    return { ok: true };
  },
);

/** Ghi chú / trao đổi nội bộ giữa NV tiếp nhận và kỹ thuật. */
export const addTicketNoteFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; content: string } }) => {
    const s = await scopeOf(data?.actorId);
    const t = await loadTicket(data.id);
    if (!canSee(s, t)) throw new Error("Bạn không có quyền ghi chú phiếu bảo hành này");
    const content = text(data.content);
    if (!content) throw new Error("Nhập nội dung ghi chú");
    await addActivity({ ticketId: t.id }, s.actorId, "note", content);
    // Có trao đổi = đã phản hồi lần đầu.
    await db().from("warranty_tickets").update({ response_date: t.response_date ?? now(), updated_at: now() }).eq("id", t.id);
    return { ok: true };
  },
);

export const deleteTicketFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  const s = await scopeOf(data?.actorId);
  if (!s.isAdmin) throw new Error("Chỉ quản trị viên được xoá phiếu bảo hành");
  const t = await loadTicket(data.id);
  const { error } = await db().from("warranty_tickets").delete().eq("id", t.id);
  tableError(error);
  await logActivity({ action: "delete_warranty_ticket", detail: `Xoá phiếu bảo hành ${t.code}: ${t.customer_name} — ${t.product_model ?? ""}`, employee_id: s.actorId });
  return { ok: true };
});

/**
 * Điền sẵn phiếu bảo hành từ một ĐƠN HÀNG. Cách showroom đang làm: bảo hành khách
 * lẻ = đơn bán có dịch vụ "Bảo hành VIP" + linh kiện + ghi chú tình trạng + lịch
 * kỹ thuật. Nút "Tạo phiếu bảo hành" ở trang đơn lấy khách, ghi chú, lịch của đơn
 * và gắn đơn làm "đơn bán linh kiện". `tickets` = phiếu đã tạo từ đơn này.
 */
export const ticketPrefillFromOrderFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; orderId: string } }) => {
    const s = await scopeOf(data?.actorId);
    const { data: os } = await db().from("orders").select("id, code, customer_id, branch_id, employee_id, status, note, created_at").eq("id", data.orderId).limit(1);
    const o = (os ?? [])[0];
    if (!o) throw new Error("Không tìm thấy đơn hàng");
    const allowed = s.isAdmin || s.branchIds.has(o.branch_id);
    const [cust, sched, tix] = await Promise.all([
      o.customer_id ? db().from("customers").select(CUSTOMER_COLS).eq("id", o.customer_id).limit(1) : Promise.resolve({ data: [] }),
      db().from("schedules").select("id, status, created_at").eq("order_id", o.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1),
      db().from("warranty_tickets").select("id, code, kind, stage, branch_id").eq("part_order_id", o.id).order("created_at", { ascending: true }),
    ]);
    const c = ((cust as any).data ?? [])[0] ?? null;
    return {
      allowed,
      migrated: !tix.error,
      tickets: (((tix.data ?? []) as any[]).filter((t) => canSee(s, t))).map((t) => ({ id: t.id, code: t.code, kind: t.kind, stage: t.stage })),
      prefill: !allowed
        ? null
        : {
            kind: c?.group_name === DEALER_GROUP ? "dealer" : "retail",
            order_code: o.code,
            branch_id: o.branch_id ?? "",
            customer_id: c?.id ?? "",
            customer_name: c?.name ?? "",
            phone: c?.phone ?? "",
            address: c ? fullAddress(c) : "",
            issue_note: text(o.note),
            receptionist_id: o.employee_id ?? s.actorId,
            part_order_id: o.id,
            schedule_id: ((sched.data ?? [])[0] as any)?.id ?? "",
          },
    };
  },
);

/** Đơn có thể gắn làm "đơn bán linh kiện": đơn của khách trên phiếu, hoặc tìm theo mã. */
export const ticketOrderOptionsFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; q?: string } }) => {
    const s = await scopeOf(data?.actorId);
    const t = await loadTicket(data.id);
    if (!canSee(s, t)) throw new Error("Bạn không có quyền xem phiếu bảo hành này");
    const term = safeLike(text(data.q));
    let q = db().from("orders").select("id, code, total, status, created_at, customer_id").in("status", ["completed", "reserved"]).order("created_at", { ascending: false }).limit(15);
    if (term) q = q.ilike("code", `%${term}%`);
    else if (t.customer_id) q = q.eq("customer_id", t.customer_id);
    else return { orders: [] };
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { orders: rows ?? [] };
  },
);

/** Gắn / gỡ đơn bán linh kiện (chỉ liên kết để tra cứu — không tạo phiếu thu). */
export const linkTicketOrderFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; orderId?: string | null } }) => {
    const s = await scopeOf(data?.actorId);
    const t = await loadTicket(data.id);
    if (!canSee(s, t)) throw new Error("Bạn không có quyền sửa phiếu bảo hành này");
    let code = "";
    if (data.orderId) {
      const { data: os } = await db().from("orders").select("id, code").eq("id", data.orderId).limit(1);
      if (!os?.length) throw new Error("Không tìm thấy đơn hàng");
      code = os[0].code;
    }
    const { error } = await db().from("warranty_tickets").update({ part_order_id: data.orderId || null, updated_at: now() }).eq("id", t.id);
    tableError(error);
    await addActivity({ ticketId: t.id }, s.actorId, "system", data.orderId ? `Gắn đơn bán linh kiện ${code}` : "Gỡ đơn bán linh kiện");
    return { ok: true };
  },
);

/** Tạo lịch làm việc loại "Bảo hành" cho phiếu (chờ duyệt & phân công ở Lịch làm việc). */
export const createTicketScheduleFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; scheduled_date: string; scheduled_time?: string; note?: string } }) => {
    const s = await scopeOf(data?.actorId);
    const t = await loadTicket(data.id);
    if (!canSee(s, t)) throw new Error("Bạn không có quyền sửa phiếu bảo hành này");
    if (!(s.isAdmin || s.perms.has("create_schedule") || s.perms.has("approve_schedule"))) throw new Error("Bạn chưa có quyền tạo lịch làm việc");
    if (!isDate(data.scheduled_date)) throw new Error("Chọn ngày hẹn bảo hành");
    if (t.schedule_id) {
      const { data: old } = await db().from("schedules").select("id, status").eq("id", t.schedule_id).limit(1);
      if (old?.length && old[0].status !== "cancelled") throw new Error("Phiếu này đã có lịch bảo hành");
    }
    const id = uid();
    const title = `Bảo hành ${t.code} - ${t.customer_name}`;
    const { error } = await db().from("schedules").insert({
      id, title, type: "warranty", status: "pending",
      scheduled_date: data.scheduled_date, scheduled_time: text(data.scheduled_time) || null,
      customer_id: t.customer_id, branch_id: t.branch_id, order_id: null,
      address: t.address, note: [t.product_model, t.issue_note, text(data.note)].filter(Boolean).join(" — ") || null,
      created_by: s.actorId, assigned_by: null, work_type_id: null, created_at: now(),
    });
    if (error) throw new Error(error.message);
    await db().from("warranty_tickets").update({ schedule_id: id, updated_at: now() }).eq("id", t.id);
    await addActivity({ ticketId: t.id }, s.actorId, "system", `Tạo lịch bảo hành ngày ${data.scheduled_date.split("-").reverse().join("/")}${data.scheduled_time ? ` ${data.scheduled_time}` : ""}`);
    await logActivity({ action: "create_schedule", detail: `Tạo lịch làm việc: ${title} (${data.scheduled_date})`, employee_id: s.actorId });
    return { id };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Nhà máy (chỉ admin)
// ═══════════════════════════════════════════════════════════════════════════

async function factoryMap() {
  const { data, error } = await db().from("factories").select("*").order("name");
  tableError(error);
  return new Map<string, any>(((data ?? []) as any[]).map((f) => [f.id, f]));
}

export const listFactoriesFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const [fm, claims] = await Promise.all([factoryMap(), fetchAll(() => db().from("factory_claims").select("id, factory_id").order("id"))]);
  const count = new Map<string, number>();
  for (const c of claims) count.set(c.factory_id, (count.get(c.factory_id) ?? 0) + 1);
  return { factories: [...fm.values()].map((f) => ({ ...f, claim_count: count.get(f.id) ?? 0 })) };
});

export const upsertFactoryFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const s = await scopeOf(data?.actorId);
  assertAdmin(s);
  const name = text(data.name);
  if (!name) throw new Error("Nhập tên nhà máy");
  const sla = Math.round(Number(data.sla_days));
  if (!(sla >= 1 && sla <= 365)) throw new Error("Số ngày hạn gửi trả phải từ 1 đến 365");
  const row = {
    name, contact_name: text(data.contact_name) || null, phone: text(data.phone) || null,
    note: text(data.note) || null, sla_days: sla, is_active: data.is_active !== false,
  };
  if (data.id) {
    const { error } = await db().from("factories").update(row).eq("id", data.id);
    tableError(error);
    return { id: data.id };
  }
  const id = uid();
  const { error } = await db().from("factories").insert({ ...row, id, created_at: now() });
  tableError(error);
  return { id };
});

export const deleteFactoryFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const { count } = await db().from("factory_claims").select("id", { count: "exact", head: true }).eq("factory_id", data.id);
  if ((count ?? 0) > 0) throw new Error(`Nhà máy đang có ${count} yêu cầu bảo hành — hãy tắt "Đang hoạt động" thay vì xoá`);
  const { error } = await db().from("factories").delete().eq("id", data.id);
  tableError(error);
  return { ok: true };
});

type ClaimListArgs = {
  actorId?: string;
  from?: string;
  to?: string;
  factoryId?: string;
  status?: string; // all | waiting | returned | rejected | awaiting | overdue | no_solution
  q?: string;
  page?: number;
  pageSize?: number;
};

function claimQuery(a: ClaimListArgs) {
  let q = db().from("factory_claims").select("*");
  if (isDate(a.from)) q = q.gte("received_date", a.from);
  if (isDate(a.to)) q = q.lte("received_date", a.to);
  if (a.factoryId) q = q.eq("factory_id", a.factoryId);
  const term = safeLike(text(a.q));
  if (term) q = q.or(`code.ilike.%${term}%,product_model.ilike.%${term}%,defect_description.ilike.%${term}%,shipping_note.ilike.%${term}%`);
  return q.order("received_date", { ascending: false }).order("id", { ascending: true });
}

export const listClaimsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: ClaimListArgs }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(data.pageSize) || 30));
  const fm = await factoryMap();
  const all = (await fetchAll(() => claimQuery(data))).map((c) => decorateClaim(c, fm));
  const counts = {
    all: all.length,
    awaiting: all.filter((c) => c.awaiting).length,
    overdue: all.filter((c) => c.overdue).length,
    no_solution: all.filter((c) => !c.factory_solution && c.return_status === "waiting").length,
    returned: all.filter((c) => c.return_status === "returned").length,
    rejected: all.filter((c) => c.return_status === "rejected").length,
  };
  const st = data.status || "all";
  const rows = all.filter((c) =>
    st === "all" ? true
      : st === "awaiting" ? c.awaiting
      : st === "overdue" ? c.overdue
      : st === "no_solution" ? !c.factory_solution && c.return_status === "waiting"
      : c.return_status === st,
  );
  // Danh sách chờ trả: ca chờ lâu nhất lên đầu.
  if (st === "awaiting" || st === "overdue") rows.sort((a, b) => b.days_waiting - a.days_waiting);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const ticketIds = [...new Set(pageRows.map((c) => c.ticket_id).filter(Boolean))];
  const ticketCode = new Map<string, string>();
  if (ticketIds.length) {
    const { data: ts } = await db().from("warranty_tickets").select("id, code").in("id", ticketIds);
    for (const t of ts ?? []) ticketCode.set(t.id, t.code);
  }
  return { rows: pageRows.map((c) => ({ ...c, ticket_code: ticketCode.get(c.ticket_id) ?? null })), total: rows.length, counts, page, pageSize };
});

export const upsertClaimFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const s = await scopeOf(data?.actorId);
  assertAdmin(s);
  const existing = data.id ? await loadClaim(data.id) : null;

  const factoryId = data.factory_id || existing?.factory_id;
  if (!factoryId) throw new Error("Chọn nhà máy sản xuất");
  const fm = await factoryMap();
  if (!fm.has(factoryId)) throw new Error("Không tìm thấy nhà máy");

  const productId: string | null = data.product_id === undefined ? existing?.product_id ?? null : data.product_id || null;
  const product = await productInfo(productId);
  const productModel = text(data.product_model) || product?.name || existing?.product_model || "";
  if (!productModel) throw new Error("Chọn hoặc nhập mẫu quạt");

  const receivedDate = isDate(data.received_date) ? data.received_date : existing?.received_date ?? todayVN();
  if (receivedDate > todayVN()) throw new Error("Ngày tiếp nhận không thể ở tương lai");

  const solution: string | null = data.factory_solution === undefined ? existing?.factory_solution ?? null : data.factory_solution || null;
  const sol = FACTORY_SOLUTIONS.find((x) => x.key === solution);
  if (solution && !sol) throw new Error("Hướng xử lý của nhà máy không hợp lệ");
  const solutionChanged = (existing?.factory_solution ?? null) !== solution;
  // Mốc tính hạn gửi trả = lúc cập nhật hướng xử lý của nhà máy.
  const solutionAt = !solution ? null : solutionChanged ? now() : existing?.solution_at ?? now();

  let status: string = data.return_status || existing?.return_status || "waiting";
  if (!FACTORY_RETURN_STATUSES.some((x) => x.key === status)) throw new Error("Trạng thái gửi trả không hợp lệ");
  if (solutionChanged && sol && !sol.accept) status = "rejected"; // nhà máy không bảo hành → đóng
  if (solutionChanged && sol?.accept && status === "rejected") status = "waiting";
  const returnedDate = status === "returned" ? (isDate(data.returned_date) ? data.returned_date : existing?.returned_date ?? null) : null;
  if (status === "returned" && !returnedDate) throw new Error("Nhập ngày nhà máy gửi trả");
  if (returnedDate && returnedDate < receivedDate) throw new Error("Ngày nhà máy gửi trả không thể trước ngày tiếp nhận");

  let ticketId: string | null = data.ticket_id === undefined ? existing?.ticket_id ?? null : data.ticket_id || null;
  if (ticketId && ticketId !== existing?.ticket_id) await loadTicket(ticketId);

  const row: any = {
    factory_id: factoryId,
    product_id: productId,
    product_model: productModel,
    received_date: receivedDate,
    receiver_id: data.receiver_id === undefined ? existing?.receiver_id ?? s.actorId : data.receiver_id || null,
    defect_description: data.defect_description === undefined ? existing?.defect_description ?? null : text(data.defect_description) || null,
    media: data.media === undefined ? existing?.media ?? [] : cleanMedia(data.media),
    factory_solution: solution,
    solution_at: solutionAt,
    return_status: status,
    returned_date: returnedDate,
    shipping_note: data.shipping_note === undefined ? existing?.shipping_note ?? null : text(data.shipping_note) || null,
    ticket_id: ticketId,
    updated_at: now(),
  };

  if (existing) {
    const { error } = await db().from("factory_claims").update(row).eq("id", existing.id);
    tableError(error);
    if (solutionChanged && sol) await addActivity({ claimId: existing.id }, s.actorId, "system", `Hướng xử lý từ nhà máy: ${sol.label}`);
    return { id: existing.id, code: existing.code };
  }
  const id = uid();
  const code = await insertWithCode("factory_claims", `NM-${todayVN().slice(0, 7).replace("-", "")}-`, { ...row, id, created_by: s.actorId, created_at: now() });
  await addActivity({ claimId: id }, s.actorId, "system", `Tạo yêu cầu bảo hành gửi ${fm.get(factoryId).name}`);
  if (ticketId) await addActivity({ ticketId }, s.actorId, "system", `Gửi nhà máy ${fm.get(factoryId).name} — yêu cầu ${code}`);
  await logActivity({ action: "create_factory_claim", detail: `Tạo yêu cầu bảo hành nhà máy ${code}: ${fm.get(factoryId).name} — ${productModel}`, employee_id: s.actorId });
  return { id, code };
});

/** "Xác nhận đã nhận hàng gửi trả" → NM đã gửi trả (hoàn tất). */
export const confirmClaimReturnedFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; id: string; returned_date?: string; shipping_note?: string } }) => {
    const s = await scopeOf(data?.actorId);
    assertAdmin(s);
    const c = await loadClaim(data.id);
    const returnedDate = isDate(data.returned_date) ? data.returned_date : todayVN();
    if (returnedDate > todayVN()) throw new Error("Ngày nhận hàng không thể ở tương lai");
    if (returnedDate < c.received_date) throw new Error("Ngày nhà máy gửi trả không thể trước ngày tiếp nhận");
    const note = text(data.shipping_note) || c.shipping_note || null;
    const { error } = await db().from("factory_claims").update({ return_status: "returned", returned_date: returnedDate, shipping_note: note, updated_at: now() }).eq("id", c.id);
    tableError(error);
    const msg = `Đã nhận hàng nhà máy gửi trả ngày ${returnedDate.split("-").reverse().join("/")}${note ? ` — ${note}` : ""}`;
    await addActivity({ claimId: c.id }, s.actorId, "system", msg);
    if (c.ticket_id) await addActivity({ ticketId: c.ticket_id }, s.actorId, "system", `${msg} (yêu cầu ${c.code})`);
    return { ok: true };
  },
);

export const getClaimFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const c = await loadClaim(data.id);
  const [fm, acts, tk] = await Promise.all([
    factoryMap(),
    db().from("warranty_activities").select("*").eq("claim_id", c.id).order("at", { ascending: false }),
    c.ticket_id ? db().from("warranty_tickets").select("id, code, kind, customer_name").eq("id", c.ticket_id).limit(1) : Promise.resolve({ data: [] }),
  ]);
  return { claim: decorateClaim(c, fm), activities: acts.data ?? [], ticket: ((tk as any).data ?? [])[0] ?? null };
});

export const deleteClaimFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  const s = await scopeOf(data?.actorId);
  assertAdmin(s);
  const c = await loadClaim(data.id);
  const { error } = await db().from("factory_claims").delete().eq("id", c.id);
  tableError(error);
  await logActivity({ action: "delete_factory_claim", detail: `Xoá yêu cầu bảo hành nhà máy ${c.code}`, employee_id: s.actorId });
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// Cảnh báo ở trang Tổng quan
// ═══════════════════════════════════════════════════════════════════════════

/** Phiếu quá 24h chưa phản hồi (theo chi nhánh) + hàng nhà máy quá hạn gửi trả (admin). */
export async function warrantyAlerts(actorId?: string) {
  const empty = { tickets: [], ticketCount: 0, claims: [], claimCount: 0, awaitingCount: 0 };
  let s: Scope;
  try {
    s = await scopeOf(actorId);
  } catch {
    return empty;
  }
  const tq = applyScope(db().from("warranty_tickets").select("id, code, kind, branch_id, customer_name, product_model, sent_date, response_date, stage, receptionist_id"), s)
    .is("response_date", null)
    .in("stage", OPEN_WARRANTY_STAGES)
    .lt("sent_date", new Date(Date.now() - RESPONSE_SLA_HOURS * 3600_000).toISOString())
    .order("sent_date", { ascending: true })
    .limit(200);
  const { data: ts, error } = await tq;
  if (error) return empty; // chưa chạy v23 → không hiện khung
  const tickets = ((ts ?? []) as any[]).map((t) => ({ ...t, hours_waiting: Math.floor((Date.now() - Date.parse(t.sent_date)) / 3600_000) }));

  let claims: any[] = [];
  let awaitingCount = 0;
  if (s.isAdmin) {
    const [fm, cs] = await Promise.all([
      factoryMap().catch(() => new Map()),
      db().from("factory_claims").select("*").eq("return_status", "waiting").not("factory_solution", "is", null).order("solution_at", { ascending: true }).limit(500),
    ]);
    const dec = (((cs as any).data ?? []) as any[]).map((c) => decorateClaim(c, fm));
    awaitingCount = dec.filter((c) => c.awaiting).length;
    claims = dec.filter((c) => c.overdue);
  }
  return { tickets: tickets.slice(0, 8), ticketCount: tickets.length, claims: claims.slice(0, 8), claimCount: claims.length, awaitingCount };
}
export const warrantyAlertsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) =>
  warrantyAlerts(data?.actorId),
);

// ═══════════════════════════════════════════════════════════════════════════
// Báo cáo
// ═══════════════════════════════════════════════════════════════════════════

const topN = (m: Map<string, any>, n = 10) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
const bump = (m: Map<string, any>, key: string, init: () => any) => {
  if (!m.has(key)) m.set(key, init());
  const x = m.get(key);
  x.count++;
  return x;
};

export const warrantyReportFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: TicketListArgs }) => {
  const s = await scopeOf(data?.actorId);
  const rows = (await fetchAll(() => ticketQuery(s, { ...data, q: "" }))).map(decorateTicket);

  const byStage: Record<string, number> = {};
  const byKind: Record<string, number> = { retail: 0, dealer: 0 };
  const byAction = new Map<string, any>();
  const byIssue = new Map<string, any>();
  const byProduct = new Map<string, any>();
  const byDealer = new Map<string, any>();
  const byBranch = new Map<string, any>();
  const byTech = new Map<string, any>();
  const byMonth = new Map<string, any>();
  let inCount = 0, outCount = 0, partialCount = 0, unknownCount = 0, partRevenue = 0, partCount = 0, overdue = 0;
  let respSum = 0, respN = 0;

  for (const t of rows) {
    byStage[t.stage] = (byStage[t.stage] ?? 0) + 1;
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    if (t.warranty === "in") inCount++;
    else if (t.warranty === "out") outCount++;
    else if (t.warranty === "partial") partialCount++;
    else unknownCount++;
    const price = Number(t.spare_part_price) || 0;
    if (price > 0) { partRevenue += price; partCount++; }
    if (t.overdue) overdue++;
    if (t.response_date) { respSum += Math.max(0, Date.parse(t.response_date) - Date.parse(t.sent_date)); respN++; }

    if (t.final_action) bump(byAction, t.final_action, () => ({ key: t.final_action, count: 0 }));
    bump(byIssue, t.issue_type || "__none", () => ({ key: t.issue_type || "__none", count: 0 }));
    const pKey = t.product_id || `m:${text(t.product_model).toLowerCase()}`;
    const p = bump(byProduct, pKey, () => ({ product_id: t.product_id, name: t.product_model || "(chưa rõ mẫu)", count: 0, in: 0, out: 0 }));
    if (t.warranty === "in") p.in++;
    else if (t.warranty === "out") p.out++;
    if (t.kind === "dealer") {
      const d = bump(byDealer, t.customer_id || `n:${t.customer_name}`, () => ({ customer_id: t.customer_id, name: t.customer_name, count: 0, part_revenue: 0 }));
      d.part_revenue += price;
    }
    bump(byBranch, t.branch_id || "__none", () => ({ branch_id: t.branch_id, count: 0 }));
    const tech = bump(byTech, t.technician_id || "__none", () => ({ technician_id: t.technician_id, count: 0, done: 0, ms: 0 }));
    if (t.done_at) { tech.done++; tech.ms += Math.max(0, Date.parse(t.done_at) - Date.parse(t.sent_date)); }
    const mon = bump(byMonth, vnDay(t.sent_date).slice(0, 7), () => ({ month: vnDay(t.sent_date).slice(0, 7), count: 0, in: 0, out: 0, part_revenue: 0 }));
    if (t.warranty === "in") mon.in++;
    else if (t.warranty === "out") mon.out++;
    mon.part_revenue += price;
  }

  const company = await companyOf([...byDealer.values()].map((d) => d.customer_id));
  return {
    total: rows.length,
    byKind,
    byStage,
    inCount, outCount, partialCount, unknownCount,
    partRevenue, partCount,
    overdue,
    avgResponseHours: respN ? Math.round((respSum / respN / 3600_000) * 10) / 10 : null,
    byAction: [...byAction.values()].sort((a, b) => b.count - a.count),
    byIssue: [...byIssue.values()].sort((a, b) => b.count - a.count),
    byProduct: topN(byProduct),
    byDealer: topN(byDealer).map((d) => ({ ...d, company: company.get(d.customer_id) ?? null })),
    byBranch: [...byBranch.values()].sort((a, b) => b.count - a.count),
    // Thời gian xử lý trung bình 1 ca = từ ngày gửi đến lúc hoàn tất (chỉ ca đã hoàn tất).
    byTechnician: [...byTech.values()]
      .map((x) => ({ technician_id: x.technician_id, count: x.count, done: x.done, avgHours: x.done ? Math.round((x.ms / x.done / 3600_000) * 10) / 10 : null }))
      .sort((a, b) => b.count - a.count),
    byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    noBranch: !s.isAdmin && s.branchIds.size === 0,
  };
});

export const factoryReportFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: ClaimListArgs }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const fm = await factoryMap();
  const rows = (await fetchAll(() => claimQuery({ ...data, q: "" }))).map((c) => decorateClaim(c, fm));
  const per = new Map<string, any>();
  const overall: Record<string, number> = {};
  for (const c of rows) {
    const f = per.get(c.factory_id || "__none") ?? per.set(c.factory_id || "__none", {
      factory_id: c.factory_id, name: c.factory_name ?? "(nhà máy đã xoá)", total: 0, solutions: {}, noSolution: 0,
      awaiting: 0, overdue: 0, returned: 0, returnDays: 0, products: new Map<string, any>(),
    }).get(c.factory_id || "__none");
    f.total++;
    if (c.factory_solution) {
      f.solutions[c.factory_solution] = (f.solutions[c.factory_solution] ?? 0) + 1;
      overall[c.factory_solution] = (overall[c.factory_solution] ?? 0) + 1;
    } else f.noSolution++;
    if (c.awaiting) f.awaiting++;
    if (c.overdue) f.overdue++;
    if (c.return_status === "returned" && c.returned_date) {
      f.returned++;
      // Thời gian xử lý & gửi trả = từ ngày báo (tiếp nhận) đến ngày nhận trả.
      f.returnDays += Math.max(0, Math.round((Date.parse(`${c.returned_date}T00:00:00Z`) - Date.parse(`${c.received_date}T00:00:00Z`)) / 86400_000));
    }
    const pk = c.product_id || `m:${text(c.product_model).toLowerCase()}`;
    bump(f.products, pk, () => ({ name: c.product_model || "(chưa rõ mẫu)", count: 0 }));
  }
  const factories = [...per.values()]
    .map((f) => ({
      factory_id: f.factory_id, name: f.name, total: f.total, solutions: f.solutions, noSolution: f.noSolution,
      awaiting: f.awaiting, overdue: f.overdue, returned: f.returned,
      avgReturnDays: f.returned ? Math.round((f.returnDays / f.returned) * 10) / 10 : null,
      topProducts: topN(f.products, 5),
    }))
    .sort((a, b) => b.total - a.total);
  return {
    total: rows.length,
    awaiting: rows.filter((c) => c.awaiting).length,
    overdue: rows.filter((c) => c.overdue).length,
    returned: rows.filter((c) => c.return_status === "returned").length,
    solutions: overall,
    factories,
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// Cài đặt: hạn bảo hành theo từng mẫu (chỉ admin)
// ═══════════════════════════════════════════════════════════════════════════

export const listWarrantyProductsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  assertAdmin(await scopeOf(data?.actorId));
  const { data: cats } = await db().from("categories").select("id, name").order("name");
  let pr = await db().from("products").select("id, sku, name, category_id, is_hidden, warranty_months, warranty_motor_months").order("name");
  const migratedV24 = !pr.error;
  if (pr.error) pr = await db().from("products").select("id, sku, name, category_id, is_hidden, warranty_months").order("name");
  tableError(pr.error);
  return { products: pr.data ?? [], categories: cats ?? [], migratedV24 };
});

/**
 * Đặt số tháng bảo hành cho 1 / nhiều mẫu hoặc cả nhóm hàng: `months` = phụ kiện,
 * `motorMonths` = động cơ (gửi một trong hai hoặc cả hai). Phiếu ĐANG MỞ của các
 * mẫu đó cập nhật theo; phiếu đã hoàn tất / đóng giữ nguyên hạn lúc xử lý.
 * Tách riêng, không đi qua upsertProduct.
 */
export const setProductWarrantyMonthsFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; productIds?: string[]; categoryId?: string; months?: number; motorMonths?: number } }) => {
    assertAdmin(await scopeOf(data?.actorId));
    const patch: any = {};
    for (const [key, col] of [["months", "warranty_months"], ["motorMonths", "warranty_motor_months"]] as const) {
      if (data[key] === undefined || data[key] === null || (data[key] as any) === "") continue;
      const n = Math.round(Number(data[key]));
      if (!(n >= 1 && n <= 240)) throw new Error("Số tháng bảo hành phải từ 1 đến 240");
      patch[col] = n;
    }
    if (!Object.keys(patch).length) throw new Error("Nhập số tháng bảo hành");
    let ids: string[] = (data.productIds ?? []).filter(Boolean);
    if (data.categoryId) {
      const { data: ps, error } = await db().from("products").select("id").eq("category_id", data.categoryId);
      if (error) throw new Error(error.message);
      ids = [...new Set([...ids, ...(ps ?? []).map((p: any) => p.id)])];
    }
    if (!ids.length) throw new Error("Chưa chọn mẫu nào");
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      const { error } = await db().from("products").update(patch).in("id", part);
      if (isMissingV24(error)) throw new Error("Chưa chạy sql_migration_v24_warranty_two_tier.sql (hạn bảo hành động cơ)");
      tableError(error);
      await db().from("warranty_tickets").update({ ...patch, updated_at: now() }).in("product_id", part).in("stage", OPEN_WARRANTY_STAGES);
    }
    return { updated: ids.length, ...patch };
  },
);
