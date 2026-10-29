import { beforeEach, describe, expect, it, vi } from 'vitest'

// Supabase giả lập trong bộ nhớ, đủ cho PrintService.
const db = vi.hoisted(() => ({ jobs: [] as Record<string, unknown>[], receipts: new Map<string, unknown>(), orders: new Map<string, unknown>(), seq: 0 }))
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const filters: [string, unknown][] = []; let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Record<string, unknown> = {}; let single = false
    const rows = () => (table === 'receipts' ? [...db.receipts.values()] : table === 'orders' ? [...db.orders.values()] : db.jobs) as Record<string, unknown>[]
    const run = () => {
      let r = rows().filter((x) => filters.every(([k, v]) => x[k] === v))
      if (mode === 'insert') {
        if ((payload.kind === 'receipt' && db.jobs.some((j) => j.receipt_id === payload.receipt_id && j.kind === 'receipt'))
          || (payload.kind === 'kitchen' && db.jobs.some((j) => j.order_id === payload.order_id && j.kind === 'kitchen'))) return { data: null, error: { code: '23505', message: 'duplicate' } }
        const row = { id: `job${++db.seq}`, attempts: 0, error: null, reason: null, created_at: 'x', receipt_id: null, ...payload }; db.jobs.push(row); r = [row]
      }
      if (mode === 'update') { r.forEach((x) => Object.assign(x, payload)); return { data: null, error: null } }
      return { data: single ? r[0] ?? null : r, error: single && !r[0] ? { message: 'not found' } : null }
    }
    const b: Record<string, unknown> = {
      select: () => b, eq: (k: string, v: unknown) => { filters.push([k, v]); return b }, limit: () => b,
      single: () => { single = true; return Promise.resolve(run()) },
      insert: (p: Record<string, unknown>) => { mode = 'insert'; payload = p; return b },
      update: (p: Record<string, unknown>) => { mode = 'update'; payload = p; return b },
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    }
    return b
  }
  return { supabase: { from: builder } }
})

import { PrintService } from './printService'
import { SimulatorAdapter } from './simulatorAdapter'
import type { PrintSettings } from './types'

const settings: PrintSettings = { method: 'simulator', printer_name: 'P1', paper_width: 80, auto_print: true, allow_reprint: true, margin_mm: 2, font_size: 12, copies: 1, kitchen_enabled: false, kitchen_printer_name: '' }
const snapshot = { receipt_no: 'HD-1', order_code: '1', type: 'takeaway', table: null, cashier: 'A', customer: null, store: { name: 'Q', address: '', phone: '', footer_note: '' }, items: [], subtotal: 0, discount: 0, surcharge: 0, total: 0, payments: [] }

let sim: SimulatorAdapter; let svc: PrintService
beforeEach(() => {
  db.jobs.length = 0; db.receipts.clear(); db.orders.clear(); db.seq = 0
  db.orders.set('o1', { id: 'o1', code: '261028-0007', type: 'takeaway', created_at: '2026-10-28T08:00:00Z', note: '', tables: null, order_items: [{ name_snapshot: 'Cà phê sữa', variant_snapshot: 'M', quantity: 2, note: 'ít đá', order_item_modifiers: [{ name_snapshot: 'Trân châu' }] }] })
  db.receipts.set('r1', { id: 'r1', snapshot, issued_at: '2026-10-28T08:00:00Z' })
  sim = new SimulatorAdapter()
  svc = new PrintService('s1', 'u1', { simulator: sim, qz_tray: sim, browser: sim }, 50)
})

