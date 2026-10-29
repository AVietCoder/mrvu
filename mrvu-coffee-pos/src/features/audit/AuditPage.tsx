import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { TIME_ZONE, formatDateTime } from '@/lib/format'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
const LABEL: Record<string, string> = {
  'order.pay': 'Thanh toán đơn', 'order.cancel': 'Hủy đơn', 'order.refund': 'Hoàn tiền', 'shift.open': 'Mở ca', 'shift.close': 'Đóng ca',
  'stock.waste': 'Hao hụt kho', 'stock.adjustment': 'Điều chỉnh kho', 'stock.stocktake': 'Kiểm kho', 'purchase.save': 'Lưu phiếu nhập', 'purchase.receive': 'Nhận hàng',
  'purchase.cancel': 'Hủy phiếu nhập', 'recipe.save': 'Sửa công thức', 'cash.income': 'Ghi thu', 'cash.expense': 'Ghi chi', 'user.set_role': 'Đổi vai trò',
  'user.activate': 'Mở khóa tài khoản', 'user.deactivate': 'Khóa tài khoản', 'store.bootstrap': 'Khởi tạo cửa hàng',
}
interface Row { id: number; user_id: string | null; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; created_at: string }

export default function AuditPage() {
  const storeId = useAuth().membership!.store!.id
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [action, setAction] = useState('all')
  const names = useQuery({ queryKey: ['team-names', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('user_roles').select('user_id, profiles(full_name)').eq('store_id', storeId); if (error) throw error
    return (data as unknown as { user_id: string; profiles: { full_name: string } | null }[]).map((r) => ({ id: r.user_id, name: r.profiles?.full_name || 'Nhân viên' })) } })
  const list = useQuery({
    queryKey: ['audit', storeId, from, to, action],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('id, user_id, action, entity, entity_id, detail, created_at').eq('store_id', storeId)
        .gte('created_at', `${from}T00:00:00+07:00`).lte('created_at', `${to}T23:59:59.999+07:00`)
      if (action !== 'all') q = q.eq('action', action)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as Row[]
    },
  })
  const who = (id: string | null) => names.data?.find((n) => n.id === id)?.name ?? 'Hệ thống'
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-xl font-bold">Nhật ký hoạt động</h1>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-3">
        <input className="input" type="date" aria-label="Từ ngày" value={from} max={to} onChange={(e) => setFrom(e.target.value || today())} />
        <input className="input" type="date" aria-label="Đến ngày" value={to} min={from} onChange={(e) => setTo(e.target.value || today())} />
        <select className="input" aria-label="Hành động" value={action} onChange={(e) => setAction(e.target.value)}><option value="all">Mọi hành động</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="card overflow-hidden">
        {list.isLoading && <Loading />}{list.isError && <ErrorState onRetry={() => list.refetch()} />}
        {list.data?.length === 0 && <EmptyState title="Không có hoạt động" />}
        <ul className="divide-y divide-neutral-100 text-sm">
          {list.data?.map((r) => (
            <li key={r.id} className="p-3">
              <div className="flex flex-wrap gap-x-3"><span className="font-semibold">{LABEL[r.action] ?? r.action}</span><span className="text-neutral-600">{who(r.user_id)}</span><span className="text-neutral-500">{formatDateTime(r.created_at)}</span></div>
              {Object.keys(r.detail ?? {}).length > 0 && <details className="mt-1 text-xs text-neutral-600"><summary className="cursor-pointer">Chi tiết</summary><pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2">{JSON.stringify(r.detail, null, 2)}</pre></details>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
