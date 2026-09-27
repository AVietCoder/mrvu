-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V11 — CHĂM SÓC KHÁCH HÀNG (sinh nhật, bảo dưỡng định kỳ)
--                 + TỔNG HÀNG TỒN
--
-- Chạy TOÀN BỘ file này trong Supabase Dashboard → SQL Editor → Run.
-- Chỉ THÊM, không sửa/xoá dữ liệu cũ, chạy lại nhiều lần vẫn an toàn.
--
-- ⚠️ KHÔNG có lệnh DROP/DELETE/UPDATE dữ liệu nào trong file này.
--
-- ─── "NGÀY XUẤT KHO" LÀ GÌ ────────────────────────────────────────────────
-- Hệ thống KHÔNG có trường ngày xuất kho riêng. Bán hàng cũng không ghi
-- stock_movements — nó UPDATE thẳng stock.qty. Mốc duy nhất trùng đúng thời
-- điểm hàng rời kho là orders.completed_at (được set ngay trong cùng bước
-- gọi applyCompletedOrderSideEffects để trừ kho).
--   => ngày xuất kho := COALESCE(completed_at, created_at)
-- Đã đo trên dữ liệu thật: 0/9.265 đơn completed thiếu completed_at, nên
-- fallback chỉ là lưới an toàn, không phải đường chạy chính.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1) NGÀY SINH NHÂN VIÊN ───────────────────────────────────────────────
-- Bảng users trước nay không có ngày sinh (chỉ customers.birthday có).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS birthday date;

COMMENT ON COLUMN public.users.birthday IS
  'Ngày sinh nhân viên. Chỉ dùng để hiển thị nhắc sinh nhật nội bộ — KHÔNG gửi Zalo.';


-- ─── 2) TRẠNG THÁI DUYỆT CỦA MẪU ZNS ──────────────────────────────────────
-- Zalo có thể từ chối (REJECT) một mẫu sau khi đã duyệt. Lưu lại để trang
-- CSKH nói được "mẫu đang bị từ chối" thay vì để nút gửi xám không lý do.
ALTER TABLE public.zns_templates
  ADD COLUMN IF NOT EXISTS zalo_status       text,
  ADD COLUMN IF NOT EXISTS status_checked_at timestamptz;


-- ─── 3) INDEX ─────────────────────────────────────────────────────────────
-- date_part() là IMMUTABLE nên index được. KHÔNG dùng to_char(): nó chỉ
-- STABLE, Postgres sẽ từ chối tạo index.
CREATE INDEX IF NOT EXISTS idx_customers_birthday_md
  ON public.customers ((date_part('month', birthday)), (date_part('day', birthday)))
  WHERE birthday IS NOT NULL;

-- Index trên chính biểu thức "ngày xuất kho". COALESCE của 2 cột là IMMUTABLE.
-- Không index được biểu thức có AT TIME ZONE (STABLE) → RPC bên dưới phải
-- pre-filter thô trên cột gốc rồi mới lọc tinh theo giờ VN.
CREATE INDEX IF NOT EXISTS idx_orders_shipped_at
  ON public.orders ((COALESCE(completed_at, created_at)))
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_message_logs_cust_tpl
  ON public.message_logs (customer_id, template_id, sent_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) RPC — SINH NHẬT HÔM NAY
