import { documentToHtml } from './layout'
import type { AdapterResult, ConnectionStatus, PrintAdapter, PrintDocument, PrinterStatus } from './types'

/** Dự phòng: mở hộp thoại in của trình duyệt (không im lặng, không biết kết quả). */
export class BrowserAdapter implements PrintAdapter {
  readonly id = 'browser' as const
  async getConnectionStatus(): Promise<ConnectionStatus> { return { connected: true, message: 'Dùng hộp thoại in của trình duyệt.' } }
  async listPrinters() { return ['Chọn trong hộp thoại in'] }
  async getPrinterStatus(name: string): Promise<PrinterStatus> { return { name, ready: null, message: 'Trình duyệt không báo tình trạng máy in.' } }
  async print(doc: PrintDocument): Promise<AdapterResult> {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(frame)
    try {
      frame.srcdoc = documentToHtml(doc)
      await new Promise<void>((res) => { frame.onload = () => res() })
      frame.contentWindow?.focus(); frame.contentWindow?.print()
    } finally { setTimeout(() => frame.remove(), 60_000) }
    return { status: 'submitted' }
  }
}
