-- ============================================================
-- SQL CẬP NHẬT V3 - Dựa đúng theo schema thực tế
-- Chạy toàn bộ 1 lần trong Supabase SQL Editor
-- ============================================================

-- BƯỚC 1: Bật pg_trgm (BẮT BUỘC chạy trước các index trigram)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- BƯỚC 2: Indexes tăng tốc tìm kiếm / lọc
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

-- stock (PK đã là (product_id, branch_id) — không cần index thêm)
CREATE INDEX IF NOT EXISTS idx_stock_branch_id       ON stock(branch_id);

-- stock_movements (dùng from_branch / to_branch, không có branch_id)
CREATE INDEX IF NOT EXISTS idx_stock_mv_product_id   ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_mv_from_branch  ON stock_movements(from_branch);
CREATE INDEX IF NOT EXISTS idx_stock_mv_to_branch    ON stock_movements(to_branch);
CREATE INDEX IF NOT EXISTS idx_stock_mv_created_at   ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_mv_type         ON stock_movements(type);

-- activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_empid   ON activity_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action  ON activity_logs(action);

-- ============================================================
-- BƯỚC 3: Indexes trigram (tìm kiếm LIKE/ILIKE nhanh hơn)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm   ON customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm  ON customers USING gin(phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm    ON products  USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm     ON products  USING gin(sku  gin_trgm_ops);

-- ============================================================
-- BƯỚC 4: Cập nhật schema
-- ============================================================

-- Bảng site_settings (key-value cho cài đặt hệ thống)
CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- image_url đã có trong schema gốc — không cần ALTER
-- Chỉ đảm bảo cột tồn tại (an toàn nếu chạy lại)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- activity_logs: các cột đã có trong schema gốc
-- Chỉ đảm bảo an toàn nếu DB cũ thiếu cột
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS detail      TEXT;

-- customers: thêm cột ward/province/district nếu chưa có
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ward     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS province TEXT;

-- ============================================================
-- Xong! Vào Supabase Dashboard > Database > Indexes để kiểm tra
-- ============================================================
