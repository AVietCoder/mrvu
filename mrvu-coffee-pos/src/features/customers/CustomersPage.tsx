import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { formatDateTime, formatVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { ORDER_STATUS_LABEL, type Customer, type OrderStatus } from '@/lib/types'

export default function CustomersPage() {
  const storeId = useAuth().membership!.store!.id
  const [term, setTerm] = useState(''); const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Partial<Customer> | null>(null)
  const [view, setView] = useState<Customer | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 250); return () => clearTimeout(t) }, [term])
  const list = useQuery({
    queryKey: ['customers', storeId, q],
    queryFn: async () => {
      let b = supabase.from('customers').select('id, name, phone, note, total_spent, order_count').eq('store_id', storeId)
      if (q) { const s = q.replace(/[%,()]/g, ''); b = b.or(`name.ilike.%${s}%,phone.ilike.%${s}%`) }
      const { data, error } = await b.order('name').limit(200)
      if (error) throw error
      return (data as Customer[]).map((c) => ({ ...c, total_spent: Number(c.total_spent), order_count: Number(c.order_count) }))
    },
  })
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Khách hàng</h1>
        <button className="btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Thêm khách</button>
      </div>
      <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" size={16} /><input className="input !pl-9" placeholder="Tìm theo tên hoặc số điện thoại" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <div className="card overflow-hidden">
        {list.isLoading && <Loading />}{list.isError && <ErrorState onRetry={() => list.refetch()} />}
        {list.data?.length === 0 && <EmptyState title="Chưa có khách hàng" hint={q ? 'Không có kết quả phù hợp.' : 'Có thể thêm khách ngay khi bán hàng.'} />}
        <ul className="divide-y divide-neutral-100 text-sm">
          {list.data?.map((c) => (
            <li key={c.id}><button className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-neutral-50" onClick={() => setView(c)}>
              <span className="min-w-0 flex-1"><span className="font-semibold">{c.name}</span><span className="ml-2 text-neutral-500">{c.phone ?? 'Chưa có SĐT'}</span></span>
              <span className="text-neutral-600">{c.order_count} đơn</span><span className="w-28 text-right font-semibold">{formatVND(c.total_spent)}</span>
            </button></li>
          ))}
        </ul>
      </div>
      {view && <CustomerDetail c={view} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null) }} />}
      {edit && <CustomerForm storeId={storeId} value={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function CustomerForm({ storeId, value, onClose }: { storeId: string; value: Partial<Customer>; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient()
  const [f, setF] = useState({ name: value.name ?? '', phone: value.phone ?? '', note: value.note ?? '' })
  const phoneOk = f.phone.trim() === '' || /^[0-9+\s.-]{8,15}$/.test(f.phone.trim())
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: f.name.trim(), phone: f.phone.trim() || null, note: f.note.trim() }
      const r = value.id ? await supabase.from('customers').update(row).eq('id', value.id) : await supabase.from('customers').insert({ store_id: storeId, ...row })
      if (r.error) throw r.error
    },
    onSuccess: () => { toast.success('Đã lưu khách hàng.'); qc.invalidateQueries({ queryKey: ['customers'] }); onClose() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title={value.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={onClose} size="sm" locked={save.isPending}
      footer={<><button className="btn-secondary" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={!f.name.trim() || !phoneOk || save.isPending} onClick={() => save.mutate()}>Lưu</button></>}>
      <div className="space-y-3 text-sm">
        <div><label className="mb-1 block font-medium" htmlFor="cu-name">Tên</label><input id="cu-name" className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="mb-1 block font-medium" htmlFor="cu-phone">Số điện thoại</label><input id="cu-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />{!phoneOk && <p className="mt-1 text-brand-700">Số điện thoại không hợp lệ.</p>}</div>
        <div><label className="mb-1 block font-medium" htmlFor="cu-note">Ghi chú</label><input id="cu-note" className="input" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </div>
    </Modal>
  )
}

function CustomerDetail({ c, onClose, onEdit }: { c: Customer; onClose: () => void; onEdit: () => void }) {
  const q = useQuery({
    queryKey: ['customer-orders', c.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('id, code, status, total, paid_at, created_at').eq('customer_id', c.id).neq('status', 'draft').order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return data as { id: string; code: string; status: OrderStatus; total: number; paid_at: string | null; created_at: string }[]
    },
  })
  return (
    <Modal open title={c.name} onClose={onClose} size="md" footer={<button className="btn-secondary" onClick={onEdit}>Sửa thông tin</button>}>
      <div className="mb-3 text-sm text-neutral-600">{c.phone ?? 'Chưa có SĐT'}{c.note ? ` · ${c.note}` : ''}<br />{c.order_count} đơn · tổng chi tiêu <b>{formatVND(c.total_spent)}</b></div>
      {q.isLoading && <Loading />}{q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState title="Chưa có đơn nào" />}
      <ul className="divide-y divide-neutral-100 text-sm">
        {q.data?.map((o) => <li key={o.id} className="flex items-center gap-3 py-2"><Link className="font-semibold underline" to={`/don-hang?order=${o.id}`} onClick={onClose}>{o.code}</Link><span className="flex-1 text-neutral-500">{formatDateTime(o.paid_at ?? o.created_at)} · {ORDER_STATUS_LABEL[o.status]}</span><span className="font-medium">{formatVND(Number(o.total))}</span></li>)}
      </ul>
    </Modal>
  )
}
