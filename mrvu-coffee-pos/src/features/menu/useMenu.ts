import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Category, Menu, Modifier, Product } from '@/lib/types'

const num = (v: unknown) => Number(v ?? 0)

/** Tải toàn bộ thực đơn của cửa hàng (danh mục, món kèm biến thể, nhóm tùy chọn). */
export function useMenu(storeId: string) {
  return useQuery<Menu>({
    queryKey: ['menu', storeId],
    staleTime: 30_000,
    queryFn: async () => {
      const [cats, prods, mods] = await Promise.all([
        supabase.from('categories').select('id, name, sort_order, is_active').eq('store_id', storeId).order('sort_order').order('name'),
        supabase.from('products')
          .select('id, category_id, code, name, image_url, price, tax_rate, is_active, sort_order, product_variants(id, product_id, name, price, is_active, sort_order), product_modifiers(modifier_id)')
          .eq('store_id', storeId).order('sort_order').order('name'),
        supabase.from('modifiers')
          .select('id, name, min_select, max_select, sort_order, modifier_options(id, modifier_id, name, price_delta, is_active, sort_order)')
          .eq('store_id', storeId).order('sort_order').order('name'),
      ])
      if (cats.error) throw cats.error
      if (prods.error) throw prods.error
      if (mods.error) throw mods.error
      const products = (prods.data as unknown as Product[]).map((p) => ({
        ...p, price: num(p.price), tax_rate: num(p.tax_rate),
        product_variants: p.product_variants.map((v) => ({ ...v, price: num(v.price) })).sort((a, b) => a.sort_order - b.sort_order),
      }))
      const modifiers = (mods.data as unknown as Modifier[]).map((m) => ({
        ...m,
        modifier_options: m.modifier_options.map((o) => ({ ...o, price_delta: num(o.price_delta) })).sort((a, b) => a.sort_order - b.sort_order),
      }))
      return { categories: cats.data as Category[], products, modifiers }
    },
  })
}
