-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V15 — CỜ "TÍNH VÀO TỔNG SỐ HÀNG HÓA" CHO TỪNG SẢN PHẨM
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- products.count_in_total:
--   true  (mặc định) = hàng hóa chính, được đếm trong các thống kê số hàng hóa
--                      (Tổng hàng tồn, Tổng sản phẩm, Top sản phẩm bán, Tổng SL bán).
--   false            = PHỤ KIỆN ĐI KÈM: vẫn bán, vẫn nhập/xuất/tồn kho bình thường,
--                      nhưng KHÔNG cộng vào các con số thống kê đó.
-- Mọi sản phẩm hiện có giữ nguyên = true → số liệu không đổi cho tới khi bỏ tick.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS count_in_total boolean NOT NULL DEFAULT true;

-- products_with_stock (v11) trả danh sách cột CỐ ĐỊNH → phải thêm cột mới vào
-- kiểu trả về. Đổi kiểu trả về của hàm thì Postgres bắt DROP trước.
DROP FUNCTION IF EXISTS public.products_with_stock(text);

CREATE FUNCTION public.products_with_stock(
  p_branch_id text DEFAULT NULL
)
RETURNS TABLE (
  id             text,
  sku            text,
  name           text,
  category_id    text,
  brand_id       text,
  power          text,
  color          text,
  blade_size     text,
  image_url      text,
  description    text,
  cost_price     numeric,
  sale_price     numeric,
  tech_fee       numeric,
  min_stock      int,
  created_at     timestamptz,
  count_in_total boolean,
  total_stock    bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.sku, p.name, p.category_id, p.brand_id,
    p.power, p.color, p.blade_size, p.image_url, p.description,
    p.cost_price, p.sale_price, p.tech_fee, p.min_stock, p.created_at,
    p.count_in_total,
    COALESCE(s.total, 0)::bigint AS total_stock
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT SUM(st.qty) AS total
      FROM public.stock st
     WHERE st.product_id = p.id
       AND (p_branch_id IS NULL OR p_branch_id = '' OR st.branch_id = p_branch_id)
  ) s ON TRUE
  ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.products_with_stock(text) TO anon, authenticated;

-- Báo PostgREST nạp lại schema ngay (không phải chờ).
NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT count_in_total, count(*) FROM public.products GROUP BY 1;   -- toàn bộ = true
-- SELECT count(*), sum(total_stock) FROM public.products_with_stock(); -- như trước khi chạy
