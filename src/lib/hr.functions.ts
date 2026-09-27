// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { fetchRows, uid, now, logActivity } from "./supabase";
import { computeTechPay } from "./schedule.functions";
import { insertCashVoucher } from "./cash.functions";
import { fetchAllPaged } from "./reports.functions";

/**
 * Nhân sự: Lịch trực ca + Chấm công + Bảng lương (migration v13).
 *
 * Thay cho 2 file Excel làm tay mỗi tháng. Công thức lương sao y file
 * "BẢNG LƯƠNG KT HCM":
 *   công thực tế   = X + N/2 + L
 *   lương theo công = LCB / công chuẩn × công thực tế
 *   tăng ca        = LCB / công chuẩn / 8 × (giờ ×1,5 + giờ ×2,0)
 *   tổng thu nhập  = lương theo công + lương doanh số + hoa hồng + tăng ca
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

/** Kiểm quyền ở SERVER (mẫu assertCanSend của care.functions.ts). */
async function assertPerm(actorId: string | undefined, perm: Perm) {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const rows = await fetchRows<any>("users", { eq: { id: actorId }, select: "id, is_admin", limit: 1 });
  const actor = rows[0];
  if (!actor) throw new Error("Người dùng không tồn tại");
  if (Number(actor.is_admin) === 1) return;
  const perms = await fetchRows<any>("user_permissions", { eq: { user_id: actorId }, select: "permission" });
  if (!perms.some((p: any) => p.permission === perm)) {
    throw new Error(
      perm === "manage_payroll"
        ? 'Bạn không có quyền "Chấm công & bảng lương"'
        : 'Bạn không có quyền "Xếp lịch trực"',
    );
  }
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

export const getRosterMonthFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { month: string } }) => {
    const { from, next, dates, year } = monthRange(data?.month);
    const db = getSupabaseAdmin();

    const [shiftsRes, entriesRes, yearRes, branchesRes, users] = await Promise.all([
      db.from("duty_shifts").select("*").order("sort_order"),
      db.from("duty_entries").select("*").gte("work_date", from).lt("work_date", next),
      // Luỹ kế năm đến hết tháng đang xem — thay cho số đếm tay "VY 3", "lễ 2".
      db.from("duty_entries").select("user_id, kind").gte("work_date", `${year}-01-01`).lt("work_date", next).in("kind", ["off", "holiday", "half_off"]),
      db.from("branches").select("id, name").order("name"),
      activeUsers(),
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
      month: data.month,
      dates,
      shifts: shiftsRes.data ?? [],
      entries,
      branches: branchesRes.data ?? [],
      users: users.map((u) => ({ id: u.id, full_name: u.full_name })),
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
    await assertPerm(data?.actorId, "manage_roster");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error("Ngày không hợp lệ");
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
    await assertPerm(data?.actorId, "manage_roster");
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
    await assertPerm(data?.actorId, "manage_roster");
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
    await assertPerm(data?.actorId, "manage_roster");
    if (!data.branch_id) throw new Error("Chọn chi nhánh");
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
    await assertPerm(data?.actorId, "manage_roster");
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
// ═══════════════════════════════════════════════════════════════════════════

export const listPayProfilesFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    const db = getSupabaseAdmin();
    const [users, profRes] = await Promise.all([activeUsers(), db.from("pay_profiles").select("*")]);
    if (profRes.error) {
      throw new Error(`${profRes.error.message}. Nếu báo "does not exist" thì chưa chạy sql_migration_v13_hr.sql.`);
    }
    const byUser = new Map(((profRes.data ?? []) as any[]).map((p) => [p.user_id, p]));
    return users.map((u) => ({ user_id: u.id, full_name: u.full_name, phone: u.phone, profile: byUser.get(u.id) ?? null }));
  },
);

export const upsertPayProfileFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    if (!data?.user_id) throw new Error("Thiếu nhân viên");
    const rate = num(data.commission_rate);
    if (rate < 0 || rate > 100) throw new Error("% hoa hồng phải từ 0 đến 100");
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
      commission_rate: rate,
      commission_group: rate > 0 ? data.commission_group || null : null,
      tech_revenue: Boolean(data.tech_revenue),
      social_insurance: num(data.social_insurance),
      union_fee: num(data.union_fee),
      in_payroll: data.in_payroll !== false,
      sort_order: Number(data.sort_order ?? 0),
      updated_at: now(),
    };
    if (row.commission_rate > 0 && !row.commission_group) throw new Error("Chọn nhóm khách để tính hoa hồng");
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

