import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Modifier } from '@/lib/types'
import { useMenu } from './useMenu'

export default function ModifiersPage() {
  const storeId = useAuth().membership!.store!.id
  const { data, isLoading, isError, refetch } = useMenu(storeId)
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [toDelete, setToDelete] = useState<Modifier | null>(null)

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => { const { error } = await fn(); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
    onError: (e) => toast.error(toAppError(e).message),
  })

  function addGroup(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    run.mutate(() => supabase.from('modifiers').insert({ store_id: storeId, name: n, min_select: 0, max_select: 1 }), {
      onSuccess: () => { setName(''); toast.success('Đã thêm nhóm tùy chọn.') },
    })
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold">Topping & tùy chọn</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Tạo nhóm tùy chọn (Topping, Đường, Đá, Sữa...) rồi gán cho từng món ở trang Thực đơn. Size/biến thể có giá riêng được khai báo ngay trong từng món.
      </p>
      <form onSubmit={addGroup} className="mb-4 flex gap-2">
        <input className="input" placeholder="Tên nhóm mới (ví dụ: Topping)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn-primary shrink-0" disabled={run.isPending || !name.trim()}>Thêm nhóm</button>
      </form>
      {isLoading && <Loading />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {data && data.modifiers.length === 0 && <div className="card"><EmptyState title="Chưa có nhóm tùy chọn" /></div>}
      <div className="space-y-4">
        {data?.modifiers.map((m) => (
          <section key={m.id} className="card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-neutral-500">Tên nhóm</label>
                <input className="input" defaultValue={m.name} maxLength={60}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) run.mutate(() => supabase.from('modifiers').update({ name: v }).eq('id', m.id)) }} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">Chọn tối thiểu</label>
                <input className="input !w-24" type="number" min={0} defaultValue={m.min_select}
                  onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== m.min_select) run.mutate(() => supabase.from('modifiers').update({ min_select: v, max_select: Math.max(v, m.max_select) }).eq('id', m.id)) }} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">Chọn tối đa</label>
                <input className="input !w-24" type="number" min={1} defaultValue={m.max_select}
                  onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== m.max_select) run.mutate(() => supabase.from('modifiers').update({ max_select: v, min_select: Math.min(v, m.min_select) }).eq('id', m.id)) }} />
              </div>
              <button className="btn-secondary !px-3" aria-label={`Xóa nhóm ${m.name}`} onClick={() => setToDelete(m)}><Trash2 size={16} /></button>
            </div>

            <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {m.modifier_options.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 p-2">
                  <input className="input min-w-0 flex-1" defaultValue={o.name} aria-label="Tên lựa chọn" maxLength={60}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.name) run.mutate(() => supabase.from('modifier_options').update({ name: v }).eq('id', o.id)) }} />
                  <input className="input !w-32 text-right" inputMode="numeric" aria-label="Phụ thu" defaultValue={formatVND(o.price_delta)}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => { const v = parseVND(e.target.value); e.target.value = formatVND(v); if (v !== o.price_delta) run.mutate(() => supabase.from('modifier_options').update({ price_delta: v }).eq('id', o.id)) }} />
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={o.is_active}
                      onChange={(e) => run.mutate(() => supabase.from('modifier_options').update({ is_active: e.target.checked }).eq('id', o.id))} />
                    Đang dùng
                  </label>
                </li>
              ))}
              {m.modifier_options.length === 0 && <li className="p-3 text-sm text-neutral-500">Chưa có lựa chọn nào.</li>}
            </ul>
            <AddOption modifierId={m.id} storeId={storeId} order={m.modifier_options.length + 1} />
          </section>
        ))}
      </div>
      <ConfirmDialog open={!!toDelete} title="Xóa nhóm tùy chọn" danger confirmLabel="Xóa" busy={run.isPending}
        message={<>Xóa nhóm <b>{toDelete?.name}</b> cùng các lựa chọn? Hóa đơn cũ vẫn giữ nguyên nội dung đã bán.</>}
        onCancel={() => setToDelete(null)}
        onConfirm={() => run.mutate(() => supabase.from('modifiers').delete().eq('id', toDelete!.id), {
          onSuccess: () => { setToDelete(null); toast.success('Đã xóa nhóm tùy chọn.') } })} />
    </div>
  )
}

function AddOption({ modifierId, storeId, order }: { modifierId: string; storeId: string; order: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('0')
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('modifier_options').insert({
        modifier_id: modifierId, store_id: storeId, name: name.trim(), price_delta: parseVND(price), sort_order: order })
      if (error) throw error
    },
    onSuccess: () => { setName(''); setPrice('0'); qc.invalidateQueries({ queryKey: ['menu'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate() }}>
      <input className="input min-w-0 flex-1" placeholder="Lựa chọn mới (ví dụ: Trân châu)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <input className="input !w-32 text-right" inputMode="numeric" aria-label="Phụ thu" value={price} onChange={(e) => setPrice(e.target.value)} onFocus={(e) => e.target.select()} />
      <button className="btn-secondary" disabled={add.isPending || !name.trim()}><Plus size={16} /> Thêm</button>
    </form>
  )
}
