import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, UserPlus } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, type AppRole } from '@/lib/permissions'
import { displayUsername } from '@/lib/login'

interface Row {
  user_id: string
  role: AppRole
  profiles: { full_name: string; email: string; active: boolean } | null
}

export default function AccountsPage() {
  const { membership, session } = useAuth()
  const storeId = membership!.store!.id
  const isOwner = membership!.role === 'owner'
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwFor, setPwFor] = useState<string | null>(null)

  const team = useQuery({
    queryKey: ['team', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles').select('user_id, role, profiles(full_name, email, active)')
        .eq('store_id', storeId).order('created_at')
      if (error) throw error
      return data as unknown as Row[]
    },
  })

  const setRole = useMutation({
    mutationFn: async (v: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc('rpc_set_user_role', { p_store: storeId, p_user: v.userId, p_role: v.role })
      if (error) throw error
    },
    onSuccess: () => { setMessage({ ok: true, text: 'Đã cập nhật vai trò.' }); qc.invalidateQueries({ queryKey: ['team'] }) },
    onError: (e: Error) => setMessage({ ok: false, text: e.message }),
  })

  const setActive = useMutation({
    mutationFn: async (v: { userId: string; active: boolean }) => {
      const { error } = await supabase.rpc('rpc_set_user_active', { p_store: storeId, p_user: v.userId, p_active: v.active })
      if (error) throw error
    },
    onSuccess: () => { setMessage({ ok: true, text: 'Đã cập nhật trạng thái tài khoản.' }); qc.invalidateQueries({ queryKey: ['team'] }) },
    onError: (e: Error) => setMessage({ ok: false, text: e.message }),
  })

  const roles = (isOwner ? ['owner', 'manager', 'cashier', 'staff'] : ['manager', 'cashier', 'staff']) as AppRole[]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Tài khoản & phân quyền</h1>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}><UserPlus size={16} /> Thêm nhân viên</button>
      </div>

      {message && (
        <p role="status" className={`mb-3 rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-green-50 text-green-800' : 'bg-brand-50 text-brand-700'}`}>
          {message.text}
        </p>
      )}
      {showForm && (
        <NewStaffForm storeId={storeId} roles={roles} onDone={(text, ok) => {
          setMessage({ ok, text })
          if (ok) { setShowForm(false); qc.invalidateQueries({ queryKey: ['team'] }) }
        }} />
      )}

      <div className="card overflow-hidden">
        {team.isLoading && <p className="p-6 text-sm text-neutral-500">Đang tải danh sách…</p>}
        {team.isError && <p className="p-6 text-sm text-brand-700">Không tải được danh sách. Vui lòng thử lại.</p>}
        {team.data?.length === 0 && <p className="p-6 text-sm text-neutral-500">Chưa có nhân viên nào.</p>}
        <ul className="divide-y divide-neutral-100">
          {team.data?.map((r) => {
            const self = r.user_id === session?.user.id
            const locked = r.role === 'owner' && !isOwner
            return (
              <li key={r.user_id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {r.profiles?.full_name || '(chưa đặt tên)'} {self && <span className="text-xs font-normal text-neutral-500">(bạn)</span>}
                  </div>
                  <div className="truncate text-sm text-neutral-500">{displayUsername(r.profiles?.email)}</div>
                </div>
                <select
                  aria-label={`Vai trò của ${r.profiles?.full_name ?? ''}`}
                  className="input !w-44" value={r.role} disabled={locked || setRole.isPending}
                  onChange={(e) => setRole.mutate({ userId: r.user_id, role: e.target.value as AppRole })}
                >
                  {(roles.includes(r.role) ? roles : [r.role, ...roles]).map((role) => (
                    <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                  ))}
                </select>
                <button
                  className={r.profiles?.active ? 'btn-secondary' : 'btn-primary'}
                  disabled={self || locked || setActive.isPending}
                  onClick={() => {
                    const next = !r.profiles?.active
                    if (!next && !window.confirm(`Khóa tài khoản ${r.profiles?.full_name ?? ''}? Người này sẽ mất quyền ngay lập tức.`)) return
                    setActive.mutate({ userId: r.user_id, active: next })
                  }}
                >
                  {r.profiles?.active ? 'Khóa' : 'Mở khóa'}
                </button>
                <button className="btn-secondary" disabled={locked} title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu của ${r.profiles?.full_name ?? ''}`}
                  onClick={() => setPwFor(pwFor === r.user_id ? null : r.user_id)}>
                  <KeyRound size={16} />
                </button>
                {pwFor === r.user_id && (
                  <PasswordForm storeId={storeId} userId={r.user_id} onDone={(text, ok) => { setMessage({ ok, text }); if (ok) setPwFor(null) }} />
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function NewStaffForm({ storeId, roles, onDone }: { storeId: string; roles: AppRole[]; onDone: (msg: string, ok: boolean) => void }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('cashier')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_create_staff', {
      p_store: storeId, p_username: username.trim(), p_password: password, p_full_name: fullName.trim(), p_role: role,
    })
    setBusy(false)
    if (error) { onDone(error.message || 'Không tạo được tài khoản. Vui lòng thử lại.', false); return }
    onDone(`Đã tạo tài khoản. Nhân viên đăng nhập bằng tên "${username.trim().toLowerCase()}" và mật khẩu vừa đặt.`, true)
  }

  return (
    <form onSubmit={submit} className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
      <input className="input" required placeholder="Họ và tên" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <input className="input" required placeholder="Tên đăng nhập (vd: thungan1)" autoCapitalize="none" spellCheck={false}
        autoComplete="off" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}" title="3-32 ký tự: chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang"
        value={username} onChange={(e) => setUsername(e.target.value)} />
      <input className="input" required type="password" minLength={6} placeholder="Mật khẩu (tối thiểu 6 ký tự)" autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <select className="input" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <button className="btn-primary sm:col-span-2" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
    </form>
  )
}

function PasswordForm({ storeId, userId, onDone }: { storeId: string; userId: string; onDone: (msg: string, ok: boolean) => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_set_password', { p_store: storeId, p_user: userId, p_password: password })
    setBusy(false)
    if (error) { onDone(error.message || 'Không đổi được mật khẩu.', false); return }
    onDone('Đã đặt mật khẩu mới.', true)
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2">
      <input className="input flex-1" required type="password" minLength={6} autoFocus autoComplete="new-password"
        placeholder="Mật khẩu mới (tối thiểu 6 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
    </form>
  )
}
