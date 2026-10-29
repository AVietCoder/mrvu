import { describe, expect, it } from 'vitest'
import { buildKitchenDocument, buildReceiptDocument, center, columnsFor, documentToHtml, fontPt, lr, money, printableMm, testDocument, wrap } from './layout'
import type { ReceiptSnapshot } from './types'

const snap: ReceiptSnapshot = {
  receipt_no: 'HD-261028-0001', order_code: '261028-0001', type: 'dine_in', table: 'A1', cashier: 'Nguyễn Văn Thu Ngân',
  customer: { name: 'Trần Thị Khách', phone: '0900000000' },
  store: { name: 'Mr.Vũ Coffee Chi nhánh Một', address: '12 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', phone: '0281234567', footer_note: 'Cảm ơn quý khách. Hẹn gặp lại!' },
  items: [
    { name: 'Cà phê sữa đá size lớn đặc biệt', variant: 'L', quantity: 2, unit_price: 29000, note: 'ít đá, nhiều sữa', line_total: 66000, modifiers: [{ name: 'Trân châu', price_delta: 4000 }] },
    { name: 'Trà đào', variant: null, quantity: 1, unit_price: 35000, note: '', line_total: 35000, modifiers: [] },
  ],
  subtotal: 101000, discount: 10000, surcharge: 0, total: 91000,
  payments: [{ method_code: 'cash', method_name: 'Tiền mặt', amount: 91000, tendered: 100000, change: 9000 }],
}
const s = (w: 58 | 80) => ({ paper_width: w, font_size: 12, margin_mm: 2, copies: 1 })
const o = { issuedAt: '2026-10-28T08:30:00Z' }

describe('bố cục bill', () => {
  it.each([58, 80] as const)('không dòng nào vượt số cột (khổ %i mm)', (w) => {
    const d = buildReceiptDocument(snap, s(w), o)
    for (const l of d.lines) expect([...l].length).toBeLessThanOrEqual(columnsFor(w))
  })
  it('có đủ thông tin chính và giờ theo Asia/Ho_Chi_Minh', () => {
    const t = buildReceiptDocument(snap, s(80), o).lines.join('\n')
    expect(t).toContain('HD-261028-0001'); expect(t).toContain('15:30'); expect(t).toContain('TỔNG CỘNG:')
    expect(t).toContain('91.000đ'); expect(t).toContain('Tiền thừa:'); expect(t).toContain('Trân châu'); expect(t).toContain('Bàn A1')
    expect(t).not.toContain('BẢN SAO')
  })
  it('bản in lại có BẢN SAO và lý do', () => {
    const t = buildReceiptDocument(snap, s(58), { ...o, copyLabel: true, reprintReason: 'Khách yêu cầu' }).lines.join('\n')
    expect(t).toContain('BẢN SAO'); expect(t).toContain('Khách yêu cầu')
  })
  it('có số gọi ngắn', () => {
    expect(buildReceiptDocument(snap, s(58), o).lines.join('\n')).toContain('SỐ GỌI: #1')
  })
  it('đơn giá dòng gồm cả topping, thành tiền khớp', () => {
    const t = buildReceiptDocument(snap, s(80), o).lines.join('\n')
    expect(t).toMatch(/2 x 33\.000đ\s+66\.000đ/)
  })
  it('chỉ in giảm giá khi có', () => {
    const t = buildReceiptDocument({ ...snap, discount: 0 }, s(80), o).lines.join('\n')
    expect(t).not.toContain('Giảm giá')
  })
  it('phiếu bếp không có giá tiền', () => {
    const d = buildKitchenDocument({ code: '1', type: 'takeaway', table: null, createdAt: o.issuedAt, items: [{ name: 'Cà phê', variant: null, quantity: 2, note: 'ít đá', modifiers: ['Shot thêm'] }] }, s(58))
    const t = d.lines.join('\n'); expect(t).toContain('2 x Cà phê'); expect(t).not.toMatch(/\dđ/)
  })
  it('wrap ngắt theo từ và cắt từ quá dài', () => {
    expect(wrap('một hai ba bốn năm', 10)).toEqual(['một hai ba', 'bốn năm'])
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('lr xuống dòng khi không đủ chỗ; center canh giữa', () => {
    expect(lr('a', 'b', 10)[0]).toHaveLength(10)
    expect(lr('rất dài rất dài rất dài', '99.000đ', 12).length).toBeGreaterThan(1)
    expect(center('ab', 6)).toBe('  ab')
  })
  it('khổ 58 mm: 32 cột vừa trong bề rộng in 48 mm, html không vượt vùng in', () => {
    expect(columnsFor(58)).toBe(32); expect(printableMm(58)).toBe(48)
    // 32 ký tự * (0,6 em * cỡ chữ) phải <= 48 mm
    const mm = 32 * 0.6 * fontPt(58, 12) / 2.8346
    expect(mm).toBeLessThanOrEqual(48.01)
    expect(fontPt(58, 24)).toBe(fontPt(58, 12)) // cỡ chữ lớn không được phóng to quá vùng in
    expect(fontPt(58, 8)).toBeLessThan(fontPt(58, 12))
    const html = documentToHtml(buildReceiptDocument(snap, s(58), o))
    expect(html).toContain('width:48mm'); expect(html).toContain("'Courier New'")
  })
  it('chừa giấy xé cuối bill', () => {
    const d = buildReceiptDocument(snap, s(58), o)
    expect(d.lines.slice(-4).every((l) => l === '')).toBe(true)
  })
  it('money và html thoát ký tự', () => {
    expect(money(1234567)).toBe('1.234.567đ')
    const html = documentToHtml({ lines: ['<b>&'], widthMm: 80, fontSize: 12, marginMm: 2, copies: 1 })
    expect(html).toContain('&lt;b&gt;&amp;'); expect(html).not.toContain('<b>&')
    expect(testDocument(s(58), '').lines.join('')).toContain('IN THỬ')
  })
})
