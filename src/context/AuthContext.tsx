import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthSession, User } from "@/lib/types";
import { saveSession, loadSession, clearSession } from "@/lib/auth";

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
