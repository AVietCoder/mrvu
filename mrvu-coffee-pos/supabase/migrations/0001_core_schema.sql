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
