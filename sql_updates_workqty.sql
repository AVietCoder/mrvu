-- ============================================================
-- SQL CẬP NHẬT — SỐ LƯỢNG cho LOẠI HÌNH & TÍNH CHẤT công việc
-- (màn "Duyệt lịch & Phân công"). Chạy 1 lần trong Supabase SQL Editor.
-- ============================================================
--
-- Ý nghĩa:
--   • Loại hình công việc giờ có thêm SỐ LƯỢNG → Thành tiền = price × qty.
--   • Mỗi tính chất công việc cũng có SỐ LƯỢNG → Thành tiền = bonus × qty.
--   • ĐIỂM chấm công KHÔNG đổi: vẫn 1 điểm/loại hình và 1 điểm/tính chất,
--     chia đều theo số NV. Chỉ TIỀN nhân theo số lượng.
--
-- An toàn khi chạy lại (IF NOT EXISTS). Dữ liệu cũ mặc định qty = 1.

-- 1) Số lượng cho LOẠI HÌNH (mỗi lịch 1 loại hình)
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS work_type_qty INTEGER NOT NULL DEFAULT 1;

-- 2) Số lượng cho từng TÍNH CHẤT trong 1 lịch
ALTER TABLE schedule_difficulties
  ADD COLUMN IF NOT EXISTS qty INTEGER NOT NULL DEFAULT 1;

-- 3) Đảm bảo không có giá trị < 1 (phòng dữ liệu lỗi)
UPDATE schedules            SET work_type_qty = 1 WHERE work_type_qty IS NULL OR work_type_qty < 1;
UPDATE schedule_difficulties SET qty          = 1 WHERE qty          IS NULL OR qty          < 1;

-- ============================================================
-- XONG! Tổng kết thay đổi code (không cần chạy thêm SQL):
--   • Màn "Duyệt lịch & Phân công": thêm ô Số lượng (− / +) và cột
--     Thành tiền cho loại hình và từng tính chất công việc.
--   • Tiền công/người, bảng chấm công & chi tiết lịch đã tính theo qty.
-- ============================================================
