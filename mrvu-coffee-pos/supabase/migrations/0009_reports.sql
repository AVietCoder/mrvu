-- MR.VŨ COFFEE POS - 0009: báo cáo bán hàng tổng hợp ngay trong database (múi giờ Asia/Ho_Chi_Minh)
--
-- Định nghĩa:
--  * Đơn tính doanh thu: trạng thái paid / partially_refunded / refunded, theo ngày thanh toán (paid_at).
--  * Doanh thu gộp = tổng total các đơn đó. Hoàn tiền = tổng refunds theo ngày hoàn.
--  * Doanh thu thuần = gộp - hoàn tiền. Giảm giá = subtotal + surcharge - total.
--  * Theo món / danh mục là doanh số theo từng dòng món, TRƯỚC giảm giá toàn đơn (nên tổng có thể lớn hơn doanh thu).
--  * Giá vốn (chỉ với quyền costs.view) = giá vốn tại thời điểm bán của các đơn chưa hoàn toàn bộ.
create or replace function rpc_report_sales(p_store uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_tz constant text := 'Asia/Ho_Chi_Minh';
  v_start timestamptz := (p_from::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  v_end timestamptz := ((p_to + 1)::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  v_can_cost boolean; v_result jsonb;
begin
  if not has_permission(p_store, 'reports.view') then raise exception 'Bạn không có quyền xem báo cáo.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ.'; end if;
  if p_to - p_from > 366 then raise exception 'Chỉ xem được tối đa 366 ngày mỗi lần.'; end if;
  v_can_cost := has_permission(p_store, 'costs.view');

  with o as (
    select id, total, subtotal, surcharge, status, paid_at, cashier_id from orders
    where store_id = p_store and status in ('paid', 'partially_refunded', 'refunded') and paid_at >= v_start and paid_at < v_end
  ), rf as (
    select coalesce(sum(amount), 0) as amt from refunds where store_id = p_store and created_at >= v_start and created_at < v_end
  ), cost as (
    select coalesce(sum(c.unit_cost * oi.quantity), 0) as amt
    from o join order_items oi on oi.order_id = o.id join order_item_costs c on c.order_item_id = oi.id where o.status <> 'refunded'
  ), sm as (
    select count(*) n, coalesce(sum(total), 0) gross, coalesce(sum(subtotal + surcharge - total), 0) disc from o
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'summary', (select jsonb_build_object(
        'orders', sm.n, 'gross', sm.gross, 'discount', sm.disc, 'refunds', rf.amt, 'net', sm.gross - rf.amt,
        'avg_order', case when sm.n = 0 then 0 else round(sm.gross / sm.n) end,
        'cost', case when v_can_cost then cost.amt else null end,
        'profit', case when v_can_cost then sm.gross - rf.amt - cost.amt else null end)
      from sm, rf, cost),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'orders', n, 'revenue', r) order by d) from (
      select (paid_at at time zone v_tz)::date d, count(*) n, sum(total) r from o group by 1) x), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'orders', n, 'revenue', r) order by h) from (
      select extract(hour from paid_at at time zone v_tz)::int h, count(*) n, sum(total) r from o group by 1) x), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m, 'name', nm, 'amount', a) order by a desc) from (
      select p.method_code m, coalesce(pm.name, p.method_code) nm, sum(p.amount) a
      from payments p join o on o.id = p.order_id left join payment_methods pm on pm.store_id = p.store_id and pm.code = p.method_code group by 1, 2) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('user_id', u, 'name', nm, 'orders', n, 'revenue', r) order by r desc) from (
      select o.cashier_id u, coalesce(pr.full_name, 'Không rõ') nm, count(*) n, sum(o.total) r from o left join profiles pr on pr.id = o.cashier_id group by 1, 2) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', nm, 'quantity', q, 'revenue', r) order by r desc) from (
      select oi.name_snapshot nm, sum(oi.quantity) q, sum(oi.line_total) r from order_items oi join o on o.id = oi.order_id
      where o.status <> 'refunded' group by 1 order by sum(oi.line_total) desc limit 15) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', nm, 'quantity', q, 'revenue', r) order by r desc) from (
      select coalesce(c.name, 'Khác') nm, sum(oi.quantity) q, sum(oi.line_total) r from order_items oi join o on o.id = oi.order_id
      left join products p on p.id = oi.product_id left join categories c on c.id = p.category_id where o.status <> 'refunded' group by 1) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function rpc_report_sales(uuid, date, date) from public, anon;
grant execute on function rpc_report_sales(uuid, date, date) to authenticated;

-- Tổng quan hôm nay: đơn đang mở, nguyên liệu sắp hết (chỉ đếm, không lộ giá vốn).
create or replace function rpc_dashboard(p_store uuid) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_low int := null;
begin
  if not has_permission(p_store, 'reports.view') then raise exception 'Bạn không có quyền xem tổng quan.'; end if;
  if has_permission(p_store, 'inventory.view') then
    select count(*) into v_low from ingredients where store_id = p_store and is_active and current_stock <= greatest(min_stock, 0) and (min_stock > 0 or current_stock <= 0);
  end if;
  return jsonb_build_object(
    'today', rpc_report_sales(p_store, v_today, v_today) -> 'summary',
    'yesterday', rpc_report_sales(p_store, v_today - 1, v_today - 1) -> 'summary',
    'open_orders', (select count(*) from orders where store_id = p_store and status in ('open', 'pending_payment')),
    'low_stock', v_low
  );
end $$;
revoke all on function rpc_dashboard(uuid) from public, anon;
grant execute on function rpc_dashboard(uuid) to authenticated;
