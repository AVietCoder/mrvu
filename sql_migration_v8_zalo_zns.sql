-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V8 — ZALO OA / ZNS (gửi tin qua SỐ ĐIỆN THOẠI)
--
-- Chạy TOÀN BỘ file này trong Supabase Dashboard → SQL Editor → Run.
--
-- PHẠM VI ĐỢT NÀY: đơn hàng hoàn tất → tự động gửi ZNS Tin Giao dịch tới
-- SĐT khách. KHÔNG làm campaign marketing, KHÔNG làm segment builder.
--
-- Vì gửi qua SĐT (không qua UID người quan tâm OA) nên KHÔNG cần bảng
-- zalo_followers — bỏ hẳn so với bản kế hoạch ban đầu. Còn 4 bảng.
--
-- ⚠️ BẢO MẬT — ĐỌC TRƯỚC KHI CHẠY
-- App hiện dùng anon key ở phía client và CHƯA có RLS trên các bảng cũ.
-- Zalo access token cho phép gửi tin thay mặt doanh nghiệp và TỐN TIỀN THẬT,
-- nên 4 bảng dưới đây được xử lý khác hẳn phần còn lại của DB:
--
--   1) RLS deny-all — bật RLS và KHÔNG tạo policy nào. Anon key đọc/ghi đều
--      bị chặn. Chỉ service_role (bypass RLS) truy cập được.
--   2) Token lưu dạng đã mã hoá AES-256-GCM ở tầng Node (cột *_enc), khoá
--      nằm ở biến môi trường ZALO_TOKEN_SECRET — không nằm trong DB.
--
--   → Hệ quả: mọi truy cập 4 bảng này PHẢI đi qua supabaseAdmin
--     (SUPABASE_SERVICE_ROLE_KEY). Dùng client `supabase` thường sẽ trả rỗng.
--
-- ⚠️ TUYỆT ĐỐI KHÔNG dùng insertRowSafe()/upsertRowsSafe() cho 4 bảng này.
--    Các hàm đó tự bóc cột mà DB chưa có rồi báo "thành công" — với bảng
--    token nghĩa là token IM LẶNG không được lưu nhưng code tưởng đã lưu.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1) KẾT NỐI OA ────────────────────────────────────────────────────────
-- Đợt này dùng 1 OA chung cho mọi chi nhánh → chỉ có 1 dòng, branch_id = NULL.
-- Vẫn giữ cột branch_id để sau muốn tách mỗi chi nhánh 1 OA thì không phải
-- sửa schema, chỉ thêm dòng mới.
CREATE TABLE IF NOT EXISTS public.zalo_connections (
  id                text PRIMARY KEY,
  branch_id         text REFERENCES public.branches(id),  -- NULL = OA dùng chung
  oa_id             text NOT NULL,
  oa_name           text,

  -- Ciphertext base64 (AES-256-GCM, mã hoá ở Node). KHÔNG BAO GIỜ lưu plaintext.
  access_token_enc  text NOT NULL,
  refresh_token_enc text NOT NULL,
  token_expires_at  timestamptz NOT NULL,

  -- Khoá chống race khi refresh. Zalo XOAY VÒNG refresh token: mỗi lần refresh
  -- trả token mới và vô hiệu cái cũ → hai request refresh song song sẽ làm
  -- ĐỨT KẾT NỐI VĨNH VIỄN, phải nối lại OA thủ công.
  refresh_lock_at   timestamptz,

  status            text NOT NULL DEFAULT 'connected',  -- connected | error | disconnected
  connected_at      timestamptz,
  last_sync_at      timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Một OA chỉ nối 1 lần cho mỗi phạm vi. NULL không so sánh được bằng UNIQUE
-- thường, nên dùng 2 index riêng cho trường hợp dùng chung / theo chi nhánh.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zc_oa_shared
  ON public.zalo_connections(oa_id) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zc_oa_branch
  ON public.zalo_connections(oa_id, branch_id) WHERE branch_id IS NOT NULL;

ALTER TABLE public.zalo_connections ENABLE ROW LEVEL SECURITY;


-- ─── 2) TEMPLATE ZNS ĐÃ ĐƯỢC ZALO DUYỆT ───────────────────────────────────
-- ZNS KHÔNG cho gửi nội dung tự do. Mỗi mẫu tin phải đăng ký trên Zalo và
-- chờ duyệt; app chỉ được điền các biến mà template khai báo.
-- param_map ánh xạ biến nội bộ → tên param của Zalo, ví dụ:
--   { "order_code": "order_code", "customer_name": "customer_name",
--     "total": "total_amount" }
CREATE TABLE IF NOT EXISTS public.zns_templates (
  id                text PRIMARY KEY,
  code              text NOT NULL,          -- mã nội bộ, vd 'order_completed'
  name              text NOT NULL,
  zalo_template_id  text NOT NULL,          -- ID template phía Zalo
  param_map         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active         boolean NOT NULL DEFAULT false,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code)
);

