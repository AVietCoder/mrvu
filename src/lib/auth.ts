// Helpers để lưu/đọc session từ sessionStorage
import type { AuthSession, User } from "./types";

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

// Kiểm tra user có được phép xem branch không
export function canViewBranch(user: User, branchId: string): boolean {
  if (user.role === "admin") return true;       // admin xem tất cả
  if (!user.branch_id) return true;
  return user.branch_id === branchId;
}

// Filter data theo branch của user
export function filterByUserBranch<T extends { branch_id?: string }>(
  items: T[],
  user: User
): T[] {
  if (user.role === "admin") return items;
  return items.filter((item) => item.branch_id === user.branch_id);
}