import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, RefreshCw } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, Loading } from '@/components/ui/States'
import { buildReceiptDocument } from '@/services/print/layout'
import { usePrint } from '@/services/print/PrintProvider'
import type { PrintSettings, ReceiptSnapshot } from '@/services/print/types'
import type { PrintJob } from '@/services/print/printService'
import { JOB_CLASS, JOB_LABEL, canRetryDirectly, effectiveStatus, needsConfirmRetry } from './jobStatus'
import clsx from 'clsx'

const SAMPLE: ReceiptSnapshot = {
  receipt_no: 'HD-MAU-0001', order_code: 'MAU-0001', type: 'dine_in', table: 'A1', cashier: 'Thu ngân', customer: null,
  store: { name: '', address: '', phone: '', footer_note: '' },
  items: [
    { name: 'Cà phê sữa đá', variant: 'L', quantity: 2, unit_price: 29000, note: 'ít đá', line_total: 66000, modifiers: [{ name: 'Trân châu', price_delta: 4000 }] },
    { name: 'Trà đào cam sả', variant: null, quantity: 1, unit_price: 39000, note: '', line_total: 39000, modifiers: [] },
  ],
  subtotal: 105000, discount: 5000, surcharge: 0, total: 100000,
  payments: [{ method_code: 'cash', method_name: 'Tiền mặt', amount: 100000, tendered: 200000, change: 100000 }],
}

export default function PrinterPage() {
  const { settings, settingsLoaded } = usePrint()
  return settingsLoaded ? <PrinterForm saved={settings} /> : <Loading />
}

