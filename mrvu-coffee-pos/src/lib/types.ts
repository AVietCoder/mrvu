export type OrderType = 'dine_in' | 'takeaway' | 'delivery'
export type OrderStatus = 'draft' | 'open' | 'pending_payment' | 'paid' | 'cancelled' | 'refunded' | 'partially_refunded'
export type TableStatus = 'free' | 'occupied' | 'pending_payment'

export const ORDER_TYPE_LABEL: Record<OrderType, string> = { dine_in: 'Tại bàn', takeaway: 'Mang đi', delivery: 'Giao hàng' }
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Nháp', open: 'Đang phục vụ', pending_payment: 'Chờ thanh toán', paid: 'Đã thanh toán',
  cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền', partially_refunded: 'Hoàn một phần',
}

export interface Category { id: string; name: string; sort_order: number; is_active: boolean }
export interface Variant { id: string; product_id: string; name: string; price: number; is_active: boolean; sort_order: number }
export interface ModifierOption { id: string; modifier_id: string; name: string; price_delta: number; is_active: boolean; sort_order: number }
export interface Modifier { id: string; name: string; min_select: number; max_select: number; sort_order: number; modifier_options: ModifierOption[] }
export interface Product {
  id: string; category_id: string | null; code: string; name: string; image_url: string | null
  price: number; tax_rate: number; is_active: boolean; sort_order: number
  product_variants: Variant[]; product_modifiers: { modifier_id: string }[]
}
export interface Menu { categories: Category[]; products: Product[]; modifiers: Modifier[] }

export interface CafeTable { id: string; name: string; area: string; seats: number; status: TableStatus; opened_at: string | null; is_active: boolean }
export interface Customer { id: string; name: string; phone: string | null; note: string; total_spent: number; order_count: number }

export interface OrderItemRow {
  id: string; order_id: string; product_id: string | null; variant_id: string | null
  name_snapshot: string; variant_snapshot: string | null; unit_price: number; quantity: number; note: string; line_total: number
  order_item_modifiers: { id: string; option_id: string | null; name_snapshot: string; price_delta: number }[]
}
export interface OrderRow {
  id: string; code: string; type: OrderType; status: OrderStatus; table_id: string | null; customer_id: string | null
  subtotal: number; discount_amount: number; discount_percent: number; surcharge: number; total: number
  note: string; version: number; refunded_total: number; created_by: string; cashier_id: string | null
  created_at: string; paid_at: string | null; cancelled_at: string | null; cancel_reason: string | null
}
export interface PaymentMethod { id: string; code: string; name: string; is_cash: boolean; is_active: boolean }
