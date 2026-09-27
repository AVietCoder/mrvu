// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { fetchRows, uid, now, logActivity } from "./supabase";
import { computeTechPay } from "./schedule.functions";
import { insertCashVoucher } from "./cash.functions";
import { fetchAllPaged } from "./reports.functions";
import { sellerCollections } from "./sales-collections";

/**
 * Nhân sự: Lịch trực ca + Chấm công + Bảng lương (migration v13).
 *
 * Thay cho 2 file Excel làm tay mỗi tháng. Công thức lương sao y file
 * "BẢNG LƯƠNG KT HCM":
 *   công thực tế   = X + N/2 + L
 *   lương theo công = LCB / công chuẩn × công thực tế
 *   tăng ca        = LCB / công chuẩn / 8 × (giờ ×1,5 + giờ ×2,0)
 *   tổng thu nhập  = lương theo công + lương doanh số + DS bán hàng + tăng ca
 *                    + xăng xe + thưởng + phụ cấp
 *   khấu trừ       = tạm ứng + BHXH + công đoàn + trừ khác
 *   thực lĩnh      = tổng thu nhập − khấu trừ
 *
 * Bảng lương/chấm công/hồ sơ lương bật RLS deny-all → đọc ghi qua service
 * role SAU KHI kiểm quyền. Lịch trực thì ai cũng xem được.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tiện ích chung
// ═══════════════════════════════════════════════════════════════════════════

type Perm = "manage_payroll" | "manage_roster";

/**
 * Phạm vi của người thực hiện sau khi đã kiểm quyền.
 *   isAdmin   → thấy / sửa tất cả.
 *   branchIds → các chi nhánh người này được gán (bảng user_branches).
 *               Lịch trực: chỉ sửa ca / nhân viên thuộc các chi nhánh này.
 *               Bảng lương: chỉ dùng để chọn QUỸ chi nhánh khi chi lương.
 *   userIds   → CHỈ với "Quản lý lương nhân sự": CHÍNH MÌNH (mặc định) + những
 *               nhân viên admin phân thêm ở tab "Phân việc" (payroll_assignments, v16).
 */
type Scope = { actorId: string; isAdmin: boolean; branchIds: Set<string>; userIds?: Set<string> };

/** Kiểm quyền ở SERVER (mẫu assertCanSend của care.functions.ts) và trả phạm vi. */
async function assertPerm(actorId: string | undefined, perm: Perm): Promise<Scope> {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const rows = await fetchRows<any>("users", { eq: { id: actorId }, select: "id, is_admin", limit: 1 });
  const actor = rows[0];
  if (!actor) throw new Error("Người dùng không tồn tại");
  if (Number(actor.is_admin) === 1) return { actorId, isAdmin: true, branchIds: new Set() };

  const [perms, branches] = await Promise.all([
    fetchRows<any>("user_permissions", { eq: { user_id: actorId }, select: "permission" }),
    fetchRows<any>("user_branches", { eq: { user_id: actorId }, select: "branch_id" }),
  ]);
  if (!perms.some((p: any) => p.permission === perm)) {
    throw new Error(
      perm === "manage_payroll"
        ? 'Bạn không có quyền "Quản lý lương nhân sự"'
        : 'Bạn không có quyền "Quản lý lịch trực"',
    );
  }
  const branchIds = new Set<string>(branches.map((b: any) => b.branch_id));
  if (perm === "manage_payroll") {
    // Lương: phạm vi là danh sách nhân viên admin phân cho, KHÔNG theo chi nhánh.
    const { data, error } = await getSupabaseAdmin()
      .from("payroll_assignments")
      .select("user_id")
      .eq("manager_id", actorId);
    if (error) {
      throw new Error(`${error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v16_payroll_assignments.sql.`);
    }
    // Mặc định luôn gồm CHÍNH MÌNH: tự chấm công và quản lý lương bản thân.
    const userIds = new Set<string>([actorId, ...((data ?? []) as any[]).map((r) => r.user_id)]);
    return { actorId, isAdmin: false, branchIds, userIds };
  }
  if (!branchIds.size) {
    throw new Error("Tài khoản của bạn chưa được gán chi nhánh nào — nhờ quản trị viên gán chi nhánh để quản lý.");
  }
  return { actorId, isAdmin: false, branchIds };
}

/** Chỉ admin — dùng cho tab "Phân việc". */
async function assertAdmin(actorId: string | undefined) {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const rows = await fetchRows<any>("users", { eq: { id: actorId }, select: "id, is_admin", limit: 1 });
  if (Number(rows[0]?.is_admin) !== 1) throw new Error("Chỉ quản trị viên được phân việc quản lý lương");
}

/** Chi nhánh của từng nhân viên (user_branches). */
async function userBranchMap(userIds?: string[]): Promise<Map<string, Set<string>>> {
  const db = getSupabaseAdmin();
  let q = db.from("user_branches").select("user_id, branch_id");
  if (userIds) {
    if (!userIds.length) return new Map();
    q = q.in("user_id", userIds);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const m = new Map<string, Set<string>>();
  for (const r of (data ?? []) as any[]) {
    (m.get(r.user_id) ?? m.set(r.user_id, new Set()).get(r.user_id)).add(r.branch_id);
  }
  return m;
}

/**
 * Nhân viên có nằm trong phạm vi không:
 *   - Bảng lương (scope.userIds): đúng người admin đã phân — không liên quan chi nhánh.
 *   - Lịch trực: có ÍT NHẤT MỘT chi nhánh trùng với người quản lý. Nhân viên
 *     không gắn chi nhánh nào → chỉ admin.
 */
function inScope(scope: Scope, userBranches: Set<string> | undefined, userId?: string): boolean {
  if (scope.isAdmin) return true;
  if (scope.userIds) return Boolean(userId && scope.userIds.has(userId));
  if (!userBranches?.size) return false;
  for (const b of userBranches) if (scope.branchIds.has(b)) return true;
  return false;
}

async function scopedUserIds(scope: Scope, userIds: string[]): Promise<string[]> {
  if (scope.isAdmin) return userIds;
  if (scope.userIds) return userIds.filter((u) => scope.userIds!.has(u));
  const map = await userBranchMap(userIds);
  return userIds.filter((u) => inScope(scope, map.get(u), u));
}

async function assertUserInScope(scope: Scope, userId: string) {
  if (scope.isAdmin) return;
  const ok = await scopedUserIds(scope, [userId]);
  if (!ok.length) {
    throw new Error(
      scope.userIds
        ? "Bạn chưa được admin phân quản lý lương nhân viên này"
        : "Nhân viên này không thuộc chi nhánh bạn quản lý",
    );
  }
}

function assertBranchInScope(scope: Scope, branchId: string | null | undefined) {
  if (scope.isAdmin) return;
  if (!branchId || !scope.branchIds.has(branchId)) {
    throw new Error("Chi nhánh này không thuộc phạm vi bạn quản lý");
  }
}

async function shiftBranch(shiftId: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db.from("duty_shifts").select("branch_id").eq("id", shiftId).limit(1);
  return (data ?? [])[0]?.branch_id ?? null;
}

/** "2026-06" → ngày đầu, ngày đầu tháng sau, danh sách ngày trong tháng. */
function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error("Tháng không hợp lệ (định dạng YYYY-MM)");
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  return { from, next, dates, year: y, monthNum: m };
}

const round = (n: number) => Math.round(Number(n) || 0);
const num = (v: any) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

