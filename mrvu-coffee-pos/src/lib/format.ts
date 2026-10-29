export const TIME_ZONE = 'Asia/Ho_Chi_Minh'

const vndFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

/** 125000 -> "125.000 ₫" */
export function formatVND(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n)) return '0 ₫'
  return `${vndFormatter.format(Math.round(n))} ₫`
}

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
})
const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
})

export const formatDateTime = (d: string | Date) => dateTimeFormatter.format(new Date(d))
export const formatDate = (d: string | Date) => dateFormatter.format(new Date(d))
export const formatTime = (d: string | Date) => timeFormatter.format(new Date(d))

/** Chuyển chuỗi người dùng nhập ("125.000", "125,000 đ") thành số nguyên VND. */
export function parseVND(input: string): number {
  const digits = input.replace(/[^\d]/g, '')
  return digits === '' ? 0 : Number(digits)
}
