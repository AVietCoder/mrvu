import type { Modifier, Product } from '@/lib/types'
import type { CartLine } from './cart'

/** Size mặc định khi bấm một chạm: size đang bán đầu tiên theo thứ tự hiển thị. */
export function defaultVariant(p: Product) {
  return [...p.product_variants].filter((v) => v.is_active).sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
}

/** Nhóm tùy chọn bắt buộc chọn (min_select > 0) của món. Có nhóm này thì bấm một chạm phải mở hộp chọn. */
export function requiredGroups(p: Product, modifiers: Modifier[]) {
  const ids = new Set(p.product_modifiers.map((m) => m.modifier_id))
  return modifiers.filter((m) => ids.has(m.id) && m.min_select > 0 && m.modifier_options.some((o) => o.is_active))
}

/** Dòng giỏ hàng cho thao tác một chạm, hoặc null nếu món bắt buộc phải chọn thêm. */
export function quickLine(p: Product, modifiers: Modifier[]): Omit<CartLine, 'key'> | null {
  if (requiredGroups(p, modifiers).length > 0) return null
  const v = defaultVariant(p)
  return { productId: p.id, variantId: v?.id ?? null, name: p.name, variantName: v?.name ?? null, basePrice: v ? v.price : p.price, options: [], quantity: 1, note: '' }
}

/** Món có thể chọn thêm (size nhiều hơn một, hoặc có nhóm tùy chọn) nên cần nút "Tùy chọn". */
export function hasChoices(p: Product, modifiers: Modifier[]) {
  const mods = new Set(p.product_modifiers.map((m) => m.modifier_id))
  return p.product_variants.filter((v) => v.is_active).length > 1 || modifiers.some((m) => mods.has(m.id) && m.modifier_options.some((o) => o.is_active))
}
