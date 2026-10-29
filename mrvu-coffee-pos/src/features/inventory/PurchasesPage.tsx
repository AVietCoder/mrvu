import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Truck } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatDateTime, formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { useIngredients, useSuppliers, type Supplier } from './api'
import { fmtQty, parseQty } from './stock'

type Status = 'draft' | 'ordered' | 'received' | 'cancelled'
const LABEL: Record<Status, string> = { draft: 'Nháp', ordered: 'Đã đặt hàng', received: 'Đã nhận hàng', cancelled: 'Đã hủy' }
const CLS: Record<Status, string> = { draft: 'bg-neutral-100 text-neutral-700', ordered: 'bg-blue-50 text-blue-700', received: 'bg-green-50 text-green-700', cancelled: 'bg-neutral-200 text-neutral-600' }
interface PO { id: string; code: string; status: Status; total: number; note: string; supplier_id: string | null; created_at: string; received_at: string | null }

export default function PurchasesPage() {
  const { can, membership } = useAuth()
  const storeId = membership!.store!.id
  const canBuy = can('purchase.manage')
  const toast = useToast(); const qc = useQueryClient()
  const sup = useSuppliers(storeId)
  const [status, setStatus] = useState<'all' | Status>('all')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [suppliersOpen, setSuppliersOpen] = useState(false)
  const [toReceive, setToReceive] = useState<PO | null>(null)
  const [toCancel, setToCancel] = useState<PO | null>(null)

  const list = useQuery({
    queryKey: ['purchases', storeId, status],
    queryFn: async () => {
      let q = supabase.from('purchase_orders').select('id, code, status, total, note, supplier_id, created_at, received_at').eq('store_id', storeId)
      if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return (data as PO[]).map((p) => ({ ...p, total: Number(p.total) }))
    },
  })
  const supName = (id: string | null) => sup.data?.find((s) => s.id === id)?.name ?? '—'
  const refresh = () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['ingredients'] }) }

  const receive = useMutation({
    mutationFn: async (id: string) => { const { data, error } = await supabase.rpc('rpc_receive_purchase', { p_po: id }); if (error) throw error; return data as { replayed: boolean } },
    onSuccess: (r) => { toast.success(r.replayed ? 'Phiếu này đã được nhận hàng trước đó, kho không bị cộng thêm.' : 'Đã nhận hàng, kho đã được cộng.'); setToReceive(null); refresh() },
    onError: (e) => { toast.error(toAppError(e).message); refresh() },
  })
  const cancel = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => { const { error } = await supabase.rpc('rpc_cancel_purchase', { p_po: id, p_reason: reason }); if (error) throw error },
    onSuccess: () => { toast.success('Đã hủy phiếu.'); setToCancel(null); refresh() },
    onError: (e) => toast.error(toAppError(e).message),
  })

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Nhập hàng</h1>
        <select className="input !w-auto" aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value as 'all' | Status)}>
          <option value="all">Mọi trạng thái</option>{(Object.keys(LABEL) as Status[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
        {canBuy && <button className="btn-secondary" onClick={() => setSuppliersOpen(true)}><Truck size={16} /> Nhà cung cấp</button>}
        {canBuy && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Phiếu nhập mới</button>}
      </div>
      <div className="card overflow-hidden">
        {list.isLoading && <Loading />}{list.isError && <ErrorState onRetry={() => list.refetch()} />}
        {list.data && list.data.length === 0 && <EmptyState title="Chưa có phiếu nhập" />}
        <ul className="divide-y divide-neutral-100">
          {list.data?.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.code} <span className={clsx('ml-2 rounded px-2 py-0.5 text-xs font-medium', CLS[p.status])}>{LABEL[p.status]}</span></div>
                <div className="text-neutral-600">{supName(p.supplier_id)} · {formatDateTime(p.received_at ?? p.created_at)}{p.note ? ` · ${p.note}` : ''}</div>
              </div>
              <div className="font-bold">{formatVND(p.total)}</div>
              <div className="flex gap-2">
                <button className="btn-secondary !min-h-[36px]" onClick={() => setEditing(p.id)}>{canBuy && ['draft', 'ordered'].includes(p.status) ? 'Sửa' : 'Xem'}</button>
                {canBuy && ['draft', 'ordered'].includes(p.status) && <button className="btn-primary !min-h-[36px]" onClick={() => setToReceive(p)}>Nhận hàng</button>}
                {canBuy && ['draft', 'ordered'].includes(p.status) && <button className="btn-secondary !min-h-[36px] text-brand-700" onClick={() => setToCancel(p)}>Hủy</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {editing && <PurchaseDialog storeId={storeId} id={editing === 'new' ? null : editing} canEdit={canBuy} onClose={() => setEditing(null)} onSaved={refresh} />}
      {suppliersOpen && <SuppliersDialog storeId={storeId} onClose={() => setSuppliersOpen(false)} />}
      <ConfirmDialog open={!!toReceive} title={`Nhận hàng ${toReceive?.code ?? ''}`} confirmLabel="Xác nhận đã nhận đủ" busy={receive.isPending}
        message={`Kho sẽ được cộng theo phiếu (${toReceive ? formatVND(toReceive.total) : ''}). Thao tác chỉ thực hiện một lần cho mỗi phiếu.`}
        onCancel={() => setToReceive(null)} onConfirm={() => toReceive && receive.mutate(toReceive.id)} />
      <ConfirmDialog open={!!toCancel} askReason danger title={`Hủy phiếu ${toCancel?.code ?? ''}`} confirmLabel="Hủy phiếu" busy={cancel.isPending} message="Phiếu chưa nhận hàng sẽ bị hủy, kho không thay đổi."
        onCancel={() => setToCancel(null)} onConfirm={(reason) => toCancel && cancel.mutate({ id: toCancel.id, reason })} />
    </div>
  )
}

interface Line { ingredient_id: string; quantity: string; unit_cost: string }

function PurchaseDialog({ storeId, id, canEdit, onClose, onSaved }: { storeId: string; id: string | null; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const ing = useIngredients(storeId); const sup = useSuppliers(storeId)
  const q = useQuery({
    queryKey: ['purchase', id], enabled: Boolean(id),
    queryFn: async () => {
      const [po, items] = await Promise.all([
        supabase.from('purchase_orders').select('id, code, status, note, supplier_id').eq('id', id!).single(),
        supabase.from('purchase_order_items').select('ingredient_id, quantity, unit_cost').eq('purchase_order_id', id!),
      ])
      if (po.error) throw po.error; if (items.error) throw items.error
      return { po: po.data as { code: string; status: Status; note: string; supplier_id: string | null }, items: items.data as { ingredient_id: string; quantity: number; unit_cost: number }[] }
    },
  })
  const loading = (Boolean(id) && q.isLoading) || ing.isLoading
  return (
    <Modal open title={id ? `Phiếu nhập ${q.data?.po.code ?? ''}` : 'Phiếu nhập mới'} onClose={onClose} size="lg">
      {loading && <Loading />}{(q.isError || ing.isError) && <ErrorState onRetry={() => { q.refetch(); ing.refetch() }} />}
      {!loading && ing.data && (!id || q.data) && (
        <PurchaseForm key={id ?? 'new'} storeId={storeId} id={id} ingredients={ing.data.filter((i) => i.is_active)} suppliers={sup.data?.filter((s) => s.is_active) ?? []}
          readOnly={!canEdit || (q.data ? !['draft', 'ordered'].includes(q.data.po.status) : false)}
          initial={q.data ? { supplier: q.data.po.supplier_id ?? '', note: q.data.po.note, lines: q.data.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: fmtQty(i.quantity), unit_cost: String(Number(i.unit_cost)) })) } : { supplier: '', note: '', lines: [{ ingredient_id: '', quantity: '', unit_cost: '' }] }}
          onClose={onClose} onSaved={() => { onSaved(); toast.success('Đã lưu phiếu nhập.'); onClose() }} />
      )}
    </Modal>
  )
}

