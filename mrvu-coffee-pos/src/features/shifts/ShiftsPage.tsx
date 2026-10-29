import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatDateTime, formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { useMyOpenShift, useShiftHistory, useShiftSummary, type ShiftSummary } from './useShift'

export default function ShiftsPage() {
  const { membership, session } = useAuth()
  const storeId = membership!.store!.id
  const userId = session?.user.id
  const mine = useMyOpenShift(storeId, userId)
  const history = useShiftHistory(storeId)
  const names = useQuery({
    queryKey: ['team-names', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_roles').select('user_id, profiles(full_name)').eq('store_id', storeId)
      if (error) throw error
      return (data as unknown as { user_id: string; profiles: { full_name: string } | null }[]).map((r) => ({ id: r.user_id, name: r.profiles?.full_name || 'Nhân viên' }))
    },
  })
  const nameOf = (id: string) => names.data?.find((n) => n.id === id)?.name ?? ''
  const lastCounted = history.data?.find((s) => s.opened_by === userId && s.status === 'closed')?.counted_cash

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">Nhân viên & ca làm</h1>
      {mine.isLoading && <Loading />}
      {mine.isError && <ErrorState onRetry={() => mine.refetch()} />}
      {mine.data === null && <OpenShift storeId={storeId} suggested={lastCounted ?? 0} />}
      {mine.data && <CurrentShift shiftId={mine.data.id} openedAt={mine.data.opened_at} />}

      <section className="card overflow-hidden">
        <h2 className="border-b border-neutral-200 p-3 font-semibold">Lịch sử ca</h2>
        {history.isLoading && <Loading />}
        {history.data?.length === 0 && <EmptyState title="Chưa có ca nào" />}
        {history.data && history.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="p-3">Nhân viên</th><th className="p-3">Mở</th><th className="p-3">Đóng</th><th className="p-3 text-right">Dự kiến</th><th className="p-3 text-right">Đếm</th><th className="p-3 text-right">Chênh lệch</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {history.data.map((s) => (
                  <tr key={s.id}>
                    <td className="p-3 font-medium">{nameOf(s.opened_by)}</td>
                    <td className="p-3">{formatDateTime(s.opened_at)}</td>
                    <td className="p-3">{s.closed_at ? formatDateTime(s.closed_at) : <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Đang mở</span>}</td>
                    <td className="p-3 text-right">{s.expected_cash == null ? '—' : formatVND(s.expected_cash)}</td>
                    <td className="p-3 text-right">{s.counted_cash == null ? '—' : formatVND(s.counted_cash)}</td>
                    <td className={clsx('p-3 text-right font-semibold', s.difference ? 'text-brand-700' : '')}>{s.difference == null ? '—' : formatVND(s.difference)}{s.note && <div className="text-xs font-normal text-neutral-500">{s.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function OpenShift({ storeId, suggested }: { storeId: string; suggested: number }) {
  const toast = useToast(); const qc = useQueryClient()
  const [cash, setCash] = useState(String(suggested))
  const open = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('rpc_open_shift', { p_store: storeId, p_opening_cash: parseVND(cash) }); if (error) throw error },
    onSuccess: () => { toast.success('Đã mở ca.'); qc.invalidateQueries({ queryKey: ['my-shift'] }); qc.invalidateQueries({ queryKey: ['shift-history'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Bạn chưa mở ca</h2>
      <p className="mb-3 text-sm text-neutral-600">Mở ca để các đơn bạn thanh toán được tính vào két và đối chiếu khi đóng ca.</p>
      <label className="mb-1 block text-sm font-medium" htmlFor="sh-open">Tiền mặt đầu ca trong két</label>
      <div className="flex gap-2">
        <input id="sh-open" className="input max-w-xs text-right" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} onBlur={() => setCash(String(parseVND(cash)))} />
        <button className="btn-primary" disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Đang mở…' : 'Mở ca'}</button>
      </div>
    </section>
  )
}

function Row({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return <div className={clsx('flex justify-between py-1', strong && 'border-t border-neutral-200 pt-2 text-base font-bold')}><dt>{label}</dt><dd>{minus && value > 0 ? '− ' : ''}{formatVND(value)}</dd></div>
}

function CurrentShift({ shiftId, openedAt }: { shiftId: string; openedAt: string }) {
  const toast = useToast(); const qc = useQueryClient()
  const sum = useShiftSummary(shiftId)
  const [counted, setCounted] = useState(''); const [note, setNote] = useState('')
  const [result, setResult] = useState<(ShiftSummary & { counted_cash: number; difference: number; open_orders: number }) | null>(null)
  const exp = sum.data?.expected_cash ?? 0
  const has = counted.trim() !== ''
  const diff = has ? parseVND(counted) - exp : 0
  const close = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('rpc_close_shift', { p_shift: shiftId, p_counted: parseVND(counted), p_note: note.trim() }); if (error) throw error; return data as NonNullable<typeof result> },
    onSuccess: (r) => { setResult(r); toast.success('Đã đóng ca.'); qc.invalidateQueries({ queryKey: ['my-shift'] }); qc.invalidateQueries({ queryKey: ['shift-history'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })
  if (result) return (
    <section className="card p-4" role="status">
      <h2 className="font-semibold">Đã đóng ca</h2>
      <p className="text-sm">Dự kiến {formatVND(result.expected_cash)}, đếm {formatVND(result.counted_cash)}, chênh lệch <b className={result.difference ? 'text-brand-700' : ''}>{formatVND(result.difference)}</b>.</p>
      {result.open_orders > 0 && <p className="mt-1 text-sm text-amber-800">Bạn còn {result.open_orders} đơn chưa thanh toán. Hãy kiểm tra trong mục Đơn hàng.</p>}
    </section>
  )
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Ca đang mở <span className="text-sm font-normal text-neutral-500">từ {formatDateTime(openedAt)}</span></h2>
      {sum.isLoading && <Loading />}{sum.isError && <ErrorState onRetry={() => sum.refetch()} />}
      {sum.data && (
        <dl className="mt-2 max-w-md text-sm">
          <Row label="Tiền đầu ca" value={sum.data.opening_cash} />
          <Row label={`Bán tiền mặt (${sum.data.orders} đơn)`} value={sum.data.cash_sales} />
          <Row label="Thu khác tiền mặt" value={sum.data.cash_in} />
          <Row label="Chi tiền mặt" value={sum.data.cash_out} minus />
          <Row label="Hoàn tiền mặt" value={sum.data.cash_refunds} minus />
          <Row label="Tiền mặt dự kiến trong két" value={sum.data.expected_cash} strong />
          {Object.entries(sum.data.other_sales).map(([k, v]) => <div key={k} className="mt-1 flex justify-between text-neutral-600"><dt>Bán qua “{k}” (không vào két)</dt><dd>{formatVND(Number(v))}</dd></div>)}
        </dl>
      )}
      <div className="mt-4 grid max-w-md gap-3 border-t border-neutral-200 pt-4 text-sm">
        <div><label className="mb-1 block font-medium" htmlFor="sh-count">Tiền mặt đếm thực tế</label>
          <input id="sh-count" className="input text-right" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} onBlur={() => has && setCounted(String(parseVND(counted)))} /></div>
        {has && <p className={clsx('font-semibold', diff === 0 ? 'text-green-700' : 'text-brand-700')}>{diff === 0 ? 'Khớp với dự kiến.' : `${diff > 0 ? 'Thừa' : 'Thiếu'} ${formatVND(Math.abs(diff))} so với dự kiến.`}</p>}
        {has && diff !== 0 && <div><label className="mb-1 block font-medium" htmlFor="sh-note">Lý do chênh lệch (bắt buộc)</label><input id="sh-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>}
        <button className="btn-primary" disabled={!has || (diff !== 0 && note.trim().length < 3) || close.isPending || !sum.data} onClick={() => close.mutate()}>{close.isPending ? 'Đang đóng ca…' : 'Đóng ca'}</button>
      </div>
    </section>
  )
}
