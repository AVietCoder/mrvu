export type StockLevel = 'out' | 'low' | 'ok'

/** Hết hàng (<= 0), sắp hết (<= mức tối thiểu đã đặt), còn đủ. */
export function stockLevel(current: number, min: number): StockLevel {
  if (current <= 0) return 'out'
  if (min > 0 && current <= min) return 'low'
  return 'ok'
}

const qtyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })
export const fmtQty = (n: number | string | null | undefined) => qtyFmt.format(Number(n ?? 0))

/** Nhập số lượng kiểu Việt Nam ("1.500,5" hoặc "1500.5"). Trả NaN nếu không hợp lệ. */
export function parseQty(input: string): number {
  const t = input.trim().replace(/\s/g, '')
  if (t === '') return NaN
  let norm = t
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) norm = t.replace(/\./g, '')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '')
  const n = Number(norm)
  return Number.isFinite(n) ? n : NaN
}

export const MOVEMENT_LABEL: Record<string, string> = {
  opening: 'Tồn đầu', purchase: 'Nhập hàng', sale: 'Bán hàng', sale_reversal: 'Hoàn kho (hoàn tiền/hủy)', waste: 'Hao hụt', adjustment: 'Điều chỉnh / kiểm kho',
}
