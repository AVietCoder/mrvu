import type { OrderType } from '@/lib/types'

export interface CartOption { id: string; name: string; priceDelta: number }

export interface CartLine {
  /** Khóa nội bộ để gộp các dòng giống hệt nhau. */
  key: string
  /** Id dòng trên server (khi đơn được tải từ database); dùng cho tách/chuyển món. */
  serverId?: string
  productId: string
  variantId: string | null
  name: string
  variantName: string | null
  basePrice: number
  options: CartOption[]
  quantity: number
  note: string
  /** Chỉ gửi lên server khi người dùng có quyền price.edit. */
  priceOverride?: number
}

export interface Totals { subtotal: number; discount: number; surcharge: number; total: number }

export const unitPrice = (l: CartLine) => (l.priceOverride ?? l.basePrice) + l.options.reduce((s, o) => s + o.priceDelta, 0)
export const lineTotal = (l: CartLine) => unitPrice(l) * l.quantity

/**
 * Công thức tổng tiền, khớp với trigger orders_before_write trong database:
 * giảm giá = min(tạm tính, số tiền giảm + tạm tính × % / 100), tổng = tạm tính − giảm giá + phụ thu.
 * Đây chỉ là giá trị hiển thị; số tiền chính thức do database tính khi lưu.
 */
export function computeTotals(lines: CartLine[], discountAmount: number, discountPercent: number, surcharge: number): Totals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const discount = Math.min(subtotal, Math.max(0, discountAmount) + Math.round((subtotal * Math.max(0, discountPercent)) / 100))
  return { subtotal, discount, surcharge: Math.max(0, surcharge), total: subtotal - discount + Math.max(0, surcharge) }
}

export const lineKey = (p: { productId: string; variantId: string | null; options: CartOption[]; note: string; priceOverride?: number }) =>
  [p.productId, p.variantId ?? '', p.options.map((o) => o.id).sort().join('+'), p.note.trim(), p.priceOverride ?? ''].join('|')

/** Dữ liệu gửi rpc_save_order. Giá do server tự lấy từ danh mục. */
export function toSaveItems(lines: CartLine[], canOverridePrice: boolean) {
  return lines.map((l) => ({
    product_id: l.productId,
    variant_id: l.variantId,
    quantity: l.quantity,
    note: l.note,
    option_ids: l.options.map((o) => o.id),
    ...(canOverridePrice && l.priceOverride !== undefined ? { price_override: l.priceOverride } : {}),
  }))
}

/** Gợi ý mệnh giá tiền khách đưa: đúng số tiền và các mức làm tròn lên. */
export function tenderSuggestions(total: number): number[] {
  const steps = [10_000, 50_000, 100_000, 200_000, 500_000]
  const out = new Set<number>([total])
  for (const s of steps) {
    const up = Math.ceil(total / s) * s
    if (up >= total) out.add(up)
  }
  return [...out].sort((a, b) => a - b).slice(0, 5)
}

export const defaultOrderStatus = (type: OrderType) => (type === 'dine_in' ? 'open' : 'draft')
