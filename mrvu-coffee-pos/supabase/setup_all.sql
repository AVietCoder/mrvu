-- MR.VŨ COFFEE POS: gộp 11 migration (0001_core_schema.sql .. 0011_username_login.sql).
-- CHỈ chạy MỘT LẦN trên dự án Supabase mới, còn trống. Không chạy lại trên dữ liệu đang dùng.

-- ===== 0001_core_schema.sql =====
-- MR.VŨ COFFEE POS - 0001: schema lõi
-- Tiền tệ: numeric(14,0) (VND không có số lẻ). Thời gian: timestamptz.
-- Mọi bảng nghiệp vụ có store_id để mở rộng nhiều chi nhánh.

create extension if not exists pgcrypto;

-- ---------- Kiểu liệt kê ----------
create type app_role as enum ('owner', 'manager', 'cashier', 'staff');
create type order_type as enum ('dine_in', 'takeaway', 'delivery');
create type order_status as enum ('draft', 'open', 'pending_payment', 'paid', 'cancelled', 'refunded', 'partially_refunded');
create type table_status as enum ('free', 'occupied', 'pending_payment');
-- queued: đã tạo job; processing: đang gửi; submitted: cầu nối đã nhận lệnh;
-- success: cầu nối xác nhận hoàn tất; failed: lỗi rõ ràng; retry_pending: chờ in lại;
-- unknown: timeout, không biết đã in hay chưa (người dùng kiểm tra giấy rồi quyết định).
create type print_status as enum ('queued', 'processing', 'submitted', 'success', 'failed', 'retry_pending', 'unknown');
create type print_kind as enum ('receipt', 'reprint', 'kitchen', 'test');
create type stock_movement_type as enum ('opening', 'purchase', 'sale', 'sale_reversal', 'waste', 'adjustment');
create type cash_tx_type as enum ('income', 'expense');
create type shift_status as enum ('open', 'closed');
create type po_status as enum ('draft', 'ordered', 'received', 'cancelled');

-- ---------- Hàm dùng chung ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Cửa hàng, người dùng ----------
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  phone text not null default '',
  footer_note text not null default 'Cảm ơn quý khách. Hẹn gặp lại!',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  enable_delivery boolean not null default false,
  enable_loyalty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_stores_updated before update on stores for each row execute function set_updated_at();

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();

create table user_roles (
  user_id uuid not null references profiles(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index user_roles_store_idx on user_roles(store_id);

create table role_permissions (
  role app_role not null,
  permission text not null,
  primary key (role, permission)
);

-- ---------- Thực đơn ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  code text not null,
  name text not null,
  image_url text,
  price numeric(14,0) not null check (price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code)
);
create index products_category_idx on products(category_id);
create trigger trg_products_updated before update on products for each row execute function set_updated_at();

-- Giá vốn tách bảng để chỉ người có quyền costs.view mới đọc được.
create table product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  cost_estimate numeric(14,0) not null default 0 check (cost_estimate >= 0)
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,              -- ví dụ: Size M, Size L, Nóng, Đá
  price numeric(14,0) not null check (price >= 0), -- giá bán đầy đủ của biến thể
  is_active boolean not null default true,
  sort_order int not null default 0
);
create index product_variants_product_idx on product_variants(product_id);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,              -- Topping, Đường, Đá, Sữa
  min_select int not null default 0,
  max_select int not null default 1,
  sort_order int not null default 0,
  check (min_select >= 0 and max_select >= min_select)
);

