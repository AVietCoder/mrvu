// @ts-nocheck
/**
 * Turso (libsql) compatibility layer.
 *
 * The codebase was originally written against Supabase JS. To minimize churn,
 * this module keeps the SAME exported API surface (fetchRows, fetchAllRows,
 * fetchRow, insertRow, updateWhere, deleteWhere, upsertRow, upsertRows,
 * countRows, aggregateColumn, logActivity, uid, now) AND exposes a `supabase`
 * shim that mimics the chainable query-builder + `.rpc()` calls the rest of
 * the app uses (.from().select/insert/update/upsert/delete/eq/in/is/order/limit/range/single).
 *
 * Underneath everything runs against a Turso (libsql) database.
 *
 * Required env (server-side):
 *   TURSO_DATABASE_URL   e.g. libsql://your-db-xxx.turso.io
 *   TURSO_AUTH_TOKEN     Turso auth token
 */

import { createClient, type Client, type InValue } from "@libsql/client/web";

// ─── Client (lazy singleton) ──────────────────────────────────────────────
let _client: Client | null = null;
function db(): Client {
  if (_client) return _client;
  const url =
    process.env.TURSO_DATABASE_URL ||
    process.env.VITE_TURSO_DATABASE_URL ||
    (typeof import.meta !== "undefined" ? (import.meta as any).env?.VITE_TURSO_DATABASE_URL : undefined);
  const authToken =
    process.env.TURSO_AUTH_TOKEN ||
    process.env.VITE_TURSO_AUTH_TOKEN ||
    (typeof import.meta !== "undefined" ? (import.meta as any).env?.VITE_TURSO_AUTH_TOKEN : undefined);
  if (!url) throw new Error("Missing TURSO_DATABASE_URL");
  _client = createClient({ url, authToken });
  return _client;
}

// ─── Small helpers ────────────────────────────────────────────────────────
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

function ident(name: string): string {
  // basic identifier sanitization for table/column names
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

function toParam(v: any): InValue {
  if (v === undefined) return null as any;
  if (v === null) return null as any;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return v as any;
}

function rowsOf(rs: any): any[] {
  return (rs?.rows ?? []) as any[];
}

async function run(sql: string, args: any[] = []): Promise<any[]> {
  const rs = await db().execute({ sql, args: args.map(toParam) });
  return rowsOf(rs);
}

// ─── Public helper API (kept for backward compatibility) ──────────────────
type FilterValue = string | number | boolean | null | readonly (string | number | boolean)[];

type QueryOptions = {
  select?: string;
  eq?: Record<string, FilterValue>;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
};

function buildWhere(eq?: Record<string, FilterValue>): { sql: string; args: any[] } {
  if (!eq) return { sql: "", args: [] };
  const parts: string[] = [];
  const args: any[] = [];
  for (const [col, val] of Object.entries(eq)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        parts.push("0=1");
        continue;
      }
      parts.push(`${ident(col)} IN (${val.map(() => "?").join(",")})`);
      args.push(...val);
    } else if (val === null) {
      parts.push(`${ident(col)} IS NULL`);
    } else {
      parts.push(`${ident(col)} = ?`);
      args.push(val);
    }
  }
  return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", args };
}

function selectExpr(sel?: string): string {
  if (!sel || sel === "*") return "*";
  // accept comma-separated list of identifiers (and "*" or "col as alias")
  return sel;
}

export async function fetchRows<T = any>(table: string, options?: QueryOptions): Promise<T[]> {
  const where = buildWhere(options?.eq);
  let sql = `SELECT ${selectExpr(options?.select)} FROM ${ident(table)}${where.sql}`;
  if (options?.orderBy) {
    sql += ` ORDER BY ${ident(options.orderBy)} ${options.ascending === false ? "DESC" : "ASC"}`;
  }
  if (options?.limit) sql += ` LIMIT ${Math.max(0, options.limit | 0)}`;
  return (await run(sql, where.args)) as T[];
}

