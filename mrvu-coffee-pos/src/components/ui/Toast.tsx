import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'

interface ToastItem { id: number; ok: boolean; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void }

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((ok: boolean, text: string) => {
    const id = Date.now() + Math.random()
    setItems((l) => [...l, { id, ok, text }])
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), ok ? 3500 : 7000)
  }, [])
  const api = useMemo<ToastApi>(() => ({ success: (t) => push(true, t), error: (t) => push(false, t) }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.ok ? 'status' : 'alert'}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm shadow-lg ${t.ok ? 'bg-green-600 text-white' : 'bg-brand-700 text-white'}`}>
            {t.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast phải nằm trong ToastProvider')
  return ctx
}