async function activeUsers() {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("users")
    .select("id, full_name, username, phone, active")
    .order("full_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).filter((u) => u.active !== false);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) LỊCH TRỰC CA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lịch trực theo THÁNG ({ month }) hoặc theo KHOẢNG NGÀY ({ from, to }) — xem
 * theo tuần cần khoảng ngày vì một tuần có thể vắt qua 2 tháng.
 * Ai cũng xem được; quyền sửa kiểm ở các hàm ghi.
 */
export const getRosterMonthFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { month?: string; from?: string; to?: string } }) => {
    let from: string, next: string, dates: string[], year: number;
    if (data?.from && data?.to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.from) || !/^\d{4}-\d{2}-\d{2}$/.test(data.to) || data.to < data.from) {
        throw new Error("Khoảng ngày không hợp lệ");
      }
      from = data.from;
      dates = [];
      for (let d = data.from; d <= data.to; ) {
        dates.push(d);
        const [y, m, dd] = d.split("-").map(Number);
        d = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
        if (dates.length > 62) throw new Error("Khoảng ngày tối đa 62 ngày");
      }
      const [ty, tm, td] = data.to.split("-").map(Number);
      next = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
      year = ty;
    } else {
      const r = monthRange(data?.month);
      ({ from, next, dates, year } = r);
    }
    const db = getSupabaseAdmin();

    const [shiftsRes, entriesRes, yearRes, branchesRes, users, ubMap] = await Promise.all([
      db.from("duty_shifts").select("*").order("sort_order"),
      db.from("duty_entries").select("*").gte("work_date", from).lt("work_date", next),
      // Luỹ kế năm đến hết khoảng đang xem — thay cho số đếm tay "VY 3", "lễ 2".
      db.from("duty_entries").select("user_id, kind").gte("work_date", `${year}-01-01`).lt("work_date", next).in("kind", ["off", "holiday", "half_off"]),
      db.from("branches").select("id, name").order("name"),
      activeUsers(),
      userBranchMap(),
    ]);

    if (shiftsRes.error) {
      throw new Error(
        `${shiftsRes.error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v13_hr.sql.`,
      );
    }

    const entries = (entriesRes.data ?? []) as any[];
    const summary: Record<string, any> = {};
    const bump = (uid_: string, key: string) => {
      const r = (summary[uid_] ||= { shifts: 0, off: 0, holiday: 0, half_off: 0, year_off: 0, year_holiday: 0, year_half_off: 0 });
      r[key] += 1;
    };
    for (const e of entries) {
      if (e.kind === "work") bump(e.user_id, "shifts");
      else if (e.kind === "half_off") {
        bump(e.user_id, "half_off");
        if (e.shift_id) bump(e.user_id, "shifts");
      } else bump(e.user_id, e.kind);
    }
    for (const e of (yearRes.data ?? []) as any[]) {
      bump(e.user_id, e.kind === "off" ? "year_off" : e.kind === "holiday" ? "year_holiday" : "year_half_off");
    }

    return {
      month: data.month ?? null,
      dates,
      shifts: shiftsRes.data ?? [],
      entries,
      branches: branchesRes.data ?? [],
      // Kèm chi nhánh của từng người để giao diện lọc được danh sách chọn
      // theo phạm vi người quản lý (server vẫn kiểm lại khi ghi).
      users: users.map((u) => ({ id: u.id, full_name: u.full_name, branch_ids: [...(ubMap.get(u.id) ?? [])] })),
      summary,
    };
  },
);

/**
 * Xếp người vào MỘT ô (1 ngày × 1 ca). Thay toàn bộ danh sách của ô đó.
 * Ai được xếp vào ca thì gỡ trạng thái OFF/lễ của họ trong ngày đó — một
 * người không thể vừa nghỉ vừa trực.
 */
export const setRosterCellFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: {
      date: string;
      shiftId: string;
      people: { user_id: string; half?: boolean; note?: string }[];
      actorId?: string;
    };
  }) => {
    const scope = await assertPerm(data?.actorId, "manage_roster");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error("Ngày không hợp lệ");
    // Chỉ xếp được ca thuộc chi nhánh mình quản lý. Người được xếp thì có thể
    // ở chi nhánh khác (điều người sang hỗ trợ là chuyện bình thường).
    assertBranchInScope(scope, await shiftBranch(data.shiftId));
    const db = getSupabaseAdmin();

    const people = [...new Map((data.people ?? []).filter((p) => p?.user_id).map((p) => [p.user_id, p])).values()];

    const { error: delErr } = await db
      .from("duty_entries")
      .delete()
      .eq("work_date", data.date)
      .eq("shift_id", data.shiftId);
    if (delErr) throw new Error(delErr.message);

    if (people.length) {
      await db
        .from("duty_entries")
        .delete()
        .eq("work_date", data.date)
        .is("shift_id", null)
        .in("kind", ["off", "holiday"])
        .in("user_id", people.map((p) => p.user_id));

      const { error } = await db.from("duty_entries").insert(
        people.map((p) => ({
          id: uid(),
          work_date: data.date,
          user_id: p.user_id,
          shift_id: data.shiftId,
          kind: p.half ? "half_off" : "work",
          note: p.note?.trim() || null,
          created_by: data.actorId ?? null,
          created_at: now(),
        })),
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true, count: people.length };
  },
);

/**
 * Đánh dấu nghỉ cả ngày (off / lễ) hoặc bỏ đánh dấu (kind = null).
 * Đánh dấu nghỉ thì gỡ người đó khỏi mọi ca trong ngày.
 */
export const setDayOffFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { date: string; userId: string; kind: "off" | "holiday" | null; note?: string; actorId?: string };
  }) => {
    const scope = await assertPerm(data?.actorId, "manage_roster");
    await assertUserInScope(scope, data.userId);
    const db = getSupabaseAdmin();

    await db.from("duty_entries").delete().eq("work_date", data.date).eq("user_id", data.userId).is("shift_id", null);

    let removedShifts = 0;
    if (data.kind) {
      const { data: removed } = await db
        .from("duty_entries")
        .delete()
        .eq("work_date", data.date)
        .eq("user_id", data.userId)
        .not("shift_id", "is", null)
        .select("id");
      removedShifts = (removed ?? []).length;

      const { error } = await db.from("duty_entries").insert({
        id: uid(),
        work_date: data.date,
        user_id: data.userId,
        shift_id: null,
        kind: data.kind,
        note: data.note?.trim() || null,
        created_by: data.actorId ?? null,
        created_at: now(),
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true, removedShifts };
  },
);

/**
 * Sao chép lịch 7 ngày → 7 ngày khác (vd tuần trước sang tuần này).
 * Đây là thao tác tốn công nhất khi làm Excel vì lịch lặp theo tuần.
 * Tuần đích đã có dữ liệu thì chỉ ghi đè khi overwrite = true.
 */
export const copyRosterWeekFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { fromStart: string; toStart: string; branchId?: string; overwrite?: boolean; actorId?: string };
  }) => {
    const scope = await assertPerm(data?.actorId, "manage_roster");
    // Người quản lý chi nhánh bắt buộc chọn chi nhánh của mình — không được
    // chép đè lịch của cả hệ thống.
    if (!scope.isAdmin) {
      if (!data.branchId) throw new Error("Chọn chi nhánh trước khi sao chép lịch");
      assertBranchInScope(scope, data.branchId);
    }
    const db = getSupabaseAdmin();

    const addDays = (d: string, n: number) => {
      const [y, m, dd] = d.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, dd + n));
      return t.toISOString().slice(0, 10);
    };
    const fromEnd = addDays(data.fromStart, 7);
    const toEnd = addDays(data.toStart, 7);
    if (data.fromStart === data.toStart) throw new Error("Tuần nguồn và tuần đích trùng nhau");

    // Chỉ các ca thuộc chi nhánh đang lọc (nếu có) — tránh đè lịch chi nhánh khác.
    let shiftIds: string[] | null = null;
    if (data.branchId) {
      const { data: sh } = await db.from("duty_shifts").select("id").eq("branch_id", data.branchId);
      shiftIds = (sh ?? []).map((s: any) => s.id);
      if (!shiftIds.length) throw new Error("Chi nhánh này chưa có ca nào");
    }

    let srcQ = db.from("duty_entries").select("*").gte("work_date", data.fromStart).lt("work_date", fromEnd);
    const { data: src, error: e1 } = await srcQ;
    if (e1) throw new Error(e1.message);
    const source = ((src ?? []) as any[]).filter(
      (e) => !shiftIds || (e.shift_id && shiftIds.includes(e.shift_id)),
    );
    if (!source.length) throw new Error("Tuần nguồn chưa có lịch nào để sao chép");

    const { data: dst } = await db.from("duty_entries").select("id, shift_id").gte("work_date", data.toStart).lt("work_date", toEnd);
    const target = ((dst ?? []) as any[]).filter((e) => !shiftIds || (e.shift_id && shiftIds.includes(e.shift_id)));
    if (target.length && !data.overwrite) {
      return { ok: false, needConfirm: true, existing: target.length };
    }
    if (target.length) {
      const { error } = await db.from("duty_entries").delete().in("id", target.map((e) => e.id));
      if (error) throw new Error(error.message);
    }

    const offset = Math.round(
      (Date.parse(`${data.toStart}T00:00:00Z`) - Date.parse(`${data.fromStart}T00:00:00Z`)) / 86_400_000,
    );
    const rows = source.map((e) => ({
      id: uid(),
      work_date: addDays(e.work_date, offset),
      user_id: e.user_id,
      shift_id: e.shift_id,
      kind: e.kind,
      note: e.note,
      created_by: data.actorId ?? null,
      created_at: now(),
    }));
    const { error } = await db.from("duty_entries").insert(rows);
    if (error) throw new Error(error.message);
    await logActivity({ action: "copy_roster_week", detail: `Sao chép lịch trực ${data.fromStart} → ${data.toStart} (${rows.length} dòng)`, employee_id: data.actorId ?? null });
    return { ok: true, copied: rows.length };
  },
);

