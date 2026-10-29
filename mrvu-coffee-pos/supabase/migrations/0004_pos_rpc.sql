-- MR.VŨ COFFEE POS - 0004: nghiệp vụ POS chạy trong transaction (RPC)
-- Client không ghi trực tiếp vào orders/order_items/payments; mọi thay đổi đi qua các hàm dưới đây.
-- Giá luôn lấy từ danh mục phía database, không tin giá từ frontend.
-- Lỗi xung đột (hai người cùng sửa, thanh toán lần hai) dùng SQLSTATE 'MR409'.

-- ---------- Hàm nội bộ ----------
create or replace function next_order_code(p_store uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_day date; v_no int;
begin
  select timezone into v_tz from stores where id = p_store;
  v_day := (now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'))::date;
  insert into order_counters (store_id, day, last_no) values (p_store, v_day, 1)
  on conflict (store_id, day) do update set last_no = order_counters.last_no + 1
  returning last_no into v_no;
  return to_char(v_day, 'YYMMDD') || '-' || lpad(v_no::text, 4, '0');
end $$;
revoke all on function next_order_code(uuid) from public, anon, authenticated;

-- Cập nhật trạng thái bàn theo các order đang hoạt động trên bàn đó.
create or replace function refresh_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_active int; v_pending int;
begin
  if p_table is null then return; end if;
  select count(*), count(*) filter (where status = 'pending_payment')
    into v_active, v_pending
  from orders where table_id = p_table and status in ('draft', 'open', 'pending_payment');
  update tables set
    status = case when v_active = 0 then 'free'::table_status
                  when v_pending = v_active then 'pending_payment'::table_status
                  else 'occupied'::table_status end,
    opened_at = case when v_active = 0 then null else coalesce(opened_at, now()) end
  where id = p_table;
end $$;
revoke all on function refresh_table(uuid) from public, anon, authenticated;

-- ---------- Lưu order (tạo mới hoặc cập nhật, thay toàn bộ dòng món) ----------
-- p_items: [{product_id, variant_id?, quantity, note?, option_ids?: [uuid], price_override?}]
create or replace function rpc_save_order(
  p_store uuid, p_order_id uuid, p_type order_type, p_table_id uuid, p_customer_id uuid,
  p_note text, p_discount_amount numeric, p_discount_percent numeric, p_surcharge numeric,
  p_items jsonb, p_expected_version int, p_status order_status
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype; v_id uuid; v_old_table uuid;
  v_item jsonb; v_prod products%rowtype; v_var product_variants%rowtype;
  v_price numeric; v_qty int; v_item_id uuid; v_opt uuid; v_o modifier_options%rowtype;
  v_count int := 0; v_override numeric;
  v_group record;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if not has_permission(p_store, 'order.create') then
    raise exception 'Bạn không có quyền tạo hoặc sửa đơn.';
  end if;
  if p_status not in ('draft', 'open', 'pending_payment') then
    raise exception 'Trạng thái đơn không hợp lệ.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách món không hợp lệ.';
  end if;
  if p_status <> 'draft' and jsonb_array_length(p_items) = 0 then
    raise exception 'Đơn chưa có món nào.';
  end if;

  if p_type = 'dine_in' and p_table_id is null then raise exception 'Đơn tại bàn cần chọn bàn.'; end if;
  if p_type <> 'dine_in' and p_table_id is not null then raise exception 'Đơn mang đi/giao hàng không gắn bàn.'; end if;
  if p_type = 'delivery' and not (select enable_delivery from stores where id = p_store) then
    raise exception 'Cửa hàng chưa bật giao hàng.';
  end if;
  if p_table_id is not null and not exists (
    select 1 from tables where id = p_table_id and store_id = p_store and is_active) then
    raise exception 'Bàn không hợp lệ.';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from customers where id = p_customer_id and store_id = p_store) then
    raise exception 'Khách hàng không hợp lệ.';
  end if;

  if p_order_id is null then
    insert into orders (store_id, code, type, status, table_id, customer_id, note,
                        discount_amount, discount_percent, surcharge, created_by)
    values (p_store, next_order_code(p_store), p_type, p_status, p_table_id, p_customer_id,
            coalesce(p_note, ''), coalesce(p_discount_amount, 0), coalesce(p_discount_percent, 0),
            coalesce(p_surcharge, 0), auth.uid())
    returning id into v_id;
  else
    select * into v_order from orders where id = p_order_id for update;
    if not found or v_order.store_id <> p_store then raise exception 'Không tìm thấy đơn.'; end if;
    if v_order.status not in ('draft', 'open', 'pending_payment') then
      raise exception 'Đơn đã ở trạng thái % nên không thể sửa.', v_order.status using errcode = 'MR409';
    end if;
    if p_expected_version is distinct from v_order.version then
      raise exception 'Đơn đã được người khác cập nhật. Vui lòng tải lại đơn trước khi sửa.' using errcode = 'MR409';
    end if;
    v_id := v_order.id;
    v_old_table := v_order.table_id;
    update orders set type = p_type, status = p_status, table_id = p_table_id, customer_id = p_customer_id,
      note = coalesce(p_note, ''), discount_amount = coalesce(p_discount_amount, 0),
      discount_percent = coalesce(p_discount_percent, 0), surcharge = coalesce(p_surcharge, 0)
    where id = v_id;
    delete from order_items where order_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Số lượng không hợp lệ.'; end if;

    select * into v_prod from products
    where id = (v_item ->> 'product_id')::uuid and store_id = p_store;
    if not found then raise exception 'Món không tồn tại.'; end if;
    if not v_prod.is_active then raise exception 'Món "%" đã ngừng bán.', v_prod.name; end if;

    v_var := null;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_var from product_variants
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_prod.id and is_active;
      if not found then raise exception 'Biến thể của món "%" không hợp lệ.', v_prod.name; end if;
      v_price := v_var.price;
    else
      -- Món có biến thể thì bắt buộc chọn biến thể.
      if exists (select 1 from product_variants where product_id = v_prod.id and is_active) then
        raise exception 'Món "%" cần chọn size/biến thể.', v_prod.name;
      end if;
      v_price := v_prod.price;
    end if;

    v_override := nullif(v_item ->> 'price_override', '')::numeric;
    if v_override is not null and v_override <> v_price then
      if not has_permission(p_store, 'price.edit') then
        raise exception 'Bạn không có quyền thay đổi giá bán.';
      end if;
      if v_override < 0 then raise exception 'Giá không hợp lệ.'; end if;
      v_price := v_override;
    end if;

    insert into order_items (order_id, store_id, product_id, variant_id, name_snapshot, variant_snapshot,
                             unit_price, quantity, note)
    values (v_id, p_store, v_prod.id, v_var.id, v_prod.name, v_var.name, v_price, v_qty,
            left(coalesce(v_item ->> 'note', ''), 200))
    returning id into v_item_id;

    for v_opt in select t.value::uuid from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as t(value) loop
      select o.* into v_o from modifier_options o
      join product_modifiers pm on pm.modifier_id = o.modifier_id and pm.product_id = v_prod.id
      where o.id = v_opt and o.store_id = p_store and o.is_active;
      if not found then raise exception 'Tùy chọn không hợp lệ cho món "%".', v_prod.name; end if;
      insert into order_item_modifiers (order_item_id, store_id, option_id, name_snapshot, price_delta)
      values (v_item_id, p_store, v_o.id, v_o.name, v_o.price_delta);
    end loop;

    -- Kiểm tra số lựa chọn tối thiểu/tối đa của từng nhóm tùy chọn gắn với món.
    for v_group in
      select m.name, m.min_select, m.max_select,
        (select count(*) from order_item_modifiers im join modifier_options mo on mo.id = im.option_id
         where im.order_item_id = v_item_id and mo.modifier_id = m.id) as picked
      from modifiers m join product_modifiers pm on pm.modifier_id = m.id and pm.product_id = v_prod.id
    loop
      if v_group.picked < v_group.min_select then
        raise exception 'Món "%": vui lòng chọn "%" (tối thiểu %).', v_prod.name, v_group.name, v_group.min_select;
      end if;
      if v_group.picked > v_group.max_select then
        raise exception 'Món "%": "%" chọn tối đa %.', v_prod.name, v_group.name, v_group.max_select;
      end if;
    end loop;
    v_count := v_count + 1;
  end loop;

  perform refresh_table(v_old_table);
  perform refresh_table(p_table_id);

  select * into v_order from orders where id = v_id;
  return jsonb_build_object('id', v_order.id, 'code', v_order.code, 'version', v_order.version,
                            'status', v_order.status, 'total', v_order.total);
end $$;
revoke all on function rpc_save_order(uuid, uuid, order_type, uuid, uuid, text, numeric, numeric, numeric, jsonb, int, order_status) from public, anon;
grant execute on function rpc_save_order(uuid, uuid, order_type, uuid, uuid, text, numeric, numeric, numeric, jsonb, int, order_status) to authenticated;

-- ---------- Thanh toán (idempotent) ----------
-- p_payments: [{method_code, amount, tendered?, reference?}]; tổng amount phải bằng tổng đơn.
create or replace function rpc_pay_order(p_order_id uuid, p_payments jsonb, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype; v_receipt receipts%rowtype; v_pm payment_methods%rowtype;
  v_pay jsonb; v_line int := 0; v_sum numeric := 0; v_amount numeric; v_tendered numeric;
  v_change numeric; v_snapshot jsonb; v_cashier text; v_pay_rows jsonb := '[]'::jsonb;
  v_store stores%rowtype; v_shift uuid;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'Thiếu mã chống thanh toán trùng.';
  end if;

  -- Khóa dòng order: hai yêu cầu thanh toán đồng thời sẽ xếp hàng ở đây.
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(o.store_id, 'order.pay') then
    raise exception 'Bạn không có quyền thanh toán.';
  end if;

  if o.status in ('paid', 'refunded', 'partially_refunded') then
    if o.payment_key = p_idempotency_key then
      select * into v_receipt from receipts where order_id = o.id;
      return jsonb_build_object('order_id', o.id, 'receipt_id', v_receipt.id,
        'receipt_no', v_receipt.receipt_no, 'replayed', true);
    end if;
    raise exception 'Đơn này đã được thanh toán.' using errcode = 'MR409';
  end if;
  if o.status = 'cancelled' then raise exception 'Đơn đã hủy, không thể thanh toán.' using errcode = 'MR409'; end if;
  if not exists (select 1 from order_items where order_id = o.id) then
    raise exception 'Đơn chưa có món nào.';
  end if;
  if o.total <= 0 then
    raise exception 'Tổng thanh toán bằng 0. Hãy kiểm tra lại giảm giá hoặc hủy đơn.';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Chưa chọn phương thức thanh toán.';
  end if;

  select * into v_store from stores where id = o.store_id;
  select id into v_shift from shifts where store_id = o.store_id and opened_by = auth.uid() and status = 'open';

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_line := v_line + 1;
    select * into v_pm from payment_methods
    where store_id = o.store_id and code = (v_pay ->> 'method_code') and is_active;
    if not found then raise exception 'Phương thức thanh toán không hợp lệ.'; end if;

    v_amount := (v_pay ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) then
      raise exception 'Số tiền thanh toán không hợp lệ.';
    end if;

    v_tendered := null; v_change := 0;
    if v_pm.is_cash then
      v_tendered := coalesce(nullif(v_pay ->> 'tendered', '')::numeric, v_amount);
      if v_tendered < v_amount then raise exception 'Tiền khách đưa chưa đủ.'; end if;
      v_change := v_tendered - v_amount;
    end if;

    insert into payments (store_id, order_id, line_no, method_code, amount, tendered, change_amount, reference, created_by)
    values (o.store_id, o.id, v_line, v_pm.code, v_amount, v_tendered, v_change,
            left(nullif(v_pay ->> 'reference', ''), 100), auth.uid());
    v_sum := v_sum + v_amount;
    v_pay_rows := v_pay_rows || jsonb_build_object('method_code', v_pm.code, 'method_name', v_pm.name,
      'amount', v_amount, 'tendered', v_tendered, 'change', v_change, 'reference', nullif(v_pay ->> 'reference', ''));
  end loop;

  if v_sum <> o.total then
    raise exception 'Tổng tiền thanh toán (%) không khớp tổng đơn (%).', v_sum, o.total;
  end if;

  update orders set status = 'paid', paid_at = now(), cashier_id = auth.uid(),
    payment_key = p_idempotency_key, shift_id = v_shift
  where id = o.id;

  -- Hóa đơn: lưu nguyên ảnh chụp nội dung bill tại thời điểm thanh toán.
  select full_name into v_cashier from profiles where id = auth.uid();
  select jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'address', v_store.address, 'phone', v_store.phone, 'footer_note', v_store.footer_note),
    'order_code', o.code,
    'type', o.type,
    'table', (select name from tables where id = o.table_id),
    'cashier', v_cashier,
    'customer', (select jsonb_build_object('name', c.name, 'phone', c.phone) from customers c where c.id = o.customer_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.name_snapshot, 'variant', oi.variant_snapshot, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'note', oi.note, 'line_total', oi.line_total,
        'modifiers', coalesce((select jsonb_agg(jsonb_build_object('name', m.name_snapshot, 'price_delta', m.price_delta))
                               from order_item_modifiers m where m.order_item_id = oi.id), '[]'::jsonb))
        order by oi.created_at, oi.id)
      from order_items oi where oi.order_id = o.id), '[]'::jsonb),
    'subtotal', o.subtotal,
    'discount', o.subtotal + o.surcharge - o.total,
    'surcharge', o.surcharge,
    'total', o.total,
    'payments', v_pay_rows
  ) into v_snapshot;

  insert into receipts (store_id, order_id, receipt_no, issued_by, snapshot)
  values (o.store_id, o.id, 'HD-' || o.code, auth.uid(),
          v_snapshot || jsonb_build_object('receipt_no', 'HD-' || o.code))
  returning * into v_receipt;

  -- Giá vốn ước tính tại thời điểm bán (để báo cáo lợi nhuận không bị đổi hồi tố).
  insert into order_item_costs (order_item_id, store_id, unit_cost)
  select oi.id, o.store_id, pc.cost_estimate
  from order_items oi join product_costs pc on pc.product_id = oi.product_id
  where oi.order_id = o.id;

  -- Xuất kho theo công thức, một lần duy nhất cho mỗi đơn (ràng buộc unique stock_sale_once).
  insert into stock_movements (store_id, ingredient_id, type, quantity, reason, order_id, created_by)
  select o.store_id, r.ingredient_id, 'sale', -sum(r.quantity * oi.quantity), 'Bán hàng ' || o.code, o.id, auth.uid()
  from order_items oi
  join product_recipes r on r.product_id = oi.product_id and (r.variant_id is null or r.variant_id = oi.variant_id)
  where oi.order_id = o.id
  group by r.ingredient_id;

  if o.customer_id is not null then
    update customers set total_spent = total_spent + o.total, order_count = order_count + 1 where id = o.customer_id;
  end if;
  perform refresh_table(o.table_id);

  perform log_audit(o.store_id, 'order.pay', 'orders', o.id::text,
    jsonb_build_object('code', o.code, 'total', o.total, 'payments', v_pay_rows));

  return jsonb_build_object('order_id', o.id, 'receipt_id', v_receipt.id,
    'receipt_no', v_receipt.receipt_no, 'replayed', false);
