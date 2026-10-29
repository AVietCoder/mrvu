import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('escape dấu phẩy, ngoặc kép và xuống dòng', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf']])).toBe('"a,b","c""d","e\nf"')
  })
  it('giữ tiếng Việt và số', () => {
    expect(toCsv([['Cà phê sữa', 25000]])).toBe('Cà phê sữa,25000')
  })
  it('chặn CSV injection với ô bắt đầu bằng công thức', () => {
    expect(toCsv([['=SUM(A1)', '+1', '@x', '-1']])).toBe("'=SUM(A1),'+1,'@x,'-1")
  })
  it('số âm dạng number không bị thêm dấu nháy', () => {
    expect(toCsv([[-5]])).toBe('-5')
  })
})
