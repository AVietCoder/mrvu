-- ============================================================
-- SQL CẬP NHẬT V2 - CHẠY TỪNG BƯỚC TRONG SUPABASE SQL EDITOR
-- ============================================================

-- BƯỚC 1: Bật extension pg_trgm trước (BẮT BUỘC chạy trước)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- BƯỚC 2: Indexes cơ bản (không cần pg_trgm)
-- ============================================================

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id    ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id      ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_employee_id    ON orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status  ON orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_name        ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone       ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_group_name  ON customers(group_name);
CREATE INDEX IF NOT EXISTS idx_customers_debt        ON customers(debt DESC);
CREATE INDEX IF NOT EXISTS idx_customers_created_at  ON customers(created_at DESC);

-- products
CREATE INDEX IF NOT EXISTS idx_products_name         ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category_id  ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand_id     ON products(brand_id);

-- stock
CREATE INDEX IF NOT EXISTS idx_stock_product_id      ON stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_branch_id       ON stock(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_product_branch  ON stock(product_id, branch_id);

-- stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_id  ON stock_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type       ON stock_movements(type);

-- cash_vouchers
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_branch_id   ON cash_vouchers(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_type        ON cash_vouchers(type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_created_at  ON cash_vouchers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_order_id    ON cash_vouchers(order_id);

-- schedules
CREATE INDEX IF NOT EXISTS idx_schedules_date        ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_employee_id ON schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_branch_id   ON schedules(branch_id);

-- activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at  ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_employee_id ON activity_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action      ON activity_logs(action);

-- ============================================================
-- BƯỚC 3: Indexes trig­ram (cần pg_trgm ở Bước 1)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm  ON customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin(phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm   ON products  USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm    ON products  USING gin(sku  gin_trgm_ops);

-- ============================================================
-- BƯỚC 4: Schema updates
-- ============================================================

-- Bảng site_settings (key-value)
CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Cột image_url cho products
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- Đảm bảo activity_logs có đủ cột
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS action      TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS detail      TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- Xong! Kiểm tra: Supabase Dashboard > Database > Indexes
-- ============================================================
