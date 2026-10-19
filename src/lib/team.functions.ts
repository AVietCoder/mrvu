// @ts-nocheck
// Trang Tổng quan: sinh nhật nhân viên (mọi người xem) + phiên đăng nhập / thiết bị (admin).
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { todayVN } from "./date-vn";
import { describeUA, endSession, heartbeat, listSessions, ONLINE_MINUTES, revokeSession } from "./server/sessions";

const db = () => getSupabaseAdmin();
const PLACEHOLDER_YEAR = "1904"; // năm giả khi chỉ biết ngày/tháng (xem BirthdayDayMonth.tsx)

async function assertAdmin(actorId?: string) {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");
  const { data } = await db().from("users").select("is_admin").eq("id", actorId).limit(1);
  if (Number((data ?? [])[0]?.is_admin) !== 1) throw new Error("Chỉ quản trị viên xem được mục này");
}

// ---------------------------------------------------------------- sinh nhật nhân viên
export const getStaffBirthdaysFn = createServerFn({ method: "GET" }).handler(async () => {
  const today = todayVN(); // YYYY-MM-DD giờ VN
  const [y, m, d] = today.split("-").map(Number);
  const [us, ps, ub, br] = await Promise.all([
    db().from("users").select("id, full_name, birthday, active, position_id").not("birthday", "is", null),
    db().from("positions").select("id, name"),
    db().from("user_branches").select("user_id, branch_id"),
    db().from("branches").select("id, name"),
  ]);
  const pos = new Map(((ps.data ?? []) as any[]).map((p) => [p.id, p.name]));
  const bname = new Map(((br.data ?? []) as any[]).map((b) => [b.id, b.name]));
  const branchesOf = new Map<string, string[]>();
  for (const r of (ub.data ?? []) as any[]) branchesOf.set(r.user_id, [...(branchesOf.get(r.user_id) ?? []), bname.get(r.branch_id)].filter(Boolean));
  const month = ((us.data ?? []) as any[])
    .filter((u) => u.active !== false)
    .map((u) => {
      const [by, bm, bd] = String(u.birthday).slice(0, 10).split("-");
      const realYear = by && by !== PLACEHOLDER_YEAR;
      return {
        id: u.id, full_name: u.full_name, day: Number(bd), month: Number(bm),
        birthday: String(u.birthday).slice(0, 10),
        age: realYear ? y - Number(by) : null,
        position: pos.get(u.position_id) ?? null,
        branches: branchesOf.get(u.id) ?? [],
      };
    })
    .filter((u) => u.month === m && u.day > 0)
    .sort((a, b) => a.day - b.day || a.full_name.localeCompare(b.full_name, "vi"));
  const withBirthday = ((us.data ?? []) as any[]).filter((u) => u.active !== false).length;
  return { today, withBirthday, month: month.map((u) => ({ ...u, isToday: u.day === d, isPast: u.day < d })) };
});

// ---------------------------------------------------------------- phiên đăng nhập
/** Trình duyệt gọi vài phút / lần khi đang mở POS. revoked → client tự đăng xuất. */
export const sessionHeartbeatFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { userId: string; token: string } }) =>
  heartbeat(data?.userId, data?.token),
);

export const endSessionFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { token: string } }) => {
  try {
    await endSession(data?.token);
  } catch {}
  return { ok: true };
});

export const listSessionsFn = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { actorId?: string } }) => {
  await assertAdmin(data?.actorId);
  const { migrated, sessions } = await listSessions();
  if (!migrated) return { migrated: false, users: [], onlineMinutes: ONLINE_MINUTES };
  const ids = [...new Set(sessions.map((s: any) => s.user_id))];
  const { data: us } = ids.length ? await db().from("users").select("id, full_name, username, is_admin").in("id", ids) : { data: [] };
  const uMap = new Map(((us ?? []) as any[]).map((u) => [u.id, u]));
  const onlineSince = Date.now() - ONLINE_MINUTES * 60_000;
  const byUser = new Map<string, any>();
  for (const s of sessions as any[]) {
    const u = uMap.get(s.user_id);
    if (!u) continue;
    const online = Date.parse(s.last_seen_at) >= onlineSince;
    const g = byUser.get(s.user_id) ?? { user_id: s.user_id, full_name: u.full_name, username: u.username, is_admin: Number(u.is_admin) === 1, online: false, last_seen_at: s.last_seen_at, devices: [] };
    g.online ||= online;
    if (s.last_seen_at > g.last_seen_at) g.last_seen_at = s.last_seen_at;
    g.devices.push({ token_hash: s.token_hash, ...describeUA(s.user_agent), ip: s.ip, created_at: s.created_at, last_seen_at: s.last_seen_at, online });
    byUser.set(s.user_id, g);
  }
  const users = [...byUser.values()].sort((a, b) => Number(b.online) - Number(a.online) || b.last_seen_at.localeCompare(a.last_seen_at));
  return { migrated: true, users, onlineMinutes: ONLINE_MINUTES };
});

export const revokeSessionFn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { actorId?: string; tokenHash: string } }) => {
  await assertAdmin(data?.actorId);
  await revokeSession(data.tokenHash, data.actorId);
  return { ok: true };
});