export const upsertShiftFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { id?: string; branch_id: string; name: string; start_time?: string; end_time?: string; sort_order?: number; is_active?: boolean; actorId?: string };
  }) => {
    const scope = await assertPerm(data?.actorId, "manage_roster");
    if (!data.branch_id) throw new Error("Chọn chi nhánh");
    assertBranchInScope(scope, data.branch_id);
    // Sửa ca có sẵn: ca cũ cũng phải thuộc phạm vi — chặn "chuyển" ca của chi
    // nhánh khác về chi nhánh mình.
    if (data.id) assertBranchInScope(scope, await shiftBranch(data.id));
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("Nhập tên ca (vd 8h30-18h00)");
    const db = getSupabaseAdmin();
    const row = {
      branch_id: data.branch_id,
      name,
      start_time: data.start_time || null,
      end_time: data.end_time || null,
      sort_order: Number(data.sort_order ?? 0),
      is_active: data.is_active !== false,
    };
    if (data.id) {
      const { error } = await db.from("duty_shifts").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const id = uid();
    const { error } = await db.from("duty_shifts").insert({ id, ...row, created_at: now() });
    if (error) throw new Error(error.message);
    return { id };
  },
);

export const deleteShiftFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_roster");
    assertBranchInScope(scope, await shiftBranch(data.id));
    const db = getSupabaseAdmin();
    // Xoá ca sẽ xoá lây (CASCADE) toàn bộ lịch đã xếp vào ca đó → chặn lại.
    const { count } = await db.from("duty_entries").select("id", { count: "exact", head: true }).eq("shift_id", data.id);
    if ((count ?? 0) > 0) {
      throw new Error(`Ca đã được xếp ${count} lượt. Hãy TẮT ca thay vì xoá để giữ lịch sử.`);
    }
    const { error } = await db.from("duty_shifts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 2) HỒ SƠ LƯƠNG
//
// Quyền "Quản lý lương nhân sự": chỉ thấy / sửa đúng những nhân viên admin đã
// phân cho ở tab "Phân việc" (mặc định không ai). Admin thấy tất cả.
// ═══════════════════════════════════════════════════════════════════════════

export const listPayProfilesFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    const db = getSupabaseAdmin();
    const [users, profRes, ubMap, brRes] = await Promise.all([
      activeUsers(),
      db.from("pay_profiles").select("*"),
      userBranchMap(),
      db.from("branches").select("id, name"),
    ]);
    if (profRes.error) {
      throw new Error(`${profRes.error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v13_hr.sql.`);
    }
    const branchName = new Map(((brRes.data ?? []) as any[]).map((b) => [b.id, b.name]));
    const byUser = new Map(((profRes.data ?? []) as any[]).map((p) => [p.user_id, p]));
    return users
      .filter((u) => inScope(scope, ubMap.get(u.id), u.id))
      .map((u) => ({
        user_id: u.id,
        full_name: u.full_name,
        phone: u.phone,
        branches: [...(ubMap.get(u.id) ?? [])].map((b) => branchName.get(b) ?? b),
        profile: byUser.get(u.id) ?? null,
      }));
  },
);

export const upsertPayProfileFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    if (!data?.user_id) throw new Error("Thiếu nhân viên");
    await assertUserInScope(scope, data.user_id);

    if (num(data.standard_days) <= 0) throw new Error("Số công chuẩn phải lớn hơn 0");
    if (num(data.base_salary) < 0) throw new Error("Lương cơ bản không được âm");

    const db = getSupabaseAdmin();
    const row = {
      user_id: data.user_id,
      position: data.position?.trim() || null,
      area: data.area?.trim() || null,
      start_label: data.start_label?.trim() || null,
      base_salary: num(data.base_salary),
      standard_days: num(data.standard_days) || 26,
      bank_name: data.bank_name?.trim() || null,
      bank_account: data.bank_account?.replace(/\s+/g, "") || null,
      bank_owner: data.bank_owner?.trim() || null,
      // commission_rate / commission_group: KHÔNG ghi nữa (DS bán hàng chưa có
      // công thức) — giữ nguyên giá trị cũ trong DB để sau này dùng lại.
      tech_revenue: Boolean(data.tech_revenue),
      social_insurance: num(data.social_insurance),
      union_fee: num(data.union_fee),
      in_payroll: data.in_payroll !== false,
      sort_order: Number(data.sort_order ?? 0),
      updated_at: now(),
    };
    const { error } = await db.from("pay_profiles").upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    await logActivity({ action: "update_pay_profile", detail: `Cập nhật hồ sơ lương NV ${data.user_id}`, employee_id: data.actorId ?? null });
    return { ok: true };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 3) CHẤM CÔNG
// ═══════════════════════════════════════════════════════════════════════════

async function getPeriod(month: string) {
  const db = getSupabaseAdmin();
  const { data } = await db.from("payroll_periods").select("*").eq("month", month).limit(1);
  return ((data ?? [])[0] ?? null) as any;
}

/**
 * Kỳ lương của tháng — chỉ là "thùng chứa" các dòng lương. Trạng thái chốt
 * nằm ở TỪNG DÒNG (payroll_items.status, migration v14), không ở kỳ, vì nhiều
 * người quản lý (theo chi nhánh) cùng làm lương một tháng.
 */
async function ensurePeriod(month: string) {
  const p = await getPeriod(month);
  if (p) return p;
  const db = getSupabaseAdmin();
  const row = { id: uid(), month, status: "draft", created_at: now() };
  const { error } = await db.from("payroll_periods").insert(row);
  // Hai người cùng tạo kỳ một lúc → dòng kia thắng, đọc lại là được.
  if (error) {
    const again = await getPeriod(month);
    if (again) return again;
    throw new Error(error.message);
  }
  return row;
}

/** Dòng lương đã chốt của tháng, theo user_id. */
async function lockedItems(month: string): Promise<Map<string, any>> {
  const period = await getPeriod(month);
  if (!period) return new Map();
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("payroll_items").select("*").eq("period_id", period.id).eq("status", "locked");
  if (error) {
    throw new Error(`${error.message}. Nếu báo thiếu cột thì chưa chạy migration (cột "status" → v14, "business_revenue" → v19).`);
  }
  return new Map(((data ?? []) as any[]).map((i) => [i.user_id, i]));
}

async function assertNotLocked(month: string, userId: string) {
  const locked = await lockedItems(month);
  if (locked.has(userId)) throw new Error("Lương tháng này của nhân viên đã CHỐT — mở lại mới sửa được");
}

/** Hồ sơ lương đang bật, CHỈ trong phạm vi người thực hiện. */
async function payrollProfiles(scope: Scope) {
  const db = getSupabaseAdmin();
  const [users, profRes, ubMap] = await Promise.all([
    activeUsers(),
    db.from("pay_profiles").select("*").eq("in_payroll", true),
    userBranchMap(),
  ]);
  if (profRes.error) throw new Error(`${profRes.error.message}. Chưa chạy sql_migration_v13_hr.sql?`);
  const userById = new Map(users.map((u) => [u.id, u]));
  return ((profRes.data ?? []) as any[])
    .filter((p) => userById.has(p.user_id) && inScope(scope, ubMap.get(p.user_id), p.user_id))
    .map((p) => ({ ...p, full_name: userById.get(p.user_id).full_name }))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.full_name).localeCompare(String(b.full_name), "vi"));
}

function tallyAttendance(codes: Record<string, string>) {
  const t = { X: 0, N: 0, L: 0, K: 0 };
  for (const c of Object.values(codes)) if (t[c] !== undefined) t[c] += 1;
  return { ...t, worked: t.X + t.N / 2 + t.L };
}

