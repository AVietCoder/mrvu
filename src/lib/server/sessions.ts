// @ts-nocheck
// Phiên đăng nhập POS (migration v26, bảng user_sessions). CHỈ chạy ở server
// (thư mục server/ bị chặn import từ trình duyệt — xem vite.config.ts).
//
// POS vẫn xác thực bằng actorId phía client như cũ; bảng này chỉ để admin THẤY ai đang
// đăng nhập ở thiết bị nào và ĐĂNG XUẤT TỪ XA (máy kia bị thoát ở lần "nhịp" kế tiếp).
import { createHash } from "node:crypto";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { getSupabaseAdmin } from "@/lib/zalo/admin-client";

const db = () => getSupabaseAdmin();
export const hashToken = (t: string) => createHash("sha256").update(String(t)).digest("hex");
const isMissing = (e: any) => !!e && /user_sessions/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? "");

function clientInfo() {
  let ua = "", ip = "";
  try {
    ua = (getRequestHeader("user-agent") || "").slice(0, 400);
    ip = (getRequestIP({ xForwardedFor: true }) || "").split(",")[0].trim().slice(0, 64);
  } catch {}
  return { ua, ip };
}

/** Ghi phiên mới lúc đăng nhập. Lỗi (vd. chưa chạy v26) không chặn việc đăng nhập. */
export async function recordLogin(userId: string, token: string) {
  const { ua, ip } = clientInfo();
  const t = new Date().toISOString();
  const { error } = await db().from("user_sessions").upsert(
    { token_hash: hashToken(token), user_id: userId, user_agent: ua, ip, created_at: t, last_seen_at: t, revoked_at: null },
    { onConflict: "token_hash" },
  );
  if (error && !isMissing(error)) console.error("[phiên] không ghi được:", error.message);
}

/**
 * Nhịp hoạt động từ trình duyệt (vài phút / lần). Phiên cũ (đăng nhập trước khi có v26)
 * được tạo bản ghi ở nhịp đầu tiên. Trả revoked = true nếu admin đã đăng xuất từ xa.
 */
export async function heartbeat(userId: string, token: string): Promise<{ revoked: boolean }> {
  if (!userId || !token) return { revoked: false };
  const h = hashToken(token);
  const { data, error } = await db().from("user_sessions").select("user_id, revoked_at").eq("token_hash", h).limit(1);
  if (error) {
    if (!isMissing(error)) console.error("[phiên] nhịp lỗi:", error.message);
    return { revoked: false };
  }
  const row = (data ?? [])[0];
  if (row?.revoked_at) return { revoked: true };
  if (row && row.user_id !== userId) return { revoked: true }; // token không khớp người dùng
  const { ua, ip } = clientInfo();
  const t = new Date().toISOString();
  if (row) await db().from("user_sessions").update({ last_seen_at: t, user_agent: ua, ip }).eq("token_hash", h);
  else await db().from("user_sessions").insert({ token_hash: h, user_id: userId, user_agent: ua, ip, created_at: t, last_seen_at: t });
  return { revoked: false };
}

/** Người dùng tự đăng xuất → đóng phiên. */
export async function endSession(token: string) {
  if (!token) return;
  await db().from("user_sessions").update({ revoked_at: new Date().toISOString(), revoked_reason: "logout" }).eq("token_hash", hashToken(token));
}

// ---------------------------------------------------------------- hiển thị thiết bị
export function describeUA(ua: string) {
  const s = String(ua || "");
  const os =
    /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" :
    /Windows NT/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "Không rõ";
  const browser =
    /Zalo/i.test(s) ? "Zalo" : /FBAN|FBAV/.test(s) ? "Facebook" : /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" :
    /CocCoc|coc_coc/i.test(s) ? "Cốc Cốc" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /Firefox\//.test(s) ? "Firefox" :
    /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Trình duyệt khác";
  const mobile = /Mobile|iPhone|Android(?!.*Tablet)/.test(s) && !/iPad|Tablet/.test(s);
  return { os, browser, kind: /iPad|Tablet/.test(s) ? "tablet" : mobile ? "mobile" : "desktop" };
}

export const ONLINE_MINUTES = 5;

/** Danh sách phiên còn hiệu lực (chưa đăng xuất, hoạt động trong 60 ngày) — cho admin. */
export async function listSessions() {
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data, error } = await db()
    .from("user_sessions")
    .select("token_hash, user_id, user_agent, ip, created_at, last_seen_at")
    .is("revoked_at", null)
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error) {
    if (isMissing(error)) return { migrated: false, sessions: [] };
    throw new Error(error.message);
  }
  return { migrated: true, sessions: data ?? [] };
}

export async function revokeSession(tokenHash: string, byUserId: string) {
  const { error } = await db()
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "admin", revoked_by: byUserId })
    .eq("token_hash", tokenHash);
  if (error) throw new Error(isMissing(error) ? "Chưa chạy sql_migration_v26.sql" : error.message);
}
