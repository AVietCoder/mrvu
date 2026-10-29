import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toLoginEmail } from '@/lib/login'
import type { AppRole, Permission } from '@/lib/permissions'

export interface StoreInfo {
  id: string
  name: string
  address: string
  phone: string
  footer_note: string
  enable_delivery: boolean
}

interface Membership {
  fullName: string
  active: boolean
  role: AppRole | null
  store: StoreInfo | null
  permissions: Set<Permission>
}

interface AuthState {
  loading: boolean
  session: Session | null
  membership: Membership | null
  can: (p: Permission) => boolean
  signIn: (username: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadMembership(userId: string): Promise<Membership> {
  const { data: profile, error: pErr } = await supabase
    .from('profiles').select('full_name, active').eq('id', userId).maybeSingle()
  if (pErr) throw pErr

  const { data: roleRow, error: rErr } = await supabase
    .from('user_roles').select('role, store_id, stores(id, name, address, phone, footer_note, enable_delivery)')
    .eq('user_id', userId).limit(1).maybeSingle()
  if (rErr) throw rErr

  let permissions = new Set<Permission>()
  if (roleRow) {
    const { data: perms, error: permErr } = await supabase
      .from('role_permissions').select('permission').eq('role', roleRow.role)
    if (permErr) throw permErr
    permissions = new Set((perms ?? []).map((p) => p.permission as Permission))
  }
  const store = (roleRow as unknown as { stores: StoreInfo | null } | null)?.stores ?? null
  return {
    fullName: profile?.full_name ?? '',
    active: profile?.active ?? true,
    role: (roleRow?.role as AppRole | undefined) ?? null,
    store,
    permissions,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) queryClient.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [queryClient])

  const userId = session?.user.id
  const membershipQuery = useQuery({
    queryKey: ['membership', userId],
    queryFn: () => loadMembership(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['membership'] })
  }, [queryClient])

  const value = useMemo<AuthState>(() => {
    const membership = membershipQuery.data ?? null
    return {
      loading: booting || (Boolean(userId) && membershipQuery.isLoading),
      session,
      membership,
      can: (p) => membership?.permissions.has(p) ?? false,
      signIn: async (username, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(username), password })
        if (!error) return null
        if (error.message.toLowerCase().includes('invalid login')) return 'Tên đăng nhập hoặc mật khẩu không đúng.'
        return 'Không thể đăng nhập. Vui lòng kiểm tra kết nối mạng và thử lại.'
      },
      signOut: async () => { await supabase.auth.signOut() },
      refresh,
    }
  }, [booting, userId, session, membershipQuery.data, membershipQuery.isLoading, refresh])

  if (membershipQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-lg font-bold">Không tải được thông tin tài khoản</h1>
          <p className="mt-2 text-sm text-neutral-600">Vui lòng kiểm tra kết nối mạng rồi thử lại.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => membershipQuery.refetch()}>Thử lại</button>
            <button className="btn-secondary" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
          </div>
        </div>
      </div>
    )
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải nằm trong AuthProvider')
  return ctx
}
