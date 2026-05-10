import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { AuthSession, User } from "@/lib/types";
import { saveSession, loadSession, clearSession } from "@/lib/auth";

type AuthCtx = {
  session: AuthSession | null;
  user: User | null;
  login: (session: AuthSession) => void;
  logout: () => void;
  isAdmin: boolean;
  branchId: string | undefined;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());

  function login(s: AuthSession) {
    saveSession(s);
    setSession(s);
  }

  function logout() {
    clearSession();
    setSession(null);
  }

  const user = session?.user ?? null;

  return (
    <Ctx.Provider
      value={{
        session,
        user,
        login,
        logout,
        isAdmin: user?.role === "admin",
        branchId: user?.branch_id,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}