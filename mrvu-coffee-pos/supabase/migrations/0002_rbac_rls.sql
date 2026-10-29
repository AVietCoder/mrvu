-- MR.VŨ COFFEE POS - 0002: phân quyền (RBAC) và Row Level Security
-- Nguyên tắc: frontend ẩn nút chỉ để tiện dùng; mọi quyền thật được kiểm tra ở đây.

-- ---------- Quyền theo vai trò ----------
insert into role_permissions (role, permission)
select r, p from (values
  ('owner'::app_role), ('manager')
) as roles(r),
(values
  ('order.create'), ('order.pay'), ('discount.apply'), ('price.edit'),
  ('order.cancel'), ('order.refund'), ('drawer.open'),
  ('reports.view'), ('costs.view'), ('menu.manage'),
  ('inventory.view'), ('inventory.manage'), ('stock.adjust'), ('purchase.manage'),
  ('customers.manage'), ('shift.manage'), ('cash.manage'),
  ('settings.manage'), ('audit.view')
) as perms(p);

insert into role_permissions (role, permission) values
  ('owner', 'users.manage'),
  ('cashier', 'order.create'), ('cashier', 'order.pay'), ('cashier', 'customers.manage'),
  ('cashier', 'shift.manage'), ('cashier', 'cash.manage'), ('cashier', 'drawer.open'),
  ('staff', 'order.create');

-- ---------- Hàm kiểm tra quyền ----------
create or replace function is_member(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur join profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid() and ur.store_id = p_store and pr.active
  );
$$;

create or replace function has_permission(p_store uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_roles ur
    join profiles pr on pr.id = ur.user_id
    join role_permissions rp on rp.role = ur.role
    where ur.user_id = auth.uid() and ur.store_id = p_store
      and pr.active and rp.permission = p_perm
  );
$$;

revoke all on function is_member(uuid) from public, anon;
revoke all on function has_permission(uuid, text) from public, anon;
grant execute on function is_member(uuid), has_permission(uuid, text) to authenticated;

-- ---------- Bật RLS cho mọi bảng ----------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Không cho khách ẩn danh đụng vào dữ liệu.
revoke all on all tables in schema public from anon;

-- ---------- stores, profiles, user_roles ----------
create policy stores_select on stores for select to authenticated using (is_member(id));
create policy stores_update on stores for update to authenticated
  using (has_permission(id, 'settings.manage')) with check (has_permission(id, 'settings.manage'));

