-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V23 — QUẢN LÝ BẢO HÀNH (khách lẻ · đại lý · nhà máy)
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- products.warranty_months : hạn bảo hành theo TỪNG MẪU (tháng, mặc định 12).
-- factories                : danh mục nhà máy sản xuất (+ số ngày hạn gửi trả).
-- warranty_tickets         : phiếu bảo hành của khách lẻ (kind = retail) và
--                            đại lý (kind = dealer). Mã BH-YYYYMMDD-NNN.
-- factory_claims           : yêu cầu bảo hành hàng lỗi gửi nhà máy. Mã NM-YYYYMM-NNN.
-- warranty_activities      : lịch sử xử lý + trao đổi nội bộ của phiếu / yêu cầu.
--
-- Còn hạn / hết hạn KHÔNG lưu — server tính: purchase_date + warranty_months
-- so với sent_date.
-- Có tên + SĐT khách → RLS deny-all, server đọc ghi bằng service role sau khi
-- kiểm quyền (phiếu: theo chi nhánh được gán; nhà máy: chỉ admin).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS warranty_months integer NOT NULL DEFAULT 12;

CREATE TABLE IF NOT EXISTS public.factories (
  id           text        PRIMARY KEY,
  name         text        NOT NULL,
  contact_name text,
  phone        text,
  note         text,
  sla_days     integer     NOT NULL DEFAULT 14,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warranty_tickets (
  id                text        PRIMARY KEY,
  code              text        NOT NULL UNIQUE,
  kind              text        NOT NULL DEFAULT 'retail' CHECK (kind IN ('retail', 'dealer')),
  branch_id         text        REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id       text        REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name     text        NOT NULL,
  phone             text,
  address           text,
  product_id        text        REFERENCES public.products(id) ON DELETE SET NULL,
  product_model     text,
  purchase_date     date,
  purchase_order_id text,
  warranty_months   integer     NOT NULL DEFAULT 12,
  sent_date         timestamptz NOT NULL DEFAULT now(),
  response_date     timestamptz,
  receptionist_id   text        REFERENCES public.users(id) ON DELETE SET NULL,
  technician_id     text        REFERENCES public.users(id) ON DELETE SET NULL,
  issue_type        text,
  issue_note        text,
  attachments       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  solution_advice   text,
  final_action      text        CHECK (final_action IS NULL OR final_action IN ('buy_part', 'free_support', 'replace_new', 'repair')),
  spare_part_price  numeric     NOT NULL DEFAULT 0,
  part_order_id     text,
  stage             text        NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new', 'processing', 'waiting_part', 'done', 'closed')),
  done_at           timestamptz,
  schedule_id       text,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wt_kind_branch_sent ON public.warranty_tickets (kind, branch_id, sent_date DESC);
CREATE INDEX IF NOT EXISTS idx_wt_stage            ON public.warranty_tickets (stage);
CREATE INDEX IF NOT EXISTS idx_wt_customer         ON public.warranty_tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_wt_phone            ON public.warranty_tickets (phone);
CREATE INDEX IF NOT EXISTS idx_wt_technician       ON public.warranty_tickets (technician_id);

CREATE TABLE IF NOT EXISTS public.factory_claims (
  id                 text        PRIMARY KEY,
  code               text        NOT NULL UNIQUE,
  factory_id         text        REFERENCES public.factories(id) ON DELETE SET NULL,
  product_id         text        REFERENCES public.products(id) ON DELETE SET NULL,
  product_model      text,
  received_date      date        NOT NULL,
  receiver_id        text        REFERENCES public.users(id) ON DELETE SET NULL,
  defect_description text,
  media              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  factory_solution   text        CHECK (factory_solution IS NULL OR factory_solution IN
                                   ('replace_part', 'replace_motor', 'reject_expired', 'reject_user_fault')),
  solution_at        timestamptz,
  return_status      text        NOT NULL DEFAULT 'waiting' CHECK (return_status IN ('waiting', 'returned', 'rejected')),
  returned_date      date,
  shipping_note      text,
  ticket_id          text        REFERENCES public.warranty_tickets(id) ON DELETE SET NULL,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fc_factory_status ON public.factory_claims (factory_id, return_status);
CREATE INDEX IF NOT EXISTS idx_fc_received       ON public.factory_claims (received_date DESC);
CREATE INDEX IF NOT EXISTS idx_fc_ticket         ON public.factory_claims (ticket_id);

CREATE TABLE IF NOT EXISTS public.warranty_activities (
  id        text        PRIMARY KEY,
  ticket_id text        REFERENCES public.warranty_tickets(id) ON DELETE CASCADE,
  claim_id  text        REFERENCES public.factory_claims(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   text,
  kind      text        NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'stage', 'system')),
  content   text        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_ticket ON public.warranty_activities (ticket_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_claim  ON public.warranty_activities (claim_id, at DESC);

ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS factories_deny_all ON public.factories;
CREATE POLICY factories_deny_all ON public.factories
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.warranty_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warranty_tickets_deny_all ON public.warranty_tickets;
CREATE POLICY warranty_tickets_deny_all ON public.warranty_tickets
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.factory_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS factory_claims_deny_all ON public.factory_claims;
CREATE POLICY factory_claims_deny_all ON public.factory_claims
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.warranty_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warranty_activities_deny_all ON public.warranty_activities;
CREATE POLICY warranty_activities_deny_all ON public.warranty_activities
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Chạy lại sau khi bảng đã có: bổ sung cột thêm sau.
ALTER TABLE public.warranty_tickets ADD COLUMN IF NOT EXISTS issue_type text;

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT kind, stage, count(*) FROM public.warranty_tickets GROUP BY 1, 2 ORDER BY 1, 2;
-- SELECT warranty_months, count(*) FROM public.products GROUP BY 1 ORDER BY 1;
