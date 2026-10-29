import { describe, expect, it } from 'vitest'
import { formatDateTime, formatVND, parseVND } from './format'

describe('formatVND', () => {
  it('định dạng tiền Việt Nam', () => {
    expect(formatVND(125000)).toBe('125.000 ₫')
    expect(formatVND('1500000')).toBe('1.500.000 ₫')
    expect(formatVND(0)).toBe('0 ₫')
    expect(formatVND(null)).toBe('0 ₫')
  })
})

describe('parseVND', () => {
  it('đọc số tiền người dùng nhập', () => {
    expect(parseVND('125.000')).toBe(125000)
    expect(parseVND('125,000 đ')).toBe(125000)
    expect(parseVND('')).toBe(0)
  })
})

describe('formatDateTime', () => {
  it('dùng múi giờ Asia/Ho_Chi_Minh', () => {
    // 17:30 UTC = 00:30 hôm sau ở Việt Nam (UTC+7)
    expect(formatDateTime('2026-10-27T17:30:00Z')).toContain('28/10/2026')
    expect(formatDateTime('2026-10-27T17:30:00Z')).toContain('00:30')
  })
})
