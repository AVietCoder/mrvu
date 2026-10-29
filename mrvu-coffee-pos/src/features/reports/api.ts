import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface SalesReport {
  from: string; to: string
  summary: { orders: number; gross: number; discount: number; refunds: number; net: number; avg_order: number; cost: number | null; profit: number | null }
  by_day: { day: string; orders: number; revenue: number }[]
  by_hour: { hour: number; orders: number; revenue: number }[]
  by_method: { method: string; name: string; amount: number }[]
  by_staff: { user_id: string | null; name: string; orders: number; revenue: number }[]
  top_products: { name: string; quantity: number; revenue: number }[]
  by_category: { name: string; quantity: number; revenue: number }[]
}

const n = (v: unknown) => (v == null ? null : Number(v))

export function normalizeReport(r: SalesReport): SalesReport {
  const s = r.summary
  return {
    ...r,
    summary: { orders: Number(s.orders), gross: Number(s.gross), discount: Number(s.discount), refunds: Number(s.refunds), net: Number(s.net), avg_order: Number(s.avg_order), cost: n(s.cost), profit: n(s.profit) },
    by_day: r.by_day.map((d) => ({ ...d, orders: Number(d.orders), revenue: Number(d.revenue) })),
    by_hour: r.by_hour.map((d) => ({ ...d, orders: Number(d.orders), revenue: Number(d.revenue) })),
    by_method: r.by_method.map((d) => ({ ...d, amount: Number(d.amount) })),
    by_staff: r.by_staff.map((d) => ({ ...d, orders: Number(d.orders), revenue: Number(d.revenue) })),
    top_products: r.top_products.map((d) => ({ ...d, quantity: Number(d.quantity), revenue: Number(d.revenue) })),
    by_category: r.by_category.map((d) => ({ ...d, quantity: Number(d.quantity), revenue: Number(d.revenue) })),
  }
}

export function useSalesReport(storeId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['report-sales', storeId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_report_sales', { p_store: storeId, p_from: from, p_to: to })
      if (error) throw error
      return normalizeReport(data as SalesReport)
    },
  })
}

/** Điền đủ 24 giờ (0 đơn nếu không có) để biểu đồ theo giờ không bị khuyết trục. */
export function fillHours(rows: SalesReport['by_hour']) {
  const m = new Map(rows.map((r) => [r.hour, r]))
  return Array.from({ length: 24 }, (_, h) => m.get(h) ?? { hour: h, orders: 0, revenue: 0 })
}

/** Điền đủ các ngày trong khoảng để thấy ngày không có doanh thu. */
export function fillDays(rows: SalesReport['by_day'], from: string, to: string) {
  const m = new Map(rows.map((r) => [r.day, r]))
  const out: SalesReport['by_day'] = []
  const d = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`)
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10)
    out.push(m.get(k) ?? { day: k, orders: 0, revenue: 0 })
  }
  return out
}