async function ensureDraftPeriod(month: string) {
  const p = await getPeriod(month);
  if (p) {
    if (p.status !== "draft") throw new Error("Bảng lương tháng này đã CHỐT — mở lại mới sửa được");
    return p;
  }
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

async function payrollProfiles() {
  const db = getSupabaseAdmin();
  const [users, profRes] = await Promise.all([activeUsers(), db.from("pay_profiles").select("*").eq("in_payroll", true)]);
  if (profRes.error) throw new Error(`${profRes.error.message}. Chưa chạy sql_migration_v13_hr.sql?`);
  const userById = new Map(users.map((u) => [u.id, u]));
  return ((profRes.data ?? []) as any[])
    .filter((p) => userById.has(p.user_id))
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
    await assertPerm(data?.actorId, "manage_payroll");
    const { from, next, dates } = monthRange(data.month);
    const db = getSupabaseAdmin();
    const [profiles, attRes, period] = await Promise.all([
      payrollProfiles(),
      db.from("attendance_days").select("user_id, work_date, code, note").gte("work_date", from).lt("work_date", next),
      getPeriod(data.month),
    ]);
    if (attRes.error) throw new Error(attRes.error.message);

    const byUser: Record<string, Record<string, string>> = {};
    const notes: Record<string, Record<string, string>> = {};
    for (const a of (attRes.data ?? []) as any[]) {
      (byUser[a.user_id] ||= {})[a.work_date] = a.code;
      if (a.note) (notes[a.user_id] ||= {})[a.work_date] = a.note;
    }

    return {
      month: data.month,
      dates,
      locked: Boolean(period && period.status !== "draft"),
      rows: profiles.map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        position: p.position,
        standard_days: num(p.standard_days) || 26,
        codes: byUser[p.user_id] ?? {},
        notes: notes[p.user_id] ?? {},
        totals: tallyAttendance(byUser[p.user_id] ?? {}),
      })),
    };
  },
);

async function assertMonthEditable(month: string) {
  const p = await getPeriod(month);
  if (p && p.status !== "draft") throw new Error("Bảng lương tháng này đã CHỐT — mở lại mới sửa chấm công được");
}

/** Đặt / xoá mã chấm công một ô. code = null → xoá. */
export const setAttendanceFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { userId: string; date: string; code: "X" | "N" | "L" | "K" | null; note?: string; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error("Ngày không hợp lệ");
    await assertMonthEditable(data.date.slice(0, 7));
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
 * Điền nhanh cả hàng của một người: vd "X cho mọi ngày, CN là K".
 * onlyEmpty = true → không đè các ô đã chấm tay (nghỉ phép, nửa ngày...).
 */
export const fillAttendanceRowFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { month: string; userIds: string[]; weekdayCode: "X" | "N" | "L" | "K"; sundayCode: "X" | "N" | "L" | "K" | null; onlyEmpty?: boolean; actorId?: string };
  }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    const { from, next, dates } = monthRange(data.month);
    await assertMonthEditable(data.month);
    const db = getSupabaseAdmin();

    const ids = (data.userIds ?? []).filter(Boolean);
    if (!ids.length) throw new Error("Chưa chọn nhân viên");

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
  "commission_override", "social_insurance_override",
];

/** Các loại phiếu tính là tạm ứng (chi) và hoàn tạm ứng (thu). */
async function advanceVoucherTypes() {
  const db = getSupabaseAdmin();
  const { data } = await db.from("cash_voucher_types").select("id, name, kind");
  const types = (data ?? []) as any[];
  const norm = (s: string) => String(s || "").toLowerCase().normalize("NFC");
  return {
    // "Tạm ứng", "Chi tạm ứng lương" — KHÔNG gồm "Chi Lương" (đó là trả lương)
    advanceChi: types.filter((t) => t.kind === "chi" && norm(t.name).includes("tạm ứng")).map((t) => t.id),
    // "Hoàn tạm ứng" — nhân viên trả lại tiền tạm ứng
    refundThu: types.filter((t) => t.kind === "thu" && norm(t.name).includes("hoàn tạm ứng")).map((t) => t.id),
    salaryType: types.find((t) => t.kind === "chi" && norm(t.name).trim() === "chi lương") ?? null,
  };
}

