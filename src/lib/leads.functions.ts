// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { normalizePhoneForStorage } from "./zalo/phone";
import { uid, now, logActivity } from "./supabase";
import { CUSTOMER_SOURCES, LEAD_LOST_REASONS, LEAD_STAGES, OPEN_LEAD_STAGES } from "./types";

/**
 * KHÁCH TIỀM NĂNG (migration v22) — thay file "QUẢN LÝ KHÁCH HÀNG HCM - 2026.xlsx".
 *
 * Mỗi lead = một lượt khách hỏi / ghé showroom. Tự nối với khách hàng theo SĐT
 * và tự chuyển "Đã chốt" khi khách có đơn (hoàn tất / đặt cọc) trong vòng
 * WIN_WINDOW_DAYS kể từ ngày tiếp nhận.
 *
 * Quyền (kiểm ở server — bảng bật RLS deny-all):
 *   - Xem / thêm: lead thuộc các chi nhánh mình được gán (+ lead mình phụ trách / hỗ trợ).
 *   - Sửa: admin; người phụ trách / hỗ trợ; Quản lý bán hàng của chi nhánh đó.
 *   - Đổi người phụ trách: admin, Quản lý bán hàng.
 */

const WIN_WINDOW_DAYS = 180;
const POS_SALES_MANAGER = "pos_sales_manager";
const db = () => getSupabaseAdmin();
const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const digits = (p: any) => String(p ?? "").replace(/\D/g, "");
const chunk = <T,>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const stageLabel = (k: string) => LEAD_STAGES.find((s) => s.key === k)?.label ?? k;

type LeadScope = { actorId: string; isAdmin: boolean; branchIds: Set<string>; isSalesManager: boolean };

async function leadScope(actorId?: string): Promise<LeadScope> {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const [uRes, bRes] = await Promise.all([
    db().from("users").select("id, is_admin, position_id").eq("id", actorId).limit(1),
    db().from("user_branches").select("branch_id").eq("user_id", actorId),
  ]);
  const u = (uRes.data ?? [])[0];
  if (!u) throw new Error("Người dùng không tồn tại");
  return {
    actorId,
    isAdmin: Number(u.is_admin) === 1,
    branchIds: new Set(((bRes.data ?? []) as any[]).map((b) => b.branch_id)),
    isSalesManager: u.position_id === POS_SALES_MANAGER,
  };
}

const canSee = (s: LeadScope, l: any) =>
  s.isAdmin || s.branchIds.has(l.branch_id) || l.owner_id === s.actorId || (l.helper_ids ?? []).includes(s.actorId);
const canEdit = (s: LeadScope, l: any) =>
  s.isAdmin ||
  l.owner_id === s.actorId ||
  (l.helper_ids ?? []).includes(s.actorId) ||
  (s.isSalesManager && s.branchIds.has(l.branch_id));
const canAssign = (s: LeadScope, branchId: string) => s.isAdmin || (s.isSalesManager && s.branchIds.has(branchId));

function tableError(error: any) {
  if (!error) return;
  throw new Error(
    /customer_leads|lead_activities/.test(error.message) && /does not exist|schema cache/i.test(error.message)
      ? "Chưa chạy sql_migration_v22_customer_leads.sql"
      : error.message,
  );
}

async function loadLead(id: string) {
  const { data, error } = await db().from("customer_leads").select("*").eq("id", id).limit(1);
  tableError(error);
  const l = (data ?? [])[0];
  if (!l) throw new Error("Không tìm thấy khách tiềm năng");
  return l;
}

async function addActivity(leadId: string, userId: string | null, kind: string, content: string, at?: string) {
  const stamp = at ?? now();
  await db().from("lead_activities").insert({ id: uid(), lead_id: leadId, at: stamp, user_id: userId, kind, content });
  await db().from("customer_leads").update({ last_activity_at: stamp, updated_at: now() }).eq("id", leadId);
}

