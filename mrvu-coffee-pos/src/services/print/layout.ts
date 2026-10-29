import { TIME_ZONE } from '@/lib/format'
import { callNo } from '@/lib/callNo'
import type { PrintDocument, PrintSettings, ReceiptSnapshot } from './types'

/** Số ký tự mỗi dòng với chữ đơn cách (monospace) theo khổ giấy. */
export const columnsFor = (width: 58 | 80) => (width === 58 ? 32 : 48)
/** Bề rộng in thực tế (mm): máy 58 mm in 384 chấm/dòng ≈ 48 mm, máy 80 mm ≈ 72 mm. Vượt mức này sẽ bị cắt chữ. */
export const printableMm = (width: 58 | 80) => (width === 58 ? 48 : 72)
/** Cỡ chữ (pt) để đủ số cột trong bề rộng in, tính theo font Courier New (rộng 0,6 em). Cỡ chữ cài đặt chỉ được thu nhỏ, không phóng to. */
export function fontPt(width: 58 | 80, fontSize: number) {
  const fit = (printableMm(width) / columnsFor(width)) * 2.8346 / 0.6
  return Math.floor(fit * Math.min(1, Math.max(0.6, fontSize / 12)) * 100) / 100 // làm tròn xuống để không vượt vùng in
}

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })
export const money = (n: number) => `${nf.format(Math.round(Number(n) || 0))}đ`

const dtf = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** Ngắt dòng theo từ; từ quá dài thì cắt cứng. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of String(text ?? '').split('\n')) {
    let line = ''
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while ([...word].length > width) {
        if (line) { out.push(line); line = '' }
        const chars = [...word]; out.push(chars.slice(0, width).join('')); word = chars.slice(width).join('')
      }
      if (!line) line = word
      else if ([...line].length + 1 + [...word].length <= width) line += ` ${word}`
      else { out.push(line); line = word }
    }
    if (line || out.length === 0) out.push(line)
  }
  return out
}

const len = (s: string) => [...s].length
export const center = (s: string, w: number) => ' '.repeat(Math.max(0, Math.floor((w - len(s)) / 2))) + s
/** Trái - phải trên cùng một dòng; nếu không đủ chỗ thì xuống dòng. */
export function lr(left: string, right: string, w: number): string[] {
  if (len(left) + len(right) + 1 <= w) return [left + ' '.repeat(w - len(left) - len(right)) + right]
  const wrapped = wrap(left, w)
  return [...wrapped, ' '.repeat(Math.max(0, w - len(right))) + right]
}

export interface ReceiptOptions { copyLabel?: boolean; reprintReason?: string; issuedAt: string }

export function buildReceiptDocument(s: ReceiptSnapshot, settings: Pick<PrintSettings, 'paper_width' | 'font_size' | 'margin_mm' | 'copies'>, o: ReceiptOptions): PrintDocument {
  const w = columnsFor(settings.paper_width)
  const rule = '-'.repeat(w)
  const L: string[] = []
  for (const l of wrap(s.store.name.toUpperCase(), w)) L.push(center(l, w))
  for (const l of wrap(s.store.address, w)) if (l) L.push(center(l, w))
  if (s.store.phone) L.push(center(`ĐT: ${s.store.phone}`, w))
  L.push(rule)
  L.push(center('HÓA ĐƠN THANH TOÁN', w))
  if (o.copyLabel) L.push(center('*** BẢN SAO ***', w))
  L.push(rule)
  L.push(center(`SỐ GỌI: ${callNo(s.order_code)}`, w))
  L.push(...lr('Số HĐ:', s.receipt_no, w))
  L.push(...lr('Thời gian:', dtf.format(new Date(o.issuedAt)), w))
  const where = s.type === 'dine_in' ? `Bàn ${s.table ?? ''}`.trim() : s.type === 'takeaway' ? 'Mang đi' : 'Giao hàng'
  L.push(...lr('Loại:', where, w))
  if (s.cashier) L.push(...lr('Thu ngân:', s.cashier, w))
  if (s.customer?.name) L.push(...lr('Khách:', s.customer.name, w))
  L.push(rule)
  for (const it of s.items) {
    const name = it.variant ? `${it.name} (${it.variant})` : it.name
    for (const l of wrap(name, w)) L.push(l)
    const modTotal = it.modifiers.reduce((a, m) => a + Number(m.price_delta), 0)
    L.push(...lr(`  ${it.quantity} x ${money(Number(it.unit_price) + modTotal)}`, money(it.line_total), w))
    for (const m of it.modifiers) for (const l of wrap(`+ ${m.name}`, w - 2)) L.push(`  ${l}`)
    if (it.note) for (const l of wrap(`* ${it.note}`, w - 2)) L.push(`  ${l}`)
  }
  L.push(rule)
  L.push(...lr('Tạm tính:', money(s.subtotal), w))
  if (Number(s.discount) > 0) L.push(...lr('Giảm giá:', `-${money(s.discount)}`, w))
  if (Number(s.surcharge) > 0) L.push(...lr('Phụ thu:', money(s.surcharge), w))
  L.push(...lr('TỔNG CỘNG:', money(s.total), w))
  L.push(rule)
  for (const p of s.payments) {
    const label = p.method_name ?? p.method_code ?? 'Thanh toán'
    L.push(...lr(label, money(p.amount), w))
    if (p.tendered != null && Number(p.change) > 0) {
      L.push(...lr('  Khách đưa:', money(p.tendered), w)); L.push(...lr('  Tiền thừa:', money(Number(p.change)), w))
    }
  }
  if (o.reprintReason) { L.push(rule); for (const l of wrap(`Lý do in lại: ${o.reprintReason}`, w)) L.push(l) }
  if (s.store.footer_note) { L.push(rule); for (const l of wrap(s.store.footer_note, w)) L.push(center(l, w)) }
  L.push('', '', '', '') // chừa giấy để xé tay (máy không có dao cắt)
  return { lines: L, widthMm: settings.paper_width, fontSize: settings.font_size, marginMm: settings.margin_mm, copies: settings.copies }
}