export const getAttendanceMonthFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { month: string; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    const { from, next, dates } = monthRange(data.month);
    const db = getSupabaseAdmin();
    const profiles = await payrollProfiles(scope);
    const ids = profiles.map((p) => p.user_id);
    const [attRes, locked] = await Promise.all([
      ids.length
        ? db.from("attendance_days").select("user_id, work_date, code, note").in("user_id", ids).gte("work_date", from).lt("work_date", next)
        : Promise.resolve({ data: [], error: null }),
      lockedItems(data.month),
    ]);
    if ((attRes as any).error) throw new Error((attRes as any).error.message);

    const byUser: Record<string, Record<string, string>> = {};
    const notes: Record<string, Record<string, string>> = {};
    for (const a of ((attRes as any).data ?? []) as any[]) {
      (byUser[a.user_id] ||= {})[a.work_date] = a.code;
      if (a.note) (notes[a.user_id] ||= {})[a.work_date] = a.note;
    }

    return {
      month: data.month,
      dates,
      rows: profiles.map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        position: p.position,
        standard_days: num(p.standard_days) || 26,
        codes: byUser[p.user_id] ?? {},
        notes: notes[p.user_id] ?? {},
        totals: tallyAttendance(byUser[p.user_id] ?? {}),
        // Đã chốt lương → hàng chấm công của người này chỉ xem.
        locked: locked.has(p.user_id),
      })),
    };
  },
);

/** Đặt / xoá mã chấm công một ô. code = null → xoá. */
export const setAttendanceFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { userId: string; date: string; code: "X" | "N" | "L" | "K" | null; note?: string; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error("Ngày không hợp lệ");
    await assertUserInScope(scope, data.userId);
    await assertNotLocked(data.date.slice(0, 7), data.userId);
    const db = getSupabaseAdmin();
    if (!data.code) {
      const { error } = await db.from("attendance_days").delete().eq("user_id", data.userId).eq("work_date", data.date);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    if (!["X", "N", "L", "K"].includes(data.code)) throw new Error("Mã chấm công không hợp lệ");
    const { error } = await db.from("attendance_days").upsert(
      { user_id: data.userId, work_date: data.date, code: data.code, note: data.note?.trim() || null, updated_by: data.actorId ?? null, updated_at: now() },
      { onConflict: "user_id,work_date" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  },
);

/**
 * Điền nhanh: vd "X cho mọi ngày thường, K cho Chủ nhật".
 * onlyEmpty = true → không đè các ô đã chấm tay. Bỏ qua người ngoài phạm vi
 * và người đã chốt lương.
 */
export const fillAttendanceRowFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { month: string; userIds: string[]; weekdayCode: "X" | "N" | "L" | "K"; sundayCode: "X" | "N" | "L" | "K" | null; onlyEmpty?: boolean; actorId?: string };
  }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    const { from, next, dates } = monthRange(data.month);
    const db = getSupabaseAdmin();

    const locked = await lockedItems(data.month);
    const ids = (await scopedUserIds(scope, (data.userIds ?? []).filter(Boolean))).filter((u) => !locked.has(u));
    if (!ids.length) throw new Error("Không có nhân viên nào điền được (ngoài phạm vi hoặc đã chốt lương)");

    const existing = new Set<string>();
    if (data.onlyEmpty !== false) {
      const { data: rows } = await db.from("attendance_days").select("user_id, work_date").in("user_id", ids).gte("work_date", from).lt("work_date", next);
      for (const r of (rows ?? []) as any[]) existing.add(`${r.user_id}|${r.work_date}`);
    }

    const payload: any[] = [];
    for (const u of ids) {
      for (const d of dates) {
        if (existing.has(`${u}|${d}`)) continue;
        const isSunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
        const code = isSunday ? data.sundayCode : data.weekdayCode;
        if (!code) continue;
        payload.push({ user_id: u, work_date: d, code, updated_by: data.actorId ?? null, updated_at: now() });
      }
    }
    if (payload.length) {
      const { error } = await db.from("attendance_days").upsert(payload, { onConflict: "user_id,work_date" });
      if (error) throw new Error(error.message);
    }
    return { ok: true, filled: payload.length };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 4) BẢNG LƯƠNG
// ═══════════════════════════════════════════════════════════════════════════

const INPUT_FIELDS = [
  "ot_hours_15", "ot_hours_20", "travel_allowance", "travel_note", "bonus",
  "extra_allowance", "extra_note", "other_deduction", "other_note",
  "commission_override", "social_insurance_override", "business_override",
];
/** Ô ghi đè DS bán hàng / DS kinh doanh: CHỈ admin được sửa. */
const ADMIN_ONLY_FIELDS = ["commission_override", "business_override"];

/** Các loại phiếu tính là tạm ứng (chi) và hoàn tạm ứng (thu). */
async function advanceVoucherTypes() {
  const db = getSupabaseAdmin();
  const { data } = await db.from("cash_voucher_types").select("id, name, kind");
  const types = (data ?? []) as any[];
  const norm = (s: string) => String(s || "").toLowerCase().normalize("NFC");
  return {
    // CHỈ "Chi tạm ứng lương". Loại "Tạm ứng" trong sổ quỹ đang dùng cho tạm
    // ứng CÔNG TÁC (đi tỉnh, mua vật tư…) và được quyết toán bằng "Hoàn tạm
    // ứng" — không phải ứng trước lương nên không được trừ vào lương.
    advanceChi: types.filter((t) => t.kind === "chi" && norm(t.name).includes("tạm ứng lương")).map((t) => t.id),
    // "Hoàn tạm ứng lương" (nếu sau này tạo loại phiếu này).
    refundThu: types.filter((t) => t.kind === "thu" && norm(t.name).includes("hoàn tạm ứng lương")).map((t) => t.id),
    salaryType: types.find((t) => t.kind === "chi" && norm(t.name).trim() === "chi lương") ?? null,
  };
}

// ─── DS bán hàng / DS kinh doanh (migration v19) ──────────────────────────
// Chức vụ cố định theo id (migration v18) — đổi tên chức vụ không ảnh hưởng.
const POS_SALES_MANAGER = "pos_sales_manager";
const POS_SALES = "pos_sales";
const POS_BUSINESS = "pos_business";
const BUSINESS_RATE = 1; // % doanh thu bản thân
const STAFF_RATE = 1; // % phần vượt KPI, chia theo tỷ lệ doanh thu
const DEFAULT_COEF = 0.5; // % SUM cho quản lý bán hàng

/**
 * Ngữ cảnh tính DS của một tháng: doanh thu thực thu theo người bán + chức vụ
 * + phân việc + hệ số + KPI. Tính trên TOÀN BỘ nhân viên (không theo phạm vi
 * người xem) vì DS của một người phụ thuộc doanh thu cả nhóm.
 */
