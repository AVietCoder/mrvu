import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, History, Pencil, Plus, Search } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { useIngredients, useSuppliers, type Ingredient } from './api'
import { MOVEMENT_LABEL, fmtQty, parseQty, stockLevel } from './stock'
import RecipesTab from './RecipesTab'

type Tab = 'stock' | 'recipes'

export default function InventoryPage() {
  const { can, membership } = useAuth()
  const storeId = membership!.store!.id
  const [tab, setTab] = useState<Tab>('stock')
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Kho nguyên liệu</h1>
        <div role="tablist" className="flex rounded-lg border border-neutral-300 bg-white p-1 text-sm font-semibold">
          {([['stock', 'Tồn kho'], ['recipes', 'Công thức món']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('min-h-[36px] rounded-md px-3', tab === k ? 'bg-brand-600 text-white' : 'text-neutral-700')}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'stock' ? <StockTab storeId={storeId} canManage={can('inventory.manage')} canAdjust={can('stock.adjust')} /> : <RecipesTab storeId={storeId} canManage={can('inventory.manage')} />}
    </div>
  )
}

function StockTab({ storeId, canManage, canAdjust }: { storeId: string; canManage: boolean; canAdjust: boolean }) {
  const ing = useIngredients(storeId)
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null)
  const [adjust, setAdjust] = useState<Ingredient | null>(null)
  const [history, setHistory] = useState<Ingredient | null>(null)
  const [counting, setCounting] = useState(false)

  const rows = useMemo(() => (ing.data ?? []).filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()) && (!onlyLow || stockLevel(i.current_stock, i.min_stock) !== 'ok')), [ing.data, q, onlyLow])
  const lowCount = (ing.data ?? []).filter((i) => i.is_active && stockLevel(i.current_stock, i.min_stock) !== 'ok').length

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} />
          <input className="input !pl-9" placeholder="Tìm nguyên liệu" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Chỉ hiện sắp hết / hết ({lowCount})</label>
        {canAdjust && <button className="btn-secondary" onClick={() => setCounting(true)} disabled={!ing.data?.length}><ClipboardCheck size={16} /> Kiểm kho</button>}
        {canManage && <button className="btn-primary" onClick={() => setEdit({ unit: 'g', min_stock: 0, is_active: true })}><Plus size={16} /> Thêm nguyên liệu</button>}
      </div>
      <div className="card overflow-hidden">
        {ing.isLoading && <Loading />}
        {ing.isError && <ErrorState onRetry={() => ing.refetch()} />}
        {ing.data && rows.length === 0 && <EmptyState title={ing.data.length === 0 ? 'Chưa có nguyên liệu' : 'Không có kết quả'} hint={ing.data.length === 0 ? 'Thêm nguyên liệu, rồi nhập hàng để có tồn kho.' : undefined} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="p-3">Nguyên liệu</th><th className="p-3 text-right">Tồn kho</th><th className="p-3 text-right">Tối thiểu</th><th className="p-3">Tình trạng</th><th className="p-3" /></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((i) => {
                  const lv = stockLevel(i.current_stock, i.min_stock)
                  return (
                    <tr key={i.id} className={clsx(!i.is_active && 'opacity-50')}>
                      <td className="p-3 font-medium">{i.name}{!i.is_active && <span className="ml-2 text-xs text-neutral-500">(ngưng dùng)</span>}</td>
                      <td className="p-3 text-right font-semibold">{fmtQty(i.current_stock)} {i.unit}</td>
                      <td className="p-3 text-right text-neutral-600">{fmtQty(i.min_stock)} {i.unit}</td>
                      <td className="p-3"><span className={clsx('rounded px-2 py-0.5 text-xs font-medium', lv === 'out' ? 'bg-brand-50 text-brand-700' : lv === 'low' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700')}>{lv === 'out' ? 'Hết hàng' : lv === 'low' ? 'Sắp hết' : 'Còn đủ'}</span></td>
                      <td className="p-3"><div className="flex justify-end gap-1">
                        <button className="btn-secondary !min-h-[36px] !px-2" aria-label={`Lịch sử ${i.name}`} onClick={() => setHistory(i)}><History size={16} /></button>
                        {canAdjust && <button className="btn-secondary !min-h-[36px]" onClick={() => setAdjust(i)}>Hao hụt / chỉnh</button>}
                        {canManage && <button className="btn-secondary !min-h-[36px] !px-2" aria-label={`Sửa ${i.name}`} onClick={() => setEdit(i)}><Pencil size={16} /></button>}
                      </div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <IngredientDialog storeId={storeId} value={edit} onClose={() => setEdit(null)} />}
      {adjust && <AdjustDialog storeId={storeId} ing={adjust} onClose={() => setAdjust(null)} />}
      {history && <HistoryDialog ing={history} onClose={() => setHistory(null)} />}
      {counting && ing.data && <StocktakeDialog storeId={storeId} list={ing.data.filter((i) => i.is_active)} onClose={() => setCounting(false)} />}
    </>
  )
}

function IngredientDialog({ storeId, value, onClose }: { storeId: string; value: Partial<Ingredient>; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const sup = useSuppliers(storeId)
  const [f, setF] = useState({ name: value.name ?? '', unit: value.unit ?? 'g', min: String(value.min_stock ?? 0), supplier: value.supplier_id ?? '', active: value.is_active ?? true })
  const min = parseQty(f.min)
  const invalid = !f.name.trim() || !f.unit.trim() || !(min >= 0)
  const save = useMutation({
    mutationFn: async () => {
      const row = { store_id: storeId, name: f.name.trim(), unit: f.unit.trim(), min_stock: min, supplier_id: f.supplier || null, is_active: f.active }
      const r = value.id ? await supabase.from('ingredients').update(row).eq('id', value.id) : await supabase.from('ingredients').insert(row)
      if (r.error) throw r.error.code === '23505' ? new Error('Đã có nguyên liệu trùng tên.') : r.error
    },
    onSuccess: () => { toast.success('Đã lưu nguyên liệu.'); qc.invalidateQueries({ queryKey: ['ingredients'] }); onClose() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title={value.id ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu'} onClose={onClose} size="sm" locked={save.isPending}
      footer={<><button className="btn-secondary" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>Lưu</button></>}>
      <div className="space-y-3 text-sm">
        <div><label className="mb-1 block font-medium" htmlFor="ig-name">Tên</label><input id="ig-name" className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block font-medium" htmlFor="ig-unit">Đơn vị</label><input id="ig-unit" className="input" value={f.unit} maxLength={12} placeholder="g, ml, cái" onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div><label className="mb-1 block font-medium" htmlFor="ig-min">Tồn tối thiểu</label><input id="ig-min" className="input text-right" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></div>
        </div>
        <div><label className="mb-1 block font-medium" htmlFor="ig-sup">Nhà cung cấp</label>
          <select id="ig-sup" className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">Chưa chọn</option>{sup.data?.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Đang sử dụng</label>
        {value.id && <p className="text-xs text-neutral-500">Tồn kho không sửa trực tiếp ở đây. Dùng Nhập hàng, Hao hụt/chỉnh hoặc Kiểm kho để có lịch sử đối chiếu.</p>}
      </div>
    </Modal>
  )
}

function AdjustDialog({ storeId, ing, onClose }: { storeId: string; ing: Ingredient; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient()
  const [kind, setKind] = useState<'waste' | 'up' | 'down'>('waste')
  const [qty, setQty] = useState(''); const [reason, setReason] = useState('')
  const n = parseQty(qty)
  const invalid = !(n > 0) || reason.trim().length < 3
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('rpc_adjust_stock', { p_store: storeId, p_ingredient: ing.id, p_type: kind === 'waste' ? 'waste' : 'adjustment', p_quantity: n, p_direction: kind === 'down' ? -1 : 1, p_reason: reason.trim() })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Đã ghi sổ kho.'); qc.invalidateQueries({ queryKey: ['ingredients'] }); qc.invalidateQueries({ queryKey: ['stock-history'] }); onClose() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title={`Hao hụt / điều chỉnh: ${ing.name}`} onClose={onClose} size="sm" locked={save.isPending}
      footer={<><button className="btn-secondary" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Đang lưu…' : 'Ghi sổ'}</button></>}>
      <div className="space-y-3 text-sm">
        <p>Tồn hiện tại: <b>{fmtQty(ing.current_stock)} {ing.unit}</b></p>
        <div><label className="mb-1 block font-medium" htmlFor="aj-kind">Loại</label>
          <select id="aj-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as 'waste' | 'up' | 'down')}><option value="waste">Hao hụt / đổ bỏ (trừ kho)</option><option value="up">Điều chỉnh tăng (+)</option><option value="down">Điều chỉnh giảm (−)</option></select></div>
        <div><label className="mb-1 block font-medium" htmlFor="aj-qty">Số lượng ({ing.unit})</label><input id="aj-qty" className="input text-right" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="mb-1 block font-medium" htmlFor="aj-reason">Lý do (bắt buộc)</label><input id="aj-reason" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></div>
        {n > 0 && <p className="text-neutral-600">Tồn sau khi ghi: <b>{fmtQty(ing.current_stock + (kind === 'up' ? n : -n))} {ing.unit}</b></p>}
      </div>
    </Modal>
  )
}

function HistoryDialog({ ing, onClose }: { ing: Ingredient; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['stock-history', ing.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements').select('id, type, quantity, reason, created_at').eq('ingredient_id', ing.id).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as { id: string; type: string; quantity: number; reason: string; created_at: string }[]
    },
  })
  return (
    <Modal open title={`Lịch sử kho: ${ing.name}`} onClose={onClose} size="lg">
      {q.isLoading && <Loading />}{q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="Chưa có biến động" />}
      <ul className="divide-y divide-neutral-100 text-sm">
        {q.data?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 py-2">
            <span className="w-36 text-neutral-500">{formatDateTime(m.created_at)}</span>
            <span className="font-medium">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
            <span className={clsx('font-semibold', Number(m.quantity) < 0 ? 'text-brand-700' : 'text-green-700')}>{Number(m.quantity) > 0 ? '+' : ''}{fmtQty(m.quantity)} {ing.unit}</span>
            {m.reason && <span className="text-neutral-600">{m.reason}</span>}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function StocktakeDialog({ storeId, list, onClose }: { storeId: string; list: Ingredient[]; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient()
  const [vals, setVals] = useState<Record<string, string>>({}); const [note, setNote] = useState('')
  const changes = list.filter((i) => vals[i.id] !== undefined && vals[i.id].trim() !== '').map((i) => ({ i, counted: parseQty(vals[i.id]) }))
  const bad = changes.some((c) => !(c.counted >= 0))
  const diff = changes.filter((c) => c.counted >= 0 && c.counted !== c.i.current_stock)
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('rpc_stocktake', { p_store: storeId, p_counts: changes.map((c) => ({ ingredient_id: c.i.id, counted: c.counted })), p_note: note.trim() })
      if (error) throw error
    },
    onSuccess: () => { toast.success(`Đã kiểm kho, điều chỉnh ${diff.length} nguyên liệu.`); qc.invalidateQueries({ queryKey: ['ingredients'] }); onClose() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title="Kiểm kho" onClose={onClose} size="lg" locked={save.isPending}
      footer={<><span className="mr-auto self-center text-sm text-neutral-600">{diff.length} nguyên liệu chênh lệch</span><button className="btn-secondary" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={changes.length === 0 || bad || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Đang lưu…' : 'Xác nhận kiểm kho'}</button></>}>
      <p className="mb-3 text-sm text-neutral-600">Nhập số đếm thực tế cho nguyên liệu cần kiểm. Ô để trống sẽ không thay đổi. Phần chênh lệch được ghi thành phiếu điều chỉnh.</p>
      <ul className="divide-y divide-neutral-100 text-sm">
        {list.map((i) => {
          const v = vals[i.id] ?? ''; const c = v.trim() === '' ? null : parseQty(v)
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 font-medium">{i.name}<span className="ml-2 font-normal text-neutral-500">hệ thống: {fmtQty(i.current_stock)} {i.unit}</span></span>
              <input className="input !w-32 text-right" inputMode="decimal" aria-label={`Số đếm ${i.name}`} value={v} onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} />
              <span className={clsx('w-28 text-right text-xs', c == null ? '' : Number.isNaN(c) || c < 0 ? 'text-brand-700' : c - i.current_stock === 0 ? 'text-neutral-500' : c < i.current_stock ? 'text-brand-700' : 'text-green-700')}>
                {c == null ? '' : Number.isNaN(c) || c < 0 ? 'Số không hợp lệ' : c - i.current_stock === 0 ? 'Khớp' : `${c > i.current_stock ? '+' : ''}${fmtQty(c - i.current_stock)} ${i.unit}`}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-3"><label className="mb-1 block text-sm font-medium" htmlFor="sk-note">Ghi chú (không bắt buộc)</label><input id="sk-note" className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></div>
    </Modal>
  )
}
