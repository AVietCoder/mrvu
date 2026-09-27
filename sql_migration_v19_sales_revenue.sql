-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V19 — DS BÁN HÀNG / DS KINH DOANH
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
-- Cần chạy SAU v16 (payroll_assignments) và v18 (chức vụ).
--
-- Công thức (doanh thu = TIỀN THỰC THU TRONG THÁNG của người bán):
--   Quản lý bán hàng  : DS = SUM × hệ số%          (SUM = doanh thu bản thân +
--                        mọi người được phân ở tab Phân việc; hệ số mặc định 0,5%)
--   Nhân viên bán hàng: DS = x / SUM × 1% × max(0, SUM − KPI)
--                        (x = doanh thu bản thân; SUM, KPI của quản lý bán hàng
--                        đang quản lý người này)
--   Kinh doanh        : DS kinh doanh = 1% × doanh thu bản thân
--
-- sales_settings : hệ số % của từng quản lý bán hàng (không có dòng = 0,5%)
-- sales_kpis     : KPI theo THÁNG của từng quản lý bán hàng. Tháng chưa đặt
--                  thì dùng KPI của tháng gần nhất trước đó.
-- payroll_items  : thêm DS kinh doanh (snapshot khi chốt) + ô admin ghi đè.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sales_settings (
  manager_id text        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  coef       numeric     NOT NULL DEFAULT 0.5 CHECK (coef >= 0 AND coef <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE IF NOT EXISTS public.sales_kpis (
  manager_id text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month      text        NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  kpi        numeric     NOT NULL DEFAULT 0 CHECK (kpi >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (manager_id, month)
);

-- Dữ liệu lương → deny-all, server đọc ghi bằng service role sau khi kiểm quyền.
ALTER TABLE public.sales_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_settings_deny_all ON public.sales_settings;
CREATE POLICY sales_settings_deny_all ON public.sales_settings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.sales_kpis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_kpis_deny_all ON public.sales_kpis;
CREATE POLICY sales_kpis_deny_all ON public.sales_kpis
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS business_revenue  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_override numeric;

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT u.full_name, s.coef FROM public.sales_settings s JOIN public.users u ON u.id = s.manager_id;
-- SELECT u.full_name, k.month, k.kpi FROM public.sales_kpis k JOIN public.users u ON u.id = k.manager_id ORDER BY 2 DESC;
