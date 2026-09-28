// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCustomerLeadsFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { LEAD_LOST_REASONS } from "@/lib/types";
import { useLeadMeta, StageBadge, dmy, money, shortStaff } from "./shared";

/** Lịch sử tư vấn của một khách (các lead đã nối với khách này). Không có → ẩn. */
export function ConsultHistory({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const fn = useServerFn(listCustomerLeadsFn);
  const metaHook = useLeadMeta();
  const { data } = useQuery({
    queryKey: ["customerLeads", customerId],
    queryFn: () => fn({ data: { actorId: user?.id, customerId } }),
    enabled: Boolean(user?.id && customerId),
  });
  const rows = (data?.rows ?? []) as any[];
  if (!rows.length) return null;
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Lịch sử tư vấn ({rows.length})</h3>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <Link key={r.id} to="/customers" search={{ tab: "leads", lead: r.id } as any} className="block rounded-lg border p-2.5 text-sm hover:bg-muted/40">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{dmy(r.lead_date)} · {metaHook.branchName(r.branch_id).replace(/^Mr\.?\s*V[uũ]\s*-\s*/i, "")}</span>
              <StageBadge stage={r.stage} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {[...(r.interest_product_ids ?? []).map(metaHook.productName), r.interest_note].filter(Boolean).join(", ") || "—"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {shortStaff(metaHook.staffName(r.owner_id))}
              {r.stage === "won" && r.won_amount ? ` · ${money(r.won_amount)}đ` : ""}
              {r.stage === "lost" ? ` · ${LEAD_LOST_REASONS.find((x) => x.key === r.lost_reason)?.label ?? ""}` : ""}
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
