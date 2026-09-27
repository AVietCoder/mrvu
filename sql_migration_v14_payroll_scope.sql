-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V14 — CHỐT LƯƠNG THEO TỪNG NGƯỜI (phục vụ phân quyền theo chi nhánh)
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- Vì sao: v13 chốt lương theo CẢ THÁNG (payroll_periods.status). Nay quyền
-- "Quản lý lương nhân sự" chỉ thấy nhân viên thuộc chi nhánh mình quản lý →
-- nhiều người quản lý cùng một tháng. Nếu vẫn chốt theo tháng, người quản lý
-- HCM bấm "Chốt" sẽ khoá luôn lương của Hà Nội mà họ không nhìn thấy.
-- Chuyển trạng thái chốt xuống TỪNG DÒNG LƯƠNG (payroll_items).
--
-- payroll_periods.status được giữ lại (không xoá cột) nhưng code không dùng nữa.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_items_status_check') THEN
    ALTER TABLE public.payroll_items
      ADD CONSTRAINT payroll_items_status_check CHECK (status IN ('draft', 'locked'));
  END IF;
END $$;

-- Chuyển trạng thái cũ: kỳ nào đã chốt/đã chi ở mức tháng thì các dòng của
-- kỳ đó thành "locked". Không có kỳ nào như vậy thì câu này không làm gì.
UPDATE public.payroll_items i
   SET status = 'locked',
       locked_at = COALESCE(i.locked_at, p.locked_at),
       locked_by = COALESCE(i.locked_by, p.locked_by)
  FROM public.payroll_periods p
 WHERE p.id = i.period_id
   AND p.status IN ('locked', 'paid')
   AND i.status = 'draft';

CREATE INDEX IF NOT EXISTS idx_user_branches_user ON public.user_branches (user_id);

-- KIỂM TRA:
-- SELECT status, count(*) FROM public.payroll_items GROUP BY 1;