async function salesContext(month: string) {
  const db = getSupabaseAdmin();
  const [collections, usersRes, asgRes, setRes, kpiRes] = await Promise.all([
    sellerCollections(month),
    db.from("users").select("id, full_name, position_id"),
    db.from("payroll_assignments").select("manager_id, user_id"),
    db.from("sales_settings").select("manager_id, coef"),
    db.from("sales_kpis").select("manager_id, month, kpi").lte("month", month),
  ]);
  const missingV19 = Boolean(setRes.error || kpiRes.error);
  const users = new Map(((usersRes.data ?? []) as any[]).map((u) => [u.id, u]));
  const nameOf = (id: string) => users.get(id)?.full_name ?? id;
  const posOf = (id: string) => users.get(id)?.position_id ?? null;

  const assigned = new Map<string, Set<string>>();
  for (const a of (asgRes.data ?? []) as any[]) {
    (assigned.get(a.manager_id) ?? assigned.set(a.manager_id, new Set()).get(a.manager_id)).add(a.user_id);
  }
  const coefOf = new Map(((setRes.data ?? []) as any[]).map((s) => [s.manager_id, num(s.coef)]));
  // KPI hiệu lực = KPI của tháng gần nhất <= tháng đang tính.
  const kpiOf = new Map<string, { kpi: number; month: string }>();
  for (const k of ((kpiRes.data ?? []) as any[]).sort((a, b) => a.month.localeCompare(b.month))) {
    kpiOf.set(k.manager_id, { kpi: num(k.kpi), month: k.month });
  }

  const revenue = (id: string) => round(collections.bySeller.get(id)?.total ?? 0);
  const team = (m: string) => [m, ...[...(assigned.get(m) ?? [])].filter((u) => u !== m)];
  const teamSum = (m: string) => team(m).reduce((s, u) => s + revenue(u), 0);
  // Quản lý bán hàng đang quản lý nhân viên này (qua tab Phân việc).
  const salesManagersOf = (u: string) =>
    [...assigned.entries()]
      .filter(([m, set]) => set.has(u) && posOf(m) === POS_SALES_MANAGER && m !== u)
      .map(([m]) => m)
      .sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), "vi"));

  /** DS bán hàng tự tính + chi tiết để hiện / kiểm tra. */
  function sales(u: string) {
    const pos = posOf(u);
    if (pos === POS_SALES_MANAGER) {
      const coef = coefOf.has(u) ? coefOf.get(u)! : DEFAULT_COEF;
      const members = team(u).map((id) => ({ user_id: id, full_name: nameOf(id), revenue: revenue(id), self: id === u }));
      const sum = members.reduce((s, x) => s + x.revenue, 0);
      return { auto: round((sum * coef) / 100), detail: { role: "manager", coef, sum, members, warnings: [] as string[] } };
    }
    if (pos === POS_SALES) {
      const warnings: string[] = [];
      const mgrs = salesManagersOf(u);
      const x = revenue(u);
      if (!mgrs.length) {
        warnings.push('Chưa thuộc quản lý bán hàng nào — admin tick ở tab "Phân việc".');
        return { auto: 0, detail: { role: "staff", x, warnings } };
      }
      if (mgrs.length > 1) {
        warnings.push(`Đang được ${mgrs.length} quản lý bán hàng cùng phân: ${mgrs.map(nameOf).join(", ")} — tạm tính theo ${nameOf(mgrs[0])}.`);
      }
      const m = mgrs[0];
      const y = teamSum(m);
      const k = kpiOf.get(m);
      if (!k) {
        warnings.push(`Admin chưa đặt KPI cho ${nameOf(m)} — DS bán hàng tạm = 0.`);
        return { auto: 0, detail: { role: "staff", x, y, manager_id: m, manager_name: nameOf(m), warnings } };
      }
      const T = Math.max(0, y - k.kpi);
      const ratio = y > 0 ? x / y : 0;
      const auto = round(ratio * (STAFF_RATE / 100) * T);
      return {
        auto,
        detail: {
          role: "staff", x, y, ratio, rate: STAFF_RATE, kpi: k.kpi, kpi_month: k.month, T,
          manager_id: m, manager_name: nameOf(m), below_kpi: y < k.kpi, warnings,
        },
      };
    }
    return { auto: 0, detail: null };
  }

  function business(u: string) {
    if (posOf(u) !== POS_BUSINESS) return { auto: 0, detail: null };
    const r = revenue(u);
    return { auto: round((r * BUSINESS_RATE) / 100), detail: { revenue: r, rate: BUSINESS_RATE } };
  }

  return {
    sales,
    business,
    posOf,
    lines: (id: string) => collections.bySeller.get(id)?.lines ?? [],
    revenue,
    unattributed: round(collections.unattributed),
    missingV19,
  };
}

/** Chức vụ nào cần doanh thu thực thu (để khỏi tính khi không ai cần). */
const needsSalesContext = (positionId: string | null | undefined) =>
  positionId === POS_SALES_MANAGER || positionId === POS_SALES || positionId === POS_BUSINESS;

/** Dòng hiển thị từ snapshot đã chốt — KHÔNG tính lại. */
function rowFromSnapshot(i: any, p: any) {
  return {
    user_id: i.user_id,
    full_name: i.full_name ?? p?.full_name,
    position: i.position ?? p?.position,
    area: p?.area,
    start_label: p?.start_label,
    bank_name: i.bank_name,
    bank_account: i.bank_account,
    bank_owner: p?.bank_owner,
    base_salary: num(i.base_salary),
    standard_days: num(i.standard_days),
    worked_days: num(i.worked_days),
    salary_by_days: num(i.salary_by_days),
    tech_revenue: num(i.tech_revenue),
    commission: num(i.commission),
    business_revenue: num(i.business_revenue),
    business_override: i.business_override ?? null,
    ot_hours_15: num(i.ot_hours_15),
    ot_hours_20: num(i.ot_hours_20),
    overtime_amount: num(i.overtime_amount),
    travel_allowance: num(i.travel_allowance),
    travel_note: i.travel_note ?? "",
    bonus: num(i.bonus),
    extra_allowance: num(i.extra_allowance),
    extra_note: i.extra_note ?? "",
    advance: num(i.advance),
    social_insurance: num(i.social_insurance),
    union_fee: num(i.union_fee),
    other_deduction: num(i.other_deduction),
    other_note: i.other_note ?? "",
    commission_override: i.commission_override ?? null,
    gross: num(i.gross),
    deductions: num(i.deductions),
    net_pay: num(i.net_pay),
    cash_voucher_id: i.cash_voucher_id ?? null,
    tech_lines: [],
    commission_orders: [],
    advance_vouchers: [],
    tech_enabled: Boolean(p?.tech_revenue),
    commission_rate: num(p?.commission_rate),
    locked: true,
    locked_at: i.locked_at,
    snapshot: true,
  };
}

/**
 * Tính bảng lương cho các nhân viên trong phạm vi. Người đã chốt lấy nguyên
 * snapshot; người chưa chốt tính trực tiếp từ dữ liệu gốc.
 * draftOnly = true → chỉ trả những người chưa chốt (dùng lúc chốt lương).
 */