export async function fetchAllRows<T = any>(
  table: string,
  options?: Omit<QueryOptions, "limit">,
): Promise<T[]> {
  // libsql/Turso has no 1000-row cap. Single query is fine.
  return fetchRows<T>(table, options as any);
}

export async function fetchRow<T = any>(table: string, options?: QueryOptions): Promise<T | null> {
  const rows = await fetchRows<T>(table, { ...options, limit: 1 });
  return rows[0] ?? null;
}

export async function countRows(table: string, options?: QueryOptions): Promise<number> {
  const where = buildWhere(options?.eq);
  const sql = `SELECT COUNT(*) AS n FROM ${ident(table)}${where.sql}`;
  const rows = await run(sql, where.args);
  return Number(rows[0]?.n ?? 0);
}

export async function aggregateColumn(
  table: string,
  column: string,
  options?: QueryOptions,
): Promise<{ count: number; sum: number; positiveCount: number }> {
  const where = buildWhere(options?.eq);
  const sql =
    `SELECT COUNT(*) AS c, COALESCE(SUM(${ident(column)}),0) AS s, ` +
    `SUM(CASE WHEN ${ident(column)} > 0 THEN 1 ELSE 0 END) AS p FROM ${ident(table)}${where.sql}`;
  const rows = await run(sql, where.args);
  const r = rows[0] ?? {};
  return { count: Number(r.c ?? 0), sum: Number(r.s ?? 0), positiveCount: Number(r.p ?? 0) };
}

function insertSql(table: string, row: Record<string, any>): { sql: string; args: any[] } {
  const cols = Object.keys(row);
  if (cols.length === 0) throw new Error("insert: empty row");
  const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  return { sql, args: cols.map((c) => row[c]) };
}

export async function insertRow<T = any>(table: string, row: Record<string, any>): Promise<T> {
  const { sql, args } = insertSql(table, row);
  await run(`${sql} RETURNING *`, args).catch(async (e) => {
    // fallback if RETURNING not supported on some driver versions
    await run(sql, args);
    return [];
  });
  // Re-fetch by id if present (most tables have a string id)
  if ("id" in row && row.id != null) {
    const r = await run(`SELECT * FROM ${ident(table)} WHERE "id" = ? LIMIT 1`, [row.id]);
    return (r[0] ?? row) as T;
  }
  return row as T;
}

export async function updateWhere(
  table: string,
  values: Record<string, any>,
  eq: Record<string, FilterValue>,
) {
  const cols = Object.keys(values);
  if (cols.length === 0) return;
  const sets = cols.map((c) => `${ident(c)} = ?`).join(", ");
  const args = cols.map((c) => values[c]);
  const where = buildWhere(eq);
  await run(`UPDATE ${ident(table)} SET ${sets}${where.sql}`, [...args, ...where.args]);
}

export async function deleteWhere(table: string, eq: Record<string, FilterValue>) {
  const where = buildWhere(eq);
  if (!where.sql) throw new Error("deleteWhere: refusing to delete without filter");
  await run(`DELETE FROM ${ident(table)}${where.sql}`, where.args);
}

