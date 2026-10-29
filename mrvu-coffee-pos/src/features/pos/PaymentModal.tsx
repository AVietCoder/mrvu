import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import clsx from 'clsx'
import Modal from '@/components/ui/Modal'
import { formatVND, parseVND } from '@/lib/format'
import { toAppError } from '@/lib/errors'
import type { PaymentMethod } from '@/lib/types'
import { fetchOrder, payOrder, type PayLine } from './api'
import { tenderSuggestions } from './cart'

export interface PaidInfo { orderId: string; code: string; total: number; receiptNo: string; receiptId: string | null; change: number }

interface Props {
  order: { id: string; code: string; total: number }
  methods: PaymentMethod[]
  /** Chọn sẵn phương thức khi mở. */
  initialMethod?: 'cash' | 'transfer'
  /** Thanh toán nhanh: tự gửi ngay khi mở (tiền mặt đủ), không cần thao tác thêm. */
  quick?: boolean
  onClose: () => void
  /** Gọi ngay khi server xác nhận. Hộp thoại không tự giữ màn hình sau đó: nơi gọi đóng nó và cho bán tiếp. */
  onPaid: (r: PaidInfo) => void
}

interface Line { method_code: string; amount: number; tendered: string; reference: string }
type Phase = 'form' | 'submitting' | 'unknown'

const keyStore = (orderId: string) => `mrvu-pay-key:${orderId}`
function getKey(orderId: string) {
  try {
    const k = sessionStorage.getItem(keyStore(orderId))
    if (k) return k
    const n = crypto.randomUUID()
    sessionStorage.setItem(keyStore(orderId), n)
    return n
  } catch { return crypto.randomUUID() }
}