create table modifier_options (
  id uuid primary key default gen_random_uuid(),
  modifier_id uuid not null references modifiers(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  price_delta numeric(14,0) not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);
create index modifier_options_modifier_idx on modifier_options(modifier_id);

create table product_modifiers (
  product_id uuid not null references products(id) on delete cascade,
  modifier_id uuid not null references modifiers(id) on delete cascade,
  primary key (product_id, modifier_id)
);

-- ---------- Bàn, khách hàng, ca ----------
create table tables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  area text not null default '',
  seats int not null default 2 check (seats > 0),
  status table_status not null default 'free',
  opened_at timestamptz,
  is_active boolean not null default true,
  unique (store_id, name)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text,
  note text not null default '',
  points int not null default 0,
  total_spent numeric(14,0) not null default 0,
  order_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Số điện thoại KHÔNG duy nhất (nghiệp vụ chưa quy định), chỉ đánh index để tìm nhanh.
create index customers_phone_idx on customers(store_id, phone);
create trigger trg_customers_updated before update on customers for each row execute function set_updated_at();

create table shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  opened_by uuid not null references profiles(id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(14,0) not null default 0 check (opening_cash >= 0),
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  expected_cash numeric(14,0),
  counted_cash numeric(14,0),
  difference numeric(14,0),
  status shift_status not null default 'open',
  note text not null default ''
);
create index shifts_store_idx on shifts(store_id, opened_at desc);
-- Mỗi người chỉ mở một ca tại một thời điểm.
create unique index shifts_one_open_per_user on shifts(store_id, opened_by) where status = 'open';

-- ---------- Đơn hàng ----------
create table order_counters (
  store_id uuid not null references stores(id) on delete cascade,
  day date not null,
  last_no int not null default 0,
  primary key (store_id, day)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  code text not null,
  type order_type not null default 'takeaway',
  status order_status not null default 'draft',
  table_id uuid references tables(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  shift_id uuid references shifts(id),
  subtotal numeric(14,0) not null default 0,
  discount_amount numeric(14,0) not null default 0 check (discount_amount >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  surcharge numeric(14,0) not null default 0 check (surcharge >= 0),
  total numeric(14,0) not null default 0,
  note text not null default '',
  version int not null default 1,          -- khóa lạc quan: phát hiện hai người cùng sửa một đơn
  payment_key text,                        -- idempotency key của lần thanh toán
  refunded_total numeric(14,0) not null default 0,
  created_by uuid not null references profiles(id),
  cashier_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  unique (store_id, code)
);
create index orders_store_status_idx on orders(store_id, status);
create index orders_store_created_idx on orders(store_id, created_at desc);
create index orders_table_idx on orders(table_id) where status in ('draft', 'open', 'pending_payment');
create index orders_customer_idx on orders(customer_id);
create unique index orders_payment_key_uq on orders(store_id, payment_key) where payment_key is not null;
create trigger trg_orders_updated before update on orders for each row execute function set_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  -- Ảnh chụp tại thời điểm bán: sửa giá/tên sản phẩm sau này không đổi lịch sử.
  name_snapshot text not null,
  variant_snapshot text,
  unit_price numeric(14,0) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  note text not null default '',
  line_total numeric(14,0) not null default 0,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on order_items(order_id);

create table order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  option_id uuid references modifier_options(id) on delete set null,
  name_snapshot text not null,
  price_delta numeric(14,0) not null default 0
);
create index order_item_modifiers_item_idx on order_item_modifiers(order_item_id);

-- Giá vốn tại thời điểm bán, chỉ người có costs.view đọc được.
create table order_item_costs (
  order_item_id uuid primary key references order_items(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  unit_cost numeric(14,0) not null default 0
);

-- ---------- Thanh toán, hóa đơn, in ----------
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  code text not null,
  name text not null,
  is_cash boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  unique (store_id, code)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references orders(id),
  line_no int not null,                   -- thanh toán kết hợp: mỗi phương thức một dòng
  method_code text not null,
  amount numeric(14,0) not null check (amount > 0),   -- số tiền được tính vào hóa đơn
  tendered numeric(14,0),                 -- tiền khách đưa (chỉ tiền mặt)
  change_amount numeric(14,0) not null default 0,     -- tiền thừa trả khách
  reference text,                         -- mã giao dịch chuyển khoản, ghi nhận thủ công
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (order_id, line_no),
  check (tendered is null or tendered >= amount)
);
create index payments_order_idx on payments(order_id);
create index payments_store_created_idx on payments(store_id, created_at desc);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references orders(id),
  amount numeric(14,0) not null check (amount > 0),
  method_code text not null,
  reason text not null check (length(trim(reason)) >= 3),
  idempotency_key text not null,
  restocked boolean not null default false,   -- true nếu đã hoàn kho (chỉ khi hoàn toàn bộ)
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);
create index refunds_order_idx on refunds(order_id);
create index refunds_store_created_idx on refunds(store_id, created_at desc);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references orders(id),
  receipt_no text not null,
  issued_by uuid not null references profiles(id),
  issued_at timestamptz not null default now(),
  snapshot jsonb not null,                -- toàn bộ nội dung bill tại thời điểm thanh toán
  unique (store_id, receipt_no),
  unique (order_id)                       -- mỗi đơn chỉ một hóa đơn thanh toán
);