/** Tìm khách hàng theo SĐT (đã chuẩn hoá). Khớp đúng trước, rồi khớp theo dãy số. */
async function customerByPhone(phone?: string | null) {
  const d = digits(phone);
  if (d.length < 9) return null;
  const { data: exact } = await db().from("customers").select("id, name, phone").eq("phone", phone).limit(1);
  if (exact?.length) return exact[0];
  const { data: loose } = await db().from("customers").select("id, name, phone").ilike("phone", `%${d.slice(-9)}%`).limit(3);
  return (loose ?? []).find((c: any) => digits(c.phone).endsWith(d.slice(-9))) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tự chuyển "Đã chốt" theo đơn hàng
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lead đang mở có khách (hoặc SĐT khớp khách) và khách có đơn hoàn tất / đặt
 * cọc tạo từ ngày tiếp nhận đến +WIN_WINDOW_DAYS → "Đã chốt" (won_auto).
 * Idempotent: chỉ đụng lead đang mở.
 */
export async function syncLeadWins(opts: { customerIds?: string[] } = {}) {
  const sinceDate = new Date(Date.now() - (WIN_WINDOW_DAYS + 30) * 86400_000).toISOString().slice(0, 10);
  let q = db()
    .from("customer_leads")
    .select("id, lead_date, phone, customer_id, stage")
    .in("stage", OPEN_LEAD_STAGES)
    .gte("lead_date", sinceDate);
  if (opts.customerIds?.length) q = q.in("customer_id", opts.customerIds);
  const { data: leads, error } = await q;
  if (error) return { won: 0 };

  // Lead chưa nối khách nhưng có SĐT → thử nối (tra THEO LÔ theo SĐT đã chuẩn
  // hoá, không tra từng lead một — sau khi nhập dữ liệu cũ có hàng trăm lead).
  const unlinked = ((leads ?? []) as any[]).filter((l) => !l.customer_id && digits(l.phone).length >= 9);
  const phoneToCust = new Map<string, string>();
  for (const part of chunk([...new Set(unlinked.map((l) => l.phone))])) {
    const { data: cs } = await db().from("customers").select("id, phone").in("phone", part);
    for (const c of cs ?? []) if (!phoneToCust.has(c.phone)) phoneToCust.set(c.phone, c.id);
  }
  for (const l of unlinked) {
    const cid = phoneToCust.get(l.phone);
    if (!cid) continue;
    l.customer_id = cid;
    await db().from("customer_leads").update({ customer_id: cid, updated_at: now() }).eq("id", l.id);
  }

  const linked = ((leads ?? []) as any[]).filter((l) => l.customer_id);
  const custIds = [...new Set(linked.map((l) => l.customer_id))];
  const ordersByCust = new Map<string, any[]>();
  for (const part of chunk(custIds)) {
    const { data } = await db()
      .from("orders")
      .select("id, code, customer_id, total, status, created_at, completed_at")
      .in("customer_id", part)
      .in("status", ["completed", "reserved"]);
    for (const o of data ?? []) (ordersByCust.get(o.customer_id) ?? ordersByCust.set(o.customer_id, []).get(o.customer_id)).push(o);
  }

  let won = 0;
  for (const l of linked) {
    const start = Date.parse(`${l.lead_date}T00:00:00+07:00`);
    const end = start + WIN_WINDOW_DAYS * 86400_000;
    const hit = (ordersByCust.get(l.customer_id) ?? [])
      .filter((o) => {
        const t = Date.parse(o.created_at);
        return t >= start && t <= end;
      })
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    if (!hit) continue;
    const { data: upd } = await db()
      .from("customer_leads")
      .update({
        stage: "won", won_auto: true, won_order_id: hit.id, won_amount: Number(hit.total) || 0,
        won_at: hit.completed_at || hit.created_at, next_follow_up: null, updated_at: now(),
      })
      .eq("id", l.id)
      .in("stage", OPEN_LEAD_STAGES) // chống ghi đè nếu vừa có người đổi tay
      .select("id");
    if (upd?.length) {
      won++;
      await addActivity(l.id, null, "stage", `Tự chuyển "Đã chốt" theo đơn ${hit.code} (${Number(hit.total || 0).toLocaleString("vi-VN")}đ)`);
    }
  }
  return { won };
}

// ═══════════════════════════════════════════════════════════════════════════
// Đọc
// ═══════════════════════════════════════════════════════════════════════════

/** Danh mục cho form: chi nhánh trong phạm vi, nhân viên, hàng hóa đang kinh doanh. */
export const getLeadMetaFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  const s = await leadScope(data?.actorId);
  const [br, us, ub, pr] = await Promise.all([
    db().from("branches").select("id, name").order("name"),
    db().from("users").select("id, full_name, position_id, active, is_admin").order("full_name"),
    db().from("user_branches").select("user_id, branch_id"),
    db().from("products").select("id, name, sku, is_hidden").order("name"),
  ]);
  const userBranches = new Map<string, string[]>();
  for (const r of (ub.data ?? []) as any[]) userBranches.set(r.user_id, [...(userBranches.get(r.user_id) ?? []), r.branch_id]);
  const products = (pr.error
    ? ((await db().from("products").select("id, name, sku").order("name")).data ?? [])
    : (pr.data ?? []).filter((p: any) => p.is_hidden !== true)) as any[];
  return {
    branches: ((br.data ?? []) as any[]).filter((b) => s.isAdmin || s.branchIds.has(b.id)),
    allBranches: (br.data ?? []) as any[],
    staff: ((us.data ?? []) as any[])
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, full_name: u.full_name, position_id: u.position_id, branch_ids: userBranches.get(u.id) ?? [] })),
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
    me: { isAdmin: s.isAdmin, isSalesManager: s.isSalesManager, branchIds: [...s.branchIds] },
  };
});

