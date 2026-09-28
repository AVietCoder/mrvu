-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V20 — NGUỒN KHÁCH "BIẾT MR.VŨ QUA ĐÂU?"
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- customers.source      : facebook | google | tiktok | thiet_ke | ban_be | khac
-- customers.source_note : nội dung cụ thể khi chọn "khac"
-- Bắt buộc khi TẠO khách mới (kiểm ở server). Khách cũ để trống được, bổ sung
-- dần khi sửa. Không đặt CHECK cứng để sau này thêm nguồn không phải sửa DB.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS source_note text;

CREATE INDEX IF NOT EXISTS idx_customers_source ON public.customers (source);

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT coalesce(source, '(chưa có)') AS nguon, count(*) FROM public.customers GROUP BY 1 ORDER BY 2 DESC;
