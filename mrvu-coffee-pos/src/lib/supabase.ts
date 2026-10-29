import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_CAFE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_CAFE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'))

// Chỉ dùng anon key. Quyền thật được bảo vệ bởi RLS trong PostgreSQL.
export const supabase = createClient(
  isSupabaseConfigured ? url! : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
