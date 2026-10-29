import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { formatTime, formatVND } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, type OrderStatus, type OrderType } from '@/lib/types'
import { useQuery } from '@tanstack/react-query'
import { useActiveOrders } from './api'

interface Props {
  open: boolean
  storeId: string
  /** Chỉ hiện đơn của bàn này (khi mở bàn đang có nhiều đơn). */
  tableId?: string | null
  onClose: () => void
  onPick: (orderId: string) => void
}

/** Danh sách đơn đang mở để khôi phục, kèm tìm đơn theo mã (kể cả đơn đã thanh toán). */
export default function OrdersDrawer({ open, storeId, tableId, onClose, onPick }: Props) {
  const navigate = useNavigate()
  const active = useActiveOrders(storeId)
  const [code, setCode] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => { const t = setTimeout(() => setTerm(code.trim()), 250); return () => clearTimeout(t) }, [code])

  const found = useQuery({
    queryKey: ['order-search', storeId, term],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const t = term.replace(/[%,()]/g, '')
      const { data, error } = await supabase.from('orders').select('id, code, status, type, total, created_at')
        .eq('store_id', storeId).ilike('code', `%${t}%`).order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return data as { id: string; code: string; status: OrderStatus; type: OrderType; total: number; created_at: string }[]
    },
  })

  const list = (active.data ?? []).filter((o) => !tableId || o.table_id === tableId)
  const editable = (s: OrderStatus) => ['draft', 'open', 'pending_payment'].includes(s)

  return (
    <Modal open={open} title="Đơn đang mở" onClose={onClose} size="md">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} />
        <input className="input !pl-9" placeholder="Tìm đơn theo mã (ví dụ 261028-0003)" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </div>

      {term.length >= 2 ? (
        <div>
          {found.isFetching && <Loading />}
          {found.isError && <ErrorState onRetry={() => found.refetch()} />}
          {found.data?.length === 0 && <EmptyState title="Không tìm thấy đơn" />}
          <ul className="divide-y divide-neutral-100">
            {found.data?.map((o) => (
              <li key={o.id}>
                <button className="flex min-h-[52px] w-full items-center justify-between gap-2 px-2 text-left hover:bg-neutral-50"
                  onClick={() => (editable(o.status) ? onPick(o.id) : navigate(`/don-hang?order=${o.id}`))}>
                  <span><b>{o.code}</b> <span className="text-sm text-neutral-500">· {ORDER_TYPE_LABEL[o.type]}</span></span>
                  <span className="text-right text-sm"><div className="font-semibold">{formatVND(o.total)}</div><div className="text-neutral-500">{ORDER_STATUS_LABEL[o.status]}</div></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          {active.isLoading && <Loading />}
          {active.isError && <ErrorState onRetry={() => active.refetch()} />}
          {active.data && list.length === 0 && <EmptyState title="Không có đơn đang mở" hint="Đơn lưu tạm hoặc đang phục vụ sẽ hiện ở đây." />}
          <ul className="divide-y divide-neutral-100">
            {list.map((o) => (
              <li key={o.id}>
                <button className="flex min-h-[56px] w-full items-center justify-between gap-2 px-2 text-left hover:bg-neutral-50" onClick={() => onPick(o.id)}>
                  <span>
                    <b>{o.code}</b>
                    <span className="ml-2 text-sm text-neutral-600">{o.tables?.name ? `Bàn ${o.tables.name}` : ORDER_TYPE_LABEL[o.type]}</span>
                    <div className="text-xs text-neutral-500">{formatTime(o.created_at)}{o.customers?.name ? ` · ${o.customers.name}` : ''}</div>
                  </span>
                  <span className="text-right">
                    <div className="font-semibold">{formatVND(o.total)}</div>
                    <div className="text-xs text-neutral-500">{ORDER_STATUS_LABEL[o.status]}</div>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
