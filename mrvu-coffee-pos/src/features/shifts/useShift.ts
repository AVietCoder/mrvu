import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Shift { id: string; opened_by: string; opened_at: string; opening_cash: number; closed_at: string | null; expected_cash: number | null; counted_cash: number | null; difference: number | null; status: 'open' | 'closed'; note: string }
export interface ShiftSummary { shift_id: string; opening_cash: number; cash_sales: number; other_sales: Record<string, number>; cash_in: number; cash_out: number; cash_refunds: number; orders: number; expected_cash: number }

const SHIFT_COLS = 'id, opened_by, opened_at, opening_cash, closed_at, expected_cash, counted_cash, difference, status, note'
const toShift = (s: Shift): Shift => ({ ...s, opening_cash: Number(s.opening_cash), expected_cash: s.expected_cash == null ? null : Number(s.expected_cash), counted_cash: s.counted_cash == null ? null : Number(s.counted_cash), difference: s.difference == null ? null : Number(s.difference) })

export function useMyOpenShift(storeId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['my-shift', storeId, userId], enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select(SHIFT_COLS).eq('store_id', storeId).eq('opened_by', userId!).eq('status', 'open').maybeSingle()
      if (error) throw error
      return data ? toShift(data as Shift) : null
    },
  })
}

export function useShiftSummary(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['shift-summary', shiftId], enabled: Boolean(shiftId), refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shift_summary', { p_shift: shiftId })
      if (error) throw error
      const d = data as ShiftSummary
      return { ...d, opening_cash: Number(d.opening_cash), cash_sales: Number(d.cash_sales), cash_in: Number(d.cash_in), cash_out: Number(d.cash_out), cash_refunds: Number(d.cash_refunds), expected_cash: Number(d.expected_cash) }
    },
  })
}

export function useShiftHistory(storeId: string) {
  return useQuery({
    queryKey: ['shift-history', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select(SHIFT_COLS).eq('store_id', storeId).order('opened_at', { ascending: false }).limit(60)
      if (error) throw error
      return (data as Shift[]).map(toShift)
    },
  })
}
