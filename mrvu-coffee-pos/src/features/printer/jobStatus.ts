import type { JobStatus } from '@/services/print/types'

export const JOB_LABEL: Record<JobStatus, string> = {
  queued: 'Đang chờ', processing: 'Đang in', submitted: 'Đã gửi tới máy in', success: 'In thành công',
  failed: 'In lỗi', retry_pending: 'Chờ thử lại', unknown: 'Không rõ kết quả',
}
export const JOB_CLASS: Record<JobStatus, string> = {
  queued: 'bg-neutral-100 text-neutral-700', processing: 'bg-blue-50 text-blue-700', submitted: 'bg-green-50 text-green-700',
  success: 'bg-green-50 text-green-700', failed: 'bg-brand-50 text-brand-700', retry_pending: 'bg-amber-50 text-amber-800', unknown: 'bg-amber-50 text-amber-800',
}
/** Lệnh kẹt ở "đang in" quá lâu (đóng tab giữa chừng) được coi là không rõ kết quả, không tự in lại. */
export function effectiveStatus(status: JobStatus, createdAt: string, now = Date.now()): JobStatus {
  return (status === 'processing' || status === 'queued') && now - new Date(createdAt).getTime() > 60_000 ? 'unknown' : status
}
/** Có thể in lại mà không cần hỏi (chắc chắn chưa in). */
export const canRetryDirectly = (s: JobStatus) => s === 'failed' || s === 'retry_pending'
/** Cần người dùng xác nhận vì có thể đã in. */
export const needsConfirmRetry = (s: JobStatus) => s === 'unknown' || s === 'submitted'
