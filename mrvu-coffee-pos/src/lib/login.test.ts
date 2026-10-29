import { describe, expect, it } from 'vitest'
import { displayUsername, toLoginEmail } from './login'

describe('tên đăng nhập', () => {
  it('đổi tên đăng nhập thành email nội bộ, không phân biệt hoa thường', () => {
    expect(toLoginEmail('  ThuNgan1 ')).toBe('thungan1@mrvu-cafe.local')
  })
  it('giữ nguyên email đầy đủ', () => {
    expect(toLoginEmail('Chu@Gmail.com')).toBe('chu@gmail.com')
  })
  it('hiển thị lại đúng tên đăng nhập', () => {
    expect(displayUsername('thungan1@mrvu-cafe.local')).toBe('thungan1')
    expect(displayUsername('chu@gmail.com')).toBe('chu@gmail.com')
    expect(displayUsername(null)).toBe('')
  })
})