type ListArgs = {
  actorId?: string;
  from?: string;
  to?: string;
  branchId?: string;
  stage?: string; // "open" | "all" | stage key
  ownerId?: string;
  source?: string;
  followUp?: "due";
  q?: string;
  page?: number;
  pageSize?: number;
};

function applyScope(q: any, s: LeadScope) {
  if (s.isAdmin) return q;
  const ids = [...s.branchIds];
  const parts = [`owner_id.eq.${s.actorId}`, `helper_ids.cs.{${s.actorId}}`];
  if (ids.length) parts.unshift(`branch_id.in.(${ids.join(",")})`);
  return q.or(parts.join(","));
}

function applyFilters(q: any, a: ListArgs, withStage = true) {
  if (a.from) q = q.gte("lead_date", a.from);
  if (a.to) q = q.lte("lead_date", a.to);
  if (a.branchId) q = q.eq("branch_id", a.branchId);
  if (a.ownerId) q = a.ownerId === "__none" ? q.is("owner_id", null) : q.eq("owner_id", a.ownerId);
  if (a.source) q = a.source === "__none" ? q.is("source", null) : q.eq("source", a.source);
  if (a.followUp === "due") q = q.lte("next_follow_up", todayVN()).in("stage", OPEN_LEAD_STAGES);
  const text = String(a.q ?? "").trim();
  if (text) {
    const d = digits(text);
    const safe = text.replace(/[,()]/g, " ");
    q = q.or(d.length >= 4 ? `name.ilike.%${safe}%,phone.ilike.%${d}%` : `name.ilike.%${safe}%`);
  }
  if (withStage) {
    if (!a.stage || a.stage === "open") q = q.in("stage", OPEN_LEAD_STAGES);
    else if (a.stage !== "all") q = q.eq("stage", a.stage);
  }
  return q;
}

