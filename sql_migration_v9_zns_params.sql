-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V9 — Lưu ràng buộc biến của template ZNS
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chỉ thêm cột, không sửa
-- dữ liệu sẵn có, chạy lại nhiều lần vẫn an toàn.
--
-- Vì sao cần: mỗi biến trong template ZNS có maxLength riêng (ví dụ
-- customer_name tối đa 30 ký tự). Gửi vượt quá → Zalo TỪ CHỐI cả tin.
-- Tên khách trong DB hoàn toàn có thể dài hơn 30 ký tự, nên phải biết giới
-- hạn để cắt bớt TRƯỚC khi gửi, thay vì để mất tin (và mất phí) ngoài ý muốn.
--
-- Lưu nguyên listParams Zalo trả về để không phải gọi lại API mỗi lần gửi.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.zns_templates
  ADD COLUMN IF NOT EXISTS list_params jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Loại tin (TRANSACTION | PROMOTION | OTP) và giá mỗi tin do Zalo quy định.
-- Lưu lại để hiển thị và để đối soát chi phí, khỏi gọi API mỗi lần xem.
ALTER TABLE public.zns_templates
  ADD COLUMN IF NOT EXISTS template_tag text;

ALTER TABLE public.zns_templates
  ADD COLUMN IF NOT EXISTS price numeric;


-- ═══════════════════════════════════════════════════════════════════════════
-- HÀM GIÀNH JOB CHO WORKER
--
-- Deploy serverless nên hàng đợi được "rút" bằng cách gọi HTTP mỗi phút. Hai
-- lần gọi hoàn toàn có thể chồng nhau (lần trước chưa xong, pg_cron đã bắn
-- lần sau). Nếu cả hai cùng đọc một job → KHÁCH NHẬN HAI TIN và mất tiền hai
-- lần.
--
-- FOR UPDATE SKIP LOCKED là thứ ngăn điều đó ở tầng Postgres: tiến trình thứ
-- hai bỏ qua các dòng đang bị khoá thay vì chờ hoặc đọc trùng. PostgREST
-- không diễn đạt được cú pháp này nên phải bọc trong hàm SQL.
--
-- Việc chuyển status sang SENDING + tăng attempts nằm CÙNG một câu lệnh với
-- lúc chọn job, nên không có khe hở giữa "đọc" và "đánh dấu".
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_message_jobs(p_limit int DEFAULT 50)
RETURNS SETOF public.message_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.message_jobs mj
     SET status    = 'SENDING',
         locked_at = now(),
         attempts  = mj.attempts + 1
   WHERE mj.id IN (
     SELECT j.id
       FROM public.message_jobs j
      WHERE j.status IN ('PENDING', 'RETRYING')
        AND j.scheduled_at <= now()
        AND j.attempts < j.max_attempts
      ORDER BY j.scheduled_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING mj.*;
END;
$$;

-- Chỉ service_role được gọi. Bảng đã RLS deny-all, hàm cũng không mở cho anon.
REVOKE ALL ON FUNCTION public.claim_message_jobs(int) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- HẸN GIỜ RÚT HÀNG ĐỢI
--
-- Chạy khối này SAU khi đã deploy và điền JOB_DRAIN_SECRET trên Vercel.
-- Thay <TEN-MIEN> và <JOB_DRAIN_SECRET> bằng giá trị thật rồi bỏ dấu comment.
--
-- Endpoint đã được kiểm chứng: không secret / sai secret -> 401, đúng -> chạy.
-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule('zalo-drain', '* * * * *', $$
--   SELECT net.http_post(
--     url     := 'https://<TEN-MIEN>/api/jobs/drain',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-job-secret', '<JOB_DRAIN_SECRET>'
--                ),
--     body    := '{}'::jsonb
--   );
-- $$);
--
-- Kiểm tra lịch đã tạo:      SELECT * FROM cron.job;
-- Xem 20 lần chạy gần nhất:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Gỡ lịch nếu cần:           SELECT cron.unschedule('zalo-drain');
