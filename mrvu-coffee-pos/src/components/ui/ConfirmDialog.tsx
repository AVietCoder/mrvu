import { useState, type ReactNode } from 'react'
import Modal from './Modal'

interface Props {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  /** Hiện ô nhập lý do bắt buộc (hủy đơn, hoàn tiền...). */
  askReason?: boolean
  busy?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export default function ConfirmDialog(props: Props) {
  // Chỉ dựng nội dung khi mở để ô lý do luôn bắt đầu trống.
  return props.open ? <ConfirmBody {...props} /> : null
}

function ConfirmBody({ open, title, message, confirmLabel = 'Xác nhận', danger, askReason, busy, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const invalid = askReason && reason.trim().length < 3
  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm" locked={busy}
      footer={<>
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Quay lại</button>
        <button className={danger ? 'btn-primary' : 'btn bg-neutral-900 text-white hover:bg-neutral-800'} disabled={busy || invalid}
          onClick={() => onConfirm(reason.trim())}>{busy ? 'Đang xử lý…' : confirmLabel}</button>
      </>}>
      <div className="text-sm text-neutral-700">{message}</div>
      {askReason && (
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium" htmlFor="confirm-reason">Lý do (bắt buộc)</label>
          <input id="confirm-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
      )}
    </Modal>
  )
}
