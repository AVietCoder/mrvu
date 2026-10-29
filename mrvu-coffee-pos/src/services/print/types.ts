export interface ReceiptSnapshot {
  receipt_no: string
  order_code: string
  type: 'dine_in' | 'takeaway' | 'delivery'
  table: string | null
  cashier: string | null
  customer: { name: string; phone: string | null } | null
  store: { name: string; address: string; phone: string; footer_note: string }
  items: { name: string; variant: string | null; quantity: number; unit_price: number; note: string; line_total: number; modifiers: { name: string; price_delta: number }[] }[]
  subtotal: number; discount: number; surcharge: number; total: number
  payments: { method_code?: string; method_name?: string; amount: number; tendered?: number | null; change?: number; reference?: string | null }[]
}

export interface PrintSettings {
  method: 'qz_tray' | 'simulator' | 'browser'
  printer_name: string
  paper_width: 58 | 80
  auto_print: boolean
  allow_reprint: boolean
  margin_mm: number
  font_size: number
  copies: number
  kitchen_enabled: boolean
  kitchen_printer_name: string
}

export type JobStatus = 'queued' | 'processing' | 'submitted' | 'success' | 'failed' | 'retry_pending' | 'unknown'
export type JobKind = 'receipt' | 'reprint' | 'kitchen' | 'test'

/** Nội dung đã dàn trang, độc lập với cách in. */
export interface PrintDocument { lines: string[]; widthMm: 58 | 80; fontSize: number; marginMm: number; copies: number }

export interface AdapterResult {
  /** 'success': thiết bị xác nhận; 'submitted': đã gửi, chưa có xác nhận từ máy in. */
  status: 'success' | 'submitted'
}

export interface ConnectionStatus { connected: boolean; message: string }
export interface PrinterStatus { name: string; ready: boolean | null; message: string }

export interface PrintAdapter {
  readonly id: PrintSettings['method']
  getConnectionStatus(): Promise<ConnectionStatus>
  listPrinters(): Promise<string[]>
  getPrinterStatus(name: string): Promise<PrinterStatus>
  /** Gửi tài liệu tới máy in. Ném lỗi nếu không gửi được. */
  print(doc: PrintDocument, printerName: string): Promise<AdapterResult>
}

export class PrintTimeoutError extends Error {
  constructor() { super('Hết thời gian chờ phản hồi từ máy in. Chưa rõ bill đã in hay chưa.') }
}
