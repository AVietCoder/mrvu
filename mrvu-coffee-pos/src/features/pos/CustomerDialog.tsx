import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { useToast } from '@/components/ui/Toast'
import { Loading } from '@/components/ui/States'
import { searchCustomers } from './api'
import type { PosCustomer } from './usePosStore'

interface Props { open: boolean; storeId: string; onClose: () => void; onPick: (c: PosCustomer) => void }

export default function CustomerDialog({ open, storeId, onClose, onPick }: Props) {
  const toast = useToast()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { const t = setTimeout(() => setDebounced(term), 250); return () => clearTimeout(t) }, [term])
  const { data, isFetching } = useQuery({ queryKey: ['customers-search', storeId, debounced], queryFn: () => searchCustomers(storeId, debounced), enabled: open })

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    const { data: row, error } = await supabase.from('customers').insert({ store_id: storeId, name: name.trim(), phone: phone.trim() || null }).select('id, name, phone').single()
    setBusy(false)
    if (error) return toast.error(toAppError(error).message)
    onPick(row as PosCustomer)
  }

  return (
    <Modal open={open} title="Gắn khách hàng" onClose={onClose}>
      <input className="input" autoFocus placeholder="Tìm theo tên hoặc số điện thoại" value={term} onChange={(e) => setTerm(e.target.value)} />
      <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-neutral-200">
        {isFetching && !data && <Loading />}
        {data?.length === 0 && <p className="p-3 text-sm text-neutral-500">Không tìm thấy khách hàng. Tạo mới ở bên dưới.</p>}
        <ul className="divide-y divide-neutral-100">
          {data?.map((c) => (
            <li key={c.id}>
              <button className="flex min-h-[48px] w-full items-center justify-between px-3 text-left hover:bg-neutral-50" onClick={() => onPick({ id: c.id, name: c.name, phone: c.phone })}>
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-neutral-500">{c.phone} · {c.order_count} đơn</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 border-t border-neutral-200 pt-3">
        <div className="mb-2 flex items-center gap-1 text-sm font-semibold"><UserPlus size={16} /> Khách mới</div>
        <div className="flex gap-2">
          <input className="input" placeholder="Tên khách" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <input className="input !w-40" placeholder="Số điện thoại" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          <button className="btn-primary shrink-0" onClick={create} disabled={busy || !name.trim()}>Tạo</button>
        </div>
      </div>
    </Modal>
  )
}
