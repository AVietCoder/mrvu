-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V18 — CHỨC VỤ NHÂN VIÊN
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- positions         : danh sách chức vụ (admin thêm / đổi tên / xoá ở trang Nhân viên)
-- users.position_id : chức vụ của từng nhân viên (để trống = chưa có chức vụ)
-- Xoá một chức vụ → nhân viên đang giữ chức vụ đó về "chưa có chức vụ".
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.positions (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tên chức vụ không trùng (không phân biệt hoa thường, bỏ khoảng trắng thừa).
CREATE UNIQUE INDEX IF NOT EXISTS uq_positions_name ON public.positions (lower(btrim(name)));

-- Chức vụ tạo sẵn. ON CONFLICT DO NOTHING → chạy lại không nhân đôi, và không
-- ghi đè nếu admin đã đổi tên.
INSERT INTO public.positions (id, name, sort_order) VALUES
  ('pos_sales_manager', 'Quản lý bán hàng',  1),
  ('pos_sales',         'Nhân viên bán hàng', 2),
  ('pos_technician',    'Kỹ thuật',           3),
  ('pos_business',      'Kinh doanh',         4)
ON CONFLICT DO NOTHING;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS position_id text REFERENCES public.positions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_position ON public.users (position_id);

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT * FROM public.positions ORDER BY sort_order;                      -- 4 dòng
-- SELECT p.name, count(u.id) FROM public.positions p
--   LEFT JOIN public.users u ON u.position_id = p.id GROUP BY 1 ORDER BY 1;