create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid()
  or exists (select 1 from user_roles a join user_roles b on a.store_id = b.store_id
             where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Người dùng chỉ tự sửa tên và số điện thoại, không tự bật/tắt tài khoản.
revoke update on profiles from authenticated;
grant update (full_name, phone) on profiles to authenticated;

create policy user_roles_select on user_roles for select to authenticated using (is_member(store_id));
create policy role_permissions_select on role_permissions for select to authenticated using (true);
-- Không có policy ghi cho user_roles/role_permissions: chỉ đổi vai trò qua rpc_set_user_role.

-- ---------- Danh mục, thực đơn ----------
do $$
declare t text;
begin
  foreach t in array array['categories', 'products', 'product_variants', 'modifiers', 'modifier_options']
  loop
    execute format('create policy %I on %I for select to authenticated using (is_member(store_id))', t || '_select', t);
    execute format($f$create policy %I on %I for all to authenticated
      using (has_permission(store_id, 'menu.manage')) with check (has_permission(store_id, 'menu.manage'))$f$,
      t || '_write', t);
  end loop;
end $$;

create policy product_modifiers_select on product_modifiers for select to authenticated using (
  exists (select 1 from products p where p.id = product_id and is_member(p.store_id)));
create policy product_modifiers_write on product_modifiers for all to authenticated
  using (exists (select 1 from products p where p.id = product_id and has_permission(p.store_id, 'menu.manage')))
  with check (exists (select 1 from products p where p.id = product_id and has_permission(p.store_id, 'menu.manage')));

create policy product_costs_select on product_costs for select to authenticated
  using (has_permission(store_id, 'costs.view'));
create policy product_costs_write on product_costs for all to authenticated
  using (has_permission(store_id, 'costs.view') and has_permission(store_id, 'menu.manage'))
  with check (has_permission(store_id, 'costs.view') and has_permission(store_id, 'menu.manage'));

-- Đổi giá bán cần quyền price.edit.
create or replace function guard_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.price is distinct from old.price
     and not has_permission(new.store_id, 'price.edit') then
    raise exception 'Bạn không có quyền thay đổi giá bán.';
  end if;
  return new;
end $$;
create trigger trg_products_price before update on products for each row execute function guard_price_change();
create trigger trg_variants_price before update on product_variants for each row execute function guard_price_change();

-- ---------- Bàn, khách hàng ----------
create policy tables_select on tables for select to authenticated using (is_member(store_id));
create policy tables_write on tables for all to authenticated
  using (has_permission(store_id, 'settings.manage')) with check (has_permission(store_id, 'settings.manage'));
-- Trạng thái bàn do RPC cập nhật theo order; client không tự đổi.

create policy customers_select on customers for select to authenticated using (is_member(store_id));
create policy customers_insert on customers for insert to authenticated
  with check (has_permission(store_id, 'customers.manage') or has_permission(store_id, 'order.create'));
create policy customers_update on customers for update to authenticated
  using (has_permission(store_id, 'customers.manage')) with check (has_permission(store_id, 'customers.manage'));
-- Điểm tích lũy, tổng chi tiêu, số đơn chỉ do hệ thống cập nhật.
revoke insert, update on customers from authenticated;
grant insert (store_id, name, phone, note) on customers to authenticated;
grant update (name, phone, note) on customers to authenticated;

-- ---------- Ca làm ----------
create policy shifts_select on shifts for select to authenticated
  using (opened_by = auth.uid() or has_permission(store_id, 'reports.view'));
-- Mở/đóng ca qua RPC.

-- ---------- Đơn hàng ----------
create policy orders_select on orders for select to authenticated using (is_member(store_id));
-- Mọi thay đổi order đi qua RPC (rpc_save_order, rpc_pay_order...) để đảm bảo transaction,
-- tính giá từ danh mục và khóa lạc quan. Client không ghi trực tiếp.

-- Giảm giá cần quyền discount.apply; tổng tiền luôn được tính lại trong DB.
create or replace function orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_disc numeric;
begin
  if tg_op = 'UPDATE' and (new.discount_amount is distinct from old.discount_amount
       or new.discount_percent is distinct from old.discount_percent)
     and not has_permission(new.store_id, 'discount.apply') then
    raise exception 'Bạn không có quyền áp dụng giảm giá.';
  end if;
  if tg_op = 'INSERT' and (new.discount_amount <> 0 or new.discount_percent <> 0)
     and not has_permission(new.store_id, 'discount.apply') then
    raise exception 'Bạn không có quyền áp dụng giảm giá.';
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  v_disc := least(new.subtotal, new.discount_amount + round(new.subtotal * new.discount_percent / 100));
  new.total := new.subtotal - v_disc + new.surcharge;
  return new;
end $$;
create trigger trg_orders_before_write before insert or update on orders
  for each row execute function orders_before_write();

create policy order_items_select on order_items for select to authenticated using (is_member(store_id));
create policy order_item_modifiers_select on order_item_modifiers for select to authenticated using (is_member(store_id));

create policy order_item_costs_select on order_item_costs for select to authenticated
  using (has_permission(store_id, 'costs.view'));

-- Giá dòng món phải khớp giá thực đơn, trừ khi có quyền price.edit.
create or replace function order_items_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_expected numeric; v_mods numeric;
begin
  if new.variant_id is not null then
    select price into v_expected from product_variants where id = new.variant_id;
  elsif new.product_id is not null then
    select price into v_expected from products where id = new.product_id;
  end if;
  -- Chỉ kiểm tra khi thêm dòng mới hoặc đổi đơn giá; chuyển/tách dòng cũ không bị chặn
  -- khi giá thực đơn đã đổi sau thời điểm bán.
  if v_expected is not null and (tg_op = 'INSERT' or new.unit_price is distinct from old.unit_price)
     and new.unit_price <> v_expected
     and not has_permission(new.store_id, 'price.edit') then
    raise exception 'Bạn không có quyền thay đổi giá bán.';
  end if;
  select coalesce(sum(price_delta), 0) into v_mods from order_item_modifiers where order_item_id = new.id;
  new.line_total := (new.unit_price + v_mods) * new.quantity;
  return new;
end $$;
create trigger trg_order_items_before before insert or update on order_items
  for each row execute function order_items_before_write();

create or replace function order_items_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_order uuid;
begin
  v_order := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  update orders set subtotal = (select coalesce(sum(line_total), 0) from order_items where order_id = v_order)
  where id = v_order;
  -- Dòng được chuyển sang đơn khác: tính lại cả đơn cũ.
  if tg_op = 'UPDATE' and old.order_id <> new.order_id then
    update orders set subtotal = (select coalesce(sum(line_total), 0) from order_items where order_id = old.order_id)
    where id = old.order_id;
  end if;
  return null;
end $$;
create trigger trg_order_items_after after insert or update or delete on order_items
  for each row execute function order_items_after_write();

create or replace function order_item_modifiers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_expected numeric;
begin
  if new.option_id is not null and (tg_op = 'INSERT' or new.price_delta is distinct from old.price_delta) then
    select price_delta into v_expected from modifier_options where id = new.option_id;
    if v_expected is not null and new.price_delta <> v_expected
       and not has_permission(new.store_id, 'price.edit') then
      raise exception 'Bạn không có quyền thay đổi giá tùy chọn.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_oim_before before insert or update on order_item_modifiers
  for each row execute function order_item_modifiers_before_write();

create or replace function order_item_modifiers_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item uuid;
begin
  v_item := case when tg_op = 'DELETE' then old.order_item_id else new.order_item_id end;
  update order_items set unit_price = unit_price where id = v_item;  -- kích hoạt tính lại line_total
  return null;
end $$;
create trigger trg_oim_after after insert or update or delete on order_item_modifiers
  for each row execute function order_item_modifiers_after_write();

-- ---------- Thanh toán, hóa đơn, in ----------
create policy payment_methods_select on payment_methods for select to authenticated using (is_member(store_id));
create policy payment_methods_write on payment_methods for all to authenticated
  using (has_permission(store_id, 'settings.manage')) with check (has_permission(store_id, 'settings.manage'));

create policy payments_select on payments for select to authenticated using (is_member(store_id));
create policy receipts_select on receipts for select to authenticated using (is_member(store_id));
create policy refunds_select on refunds for select to authenticated using (is_member(store_id));
-- payments/receipts chỉ được ghi qua RPC thanh toán.

create policy print_jobs_select on receipt_print_jobs for select to authenticated using (is_member(store_id));
create policy print_jobs_insert on receipt_print_jobs for insert to authenticated
  with check (has_permission(store_id, 'order.create') and requested_by = auth.uid());
create policy print_jobs_update on receipt_print_jobs for update to authenticated
  using (has_permission(store_id, 'order.create')) with check (has_permission(store_id, 'order.create'));

create policy print_settings_select on print_settings for select to authenticated using (is_member(store_id));
create policy print_settings_write on print_settings for all to authenticated
  using (has_permission(store_id, 'settings.manage')) with check (has_permission(store_id, 'settings.manage'));

-- ---------- Kho, nhập hàng ----------
do $$
declare t text;
begin
  foreach t in array array['ingredients', 'product_recipes', 'suppliers']
  loop
    execute format('create policy %I on %I for select to authenticated using (has_permission(store_id, ''inventory.view''))', t || '_select', t);
    execute format($f$create policy %I on %I for all to authenticated
      using (has_permission(store_id, 'inventory.manage')) with check (has_permission(store_id, 'inventory.manage'))$f$,
      t || '_write', t);
  end loop;
end $$;

create policy ingredient_prices_select on ingredient_prices for select to authenticated
  using (has_permission(store_id, 'inventory.view') and has_permission(store_id, 'costs.view'));
create policy ingredient_prices_insert on ingredient_prices for insert to authenticated
  with check (has_permission(store_id, 'purchase.manage') or has_permission(store_id, 'inventory.manage'));

create policy stock_movements_select on stock_movements for select to authenticated
  using (has_permission(store_id, 'inventory.view'));
-- Ghi sổ kho chỉ qua RPC (điều chỉnh, nhập hàng, bán hàng).

create policy purchase_orders_select on purchase_orders for select to authenticated
  using (has_permission(store_id, 'inventory.view'));
create policy purchase_orders_write on purchase_orders for all to authenticated
  using (has_permission(store_id, 'purchase.manage') and status in ('draft', 'ordered'))
  with check (has_permission(store_id, 'purchase.manage') and status in ('draft', 'ordered'));
create policy purchase_order_items_select on purchase_order_items for select to authenticated
  using (has_permission(store_id, 'inventory.view'));
create policy purchase_order_items_write on purchase_order_items for all to authenticated
  using (has_permission(store_id, 'purchase.manage') and exists (
    select 1 from purchase_orders p where p.id = purchase_order_id and p.status in ('draft', 'ordered')))
  with check (has_permission(store_id, 'purchase.manage') and exists (
    select 1 from purchase_orders p where p.id = purchase_order_id and p.status in ('draft', 'ordered')));

-- ---------- Thu chi ----------
create policy cash_categories_select on cash_categories for select to authenticated using (is_member(store_id));
create policy cash_categories_write on cash_categories for all to authenticated
  using (has_permission(store_id, 'cash.manage')) with check (has_permission(store_id, 'cash.manage'));
create policy cash_tx_select on cash_transactions for select to authenticated
  using (has_permission(store_id, 'cash.manage'));
create policy cash_tx_insert on cash_transactions for insert to authenticated
  with check (has_permission(store_id, 'cash.manage') and created_by = auth.uid());
-- Sai sót được sửa bằng phiếu bù, không sửa/xóa phiếu cũ.

-- ---------- Nhật ký ----------
create policy audit_logs_select on audit_logs for select to authenticated
  using (has_permission(store_id, 'audit.view'));
-- Ghi nhật ký qua hàm log_audit().
