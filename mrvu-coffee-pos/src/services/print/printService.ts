import { supabase } from '@/lib/supabase'
import { BrowserAdapter } from './browserAdapter'
import { buildKitchenDocument, buildReceiptDocument, testDocument, type KitchenOrder } from './layout'
import { QzTrayAdapter } from './qzAdapter'
import { SimulatorAdapter } from './simulatorAdapter'
import { PrintTimeoutError, type ConnectionStatus, type JobKind, type JobStatus, type PrintAdapter, type PrintDocument, type PrinterStatus, type PrintSettings, type ReceiptSnapshot } from './types'

export const PRINT_TIMEOUT_MS = 15_000

const JOB_COLS = 'id, receipt_id, order_id, kind, status, error, attempts, printer_name, reason, created_at'

export interface PrintJob { id: string; receipt_id: string | null; order_id: string | null; kind: JobKind; status: JobStatus; error: string | null; attempts: number; printer_name: string; reason: string | null; created_at: string }

/** Cách in có thể thay thế được (QZ Tray, giả lập, trình duyệt) phía sau một giao diện chung. */
export class PrintService {
  private inFlight = new Set<string>()
  constructor(private storeId: string, private userId: string, private adapters: Record<PrintSettings['method'], PrintAdapter>, private timeoutMs = PRINT_TIMEOUT_MS) {}

  adapterFor(s: Pick<PrintSettings, 'method'>) { return this.adapters[s.method] }
  getConnectionStatus(s: PrintSettings): Promise<ConnectionStatus> { return this.adapterFor(s).getConnectionStatus() }
  listPrinters(s: PrintSettings): Promise<string[]> { return this.adapterFor(s).listPrinters() }
  getPrinterStatus(s: PrintSettings): Promise<PrinterStatus> { return this.adapterFor(s).getPrinterStatus(s.printer_name) }

  async getPrintJobStatus(jobId: string): Promise<PrintJob> {
    const { data, error } = await supabase.from('receipt_print_jobs').select(JOB_COLS).eq('id', jobId).single()
    if (error) throw error
    return data as PrintJob
  }

  /** In bill ngay sau thanh toán. Mỗi hóa đơn chỉ có một lệnh in tự động: gọi lại sẽ KHÔNG in thêm. */
  async printReceipt(receiptId: string, s: PrintSettings): Promise<PrintJob> {
    const { snapshot, issued_at } = await this.loadReceipt(receiptId)
    const existing = await this.findJob(receiptId, 'receipt')
    if (existing) return existing
    const doc = buildReceiptDocument(snapshot, s, { issuedAt: issued_at })
    const job = await this.createJob({ receipt_id: receiptId, kind: 'receipt', printer_name: s.printer_name, copies: s.copies })
    if (!job) return (await this.findJob(receiptId, 'receipt'))! // thiết bị khác vừa tạo xong
    return this.run(job.id, doc, s, s.printer_name)
  }

  /** In lại: tạo lệnh mới kind 'reprint' có lý do, bill ghi "BẢN SAO". */
  async reprintReceipt(receiptId: string, reason: string, s: PrintSettings): Promise<PrintJob> {
    if (reason.trim().length < 3) throw new Error('Vui lòng nhập lý do in lại.')
    if (!s.allow_reprint) throw new Error('Cửa hàng đang tắt chức năng in lại.')
    const { snapshot, issued_at } = await this.loadReceipt(receiptId)
    const doc = buildReceiptDocument(snapshot, s, { issuedAt: issued_at, copyLabel: true, reprintReason: reason.trim() })
    const job = await this.createJob({ receipt_id: receiptId, kind: 'reprint', printer_name: s.printer_name, copies: s.copies, reason: reason.trim() })
    return this.run(job!.id, doc, s, s.printer_name)
  }

  /** Phiếu bếp/pha chế theo đơn. Mỗi đơn chỉ có một phiếu tự động: gọi lại không in thêm (muốn in lại dùng retryPrint). */
  async printKitchenTicket(orderId: string, s: PrintSettings): Promise<PrintJob> {
    const existing = await this.findKitchenJob(orderId)
    if (existing) return existing
    const printer = s.kitchen_printer_name || s.printer_name
    const k = await this.loadKitchenOrder(orderId)
    const job = await this.createJob({ order_id: orderId, kind: 'kitchen', printer_name: printer, copies: 1 })
    if (!job) return (await this.findKitchenJob(orderId))!
    return this.run(job.id, buildKitchenDocument(k, s), s, printer)
  }

  async testPrint(s: PrintSettings): Promise<PrintJob> {
    const job = await this.createJob({ kind: 'test', printer_name: s.printer_name, copies: 1 })
    return this.run(job!.id, testDocument(s, s.printer_name), s, s.printer_name)
  }