function PurchaseForm({ storeId, id, ingredients, suppliers, readOnly, initial, onClose, onSaved }: {
  storeId: string; id: string | null; ingredients: { id: string; name: string; unit: string }[]; suppliers: Supplier[]; readOnly: boolean
  initial: { supplier: string; note: string; lines: Line[] }; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [supplier, setSupplier] = useState(initial.supplier); const [note, setNote] = useState(initial.note); const [lines, setLines] = useState(initial.lines)
  const parsed = lines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: parseQty(l.quantity), unit_cost: parseVND(l.unit_cost) }))
  const total = parsed.reduce((s, l) => s + (l.quantity > 0 ? Math.round(l.quantity * l.unit_cost) : 0), 0)
  const ids = lines.map((l) => l.ingredient_id).filter(Boolean)
  const dup = new Set(ids).size !== ids.length
  const invalid = dup || parsed.length === 0 || parsed.some((p) => !p.ingredient_id || !(p.quantity > 0))
  const unit = (i: string) => ingredients.find((g) => g.id === i)?.unit ?? ''
  const save = useMutation({
    mutationFn: async (status: 'draft' | 'ordered') => {
      const { error } = await supabase.rpc('rpc_save_purchase', { p_store: storeId, p_id: id, p_supplier: supplier || null, p_note: note.trim(), p_items: parsed, p_status: status })
      if (error) throw error
    },
    onSuccess: onSaved, onError: (e) => toast.error(toAppError(e).message),
  })
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)))
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block font-medium" htmlFor="po-sup">Nhà cung cấp</label>
          <select id="po-sup" className="input" value={supplier} disabled={readOnly} onChange={(e) => setSupplier(e.target.value)}><option value="">Chưa chọn</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="mb-1 block font-medium" htmlFor="po-note">Ghi chú</label><input id="po-note" className="input" value={note} disabled={readOnly} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <select className="input min-w-0 flex-1" aria-label="Nguyên liệu" value={l.ingredient_id} disabled={readOnly} onChange={(e) => set(i, { ingredient_id: e.target.value })}><option value="">Chọn nguyên liệu…</option>{ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <input className="input !w-24 text-right" inputMode="decimal" aria-label="Số lượng" placeholder="SL" value={l.quantity} disabled={readOnly} onChange={(e) => set(i, { quantity: e.target.value })} />
            <span className="w-8 text-neutral-500">{unit(l.ingredient_id)}</span>
            <input className="input !w-28 text-right" inputMode="numeric" aria-label="Đơn giá" placeholder="Đơn giá" value={l.unit_cost} disabled={readOnly} onChange={(e) => set(i, { unit_cost: e.target.value })} />
            {!readOnly && <button className="btn-secondary !px-3" aria-label="Xóa dòng" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 size={16} /></button>}
          </li>
        ))}
      </ul>
      {dup && <p className="text-brand-700">Một nguyên liệu chỉ nên xuất hiện một lần trong phiếu.</p>}
      {!readOnly && <button className="btn-secondary" onClick={() => setLines([...lines, { ingredient_id: '', quantity: '', unit_cost: '' }])}><Plus size={16} /> Thêm dòng</button>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
        <div className="text-base font-bold">Tổng: {formatVND(total)}</div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>Đóng</button>
          {!readOnly && <button className="btn-secondary" disabled={invalid || save.isPending} onClick={() => save.mutate('draft')}>Lưu nháp</button>}
          {!readOnly && <button className="btn-primary" disabled={invalid || save.isPending} onClick={() => save.mutate('ordered')}>Lưu đã đặt hàng</button>}
        </div>
      </div>
    </div>
  )
}

function SuppliersDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const sup = useSuppliers(storeId)
  const [f, setF] = useState({ name: '', phone: '' })
  const add = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('suppliers').insert({ store_id: storeId, name: f.name.trim(), phone: f.phone.trim() }); if (error) throw error },
    onSuccess: () => { setF({ name: '', phone: '' }); qc.invalidateQueries({ queryKey: ['suppliers'] }) }, onError: (e) => toast.error(toAppError(e).message),
  })
  const toggle = useMutation({
    mutationFn: async (s: Supplier) => { const { error } = await supabase.from('suppliers').update({ is_active: !s.is_active }).eq('id', s.id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }), onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title="Nhà cung cấp" onClose={onClose}>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) add.mutate() }}>
        <input className="input min-w-0 flex-1" placeholder="Tên nhà cung cấp" aria-label="Tên nhà cung cấp" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input !w-36" placeholder="Điện thoại" aria-label="Điện thoại" value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <button className="btn-primary" disabled={!f.name.trim() || add.isPending}>Thêm</button>
      </form>
      {sup.isLoading && <Loading />}
      {sup.data?.length === 0 && <EmptyState title="Chưa có nhà cung cấp" />}
      <ul className="divide-y divide-neutral-100 text-sm">
        {sup.data?.map((s) => (
          <li key={s.id} className={clsx('flex items-center gap-2 py-2', !s.is_active && 'opacity-50')}>
            <span className="flex-1 font-medium">{s.name}<span className="ml-2 font-normal text-neutral-500">{s.phone}</span></span>
            <button className="btn-secondary !min-h-[36px]" onClick={() => toggle.mutate(s)}>{s.is_active ? 'Ngưng dùng' : 'Dùng lại'}</button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
