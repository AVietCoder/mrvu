import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import clsx from 'clsx'
import Modal from '@/components/ui/Modal'
import { formatVND } from '@/lib/format'
import type { Modifier, Product } from '@/lib/types'
import type { CartLine, CartOption } from './cart'

interface Props {
  product: Product | null
  modifiers: Modifier[]
  onClose: () => void
  onAdd: (line: Omit<CartLine, 'key'>) => void
}

/** Chọn size, topping, đường/đá, ghi chú và số lượng cho một món. */
export default function ItemDialog({ product, modifiers, onClose, onAdd }: Props) {
  // Mở lại với món khác sẽ khởi tạo lại trạng thái nhờ `key` ở nơi gọi.
  const variants = useMemo(() => product?.product_variants.filter((v) => v.is_active) ?? [], [product])
  const groups = useMemo(() => {
    const ids = new Set(product?.product_modifiers.map((m) => m.modifier_id))
    return modifiers.filter((m) => ids.has(m.id)).map((m) => ({ ...m, modifier_options: m.modifier_options.filter((o) => o.is_active) }))
  }, [product, modifiers])

  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.filter((g) => g.min_select > 0).map((g) => [g.id, g.modifier_options.slice(0, g.min_select).map((o) => o.id)])))
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  if (!product) return null
  const variant = variants.find((v) => v.id === variantId) ?? null
  const base = variant ? variant.price : product.price
  const options: CartOption[] = groups.flatMap((g) => (picked[g.id] ?? []).map((id) => {
    const o = g.modifier_options.find((x) => x.id === id)!
    return { id: o.id, name: o.name, priceDelta: o.price_delta }
  }))
  const unit = base + options.reduce((s, o) => s + o.priceDelta, 0)
  const missing = groups.find((g) => (picked[g.id]?.length ?? 0) < g.min_select)

  function toggle(g: (typeof groups)[number], id: string) {
    setPicked((p) => {
      const cur = p[g.id] ?? []
      if (cur.includes(id)) return g.min_select > 0 && cur.length <= g.min_select && g.max_select === 1 ? p : { ...p, [g.id]: cur.filter((x) => x !== id) }
      if (g.max_select === 1) return { ...p, [g.id]: [id] }
      if (cur.length >= g.max_select) return p
      return { ...p, [g.id]: [...cur, id] }
    })
  }

  return (
    <Modal open title={product.name} onClose={onClose} size="md"
      footer={<>
        <div className="mr-auto flex items-center gap-2">
          <button className="btn-secondary !px-3" aria-label="Giảm" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus size={16} /></button>
          <span className="w-8 text-center font-bold" aria-live="polite">{qty}</span>
          <button className="btn-secondary !px-3" aria-label="Tăng" onClick={() => setQty((q) => Math.min(99, q + 1))}><Plus size={16} /></button>
        </div>
        <button className="btn-primary" disabled={!!missing}
          onClick={() => onAdd({ productId: product.id, variantId: variant?.id ?? null, name: product.name, variantName: variant?.name ?? null,
            basePrice: base, options, quantity: qty, note: note.trim() })}>
          {missing ? `Chọn ${missing.name}` : `Thêm · ${formatVND(unit * qty)}`}
        </button>
      </>}>
      {variants.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-semibold">Size</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === variantId} onClick={() => setVariantId(v.id)}
                className={clsx('min-h-[52px] rounded-lg border px-3 text-left text-sm', v.id === variantId ? 'border-brand-600 bg-brand-50' : 'border-neutral-300')}>
                <div className="font-semibold">{v.name}</div>
                <div className="text-neutral-600">{formatVND(v.price)}</div>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {groups.map((g) => (
        <fieldset key={g.id} className="mb-4">
          <legend className="mb-2 text-sm font-semibold">
            {g.name} <span className="font-normal text-neutral-500">
              {g.min_select > 0 ? `(chọn ${g.min_select === g.max_select ? g.min_select : `${g.min_select}-${g.max_select}`})` : `(tối đa ${g.max_select})`}
            </span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.modifier_options.map((o) => {
              const on = (picked[g.id] ?? []).includes(o.id)
              return (
                <button key={o.id} type="button" aria-pressed={on} onClick={() => toggle(g, o.id)}
                  className={clsx('min-h-[48px] rounded-lg border px-3 text-left text-sm', on ? 'border-brand-600 bg-brand-50' : 'border-neutral-300')}>
                  <div className="font-medium">{o.name}</div>
                  {o.price_delta !== 0 && <div className="text-xs text-neutral-600">+{formatVND(o.price_delta)}</div>}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      <label className="mb-1 block text-sm font-semibold" htmlFor="item-note">Ghi chú</label>
      <input id="item-note" className="input" placeholder="Ví dụ: ít đá, không đường" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  )
}