ALTER TABLE public.zns_templates ENABLE ROW LEVEL SECURITY;


-- ─── 3) HÀNG ĐỢI GỬI TIN ──────────────────────────────────────────────────
-- Deploy serverless nên không có worker chạy dài. Hàng đợi nằm ở bảng này,
-- pg_cron gọi endpoint drain mỗi phút để rút job ra xử lý theo lô.
CREATE TABLE IF NOT EXISTS public.message_jobs (
  id               text PRIMARY KEY,
  connection_id    text NOT NULL REFERENCES public.zalo_connections(id),
  customer_id      text REFERENCES public.customers(id),
  order_id         text REFERENCES public.orders(id),
  template_id      text REFERENCES public.zns_templates(id),

  recipient_phone  text NOT NULL,           -- đã chuẩn hoá E.164 không dấu +, vd 84912345678
  payload          jsonb NOT NULL,          -- các param sẽ gửi cho Zalo

  -- ★ CHỐNG GỬI TRÙNG Ở TẦNG DB, không phụ thuộc application logic.
  -- sha256(connection_id | order_id | template_code). Insert trùng → Postgres
  -- reject → không tạo job thứ hai. Đây là thứ ngăn khách nhận 2 tin khi
  -- retry hoặc khi hai lần cron chồng nhau.
  idempotency_key  text NOT NULL UNIQUE,

  status           text NOT NULL DEFAULT 'PENDING',  -- PENDING|RETRYING|SENDING|SENT|FAILED|CANCELLED
  attempts         int  NOT NULL DEFAULT 0,
  max_attempts     int  NOT NULL DEFAULT 5,
  scheduled_at     timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Index phục vụ đúng câu truy vấn của drain (status + tới hạn).
CREATE INDEX IF NOT EXISTS idx_mj_drain
  ON public.message_jobs(status, scheduled_at)
  WHERE status IN ('PENDING', 'RETRYING');

CREATE INDEX IF NOT EXISTS idx_mj_order ON public.message_jobs(order_id);

ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;


-- ─── 4) LỊCH SỬ GỬI ───────────────────────────────────────────────────────
-- Tách khỏi message_jobs vì job bị xoá/dọn được, còn lịch sử gửi là bằng
-- chứng đã nhắn tin cho khách và là căn cứ đối soát chi phí ZNS.
CREATE TABLE IF NOT EXISTS public.message_logs (
  id                  text PRIMARY KEY,
  job_id              text REFERENCES public.message_jobs(id),
  connection_id       text,
  customer_id         text,
  order_id            text,
  template_id         text,

  recipient_phone     text,
  content             text,                 -- ảnh chụp param đã gửi (để đối chiếu)
  provider_message_id text,                 -- msg_id Zalo trả về

  status              text NOT NULL,        -- SENT | FAILED
  billable            boolean NOT NULL DEFAULT false,
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_customer ON public.message_logs(customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_order    ON public.message_logs(order_id);

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;


-- ─── 5) KHÁCH TỪ CHỐI NHẬN TIN ────────────────────────────────────────────
-- Khách yêu cầu ngừng nhận tin thì phải chặn được ngay, nếu không sẽ bị
-- report và tụt hạng chất lượng OA (Zalo hạ hạn mức gửi theo đánh giá này).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS zalo_opt_out_at timestamptz;


-- ═══════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI CHẠY
-- Cả 4 bảng phải hiện rowsecurity = true.
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('zalo_connections','zns_templates','message_jobs','message_logs');


-- ═══════════════════════════════════════════════════════════════════════════
-- PHẦN CRON — CHƯA CHẠY ĐƯỢC NGAY, cần điền URL app + secret.
-- Chạy riêng ở bước sau, khi endpoint /api/jobs/drain đã deploy.
-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule('zalo-drain', '* * * * *', $$
--   SELECT net.http_post(
--     url     := 'https://<TEN-MIEN-APP>/api/jobs/drain',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-job-secret', '<JOB_DRAIN_SECRET>'
--                ),
--     body    := '{}'::jsonb
--   );
-- $$);
