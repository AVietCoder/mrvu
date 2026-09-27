-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V13 — LỊCH TRỰC CA + CHẤM CÔNG + BẢNG LƯƠNG
--
-- Chạy TOÀN BỘ file này trong Supabase Dashboard → SQL Editor → Run.
-- Chỉ THÊM bảng mới, không sửa/xoá dữ liệu cũ, chạy lại nhiều lần vẫn an toàn.
--
-- Thay cho 2 file Excel đang làm tay mỗi tháng:
--   • "LỊCH TRỰC VP_HCM 2026.xlsx"     → duty_shifts + duty_entries
--   • "BẢNG LƯƠNG KT HCM THÁNG x.xlsx" → pay_profiles + attendance_days
--                                         + payroll_periods + payroll_items
--
-- ─── PHÂN QUYỀN ───────────────────────────────────────────────────────────
-- Lương, số tài khoản ngân hàng là dữ liệu NHẠY CẢM. Anon key của app đang
-- nằm trong bundle trình duyệt, nên các bảng lương bật RLS và KHÔNG có policy
-- nào → anon không đọc/ghi được. Server truy cập bằng service role sau khi đã
-- kiểm quyền "manage_payroll".
-- Lịch trực thì mọi nhân viên cần XEM được → cho anon quyền SELECT, còn ghi
-- vẫn đi qua server (kiểm quyền "manage_roster").
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1) LỊCH TRỰC CA ═══════════════════════════════════════════════════════

