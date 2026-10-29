-- MR.VŨ COFFEE POS - 0007: nghiệp vụ kho và nhập hàng (ghi sổ kho chỉ qua RPC, có audit)

create or replace function next_po_code(p_store uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_day text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('po:' || p_store::text || v_day));
  select coalesce(max(substring(code from '\d+$')::int), 0) + 1 into v_n
  from purchase_orders where store_id = p_store and code like 'PN-' || v_day || '-%';
  return 'PN-' || v_day || '-' || lpad(v_n::text, 3, '0');
end $$;
revoke all on function next_po_code(uuid) from public, anon, authenticated;

-- Hao hụt / điều chỉnh. p_quantity luôn dương: hao hụt trừ kho, điều chỉnh tăng cộng kho,
-- điều chỉnh giảm dùng p_direction = -1.
create or replace function rpc_adjust_stock(p_store uuid, p_ingredient uuid, p_type stock_movement_type,
  p_quantity numeric, p_direction int, p_reason text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_cur numeric; v_delta numeric;
begin
  if not has_permission(p_store, 'stock.adjust') then raise exception 'Bạn không có quyền điều chỉnh kho.'; end if;
  if p_type not in ('waste', 'adjustment') then raise exception 'Loại điều chỉnh không hợp lệ.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Số lượng phải lớn hơn 0.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Vui lòng nhập lý do.'; end if;
  select current_stock into v_cur from ingredients where id = p_ingredient and store_id = p_store for update;
  if not found then raise exception 'Không tìm thấy nguyên liệu.'; end if;
  v_delta := case when p_type = 'waste' then -p_quantity when p_direction < 0 then -p_quantity else p_quantity end;
  if p_type = 'waste' and v_cur + v_delta < 0 then
    raise exception 'Hao hụt (%) lớn hơn tồn kho hiện tại (%).', p_quantity, v_cur;
  end if;
  insert into stock_movements (store_id, ingredient_id, type, quantity, reason, created_by)
  values (p_store, p_ingredient, p_type, v_delta, trim(p_reason), auth.uid());
  perform log_audit(p_store, 'stock.' || p_type::text, 'ingredients', p_ingredient::text,
    jsonb_build_object('delta', v_delta, 'before', v_cur, 'reason', trim(p_reason)));
  return v_cur + v_delta;
end $$;
revoke all on function rpc_adjust_stock(uuid, uuid, stock_movement_type, numeric, int, text) from public, anon;
grant execute on function rpc_adjust_stock(uuid, uuid, stock_movement_type, numeric, int, text) to authenticated;

-- Kiểm kho: nhập số đếm thực tế, hệ thống tạo phiếu điều chỉnh phần chênh lệch.
create or replace function rpc_stocktake(p_store uuid, p_counts jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_cur numeric; v_counted numeric; v_delta numeric; v_changed int := 0; v_detail jsonb := '[]'::jsonb;
begin
  if not has_permission(p_store, 'stock.adjust') then raise exception 'Bạn không có quyền kiểm kho.'; end if;
  if jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) = 0 then raise exception 'Chưa có số liệu kiểm kho.'; end if;
  for c in select * from jsonb_array_elements(p_counts) order by (value ->> 'ingredient_id')
  loop
    v_counted := (c ->> 'counted')::numeric;
    if v_counted is null or v_counted < 0 then raise exception 'Số đếm thực tế không hợp lệ.'; end if;
    select current_stock into v_cur from ingredients where id = (c ->> 'ingredient_id')::uuid and store_id = p_store for update;
    if not found then raise exception 'Không tìm thấy nguyên liệu trong phiếu kiểm.'; end if;
    v_delta := v_counted - v_cur;
    if v_delta <> 0 then
      insert into stock_movements (store_id, ingredient_id, type, quantity, reason, created_by)
      values (p_store, (c ->> 'ingredient_id')::uuid, 'adjustment', v_delta, 'Kiểm kho' || case when coalesce(trim(p_note), '') <> '' then ': ' || trim(p_note) else '' end, auth.uid());
      v_changed := v_changed + 1;
      v_detail := v_detail || jsonb_build_object('ingredient_id', c ->> 'ingredient_id', 'before', v_cur, 'counted', v_counted);
    end if;
  end loop;
  perform log_audit(p_store, 'stock.stocktake', 'ingredients', '', jsonb_build_object('changed', v_changed, 'note', p_note, 'detail', v_detail));
  return jsonb_build_object('changed', v_changed);
end $$;
revoke all on function rpc_stocktake(uuid, jsonb, text) from public, anon;
grant execute on function rpc_stocktake(uuid, jsonb, text) to authenticated;

-- Lưu phiếu nhập (nháp hoặc đã đặt). Thay toàn bộ dòng trong một transaction.
create or replace function rpc_save_purchase(p_store uuid, p_id uuid, p_supplier uuid, p_note text, p_items jsonb, p_status po_status)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_status po_status; it jsonb; v_total numeric := 0;
begin
  if not has_permission(p_store, 'purchase.manage') then raise exception 'Bạn không có quyền nhập hàng.'; end if;
  if p_status not in ('draft', 'ordered') then raise exception 'Trạng thái phiếu không hợp lệ.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Phiếu nhập cần ít nhất một dòng.'; end if;
  if p_supplier is not null and not exists (select 1 from suppliers where id = p_supplier and store_id = p_store) then
    raise exception 'Nhà cung cấp không thuộc cửa hàng này.';
  end if;
  if v_id is null then
    insert into purchase_orders (store_id, supplier_id, code, status, note, created_by)
    values (p_store, p_supplier, next_po_code(p_store), p_status, coalesce(p_note, ''), auth.uid()) returning id into v_id;
  else
    select status into v_status from purchase_orders where id = v_id and store_id = p_store for update;
    if not found then raise exception 'Không tìm thấy phiếu nhập.'; end if;
    if v_status not in ('draft', 'ordered') then raise exception 'Phiếu đã nhận hoặc đã hủy, không sửa được.'; end if;
    update purchase_orders set supplier_id = p_supplier, note = coalesce(p_note, ''), status = p_status where id = v_id;
    delete from purchase_order_items where purchase_order_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(p_items)
  loop
    if (it ->> 'quantity')::numeric <= 0 then raise exception 'Số lượng nhập phải lớn hơn 0.'; end if;
    if (it ->> 'unit_cost')::numeric < 0 then raise exception 'Đơn giá không hợp lệ.'; end if;
    if not exists (select 1 from ingredients where id = (it ->> 'ingredient_id')::uuid and store_id = p_store) then
      raise exception 'Nguyên liệu không thuộc cửa hàng này.';
    end if;
    insert into purchase_order_items (purchase_order_id, store_id, ingredient_id, quantity, unit_cost)
    values (v_id, p_store, (it ->> 'ingredient_id')::uuid, (it ->> 'quantity')::numeric, (it ->> 'unit_cost')::numeric);
    v_total := v_total + round((it ->> 'quantity')::numeric * (it ->> 'unit_cost')::numeric);
  end loop;
  update purchase_orders set total = v_total where id = v_id;
  perform log_audit(p_store, 'purchase.save', 'purchase_orders', v_id::text, jsonb_build_object('status', p_status, 'total', v_total));
  return v_id;
end $$;
revoke all on function rpc_save_purchase(uuid, uuid, uuid, text, jsonb, po_status) from public, anon;
grant execute on function rpc_save_purchase(uuid, uuid, uuid, text, jsonb, po_status) to authenticated;

-- Nhận hàng: cộng kho và ghi giá nhập, một lần duy nhất (gọi lại trả kết quả cũ).
create or replace function rpc_receive_purchase(p_po uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; r record; v_total numeric := 0;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  if not has_permission(po.store_id, 'purchase.manage') then raise exception 'Bạn không có quyền nhập hàng.'; end if;
  if po.status = 'received' then return jsonb_build_object('id', po.id, 'code', po.code, 'replayed', true); end if;
  if po.status = 'cancelled' then raise exception 'Phiếu đã hủy.'; end if;
  if not exists (select 1 from purchase_order_items where purchase_order_id = po.id) then raise exception 'Phiếu không có dòng nào.'; end if;
  for r in select * from purchase_order_items where purchase_order_id = po.id order by ingredient_id
  loop
    perform 1 from ingredients where id = r.ingredient_id for update;
    insert into stock_movements (store_id, ingredient_id, type, quantity, reason, purchase_order_id, created_by)
    values (po.store_id, r.ingredient_id, 'purchase', r.quantity, 'Nhập hàng ' || po.code, po.id, auth.uid());
    insert into ingredient_prices (store_id, ingredient_id, unit_cost, supplier_id, recorded_by)
    values (po.store_id, r.ingredient_id, r.unit_cost, po.supplier_id, auth.uid());
    v_total := v_total + round(r.quantity * r.unit_cost);
  end loop;
  update purchase_orders set status = 'received', received_at = now(), total = v_total where id = po.id;
  perform log_audit(po.store_id, 'purchase.receive', 'purchase_orders', po.id::text, jsonb_build_object('code', po.code, 'total', v_total));
  return jsonb_build_object('id', po.id, 'code', po.code, 'total', v_total, 'replayed', false);
end $$;
revoke all on function rpc_receive_purchase(uuid) from public, anon;
grant execute on function rpc_receive_purchase(uuid) to authenticated;

create or replace function rpc_cancel_purchase(p_po uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  if not has_permission(po.store_id, 'purchase.manage') then raise exception 'Bạn không có quyền nhập hàng.'; end if;
  if po.status = 'received' then raise exception 'Phiếu đã nhận hàng, không hủy được. Hãy dùng điều chỉnh kho nếu nhập nhầm.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Vui lòng nhập lý do hủy.'; end if;
  update purchase_orders set status = 'cancelled', note = trim(note || ' [Hủy: ' || trim(p_reason) || ']') where id = po.id;
  perform log_audit(po.store_id, 'purchase.cancel', 'purchase_orders', po.id::text, jsonb_build_object('reason', p_reason));
end $$;
revoke all on function rpc_cancel_purchase(uuid, text) from public, anon;
grant execute on function rpc_cancel_purchase(uuid, text) to authenticated;

-- Công thức món: thay toàn bộ định lượng của món/biến thể trong một transaction.
create or replace function rpc_save_recipe(p_store uuid, p_product uuid, p_variant uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if not has_permission(p_store, 'inventory.manage') then raise exception 'Bạn không có quyền sửa công thức.'; end if;
  if not exists (select 1 from products where id = p_product and store_id = p_store) then raise exception 'Món không thuộc cửa hàng này.'; end if;
  if p_variant is not null and not exists (select 1 from product_variants where id = p_variant and product_id = p_product) then
    raise exception 'Biến thể không thuộc món này.';
  end if;
  delete from product_recipes where product_id = p_product and variant_id is not distinct from p_variant;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if (it ->> 'quantity')::numeric <= 0 then raise exception 'Định lượng phải lớn hơn 0.'; end if;
    if not exists (select 1 from ingredients where id = (it ->> 'ingredient_id')::uuid and store_id = p_store) then
      raise exception 'Nguyên liệu không thuộc cửa hàng này.';
    end if;
    insert into product_recipes (store_id, product_id, variant_id, ingredient_id, quantity)
    values (p_store, p_product, p_variant, (it ->> 'ingredient_id')::uuid, (it ->> 'quantity')::numeric);
  end loop;
  perform log_audit(p_store, 'recipe.save', 'products', p_product::text, jsonb_build_object('variant', p_variant, 'lines', jsonb_array_length(coalesce(p_items, '[]'::jsonb))));
end $$;
revoke all on function rpc_save_recipe(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function rpc_save_recipe(uuid, uuid, uuid, jsonb) to authenticated;
