import { describe, expect, it } from 'vitest'
import { fmtQty, parseQty, stockLevel } from './stock'

describe('stock', () => {
  it('stockLevel', () => {
    expect(stockLevel(0, 10)).toBe('out'); expect(stockLevel(-5, 0)).toBe('out')
    expect(stockLevel(10, 10)).toBe('low'); expect(stockLevel(11, 10)).toBe('ok'); expect(stockLevel(1, 0)).toBe('ok')
  })
  it('parseQty hiểu cách viết Việt Nam và quốc tế', () => {
    expect(parseQty('1500')).toBe(1500); expect(parseQty('1.500')).toBe(1500); expect(parseQty('1.500,5')).toBe(1500.5)
    expect(parseQty('2,5')).toBe(2.5); expect(parseQty('2.5')).toBe(2.5); expect(parseQty('1.234.567')).toBe(1234567)
    expect(parseQty('')).toBeNaN(); expect(parseQty('abc')).toBeNaN()
  })
  it('fmtQty', () => { expect(fmtQty(1500.5)).toBe('1.500,5'); expect(fmtQty(null)).toBe('0') })
})