-- Ca làm theo từng chi nhánh. Cấu hình được trên giao diện, không hardcode.
CREATE TABLE IF NOT EXISTS public.duty_shifts (
  id          text PRIMARY KEY,
  branch_id   text NOT NULL REFERENCES public.branches(id),
  name        text NOT NULL,              -- "8h30-18h00"
  start_time  text,                       -- "08:30"
  end_time    text,                       -- "18:00"
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Mỗi dòng = một người trong một ngày.
--   kind = 'work'     → trực ca shift_id (một ca có thể nhiều người)
--   kind = 'off'      → nghỉ (shift_id NULL)
--   kind = 'half_off' → nghỉ nửa ngày, vd "Khải - off chiều" (có thể kèm ca)
--   kind = 'holiday'  → nghỉ lễ (shift_id NULL)
CREATE TABLE IF NOT EXISTS public.duty_entries (
  id          text PRIMARY KEY,
  work_date   date NOT NULL,
  user_id     text NOT NULL REFERENCES public.users(id),
  shift_id    text REFERENCES public.duty_shifts(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'work'
              CHECK (kind IN ('work', 'off', 'half_off', 'holiday')),
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Một người không thể bị xếp 2 lần vào CÙNG một ca trong cùng ngày.
-- COALESCE để các dòng nghỉ (shift_id NULL) cũng bị ràng buộc: 1 người
-- chỉ có 1 trạng thái nghỉ mỗi ngày.
CREATE UNIQUE INDEX IF NOT EXISTS uq_duty_entry
  ON public.duty_entries (work_date, user_id, COALESCE(shift_id, ''));

CREATE INDEX IF NOT EXISTS idx_duty_entries_date ON public.duty_entries (work_date);

ALTER TABLE public.duty_shifts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duty_shifts_read ON public.duty_shifts;
CREATE POLICY duty_shifts_read ON public.duty_shifts
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS duty_entries_read ON public.duty_entries;
CREATE POLICY duty_entries_read ON public.duty_entries
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.duty_shifts, public.duty_entries TO anon, authenticated;

-- Seed ca mẫu đúng giờ trong file Excel, chỉ khi chưa có ca nào.
-- Showroom "451 ĐBP": 3 ca. Văn phòng/Kỹ thuật/Kho "OFFICE": 1 ca.
-- Showroom "T3" trong file chưa rõ ứng với chi nhánh nào → tự thêm trong
-- màn "Cài đặt ca".
DO $$
DECLARE
  b_dbp text;
  b_office text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.duty_shifts) THEN
    SELECT id INTO b_dbp    FROM public.branches WHERE name ILIKE '%451 ĐBP%' LIMIT 1;
    SELECT id INTO b_office FROM public.branches WHERE name ILIKE '%OFFICE%'  LIMIT 1;

    IF b_dbp IS NOT NULL THEN
      INSERT INTO public.duty_shifts (id, branch_id, name, start_time, end_time, sort_order) VALUES
        (gen_random_uuid()::text, b_dbp, '8h30-18h00',  '08:30', '18:00', 1),
        (gen_random_uuid()::text, b_dbp, '14h00-20h30', '14:00', '20:30', 2),
        (gen_random_uuid()::text, b_dbp, '9h00-20h30',  '09:00', '20:30', 3);
    END IF;
    IF b_office IS NOT NULL THEN
      INSERT INTO public.duty_shifts (id, branch_id, name, start_time, end_time, sort_order) VALUES
        (gen_random_uuid()::text, b_office, '8h00-17h30', '08:00', '17:30', 1);
    END IF;
  END IF;
END $$;


-- ═══ 2) HỒ SƠ LƯƠNG ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pay_profiles (
  user_id           text PRIMARY KEY REFERENCES public.users(id),
  position          text,                    -- Chức vụ: Kỹ thuật / Kho / Điều phối
  area              text,                    -- Khu vực: HCM
  start_label       text,                    -- "Tháng 3.2018"
  base_salary       numeric NOT NULL DEFAULT 0,
  standard_days     numeric NOT NULL DEFAULT 26,
  bank_name         text,
  bank_account      text,
  bank_owner        text,
  -- Hoa hồng: % trên doanh thu đơn hoàn tất của khách thuộc nhóm này
  -- (vd 0.5 % nhóm "dai_ly"). NULL/0 = không có hoa hồng.
  commission_rate   numeric NOT NULL DEFAULT 0,
  commission_group  text REFERENCES public.customer_groups(code),
  -- Có tính lương doanh số từ Lịch làm việc (kỹ thuật viên) không
  tech_revenue      boolean NOT NULL DEFAULT false,
  social_insurance  numeric NOT NULL DEFAULT 0,  -- BHXH khấu trừ mặc định/tháng
  union_fee         numeric NOT NULL DEFAULT 0,  -- Quỹ công đoàn mặc định/tháng
  in_payroll        boolean NOT NULL DEFAULT true,
  sort_order        int NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ═══ 3) CHẤM CÔNG ════════════════════════════════════════════════════════
-- X = làm cả ngày, N = nửa ngày, L = nghỉ có lương, K = nghỉ không lương.
-- Công thực tế = X + N/2 + L (đúng công thức file Excel).
CREATE TABLE IF NOT EXISTS public.attendance_days (
  user_id    text NOT NULL REFERENCES public.users(id),
  work_date  date NOT NULL,
  code       text NOT NULL CHECK (code IN ('X', 'N', 'L', 'K')),
  note       text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_days_date ON public.attendance_days (work_date);

-- ═══ 4) KỲ LƯƠNG ═════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id         text PRIMARY KEY,
  month      text NOT NULL UNIQUE,                 -- "2026-06"
  status     text NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft', 'locked', 'paid')),
  locked_at  timestamptz,
  locked_by  text,
  paid_at    timestamptz,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mỗi người một dòng mỗi kỳ.
-- Khi kỳ còn "draft": chỉ các ô NHẬP TAY có ý nghĩa (tăng ca, xăng xe,
-- thưởng...), các ô tự tính được tính lại mỗi lần xem.
-- Khi "Chốt lương": TOÀN BỘ số liệu được chụp lại (snapshot) vào đây → sửa
-- lịch/đơn/phiếu sau đó KHÔNG làm đổi bảng lương đã chốt.
CREATE TABLE IF NOT EXISTS public.payroll_items (
  period_id          text NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  user_id            text NOT NULL REFERENCES public.users(id),
  -- ── nhập tay ──
  ot_hours_15        numeric NOT NULL DEFAULT 0,   -- giờ tăng ca ×1,5
  ot_hours_20        numeric NOT NULL DEFAULT 0,   -- giờ tăng ca ×2,0
  travel_allowance   numeric NOT NULL DEFAULT 0,   -- xăng xe đi tỉnh
  travel_note        text,
  bonus              numeric NOT NULL DEFAULT 0,   -- thưởng
  extra_allowance    numeric NOT NULL DEFAULT 0,   -- phụ cấp thêm
  extra_note         text,
  other_deduction    numeric NOT NULL DEFAULT 0,   -- trừ khác
  other_note         text,
  commission_override numeric,                     -- NULL = dùng số tự tính
  social_insurance_override numeric,               -- NULL = dùng hồ sơ
  -- ── snapshot khi chốt ──
  full_name          text,
  position           text,
  base_salary        numeric,
  standard_days      numeric,
  worked_days        numeric,
  salary_by_days     numeric,
  tech_revenue       numeric,
  commission         numeric,
  overtime_amount    numeric,
  advance            numeric,
  social_insurance   numeric,
  union_fee          numeric,
  gross              numeric,
  deductions         numeric,
  net_pay            numeric,
  bank_name          text,
  bank_account       text,
  -- Phiếu "Chi Lương" đã tạo trong Sổ quỹ. Có giá trị = đã chi → bấm
  -- "Chi lương" lần nữa sẽ BỎ QUA người này, không tạo phiếu trùng.
  cash_voucher_id    text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, user_id)
);

ALTER TABLE public.pay_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items   ENABLE ROW LEVEL SECURITY;
-- Cố ý KHÔNG tạo policy nào cho 4 bảng trên: chỉ service role truy cập được.


-- ═══════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI CHẠY
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT s.name, b.name FROM duty_shifts s JOIN branches b ON b.id = s.branch_id ORDER BY b.name, s.sort_order;
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN
--   ('duty_shifts','duty_entries','pay_profiles','attendance_days','payroll_periods','payroll_items');
