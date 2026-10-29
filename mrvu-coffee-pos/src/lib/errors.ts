import type { PostgrestError } from '@supabase/supabase-js'

/** Mã lỗi xung đột nghiệp vụ do database trả về (hai người cùng sửa, thanh toán lần hai...). */
export const CONFLICT_CODE = 'MR409'

export class AppError extends Error {
  code?: string
  /** true nếu không nhận được phản hồi từ máy chủ (mất mạng, timeout): kết quả chưa rõ. */
  network: boolean
  constructor(message: string, opts: { code?: string; network?: boolean } = {}) {
    super(message)
    this.code = opts.code
    this.network = opts.network ?? false
  }
  get isConflict() { return this.code === CONFLICT_CODE }
}

/** Chuẩn hóa lỗi từ Supabase về thông báo tiếng Việt, tách riêng lỗi mạng. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const e = err as Partial<PostgrestError> & { message?: string; name?: string }
  const msg = e?.message ?? ''
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg) || e?.name === 'TypeError') {
    return new AppError('Mất kết nối tới máy chủ. Vui lòng kiểm tra mạng.', { network: true })
  }
  if (e?.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new AppError('Bạn không có quyền thực hiện thao tác này.', { code: e.code })
  }
  if (e?.code === '23505') return new AppError('Dữ liệu bị trùng (mã hoặc tên đã tồn tại).', { code: e.code })
  if (e?.code === '23503') return new AppError('Dữ liệu đang được sử dụng ở nơi khác nên không thể xóa.', { code: e.code })
  return new AppError(msg || 'Có lỗi xảy ra. Vui lòng thử lại.', { code: e?.code })
}
