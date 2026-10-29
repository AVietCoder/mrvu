import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { OrderType } from '@/lib/types'
import { lineKey, type CartLine, type CartOption } from './cart'

export interface PosCustomer { id: string; name: string; phone: string | null }

interface PosState {
  orderId: string | null
  code: string | null
  version: number | null
  /** Trạng thái đơn trên server (draft/open/pending_payment) khi đã lưu. */
  serverStatus: string | null
  type: OrderType
  tableId: string | null
  tableName: string | null
  customer: PosCustomer | null
  note: string
  discountAmount: number
  discountPercent: number
  surcharge: number
  lines: CartLine[]
  /** Có thay đổi chưa lưu lên server. */
  dirty: boolean

  addLine: (p: Omit<CartLine, 'key'>) => void
  setQty: (key: string, qty: number) => void
  setLineNote: (key: string, note: string) => void
  removeLine: (key: string) => void
  setType: (t: OrderType) => void
  setTable: (id: string | null, name: string | null) => void
  setCustomer: (c: PosCustomer | null) => void
  setNote: (n: string) => void
  setDiscount: (amount: number, percent: number) => void
  setSurcharge: (n: number) => void
  /** Sau khi lưu thành công, đồng bộ mã/phiên bản từ server. */
  markSaved: (s: { id: string; code: string; version: number; status: string }) => void
  load: (o: Partial<PosState> & { orderId: string }) => void
  reset: () => void
}

const initial = {
  orderId: null, code: null, version: null, serverStatus: null, type: 'takeaway' as OrderType, tableId: null, tableName: null,
  customer: null, note: '', discountAmount: 0, discountPercent: 0, surcharge: 0, lines: [] as CartLine[], dirty: false,
}

export const usePosStore = create<PosState>()(
  persist(
    (set) => ({
      ...initial,
      addLine: (p) => set((s) => {
        const key = lineKey(p)
        const existing = s.lines.find((l) => l.key === key)
        const lines = existing
          ? s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, l.quantity + p.quantity) } : l))
          : [...s.lines, { ...p, key }]
        return { lines, dirty: true }
      }),
      setQty: (key, qty) => set((s) => ({
        lines: qty <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, qty) } : l)),
        dirty: true,
      })),
      setLineNote: (key, note) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, note } : l)), dirty: true })),
      removeLine: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key), dirty: true })),
      setType: (type) => set((s) => ({ type, tableId: type === 'dine_in' ? s.tableId : null, tableName: type === 'dine_in' ? s.tableName : null, dirty: true })),
      setTable: (tableId, tableName) => set({ tableId, tableName, type: tableId ? 'dine_in' : 'takeaway', dirty: true }),
      setCustomer: (customer) => set({ customer, dirty: true }),
      setNote: (note) => set({ note, dirty: true }),
      setDiscount: (discountAmount, discountPercent) => set({ discountAmount, discountPercent, dirty: true }),
      setSurcharge: (surcharge) => set({ surcharge, dirty: true }),
      markSaved: ({ id, code, version, status }) => set({ orderId: id, code, version, serverStatus: status, dirty: false }),
      load: (o) => set({ ...initial, ...o, dirty: false }),
      reset: () => set({ ...initial }),
    }),
    {
      // Chỉ là lớp an toàn: giữ giỏ chưa lưu khi tải lại trang. Dữ liệu chính nằm trong database.
      name: 'mrvu-pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
    },
  ),
)

export type { CartOption }
