import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'

export function Loading({ text = 'Đang tải…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-neutral-500">
      <Loader2 className="animate-spin" size={18} /> {text}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 p-8 text-center">
      <Inbox className="text-neutral-300" size={32} />
      <div className="font-semibold text-neutral-700">{title}</div>
      {hint && <div className="text-sm text-neutral-500">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center">
      <AlertTriangle className="text-brand-600" size={28} />
      <div className="font-semibold">Không tải được dữ liệu</div>
      <div className="text-sm text-neutral-500">{message ?? 'Vui lòng kiểm tra kết nối mạng và thử lại.'}</div>
      {onRetry && <button className="btn-secondary mt-1" onClick={onRetry}>Thử lại</button>}
    </div>
  )
}
