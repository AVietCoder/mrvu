/**
 * Số gọi ngắn lấy từ phần đếm trong ngày của mã đơn (YYMMDD-0012 -> "#12").
 * Dễ đọc to tại quầy, tự đặt lại mỗi ngày; không dùng tên khách làm mã nhận đồ.
 */
export function callNo(code: string | null | undefined): string {
  const tail = String(code ?? '').split('-').pop() ?? ''
  const n = /^\d+$/.test(tail) ? parseInt(tail, 10) : NaN
  return Number.isFinite(n) ? `#${n}` : (code ?? '')
}