export const listLeadsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: ListArgs }) => {
  const s = await leadScope(data?.actorId);
  // Tự chốt theo đơn trước khi đọc (idempotent, chỉ lead đang mở).
  await syncLeadWins().catch(() => undefined);

  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(5000, Math.max(1, Number(data.pageSize) || 50));
  let q = db().from("customer_leads").select("*", { count: "exact" });
  q = applyFilters(applyScope(q, s), data);
  q = q.order("lead_date", { ascending: false }).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data: rows, error, count } = await q;
  tableError(error);

  // Đếm theo trạng thái (cùng bộ lọc, bỏ lọc trạng thái) cho các nút lọc nhanh.
  const stageCounts: Record<string, number> = {};
  const cq = applyFilters(applyScope(db().from("customer_leads").select("stage"), s), data, false);
  const { data: st } = await cq;
  for (const r of (st ?? []) as any[]) stageCounts[r.stage] = (stageCounts[r.stage] ?? 0) + 1;

  // Lần chăm gần nhất của từng lead trong trang.
  const ids = ((rows ?? []) as any[]).map((r) => r.id);
  const lastAct = new Map<string, any>();
  for (const part of chunk(ids)) {
    const { data: acts } = await db()
      .from("lead_activities")
      .select("lead_id, at, kind, content")
      .in("lead_id", part)
      .neq("kind", "stage")
      .order("at", { ascending: false });
    for (const a of (acts ?? []) as any[]) if (!lastAct.has(a.lead_id)) lastAct.set(a.lead_id, a);
  }
  const orderIds = ((rows ?? []) as any[]).map((r) => r.won_order_id).filter(Boolean);
  const orderCode = new Map<string, string>();
  for (const part of chunk(orderIds)) {
    const { data: os } = await db().from("orders").select("id, code").in("id", part);
    for (const o of os ?? []) orderCode.set(o.id, o.code);
  }

  return {
    rows: ((rows ?? []) as any[]).map((r) => ({
      ...r,
      last_activity: lastAct.get(r.id) ?? null,
      won_order_code: r.won_order_id ? orderCode.get(r.won_order_id) ?? null : null,
      can_edit: canEdit(s, r),
    })),
    total: count ?? 0,
    stageCounts,
    page,
    pageSize,
  };
});

export const getLeadFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  const s = await leadScope(data?.actorId);
  const l = await loadLead(data.id);
  if (!canSee(s, l)) throw new Error("Bạn không có quyền xem khách tiềm năng này");
  const [acts, cust, order] = await Promise.all([
    db().from("lead_activities").select("*").eq("lead_id", l.id).order("at", { ascending: false }),
    l.customer_id ? db().from("customers").select("id, name, phone, group_name").eq("id", l.customer_id).limit(1) : Promise.resolve({ data: [] }),
    l.won_order_id ? db().from("orders").select("id, code, total, status, created_at").eq("id", l.won_order_id).limit(1) : Promise.resolve({ data: [] }),
  ]);
  let customerOrders = 0;
  if (l.customer_id) {
    const { count } = await db().from("orders").select("id", { count: "exact", head: true }).eq("customer_id", l.customer_id).eq("status", "completed");
    customerOrders = count ?? 0;
  }
  return {
    lead: { ...l, can_edit: canEdit(s, l), can_assign: canAssign(s, l.branch_id) },
    activities: acts.data ?? [],
    customer: (cust as any).data?.[0] ? { ...(cust as any).data[0], completed_orders: customerOrders } : null,
    order: (order as any).data?.[0] ?? null,
  };
});

/** Cảnh báo trùng theo SĐT: khách đã có + lead đang mở. */
export const findLeadDuplicatesFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; phone?: string; excludeId?: string } }) => {
    await leadScope(data?.actorId);
    const d = digits(data.phone);
    if (d.length < 9) return { customer: null, leads: [] };
    const phone = normalizePhoneForStorage(data.phone);
    const c = await customerByPhone(phone);
    let completed = 0;
    if (c) {
      const { count } = await db().from("orders").select("id", { count: "exact", head: true }).eq("customer_id", c.id).eq("status", "completed");
      completed = count ?? 0;
    }
    const { data: ls } = await db()
      .from("customer_leads")
      .select("id, name, lead_date, stage, owner_id, branch_id")
      .ilike("phone", `%${d.slice(-9)}%`)
      .in("stage", OPEN_LEAD_STAGES)
      .limit(5);
    return {
      customer: c ? { ...c, completed_orders: completed } : null,
      leads: ((ls ?? []) as any[]).filter((l) => l.id !== data.excludeId),
    };
  },
);

