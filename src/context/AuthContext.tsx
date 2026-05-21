import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthSession, User } from "@/lib/types";
import { saveSession, loadSession, clearSession } from "@/lib/auth";

type AuthCtx = {
  session: AuthSession | null;
  user: User | null;
  login: (s: AuthSession) => void;
  logout: () => void;
  isAdmin: boolean;
  branchId: string | undefined;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());

  function login(s: AuthSession) { saveSession(s); setSession(s); }
  function logout() { clearSession(); setSession(null); }

  const user = session?.user ?? null;

  return (
    <Ctx.Provider value={{
      session, user, login, logout,
      isAdmin: Boolean(user?.is_admin),
      branchId: user?.branch_ids?.[0],
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