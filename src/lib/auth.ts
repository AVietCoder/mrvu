// Helpers để lưu/đọc phiên đăng nhập.
//
// TRƯỚC: dùng sessionStorage — mỗi tab là một "hộp" riêng biệt, nên mở đơn hàng
// hay khách hàng ở TAB MỚI là mất phiên và bị đá về trang đăng nhập.
//
// NAY: dùng localStorage — đăng nhập MỘT LẦN, mọi tab dùng chung, đóng trình
// duyệt mở lại vẫn còn. Phiên TỰ GIA HẠN mỗi lần mở app (xem `touchSession`),
// nên người dùng hằng ngày sẽ không bao giờ bị đăng xuất; chỉ hết hạn nếu bỏ
// không dùng liên tục quá SESSION_TTL_DAYS ngày (chốt an toàn cho máy dùng chung).
import type { AuthSession } from "./types";

export const SESSION_KEY = "qt_session";

/** Số ngày không đụng tới app thì phiên mới hết hạn. Sửa 1 chỗ này là đủ. */
export const SESSION_TTL_DAYS = 60;

const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

type StoredSession = { session: AuthSession; saved_at: number };

// localStorage/sessionStorage có thể ném lỗi khi chạy SSR hoặc khi trình duyệt
// chặn cookie/storage → luôn bọc try/catch, không để app trắng màn hình.
function localStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(store: Storage | null): StoredSession | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Định dạng mới: { session, saved_at }
    if (parsed.session?.user) {
      return { session: parsed.session as AuthSession, saved_at: Number(parsed.saved_at) || 0 };
    }
    // Định dạng cũ: lưu thẳng AuthSession, chưa có mốc thời gian.
    if (parsed.user) return { session: parsed as AuthSession, saved_at: 0 };
    return null;
  } catch {
    return null;
  }
}

function isExpired(savedAt: number): boolean {
  if (!savedAt) return false; // dữ liệu cũ chưa có mốc → coi như còn hạn
  return Date.now() - savedAt > TTL_MS;
}

export function saveSession(session: AuthSession) {
  const payload: StoredSession = { session, saved_at: Date.now() };
  try {
    localStore()?.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* hết dung lượng / bị chặn → bỏ qua, phiên vẫn chạy trong RAM */
  }
  // Dọn phiên kiểu cũ để không còn 2 nguồn sự thật.
  try {
    sessionStore()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Đọc phiên hiện tại. KHÔNG ghi lại (trừ lần chuyển đổi dữ liệu cũ duy nhất)
 * để lời gọi từ handler `storage` không tạo vòng lặp ghi qua ghi lại giữa các tab.
 */
export function loadSession(): AuthSession | null {
  const stored = read(localStore());
  if (stored) {
    if (isExpired(stored.saved_at)) {
      clearSession();
      return null;
    }
    return stored.session;
  }

  // Người dùng đang đăng nhập bằng bản cũ (sessionStorage) → chuyển sang
  // localStorage luôn, khỏi bắt đăng nhập lại thêm một lần nữa.
  const legacy = read(sessionStore());
  if (legacy) {
    saveSession(legacy.session);
    return legacy.session;
  }

  return null;
}

/** Gia hạn phiên (dời hạn hết hiệu lực). Gọi 1 lần khi app khởi động. */
export function touchSession() {
  const stored = read(localStore());
  if (!stored || isExpired(stored.saved_at)) return;
  saveSession(stored.session);
}

export function clearSession() {
  try {
    localStore()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStore()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// ⚠️ Các helper canViewBranch / filterByUserBranch cũ đã bị XÓA
// vì dùng field `role` và `branch_id` (số ít) không còn tồn tại trong User.
// Dùng `hasPermission` và `canViewBranch` mới từ `@/lib/types` thay thế.