end $$;
revoke all on function rpc_pay_order(uuid, jsonb, text) from public, anon;
grant execute on function rpc_pay_order(uuid, jsonb, text) to authenticated;

-- ---------- Hủy đơn chưa thanh toán ----------
create or replace function rpc_cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if o.status in ('paid', 'refunded', 'partially_refunded') then
    raise exception 'Đơn đã thanh toán. Hãy dùng chức năng hoàn tiền.' using errcode = 'MR409';
  end if;
  if o.status = 'cancelled' then raise exception 'Đơn đã được hủy trước đó.' using errcode = 'MR409'; end if;

  if o.status = 'draft' then
    if not has_permission(o.store_id, 'order.create') then raise exception 'Bạn không có quyền hủy đơn.'; end if;
  else
    if not has_permission(o.store_id, 'order.cancel') then raise exception 'Bạn không có quyền hủy đơn.'; end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Vui lòng nhập lý do hủy đơn.'; end if;
  end if;

  update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = o.id;
  perform refresh_table(o.table_id);
  perform log_audit(o.store_id, 'order.cancel', 'orders', o.id::text,
    jsonb_build_object('code', o.code, 'reason', p_reason, 'from_status', o.status));
end $$;
revoke all on function rpc_cancel_order(uuid, text) from public, anon;
grant execute on function rpc_cancel_order(uuid, text) to authenticated;