async function computePayroll(month: string, scope: Scope, opts?: { draftOnly?: boolean }) {
  const { from, next } = monthRange(month);
  const fromTs = `${from}T00:00:00+07:00`;
  const nextTs = `${next}T00:00:00+07:00`;
  const db = getSupabaseAdmin();

  const allProfiles = await payrollProfiles(scope);
  const period = await getPeriod(month);
  const locked = await lockedItems(month);
  // Người đã chốt không cần tính lại → bỏ khỏi các truy vấn nặng bên dưới.
  const profiles = allProfiles.filter((p) => !locked.has(p.user_id));
  const userIds = profiles.map((p) => p.user_id);

  // Chấm công lấy cho CẢ người đã chốt — chỉ để xuất Excel (sheet BẢNG CHẤM
  // CÔNG có công thức); số công của người đã chốt vẫn lấy từ snapshot.
  const allIds = allProfiles.map((p) => p.user_id);
  const [attRes, itemsRes, tech, vtypes] = await Promise.all([
    allIds.length
      ? db.from("attendance_days").select("user_id, work_date, code").in("user_id", allIds).gte("work_date", from).lt("work_date", next)
      : Promise.resolve({ data: [] }),
    period && userIds.length
      ? db.from("payroll_items").select("*").eq("period_id", period.id).in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    // Lương doanh số: CHỈ lịch đã hoàn thành (quyết định đã chốt với người dùng).
    profiles.some((p) => p.tech_revenue)
      ? computeTechPay({ from, next, statuses: ["done"] })
      : Promise.resolve({ rows: [] }),
    advanceVoucherTypes(),
  ]);

  // Chức vụ của những người chưa chốt → chỉ tính doanh thu thực thu khi có
  // người là quản lý bán hàng / nhân viên bán hàng / kinh doanh.
  const posRes = userIds.length
    ? await db.from("users").select("id, position_id").in("id", userIds)
    : { data: [] };
  const needCtx = ((posRes.data ?? []) as any[]).some((u) => needsSalesContext(u.position_id));
  const ctx = needCtx ? await salesContext(month) : null;

  const codesByUser: Record<string, Record<string, string>> = {};
  for (const a of (attRes.data ?? []) as any[]) {
    (codesByUser[a.user_id] ||= {})[a.work_date] = a.code;
  }
  const inputs = new Map(((itemsRes.data ?? []) as any[]).map((i) => [i.user_id, i]));
  const techByUser = new Map(((tech as any).rows ?? []).map((r: any) => [r.user_id, r]));

  // ── Tạm ứng: phiếu chi "Tạm ứng" cho NV − phiếu thu "Hoàn tạm ứng" từ NV ──
  const advanceByUser: Record<string, { total: number; vouchers: any[] }> = {};
  const vIds = [...vtypes.advanceChi, ...vtypes.refundThu];
  if (vIds.length && userIds.length) {
    const vouchers = await fetchAllPaged(() =>
      db.from("cash_vouchers")
        .select("id, code, type, amount, voucher_type_id, from_kind, from_id, to_kind, to_id, payer_user_id, note, created_at")
        .eq("status", "active")
        .in("voucher_type_id", vIds)
        .gte("created_at", fromTs)
        .lt("created_at", nextTs),
    );
    for (const v of vouchers) {
      const isAdvance = vtypes.advanceChi.includes(v.voucher_type_id);
      // Phiếu chi tạm ứng: nhân viên là BÊN NHẬN. Phiếu cũ (trước mô hình A→B)
      // chỉ có payer_user_id. Phiếu thu hoàn ứng: nhân viên là BÊN NỘP.
      const uid_ = isAdvance
        ? (v.to_kind === "user" ? v.to_id : !v.to_kind ? v.payer_user_id : null)
        : (v.from_kind === "user" ? v.from_id : null);
      if (!uid_ || !userIds.includes(uid_)) continue;
      const signed = isAdvance ? num(v.amount) : -num(v.amount);
      const r = (advanceByUser[uid_] ||= { total: 0, vouchers: [] });
      r.total += signed;
      r.vouchers.push({ id: v.id, code: v.code, amount: signed, note: v.note, created_at: v.created_at });
    }
  }

  const computed = profiles.map((p) => {
    const inp = inputs.get(p.user_id) ?? {};
    const att = tallyAttendance(codesByUser[p.user_id] ?? {});
    const base = num(p.base_salary);
    const stdDays = num(p.standard_days) || 26;
    const salaryByDays = round((base / stdDays) * att.worked);

    const techRow = p.tech_revenue ? techByUser.get(p.user_id) : null;
    const techRevenue = round(techRow?.total_money ?? 0);

    // DS bán hàng (quản lý / nhân viên bán hàng) và DS kinh doanh — tự tính theo
    // chức vụ; admin có thể ghi đè.
    const salesCalc = ctx ? ctx.sales(p.user_id) : { auto: 0, detail: null };
    const businessCalc = ctx ? ctx.business(p.user_id) : { auto: 0, detail: null };
    const hasOverride = (v: any) => v !== null && v !== undefined;
    const commissionAuto = salesCalc.auto;
    const commission = hasOverride(inp.commission_override) ? round(inp.commission_override) : commissionAuto;
    const businessAuto = businessCalc.auto;
    const businessRevenue = hasOverride(inp.business_override) ? round(inp.business_override) : businessAuto;

    const hourly = base / stdDays / 8;
    const overtime = round(hourly * (num(inp.ot_hours_15) * 1.5 + num(inp.ot_hours_20) * 2));

    const advance = round(advanceByUser[p.user_id]?.total ?? 0);
    // Tháng chưa có ngày công nào (chưa chấm công / nghỉ cả tháng) thì không
    // trừ BHXH, công đoàn cố định — tránh thực lĩnh âm vô lý (vd tháng mới
    // chưa chấm: 0 − 630.000 BHXH). Ô ghi đè BHXH vẫn được tôn trọng.
    const noWork = att.worked <= 0;
    const socialInsurance = inp.social_insurance_override !== null && inp.social_insurance_override !== undefined
      ? round(inp.social_insurance_override) : noWork ? 0 : round(p.social_insurance);
    const unionFee = noWork ? 0 : round(p.union_fee);

    const gross = salaryByDays + techRevenue + commission + businessRevenue + overtime
      + round(inp.travel_allowance) + round(inp.bonus) + round(inp.extra_allowance);
    const deductions = advance + socialInsurance + unionFee + round(inp.other_deduction);

    return {
      user_id: p.user_id,
      full_name: p.full_name,
      position: p.position,
      area: p.area,
      start_label: p.start_label,
      bank_name: p.bank_name,
      bank_account: p.bank_account,
      bank_owner: p.bank_owner,
      base_salary: base,
      standard_days: stdDays,
      attendance: att,
      att_codes: codesByUser[p.user_id] ?? {},
      no_attendance: Object.keys(codesByUser[p.user_id] ?? {}).length === 0,
      worked_days: att.worked,
      salary_by_days: salaryByDays,
      tech_revenue: techRevenue,
      tech_lines: techRow?.lines ?? [],
      tech_enabled: Boolean(p.tech_revenue),
      commission,
      commission_auto: commissionAuto,
      sales_detail: salesCalc.detail,
      business_revenue: businessRevenue,
      business_auto: businessAuto,
      business_detail: businessCalc.detail,
      business_override: inp.business_override ?? null,
      // Các khoản thu (tiền thực thu) của chính người này — cho hộp chi tiết.
      revenue_lines: ctx && (salesCalc.detail || businessCalc.detail) ? ctx.lines(p.user_id) : [],
      commission_rate: 0,
      commission_group: null,
      commission_orders: [],
      commission_base: 0,
      ot_hours_15: num(inp.ot_hours_15),
      ot_hours_20: num(inp.ot_hours_20),
      overtime_amount: overtime,
      travel_allowance: round(inp.travel_allowance),
      travel_note: inp.travel_note ?? "",
      bonus: round(inp.bonus),
      extra_allowance: round(inp.extra_allowance),
      extra_note: inp.extra_note ?? "",
      advance,
      advance_vouchers: advanceByUser[p.user_id]?.vouchers ?? [],
      social_insurance: socialInsurance,
      union_fee: unionFee,
      other_deduction: round(inp.other_deduction),
      other_note: inp.other_note ?? "",
      commission_override: inp.commission_override ?? null,
      gross,
      deductions,
      net_pay: gross - deductions,
      cash_voucher_id: null,
      locked: false,
    };
  });

  const salesInfo = ctx ? { unattributed: ctx.unattributed, missingV19: ctx.missingV19 } : null;
  if (opts?.draftOnly) return { period, rows: computed, salaryVoucherType: vtypes.salaryType, salesInfo };

  const profById = new Map(allProfiles.map((p) => [p.user_id, p]));
  const snapshots = allProfiles
    .filter((p) => locked.has(p.user_id))
    .map((p) => ({ ...rowFromSnapshot(locked.get(p.user_id), profById.get(p.user_id)), att_codes: codesByUser[p.user_id] ?? {} }));
  const order = new Map(allProfiles.map((p, i) => [p.user_id, i]));
  const rows = [...computed, ...snapshots].sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0));
  return { period, rows, salaryVoucherType: vtypes.salaryType, salesInfo };
}

const isPaid = (r: any) => Boolean(r.cash_voucher_id) && !String(r.cash_voucher_id).startsWith("pending:");

function summarize(rows: any[]) {
  return {
    people: rows.length,
    locked: rows.filter((r) => r.locked).length,
    paid: rows.filter(isPaid).length,
    gross: rows.reduce((s, r) => s + num(r.gross), 0),
    deductions: rows.reduce((s, r) => s + num(r.deductions), 0),
    net: rows.reduce((s, r) => s + num(r.net_pay), 0),
    // Số tiền thực sự chi ra (chỉ người thực lĩnh > 0) — người âm là đang nợ
    // tạm ứng, không "chi âm" được.
    payout: rows.reduce((s, r) => s + Math.max(0, num(r.net_pay)), 0),
    negative: rows.filter((r) => num(r.net_pay) < 0).length,
  };
}

export const getPayrollFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { month: string; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    monthRange(data.month);
    const r = await computePayroll(data.month, scope);
    return {
      month: data.month,
      rows: r.rows,
      summary: summarize(r.rows),
      hasSalaryVoucherType: Boolean(r.salaryVoucherType),
      // Để giao diện nói rõ phạm vi đang xem.
      scopeAll: scope.isAdmin,
      scopeBranchIds: [...scope.branchIds],
      // Chỉ admin: tiền thu trong tháng không xác định được người bán.
      salesInfo: scope.isAdmin ? r.salesInfo : r.salesInfo ? { missingV19: r.salesInfo.missingV19 } : null,
    };
  },
);