/** Khung "Cần chăm hôm nay" ở trang Tổng quan: lead mình phụ trách / hỗ trợ tới hẹn. */
export const myFollowUpsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  const s = await leadScope(data?.actorId);
  const { data: rows, error } = await db()
    .from("customer_leads")
    .select("id, name, phone, lead_date, stage, next_follow_up, branch_id, interest_note")
    .or(`owner_id.eq.${s.actorId},helper_ids.cs.{${s.actorId}}`)
    .in("stage", OPEN_LEAD_STAGES)
    .lte("next_follow_up", todayVN())
    .order("next_follow_up", { ascending: true })
    .limit(30);
  if (error) return { rows: [], today: todayVN(), ready: false };
  return { rows: rows ?? [], today: todayVN(), ready: true };
});

/** Lịch sử tư vấn của một khách (trang chi tiết khách). */
export const listCustomerLeadsFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; customerId: string } }) => {
    await leadScope(data?.actorId);
    const { data: rows, error } = await db()
      .from("customer_leads")
      .select("id, lead_date, branch_id, stage, interest_note, interest_product_ids, owner_id, won_amount, lost_reason")
      .eq("customer_id", data.customerId)
      .order("lead_date", { ascending: false });
    if (error) return { rows: [] };
    return { rows: rows ?? [] };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Ghi
// ═══════════════════════════════════════════════════════════════════════════

export const upsertLeadFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const s = await leadScope(data?.actorId);
  const name = String(data.name ?? "").trim();
  if (!name) throw new Error("Nhập tên khách");
  if (!data.branch_id) throw new Error("Chọn showroom");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.lead_date ?? ""))) throw new Error("Ngày tiếp nhận không hợp lệ");
  const source = String(data.source ?? "").trim() || null;
  const sourceNote = String(data.source_note ?? "").trim() || null;
  if (!data.id && !source) throw new Error('Chọn "Biết Mr.Vũ qua đâu?"');
  if (source && !CUSTOMER_SOURCES.some((x) => x.key === source)) throw new Error("Nguồn không hợp lệ");
  if (source === "khac" && !sourceNote) throw new Error('Chọn "Khác" thì ghi rõ nguồn');
  const phone = normalizePhoneForStorage(data.phone) || null;
  const helperIds = [...new Set(((data.helper_ids ?? []) as string[]).filter(Boolean))];

  const row: any = {
    branch_id: data.branch_id,
    lead_date: data.lead_date,
    name,
    phone,
    address: String(data.address ?? "").trim() || null,
    interest_product_ids: [...new Set(((data.interest_product_ids ?? []) as string[]).filter(Boolean))],
    interest_note: String(data.interest_note ?? "").trim() || null,
    next_follow_up: data.next_follow_up || null,
    updated_at: now(),
  };
  if (source) {
    row.source = source;
    row.source_note = source === "khac" ? sourceNote : null;
  }

  if (data.id) {
    const cur = await loadLead(data.id);
    if (!canEdit(s, cur)) throw new Error("Bạn chỉ sửa được khách tiềm năng mình phụ trách / hỗ trợ");
    if (data.branch_id !== cur.branch_id && !(s.isAdmin || s.branchIds.has(data.branch_id))) {
      throw new Error("Showroom này không thuộc chi nhánh bạn được gán");
    }
    // Đổi người phụ trách: chỉ admin / quản lý bán hàng.
    if (data.owner_id !== undefined && data.owner_id !== cur.owner_id) {
      if (!canAssign(s, cur.branch_id)) throw new Error("Chỉ quản lý bán hàng / admin được đổi người phụ trách");
      row.owner_id = data.owner_id || null;
    }
    row.helper_ids = helperIds;
    if (!cur.customer_id && phone) {
      const c = await customerByPhone(phone);
      if (c) row.customer_id = c.id;
    }
    const { error } = await db().from("customer_leads").update(row).eq("id", cur.id);
    tableError(error);
    return { id: cur.id };
  }

  if (!s.isAdmin && !s.branchIds.has(data.branch_id)) throw new Error("Showroom này không thuộc chi nhánh bạn được gán");
  const ownerId = data.owner_id && canAssign(s, data.branch_id) ? data.owner_id : s.actorId;
  const c = phone ? await customerByPhone(phone) : null;
  const id = uid();
  const { error } = await db().from("customer_leads").insert({
    id, ...row,
    owner_id: ownerId,
    helper_ids: helperIds.filter((h) => h !== ownerId),
    stage: "new",
    customer_id: c?.id ?? null,
    created_by: s.actorId,
    created_at: now(),
  });
  tableError(error);
  const firstNote = String(data.first_note ?? "").trim();
  if (firstNote) await addActivity(id, s.actorId, data.first_kind || "note", firstNote);
  if (firstNote) await db().from("customer_leads").update({ stage: "consulting" }).eq("id", id);
  await logActivity({ action: "create_lead", detail: `Thêm khách tiềm năng: ${name}`, employee_id: s.actorId });
  // Khách cũ đã có đơn sau ngày tiếp nhận → tự chốt ngay.
  if (c) await syncLeadWins({ customerIds: [c.id] }).catch(() => undefined);
  return { id };
});

