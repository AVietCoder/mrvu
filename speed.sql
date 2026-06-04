-- =====================================================================
--  TURSO SPEED-UP — chạy 1 lần trên Turso CLI hoặc Turso Web Console:
--    turso db shell <database-name> < sql/turso_speedup_indexes.sql
--
--  Tất cả đều `IF NOT EXISTS` nên chạy lại NHIỀU LẦN cũng an toàn.
--  Mục tiêu: ép SQLite/libsql dùng index thay vì full-scan cho mọi
--  truy vấn nóng (orders, cash, customers, schedules, inventory, ...).
-- =====================================================================

-- ─── ORDERS ──────────────────────────────────────────────────────────
PRAGMA foreign_keys=OFF;

CREATE INDEX IF NOT EXISTS idx_orders_created_at        ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_completed_at      ON orders(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status            ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id         ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id       ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_employee_id       ON orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_orders_code              ON orders(code);
CREATE INDEX IF NOT EXISTS idx_orders_status_branch     ON orders(status, branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status   ON orders(customer_id, status);

-- ─── ORDER_ITEMS ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_order_items_order_id     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id   ON order_items(product_id);

-- ─── CUSTOMERS ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_created_at     ON customers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_group_name     ON customers(group_name);
CREATE INDEX IF NOT EXISTS idx_customers_phone          ON customers(phone);
-- Tìm kiếm theo tên (LIKE 'abc%' sẽ dùng được index COLLATE NOCASE)
CREATE INDEX IF NOT EXISTS idx_customers_name_nocase    ON customers(name COLLATE NOCASE);

-- ─── CASH_VOUCHERS ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_created_at ON cash_vouchers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_type       ON cash_vouchers(type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_status     ON cash_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_branch_id  ON cash_vouchers(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_payer      ON cash_vouchers(payer_customer_id, type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_receiver   ON cash_vouchers(receiver_customer_id, type);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_code       ON cash_vouchers(code);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_from       ON cash_vouchers(from_kind, from_id);
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_to         ON cash_vouchers(to_kind, to_id);

-- ─── STOCK / INVENTORY ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_product_branch     ON stock(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_branch_id          ON stock(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created  ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product  ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created  ON stock_transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status   ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_tid ON stock_transfer_items(transfer_id);

-- ─── PRODUCTS ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_name            ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku             ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_name_nocase     ON products(name COLLATE NOCASE);

-- ─── SCHEDULES ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_date ON schedules(scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_created_at     ON schedules(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_order_id       ON schedules(order_id);
CREATE INDEX IF NOT EXISTS idx_schedules_status         ON schedules(status);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_sid ON schedule_assignments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_uid ON schedule_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_difficulties_sid ON schedule_difficulties(schedule_id);
CREATE INDEX IF NOT EXISTS idx_tech_fees_schedule_id    ON tech_fees(schedule_id);

-- ─── USERS / EMPLOYEES / BRANCHES ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_full_name          ON users(full_name);
CREATE INDEX IF NOT EXISTS idx_users_username           ON users(username);
CREATE INDEX IF NOT EXISTS idx_user_permissions_uid     ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_name           ON employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_branch_id      ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_branches_name            ON branches(name);

-- ─── ACTIVITY LOGS / SITE SETTINGS ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activity_logs_created    ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_employee   ON activity_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_site_settings_key        ON site_settings(key);
CREATE INDEX IF NOT EXISTS idx_cash_voucher_types_kind  ON cash_voucher_types(kind);
CREATE INDEX IF NOT EXISTS idx_cash_voucher_types_name  ON cash_voucher_types(name);

-- ─── PRAGMAs (tối ưu cấu hình DB) ────────────────────────────────────
-- SQLite/libsql sẽ áp dụng các PRAGMA này ở mức database file.
PRAGMA journal_mode = WAL;        -- cho phép đọc/ghi đồng thời
PRAGMA synchronous = NORMAL;      -- nhanh hơn FULL, vẫn an toàn với WAL
PRAGMA temp_store = MEMORY;       -- bảng tạm trong RAM
PRAGMA mmap_size = 268435456;     -- 256MB memory-mapped I/O

-- ─── ANALYZE — bắt buộc sau khi tạo index, giúp query planner chọn đúng index ──
ANALYZE;