/** Lưu các ô nhập tay của MỘT người. Chỉ khi người đó chưa chốt. */
export const savePayrollInputFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; userId: string; values: Record<string, any>; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    monthRange(data.month);
    await assertUserInScope(scope, data.userId);
    await assertNotLocked(data.month, data.userId);
    const period = await ensurePeriod(data.month);

    const patch: Record<string, any> = {};
    for (const k of INPUT_FIELDS) {
      if (!(k in (data.values ?? {}))) continue;
      if (ADMIN_ONLY_FIELDS.includes(k) && !scope.isAdmin) {
        throw new Error("Chỉ quản trị viên được sửa DS bán hàng / DS kinh doanh");
      }
      const v = data.values[k];
      if (k.endsWith("_note")) patch[k] = String(v ?? "").trim() || null;
      else if (k.endsWith("_override")) patch[k] = v === null || v === "" || v === undefined ? null : Number(v) || 0;
      else {
        const n = Number(v) || 0;
        if (n < 0) throw new Error("Không nhập số âm");
        patch[k] = n;
      }
    }
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("payroll_items")
      .upsert({ period_id: period.id, user_id: data.userId, ...patch, updated_at: now() }, { onConflict: "period_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  },
);

/**
 * Chốt lương: chụp lại số liệu của các nhân viên CHƯA chốt trong phạm vi
 * (hoặc chỉ những userIds được chọn). Sau khi chốt, sửa lịch/đơn/phiếu không
 * làm đổi dòng lương đó. Người ngoài phạm vi KHÔNG bị ảnh hưởng.
 */
export const lockPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; userIds?: string[]; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    const period = await ensurePeriod(data.month);
    let { rows } = await computePayroll(data.month, scope, { draftOnly: true });
    if (data.userIds?.length) rows = rows.filter((r) => data.userIds!.includes(r.user_id));
    if (!rows.length) throw new Error("Không còn ai chưa chốt lương trong phạm vi của bạn");

    const db = getSupabaseAdmin();
    const stamp = now();
    const snapshot = rows.map((r) => ({
      period_id: period.id,
      user_id: r.user_id,
      status: "locked",
      locked_at: stamp,
      locked_by: data.actorId ?? null,
      ot_hours_15: r.ot_hours_15,
      ot_hours_20: r.ot_hours_20,
      travel_allowance: r.travel_allowance,
      travel_note: r.travel_note || null,
      bonus: r.bonus,
      extra_allowance: r.extra_allowance,
      extra_note: r.extra_note || null,
      other_deduction: r.other_deduction,
      other_note: r.other_note || null,
      commission_override: r.commission_override,
      business_override: r.business_override,
      business_revenue: r.business_revenue,
      full_name: r.full_name,
      position: r.position,
      base_salary: r.base_salary,
      standard_days: r.standard_days,
      worked_days: r.worked_days,
      salary_by_days: r.salary_by_days,
      tech_revenue: r.tech_revenue,
      commission: r.commission,
      overtime_amount: r.overtime_amount,
      advance: r.advance,
      social_insurance: r.social_insurance,
      union_fee: r.union_fee,
      gross: r.gross,
      deductions: r.deductions,
      net_pay: r.net_pay,
      bank_name: r.bank_name,
      bank_account: r.bank_account,
      updated_at: stamp,
    }));
    const { error } = await db.from("payroll_items").upsert(snapshot, { onConflict: "period_id,user_id" });
    if (error) {
      throw new Error(`${error.message}. Nếu báo lỗi cột "status" thì chưa chạy sql_migration_v14_payroll_scope.sql.`);
    }
    await logActivity({ action: "lock_payroll", detail: `Chốt lương tháng ${data.month} cho ${rows.length} người`, employee_id: data.actorId ?? null });
    return { ok: true, people: rows.length };
  },
);

/** Mở lại các dòng đã chốt nhưng CHƯA chi, trong phạm vi người thực hiện. */
export const unlockPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; userIds?: string[]; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    const period = await getPeriod(data.month);
    if (!period) return { ok: true, unlocked: 0 };
    const locked = await lockedItems(data.month);
    let ids = await scopedUserIds(scope, [...locked.keys()]);
    if (data.userIds?.length) ids = ids.filter((u) => data.userIds!.includes(u));
    // Đã chi → không mở lại, nếu không số trên bảng sẽ lệch với phiếu chi
    // đã nằm trong Sổ quỹ.
    const paid = ids.filter((u) => locked.get(u)?.cash_voucher_id);
    const target = ids.filter((u) => !locked.get(u)?.cash_voucher_id);
    if (!target.length) {
      throw new Error(paid.length ? "Những người này đã được chi lương qua Sổ quỹ — không mở lại được" : "Không có dòng lương nào đang chốt");
    }
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("payroll_items")
      .update({ status: "draft", locked_at: null, locked_by: null })
      .eq("period_id", period.id)
      .in("user_id", target)
      .is("cash_voucher_id", null);
    if (error) throw new Error(error.message);
    await logActivity({ action: "unlock_payroll", detail: `Mở lại lương tháng ${data.month} cho ${target.length} người`, employee_id: data.actorId ?? null });
    return { ok: true, unlocked: target.length, skippedPaid: paid.length };
  },
);

/**
 * Chi lương: tạo 1 phiếu chi "Chi Lương" trong Sổ quỹ cho mỗi người ĐÃ CHỐT,
 * thực lĩnh > 0, chưa được chi, và nằm trong phạm vi người thực hiện.
 *
 * Chống tạo trùng khi bấm 2 lần / 2 người bấm cùng lúc: trước khi tạo phiếu,
 * "giành" dòng bằng UPDATE có điều kiện cash_voucher_id IS NULL. Chỉ ai giành
 * được mới tạo phiếu; tạo lỗi thì trả dòng về NULL để lần sau chi lại được.
 */
export const payPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; fundType: "tien_mat" | "ngan_hang"; branchId: string; actorId?: string } }) => {
    const scope = await assertPerm(data?.actorId, "manage_payroll");
    if (!data.branchId) throw new Error("Chọn chi nhánh / quỹ chi lương");
    // Chỉ chi từ quỹ của chi nhánh mình quản lý.
    assertBranchInScope(scope, data.branchId);
    const period = await getPeriod(data.month);
    if (!period) throw new Error("Tháng này chưa có bảng lương");

    const vtypes = await advanceVoucherTypes();
    if (!vtypes.salaryType) throw new Error('Sổ quỹ chưa có loại phiếu chi "Chi Lương" — tạo trong Sổ quỹ trước');

    const db = getSupabaseAdmin();
    const { data: items, error } = await db
      .from("payroll_items")
      .select("*")
      .eq("period_id", period.id)
      .eq("status", "locked")
      .is("cash_voucher_id", null)
      .gt("net_pay", 0);
    if (error) throw new Error(error.message);
    const allowed = new Set(await scopedUserIds(scope, ((items ?? []) as any[]).map((i) => i.user_id)));

    const [, mm] = data.month.split("-");
    const results: any[] = [];
    for (const it of ((items ?? []) as any[]).filter((i) => allowed.has(i.user_id))) {
      const token = `pending:${uid()}`;
      const { data: claimed } = await db
        .from("payroll_items")
        .update({ cash_voucher_id: token })
        .eq("period_id", period.id)
        .eq("user_id", it.user_id)
        .is("cash_voucher_id", null)
        .select("user_id");
      if (!claimed?.length) continue; // người khác đang/đã chi dòng này

      try {
        const v = await insertCashVoucher({
          type: "chi",
          fund_type: data.fundType === "ngan_hang" ? "ngan_hang" : "tien_mat",
          amount: round(it.net_pay),
          voucher_type_id: vtypes.salaryType.id,
          from_kind: "branch",
          from_id: data.branchId,
          to_kind: "user",
          to_id: it.user_id,
          note: `Lương tháng ${mm}/${data.month.slice(0, 4)} — ${it.full_name ?? ""}`.trim(),
          created_by: data.actorId ?? null,
        });
        await db.from("payroll_items").update({ cash_voucher_id: v.id }).eq("period_id", period.id).eq("user_id", it.user_id);
        results.push({ user_id: it.user_id, name: it.full_name, ok: true, code: v.code, amount: round(it.net_pay) });
      } catch (e: any) {
        await db.from("payroll_items").update({ cash_voucher_id: null }).eq("period_id", period.id).eq("user_id", it.user_id).eq("cash_voucher_id", token);
        results.push({ user_id: it.user_id, name: it.full_name, ok: false, reason: String(e?.message ?? e) });
      }
    }

    const ok = results.filter((r) => r.ok);
    await logActivity({
      action: "pay_payroll",
      detail: `Chi lương tháng ${data.month}: ${ok.length} phiếu, ${ok.reduce((s, r) => s + r.amount, 0).toLocaleString("vi-VN")}đ`,
      employee_id: data.actorId ?? null,
    });
    return { results };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 4) PHÂN VIỆC — admin chỉ định người quản lý lương được quản lý ai (v16)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Danh sách người có quyền "Quản lý lương nhân sự" (không tính admin — admin
 * luôn thấy tất cả) + toàn bộ nhân viên + các cặp đã phân.
 */
