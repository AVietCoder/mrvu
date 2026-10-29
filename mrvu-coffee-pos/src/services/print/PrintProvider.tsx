import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/app/AuthProvider'
import { supabase } from '@/lib/supabase'
import { createPrintService, type PrintService } from './printService'
import { SimulatorAdapter } from './simulatorAdapter'
import type { PrintSettings } from './types'

export const DEFAULT_SETTINGS: PrintSettings = {
  method: 'simulator', printer_name: '', paper_width: 80, auto_print: true, allow_reprint: true,
  margin_mm: 2, font_size: 12, copies: 1, kitchen_enabled: false, kitchen_printer_name: '',
}
const COLS = 'method, printer_name, paper_width, auto_print, allow_reprint, margin_mm, font_size, copies, kitchen_enabled, kitchen_printer_name'

interface Ctx { service: PrintService; simulator: SimulatorAdapter; settings: PrintSettings; settingsLoaded: boolean; reload: () => void }
const PrintContext = createContext<Ctx | null>(null)

export function PrintProvider({ children }: { children: ReactNode }) {
  const { membership, session } = useAuth()
  const storeId = membership?.store?.id
  const userId = session?.user.id
  const qc = useQueryClient()
  const simulator = useMemo(() => new SimulatorAdapter(), [])
  const service = useMemo(() => (storeId && userId ? createPrintService(storeId, userId, simulator) : null), [storeId, userId, simulator])
  const q = useQuery({
    queryKey: ['print-settings', storeId], enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase.from('print_settings').select(COLS).eq('store_id', storeId!).maybeSingle()
      if (error) throw error
      return (data as PrintSettings | null) ?? DEFAULT_SETTINGS
    },
  })
  const value = useMemo(() => service ? { service, simulator, settings: q.data ?? DEFAULT_SETTINGS, settingsLoaded: q.isSuccess, reload: () => qc.invalidateQueries({ queryKey: ['print-settings'] }) } : null,
    [service, simulator, q.data, q.isSuccess, qc])
  return <PrintContext.Provider value={value}>{children}</PrintContext.Provider>
}

export function usePrint(): Ctx {
  const c = useContext(PrintContext)
  if (!c) throw new Error('usePrint phải nằm trong PrintProvider')
  return c
}
