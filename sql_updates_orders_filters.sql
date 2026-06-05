-- ============================================================================
-- MIGRATION: Bộ lọc Đơn hàng (khách hàng / nhân viên / khoảng ngày)
-- Chạy 1 lần trong Supabase → SQL Editor. An toàn, có thể chạy lại nhiều lần.
--
-- Thay đổi: gộp 2 overload search_orders_page thành 1 hàm DUY NHẤT, bổ sung
-- lọc theo khách hàng (p_customer), nhân viên (p_employee) và khoảng ngày
-- (p_from / p_to). NGÀY DÙNG ĐỂ LỌC: đơn "completed" dùng completed_at, các
-- đơn khác dùng created_at — đúng yêu cầu nghiệp vụ. Toàn bộ logic cũ (tab
-- Hóa đơn/Đặt hàng, phân quyền chi nhánh p_branch_ids, sort, đếm tổng) GIỮ
-- NGUYÊN → kết quả mặc định (không lọc) không đổi.
-- ============================================================================

-- Xoá cả 2 overload cũ để tránh lỗi "function is not unique".
DROP FUNCTION IF EXISTS public.search_orders_page(text, text, text, text, text[], text, integer, integer);
DROP FUNCTION IF EXISTS public.search_orders_page(text, text, text, text, text, date, date, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_orders_page(
  p_search     text       DEFAULT NULL,
  p_status     text       DEFAULT NULL,
  p_branch     text       DEFAULT NULL,
  p_tab        text       DEFAULT 'orders',
  p_branch_ids text[]     DEFAULT NULL,
  p_employee   text       DEFAULT NULL,
  p_customer   text       DEFAULT NULL,
  p_from       date       DEFAULT NULL,
  p_to         date       DEFAULT NULL,
  p_sort       text       DEFAULT 'newest',
  p_limit      integer    DEFAULT 20,
  p_offset     integer    DEFAULT 0
)
RETURNS TABLE(
  id text, code text, status text,
  created_at timestamp with time zone, completed_at timestamp with time zone,
  total numeric, customer_id text, customer_name text,
  branch_id text, branch_name text,
  schedule_count bigint, filtered_count bigint
)
LANGUAGE sql
STABLE
AS $function$
  WITH base AS (
    SELECT
      o.id, o.code, o.status, o.created_at, o.completed_at, o.total,
      o.customer_id, c.name AS customer_name,
      o.branch_id, b.name AS branch_name,
      -- Ngày dùng để sort & lọc: đơn hoàn tất dùng completed_at, còn lại created_at.
      (CASE WHEN o.status = 'completed' AND o.completed_at IS NOT NULL
            THEN o.completed_at ELSE o.created_at END) AS activity_date
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN branches  b ON b.id = o.branch_id
    WHERE
      (p_branch_ids IS NULL OR o.branch_id = ANY (p_branch_ids))
      AND (CASE WHEN p_tab = 'reserved'
                THEN o.status = 'reserved'
                ELSE o.status IS DISTINCT FROM 'reserved' END)
      AND (p_status   IS NULL OR p_status   = '' OR o.status      = p_status)
      AND (p_branch   IS NULL OR p_branch   = '' OR o.branch_id   = p_branch)
      AND (p_employee IS NULL OR p_employee = '' OR o.employee_id = p_employee)
      AND (p_customer IS NULL OR p_customer = '' OR o.customer_id = p_customer)
      AND (p_from IS NULL OR
           ((CASE WHEN o.status = 'completed' AND o.completed_at IS NOT NULL
                  THEN o.completed_at ELSE o.created_at END)
             AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= p_from)
      AND (p_to IS NULL OR
           ((CASE WHEN o.status = 'completed' AND o.completed_at IS NOT NULL
                  THEN o.completed_at ELSE o.created_at END)
             AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= p_to)
      AND (
        p_search IS NULL OR p_search = ''
        OR o.code  ILIKE '%' || p_search || '%'
        OR c.name  ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (SELECT COUNT(*)::BIGINT AS n FROM base)
  SELECT
    base.id, base.code, base.status, base.created_at, base.completed_at, base.total,
    base.customer_id, base.customer_name, base.branch_id, base.branch_name,
    (SELECT COUNT(*)::BIGINT FROM schedules s WHERE s.order_id = base.id) AS schedule_count,
    (SELECT n FROM counted) AS filtered_count
  FROM base
  ORDER BY
    CASE WHEN p_sort = 'total_desc' THEN base.total END DESC NULLS LAST,
    CASE WHEN p_sort = 'total_asc'  THEN base.total END ASC  NULLS LAST,
    CASE WHEN p_sort = 'oldest'     THEN base.activity_date END ASC,
    CASE WHEN p_sort NOT IN ('total_desc','total_asc','oldest')
         THEN base.activity_date END DESC
  LIMIT  GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
$function$;
