import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { useToast } from '@/components/ui/Toast'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Category } from '@/lib/types'
import { useMenu } from './useMenu'

export default function CategoriesPage() {
  const storeId = useAuth().membership!.store!.id
  const { data, isLoading, isError, refetch } = useMenu(storeId)
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [toDelete, setToDelete] = useState<Category | null>(null)

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => { const { error } = await fn(); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
    onError: (e) => toast.error(toAppError(e).message),
  })

  function add(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const next = (data?.categories.reduce((m, c) => Math.max(m, c.sort_order), 0) ?? 0) + 1
    run.mutate(() => supabase.from('categories').insert({ store_id: storeId, name: n, sort_order: next }), {
      onSuccess: () => { setName(''); toast.success('Đã thêm danh mục.') },
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Danh mục sản phẩm</h1>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input className="input" placeholder="Tên danh mục mới (ví dụ: Cà phê)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn-primary shrink-0" disabled={run.isPending || !name.trim()}>Thêm</button>
      </form>
      <div className="card overflow-hidden">
        {isLoading && <Loading />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && data.categories.length === 0 && <EmptyState title="Chưa có danh mục" hint="Thêm danh mục đầu tiên ở ô phía trên." />}
        <ul className="divide-y divide-neutral-100">
          {data?.categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <input className="input min-w-0 flex-1" defaultValue={c.name} aria-label="Tên danh mục" maxLength={60}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run.mutate(() => supabase.from('categories').update({ name: v }).eq('id', c.id)) }} />
              <input className="input !w-20" type="number" defaultValue={c.sort_order} aria-label="Thứ tự"
                onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== c.sort_order) run.mutate(() => supabase.from('categories').update({ sort_order: v }).eq('id', c.id)) }} />
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={c.is_active}
                  onChange={(e) => run.mutate(() => supabase.from('categories').update({ is_active: e.target.checked }).eq('id', c.id))} />
                Hiển thị
              </label>
              <button className="btn-secondary !px-3" aria-label={`Xóa ${c.name}`} onClick={() => setToDelete(c)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Thứ tự nhỏ hơn hiển thị trước. Món trong danh mục bị xóa sẽ chuyển thành "Chưa phân loại".</p>
      <ConfirmDialog open={!!toDelete} title="Xóa danh mục" danger confirmLabel="Xóa" busy={run.isPending}
        message={<>Xóa danh mục <b>{toDelete?.name}</b>? Các món thuộc danh mục sẽ không bị xóa.</>}
        onCancel={() => setToDelete(null)}
        onConfirm={() => run.mutate(() => supabase.from('categories').delete().eq('id', toDelete!.id), {
          onSuccess: () => { setToDelete(null); toast.success('Đã xóa danh mục.') } })} />
    </div>
  )
}