  /**
   * Thử lại lệnh in. Chỉ cho phép khi lệnh failed/retry_pending (chắc chắn chưa in).
   * Lệnh 'unknown'/'submitted' có thể ĐÃ in: cần người dùng xác nhận (confirmedNotPrinted) mới được in lại.
   */
  async retryPrint(jobId: string, s: PrintSettings, opts: { confirmedNotPrinted?: boolean } = {}): Promise<PrintJob> {
    const job = await this.getPrintJobStatus(jobId)
    if (job.status === 'success') throw new Error('Lệnh in này đã thành công, không cần in lại.')
    if (['processing', 'queued'].includes(job.status) && this.inFlight.has(jobId)) throw new Error('Lệnh in đang được xử lý.')
    if (['unknown', 'submitted'].includes(job.status) && !opts.confirmedNotPrinted) {
      throw new Error('Chưa rõ bill đã in hay chưa. Hãy kiểm tra máy in; nếu chưa thấy bill, xác nhận để in lại.')
    }
    if (!job.receipt_id && job.kind !== 'test' && !(job.kind === 'kitchen' && job.order_id)) throw new Error('Không thể in lại loại lệnh này.')
    let doc: PrintDocument
    if (job.kind === 'test') doc = testDocument(s, job.printer_name)
    else if (job.kind === 'kitchen') doc = buildKitchenDocument(await this.loadKitchenOrder(job.order_id!), s)
    else {
      const { snapshot, issued_at } = await this.loadReceipt(job.receipt_id!)
      doc = buildReceiptDocument(snapshot, s, { issuedAt: issued_at, copyLabel: job.kind === 'reprint', reprintReason: job.reason ?? undefined })
    }
    return this.run(jobId, doc, s, job.printer_name)
  }

  // ---- nội bộ ----
  private async loadReceipt(receiptId: string) {
    const { data, error } = await supabase.from('receipts').select('snapshot, issued_at').eq('id', receiptId).single()
    if (error) throw error
    return data as { snapshot: ReceiptSnapshot; issued_at: string }
  }

  private async loadKitchenOrder(orderId: string): Promise<KitchenOrder> {
    const { data, error } = await supabase.from('orders')
      .select('code, type, created_at, note, tables(name), order_items(name_snapshot, variant_snapshot, quantity, note, order_item_modifiers(name_snapshot))')
      .eq('id', orderId).single()
    if (error) throw error
    const o = data as unknown as { code: string; type: KitchenOrder['type']; created_at: string; note: string; tables: { name: string } | null
      order_items: { name_snapshot: string; variant_snapshot: string | null; quantity: number; note: string; order_item_modifiers: { name_snapshot: string }[] }[] }
    return { code: o.code, type: o.type, table: o.tables?.name ?? null, createdAt: o.created_at, note: o.note || undefined,
      items: o.order_items.map((i) => ({ name: i.name_snapshot, variant: i.variant_snapshot, quantity: i.quantity, note: i.note, modifiers: (i.order_item_modifiers ?? []).map((m) => m.name_snapshot) })) }
  }

  private async findKitchenJob(orderId: string): Promise<PrintJob | null> {
    const { data, error } = await supabase.from('receipt_print_jobs').select(JOB_COLS).eq('order_id', orderId).eq('kind', 'kitchen').limit(1)
    if (error) throw error
    return (data?.[0] as PrintJob | undefined) ?? null
  }

  private async findJob(receiptId: string, kind: JobKind): Promise<PrintJob | null> {
    const { data, error } = await supabase.from('receipt_print_jobs').select(JOB_COLS).eq('receipt_id', receiptId).eq('kind', kind).limit(1)
    if (error) throw error
    return (data?.[0] as PrintJob | undefined) ?? null
  }

  private async createJob(j: { receipt_id?: string; order_id?: string; kind: JobKind; printer_name: string; copies: number; reason?: string }): Promise<PrintJob | null> {
    const { data, error } = await supabase.from('receipt_print_jobs').insert({ store_id: this.storeId, requested_by: this.userId, status: 'queued', ...j })
      .select(JOB_COLS).single()
    if (error) { if (error.code === '23505') return null; throw error }
    return data as PrintJob
  }

  private async setStatus(id: string, status: JobStatus, error: string | null, attempts?: number) {
    const patch: Record<string, unknown> = { status, error }
    if (attempts != null) patch.attempts = attempts
    if (['success', 'submitted', 'failed', 'unknown'].includes(status)) patch.completed_at = new Date().toISOString()
    await supabase.from('receipt_print_jobs').update(patch).eq('id', id)
  }

  private async run(jobId: string, doc: PrintDocument, s: PrintSettings, printer: string): Promise<PrintJob> {
    if (this.inFlight.has(jobId)) return this.getPrintJobStatus(jobId) // chặn bấm đôi: không gửi lần hai
    this.inFlight.add(jobId)
    try {
      const before = await this.getPrintJobStatus(jobId)
      const attempts = before.attempts + 1
      await this.setStatus(jobId, 'processing', null, attempts)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const res = await Promise.race([
          this.adapterFor(s).print(doc, printer),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PrintTimeoutError()), this.timeoutMs) }),
        ])
        await this.setStatus(jobId, res.status, null)
      } catch (e) {
        if (e instanceof PrintTimeoutError) await this.setStatus(jobId, 'unknown', e.message) // có thể đã in: KHÔNG tự in lại
        else await this.setStatus(jobId, 'failed', e instanceof Error ? e.message : 'Lỗi không rõ')
      } finally { if (timer) clearTimeout(timer) }
      return await this.getPrintJobStatus(jobId)
    } finally { this.inFlight.delete(jobId) }
  }
}

export function createPrintService(storeId: string, userId: string, simulator = new SimulatorAdapter()) {
  return new PrintService(storeId, userId, { qz_tray: new QzTrayAdapter(), simulator, browser: new BrowserAdapter() })
}
