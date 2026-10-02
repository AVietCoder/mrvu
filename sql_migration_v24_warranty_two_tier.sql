-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V24 — BẢO HÀNH HAI MỨC (động cơ / phụ kiện)
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
-- Chạy SAU sql_migration_v23_warranty.sql.
--
-- Thực tế bảo hành là hai mức ("động cơ 10 năm, phụ kiện 12 tháng"):
--   products.warranty_months        : hạn PHỤ KIỆN / linh kiện (đã có từ v23, mặc định 12).
--   products.warranty_motor_months  : hạn ĐỘNG CƠ (mới, mặc định 120 tháng).
--   warranty_tickets.warranty_motor_months : chụp lại hạn động cơ lúc tạo phiếu.
--   warranty_tickets.fault_part     : bộ phận lỗi — 'motor' | 'accessory' | NULL (chưa xác định).
--     NULL → nhãn "Còn hạn động cơ" khi động cơ còn hạn mà phụ kiện đã hết.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS warranty_motor_months integer NOT NULL DEFAULT 120;

ALTER TABLE public.warranty_tickets ADD COLUMN IF NOT EXISTS warranty_motor_months integer NOT NULL DEFAULT 120;
ALTER TABLE public.warranty_tickets ADD COLUMN IF NOT EXISTS fault_part text;

ALTER TABLE public.warranty_tickets DROP CONSTRAINT IF EXISTS warranty_tickets_fault_part_check;
ALTER TABLE public.warranty_tickets ADD CONSTRAINT warranty_tickets_fault_part_check
  CHECK (fault_part IS NULL OR fault_part IN ('motor', 'accessory'));

-- Phụ kiện / dịch vụ bán rời không có động cơ → hạn "động cơ" lấy bằng hạn phụ kiện,
-- để phiếu của các mã này không hiện "Còn hạn động cơ". Chỉ đụng dòng còn ở mặc định.
UPDATE public.products p
   SET warranty_motor_months = p.warranty_months
  FROM public.categories c
 WHERE c.id = p.category_id
   AND upper(c.name) IN ('PHỤ KIỆN', 'DỊCH VỤ')
   AND p.warranty_motor_months = 120;

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT warranty_months, warranty_motor_months, count(*) FROM public.products GROUP BY 1, 2 ORDER BY 1, 2;
