import { useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { TIME_ZONE, formatVND } from '@/lib/format'
import { toAppError } from '@/lib/errors'
import { ErrorState, Loading } from '@/components/ui/States'
import { downloadCsv } from '@/features/orders/csv'
import { fillDays, fillHours, useSalesReport, type SalesReport } from './api'
import BarChartCard from './BarChartCard'

const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d)
const todayStr = () => fmt(new Date())
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monthStart = (s: string) => `${s.slice(0, 7)}-01`
const short = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`

export function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="card p-3"><div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div><div className="mt-1 text-2xl font-extrabold">{value}</div>{note && <div className="text-xs text-neutral-500">{note}</div>}</div>
}

export default function ReportsPage() {
  const storeId = useAuth().membership!.store!.id
  const [from, setFrom] = useState(addDays(todayStr(), -6)); const [to, setTo] = useState(todayStr())
  const r = useSalesReport(storeId, from, to)
  const preset = (a: string, b: string) => { setFrom(a); setTo(b) }
  const t = todayStr()

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <h1 className="mr-auto text-xl font-bold">Báo cáo bán hàng</h1>
        <button className="btn-secondary" disabled={!r.data} onClick={() => r.data && exportCsv(r.data)}><Download size={16} /> Xuất CSV</button>
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button className="btn-secondary !min-h-[36px]" onClick={() => preset(t, t)}>Hôm nay</button>
        <button className="btn-secondary !min-h-[36px]" onClick={() => preset(addDays(t, -1), addDays(t, -1))}>Hôm qua</button>
        <button className="btn-secondary !min-h-[36px]" onClick={() => preset(addDays(t, -6), t)}>7 ngày</button>
        <button className="btn-secondary !min-h-[36px]" onClick={() => preset(monthStart(t), t)}>Tháng này</button>
        <input className="input !w-40" type="date" aria-label="Từ ngày" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span aria-hidden>→</span>
        <input className="input !w-40" type="date" aria-label="Đến ngày" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </div>
      {r.isLoading && <Loading />}
      {r.isError && <ErrorState message={toAppError(r.error).message} onRetry={() => r.refetch()} />}
      {r.data && <ReportBody r={r.data} />}
    </div>
  )
}

function ReportBody({ r }: { r: SalesReport }) {
  const s = r.summary
  const days = fillDays(r.by_day, r.from, r.to).map((d) => ({ label: short(d.day), value: d.revenue, sub: `${d.orders} đơn` }))
  const hours = fillHours(r.by_hour).map((h) => ({ label: `${h.hour}h`, value: h.revenue, sub: `${h.orders} đơn` }))
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Doanh thu thuần" value={formatVND(s.net)} note={`Gộp ${formatVND(s.gross)} − hoàn ${formatVND(s.refunds)}`} />
        <Kpi label="Số đơn" value={String(s.orders)} note={`Trung bình ${formatVND(s.avg_order)}/đơn`} />
        <Kpi label="Giảm giá" value={formatVND(s.discount)} />
        {s.profit != null && s.cost != null ? <Kpi label="Lợi nhuận gộp (ước tính)" value={formatVND(s.profit)} note={`Giá vốn ${formatVND(s.cost)}`} /> : <Kpi label="Lợi nhuận" value="Ẩn" note="Cần quyền xem giá vốn" />}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <BarChartCard title="Doanh thu theo ngày" data={days} />
        <BarChartCard title="Doanh thu theo giờ trong ngày" data={hours} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Table title="Món bán chạy" head={['Món', 'SL', 'Doanh số']} rows={r.top_products.map((p) => [p.name, String(p.quantity), formatVND(p.revenue)])} />
        <Table title="Theo danh mục" head={['Danh mục', 'SL', 'Doanh số']} rows={r.by_category.map((p) => [p.name, String(p.quantity), formatVND(p.revenue)])} />
        <Table title="Theo phương thức thanh toán" head={['Phương thức', 'Số tiền']} rows={r.by_method.map((p) => [p.name, formatVND(p.amount)])} />
        <Table title="Theo thu ngân" head={['Nhân viên', 'Đơn', 'Doanh thu']} rows={r.by_staff.map((p) => [p.name, String(p.orders), formatVND(p.revenue)])} />
      </div>
      <p className="text-xs text-neutral-500">Doanh thu tính theo ngày thanh toán (giờ Việt Nam), hoàn tiền trừ theo ngày hoàn. Bảng “món” và “danh mục” là doanh số theo dòng món, trước giảm giá toàn đơn nên tổng có thể lớn hơn doanh thu. Đơn hoàn toàn bộ không tính vào món bán chạy và giá vốn.</p>
    </>
  )
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-neutral-200 p-3 font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="p-4 text-sm text-neutral-500">Chưa có dữ liệu.</p> : (
        <table className="w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr>{head.map((h, i) => <th key={h} className={i === 0 ? 'p-2 pl-3' : 'p-2 text-right last:pr-3'}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-neutral-100">{rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={j === 0 ? 'p-2 pl-3 font-medium' : 'p-2 text-right last:pr-3'}>{c}</td>)}</tr>)}</tbody></table>
      )}
    </section>
  )
}

function exportCsv(r: SalesReport) {
  const s = r.summary
  downloadCsv(`bao-cao_${r.from}_${r.to}.csv`, [
    ['Báo cáo bán hàng', `${r.from} đến ${r.to}`], [],
    ['Chỉ số', 'Giá trị'], ['Số đơn', s.orders], ['Doanh thu gộp', s.gross], ['Giảm giá', s.discount], ['Hoàn tiền', s.refunds], ['Doanh thu thuần', s.net],
    ...(s.cost != null ? [['Giá vốn', s.cost], ['Lợi nhuận gộp ước tính', s.profit]] : []), [],
    ['Ngày', 'Số đơn', 'Doanh thu'], ...fillDays(r.by_day, r.from, r.to).map((d) => [d.day, d.orders, d.revenue]), [],
    ['Món', 'Số lượng', 'Doanh số'], ...r.top_products.map((p) => [p.name, p.quantity, p.revenue]), [],
    ['Phương thức', 'Số tiền'], ...r.by_method.map((p) => [p.name, p.amount]),
  ])
}