export default function PaymentModal({ order, methods, initialMethod, quick = false, onClose, onPaid }: Props) {
  const startMethod = (initialMethod === 'transfer' ? methods.find((m) => !m.is_cash) : methods.find((m) => m.is_cash)) ?? methods[0]
  const [lines, setLines] = useState<Line[]>(() => [{ method_code: startMethod?.code ?? '', amount: order.total, tendered: '', reference: '' }])
  const [phase, setPhase] = useState<Phase>(quick ? 'submitting' : 'form')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [key] = useState(() => getKey(order.id))
  const busyRef = useRef(false)
  const autoRan = useRef(false)

  const isCash = (code: string) => methods.find((m) => m.code === code)?.is_cash ?? false
  const sum = lines.reduce((s, l) => s + l.amount, 0)
  const remaining = order.total - sum
  const single = lines.length === 1
  const cashChange = lines.reduce((s, l) => {
    if (!isCash(l.method_code)) return s
    const t = l.tendered.trim() === '' ? l.amount : parseVND(l.tendered)
    return s + Math.max(0, t - l.amount)
  }, 0)
  const cashShort = lines.some((l) => isCash(l.method_code) && l.tendered.trim() !== '' && parseVND(l.tendered) < l.amount)

  const valid = useMemo(() => lines.length > 0 && lines.every((l) => l.amount > 0 && l.method_code) && remaining === 0 && !cashShort,
    [lines, remaining, cashShort])

  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))

  function payload(): PayLine[] {
    return lines.map((l) => ({
      method_code: l.method_code, amount: l.amount,
      ...(isCash(l.method_code) ? { tendered: l.tendered.trim() === '' ? l.amount : parseVND(l.tendered) } : {}),
      ...(l.reference.trim() ? { reference: l.reference.trim() } : {}),
    }))
  }

  function finish(receiptNo: string, receiptId: string | null, change: number) {
    try { sessionStorage.removeItem(keyStore(order.id)) } catch { /* bỏ qua */ }
    onPaid({ orderId: order.id, code: order.code, total: order.total, receiptNo, receiptId, change })
  }

  async function submit() {
    if (busyRef.current || !valid) return
    busyRef.current = true
    setPhase('submitting'); setError(null); setInfo(null)
    try {
      const r = await payOrder(order.id, payload(), key)
      finish(r.receipt_no, r.receipt_id, cashChange)
    } catch (e) {
      const err = toAppError(e)
      if (err.network) { setPhase('unknown') }
      else { setError(err.message); setPhase('form') }
    } finally { busyRef.current = false }
  }

  // Thanh toán nhanh: gửi đúng một lần ngay khi hộp thoại mở (khóa chống trùng + idempotency key ở server).
  useEffect(() => {
    if (!quick || autoRan.current) return
    autoRan.current = true
    void submit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Sau khi mất phản hồi: hỏi lại server xem giao dịch đã được ghi nhận chưa, KHÔNG gửi lại mù quáng. */
  async function checkStatus() {
    if (busyRef.current) return
    busyRef.current = true
    setInfo(null); setError(null)
    try {
      const o = await fetchOrder(order.id)
      if (['paid', 'partially_refunded', 'refunded'].includes(o.status)) {
        if (o.payment_key === key) finish(`HD-${o.code}`, null, 0)
        else { setError('Đơn này đã được thanh toán bởi một giao dịch khác. Không cần thanh toán lại.'); setPhase('form') }
      } else if (o.status === 'cancelled') {
        setError('Đơn đã bị hủy.'); setPhase('form')
      } else {
        setInfo('Máy chủ xác nhận giao dịch CHƯA được ghi nhận. Bạn có thể thanh toán lại an toàn.'); setPhase('form')
      }
    } catch (e) {
      const err = toAppError(e)
      setError(err.network ? 'Vẫn chưa kết nối được máy chủ. Hãy kiểm tra mạng rồi bấm kiểm tra lại.' : err.message)
      setPhase('unknown')
    } finally { busyRef.current = false }
  }

  function setMethodSingle(code: string) { setLines([{ method_code: code, amount: order.total, tendered: '', reference: '' }]) }

  const locked = phase === 'submitting' || phase === 'unknown'

  return (
    <Modal open title={`Thanh toán đơn ${order.code}`} onClose={onClose} locked={locked} size="md"
      footer={phase === 'unknown' ? (
        <button className="btn-primary" onClick={checkStatus}>Kiểm tra trạng thái giao dịch</button>
      ) : (
        <>
          <button className="btn-secondary" onClick={onClose} disabled={locked}>Quay lại</button>
          <button className="btn-primary min-w-[10rem]" onClick={submit} disabled={!valid || locked}>
            {phase === 'submitting' ? 'Đang xử lý…' : `Xác nhận · ${formatVND(order.total)}`}
          </button>
        </>
      )}>
      {phase === 'unknown' && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={18} /> Chưa nhận được phản hồi từ máy chủ</div>
          Giao dịch có thể đã được ghi nhận. <b>Đừng thu tiền hay thanh toán lại</b> trước khi bấm "Kiểm tra trạng thái giao dịch".
          {error && <div className="mt-2 font-medium text-brand-700">{error}</div>}
        </div>
      )}

      {(phase === 'form' || phase === 'submitting') && (
        <div>
          <div className="mb-4 rounded-xl bg-neutral-900 p-4 text-center text-white">
            <div className="text-sm text-neutral-300">Cần thanh toán</div>
            <div className="text-4xl font-extrabold">{formatVND(order.total)}</div>
          </div>
          {error && <p role="alert" className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{error}</p>}
          {info && <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{info}</p>}

          {single && (
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Phương thức thanh toán">
              {methods.map((m) => (
                <button key={m.code} type="button" aria-pressed={lines[0]?.method_code === m.code} onClick={() => setMethodSingle(m.code)}
                  className={clsx('min-h-[48px] flex-1 rounded-lg border px-4 text-sm font-semibold', lines[0]?.method_code === m.code ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-neutral-300')}>
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {lines.map((l, i) => (
            <div key={i} className={clsx('mb-3 rounded-lg', !single && 'border border-neutral-200 p-3')}>
              {!single && (
                <div className="mb-2 flex gap-2">
                  <select className="input" value={l.method_code} aria-label="Phương thức" onChange={(e) => patch(i, { method_code: e.target.value, tendered: '' })}>
                    {methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </select>
                  <input className="input !w-40 text-right" inputMode="numeric" aria-label="Số tiền" value={l.amount ? String(l.amount) : ''}
                    onChange={(e) => patch(i, { amount: parseVND(e.target.value) })} onFocus={(e) => e.target.select()} />
                  <button className="btn-secondary !px-3" aria-label="Bỏ dòng" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><X size={16} /></button>
                </div>
              )}
              {isCash(l.method_code) ? (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`tender-${i}`}>Tiền khách đưa</label>
                  <input id={`tender-${i}`} className="input text-right text-lg font-bold" inputMode="numeric" autoFocus={i === 0}
                    placeholder={String(l.amount)} value={l.tendered === '' ? '' : formatVND(parseVND(l.tendered))}
                    onChange={(e) => patch(i, { tendered: e.target.value })} onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tenderSuggestions(l.amount).map((v) => (
                      <button key={v} type="button" className="btn-secondary !min-h-[40px] !px-3" onClick={() => patch(i, { tendered: String(v) })}>
                        {v === l.amount ? 'Đủ tiền' : formatVND(v)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`ref-${i}`}>Mã giao dịch / ghi chú (nếu có)</label>
                  <input id={`ref-${i}`} className="input" value={l.reference} maxLength={100} onChange={(e) => patch(i, { reference: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit() }} autoFocus={i === 0} />
                  <p className="mt-1 text-xs text-neutral-500">Ghi nhận thủ công. Hệ thống không tự xác minh giao dịch ngân hàng.</p>
                </div>
              )}
            </div>
          ))}

          {methods.length > 1 && (
            <button className="btn-secondary w-full" disabled={lines.length >= methods.length + 1 || remaining <= 0 && !single}
              onClick={() => {
                const first = lines[0]
                const half = single ? Math.floor(order.total / 2) : 0
                setLines(single
                  ? [{ ...first, amount: order.total - half }, { method_code: methods.find((m) => m.code !== first.method_code)?.code ?? first.method_code, amount: half, tendered: '', reference: '' }]
                  : [...lines, { method_code: methods[0].code, amount: Math.max(remaining, 0), tendered: '', reference: '' }])
              }}>
              <Plus size={16} /> Chia nhiều phương thức
            </button>
          )}

          <div className="mt-3 flex items-center justify-between text-sm">
            {remaining !== 0
              ? <span className="font-semibold text-brand-700">{remaining > 0 ? `Còn thiếu ${formatVND(remaining)}` : `Thừa ${formatVND(-remaining)} so với tổng đơn`}</span>
              : <span className="text-green-700">Đã đủ số tiền</span>}
            {cashChange > 0 && <span className="font-bold">Tiền thừa: {formatVND(cashChange)}</span>}
          </div>
          {cashShort && <p className="mt-1 text-sm text-brand-700">Tiền khách đưa chưa đủ.</p>}
        </div>
      )}
    </Modal>
  )
}
