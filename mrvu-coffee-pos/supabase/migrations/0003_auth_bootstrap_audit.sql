-- MR.VŨ COFFEE POS - 0003: tạo hồ sơ khi đăng ký, khởi tạo cửa hàng, quản lý vai trò, nhật ký

-- Tự tạo profile khi có tài khoản Supabase Auth mới.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
          coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Ghi nhật ký. Chỉ gọi từ các hàm RPC (SECURITY DEFINER), không cấp cho client.
create or replace function log_audit(p_store uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (store_id, user_id, action, entity, entity_id, detail)
  values (p_store, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function log_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Người dùng đầu tiên tạo cửa hàng và trở thành Owner.
-- Chỉ chạy được khi hệ thống chưa có cửa hàng nào (cài đặt lần đầu).
create or replace function rpc_bootstrap_store(p_name text, p_address text default '', p_phone text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  if auth.uid() is null then
    raise exception 'Bạn chưa đăng nhập.';
  end if;
  if exists (select 1 from stores) then
    raise exception 'Hệ thống đã được khởi tạo. Hãy nhờ chủ cửa hàng cấp quyền cho bạn.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Vui lòng nhập tên cửa hàng.';
  end if;

  insert into stores (name, address, phone) values (trim(p_name), coalesce(p_address, ''), coalesce(p_phone, ''))
  returning id into v_store;

  insert into user_roles (user_id, store_id, role) values (auth.uid(), v_store, 'owner');

  insert into payment_methods (store_id, code, name, is_cash, sort_order) values
    (v_store, 'cash', 'Tiền mặt', true, 1),
    (v_store, 'transfer', 'Chuyển khoản', false, 2);
  insert into print_settings (store_id) values (v_store);
  insert into cash_categories (store_id, name, type) values
    (v_store, 'Nhập nguyên liệu', 'expense'), (v_store, 'Lương nhân viên', 'expense'),
    (v_store, 'Điện nước, mặt bằng', 'expense'), (v_store, 'Chi khác', 'expense'),
    (v_store, 'Thu khác', 'income');

  perform log_audit(v_store, 'store.bootstrap', 'stores', v_store::text, jsonb_build_object('name', p_name));
  return v_store;
end $$;
revoke all on function rpc_bootstrap_store(text, text, text) from public, anon;
grant execute on function rpc_bootstrap_store(text, text, text) to authenticated;

-- Đổi vai trò. Chỉ người có users.manage; chỉ Owner mới được cấp/hạ vai trò Owner.
create or replace function rpc_set_user_role(p_store uuid, p_user uuid, p_role app_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller_role app_role; v_old app_role; v_owners int;
begin
  if not has_permission(p_store, 'users.manage') then
    raise exception 'Bạn không có quyền quản lý người dùng.';
  end if;
  select role into v_caller_role from user_roles where user_id = auth.uid() and store_id = p_store;
  select role into v_old from user_roles where user_id = p_user and store_id = p_store;

  if (p_role = 'owner' or v_old = 'owner') and v_caller_role <> 'owner' then
    raise exception 'Chỉ chủ cửa hàng mới được thay đổi vai trò Owner.';
  end if;
  if v_old = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from user_roles where store_id = p_store and role = 'owner';
    if v_owners <= 1 then
      raise exception 'Cửa hàng phải còn ít nhất một Owner.';
    end if;
  end if;

  insert into user_roles (user_id, store_id, role) values (p_user, p_store, p_role)
  on conflict (user_id, store_id) do update set role = excluded.role;

  perform log_audit(p_store, 'user.set_role', 'user_roles', p_user::text,
    jsonb_build_object('old', v_old, 'new', p_role));
end $$;
revoke all on function rpc_set_user_role(uuid, uuid, app_role) from public, anon;
grant execute on function rpc_set_user_role(uuid, uuid, app_role) to authenticated;

-- Khóa/mở tài khoản nhân viên.
create or replace function rpc_set_user_active(p_store uuid, p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_target app_role;
begin
  if not has_permission(p_store, 'users.manage') then
    raise exception 'Bạn không có quyền quản lý người dùng.';
  end if;
  select role into v_target from user_roles where user_id = p_user and store_id = p_store;
  if v_target is null then
    raise exception 'Người dùng không thuộc cửa hàng này.';
  end if;
  if p_user = auth.uid() and not p_active then
    raise exception 'Bạn không thể tự khóa tài khoản của mình.';
  end if;
  update profiles set active = p_active where id = p_user;
  perform log_audit(p_store, case when p_active then 'user.activate' else 'user.deactivate' end,
    'profiles', p_user::text, '{}'::jsonb);
end $$;
revoke all on function rpc_set_user_active(uuid, uuid, boolean) from public, anon;
grant execute on function rpc_set_user_active(uuid, uuid, boolean) to authenticated;
