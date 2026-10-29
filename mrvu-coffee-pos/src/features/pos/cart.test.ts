import { describe, expect, it } from 'vitest'
import { computeTotals, lineKey, tenderSuggestions, toSaveItems, unitPrice, type CartLine } from './cart'

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: 'k', productId: 'p1', variantId: 'v1', name: 'Cà phê sữa', variantName: 'Size L', basePrice: 32000,
  options: [{ id: 'o1', name: 'Trân châu', priceDelta: 5000 }], quantity: 2, note: '', ...over,
})

describe('computeTotals', () => {
  it('tính tạm tính gồm topping và số lượng', () => {
    expect(computeTotals([line()], 0, 0, 0).subtotal).toBe(74000)
  })
  it('giảm giá số tiền + phần trăm, khớp công thức database', () => {
    // 74.000: giảm 4.000 + 10% (7.400) = 11.400
    const t = computeTotals([line()], 4000, 10, 0)
    expect(t.discount).toBe(11400)
    expect(t.total).toBe(74000 - 11400)
  })
  it('giảm giá không vượt tạm tính, phụ thu cộng sau giảm', () => {
    const t = computeTotals([line()], 999999, 0, 5000)
    expect(t.discount).toBe(74000)
    expect(t.total).toBe(5000)
  })
  it('làm tròn phần trăm như PostgreSQL round()', () => {
    // 12.345 x 15% = 1.851,75 -> 1.852
    const t = computeTotals([line({ basePrice: 12345, options: [], quantity: 1 })], 0, 15, 0)
    expect(t.discount).toBe(1852)
  })
  it('giỏ trống bằng 0', () => {
    expect(computeTotals([], 0, 0, 0).total).toBe(0)
  })
})

describe('unitPrice / lineKey / toSaveItems', () => {
  it('dùng giá ghi đè nếu có', () => {
    expect(unitPrice(line({ priceOverride: 20000 }))).toBe(25000)
  })
  it('gộp dòng giống nhau, tách dòng khác topping hoặc ghi chú', () => {
    const a = lineKey({ productId: 'p', variantId: null, options: [{ id: 'a', name: '', priceDelta: 0 }, { id: 'b', name: '', priceDelta: 0 }], note: ' ít đá ' })
    const b = lineKey({ productId: 'p', variantId: null, options: [{ id: 'b', name: '', priceDelta: 0 }, { id: 'a', name: '', priceDelta: 0 }], note: 'ít đá' })
    const c = lineKey({ productId: 'p', variantId: null, options: [], note: 'ít đá' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('chỉ gửi giá ghi đè khi có quyền', () => {
    const l = line({ priceOverride: 1000 })
    expect(toSaveItems([l], false)[0]).not.toHaveProperty('price_override')
    expect(toSaveItems([l], true)[0]).toHaveProperty('price_override', 1000)
  })
})

describe('tenderSuggestions', () => {
  it('gợi ý đúng số tiền và mệnh giá làm tròn', () => {
    expect(tenderSuggestions(74000)).toEqual([74000, 80000, 100000, 200000, 500000])
    expect(tenderSuggestions(100000)).toEqual([100000, 200000, 500000])
  })
})
