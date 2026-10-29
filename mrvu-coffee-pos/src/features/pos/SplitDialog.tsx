import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { ORDER_TYPE_LABEL, type CafeTable } from '@/lib/types'
import { formatVND } from '@/lib/format'
import { useActiveOrders } from './api'

interface Props {
  open: boolean
  storeId: string
  fromOrderId: string
  tables: CafeTable[]
  count: number
  busy: boolean
  onClose: () => void
  onConfirm: (target: { toOrderId: string | null; newTable: string | null }) => void
}

/** Tách các món đã chọn sang đơn mới hoặc chuyển sang một đơn đang mở khác. */
export default function SplitDialog({ open, storeId, fromOrderId, tables, count, busy, onClose, onConfirm }: Props) {
  const orders = useActiveOrders(storeId)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [table, setTable] = useState('')
  const [target, setTarget] = useState('')
  const others = (orders.data ?? []).filter((o) => o.id !== fromOrderId)

  return (
    <Modal open={open} title={`Tách / chuyển ${count} món đã chọn`} onClose={onClose} locked={busy}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Hủy</button>
        <button className="btn-primary" disabled={busy || (mode === 'existing' && !target)}
          onClick={() => onConfirm(mode === 'new' ? { toOrderId: null, newTable: table || null } : { toOrderId: target, newTable: null })}>
          {busy ? 'Đang xử lý…' : 'Xác nhận'}
        </button>
      </>}>
      <div className="mb-3 flex gap-2" role="group">
        <button className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${mode === 'new' ? 'border-brand-600 bg-brand-50' : 'border-neutral-300'}`} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Tách sang đơn mới</button>
        <button className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${mode === 'existing' ? 'border-brand-600 bg-brand-50' : 'border-neutral-300'}`} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>Chuyển sang đơn khác</button>
      </div>
      {mode === 'new' ? (
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="split-table">Bàn của đơn mới</label>
          <select id="split-table" className="input" value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">Cùng bàn với đơn hiện tại (hoặc mang đi)</option>
            {tables.map((t) => <option key={t.id} value={t.id}>Bàn {t.name}{t.status !== 'free' ? ' (đang có đơn)' : ''}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="split-target">Đơn nhận món</label>
          <select id="split-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Chọn đơn…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.tables?.name ? `Bàn ${o.tables.name}` : ORDER_TYPE_LABEL[o.type]} · {formatVND(o.total)}</option>)}
          </select>
        </div>
      )}
    </Modal>
  )
}
