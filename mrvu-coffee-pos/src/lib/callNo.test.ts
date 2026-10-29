import { describe, expect, it } from 'vitest'
import { callNo } from './callNo'

describe('callNo', () => {
  it('lấy số đếm trong ngày', () => {
    expect(callNo('261028-0012')).toBe('#12'); expect(callNo('261028-0001')).toBe('#1'); expect(callNo('261028-1234')).toBe('#1234')
  })
  it('mã lạ giữ nguyên, rỗng không lỗi', () => {
    expect(callNo('ABC')).toBe('ABC'); expect(callNo(null)).toBe(''); expect(callNo(undefined)).toBe('')
  })
})
