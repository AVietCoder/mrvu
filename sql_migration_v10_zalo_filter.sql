-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V10 — Ai được nhận tin Zalo, và chế độ chạy thử
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chỉ thêm, không sửa dữ
-- liệu cũ, chạy lại nhiều lần vẫn an toàn.
--
-- Bối cảnh: trước migration này, MỌI khách có SĐT hợp lệ đều nhận tin khi đơn
-- hoàn tất. Đó không phải điều mong muốn — mỗi tin tốn 400đ và không phải
-- khách nào cũng nên bị nhắn.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1) QUYẾT ĐỊNH GỬI/KHÔNG THEO TỪNG ĐƠN ────────────────────────────────
-- NULL  = đơn cũ, tạo trước khi có tính năng này → KHÔNG gửi (chọn mặc định
--         an toàn: thà bỏ sót còn hơn nhắn nhầm hàng loạt đơn cũ).
-- true  = nhân viên đã tick "Gửi thông báo Zalo" trên form tạo đơn.
-- false = đã bỏ tick.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS zalo_notify boolean;

COMMENT ON COLUMN public.orders.zalo_notify IS
  'Có gửi ZNS khi đơn hoàn tất không. NULL = đơn cũ, coi như không gửi.';


-- ─── 2) CẤU HÌNH GỬI TIN ──────────────────────────────────────────────────
-- Một dòng duy nhất, id cố định = 'default'.
CREATE TABLE IF NOT EXISTS public.zalo_settings (
  id              text PRIMARY KEY DEFAULT 'default',

  -- ★ CHẾ ĐỘ CHẠY THỬ — mặc định BẬT.
  -- Khi bật, hệ thống CHỈ gửi tới các số trong test_phones; mọi số khác bị
  -- huỷ job và ghi log rõ lý do. Mặc định bật để lần deploy đầu tiên không
  -- thể vô tình nhắn hàng loạt khách thật.
  test_mode       boolean NOT NULL DEFAULT true,

  -- Danh sách SĐT nhận tin khi đang chạy thử. Lưu dạng ["84912345678", ...]
  -- (đã chuẩn hoá 84xxxxxxxxx).
  test_phones     jsonb   NOT NULL DEFAULT '[]'::jsonb,

  -- Đơn có tổng tiền nhỏ hơn mức này thì bỏ qua. 0 = không chặn gì.
  min_order_total numeric NOT NULL DEFAULT 0,

  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zalo_settings ENABLE ROW LEVEL SECURITY;

-- Tạo sẵn dòng cấu hình, chạy thử BẬT.
INSERT INTO public.zalo_settings (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- KIỂM TRA
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT test_mode, test_phones, min_order_total FROM public.zalo_settings;
-- SELECT count(*) FROM public.orders WHERE zalo_notify IS NULL;  -- đơn cũ, sẽ không bị nhắn
