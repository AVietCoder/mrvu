-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V12 — NHÓM KHÁCH HÀNG QUẢN LÝ ĐƯỢC
--
-- Chạy TOÀN BỘ file này trong Supabase Dashboard → SQL Editor → Run.
-- Chỉ THÊM, không sửa dữ liệu khách hàng, chạy lại nhiều lần vẫn an toàn.
--
-- Trước đây 4 nhóm (Khách lẻ / Đại lý / VIP / Công trình) được HARDCODE ở 4
-- file khác nhau trong code, nên không thể thêm nhóm mới hay đổi tên. Bảng
-- này trở thành nguồn sự thật duy nhất.
--
-- customers.group_name GIỮ NGUYÊN kiểu text và giá trị cũ — nó chính là
-- customer_groups.code. Đã đo trên DB thật: mọi khách hiện có chỉ dùng đúng
-- 4 mã le / dai_ly / vip / cong_trinh, nên seed 4 dòng dưới đây là đủ để
-- toàn bộ dữ liệu cũ hợp lệ, không cần cập nhật khách nào.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_groups (
  code        text PRIMARY KEY,              -- bất biến, lưu trong customers.group_name
  name        text NOT NULL,                 -- tên hiển thị, sửa được
  color       text NOT NULL DEFAULT 'gray',  -- gray|blue|amber|purple|green|red|pink|teal
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true, -- tắt = ẩn khỏi ô chọn khi tạo khách mới
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed đúng 4 nhóm đang dùng, giữ nguyên tên và màu như giao diện cũ.
INSERT INTO public.customer_groups (code, name, color, sort_order) VALUES
  ('le',         'Khách lẻ',   'gray',   1),
  ('dai_ly',     'Đại lý',     'blue',   2),
  ('vip',        'VIP',        'amber',  3),
  ('cong_trinh', 'Công trình', 'purple', 4)
ON CONFLICT (code) DO NOTHING;


-- ─── BẢO VỆ DỮ LIỆU ───────────────────────────────────────────────────────
-- Khoá ngoại: không thể xoá nhóm đang có khách, không thể gán khách vào mã
-- nhóm không tồn tại. NOT VALID rồi VALIDATE để không khoá bảng customers
-- (17k dòng) lâu khi thêm ràng buộc.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_group_name_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_group_name_fkey
      FOREIGN KEY (group_name) REFERENCES public.customer_groups(code)
      ON UPDATE CASCADE ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.customers VALIDATE CONSTRAINT customers_group_name_fkey;


-- ─── PHÂN QUYỀN ───────────────────────────────────────────────────────────
-- Ai cũng ĐỌC được danh sách nhóm (tên nhóm không phải dữ liệu nhạy cảm).
-- GHI chỉ đi qua server function bằng service role sau khi đã kiểm admin —
-- không mở quyền ghi cho anon key đang nằm trong bundle trình duyệt.
ALTER TABLE public.customer_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_groups_read ON public.customer_groups;
CREATE POLICY customer_groups_read ON public.customer_groups
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.customer_groups TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI CHẠY
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT * FROM public.customer_groups ORDER BY sort_order;      -- 4 dòng
-- SELECT group_name, count(*) FROM public.customers GROUP BY 1;  -- chỉ 4 mã trên
