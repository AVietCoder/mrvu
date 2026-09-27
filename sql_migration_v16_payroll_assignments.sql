-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V16 — PHÂN VIỆC QUẢN LÝ LƯƠNG (admin chỉ định ai quản lý lương ai)
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- Thay cho cách cũ (v14: người có quyền "Quản lý lương nhân sự" thấy mọi nhân
-- viên cùng chi nhánh). Giờ MẶC ĐỊNH KHÔNG QUẢN LÝ AI — admin vào Bảng lương →
-- tab "Phân việc" tick từng nhân viên cho từng người quản lý.
--
--   manager_id = người có quyền "Quản lý lương nhân sự"
--   user_id    = nhân viên mà người đó được xem / sửa lương
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payroll_assignments (
  manager_id text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id    text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  PRIMARY KEY (manager_id, user_id),
  CHECK (manager_id <> user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_assignments_user ON public.payroll_assignments (user_id);

-- Dữ liệu phân quyền lương là nhạy cảm → deny-all như pay_profiles; server đọc
-- ghi bằng service role SAU KHI kiểm quyền.
ALTER TABLE public.payroll_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_assignments_deny_all ON public.payroll_assignments;
CREATE POLICY payroll_assignments_deny_all ON public.payroll_assignments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT m.full_name AS quan_ly, u.full_name AS nhan_vien
--   FROM public.payroll_assignments a
--   JOIN public.users m ON m.id = a.manager_id
--   JOIN public.users u ON u.id = a.user_id
--  ORDER BY 1, 2;
