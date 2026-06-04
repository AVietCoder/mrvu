// Turso (libsql) client for server-side use.
// Re-exports the shim from src/lib/supabase.ts so existing imports
// using { supabase } keep working server-side.
export { supabase } from "../lib/supabase";
