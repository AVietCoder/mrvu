-- MR.VŨ COFFEE POS - 0008: ca làm việc, đối chiếu tiền mặt, thu chi

-- Tổng hợp tiền trong ca. Tiền mặt dự kiến = tiền đầu ca + bán tiền mặt + thu khác - chi tiền mặt - hoàn tiền mặt.
create or replace function shift_summary(p_shift uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shifts%rowtype; v_end timestamptz; v_cash_sales numeric; v_other jsonb; v_in numeric; v_out numeric; v_ref numeric; v_orders int;
begin
  select * into s from shifts where id = p_shift;
  if not found then raise exception 'Không tìm thấy ca.'; end if;
  if not (s.opened_by = auth.uid() or has_permission(s.store_id, 'reports.view')) then raise exception 'Bạn không có quyền xem ca này.'; end if;
  v_end := coalesce(s.closed_at, now());

  select coalesce(sum(p.amount), 0) into v_cash_sales
  from payments p join orders o on o.id = p.order_id
  join payment_methods pm on pm.store_id = p.store_id and pm.code = p.method_code
  where o.shift_id = s.id and pm.is_cash;

  select coalesce(jsonb_object_agg(code, total), '{}'::jsonb) into v_other from (
    select p.method_code as code, sum(p.amount) as total
    from payments p join orders o on o.id = p.order_id
    join payment_methods pm on pm.store_id = p.store_id and pm.code = p.method_code
    where o.shift_id = s.id and not pm.is_cash group by p.method_code) t;

  select coalesce(sum(amount) filter (where type = 'income'), 0), coalesce(sum(amount) filter (where type = 'expense'), 0)
    into v_in, v_out from cash_transactions where shift_id = s.id and method_code = 'cash';

  -- Hoàn tiền mặt do người mở ca thực hiện trong khoảng thời gian của ca.
  select coalesce(sum(r.amount), 0) into v_ref
  from refunds r join payment_methods pm on pm.store_id = r.store_id and pm.code = r.method_code
  where r.store_id = s.store_id and pm.is_cash and r.created_by = s.opened_by and r.created_at >= s.opened_at and r.created_at <= v_end;

  select count(*) into v_orders from orders where shift_id = s.id and status in ('paid', 'partially_refunded', 'refunded');

  return jsonb_build_object('shift_id', s.id, 'opening_cash', s.opening_cash, 'cash_sales', v_cash_sales, 'other_sales', v_other,
    'cash_in', v_in, 'cash_out', v_out, 'cash_refunds', v_ref, 'orders', v_orders,
    'expected_cash', s.opening_cash + v_cash_sales + v_in - v_out - v_ref);
end $$;
revoke all on function shift_summary(uuid) from public, anon;
grant execute on function shift_summary(uuid) to authenticated;

create or replace function rpc_open_shift(p_store uuid, p_opening_cash numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_permission(p_store, 'shift.manage') then raise exception 'Bạn không có quyền mở ca.'; end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash <> round(p_opening_cash) then raise exception 'Tiền đầu ca không hợp lệ.'; end if;
  if exists (select 1 from shifts where store_id = p_store and opened_by = auth.uid() and status = 'open') then
    raise exception 'Bạn đang có một ca đang mở. Hãy đóng ca đó trước.';
  end if;
  insert into shifts (store_id, opened_by, opening_cash) values (p_store, auth.uid(), p_opening_cash) returning id into v_id;
  perform log_audit(p_store, 'shift.open', 'shifts', v_id::text, jsonb_build_object('opening_cash', p_opening_cash));
  return v_id;
end $$;
revoke all on function rpc_open_shift(uuid, numeric) from public, anon;
grant execute on function rpc_open_shift(uuid, numeric) to authenticated;

create or replace function rpc_close_shift(p_shift uuid, p_counted numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shifts%rowtype; v_sum jsonb; v_exp numeric; v_diff numeric; v_open_orders int;
begin
  select * into s from shifts where id = p_shift for update;
  if not found then raise exception 'Không tìm thấy ca.'; end if;
  if not has_permission(s.store_id, 'shift.manage') then raise exception 'Bạn không có quyền đóng ca.'; end if;
  if s.opened_by <> auth.uid() and not has_permission(s.store_id, 'reports.view') then raise exception 'Chỉ người mở ca hoặc quản lý mới đóng được ca này.'; end if;
  if s.status = 'closed' then raise exception 'Ca này đã đóng.'; end if;
  if p_counted is null or p_counted < 0 or p_counted <> round(p_counted) then raise exception 'Tiền đếm thực tế không hợp lệ.'; end if;

  v_sum := shift_summary(s.id);
  v_exp := (v_sum ->> 'expected_cash')::numeric;
  v_diff := p_counted - v_exp;
  if v_diff <> 0 and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Tiền đếm lệch % so với dự kiến. Vui lòng ghi lý do.', v_diff;
  end if;
  select count(*) into v_open_orders from orders where store_id = s.store_id and created_by = s.opened_by and status in ('open', 'pending_payment');

  update shifts set status = 'closed', closed_by = auth.uid(), closed_at = now(), expected_cash = v_exp, counted_cash = p_counted,
    difference = v_diff, note = coalesce(trim(p_note), '') where id = s.id;
  perform log_audit(s.store_id, 'shift.close', 'shifts', s.id::text, jsonb_build_object('expected', v_exp, 'counted', p_counted, 'difference', v_diff, 'note', p_note));
  return v_sum || jsonb_build_object('counted_cash', p_counted, 'difference', v_diff, 'open_orders', v_open_orders);
end $$;
revoke all on function rpc_close_shift(uuid, numeric, text) from public, anon;
grant execute on function rpc_close_shift(uuid, numeric, text) to authenticated;

-- Thu/chi: gắn vào ca đang mở của người ghi. Tiền mặt bắt buộc có ca mở để đối chiếu két.
create or replace function rpc_add_cash_tx(p_store uuid, p_type cash_tx_type, p_category uuid, p_amount numeric, p_method text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_shift uuid; v_id uuid; v_method text := coalesce(nullif(trim(p_method), ''), 'cash');
begin
  if not has_permission(p_store, 'cash.manage') then raise exception 'Bạn không có quyền ghi thu chi.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) then raise exception 'Số tiền không hợp lệ.'; end if;
  if length(trim(coalesce(p_description, ''))) < 3 then raise exception 'Vui lòng nhập diễn giải.'; end if;
  if not exists (select 1 from payment_methods where store_id = p_store and code = v_method) then raise exception 'Phương thức không hợp lệ.'; end if;
  if p_category is not null and not exists (select 1 from cash_categories where id = p_category and store_id = p_store and type = p_type) then
    raise exception 'Danh mục không phù hợp.';
  end if;
  select id into v_shift from shifts where store_id = p_store and opened_by = auth.uid() and status = 'open';
  if v_method = 'cash' and v_shift is null then raise exception 'Cần mở ca trước khi ghi thu chi tiền mặt.'; end if;
  insert into cash_transactions (store_id, shift_id, type, category_id, amount, method_code, description, created_by)
  values (p_store, v_shift, p_type, p_category, p_amount, v_method, trim(p_description), auth.uid()) returning id into v_id;
  perform log_audit(p_store, 'cash.' || p_type::text, 'cash_transactions', v_id::text, jsonb_build_object('amount', p_amount, 'method', v_method, 'description', trim(p_description)));
  return v_id;
end $$;
revoke all on function rpc_add_cash_tx(uuid, cash_tx_type, uuid, numeric, text, text) from public, anon;
grant execute on function rpc_add_cash_tx(uuid, cash_tx_type, uuid, numeric, text, text) to authenticated;

-- Ghi thu chi chỉ qua RPC (để gắn ca đúng và có audit).
drop policy if exists cash_tx_insert on cash_transactions;
revoke insert, update, delete on cash_transactions from authenticated;
