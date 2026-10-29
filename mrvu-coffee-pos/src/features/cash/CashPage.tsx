import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { TIME_ZONE, formatDateTime, formatVND, parseVND } from '@/lib/format'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { EmptyState, ErrorState, Loading } from '@/components/ui/States'
import { downloadCsv } from '@/features/orders/csv'
import { usePaymentMethods } from '@/features/pos/api'
import { useMyOpenShift } from '@/features/shifts/useShift'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
interface Cat { id: string; name: string; type: 'income' | 'expense' }
interface Tx { id: string; type: 'income' | 'expense'; amount: number; method_code: string; description: string; created_at: string; category_id: string | null }

export default function CashPage() {
  const { membership, session } = useAuth()
  const storeId = membership!.store!.id
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today())
  const [type, setType] = useState<'all' | 'income' | 'expense'>('all')
  const [adding, setAdding] = useState(false)
  const methods = usePaymentMethods(storeId)
  const shift = useMyOpenShift(storeId, session?.user.id)

  const cats = useQuery({ queryKey: ['cash-cats', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('cash_categories').select('id, name, type').eq('store_id', storeId).order('name'); if (error) throw error; return data as Cat[] } })
  const list = useQuery({
    queryKey: ['cash-tx', storeId, from, to, type],
    queryFn: async () => {
      let q = supabase.from('cash_transactions').select('id, type, amount, method_code, description, created_at, category_id').eq('store_id', storeId)
        .gte('created_at', `${from}T00:00:00+07:00`).lte('created_at', `${to}T23:59:59.999+07:00`)
      if (type !== 'all') q = q.eq('type', type)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return (data as Tx[]).map((t) => ({ ...t, amount: Number(t.amount) }))
    },
  })
  const rows = list.data ?? []
  const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0)
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
  const catName = (id: string | null) => cats.data?.find((c) => c.id === id)?.name ?? '—'
  const methodName = (c: string) => methods.data?.find((m) => m.code === c)?.name ?? c

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Thu chi</h1>
        <button className="btn-secondary" disabled={rows.length === 0} onClick={() => downloadCsv(`thu-chi_${from}_${to}.csv`, [['Thời gian', 'Loại', 'Danh mục', 'Diễn giải', 'Phương thức', 'Số tiền'], ...rows.map((r) => [formatDateTime(r.created_at), r.type === 'income' ? 'Thu' : 'Chi', catName(r.category_id), r.description, methodName(r.method_code), r.amount])])}><Download size={16} /> Xuất CSV</button>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Ghi thu / chi</button>
      </div>
      {shift.data === null && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Bạn chưa mở ca, nên chưa ghi được thu chi tiền mặt. Hãy mở ca trong mục “Nhân viên & ca”.</p>}
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-3">
        <input className="input" type="date" aria-label="Từ ngày" value={from} max={to} onChange={(e) => setFrom(e.target.value || today())} />
        <input className="input" type="date" aria-label="Đến ngày" value={to} min={from} onChange={(e) => setTo(e.target.value || today())} />
        <select className="input" aria-label="Loại" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="all">Thu và chi</option><option value="income">Chỉ thu</option><option value="expense">Chỉ chi</option></select>
      </div>
      <div className="card overflow-hidden">
        {list.isLoading && <Loading />}{list.isError && <ErrorState onRetry={() => list.refetch()} />}
        {list.data && rows.length === 0 && <EmptyState title="Không có khoản thu chi" />}
        <ul className="divide-y divide-neutral-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1"><div className="font-medium">{r.description}</div><div className="text-neutral-500">{formatDateTime(r.created_at)} · {catName(r.category_id)} · {methodName(r.method_code)}</div></div>
              <div className={clsx('font-bold', r.type === 'income' ? 'text-green-700' : 'text-brand-700')}>{r.type === 'income' ? '+' : '−'} {formatVND(r.amount)}</div>
            </li>
          ))}
        </ul>
        {rows.length > 0 && <div className="flex flex-wrap justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"><span>Thu: <b className="text-green-700">{formatVND(income)}</b></span><span>Chi: <b className="text-brand-700">{formatVND(expense)}</b></span><span>Chênh lệch: <b>{formatVND(income - expense)}</b></span></div>}
      </div>
      {adding && <AddDialog storeId={storeId} cats={cats.data ?? []} methods={methods.data ?? []} onClose={() => setAdding(false)} />}
    </div>
  )
}

function AddDialog({ storeId, cats, methods, onClose }: { storeId: string; cats: Cat[]; methods: { code: string; name: string }[]; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient()
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [cat, setCat] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState('cash'); const [desc, setDesc] = useState('')
  const n = parseVND(amount)
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('rpc_add_cash_tx', { p_store: storeId, p_type: type, p_category: cat || null, p_amount: n, p_method: method, p_description: desc.trim() }); if (error) throw error },
    onSuccess: () => { toast.success('Đã ghi sổ.'); qc.invalidateQueries({ queryKey: ['cash-tx'] }); qc.invalidateQueries({ queryKey: ['shift-summary'] }); onClose() },
    onError: (e) => toast.error(toAppError(e).message),
  })
  return (
    <Modal open title="Ghi thu / chi" onClose={onClose} size="sm" locked={save.isPending}
      footer={<><button className="btn-secondary" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={!(n > 0) || desc.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Đang ghi…' : 'Ghi sổ'}</button></>}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">{(['expense', 'income'] as const).map((t) => <button key={t} className={clsx('btn', type === t ? 'bg-brand-600 text-white' : 'border border-neutral-300')} onClick={() => { setType(t); setCat('') }}>{t === 'expense' ? 'Chi' : 'Thu'}</button>)}</div>
        <div><label className="mb-1 block font-medium" htmlFor="cx-cat">Danh mục</label><select id="cx-cat" className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Không chọn</option>{cats.filter((c) => c.type === type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="mb-1 block font-medium" htmlFor="cx-amt">Số tiền</label><input id="cx-amt" className="input text-right" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setAmount(String(parseVND(amount) || ''))} /></div>
        <div><label className="mb-1 block font-medium" htmlFor="cx-method">Phương thức</label><select id="cx-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></div>
        <div><label className="mb-1 block font-medium" htmlFor="cx-desc">Diễn giải</label><input id="cx-desc" className="input" value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></div>
        <p className="text-xs text-neutral-500">Sổ thu chi không sửa hoặc xóa. Nếu ghi nhầm, hãy ghi một khoản ngược lại kèm diễn giải.</p>
      </div>
    </Modal>
  )
}
