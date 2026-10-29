import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { useIngredients } from './api'
import { fmtQty, parseQty } from './stock'

interface Prod { id: string; name: string; code: string; product_variants: { id: string; name: string; is_active: boolean }[] }
interface Line { ingredient_id: string; quantity: string }

export default function RecipesTab({ storeId, canManage }: { storeId: string; canManage: boolean }) {
  const toast = useToast(); const qc = useQueryClient()
  const ing = useIngredients(storeId)
  const prods = useQuery({
    queryKey: ['recipe-products', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id, name, code, product_variants(id, name, is_active)').eq('store_id', storeId).order('name')
      if (error) throw error
      return data as Prod[]
    },
  })
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('') // '' = áp dụng mọi biến thể
  const product = prods.data?.find((p) => p.id === productId)

  const recipe = useQuery({
    queryKey: ['recipe', productId, variantId], enabled: Boolean(productId),
    queryFn: async () => {
      let q = supabase.from('product_recipes').select('ingredient_id, quantity').eq('product_id', productId)
      q = variantId ? q.eq('variant_id', variantId) : q.is('variant_id', null)
      const { data, error } = await q
      if (error) throw error
      return (data as { ingredient_id: string; quantity: number }[]).map((r) => ({ ingredient_id: r.ingredient_id, quantity: fmtQty(r.quantity) }))
    },
  })

  return (
    <div className="card p-4">
      <p className="mb-3 text-sm text-neutral-600">Công thức cho biết mỗi lần bán 1 phần thì trừ bao nhiêu nguyên liệu. Công thức chung (không chọn size) áp dụng cho mọi size; nếu món có công thức riêng cho một size thì dùng công thức riêng đó.</p>
      {prods.isLoading && <Loading />}{prods.isError && <ErrorState onRetry={() => prods.refetch()} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block text-sm font-medium" htmlFor="rc-prod">Món</label>
          <select id="rc-prod" className="input" value={productId} onChange={(e) => { setProductId(e.target.value); setVariantId('') }}><option value="">Chọn món…</option>{prods.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select></div>
        <div><label className="mb-1 block text-sm font-medium" htmlFor="rc-var">Áp dụng cho</label>
          <select id="rc-var" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!product}><option value="">Mọi size / biến thể</option>{product?.product_variants.filter((v) => v.is_active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
      </div>
      {!productId && <EmptyState title="Chọn một món để xem công thức" />}
      {productId && recipe.isLoading && <Loading />}
      {productId && recipe.data && ing.data && (
        <RecipeEditor key={`${productId}:${variantId}:${JSON.stringify(recipe.data)}`} initial={recipe.data} ingredients={ing.data.filter((i) => i.is_active)} canManage={canManage}
          saving={false} onSave={async (lines) => {
            const { error } = await supabase.rpc('rpc_save_recipe', { p_store: storeId, p_product: productId, p_variant: variantId || null, p_items: lines })
            if (error) { toast.error(toAppError(error).message); return }
            toast.success('Đã lưu công thức.'); qc.invalidateQueries({ queryKey: ['recipe'] })
          }} />
      )}
    </div>
  )
}

function RecipeEditor({ initial, ingredients, canManage, onSave }: { initial: Line[]; ingredients: { id: string; name: string; unit: string }[]; canManage: boolean; saving: boolean; onSave: (l: { ingredient_id: string; quantity: number }[]) => Promise<void> }) {
  const [lines, setLines] = useState<Line[]>(initial)
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => lines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: parseQty(l.quantity) })), [lines])
  const dup = new Set(lines.map((l) => l.ingredient_id).filter(Boolean)).size !== lines.filter((l) => l.ingredient_id).length
  const invalid = dup || parsed.some((p) => !p.ingredient_id || !(p.quantity > 0))
  const unit = (id: string) => ingredients.find((i) => i.id === id)?.unit ?? ''
  const save = useMutation({ mutationFn: async () => { setBusy(true); try { await onSave(parsed) } finally { setBusy(false) } } })
  return (
    <div className="mt-4">
      {lines.length === 0 && <p className="mb-2 text-sm text-neutral-500">Món này chưa có công thức: bán ra sẽ không trừ kho.</p>}
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <select className="input min-w-0 flex-1" aria-label="Nguyên liệu" value={l.ingredient_id} disabled={!canManage} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredient_id: e.target.value } : x)))}>
              <option value="">Chọn nguyên liệu…</option>{ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <input className="input !w-28 text-right" inputMode="decimal" aria-label="Định lượng" value={l.quantity} disabled={!canManage} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <span className="w-10 text-sm text-neutral-500">{unit(l.ingredient_id)}</span>
            {canManage && <button className="btn-secondary !px-3" aria-label="Xóa dòng" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
          </li>
        ))}
      </ul>
      {dup && <p className="mt-2 text-sm text-brand-700">Một nguyên liệu chỉ nên xuất hiện một lần.</p>}
      {canManage && (
        <div className="mt-3 flex gap-2">
          <button className="btn-secondary" onClick={() => setLines([...lines, { ingredient_id: '', quantity: '' }])}><Plus size={16} /> Thêm nguyên liệu</button>
          <button className="btn-primary" disabled={invalid || busy} onClick={() => save.mutate()}>{busy ? 'Đang lưu…' : 'Lưu công thức'}</button>
        </div>
      )}
    </div>
  )
}