/** Ghi một lần chăm sóc (+ đặt / xoá ngày hẹn chăm tiếp). */
export const addLeadActivityFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; leadId: string; kind: string; content: string; nextFollowUp?: string | null } }) => {
    const s = await leadScope(data?.actorId);
    const l = await loadLead(data.leadId);
    if (!canEdit(s, l)) throw new Error("Bạn chỉ ghi chăm sóc cho khách mình phụ trách / hỗ trợ");
    const content = String(data.content ?? "").trim();
    if (!content) throw new Error("Nhập nội dung");
    if (!["note", "call", "zalo", "quote", "visit"].includes(data.kind)) throw new Error("Loại chăm sóc không hợp lệ");
    await addActivity(l.id, s.actorId, data.kind, content);
    const patch: any = { updated_at: now() };
    if (data.nextFollowUp !== undefined) patch.next_follow_up = data.nextFollowUp || null;
    // Lần chăm đầu tiên → "Đang tư vấn"; gửi báo giá → "Đã báo giá"; khách ra showroom → "Hẹn ra showroom" (nếu còn ở bước trước).
    const order = ["new", "consulting", "appointment", "quoted"];
    const target = data.kind === "quote" ? "quoted" : data.kind === "visit" ? "appointment" : "consulting";
    if (order.includes(l.stage) && order.indexOf(target) > order.indexOf(l.stage)) {
      patch.stage = target;
      await addActivity(l.id, s.actorId, "stage", `${stageLabel(l.stage)} → ${stageLabel(target)}`);
    }
    await db().from("customer_leads").update(patch).eq("id", l.id);
    return { ok: true };
  },
);

export const setLeadStageFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; leadId: string; stage: string; lostReason?: string; lostNote?: string; wonAmount?: number; wonOrderCode?: string } }) => {
    const s = await leadScope(data?.actorId);
    const l = await loadLead(data.leadId);
    if (!canEdit(s, l)) throw new Error("Bạn chỉ đổi trạng thái khách mình phụ trách / hỗ trợ");
    if (!LEAD_STAGES.some((x) => x.key === data.stage)) throw new Error("Trạng thái không hợp lệ");
    const patch: any = { stage: data.stage, updated_at: now() };
    let detail = `${stageLabel(l.stage)} → ${stageLabel(data.stage)}`;
    if (data.stage === "lost") {
      if (!LEAD_LOST_REASONS.some((r) => r.key === data.lostReason)) throw new Error("Chọn lý do không chốt");
      if (data.lostReason === "khac" && !String(data.lostNote ?? "").trim()) throw new Error("Ghi rõ lý do");
      patch.lost_reason = data.lostReason;
      patch.lost_note = String(data.lostNote ?? "").trim() || null;
      patch.next_follow_up = null;
      detail += ` (${LEAD_LOST_REASONS.find((r) => r.key === data.lostReason)?.label}${patch.lost_note ? `: ${patch.lost_note}` : ""})`;
    } else {
      patch.lost_reason = null;
      patch.lost_note = null;
    }
    if (data.stage === "won") {
      patch.won_auto = false;
      patch.won_at = now();
      patch.next_follow_up = null;
      const code = String(data.wonOrderCode ?? "").trim();
      if (code) {
        const { data: os } = await db().from("orders").select("id, code, total").eq("code", code).limit(1);
        if (!os?.length) throw new Error(`Không tìm thấy đơn ${code}`);
        patch.won_order_id = os[0].id;
        patch.won_amount = Number(os[0].total) || 0;
        detail += ` — đơn ${code}`;
      } else {
        patch.won_amount = Number(data.wonAmount) || null;
        if (patch.won_amount) detail += ` — ${patch.won_amount.toLocaleString("vi-VN")}đ`;
      }
    } else if (l.stage === "won") {
      patch.won_order_id = null;
      patch.won_amount = null;
      patch.won_at = null;
      patch.won_auto = false;
    }
    const { error } = await db().from("customer_leads").update(patch).eq("id", l.id);
    tableError(error);
    await addActivity(l.id, s.actorId, "stage", detail);
    return { ok: true };
  },
);

