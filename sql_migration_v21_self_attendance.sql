-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V21 — NHÂN VIÊN TỰ CHẤM CÔNG
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- attendance_days.self_marked = true khi nhân viên TỰ chấm (quyền "Tự chấm
-- công", trang Tổng quan). Dùng để:
--   - hiện dấu riêng trên lưới chấm công của quản lý (dễ kiểm tra),
--   - chặn nhân viên sửa ngày do quản lý / admin đã chấm (chỉ thêm ghi chú).
-- Nhân viên chỉ tự chấm được NGÀY HÔM NAY (server tự lấy ngày, giờ VN).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.attendance_days
  ADD COLUMN IF NOT EXISTS self_marked boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT u.full_name, a.work_date, a.code, a.note
--   FROM public.attendance_days a JOIN public.users u ON u.id = a.user_id
--  WHERE a.self_marked ORDER BY a.work_date DESC LIMIT 20;
