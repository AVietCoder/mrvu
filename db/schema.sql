-- =====================================================================
-- QuatTran POS - Database schema (PostgreSQL)
-- Chạy file này 1 lần trên Vercel Postgres / Postgres bất kỳ.
-- =====================================================================

CREATE TABLE IF NOT EXISTS branches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  brand       TEXT,
  power       TEXT,            -- công suất (W)
  color       TEXT,
  blade_size  TEXT,            -- size cánh (inch / mm)
  image_url   TEXT,
  description TEXT,
  cost_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_stock   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- tồn kho theo (product, branch)
CREATE TABLE IF NOT EXISTS stock (
  product_id  TEXT REFERENCES products(id) ON DELETE CASCADE,
  branch_id   TEXT REFERENCES branches(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, branch_id)
);

-- nhập kho / xuất kho / chuyển kho
CREATE TABLE IF NOT EXISTS stock_movements (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,                -- 'in' | 'out' | 'transfer'
  product_id  TEXT REFERENCES products(id),
  from_branch TEXT REFERENCES branches(id),
  to_branch   TEXT REFERENCES branches(id),
  qty         INTEGER NOT NULL,
  unit_cost   NUMERIC(14,2) DEFAULT 0,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  group_name  TEXT,             -- 'le' | 'dai_ly' | 'vip' | 'cong_trinh'
  debt        NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  role        TEXT NOT NULL,    -- 'admin' | 'manager' | 'cashier' | 'warehouse'
  branch_id   TEXT REFERENCES branches(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  branch_id   TEXT REFERENCES branches(id),
  employee_id TEXT REFERENCES employees(id),
  status      TEXT NOT NULL,       -- 'draft' | 'reserved' | 'completed' | 'cancelled'
  subtotal    NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid        NUMERIC(14,2) NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT REFERENCES products(id),
  qty         INTEGER NOT NULL,
  unit_price  NUMERIC(14,2) NOT NULL,
  discount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total       NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  employee_id TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at DESC);
