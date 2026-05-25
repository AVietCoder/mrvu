-- ============================================================
-- SQL CẬP NHẬT - Chạy trong Supabase SQL Editor
-- ============================================================

-- 1. Thêm cột image_url cho products (nếu chưa có)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- 2. Thêm cột total_buy cho customers (nếu chưa có)
--    Lưu tổng tiền các đơn hoàn thành của khách hàng
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_buy NUMERIC DEFAULT 0;

-- 3. Bảng site_settings (key-value) nếu chưa có
CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- 4. Bảng activity_logs nếu chưa có
CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  action      TEXT NOT NULL DEFAULT 'unknown',
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Xong! Kiểm tra trong Supabase Dashboard > Table Editor
-- ============================================================
