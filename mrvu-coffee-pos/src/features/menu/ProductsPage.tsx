import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import Modal from '@/components/ui/Modal'
import type { Product } from '@/lib/types'
import { useMenu } from './useMenu'

interface FormState {
  id: string | null; code: string; name: string; category_id: string; price: string; tax_rate: string
  sort_order: string; is_active: boolean; image_url: string; cost: string
  variants: { id?: string; name: string; price: string }[]; modifier_ids: string[]
}

const blank = (): FormState => ({ id: null, code: '', name: '', category_id: '', price: '0', tax_rate: '0', sort_order: '0',
  is_active: true, image_url: '', cost: '0', variants: [], modifier_ids: [] })

export default function ProductsPage() {
  const { membership, can } = useAuth()
  const storeId = membership!.store!.id
  const { data, isLoading, isError, refetch } = useMenu(storeId)
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [form, setForm] = useState<FormState | null>(null)
  const [uploading, setUploading] = useState(false)
  const canCost = can('costs.view')
  const canPrice = can('price.edit')

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data?.products ?? []).filter((p) =>
      (cat === 'all' || (cat === 'none' ? !p.category_id : p.category_id === cat)) &&
      (!s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)))
  }, [data, search, cat])

  async function openEdit(p: Product) {
    let cost = '0'
    if (canCost) {
      const { data: c } = await supabase.from('product_costs').select('cost_estimate').eq('product_id', p.id).maybeSingle()
      cost = String(c?.cost_estimate ?? 0)
    }
    setForm({
      id: p.id, code: p.code, name: p.name, category_id: p.category_id ?? '', price: String(p.price), tax_rate: String(p.tax_rate),
      sort_order: String(p.sort_order), is_active: p.is_active, image_url: p.image_url ?? '', cost,
      variants: p.product_variants.filter((v) => v.is_active).map((v) => ({ id: v.id, name: v.name, price: String(v.price) })),
      modifier_ids: p.product_modifiers.map((m) => m.modifier_id),
    })
  }

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const payload: Record<string, unknown> = {
        code: f.code.trim(), name: f.name.trim(), category_id: f.category_id || null, price: parseVND(f.price),
        tax_rate: Number(f.tax_rate) || 0, sort_order: Number(f.sort_order) || 0, is_active: f.is_active,
        image_url: f.image_url || null, modifier_ids: f.modifier_ids,
        variants: f.variants.map((v) => ({ id: v.id, name: v.name.trim(), price: parseVND(v.price) })),
      }
      if (canCost) payload.cost_estimate = parseVND(f.cost)
      const { error } = await supabase.rpc('rpc_save_product', { p_store: storeId, p_id: f.id, p_data: payload })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Đã lưu món.'); setForm(null); qc.invalidateQueries({ queryKey: ['menu'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const toggle = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
    onError: (e) => toast.error(toAppError(e).message),
  })

  async function upload(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast.error('Chỉ nhận ảnh JPG, PNG hoặc WebP.')
    if (file.size > 2 * 1024 * 1024) return toast.error('Ảnh tối đa 2 MB.')
    setUploading(true)
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${storeId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type })
    setUploading(false)
    if (error) return toast.error('Không tải được ảnh. Kiểm tra quyền và kết nối.')
    const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path)
    setForm((f) => (f ? { ...f, image_url: pub.publicUrl } : f))
  }

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f))
  const formInvalid = !form || !form.code.trim() || !form.name.trim() || form.variants.some((v) => !v.name.trim())

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Thực đơn</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} />
          <input className="input !w-56 !pl-9" placeholder="Tìm tên hoặc mã món" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input !w-44" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Lọc danh mục">
          <option value="all">Tất cả danh mục</option>
          {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Chưa phân loại</option>
        </select>
        <button className="btn-primary" onClick={() => setForm(blank())}><Plus size={16} /> Thêm món</button>
      </div>

      <div className="card overflow-hidden">
        {isLoading && <Loading />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && list.length === 0 && <EmptyState title="Chưa có món nào" hint={data.products.length ? 'Không có món khớp bộ lọc.' : 'Bấm "Thêm món" để tạo món đầu tiên.'} />}
        <ul className="divide-y divide-neutral-100">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              {p.image_url ? <img src={p.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
                : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400"><ImagePlus size={18} /></div>}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.name} {!p.is_active && <span className="ml-1 rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-600">Ngừng bán</span>}</div>
                <div className="truncate text-xs text-neutral-500">
                  {p.code} · {data?.categories.find((c) => c.id === p.category_id)?.name ?? 'Chưa phân loại'}
                  {p.product_variants.some((v) => v.is_active) && ` · ${p.product_variants.filter((v) => v.is_active).map((v) => v.name).join(', ')}`}
                </div>
              </div>
              <div className="text-right font-semibold">{formatVND(p.price)}</div>
              <button className={clsx('btn-secondary !px-3', !p.is_active && '!border-green-600 !text-green-700')} onClick={() => toggle.mutate(p)} disabled={toggle.isPending}>
                {p.is_active ? 'Ngừng bán' : 'Bán lại'}
              </button>
              <button className="btn-secondary !px-3" aria-label={`Sửa ${p.name}`} onClick={() => openEdit(p)}><Pencil size={16} /></button>
            </li>
          ))}
        </ul>
      </div>

      <Modal open={!!form} size="lg" title={form?.id ? 'Sửa món' : 'Thêm món'} onClose={() => setForm(null)} locked={save.isPending}
        footer={<>
          <button className="btn-secondary" onClick={() => setForm(null)} disabled={save.isPending}>Hủy</button>
          <button className="btn-primary" disabled={save.isPending || formInvalid || uploading} onClick={() => form && save.mutate(form)}>
            {save.isPending ? 'Đang lưu…' : 'Lưu món'}
          </button>
        </>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mã món *"><input className="input" value={form.code} onChange={(e) => patch({ code: e.target.value })} maxLength={30} /></Field>
            <Field label="Tên món *"><input className="input" value={form.name} onChange={(e) => patch({ name: e.target.value })} maxLength={80} /></Field>
            <Field label="Danh mục">
              <select className="input" value={form.category_id} onChange={(e) => patch({ category_id: e.target.value })}>
                <option value="">Chưa phân loại</option>
                {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Giá bán (₫)" hint={form.id && !canPrice ? 'Bạn không có quyền đổi giá bán.' : undefined}>
              <input className="input" inputMode="numeric" value={form.price} disabled={!!form.id && !canPrice}
                onChange={(e) => patch({ price: e.target.value })} onBlur={() => patch({ price: String(parseVND(form.price)) })} />
            </Field>
            {canCost && (
              <Field label="Giá vốn ước tính (₫)">
                <input className="input" inputMode="numeric" value={form.cost} onChange={(e) => patch({ cost: e.target.value })} onBlur={() => patch({ cost: String(parseVND(form.cost)) })} />
              </Field>
            )}
            <Field label="Thuế suất (%)"><input className="input" type="number" min={0} max={100} step="0.5" value={form.tax_rate} onChange={(e) => patch({ tax_rate: e.target.value })} /></Field>
            <Field label="Thứ tự hiển thị"><input className="input" type="number" value={form.sort_order} onChange={(e) => patch({ sort_order: e.target.value })} /></Field>
            <Field label="Hình ảnh">
              <div className="flex items-center gap-3">
                {form.image_url ? <img src={form.image_url} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-neutral-100" />}
                <label className="btn-secondary cursor-pointer">
                  {uploading ? 'Đang tải…' : 'Chọn ảnh'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
                </label>
                {form.image_url && <button className="text-sm text-brand-700 underline" onClick={() => patch({ image_url: '' })}>Bỏ ảnh</button>}
              </div>
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={form.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
              Đang bán
            </label>

            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">Size / biến thể (mỗi biến thể có giá bán riêng)</span>
                <button className="btn-secondary !min-h-[36px]" onClick={() => patch({ variants: [...form.variants, { name: '', price: form.price }] })}><Plus size={14} /> Thêm</button>
              </div>
              {form.variants.length === 0 && <p className="text-xs text-neutral-500">Không có biến thể: món bán theo giá bán ở trên.</p>}
              <div className="space-y-2">
                {form.variants.map((v, i) => (
                  <div key={v.id ?? i} className="flex gap-2">
                    <input className="input" placeholder="Tên (ví dụ: Size L)" value={v.name} maxLength={40}
                      onChange={(e) => patch({ variants: form.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <input className="input !w-36 text-right" inputMode="numeric" aria-label="Giá biến thể" value={v.price} disabled={!!v.id && !canPrice}
                      onChange={(e) => patch({ variants: form.variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} />
                    <button className="btn-secondary !px-3" aria-label="Xóa biến thể" onClick={() => patch({ variants: form.variants.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Nhóm tùy chọn áp dụng (topping, đường, đá...)</span>
              {data?.modifiers.length === 0 && <p className="text-xs text-neutral-500">Chưa có nhóm nào. Tạo ở trang "Topping & tùy chọn".</p>}
              <div className="flex flex-wrap gap-2">
                {data?.modifiers.map((m) => {
                  const on = form.modifier_ids.includes(m.id)
                  return (
                    <button key={m.id} type="button" aria-pressed={on}
                      className={clsx('min-h-[40px] rounded-lg border px-3 text-sm font-medium', on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-neutral-300 bg-white')}
                      onClick={() => patch({ modifier_ids: on ? form.modifier_ids.filter((x) => x !== m.id) : [...form.modifier_ids, m.id] })}>
                      {m.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}
