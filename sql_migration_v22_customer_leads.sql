-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION V22 — KHÁCH TIỀM NĂNG (thay file "QUẢN LÝ KHÁCH HÀNG HCM - 2026.xlsx")
--
-- Chạy trong Supabase Dashboard → SQL Editor → Run. Chạy lại nhiều lần an toàn.
--
-- customer_leads  : mỗi lượt khách hỏi / ghé showroom (lead). Tự nối với khách
--                   (customer_id) theo SĐT; tự chuyển "Đã chốt" khi khách có đơn.
-- lead_activities : nhật ký chăm sóc từng lần (thay cột "QUÁ TRÌNH CARE").
--
-- stage: new → consulting → appointment → quoted → won | lost
-- Có SĐT + tên khách → RLS deny-all, server đọc ghi bằng service role sau khi
-- kiểm quyền theo chi nhánh.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_leads (
  id                   text        PRIMARY KEY,
  branch_id            text        REFERENCES public.branches(id) ON DELETE SET NULL,
  lead_date            date        NOT NULL,
  name                 text        NOT NULL,
  phone                text,
  address              text,
  interest_product_ids text[]      NOT NULL DEFAULT '{}',
  interest_note        text,
  source               text,
  source_note          text,
  stage                text        NOT NULL DEFAULT 'new'
                       CHECK (stage IN ('new', 'consulting', 'appointment', 'quoted', 'won', 'lost')),
  lost_reason          text,
  lost_note            text,
  owner_id             text        REFERENCES public.users(id) ON DELETE SET NULL,
  helper_ids           text[]      NOT NULL DEFAULT '{}',
  customer_id          text        REFERENCES public.customers(id) ON DELETE SET NULL,
  won_order_id         text,
  won_amount           numeric,
  won_at               timestamptz,
  won_auto             boolean     NOT NULL DEFAULT false,
  next_follow_up       date,
  last_activity_at     timestamptz,
  legacy_staff         text,
  legacy_status        text,
  import_ref           text        UNIQUE,
  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_branch_date ON public.customer_leads (branch_id, lead_date DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON public.customer_leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_owner       ON public.customer_leads (owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_customer    ON public.customer_leads (customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage_fu    ON public.customer_leads (stage, next_follow_up);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id         text        PRIMARY KEY,
  lead_id    text        NOT NULL REFERENCES public.customer_leads(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    text,
  kind       text        NOT NULL DEFAULT 'note'
             CHECK (kind IN ('note', 'call', 'zalo', 'quote', 'visit', 'stage')),
  content    text        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON public.lead_activities (lead_id, at DESC);

ALTER TABLE public.customer_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_leads_deny_all ON public.customer_leads;
CREATE POLICY customer_leads_deny_all ON public.customer_leads
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_activities_deny_all ON public.lead_activities;
CREATE POLICY lead_activities_deny_all ON public.lead_activities
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';

-- KIỂM TRA:
-- SELECT b.name, l.stage, count(*) FROM public.customer_leads l
--   LEFT JOIN public.branches b ON b.id = l.branch_id GROUP BY 1, 2 ORDER BY 1, 2;
