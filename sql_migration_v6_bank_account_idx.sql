-- ============================================================
-- SQL MIGRATION V6 — Thêm cột bank_account_idx
-- Sửa lỗi: "Could not find the 'bank_account_idx' column of
--           'orders' in the schema cache" khi XÁC NHẬN TRẢ HÀNG.
--
-- Nguyên nhân: code phiếu trả hàng (và phiếu chi hoàn tiền) cần
-- lưu số tài khoản ngân hàng đã chọn, nhưng 2 bảng dưới đây chưa
-- có cột này.
--
-- 👉 CHẠY 1 LẦN trong Supabase SQL Editor (hoặc psql).
-- ============================================================

-- 1) Số thứ tự tài khoản ngân hàng cho ĐƠN HÀNG / PHIẾU TRẢ HÀNG
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bank_account_idx INTEGER;

-- 2) Số thứ tự tài khoản ngân hàng cho PHIẾU THU / PHIẾU CHI (Sổ quỹ)
ALTER TABLE cash_vouchers
  ADD COLUMN IF NOT EXISTS bank_account_idx INTEGER;

-- 3) (An toàn) Đảm bảo các cột phục vụ TÍNH CÔNG NỢ tồn tại. Hàm
--    recalculateCustomerDebt dùng debt + debt_adjustment + total_buy. Nếu
--    DB của bạn còn thiếu, thêm vào để công nợ sau trả hàng tính đúng:
--        công nợ = (hàng mua − hàng trả) − đã thu + đã chi trả lại + điều chỉnh
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS debt            NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS debt_adjustment NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS total_buy       NUMERIC DEFAULT 0;

-- 4) Bắt PostgREST nạp lại schema cache NGAY (nếu không, app vẫn có thể
--    báo "schema cache" trong vài giây tới vài phút cho đến khi tự reload).
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- XONG. Sau khi chạy:
--   • "Xác nhận trả hàng" hoạt động bình thường.
--   • Phần "Đã trả lại khách"  → lập PHIẾU CHI (đúng hình thức tiền
--     mặt / chuyển khoản, có lưu tài khoản ngân hàng).
--   • Phần còn phải trả khách  → TRỪ THẲNG vào CÔNG NỢ, KHÔNG tạo
--     phiếu thu/chi (do recalculateCustomerDebt tự xử lý).
--
-- Ghi chú: code đã được làm "an toàn lược cột" (insertRowSafe /
-- updateWhereSafe) nên KHÔNG còn sập nếu lỡ chưa chạy migration —
-- nhưng nên chạy để dữ liệu tài khoản ngân hàng được lưu đầy đủ.
-- ============================================================