--
-- Chỉ so tháng+ngày, bỏ qua năm. "Hôm nay" tính theo giờ Việt Nam, KHÔNG
-- theo UTC — sau 17:00 giờ VN thì UTC đã sang ngày hôm trước, dùng UTC sẽ
-- chúc sinh nhật lệch một ngày.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.care_birthdays_today(
  p_date          date DEFAULT NULL,
  p_template_code text DEFAULT 'birthday'
)
RETURNS TABLE (
  customer_id   text,
  customer_name text,
  customer_code text,
  phone         text,
  email         text,
  birthday      date,
  age           int,
  total_buy     numeric,
  debt          numeric,
  last_sent_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT COALESCE(p_date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS today
  ),
  f AS (
    SELECT today,
           date_part('month', today) AS m,
           date_part('day',   today) AS dd,
           -- Số ngày của tháng 2 năm nay: 28 hay 29
           date_part('day', make_date(date_part('year', today)::int, 3, 1) - 1) AS feb_last
    FROM d
  ),
  tpl AS (
    SELECT id FROM public.zns_templates WHERE code = p_template_code LIMIT 1
  )
  SELECT
    c.id, c.name, c.external_code, c.phone, c.email, c.birthday,
    (date_part('year', f.today) - date_part('year', c.birthday))::int AS age,
    c.total_buy, c.debt,
    (SELECT max(ml.sent_at)
       FROM public.message_logs ml
      WHERE ml.customer_id = c.id
        AND ml.status = 'SENT'
        AND ml.template_id = (SELECT id FROM tpl)) AS last_sent_at
  FROM public.customers c
  CROSS JOIN f
  WHERE c.birthday IS NOT NULL
    AND c.zalo_opt_out_at IS NULL
    AND (
      (date_part('month', c.birthday) = f.m AND date_part('day', c.birthday) = f.dd)
      -- Khách sinh 29/02: năm không nhuận thì chúc vào 28/02, nếu không họ
      -- sẽ không bao giờ được chúc trong 3 năm liên tiếp.
      OR (f.m = 2 AND f.dd = 28 AND f.feb_last = 28
          AND date_part('month', c.birthday) = 2
          AND date_part('day', c.birthday) = 29)
    )
  ORDER BY c.name;
$$;

-- Chỉ service_role gọi được (app đi qua getSupabaseAdmin).
REVOKE ALL ON FUNCTION public.care_birthdays_today(date, text) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) RPC — SINH NHẬT NHÂN VIÊN HÔM NAY
-- Tách riêng khỏi khách hàng: nhân viên CHỈ hiển thị, TUYỆT ĐỐI không đưa
-- vào luồng gửi Zalo. Tách hàm để không thể lẫn hai tập dữ liệu vào nhau.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.care_employee_birthdays_today(
  p_date date DEFAULT NULL
)
RETURNS TABLE (
  user_id    text,
  full_name  text,
  username   text,
  phone      text,
  birthday   date,
  age        int,
  branch_ids text[]
)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT COALESCE(p_date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS today
  ),
  f AS (
    SELECT today,
           date_part('month', today) AS m,
           date_part('day',   today) AS dd,
           date_part('day', make_date(date_part('year', today)::int, 3, 1) - 1) AS feb_last
    FROM d
  )
  SELECT u.id, u.full_name, u.username, u.phone, u.birthday,
         (date_part('year', f.today) - date_part('year', u.birthday))::int,
         COALESCE(
           (SELECT array_agg(ub.branch_id) FROM public.user_branches ub WHERE ub.user_id = u.id),
           ARRAY[]::text[]
         )
  FROM public.users u
  CROSS JOIN f
  WHERE u.birthday IS NOT NULL
    AND COALESCE(u.active, true) = true
    AND (
      (date_part('month', u.birthday) = f.m AND date_part('day', u.birthday) = f.dd)
      OR (f.m = 2 AND f.dd = 28 AND f.feb_last = 28
          AND date_part('month', u.birthday) = 2
          AND date_part('day', u.birthday) = 29)
    )
  ORDER BY u.full_name;
$$;

