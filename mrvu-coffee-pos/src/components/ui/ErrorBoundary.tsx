import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Bắt lỗi hiển thị để một trang hỏng không làm trắng cả ứng dụng. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error', error, info.componentStack) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold">Có lỗi khi hiển thị trang này</h1>
        <p className="mt-2 text-sm text-neutral-600">Dữ liệu của bạn không bị ảnh hưởng. Hãy tải lại trang; nếu lỗi lặp lại, báo cho người quản trị.</p>
        <button className="btn-primary mt-4" onClick={() => window.location.reload()}>Tải lại trang</button>
      </div>
    )
  }
}