/** Tính bảng lương trực tiếp từ dữ liệu gốc (dùng khi kỳ còn nháp và lúc chốt). */
async function computePayroll(month: string) {
  const { from, next } = monthRange(month);
  const fromTs = `${from}T00:00:00+07:00`;
  const nextTs = `${next}T00:00:00+07:00`;
  const db = getSupabaseAdmin();

  const profiles = await payrollProfiles();
  const userIds = profiles.map((p) => p.user_id);
  const period = await getPeriod(month);

  const [attRes, itemsRes, tech, vtypes] = await Promise.all([
    userIds.length
      ? db.from("attendance_days").select("user_id, work_date, code").in("user_id", userIds).gte("work_date", from).lt("work_date", next)
      : Promise.resolve({ data: [] }),
    period ? db.from("payroll_items").select("*").eq("period_id", period.id) : Promise.resolve({ data: [] }),
    // Lương doanh số: CHỈ lịch đã hoàn thành (quyết định đã chốt với người dùng).
    profiles.some((p) => p.tech_revenue)
      ? computeTechPay({ from, next, statuses: ["done"] })
      : Promise.resolve({ rows: [] }),
    advanceVoucherTypes(),
  ]);

  const codesByUser: Record<string, Record<string, string>> = {};
  for (const a of (attRes.data ?? []) as any[]) {
    (codesByUser[a.user_id] ||= {})[a.work_date] = a.code;
  }
  const inputs = new Map(((itemsRes.data ?? []) as any[]).map((i) => [i.user_id, i]));
  const techByUser = new Map(((tech as any).rows ?? []).map((r: any) => [r.user_id, r]));

  // ── Hoa hồng: doanh thu đơn hoàn tất trong tháng theo nhóm khách ──
  // Cùng ngữ nghĩa trang Báo cáo: theo completed_at (giờ VN), đơn cũ thiếu
  // completed_at thì lấy created_at.
  const groups = [...new Set(profiles.filter((p) => num(p.commission_rate) > 0 && p.commission_group).map((p) => p.commission_group))];
  const ordersByGroup: Record<string, any[]> = {};
  if (groups.length) {
    const SEL = "id, code, customer_id, total, completed_at, created_at";
    const [a, b] = await Promise.all([
      fetchAllPaged(() => db.from("orders").select(SEL).eq("status", "completed").not("completed_at", "is", null).gte("completed_at", fromTs).lt("completed_at", nextTs)),
      fetchAllPaged(() => db.from("orders").select(SEL).eq("status", "completed").is("completed_at", null).gte("created_at", fromTs).lt("created_at", nextTs)),
    ]);
    const orders = [...a, ...b].filter((o) => o.customer_id);
    const custIds = [...new Set(orders.map((o) => o.customer_id))];
    const custMap = new Map<string, any>();
    for (let i = 0; i < custIds.length; i += 500) {
      const { data: cs } = await db.from("customers").select("id, name, group_name").in("id", custIds.slice(i, i + 500));
      for (const c of cs ?? []) custMap.set(c.id, c);
    }
    for (const o of orders) {
      const c = custMap.get(o.customer_id);
      if (!c || !groups.includes(c.group_name)) continue;
      (ordersByGroup[c.group_name] ||= []).push({
        id: o.id, code: o.code, total: num(o.total), customer_name: c.name,
        date: String(o.completed_at || o.created_at),
      });
    }
  }

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

  const rows = profiles.map((p) => {
    const inp = inputs.get(p.user_id) ?? {};
    const att = tallyAttendance(codesByUser[p.user_id] ?? {});
    const base = num(p.base_salary);
    const stdDays = num(p.standard_days) || 26;
    const salaryByDays = round((base / stdDays) * att.worked);

    const techRow = p.tech_revenue ? techByUser.get(p.user_id) : null;
    const techRevenue = round(techRow?.total_money ?? 0);

    const groupOrders = p.commission_group ? ordersByGroup[p.commission_group] ?? [] : [];
    const groupRevenue = groupOrders.reduce((s, o) => s + o.total, 0);
    const commissionAuto = round((groupRevenue * num(p.commission_rate)) / 100);
    const commission = inp.commission_override !== null && inp.commission_override !== undefined
      ? round(inp.commission_override) : commissionAuto;

    const hourly = base / stdDays / 8;
    const overtime = round(hourly * (num(inp.ot_hours_15) * 1.5 + num(inp.ot_hours_20) * 2));

    const advance = round(advanceByUser[p.user_id]?.total ?? 0);
    const socialInsurance = inp.social_insurance_override !== null && inp.social_insurance_override !== undefined
      ? round(inp.social_insurance_override) : round(p.social_insurance);
    const unionFee = round(p.union_fee);

    const gross = salaryByDays + techRevenue + commission + overtime
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
      worked_days: att.worked,
      salary_by_days: salaryByDays,
      tech_revenue: techRevenue,
      tech_lines: techRow?.lines ?? [],
      tech_enabled: Boolean(p.tech_revenue),
      commission,
      commission_auto: commissionAuto,
      commission_rate: num(p.commission_rate),
      commission_group: p.commission_group,
      commission_orders: groupOrders,
      commission_base: groupRevenue,
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
      cash_voucher_id: inp.cash_voucher_id ?? null,
    };
  });

  return { period, rows, salaryVoucherType: vtypes.salaryType };
}

