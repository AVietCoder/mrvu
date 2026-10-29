import { useState, type FormEvent } from 'react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'

/** Hiện khi tài khoản đăng nhập chưa thuộc cửa hàng nào. */
export default function SetupPage() {
  const { refresh, signOut } = useAuth()
  const [name, setName] = useState('MR.VŨ COFFEE')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('rpc_bootstrap_store', {
      p_name: name, p_address: address, p_phone: phone,
    })
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    await refresh()
    setBusy(false)
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md p-6">
        <h1 className="text-xl font-bold">Khởi tạo cửa hàng</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Tài khoản này chưa thuộc cửa hàng nào. Nếu hệ thống chưa được cài đặt, bạn sẽ trở thành chủ cửa hàng.
          Nếu cửa hàng đã có, hãy nhờ chủ cửa hàng tạo tài khoản và cấp quyền cho bạn.
        </p>
        <label className="mb-1 mt-4 block text-sm font-medium" htmlFor="sname">Tên cửa hàng</label>
        <input id="sname" required className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mb-1 mt-3 block text-sm font-medium" htmlFor="saddr">Địa chỉ</label>
        <input id="saddr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        <label className="mb-1 mt-3 block text-sm font-medium" htmlFor="sphone">Số điện thoại</label>
        <input id="sphone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error && <p role="alert" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo cửa hàng'}</button>
          <button type="button" className="btn-secondary" onClick={signOut}>Đăng xuất</button>
        </div>
      </form>
    </div>
  )
}
