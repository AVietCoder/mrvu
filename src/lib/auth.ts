// Helpers để lưu/đọc session từ sessionStorage
import type { AuthSession } from "./types";

const KEY = "qt_session";

export function saveSession(session: AuthSession) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
}

// ⚠️ Các helper canViewBranch / filterByUserBranch cũ đã bị XÓA
// vì dùng field `role` và `branch_id` (số ít) không còn tồn tại trong User.
// Dùng `hasPermission` và `canViewBranch` mới từ `@/lib/types` thay thế.
