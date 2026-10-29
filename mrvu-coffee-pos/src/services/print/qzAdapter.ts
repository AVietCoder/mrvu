import qz from 'qz-tray'
import { documentToHtml } from './layout'
import type { AdapterResult, ConnectionStatus, PrintAdapter, PrintDocument, PrinterStatus } from './types'

/**
 * Cầu nối QZ Tray (https://qz.io). Cần cài QZ Tray trên máy thu ngân.
 * Chưa kiểm chứng trên máy in thật. Xem docs/MAY_IN.md để cấu hình chứng chỉ (in im lặng).
 */
export class QzTrayAdapter implements PrintAdapter {
  readonly id = 'qz_tray' as const

  private async ensure() {
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 })
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    try { await this.ensure(); return { connected: true, message: 'Đã kết nối QZ Tray.' } }
    catch { return { connected: false, message: 'Không kết nối được QZ Tray. Hãy mở QZ Tray trên máy này và cho phép trang web.' } }
  }

  async listPrinters(): Promise<string[]> {
    await this.ensure()
    const r = await qz.printers.find()
    return Array.isArray(r) ? r : [r]
  }

  async getPrinterStatus(name: string): Promise<PrinterStatus> {
    try {
      const all = await this.listPrinters()
      return all.includes(name)
        ? { name, ready: null, message: 'Máy in có trong Windows. QZ Tray không báo được tình trạng giấy/nắp.' }
        : { name, ready: false, message: 'Không tìm thấy máy in này trong Windows.' }
    } catch (e) { return { name, ready: false, message: e instanceof Error ? e.message : 'Lỗi không rõ' } }
  }

  async print(doc: PrintDocument, printerName: string): Promise<AdapterResult> {
    await this.ensure()
    const printer = printerName || (await qz.printers.getDefault())
    const config = qz.configs.create(printer, {
      copies: doc.copies, units: 'mm', size: { width: doc.widthMm }, margins: 0, scaleContent: false, rasterize: true,
    })
    await qz.print(config, [{ type: 'pixel', format: 'html', flavor: 'plain', data: documentToHtml(doc) }])
    // QZ Tray chỉ xác nhận đã chuyển lệnh cho hàng đợi Windows, không xác nhận giấy đã ra.
    return { status: 'submitted' }
  }
}