/** Tạo khách hàng từ lead (mang theo tên, SĐT, địa chỉ, nguồn) rồi nối vào lead. */
export const convertLeadToCustomerFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; leadId: string; groupName: string } }) => {
    const s = await leadScope(data?.actorId);
    const l = await loadLead(data.leadId);
    if (!canEdit(s, l)) throw new Error("Bạn chỉ thao tác được khách mình phụ trách / hỗ trợ");
    if (l.customer_id) return { customerId: l.customer_id, existed: true };
    const existing = l.phone ? await customerByPhone(l.phone) : null;
    let customerId = existing?.id;
    if (!customerId) {
      if (!String(data.groupName ?? "").trim()) throw new Error("Chọn nhóm khách hàng");
      const { data: me } = await db().from("users").select("full_name").eq("id", s.actorId).limit(1);
      customerId = uid();
      const { error } = await db().from("customers").insert({
        id: customerId,
        name: l.name,
        phone: l.phone,
        address: l.address,
        group_name: data.groupName,
        customer_type: "ca_nhan",
        debt: 0,
        debt_adjustment: 0,
        note: l.interest_note ? `Quan tâm: ${l.interest_note}` : null,
        created_by: s.actorId,
        created_by_name: me?.[0]?.full_name ?? null,
        created_at: now(),
      });
      if (error) throw new Error(error.message);
      if (l.source) {
        await db().from("customers").update({ source: l.source, source_note: l.source_note }).eq("id", customerId).then(() => undefined, () => undefined);
      }
      await logActivity({ action: "create_customer", detail: `Thêm khách hàng từ khách tiềm năng: ${l.name}`, employee_id: s.actorId });
    }
    await db().from("customer_leads").update({ customer_id: customerId, updated_at: now() }).eq("id", l.id);
    await addActivity(l.id, s.actorId, "note", existing ? `Nối với khách hàng có sẵn: ${existing.name}` : "Đã chuyển thành khách hàng");
    return { customerId, existed: Boolean(existing) };
  },
);

