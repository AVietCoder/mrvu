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

/**
 * fetchRows: KHÔNG dùng cho bảng > 1000 dòng.
 * Mặc định Supabase chỉ trả tối đa 1000 hàng. Nếu bảng có thể vượt
 * ngưỡng đó (orders, order_items, customers, cash_vouchers...), hãy
 * dùng `fetchAllRows` để tự động phân trang qua range().
 */
export async function fetchRows<T = any>(table: string, options?: QueryOptions): Promise<T[]> {
  let query = supabase.from(table).select(options?.select ?? "*");
  query = applyFilters(query, options);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/**
 * Lấy TOÀN BỘ dữ liệu từ một bảng, vượt qua giới hạn 1000 rows của Supabase
 * bằng cách phân trang theo .range(). Dùng cho mọi bảng có thể vượt 1000 dòng:
 * customers, orders, order_items, cash_vouchers, schedules...
 */
export async function fetchAllRows<T = any>(
  table: string,
  options?: Omit<QueryOptions, "limit">,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(options?.select ?? "*")
      .range(from, from + PAGE - 1);

    if (options?.eq) {
      for (const [col, val] of Object.entries(options.eq)) {
        if (Array.isArray(val)) {
          query = query.in(col, val as any);
        } else if (val === null) {
          query = query.is(col, null);
        } else {
          query = query.eq(col, val as any);
        }
      }
    }
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
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

/**
 * Đếm + tính tổng (sum) một cột số trên TOÀN BỘ bảng, có filter,
 * không bị giới hạn 1000 dòng. Trả về { count, sum, positiveCount }.
 * positiveCount = số dòng có column > 0 (ví dụ để đếm khách còn nợ).
 */
export async function aggregateColumn(
  table: string,
  column: string,
  options?: QueryOptions,
): Promise<{ count: number; sum: number; positiveCount: number }> {
  const PAGE = 1000;
  let from = 0;
  let sum = 0;
  let count = 0;
  let positiveCount = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(column)
      .range(from, from + PAGE - 1);
    query = applyFilters(query, { ...options, select: undefined });
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows as any[]) {
      const v = Number(r[column] ?? 0);
      sum += v;
      count += 1;
      if (v > 0) positiveCount += 1;
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return { count, sum, positiveCount };
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
  const query = supabase.from(table).upsert(row, onConflict ? { onConflict } : undefined).select("*").single();
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