export interface KitchenOrder { code: string; type: ReceiptSnapshot['type']; table: string | null; createdAt: string; note?: string
  items: { name: string; variant: string | null; quantity: number; note: string; modifiers: string[] }[] }

export function buildKitchenDocument(k: KitchenOrder, settings: Pick<PrintSettings, 'paper_width' | 'font_size' | 'margin_mm'>): PrintDocument {
  const w = columnsFor(settings.paper_width)
  const rule = '-'.repeat(w)
  const L: string[] = [center('PHIẾU BẾP / PHA CHẾ', w), center(`SỐ GỌI: ${callNo(k.code)}`, w), rule]
  L.push(...lr(`Đơn ${k.code}`, k.type === 'dine_in' ? `Bàn ${k.table ?? ''}`.trim() : k.type === 'takeaway' ? 'Mang đi' : 'Giao hàng', w))
  L.push(dtf.format(new Date(k.createdAt)), rule)
  for (const it of k.items) {
    for (const l of wrap(`${it.quantity} x ${it.name}${it.variant ? ` (${it.variant})` : ''}`, w)) L.push(l)
    for (const m of it.modifiers) for (const l of wrap(`+ ${m}`, w - 2)) L.push(`  ${l}`)
    if (it.note) for (const l of wrap(`* ${it.note}`, w - 2)) L.push(`  ${l}`)
  }
  if (k.note) { L.push(rule); for (const l of wrap(`Ghi chú: ${k.note}`, w)) L.push(l) }
  L.push('', '')
  return { lines: L, widthMm: settings.paper_width, fontSize: settings.font_size, marginMm: settings.margin_mm, copies: 1 }
}

export function testDocument(settings: Pick<PrintSettings, 'paper_width' | 'font_size' | 'margin_mm'>, printerName: string): PrintDocument {
  const w = columnsFor(settings.paper_width)
  const rule = '-'.repeat(w)
  return { lines: [center('IN THỬ', w), rule, `Máy in: ${printerName || '(mặc định)'}`, `Khổ giấy: ${settings.paper_width}mm (${w} ký tự)`, 'Tiếng Việt: Ăn Ơ Ư Đ ă â ê ô ơ ư đ', 'Số: 1.234.567đ', rule, '1234567890123456789012345678901234567890123456789'.slice(0, w), '', ''],
    widthMm: settings.paper_width, fontSize: settings.font_size, marginMm: settings.margin_mm, copies: 1 }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** HTML dùng chung cho xem trước, QZ Tray (pixel/html) và in qua trình duyệt. */
export function documentToHtml(d: PrintDocument): string {
  // Lề được trừ trong bề rộng in thực tế, không cộng thêm, để không vượt vùng in của đầu in nhiệt.
  const w = printableMm(d.widthMm)
  return `<html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0;padding:0 0 0 ${Math.min(d.marginMm, (d.widthMm - w) / 2)}mm;width:${w}mm;font-family:'Courier New',Consolas,monospace;font-size:${fontPt(d.widthMm, d.fontSize)}pt;line-height:1.25;color:#000}pre{margin:0;white-space:pre;font:inherit}</style></head><body><pre>${esc(d.lines.join('\n'))}</pre></body></html>`
}
