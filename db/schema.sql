-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.brands (
  id text NOT NULL,
  name text NOT NULL,
  CONSTRAINT brands_pkey PRIMARY KEY (id)
);
CREATE TABLE public.categories (
  id text NOT NULL,
  name text NOT NULL,
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.branches (
  id text NOT NULL,
  name text NOT NULL,
  address text,
  phone text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT branches_pkey PRIMARY KEY (id)
);
CREATE TABLE public.work_difficulties (
  id text NOT NULL,
  name text NOT NULL,
  description text,
  bonus numeric NOT NULL DEFAULT 0,
  CONSTRAINT work_difficulties_pkey PRIMARY KEY (id)
);
CREATE TABLE public.work_types (
  id text NOT NULL,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  CONSTRAINT work_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.site_settings (
  key text NOT NULL,
  value text NOT NULL DEFAULT ''::text,
  CONSTRAINT site_settings_pkey PRIMARY KEY (key)
);
CREATE TABLE public.cash_voucher_types (
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  CONSTRAINT cash_voucher_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.products (
  id text NOT NULL,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id text,
  brand_id text,
  power text,
  color text,
  blade_size text,
  sale_price numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  tech_fee numeric NOT NULL DEFAULT 0,
  min_stock integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  image_url text,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id)
);
CREATE TABLE public.users (
  id text NOT NULL,
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  full_name text NOT NULL,
  phone text,
  email text,
  role text NOT NULL DEFAULT 'cashier',
  is_admin integer NOT NULL DEFAULT 0,

  branch_ids text[] NOT NULL DEFAULT '{}',
  permissions text[] NOT NULL DEFAULT '{}',

  active boolean NOT NULL DEFAULT true,
  kv_employee_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_branches (
  user_id text NOT NULL,
  branch_id text NOT NULL,
  CONSTRAINT user_branches_pkey PRIMARY KEY (user_id, branch_id)
);
CREATE TABLE public.user_permissions (
  user_id text NOT NULL,
  permission text NOT NULL,
  CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission)
);
CREATE TABLE public.user_activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  action text,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_activity_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.employees (
  id text NOT NULL,
  name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'Nhân viên'::text,
  branch_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id),
  CONSTRAINT employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id)
);
CREATE TABLE public.customers (
  id text NOT NULL,
  external_code text UNIQUE,
  name text NOT NULL,
  phone text,
  address text,
  ward text,
  district text,
  province text,
  group_name text NOT NULL DEFAULT 'le'::text,
  debt numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  total_sales numeric NOT NULL DEFAULT 0,
  type text,
  email text,
  gender text,
  total_buy numeric DEFAULT 0,
  birthday date,
  tax_code text,
  cccd text,
  passport_no text,
  company_name text,
  customer_type text DEFAULT 'ca_nhan'::text,
  bank_name text,
  bank_account text,
  note text,
  created_by text,
  created_by_name text,
  debt_adjustment numeric NOT NULL DEFAULT 0,
  CONSTRAINT customers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.orders (
  id text NOT NULL,
  code text NOT NULL UNIQUE,
  customer_id text,
  branch_id text,
  employee_id text,
  status text NOT NULL DEFAULT 'draft'::text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  deposit numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  payment_method text DEFAULT 'tien_mat'::text,
  vat_rate numeric DEFAULT 0,
  vat_amount bigint DEFAULT 0,
  discount_type text DEFAULT 'amount'::text,
  discount_pct numeric DEFAULT 0,
  completed_at timestamp with time zone,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id),
  CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id)
);
CREATE TABLE public.order_items (
  id text NOT NULL,
  order_id text NOT NULL,
  product_id text,
  qty integer NOT NULL,
  unit_price numeric NOT NULL,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL,
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.stock (
  product_id text NOT NULL,
  branch_id text NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  CONSTRAINT stock_pkey PRIMARY KEY (product_id, branch_id),
  CONSTRAINT stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT stock_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id)
);
CREATE TABLE public.stock_movements (
  id text NOT NULL,
  type text NOT NULL,
  branch_id text,
  product_id text,
  qty integer NOT NULL,
  unit_cost numeric DEFAULT 0,
  note text,
  ref_type text,
  ref_id text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  from_branch text,
  to_branch text,
  CONSTRAINT stock_movements_pkey PRIMARY KEY (id),
  CONSTRAINT stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id),
  CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.stock_transfers (
  id text NOT NULL,
  from_branch text,
  to_branch text,
  status text NOT NULL DEFAULT 'pending'::text,
  note text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  confirmed_at timestamp with time zone,
  CONSTRAINT stock_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT stock_transfers_from_branch_fkey FOREIGN KEY (from_branch) REFERENCES public.branches(id),
  CONSTRAINT stock_transfers_to_branch_fkey FOREIGN KEY (to_branch) REFERENCES public.branches(id)
);
CREATE TABLE public.stock_transfer_items (
  id text NOT NULL,
  transfer_id text NOT NULL,
  product_id text,
  qty integer NOT NULL,
  CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id),
  CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id),
  CONSTRAINT stock_transfer_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.cash_vouchers (
  id text NOT NULL,
  code text NOT NULL UNIQUE,
  type text NOT NULL,
  fund_type text NOT NULL,
  branch_id text,
  amount numeric NOT NULL DEFAULT 0,
  voucher_type_id text,
  payer_receiver text,
  note text,
  accounting boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active'::text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  collector_user_id text,
  payer_customer_id text,
  payer_user_id text,
  receiver_customer_id text,
  from_kind text,
  from_id text,
  from_name text,
  to_kind text,
  to_id text,
  to_name text,
  CONSTRAINT cash_vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT cash_vouchers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id),
  CONSTRAINT cash_vouchers_voucher_type_id_fkey FOREIGN KEY (voucher_type_id) REFERENCES public.cash_voucher_types(id),
  CONSTRAINT cash_vouchers_payer_customer_id_fkey FOREIGN KEY (payer_customer_id) REFERENCES public.customers(id),
  CONSTRAINT cash_vouchers_receiver_customer_id_fkey FOREIGN KEY (receiver_customer_id) REFERENCES public.customers(id)
);
CREATE TABLE public.schedules (
  id text NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'install'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  scheduled_date date NOT NULL,
  scheduled_time text,
  customer_id text,
  branch_id text,
  order_id text,
  address text,
  note text,
  created_by text NOT NULL,
  assigned_by text,
  work_type_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT schedules_pkey PRIMARY KEY (id),
  CONSTRAINT schedules_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT schedules_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id),
  CONSTRAINT schedules_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT schedules_work_type_id_fkey FOREIGN KEY (work_type_id) REFERENCES public.work_types(id)
);
CREATE TABLE public.schedule_assignments (
  schedule_id text NOT NULL,
  user_id text NOT NULL,
  CONSTRAINT schedule_assignments_pkey PRIMARY KEY (schedule_id, user_id),
  CONSTRAINT schedule_assignments_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id)
);
CREATE TABLE public.schedule_difficulties (
  schedule_id text NOT NULL,
  difficulty_id text NOT NULL,
  CONSTRAINT schedule_difficulties_pkey PRIMARY KEY (schedule_id, difficulty_id),
  CONSTRAINT schedule_difficulties_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id),
  CONSTRAINT schedule_difficulties_difficulty_id_fkey FOREIGN KEY (difficulty_id) REFERENCES public.work_difficulties(id)
);
CREATE TABLE public.tech_fees (
  id text NOT NULL,
  schedule_id text NOT NULL,
  product_id text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  unit_fee numeric NOT NULL DEFAULT 0,
  user_id text,
  CONSTRAINT tech_fees_pkey PRIMARY KEY (id),
  CONSTRAINT tech_fees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT tech_fees_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id),
  CONSTRAINT tech_fees_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.activity_logs (
  id text NOT NULL,
  employee_id text,
  action text NOT NULL,
  detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_logs_pkey PRIMARY KEY (id)
);