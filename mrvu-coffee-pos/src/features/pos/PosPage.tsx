import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Banknote, ClipboardList, ImageOff, Landmark, Save, Search, ShoppingCart, SlidersHorizontal, WifiOff, XCircle } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { ErrorState, Loading } from '@/components/ui/States'
import type { Product } from '@/lib/types'
import { useMenu } from '@/features/menu/useMenu'
import { useMyOpenShift } from '@/features/shifts/useShift'
import { usePrint } from '@/services/print/PrintProvider'
import { computeTotals, defaultOrderStatus } from './cart'
import { fetchOrder, linesFromOrder, saveOrder, useActiveOrders, usePaymentMethods, useTables } from './api'
import { usePosStore } from './usePosStore'
import CartPanel from './CartPanel'
import CustomerDialog from './CustomerDialog'
import ItemDialog from './ItemDialog'
import OrdersDrawer from './OrdersDrawer'
import PaidBanner from './PaidBanner'
import PaymentModal, { type PaidInfo } from './PaymentModal'
import { hasChoices, quickLine } from './quickAdd'
import SplitDialog from './SplitDialog'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase()

export default function PosPage() {
  const { membership, can, session } = useAuth()
  const store = membership!.store!
  const storeId = store.id
  const menu = useMenu(storeId)
  const tables = useTables(storeId)
  const methods = usePaymentMethods(storeId)
  const active = useActiveOrders(storeId)
  const qc = useQueryClient()
  const toast = useToast()
  const pos = usePosStore()
  const [params, setParams] = useSearchParams()

  const [cat, setCat] = useState('all')
  const [search, setSearch] = useState('')
  const [configProduct, setConfigProduct] = useState<Product | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [ordersTable, setOrdersTable] = useState<string | null>(null)
  const [payMode, setPayMode] = useState<{ order: { id: string; code: string; total: number }; quick: boolean; method?: 'cash' | 'transfer'; type: string } | null>(null)
  const [paid, setPaid] = useState<{ info: PaidInfo; kitchenAuto: boolean } | null>(null)
  const { settings: printSettings } = usePrint()
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [pendingLoad, setPendingLoad] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [splitOpen, setSplitOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const myShift = useMyOpenShift(storeId, session?.user.id)
  const noShift = can('shift.manage') && myShift.data === null
  const searchRef = useRef<HTMLInputElement>(null)

  const canOverridePrice = can('price.edit')
  const canPay = can('order.pay')

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const catalog = useMemo(() => new Map((menu.data?.products ?? []).map((p) => [p.id, { price: p.price, variants: new Map(p.product_variants.map((v) => [v.id, v.price])) }])), [menu.data])

  const refreshLists = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['active-orders'] }); qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['orders'] })
  }, [qc])

  /** Tải một đơn từ database vào màn hình bán hàng. */
  const loadOrder = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const o = await fetchOrder(id)
      if (!['draft', 'open', 'pending_payment'].includes(o.status)) {
        toast.error('Đơn này đã hoàn tất nên không thể sửa. Xem ở trang Đơn hàng.')
        return
      }
      pos.load({
        orderId: o.id, code: o.code, version: o.version, serverStatus: o.status, type: o.type, tableId: o.table_id,
        tableName: o.tables?.name ?? null, customer: o.customers, note: o.note, discountAmount: o.discount_amount,
        discountPercent: o.discount_percent, surcharge: o.surcharge, lines: linesFromOrder(o, catalog),
      })
      setConflict(false); setSelected(new Set())
    } catch (e) { toast.error(toAppError(e).message) } finally { setBusy(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, toast])

  const requestLoad = useCallback((id: string) => {
    setOrdersOpen(false)
    if (pos.dirty && pos.lines.length > 0) setPendingLoad(id)
    else loadOrder(id)
  }, [pos.dirty, pos.lines.length, loadOrder])

  // Xử lý liên kết từ sơ đồ bàn / danh sách đơn: /pos?order=ID hoặc /pos?table=ID
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current || !menu.data || !tables.data) return
    const orderId = params.get('order'); const tableId = params.get('table')
    if (!orderId && !tableId) return
    handled.current = true
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải đơn từ liên kết, chạy đúng một lần
    if (orderId) { loadOrder(orderId); return }
    const table = tables.data.find((t) => t.id === tableId)
    if (!table) return
    ;(async () => {
      const { data } = await supabase.from('orders').select('id').eq('table_id', table.id).in('status', ['draft', 'open', 'pending_payment']).order('created_at')
      if (data && data.length === 1) await loadOrder(data[0].id)
      else if (data && data.length > 1) { setOrdersTable(table.id); setOrdersOpen(true) }
      else { pos.reset(); pos.setTable(table.id, table.name) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, menu.data, tables.data])

  const products = useMemo(() => {
    const s = fold(search.trim())
    return (menu.data?.products ?? []).filter((p) => (cat === 'all' || p.category_id === cat) && (!s || fold(p.name).includes(s) || fold(p.code).includes(s)))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active))
  }, [menu.data, cat, search])

  /** Một chạm: thêm ngay (size mặc định, không tùy chọn). Chỉ mở hộp chọn khi món có nhóm bắt buộc chọn. */
  function chooseProduct(p: Product) {
    if (!p.is_active) return
    const line = quickLine(p, menu.data?.modifiers ?? [])
    if (line) pos.addLine(line)
    else setConfigProduct(p)
  }

  /** Lưu đơn lên server; trả về thông tin mới nhất hoặc null nếu lỗi (đã báo cho người dùng). */
  async function persist(status: 'draft' | 'open' | 'pending_payment') {
    const s = usePosStore.getState()
    if (s.type === 'dine_in' && !s.tableId) { toast.error('Vui lòng chọn bàn cho đơn tại bàn.'); return null }
    try {
      const r = await saveOrder(storeId, s, canOverridePrice, status)
      pos.markSaved({ id: r.id, code: r.code, version: r.version, status: r.status })
      refreshLists()
      return r
    } catch (e) {
      const err = toAppError(e)
      if (err.isConflict) setConflict(true)
      toast.error(err.network ? 'Mất kết nối. Đơn chưa được lưu, giỏ hàng vẫn được giữ lại.' : err.message)
      return null
    }
  }

  const currentStatus = () => {
    const s = usePosStore.getState()
    return (s.serverStatus as 'draft' | 'open' | 'pending_payment' | null) ?? defaultOrderStatus(s.type)
  }

  async function saveTemp() {
    if (busy || pos.lines.length === 0) return
    setBusy(true)
    const r = await persist(pos.serverStatus === 'pending_payment' ? 'pending_payment' : defaultOrderStatus(pos.type))
    setBusy(false)
    if (r) { toast.success(`Đã lưu đơn ${r.code}.`); pos.reset(); setCartOpen(false) }
  }

  async function markPending() {
    if (busy || pos.lines.length === 0) return
    setBusy(true)
    const r = await persist('pending_payment')
    setBusy(false)
    if (r) { toast.success(`Đơn ${r.code} đang chờ thanh toán.`); pos.reset(); setCartOpen(false) }
  }

  /** Mở thanh toán. quick = tiền mặt đủ tiền, gửi ngay không qua bước nhập. */
  async function startPayment(opt: { quick?: boolean; method?: 'cash' | 'transfer' } = {}) {
    if (busy || payMode || pos.lines.length === 0) return
    if (!canPay) return toast.error('Bạn không có quyền thanh toán.')
    if (!methods.data?.length) return toast.error('Chưa cấu hình phương thức thanh toán.')
    setBusy(true)
    let r: { id: string; code: string; total: number } | null = null
    const s = usePosStore.getState()
    if (s.orderId && !s.dirty) {
      // Đã lưu và không đổi: lấy tổng chính thức từ server để không phụ thuộc số trên màn hình.
      try { const o = await fetchOrder(s.orderId); r = { id: o.id, code: o.code, total: o.total }; pos.markSaved({ id: o.id, code: o.code, version: o.version, status: o.status }) }
      catch (e) { toast.error(toAppError(e).message) }
    } else {
      const saved = await persist(currentStatus())
      if (saved) r = { id: saved.id, code: saved.code, total: Number(saved.total) }
    }
    setBusy(false)
    if (r) {
      const local = computeTotals(usePosStore.getState().lines, pos.discountAmount, pos.discountPercent, pos.surcharge).total
      if (local !== r.total) toast.error(`Tổng tiền theo máy chủ là ${formatVND(r.total)} (khác số hiển thị). Vui lòng kiểm tra lại đơn.`)
      setPayMode({ order: r, quick: !!opt.quick, method: opt.method, type: usePosStore.getState().type })
    }
  }

  async function cancelOrder(reason: string) {
    if (!pos.orderId) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_cancel_order', { p_order_id: pos.orderId, p_reason: reason })
    setBusy(false)
    if (error) return toast.error(toAppError(error).message)
    toast.success('Đã hủy đơn.'); setCancelOpen(false); pos.reset(); refreshLists()
  }

  async function split(target: { toOrderId: string | null; newTable: string | null }) {
    const ids = pos.lines.filter((l) => selected.has(l.key) && l.serverId).map((l) => l.serverId!)
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_move_items', { p_from: pos.orderId, p_item_ids: ids, p_to: target.toOrderId, p_new_table: target.newTable })
    if (error) { setBusy(false); return toast.error(toAppError(error).message) }
    toast.success(`Đã chuyển ${ids.length} món sang đơn ${(data as { target_code: string }).target_code}.`)
    setSplitOpen(false)
    await loadOrder(pos.orderId!)
    refreshLists()
    setBusy(false)
  }

  // Phím tắt: F2 tìm món, F3 tiền mặt đủ (thu nhanh), F4 thanh toán, F6 chuyển khoản, F8 lưu tạm, F9 đơn đang mở
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === 'F3') { e.preventDefault(); void startPayment({ quick: true, method: 'cash' }) }
      else if (e.key === 'F4') { e.preventDefault(); void startPayment() }
      else if (e.key === 'F6') { e.preventDefault(); void startPayment({ method: 'transfer' }) }
      else if (e.key === 'F8') { e.preventDefault(); saveTemp() }
      else if (e.key === 'F9') { e.preventDefault(); setOrdersTable(null); setOrdersOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (menu.isLoading || tables.isLoading || methods.isLoading) return <Loading text="Đang tải thực đơn…" />
  if (menu.isError || tables.isError || methods.isError) return <ErrorState onRetry={() => { menu.refetch(); tables.refetch(); methods.refetch() }} />

  const totals = computeTotals(pos.lines, pos.discountAmount, pos.discountPercent, pos.surcharge)
  const count = pos.lines.reduce((s, l) => s + l.quantity, 0)
  const openCount = active.data?.length ?? 0
  const editLocked = busy

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] lg:-m-6 lg:h-[calc(100%+3rem)]">
      <section className="flex min-w-0 flex-1 flex-col">
        {noShift && (
          <div role="status" className="flex flex-wrap items-center gap-2 bg-blue-50 px-4 py-2 text-sm text-blue-900">
            Bạn chưa mở ca nên đơn thanh toán sẽ không được tính vào két. <Link className="font-semibold underline" to="/nhan-vien">Mở ca</Link>
          </div>
        )}
        {!online && (
          <div role="alert" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
            <WifiOff size={16} /> Mất kết nối Internet. Giỏ hàng được giữ trên máy nhưng chưa lưu và chưa thanh toán được cho tới khi có mạng.
          </div>
        )}
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center gap-2 bg-brand-100 px-4 py-2 text-sm font-medium text-brand-800">
            Đơn này đã được người khác cập nhật. Thay đổi của bạn chưa được lưu.
            <button className="btn-secondary !min-h-[36px]" onClick={() => pos.orderId && loadOrder(pos.orderId)}>Tải lại đơn (bỏ thay đổi của tôi)</button>
          </div>
        )}
        {paid && <PaidBanner key={paid.info.orderId} info={paid.info} kitchenAuto={paid.kitchenAuto} onClose={() => setPaid(null)} />}
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} />
            <input ref={searchRef} className="input !pl-9" placeholder="Tìm món theo tên hoặc mã (F2)" value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && products.length >= 1) { chooseProduct(products[0]); setSearch('') } }} />
          </div>
          <button className="btn-secondary" onClick={() => { setOrdersTable(null); setOrdersOpen(true) }}>
            <ClipboardList size={16} /> Đơn đang mở{openCount > 0 && <span className="rounded-full bg-brand-600 px-2 text-xs text-white">{openCount}</span>}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-neutral-200 bg-white px-3 py-2" role="tablist" aria-label="Danh mục">
          {[{ id: 'all', name: 'Tất cả' }, ...(menu.data?.categories.filter((c) => c.is_active) ?? [])].map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}
              className={clsx('min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold', cat === c.id ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200')}>{c.name}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 lg:pb-3">
          {products.length === 0 ? (
            <div className="p-10 text-center text-sm text-neutral-500">{menu.data?.products.length ? 'Không có món nào khớp.' : 'Chưa có món nào. Vào mục Thực đơn để thêm món đầu tiên.'}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => {
                const variants = p.product_variants.filter((v) => v.is_active)
                const price = variants.length ? Math.min(...variants.map((v) => v.price)) : p.price
                return (
                  <div key={p.id} className={clsx('card relative flex flex-col overflow-hidden text-left transition', p.is_active ? 'hover:border-brand-400' : 'opacity-50')}>
                    <button disabled={!p.is_active || editLocked} onClick={() => chooseProduct(p)} aria-label={`Thêm ${p.name}`}
                      className="flex flex-1 flex-col text-left active:scale-[0.98]">
                      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-16 w-full object-cover" />
                        : <div className="flex h-16 w-full items-center justify-center bg-neutral-100 text-neutral-300"><ImageOff size={20} /></div>}
                      <div className="p-2">
                        <div className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight">{p.name}</div>
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="font-bold text-brand-700">{formatVND(quickLine(p, menu.data?.modifiers ?? [])?.basePrice ?? price)}</span>
                          <span className="text-xs text-neutral-400">{variants.length > 1 ? (quickLine(p, menu.data?.modifiers ?? [])?.variantName ?? '') : p.code}</span>
                        </div>
                        {!p.is_active && <div className="text-xs font-medium text-neutral-500">Ngừng bán</div>}
                      </div>
                    </button>
                    {p.is_active && (hasChoices(p, menu.data?.modifiers ?? [])) && (
                      <button disabled={editLocked} onClick={() => setConfigProduct(p)} aria-label={`Tùy chọn ${p.name}`} title="Size, topping, đường, đá"
                        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow hover:bg-white"><SlidersHorizontal size={15} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Giỏ hàng: cột bên phải trên máy tính, ngăn kéo từ dưới lên trên màn hình nhỏ */}
      <aside className={clsx('z-30 flex-col border-l border-neutral-200 bg-white lg:static lg:flex lg:w-[24rem] xl:w-[26rem]',
        cartOpen ? 'fixed inset-0 flex' : 'hidden')}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 lg:hidden">
          <span className="font-bold">Đơn hiện tại</span>
          <button className="btn-secondary !min-h-[36px]" onClick={() => setCartOpen(false)}>Đóng</button>
        </div>
        <CartPanel tables={tables.data ?? []} canDiscount={can('discount.apply')} deliveryEnabled={store.enable_delivery} selected={selected} disabled={editLocked}
          onToggleSelect={(k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
          onPickCustomer={() => setCustomerOpen(true)} onSplit={() => setSplitOpen(true)} />
        <div className="space-y-2 border-t border-neutral-200 p-3">
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" onClick={saveTemp} disabled={busy || pos.lines.length === 0}><Save size={16} /> Lưu tạm (F8)</button>
            {pos.type === 'dine_in'
              ? <button className="btn-secondary" onClick={markPending} disabled={busy || pos.lines.length === 0}>Chờ thanh toán</button>
              : <button className="btn-secondary" onClick={() => (pos.orderId ? setCancelOpen(true) : setClearOpen(true))} disabled={busy || (pos.lines.length === 0 && !pos.orderId)}><XCircle size={16} /> {pos.orderId ? 'Hủy đơn' : 'Xóa giỏ'}</button>}
          </div>
          {pos.type === 'dine_in' && (pos.orderId || pos.lines.length > 0) && (
            <button className="btn-secondary w-full" onClick={() => (pos.orderId ? setCancelOpen(true) : setClearOpen(true))} disabled={busy}><XCircle size={16} /> {pos.orderId ? 'Hủy đơn' : 'Xóa giỏ'}</button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary !min-h-[56px] text-base" onClick={() => void startPayment({ quick: true, method: 'cash' })} disabled={busy || !!payMode || pos.lines.length === 0 || !canPay}
              title={canPay ? 'Khách đưa đủ tiền mặt: chốt đơn ngay' : 'Bạn không có quyền thanh toán'}>
              <Banknote size={18} /> {busy ? 'Đang xử lý…' : 'Tiền mặt (F3)'}
            </button>
            <button className="btn-primary !min-h-[56px] text-base" onClick={() => void startPayment({ method: 'transfer' })} disabled={busy || !!payMode || pos.lines.length === 0 || !canPay}>
              <Landmark size={18} /> Chuyển khoản (F6)
            </button>
          </div>
          <button className="btn-secondary w-full" onClick={() => void startPayment()} disabled={busy || !!payMode || pos.lines.length === 0 || !canPay}>
            Thanh toán / khách đưa tiền thừa (F4) · {formatVND(totals.total)}
          </button>
        </div>
      </aside>

      {!cartOpen && (
        <button className="fixed inset-x-3 bottom-3 z-20 flex min-h-[56px] items-center justify-between rounded-xl bg-brand-600 px-4 text-white shadow-lg lg:hidden" onClick={() => setCartOpen(true)}>
          <span className="flex items-center gap-2 font-semibold"><ShoppingCart size={18} /> {count} món</span>
          <span className="text-lg font-extrabold">{formatVND(totals.total)}</span>
        </button>
      )}

      {configProduct && (
        <ItemDialog key={configProduct.id} product={configProduct} modifiers={menu.data?.modifiers ?? []} onClose={() => setConfigProduct(null)}
          onAdd={(line) => { pos.addLine(line); setConfigProduct(null) }} />
      )}
      <CustomerDialog open={customerOpen} storeId={storeId} onClose={() => setCustomerOpen(false)} onPick={(c) => { pos.setCustomer(c); setCustomerOpen(false) }} />
      <OrdersDrawer open={ordersOpen} storeId={storeId} tableId={ordersTable} onClose={() => setOrdersOpen(false)} onPick={requestLoad} />
      {payMode && (
        <PaymentModal key={payMode.order.id} order={payMode.order} methods={methods.data ?? []} quick={payMode.quick} initialMethod={payMode.method}
          onClose={() => setPayMode(null)}
          onPaid={(info) => {
            // Chốt xong: dọn giỏ NGAY để bán đơn kế tiếp; in chạy nền ở thanh báo, không chặn.
            setPaid({ info, kitchenAuto: printSettings.kitchen_enabled && payMode.type === 'takeaway' })
            setPayMode(null); pos.reset(); setSelected(new Set()); setCartOpen(false); refreshLists()
          }} />
      )}
      {splitOpen && pos.orderId && (
        <SplitDialog open storeId={storeId} fromOrderId={pos.orderId} tables={tables.data ?? []} count={selected.size} busy={busy}
          onClose={() => setSplitOpen(false)} onConfirm={split} />
      )}
      <ConfirmDialog open={!!pendingLoad} title="Bỏ thay đổi chưa lưu?" confirmLabel="Mở đơn khác"
        message="Đơn hiện tại có thay đổi chưa lưu. Mở đơn khác sẽ bỏ các thay đổi này."
        onCancel={() => setPendingLoad(null)} onConfirm={() => { const id = pendingLoad!; setPendingLoad(null); loadOrder(id) }} />
      <ConfirmDialog key={`c${cancelOpen}`} open={cancelOpen} askReason danger busy={busy} title={`Hủy đơn ${pos.code ?? ''}`} confirmLabel="Hủy đơn"
        message="Đơn sẽ bị hủy, bàn được giải phóng và thao tác được ghi vào nhật ký. Không thể thanh toán đơn đã hủy."
        onCancel={() => setCancelOpen(false)} onConfirm={cancelOrder} />
      <ConfirmDialog open={clearOpen} title="Xóa giỏ hàng" danger confirmLabel="Xóa giỏ" message="Xóa toàn bộ món chưa lưu trong giỏ hàng?"
        onCancel={() => setClearOpen(false)} onConfirm={() => { pos.reset(); setClearOpen(false) }} />
    </div>
  )
}