function PrinterForm({ saved }: { saved: PrintSettings }) {
  const { membership } = useAuth()
  const store = membership!.store!
  const toast = useToast()
  const qc = useQueryClient()
  const { service, reload, simulator } = usePrint()

  const [s, setS] = useState<PrintSettings>(saved)
  const [info, setInfo] = useState({ name: store.name, address: store.address, phone: store.phone, footer_note: store.footer_note })
  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K]) => setS((x) => ({ ...x, [k]: v }))

  const conn = useQuery({ queryKey: ['print-conn', s.method], queryFn: () => service.getConnectionStatus(s), retry: false, staleTime: 0 })
  const printers = useQuery({ queryKey: ['print-printers', s.method, conn.data?.connected], enabled: conn.data?.connected === true, retry: false, queryFn: () => service.listPrinters(s) })
  const pstatus = useQuery({ queryKey: ['print-pstatus', s.method, s.printer_name], enabled: conn.data?.connected === true && s.method === 'qz_tray' && s.printer_name !== '', retry: false, queryFn: () => service.getPrinterStatus(s) })

  const save = useMutation({
    mutationFn: async () => {
      if (!info.name.trim()) throw new Error('Vui lòng nhập tên cửa hàng.')
      const a = await supabase.from('stores').update({ name: info.name.trim(), address: info.address.trim(), phone: info.phone.trim(), footer_note: info.footer_note.trim() }).eq('id', store.id)
      if (a.error) throw a.error
      const b = await supabase.from('print_settings').upsert({ store_id: store.id, ...s })
      if (b.error) throw b.error
    },
    onSuccess: () => { toast.success('Đã lưu cài đặt.'); reload(); qc.invalidateQueries({ queryKey: ['membership'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const test = useMutation({
    mutationFn: () => service.testPrint(s),
    onSuccess: (j) => { if (j.status === 'success' || j.status === 'submitted') toast.success(`In thử: ${JOB_LABEL[j.status]}.`); else toast.error(`In thử: ${JOB_LABEL[j.status]}${j.error ? ` - ${j.error}` : ''}`); qc.invalidateQueries({ queryKey: ['print-jobs'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const preview = useMemo(() => buildReceiptDocument({ ...SAMPLE, store: info }, s, { issuedAt: new Date().toISOString() }).lines.join('\n'), [info, s])

  const jobs = useQuery({
    queryKey: ['print-jobs', store.id], refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('receipt_print_jobs').select('id, receipt_id, kind, status, error, attempts, printer_name, reason, created_at').eq('store_id', store.id).neq('status', 'success').order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data as PrintJob[]
    },
  })
  const retry = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) => service.retryPrint(id, s, { confirmedNotPrinted: confirm }),
    onSuccess: (j) => { toast[j.status === 'failed' || j.status === 'unknown' ? 'error' : 'success'](`${JOB_LABEL[j.status]}${j.error ? `: ${j.error}` : ''}`); qc.invalidateQueries({ queryKey: ['print-jobs'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const label = 'mb-1 block text-sm font-medium'

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_25rem]">
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Máy in & thông tin cửa hàng</h1>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Thông tin in trên bill</h2>
          <div><label className={label} htmlFor="st-name">Tên cửa hàng</label><input id="st-name" className="input" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="st-addr">Địa chỉ</label><input id="st-addr" className="input" value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} /></div>
            <div><label className={label} htmlFor="st-phone">Số điện thoại</label><input id="st-phone" className="input" value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} /></div>
          </div>
          <div><label className={label} htmlFor="st-foot">Lời cuối bill</label><input id="st-foot" className="input" value={info.footer_note} onChange={(e) => setInfo({ ...info, footer_note: e.target.value })} /></div>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Máy in</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="pr-method">Cách in</label>
              <select id="pr-method" className="input" value={s.method} onChange={(e) => set('method', e.target.value as PrintSettings['method'])}>
                <option value="simulator">Giả lập (thử nghiệm, không in ra giấy)</option>
                <option value="qz_tray">QZ Tray (in im lặng ra máy in Windows)</option>
                <option value="browser">Hộp thoại in của trình duyệt</option>
              </select></div>
            <div><label className={label} htmlFor="pr-paper">Khổ giấy</label>
              <select id="pr-paper" className="input" value={s.paper_width} onChange={(e) => set('paper_width', Number(e.target.value) as 58 | 80)}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></div>
          </div>
          <div className={clsx('rounded-lg p-3 text-sm', conn.data?.connected ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')}>
            {conn.isFetching ? 'Đang kiểm tra kết nối…' : conn.data?.message ?? 'Chưa kiểm tra'}
            <button className="ml-2 inline-flex items-center gap-1 underline" onClick={() => conn.refetch()}><RefreshCw size={14} /> Kiểm tra lại</button>
          </div>
          <div><label className={label} htmlFor="pr-name">Tên máy in (trong Windows)</label>
            {printers.data && printers.data.length > 0 ? (
              <select id="pr-name" className="input" value={s.printer_name} onChange={(e) => set('printer_name', e.target.value)}>
                <option value="">Máy in mặc định của Windows</option>
                {printers.data.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : <input id="pr-name" className="input" value={s.printer_name} placeholder="Để trống = máy in mặc định" onChange={(e) => set('printer_name', e.target.value)} />}
            {pstatus.data && <p className="mt-1 text-sm text-neutral-600">{pstatus.data.message}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={label} htmlFor="pr-copies">Số bản</label><input id="pr-copies" type="number" min={1} max={5} className="input" value={s.copies} onChange={(e) => set('copies', Math.min(5, Math.max(1, Number(e.target.value) || 1)))} /></div>
            <div><label className={label} htmlFor="pr-font">Cỡ chữ (tối đa 12)</label><input id="pr-font" type="number" min={8} max={12} className="input" value={s.font_size} onChange={(e) => set('font_size', Math.min(12, Math.max(8, Number(e.target.value) || 12)))} /></div>
            <div><label className={label} htmlFor="pr-margin">Lề (mm)</label><input id="pr-margin" type="number" min={0} max={20} className="input" value={s.margin_mm} onChange={(e) => set('margin_mm', Math.min(20, Math.max(0, Number(e.target.value) || 0)))} /></div>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.auto_print} onChange={(e) => set('auto_print', e.target.checked)} /> Tự động in bill sau khi thanh toán</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.allow_reprint} onChange={(e) => set('allow_reprint', e.target.checked)} /> Cho phép in lại hóa đơn (có ghi lý do, bill ghi "BẢN SAO")</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.kitchen_enabled} onChange={(e) => set('kitchen_enabled', e.target.checked)} /> In phiếu bếp/pha chế khi lưu đơn (bật khi đã có máy in)</label>
          </div>
          {s.kitchen_enabled && <div><label className={label} htmlFor="pr-kit">Máy in bếp (để trống = dùng máy in bill)</label><input id="pr-kit" className="input" value={s.kitchen_printer_name} onChange={(e) => set('kitchen_printer_name', e.target.value)} /></div>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}</button>
            <button className="btn-secondary" onClick={() => test.mutate()} disabled={test.isPending}><Printer size={16} /> {test.isPending ? 'Đang in…' : 'In thử'}</button>
          </div>
          <p className="text-xs text-neutral-500">In thử dùng cài đặt đang hiển thị (chưa cần lưu). Chưa kiểm chứng trên máy in thật nào: hãy in thử trên thiết bị của bạn.</p>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Lệnh in chưa hoàn tất</h2>
          {jobs.isLoading && <Loading />}
          {jobs.data && jobs.data.length === 0 && <EmptyState title="Không có lệnh in nào đang lỗi" />}
          <ul className="divide-y divide-neutral-100 text-sm">
            {jobs.data?.map((j) => {
              const st = effectiveStatus(j.status, j.created_at)
              return (
                <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', JOB_CLASS[st])}>{JOB_LABEL[st]}</span>
                  <span>{j.kind === 'receipt' ? 'Bill' : j.kind === 'reprint' ? 'In lại' : j.kind === 'kitchen' ? 'Phiếu bếp' : 'In thử'} · {formatDateTime(j.created_at)}</span>
                  {j.error && <span className="text-xs text-neutral-500">{j.error}</span>}
                  <span className="ml-auto flex gap-2">
                    {canRetryDirectly(st) && <button className="btn-secondary !min-h-[36px]" onClick={() => retry.mutate({ id: j.id, confirm: false })} disabled={retry.isPending}>In lại</button>}
                    {needsConfirmRetry(st) && <button className="btn-secondary !min-h-[36px]" disabled={retry.isPending} onClick={() => { if (window.confirm('Hãy kiểm tra máy in trước. Nếu CHƯA thấy bill, bấm OK để in lại. Nếu bill đã ra, bấm Hủy.')) retry.mutate({ id: j.id, confirm: true }) }}>Chưa thấy bill, in lại</button>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <aside className="space-y-3">
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold">Xem trước bill mẫu ({s.paper_width} mm)</h2>
          <div className="overflow-x-auto rounded bg-neutral-50 p-3"><pre className="font-mono text-[10px] leading-snug text-neutral-900" aria-label="Xem trước bill">{preview}</pre></div>
        </div>
        {s.method === 'simulator' && (
          <div className="card p-3 text-sm">
            <h2 className="mb-1 font-semibold">Máy in giả lập</h2>
            <p className="text-neutral-600">Bản in giả lập chỉ nằm trong bộ nhớ của trang này (mất khi tải lại).</p>
            <SimPrinted printed={simulator.printed} />
          </div>
        )}
      </aside>
    </div>
  )
}

function SimPrinted({ printed }: { printed: { at: string; lines: string[] }[] }) {
  const last = printed.at(-1)
  if (!last) return <p className="mt-2 text-neutral-500">Chưa có bản in nào.</p>
  return <details className="mt-2"><summary className="cursor-pointer">Bản in gần nhất ({printed.length} bản)</summary><pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-[11px]">{last.lines.join('\n')}</pre></details>
}
