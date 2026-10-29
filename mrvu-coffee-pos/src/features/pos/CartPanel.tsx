import { Minus, Percent, Plus, Trash2, User, X } from 'lucide-react'
import clsx from 'clsx'
import { formatVND, parseVND } from '@/lib/format'
import { callNo } from '@/lib/callNo'
import { ORDER_TYPE_LABEL, type CafeTable, type OrderType } from '@/lib/types'
import { computeTotals, lineTotal, unitPrice } from './cart'
import { usePosStore } from './usePosStore'

interface Props {
  tables: CafeTable[]
  canDiscount: boolean
  deliveryEnabled: boolean
  selected: Set<string>
  onToggleSelect: (key: string) => void
  onPickCustomer: () => void
  onSplit: () => void
  disabled: boolean
}

export default function CartPanel({ tables, canDiscount, deliveryEnabled, selected, onToggleSelect, onPickCustomer, onSplit, disabled }: Props) {
  const s = usePosStore()
  const totals = computeTotals(s.lines, s.discountAmount, s.discountPercent, s.surcharge)
  const types: OrderType[] = deliveryEnabled ? ['dine_in', 'takeaway', 'delivery'] : ['dine_in', 'takeaway']
  const canSplit = !!s.orderId && !s.dirty && s.lines.length > 1 && selected.size > 0 && selected.size < s.lines.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-neutral-200 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">{s.code ? `Đơn ${callNo(s.code)} · ${s.code}` : 'Đơn mới'}</div>
          {s.serverStatus && <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{s.serverStatus === 'pending_payment' ? 'Chờ thanh toán' : s.serverStatus === 'open' ? 'Đang phục vụ' : 'Lưu tạm'}</span>}
        </div>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Hình thức phục vụ">
          {types.map((t) => (
            <button key={t} aria-pressed={s.type === t} disabled={disabled}
              className={clsx('min-h-[40px] rounded-lg border text-sm font-semibold', s.type === t ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-neutral-300')}
              onClick={() => s.setType(t)}>{ORDER_TYPE_LABEL[t]}</button>
          ))}
        </div>
        {s.type === 'dine_in' && (
          <select className="input" aria-label="Chọn bàn" disabled={disabled} value={s.tableId ?? ''}
            onChange={(e) => { const t = tables.find((x) => x.id === e.target.value); s.setTable(t?.id ?? null, t?.name ?? null); if (!t) s.setType('dine_in') }}>
            <option value="">Chọn bàn…</option>
            {tables.map((t) => <option key={t.id} value={t.id}>Bàn {t.name}{t.area ? ` · ${t.area}` : ''}{t.status === 'free' ? '' : t.status === 'occupied' ? ' · đang phục vụ' : ' · chờ thanh toán'}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <button className="btn-secondary min-w-0 flex-1 justify-start !px-3" onClick={onPickCustomer} disabled={disabled}>
            <User size={16} className="shrink-0" />
            <span className="truncate">{s.customer ? `${s.customer.name}${s.customer.phone ? ` · ${s.customer.phone}` : ''}` : 'Gắn khách hàng'}</span>
          </button>
          {s.customer && <button className="btn-secondary !px-3" aria-label="Bỏ khách hàng" onClick={() => s.setCustomer(null)} disabled={disabled}><X size={16} /></button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {s.lines.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">Chưa có món nào.<br />Chọn món ở bên trái để thêm vào đơn.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {s.lines.map((l) => (
              <li key={l.key} className="p-3">
                <div className="flex items-start gap-2">
                  {!!s.orderId && !s.dirty && s.lines.length > 1 && (
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-600" aria-label={`Chọn ${l.name} để tách`} checked={selected.has(l.key)} onChange={() => onToggleSelect(l.key)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-tight">{l.name}{l.variantName ? ` · ${l.variantName}` : ''}</div>
                    {l.options.length > 0 && <div className="text-xs text-neutral-600">+ {l.options.map((o) => o.name).join(', ')}</div>}
                    <input className="mt-1 w-full border-0 border-b border-dashed border-neutral-300 bg-transparent p-0 text-xs text-neutral-600 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-0"
                      placeholder="Ghi chú món…" maxLength={200} value={l.note} disabled={disabled} onChange={(e) => s.setLineNote(l.key, e.target.value)} aria-label={`Ghi chú ${l.name}`} />
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatVND(lineTotal(l))}</div>
                    <div className="text-xs text-neutral-500">{formatVND(unitPrice(l))}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-end gap-1">
                  <button className="btn-secondary !min-h-[40px] !px-3" aria-label="Giảm số lượng" disabled={disabled} onClick={() => s.setQty(l.key, l.quantity - 1)}><Minus size={16} /></button>
                  <input className="input !min-h-[40px] !w-14 text-center font-bold" inputMode="numeric" aria-label={`Số lượng ${l.name}`} value={l.quantity} disabled={disabled}
                    onChange={(e) => { const v = parseVND(e.target.value); if (v > 0) s.setQty(l.key, v) }} onFocus={(e) => e.target.select()} />
                  <button className="btn-secondary !min-h-[40px] !px-3" aria-label="Tăng số lượng" disabled={disabled} onClick={() => s.setQty(l.key, l.quantity + 1)}><Plus size={16} /></button>
                  <button className="btn-secondary !min-h-[40px] !px-3 text-brand-700" aria-label={`Xóa ${l.name}`} disabled={disabled} onClick={() => s.removeLine(l.key)}><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1 border-t border-neutral-200 p-3 text-sm">
        {canSplit && <button className="btn-secondary mb-2 w-full" onClick={onSplit} disabled={disabled}>Tách / chuyển {selected.size} món đã chọn</button>}
        <div className="flex justify-between"><span className="text-neutral-600">Tạm tính</span><span>{formatVND(totals.subtotal)}</span></div>
        {canDiscount && (
          <div className="flex items-center gap-2">
            <Percent size={14} className="text-neutral-500" />
            <input className="input !min-h-[36px] !w-24 text-right" inputMode="numeric" aria-label="Giảm giá theo số tiền" placeholder="₫" disabled={disabled}
              value={s.discountAmount ? String(s.discountAmount) : ''} onChange={(e) => s.setDiscount(parseVND(e.target.value), s.discountPercent)} />
            <input className="input !min-h-[36px] !w-16 text-right" inputMode="decimal" aria-label="Giảm giá theo phần trăm" placeholder="%" disabled={disabled}
              value={s.discountPercent ? String(s.discountPercent) : ''}
              onChange={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)); s.setDiscount(s.discountAmount, v) }} />
            <span className="ml-auto text-green-700">{totals.discount > 0 ? `− ${formatVND(totals.discount)}` : 'Giảm giá'}</span>
          </div>
        )}
        {!canDiscount && totals.discount > 0 && <div className="flex justify-between text-green-700"><span>Giảm giá</span><span>− {formatVND(totals.discount)}</span></div>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-neutral-600">Phụ thu</span>
          <input className="input !min-h-[36px] !w-28 text-right" inputMode="numeric" aria-label="Phụ thu" disabled={disabled}
            value={s.surcharge ? String(s.surcharge) : ''} placeholder="0" onChange={(e) => s.setSurcharge(parseVND(e.target.value))} />
        </div>
        <div className="flex items-baseline justify-between border-t border-neutral-200 pt-2">
          <span className="text-base font-bold">Tổng thanh toán</span>
          <span className="text-2xl font-extrabold text-brand-700">{formatVND(totals.total)}</span>
        </div>
      </div>
    </div>
  )
}
