/**
 * json-to-sqlite.mjs
 * Chuyển database.json → database.sqlite
 *
 * ── Cách dùng ──────────────────────────────────────────────────────────────
 *
 *  Cài better-sqlite3 (khuyên dùng, nhanh hơn):
 *    npm install better-sqlite3
 *    node json-to-sqlite.mjs
 *
 *  Hoặc nếu better-sqlite3 không build được (môi trường hạn chế):
 *    npm install sql.js
 *    node json-to-sqlite.mjs --sqljs
 *
 * ── Tuỳ chỉnh ──────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

const JSON_PATH   = "./database.json";
const SQLITE_PATH = "./database.sqlite";
const USE_SQLJS   = process.argv.includes("--sqljs");

// ─── Thứ tự insert để không vi phạm FK ───────────────────────────────────────
const INSERT_ORDER = [
  "brands",
  "categories",
  "branches",
  "work_difficulties",
  "work_types",
  "site_settings",
  "cash_voucher_types",
  "products",
  "users",
  "user_branches",
  "user_permissions",
  "user_activity_logs",
  "employees",
  "customers",
  "orders",
  "order_items",
  "stock",
  "stock_movements",
  "stock_transfers",
  "stock_transfer_items",
  "cash_vouchers",
  "schedules",
  "schedule_assignments",
  "schedule_difficulties",
  "tech_fees",
  "activity_logs",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Chuẩn hoá giá trị: boolean → 0/1 | object/array → JSON string */
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean")        return v ? 1 : 0;
  if (typeof v === "object")         return JSON.stringify(v);
  return v;
}

/** Lấy union tất cả columns của một mảng rows (an toàn khi rows sparse) */
function getColumns(rows) {
  const set = new Set();
  for (const row of rows) Object.keys(row).forEach((k) => set.add(k));
  return [...set];
}

// ─── Driver: better-sqlite3 ───────────────────────────────────────────────────
async function runWithBetterSqlite3(data) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(SQLITE_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous  = OFF");
  db.pragma("foreign_keys = OFF");

  let totalRows = 0;

  for (const table of INSERT_ORDER) {
    const rows = data[table];
    if (!rows?.length) { console.log(`  ⏭  ${table}: 0 rows`); continue; }

    const cols  = getColumns(rows);
    const sql   = `INSERT OR REPLACE INTO "${table}" (${cols.join(", ")})
                   VALUES (${cols.map(() => "?").join(", ")})`;
    const stmt  = db.prepare(sql);

    db.transaction((list) => {
      for (const row of list) stmt.run(cols.map((c) => normalizeValue(row[c])));
    })(rows);

    totalRows += rows.length;
    console.log(`  ✅ ${table}: ${rows.length.toLocaleString()} rows`);
  }

  db.pragma("foreign_keys = ON");
  db.close();
  return totalRows;
}

// ─── Driver: sql.js (pure JS, không cần build) ────────────────────────────────
async function runWithSqlJs(data) {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();

  // Nếu file đã tồn tại thì đọc lại, ngược lại tạo mới
  const db = existsSync(SQLITE_PATH)
    ? new SQL.Database(readFileSync(SQLITE_PATH))
    : new SQL.Database();

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous  = OFF");
  db.run("PRAGMA foreign_keys = OFF");

  let totalRows = 0;

  for (const table of INSERT_ORDER) {
    const rows = data[table];
    if (!rows?.length) { console.log(`  ⏭  ${table}: 0 rows`); continue; }

    const cols = getColumns(rows);
    const sql  = `INSERT OR REPLACE INTO "${table}" (${cols.join(", ")})
                  VALUES (${cols.map(() => "?").join(", ")})`;
    const stmt = db.prepare(sql);

    db.run("BEGIN");
    for (const row of rows) {
      stmt.run(cols.map((c) => normalizeValue(row[c])));
    }
    db.run("COMMIT");
    stmt.free();

    totalRows += rows.length;
    console.log(`  ✅ ${table}: ${rows.length.toLocaleString()} rows`);
  }

  db.run("PRAGMA foreign_keys = ON");

  // sql.js không ghi file tự động — phải export thủ công
  const buffer = db.export();
  writeFileSync(SQLITE_PATH, Buffer.from(buffer));
  db.close();
  return totalRows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`📂 Đọc ${JSON_PATH} ...`);
const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
console.log(`   ${Object.keys(data).length} bảng, bắt đầu import...\n`);

const driver = USE_SQLJS ? "sql.js" : "better-sqlite3";
console.log(`🔧 Driver: ${driver}\n`);

try {
  const totalRows = USE_SQLJS
    ? await runWithSqlJs(data)
    : await runWithBetterSqlite3(data);

  console.log(`\n🎉 Xong! ${totalRows.toLocaleString()} rows → ${SQLITE_PATH}`);
} catch (err) {
  if (!USE_SQLJS && err.code === "ERR_MODULE_NOT_FOUND") {
    console.error("❌ Không tìm thấy better-sqlite3.");
    console.error("   Chạy: npm install better-sqlite3");
    console.error("   Hoặc dùng sql.js: node json-to-sqlite.mjs --sqljs");
  } else {
    throw err;
  }
}
