-- MR.VŨ COFFEE POS - 0011: đăng nhập bằng TÊN ĐĂNG NHẬP + mật khẩu, mọi tài khoản tạo ngay trong ứng dụng.
-- Không cần Edge Function, Supabase CLI hay tạo user trong dashboard.
-- Tên đăng nhập "thungan1" được lưu trong Supabase Auth dưới dạng email nội bộ "thungan1@mrvu-cafe.local"
-- (không gửi thư, chỉ để Supabase Auth đăng nhập được). Đổi hậu tố này thì phải đổi cả src/lib/login.ts.

create or replace function login_email(p_username text) returns text
language sql immutable as $$ select lower(trim(coalesce(p_username, ''))) || '@mrvu-cafe.local' $$;

-- Tạo tài khoản Supabase Auth đã xác nhận. Chỉ gọi từ các RPC bên dưới, không cấp cho client.
create or replace function create_login(p_username text, p_password text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_user text := lower(trim(coalesce(p_username, '')));
  v_email text := login_email(p_username);
begin
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'Tên đăng nhập dài 3-32 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang.';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Tên đăng nhập "%" đã có người dùng.', v_user;
  end if;

  -- Các cột token để chuỗi rỗng (không NULL): Supabase Auth báo lỗi khi đăng nhập nếu gặp NULL.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', coalesce(trim(p_full_name), '')),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now());
  return v_id;  -- trigger on_auth_user_created (0003) tự tạo profiles
end $$;
revoke all on function create_login(text, text, text) from public, anon, authenticated;

-- Tạo cửa hàng + dữ liệu mặc định, p_owner thành Owner. Dùng chung cho rpc_bootstrap_store và rpc_first_setup.
create or replace function bootstrap_store(p_owner uuid, p_name text, p_address text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  if exists (select 1 from stores) then
    raise exception 'Hệ thống đã được khởi tạo. Hãy nhờ chủ cửa hàng cấp quyền cho bạn.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Vui lòng nhập tên cửa hàng.';
  end if;

  insert into stores (name, address, phone) values (trim(p_name), coalesce(p_address, ''), coalesce(p_phone, ''))
  returning id into v_store;

  insert into user_roles (user_id, store_id, role) values (p_owner, v_store, 'owner');

  insert into payment_methods (store_id, code, name, is_cash, sort_order) values
    (v_store, 'cash', 'Tiền mặt', true, 1),
    (v_store, 'transfer', 'Chuyển khoản', false, 2);
  insert into print_settings (store_id) values (v_store);
  insert into cash_categories (store_id, name, type) values
    (v_store, 'Nhập nguyên liệu', 'expense'), (v_store, 'Lương nhân viên', 'expense'),
    (v_store, 'Điện nước, mặt bằng', 'expense'), (v_store, 'Chi khác', 'expense'),
    (v_store, 'Thu khác', 'income');

  insert into audit_logs (store_id, user_id, action, entity, entity_id, detail)
  values (v_store, p_owner, 'store.bootstrap', 'stores', v_store::text, jsonb_build_object('name', p_name));
  return v_store;
end $$;
revoke all on function bootstrap_store(uuid, text, text, text) from public, anon, authenticated;

create or replace function rpc_bootstrap_store(p_name text, p_address text default '', p_phone text default '')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Bạn chưa đăng nhập.';
  end if;
  return bootstrap_store(auth.uid(), p_name, p_address, p_phone);
end $$;

-- Màn hình đăng nhập hỏi: đã cài đặt chưa? (chỉ trả true/false)
create or replace function rpc_setup_status() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from stores) $$;
revoke all on function rpc_setup_status() from public;
grant execute on function rpc_setup_status() to anon, authenticated;

-- Cài đặt lần đầu ngay trên màn hình đăng nhập: tạo cửa hàng + tài khoản chủ.
-- Chỉ chạy được khi chưa có cửa hàng nào; sau đó hàm bị khóa vĩnh viễn.
create or replace function rpc_first_setup(p_store_name text, p_address text, p_phone text,
  p_full_name text, p_username text, p_password text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  lock table stores in exclusive mode;  -- hai người bấm cùng lúc: người sau thấy "đã cài đặt"
  if exists (select 1 from stores) then
    raise exception 'Hệ thống đã được cài đặt. Hãy đăng nhập.';
  end if;
  if coalesce(trim(p_store_name), '') = '' then
    raise exception 'Vui lòng nhập tên cửa hàng.';
  end if;
  v_owner := create_login(p_username, p_password, p_full_name);
  perform bootstrap_store(v_owner, p_store_name, p_address, p_phone);
end $$;
revoke all on function rpc_first_setup(text, text, text, text, text, text) from public;
grant execute on function rpc_first_setup(text, text, text, text, text, text) to anon, authenticated;

-- Tạo tài khoản nhân viên (người có users.manage). Quy tắc vai trò Owner do rpc_set_user_role kiểm;
-- lỗi ở bất kỳ bước nào thì tài khoản vừa tạo cũng bị hủy (cùng một giao dịch).
create or replace function rpc_create_staff(p_store uuid, p_username text, p_password text, p_full_name text, p_role app_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_permission(p_store, 'users.manage') then
    raise exception 'Bạn không có quyền quản lý người dùng.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Vui lòng nhập họ tên.';
  end if;
  v_id := create_login(p_username, p_password, p_full_name);
  perform rpc_set_user_role(p_store, v_id, p_role);
  perform log_audit(p_store, 'user.create', 'profiles', v_id::text, jsonb_build_object('username', lower(trim(p_username))));
  return v_id;
end $$;
revoke all on function rpc_create_staff(uuid, text, text, text, app_role) from public, anon;
grant execute on function rpc_create_staff(uuid, text, text, text, app_role) to authenticated;

-- Đặt lại mật khẩu. Tự đổi của mình: ai cũng được. Đổi cho người khác: cần users.manage;
-- mật khẩu của Owner chỉ Owner đổi.
create or replace function rpc_set_password(p_store uuid, p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_caller app_role; v_target app_role;
begin
  select role into v_caller from user_roles where user_id = auth.uid() and store_id = p_store;
  if auth.uid() is null or v_caller is null then
    raise exception 'Bạn không có quyền quản lý người dùng.';
  end if;
  if p_user <> auth.uid() then
    if not has_permission(p_store, 'users.manage') then
      raise exception 'Bạn không có quyền quản lý người dùng.';
    end if;
    select role into v_target from user_roles where user_id = p_user and store_id = p_store;
    if v_target is null then
      raise exception 'Người dùng không thuộc cửa hàng này.';
    end if;
    if v_target = 'owner' and v_caller <> 'owner' then
      raise exception 'Chỉ chủ cửa hàng mới đổi được mật khẩu của Owner.';
    end if;
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự.';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  perform log_audit(p_store, 'user.set_password', 'profiles', p_user::text, '{}'::jsonb);
end $$;
revoke all on function rpc_set_password(uuid, uuid, text) from public, anon;
grant execute on function rpc_set_password(uuid, uuid, text) to authenticated;