describe('PrintService', () => {
  it('in bill thành công và ghi trạng thái success', async () => {
    const j = await svc.printReceipt('r1', settings)
    expect(j.status).toBe('success'); expect(j.attempts).toBe(1); expect(sim.printed).toHaveLength(1)
  })
  it('gọi printReceipt nhiều lần / bấm đôi không in trùng', async () => {
    await Promise.all([svc.printReceipt('r1', settings), svc.printReceipt('r1', settings)])
    await svc.printReceipt('r1', settings)
    expect(sim.printed).toHaveLength(1); expect(db.jobs.filter((j) => j.kind === 'receipt')).toHaveLength(1)
  })
  it('lỗi máy in -> failed, giữ lại để thử lại; thử lại thành công không tạo job mới', async () => {
    sim.behavior = 'fail'
    const j = await svc.printReceipt('r1', settings)
    expect(j.status).toBe('failed'); expect(j.error).toContain('hết giấy')
    sim.behavior = 'ok'
    const r = await svc.retryPrint(j.id, settings)
    expect(r.status).toBe('success'); expect(r.attempts).toBe(2); expect(db.jobs).toHaveLength(1)
  })
  it('quá thời gian chờ -> unknown, không tự in lại; thử lại cần xác nhận', async () => {
    sim.behavior = 'hang'
    const j = await svc.printReceipt('r1', settings)
    expect(j.status).toBe('unknown')
    sim.behavior = 'ok'
    await expect(svc.retryPrint(j.id, settings)).rejects.toThrow(/Chưa rõ/)
    expect(sim.printed).toHaveLength(0)
    const r = await svc.retryPrint(j.id, settings, { confirmedNotPrinted: true })
    expect(r.status).toBe('success'); expect(sim.printed).toHaveLength(1)
  })
  it('không thử lại lệnh đã thành công', async () => {
    const j = await svc.printReceipt('r1', settings)
    await expect(svc.retryPrint(j.id, settings)).rejects.toThrow(/đã thành công/)
  })
  it('in lại cần lý do, tạo job reprint riêng và có BẢN SAO', async () => {
    await svc.printReceipt('r1', settings)
    await expect(svc.reprintReceipt('r1', ' ', settings)).rejects.toThrow(/lý do/)
    const j = await svc.reprintReceipt('r1', 'Khách làm mất bill', settings)
    expect(j.kind).toBe('reprint'); expect(j.reason).toBe('Khách làm mất bill')
    expect(sim.printed.at(-1)!.lines.join('\n')).toContain('BẢN SAO')
    expect(db.jobs).toHaveLength(2)
  })
  it('tắt in lại trong cài đặt thì chặn', async () => {
    await expect(svc.reprintReceipt('r1', 'lý do hợp lệ', { ...settings, allow_reprint: false })).rejects.toThrow(/tắt/)
  })
  it('in thử tạo job riêng', async () => {
    expect((await svc.testPrint(settings)).kind).toBe('test')
  })
  it('phiếu bếp: lấy dữ liệu từ đơn, mỗi đơn một phiếu, bấm đôi không in trùng', async () => {
    const [a, b] = await Promise.all([svc.printKitchenTicket('o1', settings), svc.printKitchenTicket('o1', settings)])
    await svc.printKitchenTicket('o1', settings)
    expect(a.kind).toBe('kitchen'); expect(a.status).toBe('success'); expect(b.id).toBeTruthy()
    expect(sim.printed).toHaveLength(1); expect(db.jobs.filter((j) => j.kind === 'kitchen')).toHaveLength(1)
    const t = sim.printed[0].lines.join('\n')
    expect(t).toContain('SỐ GỌI: #7'); expect(t).toContain('2 x Cà phê sữa (M)'); expect(t).toContain('Trân châu'); expect(t).toContain('ít đá')
  })
  it('phiếu bếp lỗi giữ lại và thử lại được từ chính lệnh đó', async () => {
    sim.behavior = 'fail'
    const j = await svc.printKitchenTicket('o1', settings)
    expect(j.status).toBe('failed')
    sim.behavior = 'ok'
    const r = await svc.retryPrint(j.id, settings)
    expect(r.status).toBe('success'); expect(db.jobs).toHaveLength(1); expect(sim.printed).toHaveLength(1)
  })
})
