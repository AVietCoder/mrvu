-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V7 — 13/07/2026
--
-- Chạy TOÀN BỘ file này trong Supabase Dashboard → SQL Editor → Run.
--
-- 1) CÔNG NỢ danh sách khách hàng: TRỪ ĐƠN TRẢ HÀNG.
--    Trang chi tiết khách (recalculateCustomerDebt) tính:
--        debt = (tổng mua − tổng trả hàng) − đã thu + đã chi trả + điều chỉnh
--    nhưng 2 hàm dưới đây (bảng danh sách + thẻ "Tổng công nợ") lại thiếu
--    "− tổng trả hàng" → số ngoài danh sách LỆCH với số trong chi tiết.
--    Fix: thêm total_returned (SUM đơn status = 'returned') vào công thức.
--
-- 2) LỊCH SỬ KHO: hàm mới search_stock_history_page — lọc theo loại /
--    sản phẩm / khoảng ngày / chi nhánh và PHÂN TRANG ngay trong Postgres,
--    gộp 3 nguồn: stock_movements (nhập/xuất/chuyển), đơn bán hoàn thành,
--    đơn TRẢ HÀNG (loại mới bổ sung theo góp ý). Ghi chú phiếu chuyển được
--    JOIN thẳng từ stock_transfers nên phiếu đã xác nhận vẫn xem được ghi chú.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1a) search_customers_page: thêm total_returned vào công nợ ────────────
-- (đổi RETURNS TABLE nên phải DROP trước, CREATE OR REPLACE không đổi được cột)
DROP FUNCTION IF EXISTS public.search_customers_page(text, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_customers_page(
  p_search text DEFAULT NULL::text,
  p_group text DEFAULT NULL::text,
  p_debt_filter text DEFAULT 'all'::text,
  p_sort text DEFAULT 'date'::text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0)
 RETURNS TABLE(
   id text, name text, phone text, email text, address text, ward text,
   district text, province text, group_name text, customer_type text,
   company_name text, debt numeric, debt_adjustment numeric,
   total_buy numeric, total_returned numeric, total_paid numeric,
   total_paid_back numeric, computed_debt numeric, display_debt numeric,
   created_at timestamp with time zone, filtered_count bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_search text := NULLIF(trim(coalesce(p_search,'')),'');
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT c.*
    FROM customers c
    WHERE
      (v_search IS NULL
        OR c.name  ILIKE '%'||v_search||'%'
        OR c.phone ILIKE '%'||v_search||'%'
        OR c.email ILIKE '%'||v_search||'%')
      AND (p_group IS NULL OR p_group = '' OR c.group_name = p_group)
  ),
  agg AS (
    SELECT
      b.id,
      COALESCE((
        SELECT SUM(o.total) FROM orders o
        WHERE o.customer_id = b.id AND o.status = 'completed'
      ), 0)::numeric AS total_buy,
      -- ✅ MỚI: tổng giá trị hàng KHÁCH ĐÃ TRẢ (đơn trả hàng TH…)
      COALESCE((
        SELECT SUM(o.total) FROM orders o
        WHERE o.customer_id = b.id AND o.status = 'returned'
      ), 0)::numeric AS total_returned,
      COALESCE((
        SELECT SUM(v.amount) FROM cash_vouchers v
        WHERE v.payer_customer_id = b.id
          AND v.type = 'thu'
          AND (v.status IS NULL OR v.status <> 'cancelled')
      ), 0)::numeric AS total_paid,
      COALESCE((
        SELECT SUM(v.amount) FROM cash_vouchers v
        WHERE v.receiver_customer_id = b.id
          AND v.type = 'chi'
          AND (v.status IS NULL OR v.status <> 'cancelled')
      ), 0)::numeric AS total_paid_back
    FROM base b
  ),
  enriched AS (
    SELECT
      b.id, b.name, b.phone, b.email, b.address, b.ward, b.district, b.province,
      b.group_name, b.customer_type, b.company_name,
      b.debt, COALESCE(b.debt_adjustment, 0) AS debt_adjustment,
      a.total_buy, a.total_returned, a.total_paid, a.total_paid_back,
      -- ✅ CÔNG THỨC ĐỒNG BỘ với recalculateCustomerDebt (trang chi tiết):
      --    (mua − trả hàng) − đã thu + đã chi trả (+ điều chỉnh)
      (a.total_buy - a.total_returned - a.total_paid + a.total_paid_back) AS computed_debt,
      (a.total_buy - a.total_returned - a.total_paid + a.total_paid_back + COALESCE(b.debt_adjustment,0)) AS display_debt,
      b.created_at
    FROM base b
    JOIN agg a ON a.id = b.id
  ),
  filtered AS (
    SELECT * FROM enriched e
    WHERE
      (p_debt_filter = 'all')
      OR (p_debt_filter = 'debt'    AND e.display_debt > 0)
      OR (p_debt_filter = 'no_debt' AND e.display_debt <= 0)
  ),
  total AS ( SELECT COUNT(*)::bigint AS c FROM filtered )
  SELECT
    f.id, f.name, f.phone, f.email, f.address, f.ward, f.district, f.province,
    f.group_name, f.customer_type, f.company_name,
    f.debt, f.debt_adjustment,
    f.total_buy, f.total_returned, f.total_paid, f.total_paid_back,
    f.computed_debt, f.display_debt,
    f.created_at,
    (SELECT c FROM total) AS filtered_count
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort = 'name'           THEN f.name        END ASC  NULLS LAST,
    CASE WHEN p_sort = 'debt_desc'      THEN f.display_debt END DESC NULLS LAST,
    CASE WHEN p_sort = 'debt_asc'       THEN f.display_debt END ASC  NULLS LAST,
    CASE WHEN p_sort = 'total_buy_desc' THEN f.total_buy   END DESC NULLS LAST,
    CASE WHEN p_sort = 'total_buy_asc'  THEN f.total_buy   END ASC  NULLS LAST,
    CASE WHEN p_sort NOT IN ('name','debt_desc','debt_asc','total_buy_desc','total_buy_asc')
         THEN f.created_at END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$function$;


-- ─── 1b) customer_stats: thẻ "Tổng công nợ" đầu trang cũng trừ trả hàng ─────
CREATE OR REPLACE FUNCTION public.customer_stats()
 RETURNS TABLE(total_all_customers bigint, total_all_debt numeric, total_debtor_count bigint, total_sales numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH per AS (
    SELECT
      c.id,
      COALESCE(c.debt_adjustment, 0) AS adj,
      COALESCE((SELECT SUM(o.total) FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'completed'), 0) AS total_buy,
      COALESCE((SELECT SUM(o.total) FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'returned'), 0) AS total_returned,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.payer_customer_id = c.id AND v.type='thu'
                  AND (v.status IS NULL OR v.status<>'cancelled')), 0) AS total_paid,
      COALESCE((SELECT SUM(v.amount) FROM cash_vouchers v
                WHERE v.receiver_customer_id = c.id AND v.type='chi'
                  AND (v.status IS NULL OR v.status<>'cancelled')), 0) AS total_paid_back
    FROM customers c
  ),
  per2 AS (
    SELECT id,
           (total_buy - total_returned - total_paid + total_paid_back + adj) AS display_debt,
           total_buy
    FROM per
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM customers)                                   AS total_all_customers,
    COALESCE((SELECT SUM(display_debt) FROM per2 WHERE display_debt > 0), 0)   AS total_all_debt,
    (SELECT COUNT(*)::bigint FROM per2 WHERE display_debt > 0)                 AS total_debtor_count,
    COALESCE((SELECT SUM(total_buy) FROM per2), 0)                             AS total_sales;
