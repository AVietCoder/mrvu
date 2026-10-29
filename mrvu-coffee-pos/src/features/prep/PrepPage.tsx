import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChefHat, Clock, Flame, HandPlatter } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { callNo } from '@/lib/callNo'
import { ORDER_TYPE_LABEL, type OrderType } from '@/lib/types'
import { useToast } from '@/components/ui/Toast'
import { ErrorState, Loading } from '@/components/ui/States'

type Prep = 'queued' | 'preparing' | 'ready' | 'served'
interface PrepOrder {
  id: string; code: string; type: OrderType; note: string; created_at: string; prep_status: Prep
  tables: { name: string } | null
  order_items: { id: string; name_snapshot: string; variant_snapshot: string | null; quantity: number; note: string; order_item_modifiers: { name_snapshot: string }[] }[]
}

const SELECT = 'id, code, type, note, created_at, prep_status, tables(name), order_items(id, name_snapshot, variant_snapshot, quantity, note, order_item_modifiers(name_snapshot))'

/** Màn hình pha chế: đơn đã thanh toán (hoặc đang phục vụ tại bàn) theo thứ tự đến; gọi theo số. */
export default function PrepPage() {
  const { membership } = useAuth()
  const storeId = membership!.store!.id
  const qc = useQueryClient()
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])

  const q = useQuery({
    queryKey: ['prep-board', storeId],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select(SELECT).eq('store_id', storeId)
        .in('prep_status', ['queued', 'preparing', 'ready']).not('status', 'in', '(cancelled,refunded,draft)')
        .order('created_at', { ascending: true }).limit(100)
      if (error) throw toAppError(error)
      return data as unknown as PrepOrder[]
    },
  })

  const set = useMutation({
    mutationFn: async (v: { id: string; status: Prep }) => {
      const { error } = await supabase.rpc('rpc_set_prep_status', { p_order: v.id, p_status: v.status })
      if (error) throw toAppError(error)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prep-board'] }),
    onError: (e) => toast.error(toAppError(e).message),
  })

  if (q.isLoading) return <Loading text="Đang tải đơn pha chế…" />
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />

  const orders = q.data ?? []
  const cols: { status: Prep; title: string; icon: typeof Clock; next: Prep; nextLabel: string }[] = [
    { status: 'queued', title: 'Chờ pha', icon: Clock, next: 'preparing', nextLabel: 'Bắt đầu pha' },
    { status: 'preparing', title: 'Đang pha', icon: Flame, next: 'ready', nextLabel: 'Pha xong' },
    { status: 'ready', title: 'Xong, chờ giao', icon: CheckCircle2, next: 'served', nextLabel: 'Đã giao khách' },
  ]

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-3 flex items-center gap-2 text-xl font-bold"><ChefHat size={22} /> Màn hình pha chế <span className="text-sm font-normal text-neutral-500">({orders.length} đơn)</span></h1>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        {cols.map((c) => {
          const list = orders.filter((o) => o.prep_status === c.status)
          return (
            <section key={c.status} aria-label={c.title} className="flex min-h-0 flex-col rounded-xl bg-neutral-100 p-2">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold"><c.icon size={16} /> {c.title} <span className="rounded-full bg-white px-2 text-xs">{list.length}</span></h2>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {list.length === 0 && <li className="p-6 text-center text-sm text-neutral-500">Không có đơn.</li>}
                {list.map((o) => {
                  const wait = Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60_000))
                  return (
                    <li key={o.id} className="rounded-lg border border-neutral-200 bg-white p-3" data-testid={`prep-${o.id}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-3xl font-extrabold text-brand-700">{callNo(o.code)}</span>
                        <span className="text-xs text-neutral-600">{ORDER_TYPE_LABEL[o.type]}{o.tables ? ` · Bàn ${o.tables.name}` : ''} · <span className={wait >= 10 ? 'font-bold text-brand-700' : ''}>{wait} phút</span></span>
                      </div>
                      <ul className="mt-1 space-y-1 text-sm">
                        {o.order_items.map((i) => (
                          <li key={i.id}>
                            <span className="font-bold">{i.quantity} ×</span> {i.name_snapshot}{i.variant_snapshot ? ` (${i.variant_snapshot})` : ''}
                            {i.order_item_modifiers.length > 0 && <div className="pl-5 text-xs text-neutral-700">+ {i.order_item_modifiers.map((m) => m.name_snapshot).join(', ')}</div>}
                            {i.note && <div className="pl-5 text-xs font-medium text-amber-800">Ghi chú: {i.note}</div>}
                          </li>
                        ))}
                      </ul>
                      {o.note && <div className="mt-1 text-xs font-medium text-amber-800">Ghi chú đơn: {o.note}</div>}
                      <button className="btn-primary mt-2 w-full !min-h-[44px]" disabled={set.isPending} onClick={() => set.mutate({ id: o.id, status: c.next })}>
                        {c.next === 'served' && <HandPlatter size={16} />} {c.nextLabel}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
