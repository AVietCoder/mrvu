import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { formatVND } from '@/lib/format'
import { ErrorState, Loading } from '@/components/ui/States'
import { Kpi } from './ReportsPage'

interface Sum { orders: number; net: number; avg_order: number }
export default function DashboardPage() {
  const { membership, can } = useAuth()
  const store = membership!.store!
  const q = useQuery({
    queryKey: ['dashboard', store.id], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_dashboard', { p_store: store.id })
      if (error) throw error
      const d = data as { today: Sum; yesterday: Sum; open_orders: number; low_stock: number | null }
      const f = (s: Sum): Sum => ({ orders: Number(s.orders), net: Number(s.net), avg_order: Number(s.avg_order) })
      return { today: f(d.today), yesterday: f(d.yesterday), open_orders: Number(d.open_orders), low_stock: d.low_stock == null ? null : Number(d.low_stock) }
    },
  })
  const d = q.data
  const delta = d && d.yesterday.net > 0 ? Math.round(((d.today.net - d.yesterday.net) / d.yesterday.net) * 100) : null
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">Tổng quan hôm nay · {store.name}</h1>
      {q.isLoading && <Loading />}{q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Doanh thu thuần hôm nay" value={formatVND(d.today.net)} note={delta == null ? 'Hôm qua chưa có doanh thu' : `${delta >= 0 ? '+' : ''}${delta}% so với hôm qua (${formatVND(d.yesterday.net)})`} />
            <Kpi label="Số đơn hôm nay" value={String(d.today.orders)} note={`Hôm qua ${d.yesterday.orders} đơn`} />
            <Kpi label="Đơn đang phục vụ" value={String(d.open_orders)} note="Chưa thanh toán" />
            {d.low_stock != null && <Kpi label="Nguyên liệu sắp hết" value={String(d.low_stock)} note="Bằng hoặc dưới mức tối thiểu" />}
          </div>
          <div className="flex flex-wrap gap-2">
            {can('order.create') && <Link className="btn-primary" to="/pos">Bán hàng</Link>}
            <Link className="btn-secondary" to="/bao-cao">Xem báo cáo chi tiết</Link>
            {d.low_stock ? <Link className="btn-secondary" to="/kho">Xem kho</Link> : null}
          </div>
        </>
      )}
    </div>
  )
}
