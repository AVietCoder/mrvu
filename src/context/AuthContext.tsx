import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthSession, User } from "@/lib/types";
import {
  saveSession,
  loadSession,
  clearSession,
  touchSession,
  SESSION_KEY,
} from "@/lib/auth";
import { endSessionFn, sessionHeartbeatFn } from "@/lib/team.functions";

// Nhịp "đang dùng POS" gửi về máy chủ để admin thấy ai đang online / thiết bị nào (v26).
const HEARTBEAT_MS = 2 * 60_000;

const ACTIVE_BRANCH_KEY = "mrvu_active_branch";

type AuthCtx = {
  session: AuthSession | null;
  user: User | null;
  login: (s: AuthSession) => void;
  logout: () => void;
  isAdmin: boolean;
  branchId: string | undefined;          // backward compat: first branch
  activeBranchId: string | undefined;    // ✅ chi nhánh đang được chọn (persist)
  setActiveBranchId: (id: string) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

function loadActiveBranch(): string | undefined {
  try { return localStorage.getItem(ACTIVE_BRANCH_KEY) || undefined; }
  catch { return undefined; }
}
function saveActiveBranch(id: string) {
  try { localStorage.setItem(ACTIVE_BRANCH_KEY, id); } catch {}
}
function clearActiveBranch() {
  try { localStorage.removeItem(ACTIVE_BRANCH_KEY); } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  const user = session?.user ?? null;

  // Khởi tạo activeBranchId: lấy từ localStorage nếu thuộc branch_ids của user
  const [activeBranchId, _setActiveBranchId] = useState<string | undefined>(() => {
    if (!user) return undefined;
    const saved = loadActiveBranch();
    if (saved && user.branch_ids.includes(saved)) return saved;
    return user.branch_ids[0] ?? undefined;
  });

  function setActiveBranchId(id: string) {
    saveActiveBranch(id);
    _setActiveBranchId(id);
  }

  // Phiên nằm ở localStorage nên MỌI TAB dùng chung. Lắng nghe sự kiện
  // `storage` (chỉ bắn ở các tab KHÁC) để:
  //   • Đăng xuất ở 1 tab  → tất cả tab còn lại cũng thoát ngay.
  //   • Đăng nhập ở 1 tab  → tab đang mở sẵn nhận phiên mới, khỏi F5.
  // Đồng thời gia hạn phiên 1 lần lúc app khởi động (sliding expiration).
  useEffect(() => {
    touchSession();

    function onStorage(e: StorageEvent) {
      // key === null: trình duyệt xoá sạch storage.
      if (e.key !== null && e.key !== SESSION_KEY) return;
      const next = loadSession();
      setSession(next);
      if (!next) _setActiveBranchId(undefined);
      else {
        const saved = loadActiveBranch();
        _setActiveBranchId(
          saved && next.user.branch_ids.includes(saved) ? saved : next.user.branch_ids[0],
        );
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Nhịp hoạt động: lúc mở app, mỗi 2 phút khi tab đang hiện, và khi quay lại tab.
  // Admin đã "đăng xuất thiết bị này" → máy chủ trả revoked → thoát ngay.
  useEffect(() => {
    if (!session?.token || !session.user?.id) return;
    let stopped = false;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r: any = await (sessionHeartbeatFn as any)({ data: { userId: session.user.id, token: session.token } });
        if (r?.revoked && !stopped) {
          clearSession();
          clearActiveBranch();
          setSession(null);
          _setActiveBranchId(undefined);
          window.alert("Phiên đăng nhập trên thiết bị này đã được quản trị viên đăng xuất.");
        }
      } catch {}
    };
    beat();
    const t = window.setInterval(beat, HEARTBEAT_MS);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [session?.token, session?.user?.id]);

  function login(s: AuthSession) {
    saveSession(s);
    setSession(s);
    // Sau login: đặt activeBranchId = branch đã lưu trước (nếu hợp lệ) hoặc branch đầu tiên
    const saved = loadActiveBranch();
    const firstBranch = s.user.branch_ids[0];
    const active = (saved && s.user.branch_ids.includes(saved)) ? saved : firstBranch;
    if (active) saveActiveBranch(active);
    _setActiveBranchId(active);
  }

  function logout() {
    if (session?.token) (endSessionFn as any)({ data: { token: session.token } }).catch(() => undefined);
    clearSession();
    clearActiveBranch();
    setSession(null);
    _setActiveBranchId(undefined);
  }

  return (
    <Ctx.Provider value={{
      session, user, login, logout,
      isAdmin: Boolean(user?.is_admin),
      branchId: user?.branch_ids?.[0],
      activeBranchId,
      setActiveBranchId,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
