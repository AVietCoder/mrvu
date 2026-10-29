import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Printer, X } from 'lucide-react'
import { formatVND } from '@/lib/format'
import { callNo } from '@/lib/callNo'
import { supabase } from '@/lib/supabase'
import { usePrint } from '@/services/print/PrintProvider'
import type { PrintJob } from '@/services/print/printService'
import { JOB_CLASS, JOB_LABEL, canRetryDirectly, needsConfirmRetry } from '@/features/printer/jobStatus'
import type { PaidInfo } from './PaymentModal'

interface Props {
  info: PaidInfo
  /** Có in phiếu pha chế tự động cho đơn này không (đã tính theo cài đặt + loại đơn). */
  kitchenAuto: boolean
  onClose: () => void
}

type Slot = { job: PrintJob | null; busy: boolean; error: string | null }
const idle: Slot = { job: null, busy: false, error: null }

/**
 * Thanh báo sau thanh toán: KHÔNG phải hộp thoại, không chặn thao tác. Thu ngân bán tiếp ngay;
 * việc in (bill khách + phiếu bếp) chạy nền, lỗi chỉ hiện ở đây và in lại được mà không tạo hóa đơn mới.
 */
export default function PaidBanner({ info, kitchenAuto, onClose }: Props) {
  const { service, settings } = usePrint()
  const [bill, setBill] = useState<Slot>(idle)
  const [kitchen, setKitchen] = useState<Slot>(idle)
  const ran = useRef(false)
  const receiptId = useRef<string | null>(info.receiptId)

  async function run(kind: 'bill' | 'kitchen', retry?: PrintJob, confirmed = false) {
    const set = kind === 'bill' ? setBill : setKitchen
    set((s) => ({ ...s, busy: true, error: null }))
    try {
      let job: PrintJob
      if (retry) job = await service.retryPrint(retry.id, settings, { confirmedNotPrinted: confirmed })
      else if (kind === 'kitchen') job = await service.printKitchenTicket(info.orderId, settings)
      else {
        if (!receiptId.current) {
          const { data } = await supabase.from('receipts').select('id').eq('order_id', info.orderId).maybeSingle()
          receiptId.current = (data as { id: string } | null)?.id ?? null
        }
        if (!receiptId.current) throw new Error('Chưa tìm thấy hóa đơn để in.')
        job = await service.printReceipt(receiptId.current, settings)
      }
      set({ job, busy: false, error: null })
    } catch (e) {
      set((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : 'Lỗi in' }))
    }
  }

  // In tự động chạy nền đúng một lần cho mỗi giao dịch; không bao giờ chặn việc bán tiếp.
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    if (kitchenAuto) void run('kitchen')
    if (settings.auto_print) void run('bill')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const failedOf = (s: Slot) => s.error ?? (s.job && (s.job.status === 'failed' || s.job.status === 'unknown') ? (s.job.error ?? JOB_LABEL[s.job.status]) : null)
  const printProblem = failedOf(bill) ?? failedOf(kitchen)

  const action = (kind: 'bill' | 'kitchen', slot: Slot, label: string) => {
    const j = slot.job
    const retryable = j && j.id
    if (slot.busy) return <span className="text-xs text-neutral-600">{label}: đang in…</span>
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-neutral-700">{label}:</span>
        {j ? <span className={`rounded px-1.5 py-0.5 font-medium ${JOB_CLASS[j.status]}`}>{JOB_LABEL[j.status]}</span>
          : slot.error ? <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">In lỗi</span>
          : <span className="text-neutral-500">chưa in</span>}
        {retryable && needsConfirmRetry(j.status) ? (
          <button className="btn-secondary !min-h-[32px] !px-2 !text-xs" onClick={() => { if (window.confirm('Hãy kiểm tra máy in. Nếu CHƯA thấy giấy, bấm OK để in lại.')) void run(kind, j, true) }}><Printer size={14} /> Chưa thấy, in lại</button>
        ) : (retryable && canRetryDirectly(j.status)) ? (
          <button className="btn-secondary !min-h-[32px] !px-2 !text-xs" onClick={() => void run(kind, j)}><Printer size={14} /> In lại</button>
        ) : (!j && !slot.busy) ? (
          <button className="btn-secondary !min-h-[32px] !px-2 !text-xs" onClick={() => void run(kind)}><Printer size={14} /> {slot.error ? 'Thử lại' : 'In'}</button>
        ) : null}
      </span>
    )
  }

  return (
    <div role="status" aria-label="Đã thanh toán" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-green-200 bg-green-50 px-3 py-2">
      <CheckCircle2 className="text-green-600" size={22} />
      <div className="leading-tight">
        <div className="text-xs text-green-800">Đã thanh toán · gọi số</div>
        <div className="text-3xl font-extrabold text-green-900" data-testid="call-no">{callNo(info.code)}</div>
      </div>
      <div className="leading-tight">
        <div className="text-xs text-neutral-600">Tiền thừa trả khách</div>
        <div className="text-xl font-extrabold text-brand-700" data-testid="change">{formatVND(info.change)}</div>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        {(kitchenAuto || kitchen.job || kitchen.error) && action('kitchen', kitchen, 'Phiếu pha chế')}
        {action('bill', bill, 'Bill khách')}
        {printProblem && (
          <span role="alert" className="text-xs text-brand-700">Đơn đã thanh toán và được giữ nguyên. {printProblem} Bán tiếp bình thường, in lại sau.</span>
        )}
      </div>
      <button className="btn-secondary !min-h-[36px] !px-2" aria-label="Đóng thông báo" onClick={onClose}><X size={16} /></button>
    </div>
  )
}
