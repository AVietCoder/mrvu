-- ============================================================
-- SQL CẬP NHẬT — TÍNH NĂNG CHẤM CÔNG (LOẠI HÌNH + TÍNH CHẤT CV)
-- Chạy 1 lần trong Supabase SQL Editor.
-- ============================================================

-- 1) Bảng "Loại hình công việc" (lắp đặt, bảo hành, khảo sát,...)
--    Mỗi lịch chỉ có 1 loại hình duy nhất.
CREATE TABLE IF NOT EXISTS work_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(14,2) NOT NULL DEFAULT 0,    -- tiền/điểm cho 1 lượt làm
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Liên kết loại hình vào schedule (1-1)
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS work_type_id TEXT REFERENCES work_types(id);

CREATE INDEX IF NOT EXISTS idx_schedules_work_type ON schedules(work_type_id);

-- 3) Đảm bảo tính chất CV (work_difficulties) có cột price (đồng nghĩa bonus).
--    Giữ nguyên cột bonus đã có. Không cần thêm.

-- 4) Bảng quy ước:
--    Mỗi lịch (đã duyệt) có 1 loại hình + N tính chất + M kỹ thuật viên.
--    Điểm chấm công 1 NV trong 1 lịch:
--       - loại hình: 1 / M
--       - mỗi tính chất: 1 / M
--    Tiền chấm công 1 NV trong 1 lịch:
--       - (price loại hình + sum(bonus tính chất)) / M
--    Cộng dồn theo tháng (scheduled_date) để ra bảng lương.

-- 5) View tiện cho báo cáo (tùy chọn — code TS đã tự tính, view chỉ để query nhanh)
CREATE OR REPLACE VIEW v_attendance_lines AS
SELECT
  s.id            AS schedule_id,
  s.title         AS schedule_title,
  s.scheduled_date,
  s.work_type_id,
  wt.name         AS work_type_name,
  wt.price        AS work_type_price,
  sa.user_id,
  (SELECT COUNT(*) FROM schedule_assignments x WHERE x.schedule_id = s.id) AS num_people,
  COALESCE((
    SELECT SUM(wd.bonus)
    FROM schedule_difficulties sd
    JOIN work_difficulties wd ON wd.id = sd.difficulty_id
    WHERE sd.schedule_id = s.id
  ), 0)           AS difficulty_total
FROM schedules s
LEFT JOIN work_types wt ON wt.id = s.work_type_id
JOIN schedule_assignments sa ON sa.schedule_id = s.id
WHERE s.status IN ('approved','in_progress','done');

-- ============================================================
-- Xong!
-- ============================================================