-- ---------- Hoàn tiền (toàn bộ hoặc một phần) ----------
-- Quy tắc kho: chỉ hoàn kho khi hoàn TOÀN BỘ đơn (nguyên liệu coi như đã dùng nếu hoàn một phần).
create or replace function rpc_refund_order(
  p_order_id uuid, p_amount numeric, p_reason text, p_method_code text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype; v_refund refunds%rowtype; v_remaining numeric; v_full boolean; v_restocked boolean := false;
begin
  if auth.uid() is null then raise exception 'Bạn chưa đăng nhập.'; end if;
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'Thiếu mã chống hoàn tiền trùng.'; end if;

  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(o.store_id, 'order.refund') then raise exception 'Bạn không có quyền hoàn tiền.'; end if;

  select * into v_refund from refunds where store_id = o.store_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('refund_id', v_refund.id, 'order_status', o.status, 'replayed', true);
  end if;

  if o.status not in ('paid', 'partially_refunded') then
    raise exception 'Chỉ hoàn tiền được cho đơn đã thanh toán.' using errcode = 'MR409';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Vui lòng nhập lý do hoàn tiền.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then raise exception 'Số tiền hoàn không hợp lệ.'; end if;
  if not exists (select 1 from payment_methods where store_id = o.store_id and code = p_method_code) then
    raise exception 'Phương thức hoàn tiền không hợp lệ.';
  end if;

  v_remaining := o.total - o.refunded_total;
  if p_amount > v_remaining then
    raise exception 'Số tiền hoàn vượt quá số còn có thể hoàn (%).', v_remaining;
  end if;
  v_full := (p_amount = v_remaining);

  if v_full then
    insert into stock_movements (store_id, ingredient_id, type, quantity, reason, order_id, created_by)
    select s.store_id, s.ingredient_id, 'sale_reversal', -s.quantity, 'Hoàn đơn ' || o.code, o.id, auth.uid()
    from stock_movements s where s.order_id = o.id and s.type = 'sale'
      and not exists (select 1 from stock_movements r where r.order_id = o.id and r.ingredient_id = s.ingredient_id and r.type = 'sale_reversal');
    v_restocked := found;
  end if;

  insert into refunds (store_id, order_id, amount, method_code, reason, idempotency_key, restocked, created_by)
  values (o.store_id, o.id, p_amount, p_method_code, trim(p_reason), p_idempotency_key, v_restocked, auth.uid())
  returning * into v_refund;

  perform set_config('app.allow_final_edit', 'on', true);
  update orders set refunded_total = refunded_total + p_amount,
    status = case when v_full then 'refunded'::order_status else 'partially_refunded'::order_status end
  where id = o.id;
  perform set_config('app.allow_final_edit', 'off', true);

  if o.customer_id is not null then
    update customers set total_spent = greatest(total_spent - p_amount, 0),
      order_count = case when v_full then greatest(order_count - 1, 0) else order_count end
    where id = o.customer_id;
  end if;

  perform log_audit(o.store_id, 'order.refund', 'orders', o.id::text,
    jsonb_build_object('code', o.code, 'amount', p_amount, 'full', v_full, 'reason', p_reason, 'restocked', v_restocked));
  return jsonb_build_object('refund_id', v_refund.id, 'order_status', case when v_full then 'refunded' else 'partially_refunded' end, 'replayed', false);
end $$;
revoke all on function rpc_refund_order(uuid, numeric, text, text, text) from public, anon;
grant execute on function rpc_refund_order(uuid, numeric, text, text, text) to authenticated;

-- ---------- Bàn: chuyển bàn, gộp order, tách/chuyển món ----------
create or replace function rpc_move_table(p_order_id uuid, p_new_table uuid, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_old uuid;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(o.store_id, 'order.create') then raise exception 'Bạn không có quyền chuyển bàn.'; end if;
  if o.status not in ('draft', 'open', 'pending_payment') then
    raise exception 'Đơn đã ở trạng thái % nên không thể chuyển bàn.', o.status using errcode = 'MR409';
  end if;
  if p_expected_version is distinct from o.version then
    raise exception 'Đơn đã được người khác cập nhật. Vui lòng tải lại.' using errcode = 'MR409';
  end if;
  if o.type <> 'dine_in' then raise exception 'Chỉ đơn tại bàn mới chuyển bàn được.'; end if;
  if not exists (select 1 from tables where id = p_new_table and store_id = o.store_id and is_active) then
    raise exception 'Bàn đích không hợp lệ.';
  end if;
  if p_new_table = o.table_id then raise exception 'Đơn đang ở bàn này.'; end if;
  if exists (select 1 from orders where table_id = p_new_table and status in ('draft', 'open', 'pending_payment')) then
    raise exception 'Bàn đích đang có đơn. Hãy dùng chức năng Gộp bàn.' using errcode = 'MR409';
  end if;
  v_old := o.table_id;
  update orders set table_id = p_new_table where id = o.id;
  perform refresh_table(v_old);
  perform refresh_table(p_new_table);
  perform log_audit(o.store_id, 'order.move_table', 'orders', o.id::text,
    jsonb_build_object('code', o.code, 'from', v_old, 'to', p_new_table));
  return jsonb_build_object('id', o.id, 'version', (select version from orders where id = o.id));
end $$;
revoke all on function rpc_move_table(uuid, uuid, int) from public, anon;
grant execute on function rpc_move_table(uuid, uuid, int) to authenticated;

-- Gộp toàn bộ món của order nguồn vào order đích; order nguồn được hủy với lý do "Gộp".
create or replace function rpc_merge_orders(p_source uuid, p_target uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s orders%rowtype; t orders%rowtype;
begin
  if p_source = p_target then raise exception 'Không thể gộp một đơn vào chính nó.'; end if;
  -- Khóa theo thứ tự id để tránh deadlock khi hai người gộp chéo nhau.
  perform 1 from orders where id in (p_source, p_target) order by id for update;
  select * into s from orders where id = p_source;
  select * into t from orders where id = p_target;
  if s.id is null or t.id is null then raise exception 'Không tìm thấy đơn.'; end if;
  if s.store_id <> t.store_id then raise exception 'Hai đơn thuộc cửa hàng khác nhau.'; end if;
  if not has_permission(s.store_id, 'order.create') then raise exception 'Bạn không có quyền gộp đơn.'; end if;
  if s.status not in ('draft', 'open', 'pending_payment') or t.status not in ('draft', 'open', 'pending_payment') then
    raise exception 'Chỉ gộp được các đơn chưa thanh toán.' using errcode = 'MR409';
  end if;

  update order_items set order_id = t.id where order_id = s.id;
  update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Gộp vào đơn ' || t.code
  where id = s.id;
  perform refresh_table(s.table_id);
  perform refresh_table(t.table_id);
  perform log_audit(s.store_id, 'order.merge', 'orders', t.id::text,
    jsonb_build_object('source', s.code, 'target', t.code));
  return jsonb_build_object('id', t.id, 'code', t.code, 'version', (select version from orders where id = t.id));
end $$;
revoke all on function rpc_merge_orders(uuid, uuid) from public, anon;
grant execute on function rpc_merge_orders(uuid, uuid) to authenticated;

-- Tách món sang order mới (p_to null) hoặc chuyển món sang order đã có. Chuyển nguyên dòng món.
create or replace function rpc_move_items(p_from uuid, p_item_ids uuid[], p_to uuid, p_new_table uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare f orders%rowtype; t orders%rowtype; v_to uuid; v_n int; v_total int; v_code text;
begin
  select * into f from orders where id = p_from;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(f.store_id, 'order.create') then raise exception 'Bạn không có quyền tách/chuyển món.'; end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then raise exception 'Chưa chọn món để chuyển.'; end if;
  if p_to = p_from then raise exception 'Đơn đích trùng đơn nguồn.'; end if;

  perform 1 from orders where id in (p_from, coalesce(p_to, p_from)) order by id for update;
  select * into f from orders where id = p_from;
  if f.status not in ('draft', 'open', 'pending_payment') then
    raise exception 'Đơn nguồn đã ở trạng thái % nên không thể sửa.', f.status using errcode = 'MR409';
  end if;

  select count(*) into v_total from order_items where order_id = f.id;
  select count(*) into v_n from order_items where order_id = f.id and id = any(p_item_ids);
  if v_n <> cardinality(p_item_ids) then raise exception 'Có món không thuộc đơn nguồn.'; end if;
  if v_n = v_total then raise exception 'Phải để lại ít nhất một món ở đơn nguồn. Dùng Chuyển bàn hoặc Gộp bàn nếu muốn chuyển cả đơn.'; end if;

  if p_to is null then
    if p_new_table is not null and not exists (select 1 from tables where id = p_new_table and store_id = f.store_id and is_active) then
      raise exception 'Bàn đích không hợp lệ.';
    end if;
    insert into orders (store_id, code, type, status, table_id, created_by)
    values (f.store_id, next_order_code(f.store_id),
            case when coalesce(p_new_table, f.table_id) is null then 'takeaway'::order_type else 'dine_in'::order_type end,
            'open', coalesce(p_new_table, f.table_id), auth.uid())
    returning id, code into v_to, v_code;
  else
    select * into t from orders where id = p_to;
    if not found or t.store_id <> f.store_id then raise exception 'Đơn đích không hợp lệ.'; end if;
    if t.status not in ('draft', 'open', 'pending_payment') then
      raise exception 'Đơn đích đã ở trạng thái % nên không thể nhận món.', t.status using errcode = 'MR409';
    end if;
    v_to := t.id; v_code := t.code;
  end if;

  update order_items set order_id = v_to where id = any(p_item_ids) and order_id = f.id;
  perform refresh_table(f.table_id);
  perform refresh_table((select table_id from orders where id = v_to));
  perform log_audit(f.store_id, 'order.move_items', 'orders', f.id::text,
    jsonb_build_object('from', f.code, 'to', v_code, 'items', p_item_ids));
  return jsonb_build_object('target_id', v_to, 'target_code', v_code);
end $$;
revoke all on function rpc_move_items(uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function rpc_move_items(uuid, uuid[], uuid, uuid) to authenticated;
