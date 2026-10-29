import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Ingredient { id: string; name: string; unit: string; min_stock: number; current_stock: number; supplier_id: string | null; is_active: boolean }
export interface Supplier { id: string; name: string; phone: string; address: string; note: string; is_active: boolean }

const num = (v: unknown) => Number(v)

export function useIngredients(storeId: string) {
  return useQuery({
    queryKey: ['ingredients', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ingredients').select('id, name, unit, min_stock, current_stock, supplier_id, is_active').eq('store_id', storeId).order('name')
      if (error) throw error
      return (data as Ingredient[]).map((i) => ({ ...i, min_stock: num(i.min_stock), current_stock: num(i.current_stock) }))
    },
  })
}

export function useSuppliers(storeId: string) {
  return useQuery({
    queryKey: ['suppliers', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id, name, phone, address, note, is_active').eq('store_id', storeId).order('name')
      if (error) throw error
      return data as Supplier[]
    },
  })
}
