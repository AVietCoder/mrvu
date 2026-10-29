import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import type { CafeTable, Customer, OrderItemRow, OrderRow, PaymentMethod } from '@/lib/types'
import { toSaveItems, type CartLine } from './cart'
import type { usePosStore } from './usePosStore'

type Pos = ReturnType<typeof usePosStore.getState>

export interface FullOrder extends OrderRow {
  order_items: OrderItemRow[]
  customers: { id: string; name: string; phone: string | null } | null
  tables: { name: string } | null
  payment_key: string | null
}

const n = (v: unknown) => Number(v ?? 0)
const normalize = (o: FullOrder): FullOrder => ({
  ...o,
  subtotal: n(o.subtotal), discount_amount: n(o.discount_amount), discount_percent: n(o.discount_percent),
  surcharge: n(o.surcharge), total: n(o.total), refunded_total: n(o.refunded_total),
  order_items: (o.order_items ?? []).map((i) => ({
    ...i, unit_price: n(i.unit_price), line_total: n(i.line_total),
    order_item_modifiers: (i.order_item_modifiers ?? []).map((m) => ({ ...m, price_delta: n(m.price_delta) })),
  })),
})

const ORDER_SELECT = '*, order_items(*, order_item_modifiers(*)), customers(id, name, phone), tables(name)'

export async function fetchOrder(id: string): Promise<FullOrder> {
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id)
    .order('created_at', { referencedTable: 'order_items' }).maybeSingle()
  if (error) throw toAppError(error)
  if (!data) throw toAppError(new Error('Không tìm thấy đơn.'))
  return normalize(data as unknown as FullOrder)
}

/** Lưu đơn qua RPC. Giá, tổng tiền và kiểm tra quyền do database thực hiện. */
export async function saveOrder(storeId: string, s: Pos, canOverridePrice: boolean, status: 'draft' | 'open' | 'pending_payment') {
  const { data, error } = await supabase.rpc('rpc_save_order', {
    p_store: storeId, p_order_id: s.orderId, p_type: s.type, p_table_id: s.tableId, p_customer_id: s.customer?.id ?? null,
    p_note: s.note, p_discount_amount: s.discountAmount, p_discount_percent: s.discountPercent, p_surcharge: s.surcharge,
    p_items: toSaveItems(s.lines, canOverridePrice), p_expected_version: s.version, p_status: status,
  })
  if (error) throw toAppError(error)
  return data as { id: string; code: string; version: number; status: string; total: number }
}

export interface PayLine { method_code: string; amount: number; tendered?: number; reference?: string }

export async function payOrder(orderId: string, lines: PayLine[], key: string) {
  const { data, error } = await supabase.rpc('rpc_pay_order', { p_order_id: orderId, p_payments: lines, p_idempotency_key: key })
  if (error) throw toAppError(error)
  return data as { order_id: string; receipt_id: string; receipt_no: string; replayed: boolean }
}

export function linesFromOrder(o: FullOrder, catalog: Map<string, { price: number; variants: Map<string, number> }>): CartLine[] {
  return o.order_items.map((i) => {
    const cat = i.product_id ? catalog.get(i.product_id) : undefined
    const current = i.variant_id ? cat?.variants.get(i.variant_id) : cat?.price
    return {
      key: i.id, serverId: i.id, productId: i.product_id ?? '', variantId: i.variant_id, name: i.name_snapshot,
      variantName: i.variant_snapshot, basePrice: i.unit_price,
      options: i.order_item_modifiers.map((m) => ({ id: m.option_id ?? m.id, name: m.name_snapshot, priceDelta: m.price_delta })),
      quantity: i.quantity, note: i.note,
      priceOverride: current !== undefined && current !== i.unit_price ? i.unit_price : undefined,
    }
  })
}

export function useTables(storeId: string) {
  return useQuery({
    queryKey: ['tables', storeId],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tables').select('id, name, area, seats, status, opened_at, is_active')
        .eq('store_id', storeId).eq('is_active', true).order('area').order('name')
      if (error) throw toAppError(error)
      return data as CafeTable[]
    },
  })
}

export function usePaymentMethods(storeId: string) {
  return useQuery({
    queryKey: ['payment-methods', storeId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_methods').select('id, code, name, is_cash, is_active')
        .eq('store_id', storeId).eq('is_active', true).order('sort_order')
      if (error) throw toAppError(error)
      return data as PaymentMethod[]
    },
  })
}

export function useActiveOrders(storeId: string) {
  return useQuery({
    queryKey: ['active-orders', storeId],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders')
        .select('id, code, type, status, table_id, total, created_at, version, tables(name), customers(name)')
        .eq('store_id', storeId).in('status', ['draft', 'open', 'pending_payment']).order('created_at', { ascending: false }).limit(100)
      if (error) throw toAppError(error)
      return (data as unknown as (Pick<OrderRow, 'id' | 'code' | 'type' | 'status' | 'table_id' | 'created_at' | 'version'> & {
        total: number; tables: { name: string } | null; customers: { name: string } | null })[]).map((o) => ({ ...o, total: n(o.total) }))
    },
  })
}

export async function searchCustomers(storeId: string, term: string): Promise<Customer[]> {
  const t = term.trim().replace(/[%,()]/g, '')
  let q = supabase.from('customers').select('id, name, phone, note, total_spent, order_count').eq('store_id', storeId)
  if (t) q = q.or(`name.ilike.%${t}%,phone.ilike.%${t}%`)
  const { data, error } = await q.order('name').limit(20)
  if (error) throw toAppError(error)
  return data as Customer[]
}
