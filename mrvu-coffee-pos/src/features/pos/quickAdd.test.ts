import { describe, expect, it } from 'vitest'
import type { Modifier, Product } from '@/lib/types'
import { defaultVariant, hasChoices, quickLine, requiredGroups } from './quickAdd'

const prod = (over: Partial<Product> = {}): Product => ({
  id: 'p1', category_id: null, code: 'CF', name: 'Cà phê sữa', image_url: null, price: 25000, tax_rate: 0, is_active: true, sort_order: 1,
  product_variants: [], product_modifiers: [], ...over,
})
const mod = (min: number, id = 'm1'): Modifier => ({ id, name: 'Đá', min_select: min, max_select: 1, sort_order: 1,
  modifier_options: [{ id: 'o1', modifier_id: id, name: 'Ít đá', price_delta: 0, is_active: true, sort_order: 1 }] })
const variants = [
  { id: 'vL', product_id: 'p1', name: 'Size L', price: 30000, is_active: true, sort_order: 2 },
  { id: 'vM', product_id: 'p1', name: 'Size M', price: 25000, is_active: true, sort_order: 1 },
  { id: 'vX', product_id: 'p1', name: 'Size cũ', price: 1, is_active: false, sort_order: 0 },
] as unknown as Product['product_variants']

describe('thêm món một chạm', () => {
  it('món đơn giản: thêm ngay với giá gốc', () => {
    expect(quickLine(prod(), [])).toMatchObject({ productId: 'p1', variantId: null, basePrice: 25000, quantity: 1, options: [] })
  })
  it('có size: lấy size đang bán đầu tiên theo thứ tự, bỏ qua size đã ngừng', () => {
    const p = prod({ product_variants: variants })
    expect(defaultVariant(p)?.id).toBe('vM')
    expect(quickLine(p, [])).toMatchObject({ variantId: 'vM', variantName: 'Size M', basePrice: 25000 })
  })
  it('tùy chọn không bắt buộc không chặn thêm nhanh', () => {
    const p = prod({ product_modifiers: [{ modifier_id: 'm1' }] })
    expect(quickLine(p, [mod(0)])).not.toBeNull()
  })
  it('nhóm bắt buộc chọn thì không thêm nhanh (phải mở hộp chọn)', () => {
    const p = prod({ product_modifiers: [{ modifier_id: 'm1' }] })
    expect(requiredGroups(p, [mod(1)])).toHaveLength(1)
    expect(quickLine(p, [mod(1)])).toBeNull()
  })
  it('hasChoices: chỉ hiện nút Tùy chọn khi thật sự có lựa chọn', () => {
    expect(hasChoices(prod(), [])).toBe(false)
    expect(hasChoices(prod({ product_variants: variants }), [])).toBe(true)
    expect(hasChoices(prod({ product_modifiers: [{ modifier_id: 'm1' }] }), [mod(0)])).toBe(true)
  })
})
