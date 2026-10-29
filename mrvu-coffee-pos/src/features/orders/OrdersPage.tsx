import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Printer, Search } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { TIME_ZONE, formatDateTime, formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, type OrderStatus, type OrderType, type PaymentMethod } from '@/lib/types'
import { fetchOrder, usePaymentMethods } from '@/features/pos/api'
import { usePrint } from '@/services/print/PrintProvider'
import { JOB_CLASS, JOB_LABEL } from '@/features/printer/jobStatus'
import type { PrintJob } from '@/services/print/printService'
import { downloadCsv } from './csv'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
const STATUS_CLS: Record<OrderStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-700', open: 'bg-blue-50 text-blue-700', pending_payment: 'bg-amber-50 text-amber-800',
  paid: 'bg-green-50 text-green-700', cancelled: 'bg-neutral-200 text-neutral-600', refunded: 'bg-brand-50 text-brand-700', partially_refunded: 'bg-orange-50 text-orange-700',
}
const EDITABLE: OrderStatus[] = ['draft', 'open', 'pending_payment']

interface Row {
  id: string; code: string; type: OrderType; status: OrderStatus; total: number; refunded_total: number
  created_at: string; paid_at: string | null; created_by: string; cashier_id: string | null
  tables: { name: string } | null; customers: { name: string } | null
}

