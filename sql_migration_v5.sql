-- ============================================================
-- SQL MIGRATION V5 — Thêm cột VAT & giảm giá cho orders
-- Thêm cột created_by cho customers
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- 1. Thêm các cột VAT và giảm giá vào bảng orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate      NUMERIC(6,4) DEFAULT 0;  -- VD: 0.08, 0.10
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_amount    BIGINT       DEFAULT 0;  -- Số tiền VAT (đã tính)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type TEXT         DEFAULT 'amount'; -- 'amount' | 'percent'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_pct  NUMERIC(6,2) DEFAULT 0;  -- % giảm giá (nếu discount_type = 'percent')

-- 2. Thêm created_by vào customers (nếu chưa có)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- 3. Các cột mới cho customers đã được thêm ở migration V4
--    (email, gender, birthday, tax_code, cccd, passport_no, company_name, customer_type, bank_name, bank_account, note)
--    Chạy lại nếu cần đảm bảo an toàn:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender        TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday      DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_code      TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cccd          TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS passport_no   TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name  TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'ca_nhan';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_name     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account  TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS note          TEXT;

-- ============================================================
-- XONG — Tổng kết thay đổi code (không cần chạy SQL):
--   • Trang khách hàng: hiện đầy đủ thông tin, người tạo, ngày tạo
--   • Tab "Lịch sử thu tiền" trên trang khách hàng
--   • Đơn hàng: lưu vat_rate, vat_amount, discount_type, discount_pct
--   • Khi sửa đơn: khôi phục đúng VAT % và loại giảm giá đã lưu
--   • Sổ quỹ: nhãn thống kê hiện rõ "Tiền mặt" / "Ngân hàng"
--   • Tạo khách hàng nhanh trong đơn hàng: thêm email, nhóm, loại KH
-- ============================================================
