import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  // Chưa có cửa hàng nào → hiện form cài đặt lần đầu (tạo cửa hàng + tài khoản chủ) thay cho đăng nhập.
  // Lỗi khi hỏi (mất mạng, chưa chạy migration 0011) thì vẫn cho đăng nhập bình thường.
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_setup_status')
      if (error) throw error
      return data as boolean
    },
    retry: false,
  })

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-neutral-900 p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold tracking-tight">
            MR.<span className="text-brand-600">VŨ</span> COFFEE
          </div>
          <div className="mt-1 text-sm text-neutral-500">
            {status.data === false ? 'Cài đặt lần đầu' : 'Đăng nhập hệ thống bán hàng'}
          </div>
        </div>
        {status.isLoading ? <p className="text-center text-sm text-neutral-500">Đang tải…</p>
          : status.data === false ? <FirstSetupForm onDone={() => status.refetch()} /> : <LoginForm />}
      </div>
    </div>
  )
}

function LoginForm() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const err = await signIn(username, password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="mb-1 block text-sm font-medium" htmlFor="username">Tên đăng nhập</label>
      <input id="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} className="input mb-4"
        value={username} onChange={(e) => setUsername(e.target.value)} />
      <label className="mb-1 block text-sm font-medium" htmlFor="password">Mật khẩu</label>
      <input id="password" type="password" required autoComplete="current-password" className="input"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p role="alert" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{error}</p>}
      <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      <p className="mt-4 text-center text-xs text-neutral-500">Quên mật khẩu? Nhờ chủ cửa hàng hoặc quản lý đặt lại.</p>
    </form>
  )
}

function FirstSetupForm({ onDone }: { onDone: () => void }) {
  const { signIn } = useAuth()
  const [f, setF] = useState({ store: 'MR.VŨ COFFEE', address: '', phone: '', fullName: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (f.password !== f.confirm) { setError('Hai lần nhập mật khẩu không khớp.'); return }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('rpc_first_setup', {
      p_store_name: f.store, p_address: f.address, p_phone: f.phone,
      p_full_name: f.fullName, p_username: f.username.trim(), p_password: f.password,
    })
    if (err) {
      setError(err.message)
      setBusy(false)
      // Người khác vừa cài đặt xong → quay về màn hình đăng nhập.
      if (err.message.includes('đã được cài đặt')) onDone()
      return
    }
    const loginErr = await signIn(f.username, f.password)
    if (loginErr) setError(loginErr)
    setBusy(false)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-neutral-600">Hệ thống chưa có cửa hàng. Nhập thông tin quán và tạo tài khoản <b>chủ cửa hàng</b>.</p>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="sname">Tên cửa hàng</label>
        <input id="sname" required className="input" value={f.store} onChange={set('store')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="saddr">Địa chỉ</label>
          <input id="saddr" className="input" value={f.address} onChange={set('address')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="sphone">Số điện thoại</label>
          <input id="sphone" className="input" value={f.phone} onChange={set('phone')} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="oname">Họ tên chủ cửa hàng</label>
        <input id="oname" required className="input" value={f.fullName} onChange={set('fullName')} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="ouser">Tên đăng nhập</label>
        <input id="ouser" required autoComplete="username" autoCapitalize="none" spellCheck={false} className="input"
          placeholder="vd: chuquan" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
          title="3-32 ký tự: chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang" value={f.username} onChange={set('username')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="opw">Mật khẩu</label>
          <input id="opw" type="password" required minLength={6} autoComplete="new-password" className="input"
            value={f.password} onChange={set('password')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="opw2">Nhập lại</label>
          <input id="opw2" type="password" required minLength={6} autoComplete="new-password" className="input"
            value={f.confirm} onChange={set('confirm')} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Đang cài đặt…' : 'Tạo cửa hàng và đăng nhập'}</button>
    </form>
  )
}
