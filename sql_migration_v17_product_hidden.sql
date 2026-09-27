-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V17 — ẨN HÀNG (KHÔNG KINH DOANH)
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
-- Cần chạy SAU v15 (dùng cột count_in_total).
--
-- products.is_hidden:
--   false (mặc định) = đang kinh doanh, hiện bình thường trong danh sách hàng hóa.
--   true             = đã ngừng kinh doanh: ẩn khỏi danh sách hàng hóa và khỏi
--                      "Top 10 tồn kho nhiều nhất". Muốn xem thì chọn bộ lọc
--                      "Cả hàng ẩn" / "Chỉ hàng ẩn". Tồn kho, lịch sử đơn,
--                      phiếu nhập/xuất… KHÔNG bị ảnh hưởng.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Thêm cột mới vào kiểu trả về của products_with_stock → phải DROP rồi tạo lại.
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
  is_hidden      boolean,
  total_stock    bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.sku, p.name, p.category_id, p.brand_id,
    p.power, p.color, p.blade_size, p.image_url, p.description,
    p.cost_price, p.sale_price, p.tech_fee, p.min_stock, p.created_at,
    p.count_in_total,
    p.is_hidden,
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

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT is_hidden, count(*) FROM public.products GROUP BY 1;          -- toàn bộ = false
-- SELECT name, total_stock FROM public.products_with_stock()
--  WHERE NOT is_hidden AND count_in_total AND total_stock > 0
--  ORDER BY total_stock DESC LIMIT 10;                                 -- Top 10 tồn kho
