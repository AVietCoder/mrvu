-- =====================================================================
-- PERFORMANCE INDEXES — chạy 1 lần trên Supabase (SQL Editor).
-- An toàn: chỉ CREATE INDEX IF NOT EXISTS, KHÔNG đụng dữ liệu.
-- Mục tiêu: tăng tốc list / search / join cho mọi màn hình lớn.
-- =====================================================================

-- pg_trgm dùng cho ILIKE %x% trên name / phone / code / sku.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─── CUSTOMERS ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_created_at      ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_group_name      ON customers (group_name);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm       ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm      ON customers USING gin (phone gin_trgm_ops);
-- nếu có cột email:
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='email') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON customers USING gin (email gin_trgm_ops)';
  END IF;
END $$;

-- ─── PRODUCTS ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_name             ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm        ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm         ON products USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_category_id      ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand_id         ON products (brand_id);

-- ─── STOCK ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_product_id          ON stock (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_branch_id           ON stock (branch_id);

-- ─── ORDERS ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_created_at         ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id        ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id          ON orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_employee_id        ON orders (employee_id);
CREATE INDEX IF NOT EXISTS idx_orders_status             ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_code_trgm          ON orders USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_status_created     ON orders (status, created_at DESC);

-- ─── ORDER_ITEMS ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_order_items_order_id      ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id    ON order_items (product_id);

-- ─── CASH VOUCHERS ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_created_at  ON cash_vouchers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_type        ON cash_vouchers (type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_fund_type   ON cash_vouchers (fund_type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_branch_id   ON cash_vouchers (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_payer_cust  ON cash_vouchers (payer_customer_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_recv_cust   ON cash_vouchers (receiver_customer_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_from_to     ON cash_vouchers (from_kind, from_id, to_kind, to_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_code_trgm   ON cash_vouchers USING gin (code gin_trgm_ops);

-- ─── STOCK MOVEMENTS / TRANSFERS ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_movements_product_id      ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_from_branch     ON stock_movements (from_branch);
CREATE INDEX IF NOT EXISTS idx_movements_to_branch       ON stock_movements (to_branch);
DO $$ BEGIN
  IF to_regclass('public.stock_transfers') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON stock_transfers (created_at DESC)';
  END IF;
  IF to_regclass('public.stock_transfer_items') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON stock_transfer_items (transfer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_transfer_items_product  ON stock_transfer_items (product_id)';
  END IF;
END $$;

-- ─── SCHEDULES ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.schedules') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_date ON schedules (scheduled_date)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_schedules_status         ON schedules (status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_schedules_order_id       ON schedules (order_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_schedules_created_at     ON schedules (created_at DESC)';
  END IF;
  IF to_regclass('public.schedule_assignments') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sched_assign_schedule ON schedule_assignments (schedule_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sched_assign_user     ON schedule_assignments (user_id)';
  END IF;
END $$;

-- ─── ACTIVITY LOGS ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activity_created_at       ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_employee_id      ON activity_logs (employee_id);

-- ─── USERS ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_users_full_name ON users (full_name)';
  END IF;
END $$;

-- ─── ANALYZE để planner cập nhật thống kê ──────────────────────────────
ANALYZE;