export const getPayrollAssignmentsFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string } }) => {
    await assertAdmin(data?.actorId);
    const db = getSupabaseAdmin();
    const [users, adminsRes, permsRes, ubMap, brRes, profRes, asgRes, posRes, setRes, kpiRes] = await Promise.all([
      activeUsers(),
      db.from("users").select("id").eq("is_admin", 1),
      db.from("user_permissions").select("user_id").eq("permission", "manage_payroll"),
      userBranchMap(),
      db.from("branches").select("id, name"),
      db.from("pay_profiles").select("user_id, position, in_payroll"),
      db.from("payroll_assignments").select("manager_id, user_id"),
      db.from("users").select("id, position_id"),
      db.from("sales_settings").select("manager_id, coef"),
      db.from("sales_kpis").select("manager_id, month, kpi").order("month"),
    ]);
    const posOf = new Map(((posRes.data ?? []) as any[]).map((u) => [u.id, u.position_id ?? null]));
    if (asgRes.error) {
      throw new Error(`${asgRes.error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v16_payroll_assignments.sql.`);
    }
    const admins = new Set(((adminsRes.data ?? []) as any[]).map((r) => r.id));
    const managerIds = new Set(((permsRes.data ?? []) as any[]).map((r) => r.user_id).filter((id) => !admins.has(id)));
    const branchName = new Map(((brRes.data ?? []) as any[]).map((b) => [b.id, b.name]));
    const profile = new Map(((profRes.data ?? []) as any[]).map((p) => [p.user_id, p]));
    const shape = (u: any) => ({
      id: u.id,
      full_name: u.full_name,
      branches: [...(ubMap.get(u.id) ?? [])].map((b) => branchName.get(b) ?? b),
      position: profile.get(u.id)?.position ?? null,
      in_payroll: Boolean(profile.get(u.id)?.in_payroll),
      is_admin: admins.has(u.id),
      position_id: posOf.get(u.id) ?? null,
    });
    return {
      managers: users.filter((u) => managerIds.has(u.id)).map(shape),
      staff: users.map(shape),
      assignments: ((asgRes.data ?? []) as any[]).filter((a) => managerIds.has(a.manager_id)),
      // DS bán hàng (v19): hệ số % và KPI theo tháng của quản lý bán hàng.
      salesSettings: (setRes.data ?? []) as any[],
      salesKpis: (kpiRes.data ?? []) as any[],
      salesReady: !setRes.error && !kpiRes.error,
      defaultCoef: DEFAULT_COEF,
    };
  },
);

/** Tick / bỏ tick một hoặc nhiều nhân viên cho một người quản lý lương. */
export const setPayrollAssignmentsFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; managerId: string; userIds: string[]; assigned: boolean } }) => {
    await assertAdmin(data?.actorId);
    const db = getSupabaseAdmin();
    const managerId = String(data.managerId || "");
    const { data: perm } = await db
      .from("user_permissions")
      .select("user_id")
      .eq("user_id", managerId)
      .eq("permission", "manage_payroll")
      .limit(1);
    if (!perm?.length) throw new Error('Người này chưa có quyền "Quản lý lương nhân sự" — cấp quyền ở trang Nhân viên trước');

    // Không tự quản lý lương của chính mình.
    const ids = [...new Set((data.userIds ?? []).filter((u) => u && u !== managerId))];
    if (!ids.length) return { changed: 0 };

    if (data.assigned) {
      const { error } = await db.from("payroll_assignments").upsert(
        ids.map((user_id) => ({ manager_id: managerId, user_id, created_by: data.actorId ?? null })),
        { onConflict: "manager_id,user_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("payroll_assignments").delete().eq("manager_id", managerId).in("user_id", ids);
      if (error) throw new Error(error.message);
    }
    await logActivity({
      action: "payroll_assignment",
      detail: `${data.assigned ? "Phân" : "Bỏ phân"} quản lý lương ${ids.length} NV cho người quản lý ${managerId}`,
      employee_id: data.actorId ?? null,
    });
    return { changed: ids.length };
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 5) LƯƠNG CỦA TÔI — mỗi nhân viên xem lương của CHÍNH MÌNH (trang Tổng quan)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Không cần quyền gì: phạm vi bị khoá cứng đúng MỘT người = actorId, nên chỉ
 * trả về dòng lương của chính người gọi. Dùng lại computePayroll → số liệu
 * trùng khớp tuyệt đối với tab Bảng lương (người đã chốt lấy từ snapshot).
 */
export const getMySalaryFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string; month: string } }) => {
    const actorId = data?.actorId;
    if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
    monthRange(data.month);
    const scope: Scope = { actorId, isAdmin: false, branchIds: new Set(), userIds: new Set([actorId]) };
    const { rows } = await computePayroll(data.month, scope);
    const r = rows.find((x: any) => x.user_id === actorId);
    if (!r) return { month: data.month, row: null };
    const paid = Boolean(r.cash_voucher_id) && !String(r.cash_voucher_id).startsWith("pending:");
    // Chỉ trả các con số cần hiển thị / in phiếu — không kèm danh sách đơn,
    // phiếu chi… (không cần cho nhân viên, giảm dữ liệu truyền đi).
    const keep = [
      "user_id", "full_name", "position", "area", "start_label", "bank_name", "bank_account",
      "base_salary", "standard_days", "worked_days", "salary_by_days", "tech_revenue", "commission", "business_revenue",
      "ot_hours_15", "ot_hours_20", "overtime_amount", "travel_allowance", "travel_note", "bonus",
      "extra_allowance", "extra_note", "advance", "social_insurance", "union_fee", "other_deduction",
      "other_note", "gross", "deductions", "net_pay", "locked", "no_attendance",
    ];
    const row: any = Object.fromEntries(keep.map((k) => [k, r[k]]));
    row.paid = paid;
    row.tech_count = (r.tech_lines ?? []).length;

    // Quản lý / nhân viên bán hàng: DS bán hàng tính theo CẢ THÁNG (phụ thuộc
    // doanh thu cả nhóm, KPI) → chỉ hiện khi tháng đã kết thúc. Ẩn ngay từ
    // server và trừ khỏi tổng / thực lĩnh để không suy ngược ra được.
    const db = getSupabaseAdmin();
    const { data: me } = await db.from("users").select("position_id").eq("id", actorId).limit(1);
    const pos = me?.[0]?.position_id ?? null;
    row.sales_role = pos === POS_SALES_MANAGER ? "manager" : pos === POS_SALES ? "staff" : null;
    row.business_role = pos === POS_BUSINESS;
    const currentMonthVN = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
    if (row.sales_role && data.month >= currentMonthVN) {
      const hidden = num(row.commission);
      row.commission = null;
      row.gross = num(row.gross) - hidden;
      row.net_pay = num(row.net_pay) - hidden;
      row.sales_pending = true;
    }
    return { month: data.month, row };
  },
);

/** Admin đặt hệ số % DS bán hàng cho một quản lý bán hàng (mặc định 0,5%). */
export const setSalesCoefFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; managerId: string; coef: number } }) => {
    await assertAdmin(data?.actorId);
    const coef = Number(data.coef);
    if (!Number.isFinite(coef) || coef < 0 || coef > 100) throw new Error("Hệ số phải từ 0 đến 100 (%)");
    const { error } = await getSupabaseAdmin()
      .from("sales_settings")
      .upsert({ manager_id: data.managerId, coef, updated_at: now(), updated_by: data.actorId ?? null }, { onConflict: "manager_id" });
    if (error) throw new Error(`${error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v19_sales_revenue.sql.`);
    await logActivity({ action: "set_sales_coef", detail: `Hệ số DS bán hàng ${coef}% cho ${data.managerId}`, employee_id: data.actorId ?? null });
    return { ok: true };
  },
);

/** Admin đặt KPI tháng cho một quản lý bán hàng. kpi = null → xoá KPI tháng đó (dùng lại KPI tháng trước). */
export const setSalesKpiFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { actorId?: string; managerId: string; month: string; kpi: number | null } }) => {
    await assertAdmin(data?.actorId);
    monthRange(data.month);
    const db = getSupabaseAdmin();
    if (data.kpi === null || data.kpi === undefined || (data.kpi as any) === "") {
      const { error } = await db.from("sales_kpis").delete().eq("manager_id", data.managerId).eq("month", data.month);
      if (error) throw new Error(error.message);
    } else {
      const kpi = Number(data.kpi);
      if (!Number.isFinite(kpi) || kpi < 0) throw new Error("KPI không hợp lệ");
      const { error } = await db
        .from("sales_kpis")
        .upsert({ manager_id: data.managerId, month: data.month, kpi, updated_at: now(), updated_by: data.actorId ?? null }, { onConflict: "manager_id,month" });
      if (error) throw new Error(`${error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v19_sales_revenue.sql.`);
    }
    await logActivity({ action: "set_sales_kpi", detail: `KPI ${data.month} = ${data.kpi ?? "(xoá)"} cho ${data.managerId}`, employee_id: data.actorId ?? null });
    return { ok: true };
  },
);