create table receipt_print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  receipt_id uuid references receipts(id) on delete cascade,
  order_id uuid references orders(id),
  kind print_kind not null default 'receipt',
  printer_name text not null default '',
  status print_status not null default 'queued',
  error text,
  attempts int not null default 0,
  copies int not null default 1,
  reason text,                            -- lý do in lại
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index print_jobs_receipt_idx on receipt_print_jobs(receipt_id);
create index print_jobs_open_idx on receipt_print_jobs(store_id) where status not in ('success');
create trigger trg_print_jobs_updated before update on receipt_print_jobs for each row execute function set_updated_at();

create table print_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  method text not null default 'windows_driver' check (method in ('windows_driver', 'escpos_network', 'browser')),
  printer_name text not null default '',
  network_host text not null default '',
  network_port int not null default 9100,
  paper_width int not null default 80 check (paper_width in (58, 80)),
  auto_print boolean not null default true,
  allow_reprint boolean not null default true,
  margin_mm int not null default 2 check (margin_mm between 0 and 20),
  font_size int not null default 12 check (font_size between 8 and 24),
  copies int not null default 1 check (copies between 1 and 5),
  kitchen_enabled boolean not null default false,
  kitchen_printer_name text not null default '',
  show_logo boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger trg_print_settings_updated before update on print_settings for each row execute function set_updated_at();

-- ---------- Kho, nhập hàng ----------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text not null default '',
  address text not null default '',
  note text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  unit text not null,                     -- g, ml, cái...
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  current_stock numeric(14,3) not null default 0,   -- chỉ đổi qua stock_movements
  supplier_id uuid references suppliers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table ingredient_prices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  supplier_id uuid references suppliers(id) on delete set null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references profiles(id)
);
create index ingredient_prices_ing_idx on ingredient_prices(ingredient_id, recorded_at desc);

create table product_recipes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,  -- null = áp dụng mọi biến thể
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0)
);
create index product_recipes_product_idx on product_recipes(product_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  code text not null,
  status po_status not null default 'draft',
  total numeric(14,0) not null default 0,
  note text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  received_at timestamptz,
  unique (store_id, code)
);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  type stock_movement_type not null,
  quantity numeric(14,3) not null check (quantity <> 0),  -- có dấu: nhập +, xuất -
  reason text not null default '',
  order_id uuid references orders(id),
  purchase_order_id uuid references purchase_orders(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index stock_movements_ing_idx on stock_movements(ingredient_id, created_at desc);
-- Mỗi đơn chỉ trừ kho một lần và hoàn kho một lần cho mỗi nguyên liệu.
create unique index stock_sale_once on stock_movements(order_id, ingredient_id) where type = 'sale';
create unique index stock_reversal_once on stock_movements(order_id, ingredient_id) where type = 'sale_reversal';

-- ---------- Thu chi ----------
create table cash_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  type cash_tx_type not null,
  unique (store_id, name, type)
);

create table cash_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid references shifts(id),
  type cash_tx_type not null,
  category_id uuid references cash_categories(id) on delete set null,
  amount numeric(14,0) not null check (amount > 0),
  method_code text not null default 'cash',
  description text not null default '',
  attachment_url text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index cash_tx_store_idx on cash_transactions(store_id, created_at desc);