export default function OrdersPage() {
  const { membership } = useAuth()
  const storeId = membership!.store!.id
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [status, setStatus] = useState<'all' | OrderStatus>('all')
  const [staff, setStaff] = useState('all')
  const [code, setCode] = useState('')
  const [term, setTerm] = useState('')
  const [detailId, setDetailId] = useState<string | null>(params.get('order'))
  const methods = usePaymentMethods(storeId)
  useEffect(() => { const t = setTimeout(() => setTerm(code.trim()), 250); return () => clearTimeout(t) }, [code])

  const team = useQuery({
    queryKey: ['team-names', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_roles').select('user_id, profiles(full_name)').eq('store_id', storeId)
      if (error) throw error
      return (data as unknown as { user_id: string; profiles: { full_name: string } | null }[]).map((r) => ({ id: r.user_id, name: r.profiles?.full_name || 'Nhân viên' }))
    },
  })
  const nameOf = (id: string | null) => team.data?.find((t) => t.id === id)?.name ?? ''

  const list = useQuery({
    queryKey: ['orders', storeId, from, to, status, staff, term],
    queryFn: async () => {
      let q = supabase.from('orders').select('id, code, type, status, total, refunded_total, created_at, paid_at, created_by, cashier_id, tables(name), customers(name)')
        .eq('store_id', storeId).neq('status', 'draft')
      if (term) q = q.ilike('code', `%${term.replace(/[%,()]/g, '')}%`)
      else q = q.gte('created_at', `${from}T00:00:00+07:00`).lte('created_at', `${to}T23:59:59.999+07:00`)
      if (status !== 'all') q = q.eq('status', status)
      if (staff !== 'all') q = q.or(`created_by.eq.${staff},cashier_id.eq.${staff}`)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return (data as unknown as Row[]).map((r) => ({ ...r, total: Number(r.total), refunded_total: Number(r.refunded_total) }))
    },
  })

  const listData = list.data
  const rows = useMemo(() => listData ?? [], [listData])
  const paidSum = useMemo(() => rows.filter((r) => ['paid', 'partially_refunded'].includes(r.status)).reduce((s, r) => s + r.total - r.refunded_total, 0), [rows])

  function exportCsv() {
    downloadCsv(`don-hang_${from}_${to}.csv`, [
      ['Mã đơn', 'Thời gian tạo', 'Thanh toán lúc', 'Hình thức', 'Bàn', 'Khách hàng', 'Nhân viên tạo', 'Thu ngân', 'Trạng thái', 'Tổng tiền', 'Đã hoàn'],
      ...rows.map((r) => [r.code, formatDateTime(r.created_at), r.paid_at ? formatDateTime(r.paid_at) : '', ORDER_TYPE_LABEL[r.type], r.tables?.name ?? '',
        r.customers?.name ?? '', nameOf(r.created_by), nameOf(r.cashier_id), ORDER_STATUS_LABEL[r.status], r.total, r.refunded_total]),
    ])
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <h1 className="mr-auto text-xl font-bold">Đơn hàng & hóa đơn</h1>
        <button className="btn-secondary" onClick={exportCsv} disabled={rows.length === 0}><Download size={16} /> Xuất CSV</button>
      </div>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} />
          <input className="input !pl-9" placeholder="Tìm theo mã đơn (bỏ qua ngày)" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <input className="input" type="date" aria-label="Từ ngày" value={from} max={to} disabled={!!term} onChange={(e) => setFrom(e.target.value || today())} />
        <input className="input" type="date" aria-label="Đến ngày" value={to} min={from} disabled={!!term} onChange={(e) => setTo(e.target.value || today())} />
        <select className="input" aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value as 'all' | OrderStatus)}>
          <option value="all">Mọi trạng thái</option>
          {(['open', 'pending_payment', 'paid', 'partially_refunded', 'refunded', 'cancelled'] as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input lg:col-start-3" aria-label="Nhân viên" value={staff} onChange={(e) => setStaff(e.target.value)}>
          <option value="all">Mọi nhân viên</option>
          {team.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading && <Loading />}
        {list.isError && <ErrorState onRetry={() => list.refetch()} />}
        {list.data && rows.length === 0 && <EmptyState title="Không có đơn nào" hint="Thử đổi khoảng ngày hoặc bộ lọc." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr><th className="p-3">Mã đơn</th><th className="p-3">Thời gian</th><th className="p-3">Loại</th><th className="p-3">Nhân viên</th><th className="p-3">Trạng thái</th><th className="p-3 text-right">Tổng tiền</th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-neutral-50" tabIndex={0} onClick={() => setDetailId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(r.id) }}>
                    <td className="p-3 font-semibold">{r.code}</td>
                    <td className="p-3">{formatDateTime(r.paid_at ?? r.created_at)}</td>
                    <td className="p-3">{r.tables?.name ? `Bàn ${r.tables.name}` : ORDER_TYPE_LABEL[r.type]}</td>
                    <td className="p-3">{nameOf(r.cashier_id ?? r.created_by)}</td>
                    <td className="p-3"><span className={clsx('rounded px-2 py-0.5 text-xs font-medium', STATUS_CLS[r.status])}>{ORDER_STATUS_LABEL[r.status]}</span></td>
                    <td className="p-3 text-right font-semibold">{formatVND(r.total)}{r.refunded_total > 0 && <div className="text-xs font-normal text-brand-700">hoàn {formatVND(r.refunded_total)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
            <span>{rows.length} đơn{rows.length >= 300 ? ' (hiển thị tối đa 300, hãy thu hẹp bộ lọc)' : ''}</span>
            <span>Đã thu (sau hoàn tiền): <b>{formatVND(paidSum)}</b></span>
          </div>
        )}
      </div>

      {detailId && <OrderDetail id={detailId} storeId={storeId} methods={methods.data ?? []} team={team.data ?? []}
        onClose={() => { setDetailId(null); if (params.get('order')) setParams({}, { replace: true }) }} />}
    </div>
  )
}

function OrderDetail({ id, storeId, methods, team, onClose }: { id: string; storeId: string; methods: PaymentMethod[]; team: { id: string; name: string }[]; onClose: () => void }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reprintOpen, setReprintOpen] = useState(false)
  const [reprinting, setReprinting] = useState(false)
  const { settings: printSettings, service } = usePrint()

  const q = useQuery({
    queryKey: ['order-detail', id],
    queryFn: async () => {
      const [order, pays, refs, rec] = await Promise.all([
        fetchOrder(id),
        supabase.from('payments').select('line_no, method_code, amount, tendered, change_amount, reference').eq('order_id', id).order('line_no'),
        supabase.from('refunds').select('id, amount, method_code, reason, created_at, created_by').eq('order_id', id).order('created_at'),
        supabase.from('receipts').select('id').eq('order_id', id).maybeSingle(),
      ])
      if (pays.error) throw pays.error
      if (refs.error) throw refs.error
      const receiptId = (rec.data as { id: string } | null)?.id ?? null
      const jobs = receiptId ? await supabase.from('receipt_print_jobs').select('id, receipt_id, kind, status, error, attempts, printer_name, reason, created_at').eq('receipt_id', receiptId).order('created_at') : null
      return { order, receiptId, printJobs: (jobs?.data ?? []) as PrintJob[], payments: pays.data as { line_no: number; method_code: string; amount: number; tendered: number | null; change_amount: number; reference: string | null }[],
        refunds: refs.data as { id: string; amount: number; method_code: string; reason: string; created_at: string; created_by: string }[] }
    },
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['order-detail', id] }); qc.invalidateQueries({ queryKey: ['active-orders'] }); qc.invalidateQueries({ queryKey: ['tables'] }) }
  const methodName = (c: string) => methods.find((m) => m.code === c)?.name ?? c
  const who = (u: string | null) => team.find((t) => t.id === u)?.name ?? ''

  const cancel = useMutation({
    mutationFn: async (reason: string) => { const { error } = await supabase.rpc('rpc_cancel_order', { p_order_id: id, p_reason: reason }); if (error) throw error },
    onSuccess: () => { toast.success('Đã hủy đơn.'); setCancelOpen(false); refresh() },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const o = q.data?.order
  const remaining = o ? o.total - o.refunded_total : 0

  return (
    <Modal open title={o ? `Đơn ${o.code}` : 'Chi tiết đơn'} onClose={onClose} size="lg"
      footer={o && (
        <>
          {q.data?.receiptId && can('order.reprint') && printSettings.allow_reprint
            ? <button className="btn-secondary mr-auto" onClick={() => setReprintOpen(true)}><Printer size={16} /> In lại hóa đơn</button>
            : <span className="mr-auto" />}
          {EDITABLE.includes(o.status) && <button className="btn-secondary" onClick={() => navigate(`/pos?order=${o.id}`)}>Mở để sửa / thanh toán</button>}
          {EDITABLE.includes(o.status) && can('order.cancel') && <button className="btn-secondary text-brand-700" onClick={() => setCancelOpen(true)}>Hủy đơn</button>}
          {['paid', 'partially_refunded'].includes(o.status) && can('order.refund') && <button className="btn-primary" onClick={() => setRefundOpen(true)}>Hoàn tiền</button>}
        </>
      )}>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {o && q.data && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', STATUS_CLS[o.status])}>{ORDER_STATUS_LABEL[o.status]}</span>
            <span>{ORDER_TYPE_LABEL[o.type]}{o.tables?.name ? ` · Bàn ${o.tables.name}` : ''}</span>
            <span>Tạo: {formatDateTime(o.created_at)} · {who(o.created_by)}</span>
            {o.paid_at && <span>Thanh toán: {formatDateTime(o.paid_at)} · {who(o.cashier_id)}</span>}
            {o.customers && <span>Khách: {o.customers.name}{o.customers.phone ? ` (${o.customers.phone})` : ''}</span>}
          </div>
          {o.status === 'cancelled' && <p className="rounded-lg bg-neutral-100 p-2">Đã hủy lúc {o.cancelled_at ? formatDateTime(o.cancelled_at) : ''}. Lý do: {o.cancel_reason || '—'}</p>}
          <table className="w-full">
            <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Món</th><th className="py-1 text-right">SL</th><th className="py-1 text-right">Đơn giá</th><th className="py-1 text-right">Thành tiền</th></tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {o.order_items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2"><div className="font-medium">{i.name_snapshot}{i.variant_snapshot ? ` · ${i.variant_snapshot}` : ''}</div>
                    {i.order_item_modifiers.length > 0 && <div className="text-xs text-neutral-600">+ {i.order_item_modifiers.map((m) => m.name_snapshot).join(', ')}</div>}
                    {i.note && <div className="text-xs italic text-neutral-500">{i.note}</div>}</td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{formatVND(i.unit_price + i.order_item_modifiers.reduce((s, m) => s + m.price_delta, 0))}</td>
                  <td className="py-2 text-right font-medium">{formatVND(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto max-w-xs space-y-1">
            <div className="flex justify-between"><dt>Tạm tính</dt><dd>{formatVND(o.subtotal)}</dd></div>
            {o.subtotal + o.surcharge - o.total > 0 && <div className="flex justify-between text-green-700"><dt>Giảm giá</dt><dd>− {formatVND(o.subtotal + o.surcharge - o.total)}</dd></div>}
            {o.surcharge > 0 && <div className="flex justify-between"><dt>Phụ thu</dt><dd>{formatVND(o.surcharge)}</dd></div>}
            <div className="flex justify-between border-t border-neutral-200 pt-1 text-base font-bold"><dt>Tổng</dt><dd>{formatVND(o.total)}</dd></div>
            {o.refunded_total > 0 && <div className="flex justify-between text-brand-700"><dt>Đã hoàn</dt><dd>− {formatVND(o.refunded_total)}</dd></div>}
          </dl>
          {q.data.payments.length > 0 && (
            <div><h3 className="mb-1 font-semibold">Thanh toán</h3>
              <ul className="space-y-1">{q.data.payments.map((p) => (
                <li key={p.line_no} className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                  <span>{methodName(p.method_code)}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <span>{formatVND(p.amount)}{p.tendered != null && p.change_amount > 0 && <span className="ml-2 text-xs text-neutral-500">(khách đưa {formatVND(p.tendered)}, thừa {formatVND(p.change_amount)})</span>}</span>
                </li>))}</ul></div>
          )}
          {q.data.printJobs.length > 0 && (
            <div><h3 className="mb-1 font-semibold">Lịch sử in</h3>
              <ul className="space-y-1">{q.data.printJobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 rounded bg-neutral-50 px-2 py-1">
                  <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', JOB_CLASS[j.status])}>{JOB_LABEL[j.status]}</span>
                  <span>{j.kind === 'reprint' ? 'In lại' : 'In bill'} · {formatDateTime(j.created_at)}</span>
                  {j.reason && <span className="text-xs text-neutral-600">Lý do: {j.reason}</span>}
                </li>))}</ul></div>
          )}
          {q.data.refunds.length > 0 && (
            <div><h3 className="mb-1 font-semibold">Hoàn tiền</h3>
              <ul className="space-y-1">{q.data.refunds.map((r) => (
                <li key={r.id} className="rounded bg-brand-50 px-2 py-1">
                  <div className="flex justify-between"><span>{formatDateTime(r.created_at)} · {who(r.created_by)} · {methodName(r.method_code)}</span><b>− {formatVND(r.amount)}</b></div>
                  <div className="text-xs text-neutral-600">Lý do: {r.reason}</div>
                </li>))}</ul></div>
          )}
        </div>
      )}

      {reprintOpen && q.data?.receiptId && (
        <ConfirmDialog open askReason busy={reprinting} title="In lại hóa đơn" confirmLabel="In lại" message="Bản in lại ghi 'BẢN SAO' và lý do, lưu vào lịch sử in."
          onCancel={() => setReprintOpen(false)}
          onConfirm={async (reason) => {
            if (reprinting) return
            setReprinting(true)
            try {
              const j = await service.reprintReceipt(q.data!.receiptId!, reason, printSettings)
              if (j.status === 'failed' || j.status === 'unknown') toast.error(`${JOB_LABEL[j.status]}${j.error ? `: ${j.error}` : ''}`); else toast.success(JOB_LABEL[j.status])
              setReprintOpen(false); qc.invalidateQueries({ queryKey: ['order-detail', id] })
            } catch (e) { toast.error(toAppError(e).message) } finally { setReprinting(false) }
          }} />
      )}
      <ConfirmDialog key={`c${cancelOpen}`} open={cancelOpen} askReason danger busy={cancel.isPending} title={`Hủy đơn ${o?.code ?? ''}`} confirmLabel="Hủy đơn"
        message="Đơn sẽ bị hủy và ghi vào nhật ký. Đơn đã hủy không thể thanh toán."
        onCancel={() => setCancelOpen(false)} onConfirm={(r) => cancel.mutate(r)} />
      {refundOpen && o && <RefundDialog orderId={o.id} remaining={remaining} methods={methods} storeId={storeId}
        onClose={() => setRefundOpen(false)} onDone={() => { setRefundOpen(false); refresh() }} />}
    </Modal>
  )
}

function RefundDialog({ orderId, remaining, methods, onClose, onDone }: { orderId: string; remaining: number; methods: PaymentMethod[]; storeId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(String(remaining))
  const [method, setMethod] = useState(methods.find((m) => m.is_cash)?.code ?? methods[0]?.code ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  // Một khóa cho mỗi lần mở hộp thoại: bấm lại hoặc thử lại sau mất mạng không hoàn tiền hai lần.
  const [key] = useState(() => crypto.randomUUID())
  const value = parseVND(amount)
  const invalid = value <= 0 || value > remaining || reason.trim().length < 3 || !method

  async function submit() {
    if (busy || invalid) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_refund_order', { p_order_id: orderId, p_amount: value, p_reason: reason.trim(), p_method_code: method, p_idempotency_key: key })
    setBusy(false)
    const err = error && toAppError(error)
    if (err) return toast.error(err.network ? 'Mất kết nối, chưa rõ đã hoàn tiền hay chưa. Kiểm tra lại chi tiết đơn trước khi thử lại.' : err.message)
    toast.success('Đã ghi nhận hoàn tiền.'); onDone()
  }

  return (
    <Modal open title="Hoàn tiền" onClose={onClose} size="sm" locked={busy}
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Hủy</button><button className="btn-primary" onClick={submit} disabled={busy || invalid}>{busy ? 'Đang xử lý…' : 'Xác nhận hoàn tiền'}</button></>}>
      <div className="space-y-3 text-sm">
        <p>Còn có thể hoàn: <b>{formatVND(remaining)}</b>. Hoàn toàn bộ sẽ hoàn lại nguyên liệu vào kho; hoàn một phần thì không.</p>
        <div><label className="mb-1 block font-medium" htmlFor="rf-amount">Số tiền hoàn</label>
          <input id="rf-amount" className="input text-right" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setAmount(String(parseVND(amount)))} />
          {value > remaining && <p className="mt-1 text-brand-700">Vượt quá số còn có thể hoàn.</p>}</div>
        <div><label className="mb-1 block font-medium" htmlFor="rf-method">Hoàn bằng</label>
          <select id="rf-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
        <div><label className="mb-1 block font-medium" htmlFor="rf-reason">Lý do (bắt buộc)</label>
          <input id="rf-reason" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
    </Modal>
  )
}