export const deleteLeadFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { actorId?: string; id: string } }) => {
  const s = await leadScope(data?.actorId);
  const l = await loadLead(data.id);
  if (!(s.isAdmin || canAssign(s, l.branch_id))) throw new Error("Chỉ quản lý bán hàng / admin được xoá");
  const { error } = await db().from("customer_leads").delete().eq("id", l.id);
  tableError(error);
  await logActivity({ action: "delete_lead", detail: `Xoá khách tiềm năng: ${l.name}`, employee_id: s.actorId });
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════
// Báo cáo
// ═══════════════════════════════════════════════════════════════════════════

export const leadReportFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; from: string; to: string; branchId?: string } }) => {
    const s = await leadScope(data?.actorId);
    await syncLeadWins().catch(() => undefined);
    const all: any[] = [];
    for (let off = 0; ; off += 1000) {
      let q = db().from("customer_leads").select("id, branch_id, lead_date, stage, source, owner_id, lost_reason, won_amount, won_at, interest_product_ids, created_at");
      q = applyFilters(applyScope(q, s), { from: data.from, to: data.to, branchId: data.branchId, stage: "all" });
      const { data: rows, error } = await q.order("lead_date").range(off, off + 999);
      tableError(error);
      all.push(...(rows ?? []));
      if ((rows ?? []).length < 1000) break;
    }

    const agg = () => ({ leads: 0, won: 0, lost: 0, open: 0, revenue: 0, days: 0, daysN: 0 });
    const bump = (m: Map<string, any>, k: string, l: any) => {
      const r = m.get(k) ?? agg();
      r.leads++;
      if (l.stage === "won") {
        r.won++;
        r.revenue += Number(l.won_amount) || 0;
        if (l.won_at) {
          r.days += Math.max(0, (Date.parse(l.won_at) - Date.parse(`${l.lead_date}T00:00:00+07:00`)) / 86400_000);
          r.daysN++;
        }
      } else if (l.stage === "lost") r.lost++;
      else r.open++;
      m.set(k, r);
    };
    const byOwner = new Map(), byBranch = new Map(), bySource = new Map(), byMonth = new Map(), byProduct = new Map();
    const lost = new Map<string, number>();
    for (const l of all) {
      bump(byOwner, l.owner_id ?? "__none", l);
      bump(byBranch, l.branch_id ?? "__none", l);
      bump(bySource, l.source ?? "__none", l);
      bump(byMonth, `${String(l.lead_date).slice(0, 7)}|${l.branch_id ?? "__none"}`, l);
      for (const p of l.interest_product_ids ?? []) bump(byProduct, p, l);
      if (l.stage === "lost") lost.set(l.lost_reason ?? "__none", (lost.get(l.lost_reason ?? "__none") ?? 0) + 1);
    }
    const out = (m: Map<string, any>) =>
      [...m.entries()].map(([key, r]) => ({ key, ...r, rate: r.leads ? r.won / r.leads : 0, avgDays: r.daysN ? r.days / r.daysN : null }));
    const productIds = [...byProduct.keys()];
    const names = new Map<string, string>();
    for (const part of chunk(productIds)) {
      const { data: ps } = await db().from("products").select("id, name").in("id", part);
      for (const p of ps ?? []) names.set(p.id, p.name);
    }
    return {
      total: all.length,
      byOwner: out(byOwner).sort((a, b) => b.leads - a.leads),
      byBranch: out(byBranch).sort((a, b) => b.leads - a.leads),
      bySource: out(bySource).sort((a, b) => b.leads - a.leads),
      byMonth: out(byMonth).sort((a, b) => a.key.localeCompare(b.key)),
      byProduct: out(byProduct).map((r) => ({ ...r, name: names.get(r.key) ?? r.key })).sort((a, b) => b.leads - a.leads).slice(0, 15),
      lostReasons: [...lost.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n),
    };
  },
);

/** Dữ liệu xuất Excel kiểu file cũ: lead + toàn bộ nhật ký chăm sóc gộp thành chữ. */
export const exportLeadsFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; from?: string; to?: string; branchId?: string } }) => {
    const s = await leadScope(data?.actorId);
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      let q = db().from("customer_leads").select("*");
      q = applyFilters(applyScope(q, s), { from: data.from, to: data.to, branchId: data.branchId, stage: "all" });
      const { data: part, error } = await q.order("lead_date").order("created_at").range(off, off + 999);
      tableError(error);
      rows.push(...(part ?? []));
      if ((part ?? []).length < 1000) break;
    }
    const acts = new Map<string, any[]>();
    for (const part of chunk(rows.map((r) => r.id))) {
      const { data: as } = await db().from("lead_activities").select("lead_id, at, kind, content").in("lead_id", part).neq("kind", "stage").order("at");
      for (const a of as ?? []) acts.set(a.lead_id, [...(acts.get(a.lead_id) ?? []), a]);
    }
    const orderIds = rows.map((r) => r.won_order_id).filter(Boolean);
    const codes = new Map<string, string>();
    for (const part of chunk(orderIds)) {
      const { data: os } = await db().from("orders").select("id, code").in("id", part);
      for (const o of os ?? []) codes.set(o.id, o.code);
    }
    return rows.map((r) => ({
      ...r,
      won_order_code: r.won_order_id ? codes.get(r.won_order_id) ?? null : null,
      care_text: (acts.get(r.id) ?? [])
        .map((a) => `${new Date(a.at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}: ${a.content}`)
        .join("\n"),
    }));
  },
);