function summarize(rows: any[]) {
  return {
    people: rows.length,
    gross: rows.reduce((s, r) => s + num(r.gross), 0),
    deductions: rows.reduce((s, r) => s + num(r.deductions), 0),
    net: rows.reduce((s, r) => s + num(r.net_pay), 0),
    paid: rows.filter((r) => r.cash_voucher_id && !String(r.cash_voucher_id).startsWith("pending:")).length,
  };
}

export const getPayrollFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { month: string; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    monthRange(data.month);
    const period = await getPeriod(data.month);

    // Kỳ đã chốt: đọc NGUYÊN snapshot, không tính lại.
    if (period && period.status !== "draft") {
      const db = getSupabaseAdmin();
      const { data: items, error } = await db.from("payroll_items").select("*").eq("period_id", period.id);
      if (error) throw new Error(error.message);
      const rows = ((items ?? []) as any[])
        .map((i) => ({ ...i, attendance: null, tech_lines: [], commission_orders: [], advance_vouchers: [], snapshot: true }))
        .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), "vi"));
      return { month: data.month, status: period.status, locked_at: period.locked_at, rows, summary: summarize(rows) };
    }

    const r = await computePayroll(data.month);
    return {
      month: data.month,
      status: "draft",
      rows: r.rows,
      summary: summarize(r.rows),
      hasSalaryVoucherType: Boolean(r.salaryVoucherType),
    };
  },
);

/** Lưu các ô nhập tay của MỘT người. Chỉ khi kỳ còn nháp. */
export const savePayrollInputFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; userId: string; values: Record<string, any>; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    const period = await ensureDraftPeriod(data.month);

    const patch: Record<string, any> = {};
    for (const k of INPUT_FIELDS) {
      if (!(k in (data.values ?? {}))) continue;
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

/** Chốt lương: chụp lại toàn bộ số liệu. Sau khi chốt, sửa lịch/đơn/phiếu không làm đổi bảng. */
export const lockPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    const period = await ensureDraftPeriod(data.month);
    const { rows } = await computePayroll(data.month);
    if (!rows.length) throw new Error("Chưa có nhân viên nào trong bảng lương (thêm ở tab Hồ sơ lương)");

    const db = getSupabaseAdmin();
    const snapshot = rows.map((r) => ({
      period_id: period.id,
      user_id: r.user_id,
      ot_hours_15: r.ot_hours_15, ot_hours_20: r.ot_hours_20,
      travel_allowance: r.travel_allowance, travel_note: r.travel_note || null,
      bonus: r.bonus, extra_allowance: r.extra_allowance, extra_note: r.extra_note || null,
      other_deduction: r.other_deduction, other_note: r.other_note || null,
      commission_override: r.commission_override,
      full_name: r.full_name, position: r.position,
      base_salary: r.base_salary, standard_days: r.standard_days, worked_days: r.worked_days,
      salary_by_days: r.salary_by_days, tech_revenue: r.tech_revenue, commission: r.commission,
      overtime_amount: r.overtime_amount, advance: r.advance,
      social_insurance: r.social_insurance, union_fee: r.union_fee,
      gross: r.gross, deductions: r.deductions, net_pay: r.net_pay,
      bank_name: r.bank_name, bank_account: r.bank_account,
      updated_at: now(),
    }));
    const { error } = await db.from("payroll_items").upsert(snapshot, { onConflict: "period_id,user_id" });
    if (error) throw new Error(error.message);

    // Người đã có dòng nháp nhưng giờ không còn trong bảng lương → bỏ đi, để
    // snapshot chỉ gồm đúng những người được chốt.
    const keep = new Set(rows.map((r) => r.user_id));
    const { data: all } = await db.from("payroll_items").select("user_id").eq("period_id", period.id);
    const stale = ((all ?? []) as any[]).map((i) => i.user_id).filter((u) => !keep.has(u));
    if (stale.length) await db.from("payroll_items").delete().eq("period_id", period.id).in("user_id", stale);

    const { error: e2 } = await db
      .from("payroll_periods")
      .update({ status: "locked", locked_at: now(), locked_by: data.actorId ?? null })
      .eq("id", period.id)
      .eq("status", "draft");
    if (e2) throw new Error(e2.message);

    await logActivity({ action: "lock_payroll", detail: `Chốt bảng lương tháng ${data.month} (${rows.length} người)`, employee_id: data.actorId ?? null });
    return { ok: true, people: rows.length };
  },
);