-- ---------- Nhật ký ----------
create table audit_logs (
  id bigint generated always as identity primary key,
  store_id uuid references stores(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_store_idx on audit_logs(store_id, created_at desc);

-- ---------- Ràng buộc toàn vẹn ----------

-- Tồn kho chỉ đổi qua stock_movements.
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update ingredients set current_stock = current_stock + new.quantity where id = new.ingredient_id;
  return new;
end $$;
create trigger trg_stock_apply after insert on stock_movements for each row execute function apply_stock_movement();

create or replace function guard_ingredient_stock() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.current_stock <> 0 then
      raise exception 'Nguyên liệu mới phải có tồn bằng 0. Hãy ghi tồn đầu kỳ bằng phiếu kho.';
    end if;
  elsif new.current_stock is distinct from old.current_stock and pg_trigger_depth() < 2 then
    raise exception 'Không được sửa trực tiếp tồn kho. Hãy tạo phiếu điều chỉnh kho.';
  end if;
  return new;
end $$;
create trigger trg_ingredient_guard before insert or update on ingredients for each row execute function guard_ingredient_stock();

-- Sổ kho, nhật ký, thanh toán và hóa đơn không được sửa hoặc xóa.
create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Bảng % chỉ được thêm mới, không được sửa hoặc xóa.', tg_table_name;
end $$;
create trigger trg_stock_immutable before update or delete on stock_movements for each row execute function forbid_change();
create trigger trg_audit_immutable before update or delete on audit_logs for each row execute function forbid_change();
create trigger trg_payments_immutable before update or delete on payments for each row execute function forbid_change();
create trigger trg_refunds_immutable before update or delete on refunds for each row execute function forbid_change();
create trigger trg_receipts_immutable before update or delete on receipts for each row execute function forbid_change();

-- Đơn đã thanh toán/hoàn/hủy không bị xóa cứng và không sửa nội dung tiền.
create or replace function guard_final_orders() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'open') then
      raise exception 'Không được xóa đơn ở trạng thái %.', old.status;
    end if;
    return old;
  end if;
  -- Chỉ các hàm RPC nghiệp vụ (hoàn/hủy) mới bật cờ này trong transaction của chúng.
  if old.status in ('paid', 'refunded', 'cancelled')
     and coalesce(current_setting('app.allow_final_edit', true), '') <> 'on' then
    raise exception 'Đơn đã ở trạng thái % nên không được sửa trực tiếp.', old.status;
  end if;
  return new;
end $$;
create trigger trg_orders_guard before update or delete on orders for each row execute function guard_final_orders();

-- ===== 0002_rbac_rls.sql =====
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

-- ===== 0003_auth_bootstrap_audit.sql =====
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

-- ===== 0004_pos_rpc.sql =====
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

-- ===== 0005_menu_rpc_storage.sql =====
-- MR.VŨ COFFEE POS - 0005: lưu món nguyên tử (RPC) và kho ảnh sản phẩm

-- p_data: {code, name, category_id, price, tax_rate, is_active, sort_order, image_url,
--          variants: [{id?, name, price}], modifier_ids: [uuid], cost_estimate?}
-- Biến thể bị bỏ khỏi danh sách chỉ bị ngừng dùng (không xóa) để giữ lịch sử bán hàng.
create or replace function rpc_save_product(p_store uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id; v_var jsonb; v_seen uuid[] := '{}'; v_vid uuid; v_ord int := 0;
  v_name text := trim(coalesce(p_data ->> 'name', ''));
  v_code text := trim(coalesce(p_data ->> 'code', ''));
begin
  if not has_permission(p_store, 'menu.manage') then raise exception 'Bạn không có quyền quản lý thực đơn.'; end if;
  if v_name = '' then raise exception 'Vui lòng nhập tên món.'; end if;
  if v_code = '' then raise exception 'Vui lòng nhập mã món.'; end if;
  if (p_data ->> 'price')::numeric is null or (p_data ->> 'price')::numeric < 0 then raise exception 'Giá bán không hợp lệ.'; end if;

  if nullif(p_data ->> 'category_id', '') is not null and not exists (
    select 1 from categories where id = (p_data ->> 'category_id')::uuid and store_id = p_store) then
    raise exception 'Danh mục không hợp lệ.';
  end if;

  if v_id is null then
    insert into products (store_id, category_id, code, name, image_url, price, tax_rate, is_active, sort_order)
    values (p_store, nullif(p_data ->> 'category_id', '')::uuid, v_code, v_name, nullif(p_data ->> 'image_url', ''),
            (p_data ->> 'price')::numeric, coalesce((p_data ->> 'tax_rate')::numeric, 0),
            coalesce((p_data ->> 'is_active')::boolean, true), coalesce((p_data ->> 'sort_order')::int, 0))
    returning id into v_id;
  else
    if not exists (select 1 from products where id = v_id and store_id = p_store) then raise exception 'Không tìm thấy món.'; end if;
    update products set category_id = nullif(p_data ->> 'category_id', '')::uuid, code = v_code, name = v_name,
      image_url = nullif(p_data ->> 'image_url', ''), price = (p_data ->> 'price')::numeric,
      tax_rate = coalesce((p_data ->> 'tax_rate')::numeric, 0),
      is_active = coalesce((p_data ->> 'is_active')::boolean, true), sort_order = coalesce((p_data ->> 'sort_order')::int, 0)
    where id = v_id;
  end if;

  for v_var in select * from jsonb_array_elements(coalesce(p_data -> 'variants', '[]'::jsonb)) loop
    v_ord := v_ord + 1;
    if trim(coalesce(v_var ->> 'name', '')) = '' then raise exception 'Tên biến thể không được để trống.'; end if;
    if (v_var ->> 'price')::numeric is null or (v_var ->> 'price')::numeric < 0 then raise exception 'Giá biến thể không hợp lệ.'; end if;
    if nullif(v_var ->> 'id', '') is not null then
      v_vid := (v_var ->> 'id')::uuid;
      update product_variants set name = trim(v_var ->> 'name'), price = (v_var ->> 'price')::numeric,
        is_active = true, sort_order = v_ord
      where id = v_vid and product_id = v_id;
      if not found then raise exception 'Biến thể không thuộc món này.'; end if;
    else
      insert into product_variants (product_id, store_id, name, price, sort_order)
      values (v_id, p_store, trim(v_var ->> 'name'), (v_var ->> 'price')::numeric, v_ord)
      returning id into v_vid;
    end if;
    v_seen := v_seen || v_vid;
  end loop;
  update product_variants set is_active = false where product_id = v_id and not (id = any(v_seen));

  delete from product_modifiers where product_id = v_id;
  insert into product_modifiers (product_id, modifier_id)
  select v_id, m.id from modifiers m
  where m.store_id = p_store and m.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'modifier_ids', '[]'::jsonb)) x);

  if p_data ? 'cost_estimate' and has_permission(p_store, 'costs.view') then
    insert into product_costs (product_id, store_id, cost_estimate)
    values (v_id, p_store, coalesce(nullif(p_data ->> 'cost_estimate', '')::numeric, 0))
    on conflict (product_id) do update set cost_estimate = excluded.cost_estimate;
  end if;

  perform log_audit(p_store, case when p_id is null then 'product.create' else 'product.update' end,
    'products', v_id::text, jsonb_build_object('code', v_code, 'name', v_name, 'price', (p_data ->> 'price')::numeric));
  return v_id;