REVOKE ALL ON FUNCTION public.care_employee_birthdays_today(date) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) RPC — ĐẾN HẠN BẢO DƯỠNG, GỘP THEO KHÁCH
--
-- Hạn bảo dưỡng = ngày xuất kho + 6 tháng.
--
-- ─── LUẬT CỘNG THÁNG CỦA POSTGRES (đọc kỹ) ────────────────────────────────
-- date + interval '6 months' KẸP về ngày cuối cùng hợp lệ của tháng đích,
-- không bao giờ tràn sang tháng sau:
--      31/08 → 28/02        31/03 → 30/09        31/12 → 30/06
--      31/08/2023 → 29/02/2024 (năm nhuận)
-- Hệ quả: 28, 29, 30 và 31/08 ĐỀU đến hạn vào 28/02. Không đơn nào bị mất,
-- nhưng ngày đó lượng nhắc dồn gấp ~4 lần → UI phải cảnh báo chi phí.
--
-- p_window_days: quét bù các ngày đã bỏ lỡ. Hệ thống không có cron chạy tự
-- động; ngày nào không ai mở trang thì khách đó mất lượt vĩnh viễn nếu chỉ
-- lọc đúng "= hôm nay".
--
-- MỘT KHÁCH NHIỀU ĐƠN CÙNG ĐẾN HẠN → ĐÚNG MỘT DÒNG, gộp danh sách sản phẩm.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.care_maintenance_due(
  p_date          date DEFAULT NULL,
  p_months        int  DEFAULT 6,
  p_window_days   int  DEFAULT 0,
  p_template_code text DEFAULT 'maintenance'
)
RETURNS TABLE (
  customer_id     text,
  customer_name   text,
  customer_code   text,
  phone           text,
  email           text,
  order_ids       text[],
  order_codes     text[],
  product_names   text[],
  order_count     int,
  first_due_date  date,
  last_shipped_at timestamptz,
  last_sent_at    timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT COALESCE(p_date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS today
  ),
  b AS (
    SELECT
      today,
      today - GREATEST(COALESCE(p_window_days, 0), 0) AS from_due,
      -- Pre-filter THÔ trên cột gốc để tận dụng idx_orders_shipped_at.
      -- Nới ±4 ngày vì luật kẹp ngày cuối tháng khiến phép nghịch đảo không
      -- khít: 28/02 − 6 tháng = 28/08, nhưng 29, 30, 31/08 cũng đến hạn
      -- đúng ngày đó. Lọc tinh làm ở bước due_f.
      ((today - GREATEST(COALESCE(p_window_days, 0), 0))
         - make_interval(months => p_months))::date - 4 AS raw_from,
      ((today - make_interval(months => p_months))::date + 4) AS raw_to
    FROM d
  ),
  due AS (
    SELECT
      o.id, o.code, o.customer_id,
      COALESCE(o.completed_at, o.created_at) AS shipped_at,
      (((COALESCE(o.completed_at, o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        + make_interval(months => p_months))::date AS due_date
    FROM public.orders o
    CROSS JOIN b
    WHERE o.status = 'completed'
      AND o.customer_id IS NOT NULL
      AND COALESCE(o.completed_at, o.created_at)
            >= (b.raw_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND COALESCE(o.completed_at, o.created_at)
            <  ((b.raw_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
  ),
  due_f AS (
    SELECT due.* FROM due CROSS JOIN b
     WHERE due.due_date BETWEEN b.from_due AND b.today
  ),
  items AS (
    SELECT DISTINCT f.customer_id, p.name AS product_name
      FROM due_f f
      JOIN public.order_items oi ON oi.order_id = f.id
      JOIN public.products    p  ON p.id = oi.product_id
  ),
  tpl AS (
    SELECT id FROM public.zns_templates WHERE code = p_template_code LIMIT 1
  )
  SELECT
    c.id, c.name, c.external_code, c.phone, c.email,
    array_agg(DISTINCT f.id)   AS order_ids,
    array_agg(DISTINCT f.code) AS order_codes,
    COALESCE((SELECT array_agg(i.product_name ORDER BY i.product_name)
                FROM items i WHERE i.customer_id = c.id), ARRAY[]::text[]) AS product_names,
    count(DISTINCT f.id)::int  AS order_count,
    min(f.due_date)            AS first_due_date,
    max(f.shipped_at)          AS last_shipped_at,
    (SELECT max(ml.sent_at)
       FROM public.message_logs ml
      WHERE ml.customer_id = c.id
        AND ml.status = 'SENT'
        AND ml.template_id = (SELECT id FROM tpl)) AS last_sent_at
  FROM due_f f
  JOIN public.customers c ON c.id = f.customer_id
  WHERE c.zalo_opt_out_at IS NULL
  GROUP BY c.id, c.name, c.external_code, c.phone, c.email
  ORDER BY c.name;
$$;

REVOKE ALL ON FUNCTION public.care_maintenance_due(date, int, int, text) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) RPC — SẢN PHẨM KÈM TỔNG TỒN KHO
--
-- Trang Hàng Hoá đang tải TOÀN BỘ bảng stock về trình duyệt rồi cộng bằng
-- JavaScript. Với nhiều chi nhánh thì số dòng = sản phẩm × chi nhánh, và
-- PostgREST cắt ở 1000 dòng → tổng bị thiếu ÂM THẦM.
-- Hàm này gộp ngay trong Postgres, trả đúng 1 dòng mỗi sản phẩm.
--
-- p_branch_id NULL/rỗng = tổng TOÀN HỆ THỐNG (mọi kho, mọi chi nhánh).
--
-- Ghi chú: KHÔNG dùng search_products_page có sẵn vì DB đang có HAI overload
-- trùng tên hàm đó → PostgREST trả lỗi PGRST203 "Could not choose the best
-- candidate function". Tạo hàm riêng tránh được mà không phải DROP gì.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.products_with_stock(
  p_branch_id text DEFAULT NULL
)
RETURNS TABLE (
  id          text,
  sku         text,
  name        text,
  category_id text,
  brand_id    text,
  power       text,
  color       text,
  blade_size  text,
  image_url   text,
  description text,
  cost_price  numeric,
  sale_price  numeric,
  tech_fee    numeric,
  min_stock   int,
  created_at  timestamptz,
  total_stock bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.sku, p.name, p.category_id, p.brand_id,
    p.power, p.color, p.blade_size, p.image_url, p.description,
    p.cost_price, p.sale_price, p.tech_fee, p.min_stock, p.created_at,
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

-- listProducts gọi bằng client anon thường (không phải service role) nên
-- hàm này BẮT BUỘC phải grant, khác hai hàm care_* ở trên.
GRANT EXECUTE ON FUNCTION public.products_with_stock(text) TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI CHẠY
-- ═══════════════════════════════════════════════════════════════════════════
-- Các con số kỳ vọng dưới đây đã được tính ĐỘC LẬP bằng script JS đọc thẳng
-- dữ liệu thật ngày 25/09/2026. Nếu RPC trả khác → logic SQL có vấn đề.
--
-- SELECT count(*) FROM public.care_birthdays_today();          -- kỳ vọng 3
-- SELECT count(*) FROM public.care_maintenance_due();          -- kỳ vọng 10
-- SELECT count(*) FROM public.care_employee_birthdays_today(); -- kỳ vọng 0 (chưa ai có ngày sinh)
-- SELECT sum(total_stock) FROM public.products_with_stock();   -- kỳ vọng 28854
-- SELECT sum(qty) FROM public.stock;                           -- phải bằng dòng trên
--
-- Kiểm luật kẹp ngày cuối tháng:
-- SELECT (date '2025-08-31' + interval '6 months')::date;  -- kỳ vọng 2026-02-28
-- SELECT (date '2025-03-31' + interval '6 months')::date;  -- kỳ vọng 2025-09-30
-- SELECT (date '2023-08-31' + interval '6 months')::date;  -- kỳ vọng 2024-02-29
