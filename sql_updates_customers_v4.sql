-- ============================================================
-- SQL CẬP NHẬT KHÁCH HÀNG V4 — Thêm trường thông tin mở rộng
-- Chạy trong Supabase SQL Editor
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender        TEXT;         -- 'nam' | 'nu' | ''
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday      DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_code      TEXT;         -- Mã số thuế
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cccd          TEXT;         -- Số CCCD/CMND
ALTER TABLE customers ADD COLUMN IF NOT EXISTS passport_no   TEXT;         -- Số hộ chiếu
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name  TEXT;         -- Tên công ty / tổ chức
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'ca_nhan';  -- 'ca_nhan' | 'to_chuc'
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_name     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account  TEXT;         -- Số tài khoản ngân hàng
ALTER TABLE customers ADD COLUMN IF NOT EXISTS note          TEXT;         -- Ghi chú