export const unlockPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    const period = await getPeriod(data.month);
    if (!period || period.status === "draft") return { ok: true };
    const db = getSupabaseAdmin();
    // Đã chi cho bất kỳ ai → không mở lại được, nếu không số trên bảng sẽ lệch
    // với phiếu chi đã nằm trong Sổ quỹ.
    const { count } = await db.from("payroll_items").select("user_id", { count: "exact", head: true }).eq("period_id", period.id).not("cash_voucher_id", "is", null);
    if ((count ?? 0) > 0) {
      throw new Error(`Đã chi lương cho ${count} người qua Sổ quỹ — không mở lại được. Huỷ phiếu chi tương ứng trước nếu cần sửa.`);
    }
    const { error } = await db.from("payroll_periods").update({ status: "draft", locked_at: null, locked_by: null }).eq("id", period.id);
    if (error) throw new Error(error.message);
    await logActivity({ action: "unlock_payroll", detail: `Mở lại bảng lương tháng ${data.month}`, employee_id: data.actorId ?? null });
    return { ok: true };
  },
);

/**
 * Chi lương: tạo 1 phiếu chi "Chi Lương" trong Sổ quỹ cho mỗi người có thực
 * lĩnh > 0 và CHƯA được chi.
 *
 * Chống tạo trùng khi bấm 2 lần / 2 người bấm cùng lúc: trước khi tạo phiếu,
 * "giành" dòng bằng UPDATE có điều kiện cash_voucher_id IS NULL. Chỉ ai giành
 * được mới tạo phiếu; tạo lỗi thì trả dòng về NULL để lần sau chi lại được.
 */
export const payPayrollFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { month: string; fundType: "tien_mat" | "ngan_hang"; branchId: string; actorId?: string } }) => {
    await assertPerm(data?.actorId, "manage_payroll");
    if (!data.branchId) throw new Error("Chọn chi nhánh / quỹ chi lương");
    const period = await getPeriod(data.month);
    if (!period || period.status === "draft") throw new Error("Phải CHỐT lương trước khi chi");

    const vtypes = await advanceVoucherTypes();
    if (!vtypes.salaryType) throw new Error('Sổ quỹ chưa có loại phiếu chi "Chi Lương" — tạo trong Sổ quỹ trước');

    const db = getSupabaseAdmin();
    const { data: items, error } = await db.from("payroll_items").select("*").eq("period_id", period.id).is("cash_voucher_id", null).gt("net_pay", 0);
    if (error) throw new Error(error.message);

    const [, mm] = data.month.split("-");
    const results: any[] = [];
    for (const it of (items ?? []) as any[]) {
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

    const { count: remaining } = await db.from("payroll_items").select("user_id", { count: "exact", head: true }).eq("period_id", period.id).is("cash_voucher_id", null).gt("net_pay", 0);
    if ((remaining ?? 0) === 0) {
      await db.from("payroll_periods").update({ status: "paid", paid_at: now() }).eq("id", period.id);
    }
    const ok = results.filter((r) => r.ok);
    await logActivity({
      action: "pay_payroll",
      detail: `Chi lương tháng ${data.month}: ${ok.length} phiếu, ${ok.reduce((s, r) => s + r.amount, 0).toLocaleString("vi-VN")}đ`,
      employee_id: data.actorId ?? null,
    });
    return { results, remaining: remaining ?? 0 };
  },
);
