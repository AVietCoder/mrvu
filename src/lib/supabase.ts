import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl = requireEnv("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = requireEnv("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

type FilterValue = string | number | boolean | null | readonly (string | number | boolean)[];

type QueryOptions = {
  select?: string;
  eq?: Record<string, FilterValue>;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
};

function applyFilters(query: any, options?: QueryOptions) {
  if (!options) return query;
  if (options.eq) {
    for (const [column, value] of Object.entries(options.eq)) {
      if (Array.isArray(value)) {
        query = query.in(column, value as any);
      } else if (value === null) {
        query = query.is(column, null);
      } else {
        query = query.eq(column, value as any);
      }
    }
  }
  if (options.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? true });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  return query;
}

export async function fetchRows<T = any>(table: string, options?: QueryOptions): Promise<T[]> {
  let query = supabase.from(table).select(options?.select ?? "*");
  query = applyFilters(query, options);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function fetchRow<T = any>(table: string, options?: QueryOptions): Promise<T | null> {
  const rows = await fetchRows<T>(table, { ...options, limit: 1 });
  return rows[0] ?? null;
}

export async function countRows(table: string, options?: QueryOptions): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  query = applyFilters(query, options);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function insertRow<T = any>(table: string, row: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data as T;
}

export async function updateWhere(
  table: string,
  values: Record<string, any>,
  eq: Record<string, FilterValue>,
) {
  let query = supabase.from(table).update(values);
  query = applyFilters(query, { eq });
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function deleteWhere(table: string, eq: Record<string, FilterValue>) {
  let query = supabase.from(table).delete();
  query = applyFilters(query, { eq });
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function upsertRow<T = any>(
  table: string,
  row: Record<string, any>,
  onConflict?: string,
): Promise<T> {
  let query = supabase.from(table).upsert(row, onConflict ? { onConflict } : undefined).select("*").single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

export async function upsertRows<T = any>(
  table: string,
  rows: Record<string, any>[],
  onConflict?: string,
): Promise<T[]> {
  const { data, error } = await supabase.from(table).upsert(rows, onConflict ? { onConflict } : undefined).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
