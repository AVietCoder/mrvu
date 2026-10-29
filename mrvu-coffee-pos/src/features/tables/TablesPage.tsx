import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Armchair, Clock, Pencil, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatTime, formatVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { ORDER_TYPE_LABEL, type CafeTable } from '@/lib/types'
import { useActiveOrders, useTables } from '@/features/pos/api'

const STATUS = {
  free: { label: 'Trống', cls: 'border-green-300 bg-green-50 text-green-800' },
  occupied: { label: 'Đang phục vụ', cls: 'border-brand-300 bg-brand-50 text-brand-800' },
  pending_payment: { label: 'Chờ thanh toán', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
} as const

function elapsed(from: string | null, now: number) {
  if (!from) return ''
  const m = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000))
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`
}

export default function TablesPage() {
  const { membership, can } = useAuth()
  const storeId = membership!.store!.id
  const tables = useTables(storeId)
  const orders = useActiveOrders(storeId)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [selected, setSelected] = useState<CafeTable | null>(null)
  const [edit, setEdit] = useState<{ id: string | null; name: string; area: string; seats: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])

  const orderRows = orders.data
  const byTable = useMemo(() => {
    const m = new Map<string, NonNullable<typeof orderRows>>()
    for (const o of orderRows ?? []) if (o.table_id) m.set(o.table_id, [...(m.get(o.table_id) ?? []), o])
    return m
  }, [orderRows])
  const areas = useMemo(() => {
    const g = new Map<string, CafeTable[]>()
    for (const t of tables.data ?? []) g.set(t.area || 'Khu vực chung', [...(g.get(t.area || 'Khu vực chung') ?? []), t])
    return [...g.entries()]
  }, [tables.data])

  const refresh = () => { qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['active-orders'] }); qc.invalidateQueries({ queryKey: ['orders'] }) }

  const saveTable = useMutation({
    mutationFn: async (f: NonNullable<typeof edit>) => {
      const row = { store_id: storeId, name: f.name.trim(), area: f.area.trim(), seats: Math.max(1, Number(f.seats) || 2) }
      const { error } = f.id ? await supabase.from('tables').update(row).eq('id', f.id) : await supabase.from('tables').insert(row)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Đã lưu bàn.'); setEdit(null); refresh() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  const deactivate = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('tables').update({ is_active: false }).eq('id', id); if (error) throw error },
    onSuccess: () => { toast.success('Đã ẩn bàn.'); setEdit(null); refresh() },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const manage = can('settings.manage')
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (edit && edit.name.trim()) saveTable.mutate(edit) }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Sơ đồ bàn</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => navigate('/pos')}>Đơn mang đi</button>
          {manage && <button className="btn-primary" onClick={() => setEdit({ id: null, name: '', area: '', seats: '4' })}><Plus size={16} /> Thêm bàn</button>}
        </div>
      </div>
      {(tables.isLoading || orders.isLoading) && <Loading />}
      {(tables.isError || orders.isError) && <ErrorState onRetry={() => { tables.refetch(); orders.refetch() }} />}
      {tables.data?.length === 0 && <div className="card"><EmptyState title="Chưa có bàn nào" hint={manage ? 'Bấm "Thêm bàn" để tạo sơ đồ bàn.' : 'Nhờ quản lý thêm bàn.'} /></div>}
      {areas.map(([area, list]) => (
        <section key={area} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{area}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((t) => {
              const os = byTable.get(t.id) ?? []
              const total = os.reduce((s, o) => s + o.total, 0)
              return (
                <button key={t.id} onClick={() => (t.status === 'free' ? navigate(`/pos?table=${t.id}`) : setSelected(t))}
                  className={clsx('flex min-h-[112px] flex-col rounded-xl border-2 p-3 text-left transition active:scale-[0.98]', STATUS[t.status].cls)}>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-extrabold">{t.name}</span>
                    <span className="flex items-center gap-1 text-xs"><Armchair size={14} />{t.seats}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold">{STATUS[t.status].label}</div>
                  {t.status !== 'free' && (
                    <div className="mt-auto pt-2 text-sm">
                      <div className="flex items-center gap-1 text-xs"><Clock size={12} />{formatTime(t.opened_at ?? new Date())} · {elapsed(t.opened_at, now)}</div>
                      <div className="font-bold">{formatVND(total)}{os.length > 1 && <span className="ml-1 text-xs font-normal">({os.length} đơn)</span>}</div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {selected && <TableActions table={selected} orders={byTable.get(selected.id) ?? []} allTables={tables.data ?? []} allOrders={orders.data ?? []}
        onClose={() => setSelected(null)} onChanged={() => { setSelected(null); refresh() }}
        onEdit={manage ? () => { setEdit({ id: selected.id, name: selected.name, area: selected.area, seats: String(selected.seats) }); setSelected(null) } : undefined} />}

      <Modal open={!!edit} title={edit?.id ? 'Sửa bàn' : 'Thêm bàn'} onClose={() => setEdit(null)} locked={saveTable.isPending}
        footer={<>
          {edit?.id && <button className="btn-secondary mr-auto text-brand-700" onClick={() => deactivate.mutate(edit.id!)} disabled={deactivate.isPending}>Ẩn bàn</button>}
          <button className="btn-secondary" onClick={() => setEdit(null)}>Hủy</button>
          <button className="btn-primary" form="table-form" disabled={saveTable.isPending || !edit?.name.trim()}>Lưu</button>
        </>}>
        {edit && (
          <form id="table-form" onSubmit={onSubmit} className="grid gap-3">
            <div><label className="mb-1 block text-sm font-medium" htmlFor="t-name">Tên / số bàn</label><input id="t-name" className="input" value={edit.name} maxLength={20} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div><label className="mb-1 block text-sm font-medium" htmlFor="t-area">Khu vực</label><input id="t-area" className="input" placeholder="Ví dụ: Tầng 1, Sân vườn" value={edit.area} maxLength={40} onChange={(e) => setEdit({ ...edit, area: e.target.value })} /></div>
            <div><label className="mb-1 block text-sm font-medium" htmlFor="t-seats">Số chỗ</label><input id="t-seats" className="input" type="number" min={1} value={edit.seats} onChange={(e) => setEdit({ ...edit, seats: e.target.value })} /></div>
          </form>
        )}
      </Modal>
    </div>
  )
}

type ActiveOrder = NonNullable<ReturnType<typeof useActiveOrders>['data']>[number]

function TableActions({ table, orders, allTables, allOrders, onClose, onChanged, onEdit }: {
  table: CafeTable; orders: ActiveOrder[]; allTables: CafeTable[]; allOrders: ActiveOrder[]
  onClose: () => void; onChanged: () => void; onEdit?: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<'menu' | 'move' | 'merge'>('menu')
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '')
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  const current = orders.find((o) => o.id === orderId)
  const freeTables = allTables.filter((t) => t.status === 'free')
  const mergeTargets = allOrders.filter((o) => o.id !== orderId)

  async function run() {
    if (!current || !dest || busy) return
    setBusy(true)
    const { error } = mode === 'move'
      ? await supabase.rpc('rpc_move_table', { p_order_id: current.id, p_new_table: dest, p_expected_version: current.version })
      : await supabase.rpc('rpc_merge_orders', { p_source: current.id, p_target: dest })
    setBusy(false)
    if (error) return toast.error(toAppError(error).message)
    toast.success(mode === 'move' ? 'Đã chuyển bàn.' : 'Đã gộp đơn.')
    onChanged()
  }

  return (
    <Modal open title={`Bàn ${table.name}`} onClose={onClose} locked={busy}
      footer={mode === 'menu'
        ? <>{onEdit && <button className="btn-secondary mr-auto" onClick={onEdit}><Pencil size={14} /> Sửa bàn</button>}<button className="btn-secondary" onClick={onClose}>Đóng</button></>
        : <><button className="btn-secondary" onClick={() => setMode('menu')} disabled={busy}>Quay lại</button><button className="btn-primary" onClick={run} disabled={busy || !dest}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button></>}>
      {orders.length === 0 ? <p className="text-sm text-neutral-600">Bàn đang được đánh dấu bận nhưng chưa có đơn nào. Tải lại trang để cập nhật.</p> : (
        <>
          {orders.length > 1 && (
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium" htmlFor="ta-order">Đơn</label>
              <select id="ta-order" className="input" value={orderId} onChange={(e) => { setOrderId(e.target.value); setDest('') }}>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.code} · {formatVND(o.total)}</option>)}
              </select>
            </div>
          )}
          {mode === 'menu' && (
            <div className="grid gap-2">
              <button className="btn-primary" onClick={() => navigate(`/pos?order=${orderId}`)}>Mở đơn {current?.code} · {formatVND(current?.total ?? 0)}</button>
              <button className="btn-secondary" onClick={() => navigate(`/pos?table=${table.id}`)} hidden={orders.length < 2}>Xem tất cả đơn của bàn</button>
              <button className="btn-secondary" onClick={() => { setMode('move'); setDest('') }}>Chuyển sang bàn trống</button>
              <button className="btn-secondary" onClick={() => { setMode('merge'); setDest('') }} disabled={mergeTargets.length === 0}>Gộp vào đơn khác</button>
            </div>
          )}
          {mode === 'move' && (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ta-dest">Chuyển đơn {current?.code} tới bàn</label>
              <select id="ta-dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">Chọn bàn trống…</option>
                {freeTables.map((t) => <option key={t.id} value={t.id}>Bàn {t.name}{t.area ? ` · ${t.area}` : ''}</option>)}
              </select>
              {freeTables.length === 0 && <p className="mt-2 text-sm text-neutral-500">Hiện không còn bàn trống.</p>}
            </div>
          )}
          {mode === 'merge' && (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ta-dest">Gộp toàn bộ món của {current?.code} vào đơn</label>
              <select id="ta-dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">Chọn đơn nhận…</option>
                {mergeTargets.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.tables?.name ? `Bàn ${o.tables.name}` : ORDER_TYPE_LABEL[o.type]} · {formatVND(o.total)}</option>)}
              </select>
              <p className="mt-2 text-xs text-neutral-500">Đơn nguồn sẽ được hủy với lý do "Gộp", mọi món chuyển sang đơn nhận.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