function upsertSql(
  table: string,
  row: Record<string, any>,
  onConflict?: string,
): { sql: string; args: any[] } {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(",");
  let sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(",")}) VALUES (${placeholders})`;
  if (onConflict) {
    const conflictCols = onConflict.split(",").map((s) => ident(s.trim())).join(",");
    const updates = cols
      .filter((c) => !onConflict.split(",").map((s) => s.trim()).includes(c))
      .map((c) => `${ident(c)} = excluded.${ident(c)}`)
      .join(", ");
    sql += ` ON CONFLICT(${conflictCols}) DO UPDATE SET ${updates || `${ident(cols[0])} = excluded.${ident(cols[0])}`}`;
  } else {
    sql += ` ON CONFLICT DO UPDATE SET ` +
      cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
  }
  return { sql, args: cols.map((c) => row[c]) };
}

export async function upsertRow<T = any>(
  table: string,
  row: Record<string, any>,
  onConflict?: string,
): Promise<T> {
  const { sql, args } = upsertSql(table, row, onConflict);
  await run(sql, args);
  if ("id" in row && row.id != null) {
    const r = await run(`SELECT * FROM ${ident(table)} WHERE "id" = ? LIMIT 1`, [row.id]);
    return (r[0] ?? row) as T;
  }
  return row as T;
}

export async function upsertRows<T = any>(
  table: string,
  rows: Record<string, any>[],
  onConflict?: string,
): Promise<T[]> {
  if (!rows.length) return [];
  // Run as a transaction batch
  const stmts = rows.map((row) => {
    const { sql, args } = upsertSql(table, row, onConflict);
    return { sql, args: args.map(toParam) };
  });
  await db().batch(stmts as any, "write");
  return rows as T[];
}

export async function logActivity(params: {
  action: string;
  detail?: string;
  employee_id?: string | null;
}): Promise<void> {
  try {
    await insertRow("activity_logs", {
      id: uid(),
      employee_id: params.employee_id ?? null,
      action: params.action,
      detail: params.detail ?? null,
      created_at: now(),
    });
  } catch {
    /* swallow */
  }
}

// ─── Supabase-style chainable query-builder shim ──────────────────────────
class TableQuery {
  private table: string;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private _select = "*";
  private _selectOpts: { count?: string; head?: boolean } | undefined;
  private _eq: Array<{ col: string; val: any }> = [];
  private _in: Array<{ col: string; vals: any[] }> = [];
  private _is: Array<{ col: string; val: any }> = [];
  private _order?: { col: string; ascending: boolean };
  private _limit?: number;
  private _range?: { from: number; to: number };
  private _single = false;
  private _payload: any = null;
  private _onConflict?: string;
  private _afterSelect = false; // .insert().select("*")

  constructor(table: string) {
    this.table = table;
  }

  select(cols: string = "*", opts?: { count?: string; head?: boolean }) {
    this._select = cols;
    this._selectOpts = opts;
    if (this.mode !== "select" && (this.mode === "insert" || this.mode === "upsert")) {
      this._afterSelect = true;
    }
    return this;
  }

  insert(payload: any) {
    this.mode = "insert";
    this._payload = payload;
    return this;
  }

  update(values: any) {
    this.mode = "update";
    this._payload = values;
    return this;
  }

  upsert(payload: any, opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this._payload = payload;
    this._onConflict = opts?.onConflict;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(col: string, val: any) {
    this._eq.push({ col, val });
    return this;
  }

  in(col: string, vals: any[]) {
    this._in.push({ col, vals });
    return this;
  }

  is(col: string, val: any) {
    this._is.push({ col, val });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this._order = { col, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(n: number) {
    this._limit = n;
    return this;
  }

  range(from: number, to: number) {
    this._range = { from, to };
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  private buildWhereSql(): { sql: string; args: any[] } {
    const parts: string[] = [];
    const args: any[] = [];
    for (const f of this._eq) {
      if (f.val === null) {
        parts.push(`${ident(f.col)} IS NULL`);
      } else {
        parts.push(`${ident(f.col)} = ?`);
        args.push(f.val);
      }
    }
    for (const f of this._in) {
      if (f.vals.length === 0) {
        parts.push("0=1");
      } else {
        parts.push(`${ident(f.col)} IN (${f.vals.map(() => "?").join(",")})`);
        args.push(...f.vals);
      }
    }
    for (const f of this._is) {
      parts.push(`${ident(f.col)} IS ${f.val === null ? "NULL" : "NOT NULL"}`);
    }
    return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", args };
  }

  private async execSelect() {
    const where = this.buildWhereSql();
    if (this._selectOpts?.count === "exact" && this._selectOpts?.head) {
      const sql = `SELECT COUNT(*) AS n FROM ${ident(this.table)}${where.sql}`;
      const rows = await run(sql, where.args);
      return { data: null, error: null, count: Number(rows[0]?.n ?? 0) };
    }
    let sql = `SELECT ${selectExpr(this._select)} FROM ${ident(this.table)}${where.sql}`;
    if (this._order) {
      sql += ` ORDER BY ${ident(this._order.col)} ${this._order.ascending ? "ASC" : "DESC"}`;
    }
    if (this._range) {
      const lim = Math.max(0, this._range.to - this._range.from + 1);
      sql += ` LIMIT ${lim} OFFSET ${Math.max(0, this._range.from)}`;
    } else if (this._limit != null) {
      sql += ` LIMIT ${Math.max(0, this._limit | 0)}`;
    }
    const rows = await run(sql, where.args);
    if (this._single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  private async execInsertOrUpsert(): Promise<any> {
    const payload = Array.isArray(this._payload) ? this._payload : [this._payload];
    if (payload.length === 0) return { data: [], error: null };
    if (this.mode === "upsert") {
      const stmts = payload.map((row: any) => {
        const { sql, args } = upsertSql(this.table, row, this._onConflict);
        return { sql, args: args.map(toParam) };
      });
      try {
        await db().batch(stmts as any, "write");
      } catch (e: any) {
        return { data: null, error: { message: e?.message ?? String(e) } };
      }
    } else {
      const stmts = payload.map((row: any) => {
        const { sql, args } = insertSql(this.table, row);
        return { sql, args: args.map(toParam) };
      });
      try {
        await db().batch(stmts as any, "write");
      } catch (e: any) {
        return { data: null, error: { message: e?.message ?? String(e) } };
      }
    }
    if (!this._afterSelect) return { data: null, error: null };
    // After .select("*") - return inserted rows by id
    const ids = payload.map((r: any) => r.id).filter((x: any) => x != null);
    if (ids.length === 0) return { data: payload, error: null };
    const rows = await run(
      `SELECT * FROM ${ident(this.table)} WHERE "id" IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    if (this._single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  private async execUpdate() {
    const cols = Object.keys(this._payload);
    if (cols.length === 0) return { data: null, error: null };
    const sets = cols.map((c) => `${ident(c)} = ?`).join(", ");
    const args = cols.map((c) => this._payload[c]);
    const where = this.buildWhereSql();
    try {
      await run(`UPDATE ${ident(this.table)} SET ${sets}${where.sql}`, [...args, ...where.args]);
      return { data: null, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  }

  private async execDelete() {
    const where = this.buildWhereSql();
    try {
      await run(`DELETE FROM ${ident(this.table)}${where.sql}`, where.args);
      return { data: null, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  }

  private async exec(): Promise<any> {
    try {
      if (this.mode === "select") return await this.execSelect();
      if (this.mode === "insert" || this.mode === "upsert") return await this.execInsertOrUpsert();
      if (this.mode === "update") return await this.execUpdate();
      if (this.mode === "delete") return await this.execDelete();
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  }

  // make awaitable
  then(onFulfilled: any, onRejected?: any) {
    return this.exec().then(onFulfilled, onRejected);
  }
  catch(onRejected: any) {
    return this.exec().catch(onRejected);
  }
}

// ─── RPC implementations (translated from the original Postgres functions) ─
async function rpc_search_customers_page(p: any) {
  const search = p?.p_search ? String(p.p_search).trim() : "";
  const group = p?.p_group || null;
  const debt = p?.p_debt_filter || "all";
  const sort = p?.p_sort || "date";
  const limit = Math.max(1, Number(p?.p_limit ?? 20));
  const offset = Math.max(0, Number(p?.p_offset ?? 0));

  // Pull aggregates per customer, then filter/sort/paginate in JS for correctness.
  const whereParts: string[] = [];
  const whereArgs: any[] = [];
  if (search) {
    whereParts.push(
      "(LOWER(c.name) LIKE ? OR LOWER(c.phone) LIKE ? OR LOWER(c.email) LIKE ?)",
    );
    const s = `%${search.toLowerCase()}%`;
    whereArgs.push(s, s, s);
  }
  if (group) {
    whereParts.push("c.group_name = ?");
    whereArgs.push(group);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const sql = `
    SELECT
      c.id, c.name, c.phone, c.email, c.address, c.ward, c.district, c.province,
      c.group_name, c.customer_type, c.company_name,
      c.debt,
      COALESCE(c.debt_adjustment, 0) AS debt_adjustment,
      COALESCE((SELECT SUM(o.total) FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'completed'), 0) AS total_buy,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.payer_customer_id = c.id AND v.type = 'thu'
                  AND (v.status IS NULL OR v.status <> 'cancelled')), 0) AS total_paid,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.receiver_customer_id = c.id AND v.type = 'chi'
                  AND (v.status IS NULL OR v.status <> 'cancelled')), 0) AS total_paid_back,
      c.created_at
    FROM customers c
    ${whereSql}
  `;
  const rows = await run(sql, whereArgs);
  for (const r of rows as any[]) {
    r.computed_debt = Number(r.total_buy) - Number(r.total_paid) + Number(r.total_paid_back);
    r.display_debt = r.computed_debt + Number(r.debt_adjustment || 0);
  }
  let filtered = rows;
  if (debt === "debt") filtered = filtered.filter((r: any) => r.display_debt > 0);
  else if (debt === "no_debt") filtered = filtered.filter((r: any) => r.display_debt <= 0);

  const cmp = (a: any, b: any) => {
    switch (sort) {
      case "name":
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      case "debt_desc":
        return Number(b.display_debt) - Number(a.display_debt);
      case "debt_asc":
        return Number(a.display_debt) - Number(b.display_debt);
      case "total_buy_desc":
        return Number(b.total_buy) - Number(a.total_buy);
      case "total_buy_asc":
        return Number(a.total_buy) - Number(b.total_buy);
      default:
        return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    }
  };
  filtered.sort(cmp);
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  return page.map((r: any) => ({ ...r, filtered_count: total }));
}

async function rpc_customer_stats() {
  const rows = await run(`
    SELECT
      c.id,
      COALESCE(c.debt_adjustment, 0) AS adj,
      COALESCE((SELECT SUM(o.total) FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'completed'), 0) AS total_buy,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.payer_customer_id = c.id AND v.type='thu'
                  AND (v.status IS NULL OR v.status <> 'cancelled')), 0) AS total_paid,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.receiver_customer_id = c.id AND v.type='chi'
                  AND (v.status IS NULL OR v.status <> 'cancelled')), 0) AS total_paid_back
    FROM customers c
  `);
  let totalAll = 0;
  let totalDebt = 0;
  let debtorCount = 0;
  let totalSales = 0;
  for (const r of rows as any[]) {
    totalAll += 1;
    const buy = Number(r.total_buy);
    const display = buy - Number(r.total_paid) + Number(r.total_paid_back) + Number(r.adj);
    totalSales += buy;
    if (display > 0) {
      totalDebt += display;
      debtorCount += 1;
    }
  }
  return [
    {
      total_all_customers: totalAll,
      total_all_debt: totalDebt,
      total_debtor_count: debtorCount,
      total_sales: totalSales,
    },
  ];
}

async function rpc_search_orders_page(p: any) {
  // Variant used by orders.functions.ts (with p_tab + p_branch_ids)
  const search = p?.p_search ? String(p.p_search) : "";
  const status = p?.p_status || "";
  const branch = p?.p_branch || "";
  const tab = p?.p_tab || "orders";
  const branchIds: string[] | null = Array.isArray(p?.p_branch_ids) ? p.p_branch_ids : null;
  const sort = p?.p_sort || "newest";
  const limit = Math.max(1, Number(p?.p_limit ?? 20));
  const offset = Math.max(0, Number(p?.p_offset ?? 0));

  const where: string[] = [];
  const args: any[] = [];
  if (branchIds && branchIds.length) {
    where.push(`o.branch_id IN (${branchIds.map(() => "?").join(",")})`);
    args.push(...branchIds);
  }
  if (tab === "reserved") {
    where.push("o.status = 'reserved'");
  } else {
    where.push("(o.status IS NULL OR o.status <> 'reserved')");
  }
  if (status) {
    where.push("o.status = ?");
    args.push(status);
  }
  if (branch) {
    where.push("o.branch_id = ?");
    args.push(branch);
  }
  if (search) {
    where.push("(LOWER(o.code) LIKE ? OR LOWER(c.name) LIKE ?)");
    const s = `%${search.toLowerCase()}%`;
    args.push(s, s);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Sorting
  let orderSql = "";
  switch (sort) {
    case "total_desc":
      orderSql = "ORDER BY o.total IS NULL, o.total DESC";
      break;
    case "total_asc":
      orderSql = "ORDER BY o.total IS NULL, o.total ASC";
      break;
    case "oldest":
      orderSql =
        "ORDER BY (CASE WHEN o.status='completed' AND o.completed_at IS NOT NULL THEN o.completed_at ELSE o.created_at END) ASC";
      break;
    default:
      orderSql =
        "ORDER BY (CASE WHEN o.status='completed' AND o.completed_at IS NOT NULL THEN o.completed_at ELSE o.created_at END) DESC";
  }

  const countRow = await run(
    `SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereSql}`,
    args,
  );
  const total = Number(countRow[0]?.n ?? 0);

  const rows = await run(
    `
    SELECT
      o.id, o.code, o.status, o.created_at, o.completed_at, o.total,
      o.customer_id,
      c.name AS customer_name,
      o.branch_id,
      b.name AS branch_name,
      (SELECT COUNT(*) FROM schedules s WHERE s.order_id = o.id) AS schedule_count
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN branches  b ON b.id = o.branch_id
    ${whereSql}
    ${orderSql}
    LIMIT ${limit} OFFSET ${offset}
    `,
    args,
  );
  return rows.map((r: any) => ({ ...r, filtered_count: total }));
}

async function rpc_orders_stats(p: any) {
  const branchIds: string[] | null = Array.isArray(p?.p_branch_ids) ? p.p_branch_ids : null;
  const where: string[] = [];
  const args: any[] = [];
  if (branchIds && branchIds.length) {
    where.push(`branch_id IN (${branchIds.map(() => "?").join(",")})`);
    args.push(...branchIds);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await run(
    `SELECT
       SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END) AS reserved_count,
       COUNT(*) AS total_orders
     FROM orders ${whereSql}`,
    args,
  );
  const r = rows[0] ?? {};
  return [
    {
      reserved_count: Number(r.reserved_count ?? 0),
      total_orders: Number(r.total_orders ?? 0),
    },
  ];
}

async function rpc_search_inventory_page(p: any) {
  const search = p?.p_search ? String(p.p_search) : "";
  const branch = p?.p_branch || "";
  const sort = p?.p_sort || "name";
  const limit = Math.max(1, Number(p?.p_limit ?? 20));
  const offset = Math.max(0, Number(p?.p_offset ?? 0));

  // Scope branches
  const scopeBranches = await run(
    branch
      ? `SELECT id, name FROM branches WHERE id = ? ORDER BY name`
      : `SELECT id, name FROM branches ORDER BY name`,
    branch ? [branch] : [],
  );

  const prodWhere: string[] = [];
  const prodArgs: any[] = [];
  if (search) {
    prodWhere.push("(LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)");
    const s = `%${search.toLowerCase()}%`;
    prodArgs.push(s, s);
  }
  const prodWhereSql = prodWhere.length ? `WHERE ${prodWhere.join(" AND ")}` : "";

  const countRow = await run(`SELECT COUNT(*) AS n FROM products ${prodWhereSql}`, prodArgs);
  const total = Number(countRow[0]?.n ?? 0);

  // Order on products
  let orderSql = "ORDER BY name ASC";
  switch (sort) {
    case "sku":
      orderSql = "ORDER BY sku ASC";
      break;
    case "stock_asc":
      // need total_stock per product within scope — compute after
      orderSql = "ORDER BY name ASC";
      break;
    case "name":
      orderSql = "ORDER BY name ASC";
      break;
  }

  const products = (await run(
    `SELECT id, sku, name, min_stock FROM products ${prodWhereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    prodArgs,
  )) as any[];

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const branchIds = (scopeBranches as any[]).map((b) => b.id);

  // Stock rows for this page
  const stockRows = branchIds.length
    ? ((await run(
        `SELECT product_id, branch_id, qty FROM stock
         WHERE product_id IN (${productIds.map(() => "?").join(",")})
           AND branch_id IN (${branchIds.map(() => "?").join(",")})`,
        [...productIds, ...branchIds],
      )) as any[])
    : [];

  // Pending order_items for this page (status reserved or draft)
  const branchFilter = branch
    ? `AND o.branch_id = ?`
    : "";
  const pendingRows = (await run(
    `SELECT oi.product_id, o.branch_id,
            SUM(oi.qty) AS qty,
            COUNT(DISTINCT o.id) AS order_count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id IN (${productIds.map(() => "?").join(",")})
        AND o.status IN ('reserved','draft')
        ${branchFilter}
      GROUP BY oi.product_id, o.branch_id`,
    branch ? [...productIds, branch] : [...productIds],
  )) as any[];

  // Build per-product result
  const stockByPB = new Map<string, number>();
  for (const r of stockRows) {
    stockByPB.set(`${r.product_id}|${r.branch_id}`, Number(r.qty ?? 0));
  }
  const pendByPB = new Map<string, { qty: number; orders: number }>();
  for (const r of pendingRows) {
    pendByPB.set(`${r.product_id}|${r.branch_id}`, {
      qty: Number(r.qty ?? 0),
      orders: Number(r.order_count ?? 0),
    });
  }

  const result = products.map((p) => {
    const branches = (scopeBranches as any[]).map((sb) => {
      const stk = stockByPB.get(`${p.id}|${sb.id}`) ?? 0;
      const pend = pendByPB.get(`${p.id}|${sb.id}`);
      return {
        branch_id: sb.id,
        branch_name: sb.name,
        stock: stk,
        pending_qty: pend?.qty ?? 0,
        pending_orders: pend?.orders ?? 0,
      };
    });
    const total_stock = branches.reduce((s, b) => s + Number(b.stock || 0), 0);
    const total_pending = branches.reduce((s, b) => s + Number(b.pending_qty || 0), 0);
    const total_pending_orders = branches.reduce((s, b) => s + Number(b.pending_orders || 0), 0);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      min_stock: p.min_stock,
      total_stock,
      total_pending,
      total_pending_orders,
      branches,
      filtered_count: total,
    };
  });

  if (sort === "stock_asc") {
    result.sort((a, b) => Number(a.total_stock) - Number(b.total_stock));
  }
  return result;
}

const RPC_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  search_customers_page: rpc_search_customers_page,
  customer_stats: rpc_customer_stats,
  search_orders_page: rpc_search_orders_page,
  orders_stats: rpc_orders_stats,
  search_inventory_page: rpc_search_inventory_page,
};

// ─── Public shim exposed as `supabase` ────────────────────────────────────
export const supabase = {
  from(table: string) {
    return new TableQuery(table);
  },
  async rpc(name: string, args?: any) {
    const handler = RPC_HANDLERS[name];
    if (!handler) {
      return { data: null, error: { message: `RPC not implemented in Turso shim: ${name}` } };
    }
    try {
      const data = await handler(args ?? {});
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  },
};
