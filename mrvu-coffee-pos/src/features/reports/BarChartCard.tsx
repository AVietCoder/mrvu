import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatVND } from '@/lib/format'

/** Một chuỗi số liệu (một cột doanh thu): tiêu đề nêu tên chuỗi, có chế độ bảng cho người không xem được màu. */
const BAR = '#c2410c' // đã kiểm tra bằng validate_palette (1 chuỗi, tương phản đủ)

export interface BarDatum { label: string; value: number; sub?: string }

export default function BarChartCard({ title, data, valueLabel = 'Doanh thu', emptyText = 'Chưa có dữ liệu trong khoảng này.' }: { title: string; data: BarDatum[]; valueLabel?: string; emptyText?: string }) {
  const [table, setTable] = useState(false)
  const empty = data.every((d) => d.value === 0)
  return (
    <figure className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <figcaption className="font-semibold">{title}</figcaption>
        <button className="text-xs font-medium text-neutral-600 underline" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Xem biểu đồ' : 'Xem bảng số liệu'}</button>
      </div>
      {empty ? <p className="py-10 text-center text-sm text-neutral-500">{emptyText}</p> : table ? (
        <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Mốc</th><th className="py-1 text-right">{valueLabel}</th></tr></thead>
          <tbody className="divide-y divide-neutral-100">{data.map((d) => <tr key={d.label}><td className="py-1">{d.label}</td><td className="py-1 text-right">{formatVND(d.value)}{d.sub ? <span className="ml-2 text-xs text-neutral-500">{d.sub}</span> : null}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="h-56" role="img" aria-label={`${title}: ${data.length} mốc`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e5e5" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d4d4d4' }} tick={{ fontSize: 11, fill: '#52514e' }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: '#52514e' }} tickFormatter={(v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} content={({ active, payload }) => {
                const p = payload?.[0]?.payload as BarDatum | undefined
                return active && p ? <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow"><div className="font-semibold">{p.label}</div><div>{valueLabel}: {formatVND(p.value)}</div>{p.sub && <div className="text-neutral-500">{p.sub}</div>}</div> : null
              }} />
              <Bar dataKey="value" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