end $$;
revoke all on function rpc_save_product(uuid, uuid, jsonb) from public, anon;
grant execute on function rpc_save_product(uuid, uuid, jsonb) to authenticated;

-- Kho ảnh sản phẩm (chỉ tạo khi dự án có Supabase Storage).
-- Quy ước đường dẫn: <store_id>/<tên-tệp>. Ai cũng xem được ảnh; chỉ người quản lý thực đơn mới tải lên.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy product_images_write on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
    execute $p$create policy product_images_update on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
    execute $p$create policy product_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
  end if;
end $$;

-- ===== 0006_printing.sql =====
-- MR.VŨ COFFEE POS - 0006: in bill qua QZ Tray / giả lập, quyền in lại, chặn in trùng

-- Phương thức in: QZ Tray (thật), giả lập (thử nghiệm), hộp thoại trình duyệt (dự phòng).
alter table print_settings drop constraint if exists print_settings_method_check;
update print_settings set method = 'simulator' where method not in ('qz_tray', 'simulator', 'browser');
alter table print_settings add constraint print_settings_method_check check (method in ('qz_tray', 'simulator', 'browser'));
alter table print_settings alter column method set default 'simulator';

-- Mỗi hóa đơn chỉ có MỘT lệnh in tự động (kind = 'receipt'); in lại dùng kind = 'reprint' kèm lý do.
create unique index if not exists print_jobs_one_receipt on receipt_print_jobs (receipt_id) where kind = 'receipt';

