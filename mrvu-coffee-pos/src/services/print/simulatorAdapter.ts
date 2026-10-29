import type { AdapterResult, ConnectionStatus, PrintAdapter, PrintDocument, PrinterStatus } from './types'

export interface SimulatedPrint { at: string; printer: string; lines: string[] }

/** Máy in giả lập: không in thật, lưu bản in trong bộ nhớ để xem và kiểm thử. */
export class SimulatorAdapter implements PrintAdapter {
  readonly id = 'simulator' as const
  readonly printed: SimulatedPrint[] = []
  /** Dùng cho kiểm thử/thử nghiệm: mô phỏng lỗi hoặc không phản hồi. */
  behavior: 'ok' | 'fail' | 'hang' = 'ok'

  async getConnectionStatus(): Promise<ConnectionStatus> { return { connected: true, message: 'Máy in giả lập (không in ra giấy).' } }
  async listPrinters() { return ['Máy in giả lập'] }
  async getPrinterStatus(name: string): Promise<PrinterStatus> { return { name, ready: true, message: 'Sẵn sàng (giả lập)' } }
  async print(doc: PrintDocument, printerName: string): Promise<AdapterResult> {
    if (this.behavior === 'fail') throw new Error('Máy in giả lập báo lỗi (hết giấy).')
    if (this.behavior === 'hang') await new Promise(() => {})
    this.printed.push({ at: new Date().toISOString(), printer: printerName, lines: doc.lines })
    return { status: 'success' }
  }
}