$function$;


-- ─── 2) search_stock_history_page: lịch sử kho lọc + phân trang server ──────
DROP FUNCTION IF EXISTS public.search_stock_history_page(text, text, timestamptz, timestamptz, text[], integer, integer);

CREATE OR REPLACE FUNCTION public.search_stock_history_page(
  p_type text DEFAULT NULL,          -- 'in' | 'out' | 'transfer' | 'sale' | 'return' | NULL = tất cả
  p_product text DEFAULT NULL,       -- id sản phẩm
  p_from timestamptz DEFAULT NULL,   -- từ thời điểm
  p_to timestamptz DEFAULT NULL,     -- đến thời điểm
  p_branches text[] DEFAULT NULL,    -- giới hạn chi nhánh (phân quyền NV); NULL = xem tất cả
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
 RETURNS TABLE(
   id text, entry_type text, created_at timestamptz,
   product_id text, qty numeric, unit_cost numeric,
   from_branch text, to_branch text, note text,
   order_id text, order_code text, total numeric, customer_id text,
   items jsonb, filtered_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  WITH movements AS (
    SELECT
      m.id,
      m.type AS entry_type,
      m.created_at,
      m.product_id,
      m.qty::numeric AS qty,
      COALESCE(m.unit_cost, 0)::numeric AS unit_cost,
      -- phiếu cũ chỉ ghi branch_id: suy ra chiều kho từ loại phiếu
      COALESCE(m.from_branch, CASE WHEN m.type = 'out' THEN m.branch_id END) AS from_branch,
      COALESCE(m.to_branch,   CASE WHEN m.type = 'in'  THEN m.branch_id END) AS to_branch,
      -- phiếu chuyển: note trong movements = 'Phiếu chuyển kho <id>' →
      -- lấy ghi chú THẬT từ stock_transfers (kể cả phiếu đã xác nhận / hủy)
      CASE WHEN m.type = 'transfer' AND t.id IS NOT NULL THEN t.note ELSE m.note END AS note,
      NULL::text    AS order_id,
      NULL::text    AS order_code,
      NULL::numeric AS total,
      NULL::text    AS customer_id,
      NULL::jsonb   AS items
    FROM stock_movements m
    LEFT JOIN stock_transfers t
      ON m.type = 'transfer' AND m.note = 'Phiếu chuyển kho ' || t.id
    WHERE (p_type IS NULL OR m.type = p_type)
      AND (p_product IS NULL OR m.product_id = p_product)
  ),
  order_entries AS (
    SELECT
      (CASE WHEN o.status = 'completed' THEN 'sale__' ELSE 'return__' END) || o.id AS id,
      (CASE WHEN o.status = 'completed' THEN 'sale' ELSE 'return' END) AS entry_type,
      (CASE WHEN o.status = 'completed' THEN COALESCE(o.completed_at, o.created_at) ELSE o.created_at END) AS created_at,
      NULL::text AS product_id,
      COALESCE(oi.sum_qty, 0)::numeric AS qty,
      0::numeric AS unit_cost,
      -- bán hàng: XUẤT khỏi chi nhánh; trả hàng: NHẬP về chi nhánh
      (CASE WHEN o.status = 'completed' THEN o.branch_id END) AS from_branch,
      (CASE WHEN o.status = 'returned'  THEN o.branch_id END) AS to_branch,
      o.note,
      o.id   AS order_id,
      o.code AS order_code,
      o.total::numeric AS total,
      o.customer_id,
      oi.items
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT
        SUM(x.qty)::numeric AS sum_qty,
        jsonb_agg(jsonb_build_object(
          'product_id', x.product_id, 'qty', x.qty,
          'unit_price', x.unit_price, 'total', x.total)) AS items
      FROM order_items x
      WHERE x.order_id = o.id
    ) oi ON TRUE
    WHERE o.status IN ('completed', 'returned')
      AND (p_type IS NULL
           OR (p_type = 'sale'   AND o.status = 'completed')
           OR (p_type = 'return' AND o.status = 'returned'))
      AND (p_product IS NULL OR EXISTS (
            SELECT 1 FROM order_items z
            WHERE z.order_id = o.id AND z.product_id = p_product))
  ),
  all_entries AS (
    SELECT * FROM movements
    UNION ALL
    SELECT * FROM order_entries
  ),
  filtered AS (
    SELECT * FROM all_entries e
    WHERE (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to   IS NULL OR e.created_at <= p_to)
      AND (p_branches IS NULL
           OR e.from_branch = ANY(p_branches)
           OR e.to_branch   = ANY(p_branches))
  )
  SELECT
    f.id, f.entry_type, f.created_at,
    f.product_id, f.qty, f.unit_cost,
    f.from_branch, f.to_branch, f.note,
    f.order_id, f.order_code, f.total, f.customer_id,
    f.items,
    COUNT(*) OVER()::bigint AS filtered_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;


-- ─── Index hỗ trợ (bỏ qua nếu đã tồn tại) ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product    ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created      ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_product        ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status     ON public.orders (customer_id, status);