-- Quyền in lại hóa đơn.
insert into role_permissions (role, permission) values
  ('owner', 'order.reprint'), ('manager', 'order.reprint'), ('cashier', 'order.reprint')
on conflict do nothing;

drop policy if exists print_jobs_insert on receipt_print_jobs;
create policy print_jobs_insert on receipt_print_jobs for insert to authenticated
  with check (
    requested_by = auth.uid()
    and case
      when kind = 'reprint' then has_permission(store_id, 'order.reprint') and length(trim(coalesce(reason, ''))) >= 3
      when kind = 'test' then has_permission(store_id, 'settings.manage')
      else has_permission(store_id, 'order.create')
    end
  );

-- ===== 0007_inventory_rpc.sql =====
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

-- ===== 0008_shifts_cash.sql =====
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

-- ===== 0009_reports.sql =====
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

-- ===== 0010_fast_takeaway.sql =====
-- MR.VŨ COFFEE POS - 0010: Fast Takeaway - hàng đợi pha chế, không chặn thu ngân, in phiếu bếp một lần

-- Trạng thái pha chế: queued (chờ) -> preparing (đang pha) -> ready (xong, chờ giao) -> served (đã giao).
alter table orders
  add column if not exists prep_status text check (prep_status in ('queued', 'preparing', 'ready', 'served')),
  add column if not exists prep_updated_at timestamptz,
  add column if not exists prep_updated_by uuid references profiles(id);
create index if not exists orders_prep_idx on orders (store_id, created_at) where prep_status in ('queued', 'preparing', 'ready');

-- Đơn vào hàng đợi pha chế khi: đã thanh toán, hoặc đơn tại bàn được xác nhận phục vụ.
create or replace function orders_prep_default() returns trigger
language plpgsql as $$
begin
  if new.prep_status is null
     and (new.status = 'paid' or (new.type = 'dine_in' and new.status in ('open', 'pending_payment'))) then
    new.prep_status := 'queued';
    new.prep_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_prep on orders;
create trigger trg_orders_prep before insert or update on orders for each row execute function orders_prep_default();

-- Đổi trạng thái pha chế KHÔNG làm tăng version của đơn, để không gây xung đột khi thu ngân đang sửa cùng đơn tại bàn.
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
    if (to_jsonb(new) - 'prep_status' - 'prep_updated_at' - 'prep_updated_by' - 'updated_at' - 'version')
       is distinct from (to_jsonb(old) - 'prep_status' - 'prep_updated_at' - 'prep_updated_by' - 'updated_at' - 'version') then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  v_disc := least(new.subtotal, new.discount_amount + round(new.subtotal * new.discount_percent / 100));
  new.total := new.subtotal - v_disc + new.surcharge;
  return new;
end $$;

create or replace function rpc_set_prep_status(p_order uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(o.store_id, 'order.create') then raise exception 'Bạn không có quyền cập nhật pha chế.'; end if;
  if p_status not in ('queued', 'preparing', 'ready', 'served') then raise exception 'Trạng thái pha chế không hợp lệ.'; end if;
  if o.status in ('cancelled', 'refunded', 'draft') then raise exception 'Đơn ở trạng thái % không có trong hàng đợi pha chế.', o.status; end if;
  if o.prep_status is null then raise exception 'Đơn chưa vào hàng đợi pha chế.'; end if;
  if o.prep_status = p_status then return o.prep_status; end if; -- gọi lại cho kết quả như cũ
  perform set_config('app.allow_final_edit', 'on', true);
  update orders set prep_status = p_status, prep_updated_at = now(), prep_updated_by = auth.uid() where id = o.id;
  perform set_config('app.allow_final_edit', 'off', true);
  return p_status;
end $$;
revoke all on function rpc_set_prep_status(uuid, text) from public, anon;
grant execute on function rpc_set_prep_status(uuid, text) to authenticated;

-- Mỗi đơn chỉ có một phiếu bếp tự động (in lại dùng retry trên chính lệnh đó).
create unique index if not exists print_jobs_one_kitchen on receipt_print_jobs (order_id) where kind = 'kitchen';

-- ===== 0011_username_login.sql =====
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
