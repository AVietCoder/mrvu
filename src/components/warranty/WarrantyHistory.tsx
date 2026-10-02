// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCustomerTicketsFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { warrantyActionLabel } from "@/lib/types";
import { vnDay } from "@/lib/warranty-rules";
import { StageBadge, WarrantyBadge, dmy, money } from "./shared";

/** Lịch sử bảo hành của một khách (các phiếu đã nối với khách này). Không có → ẩn. */
export function WarrantyHistory({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const fn = useServerFn(listCustomerTicketsFn);
  const { data } = useQuery({
    queryKey: ["warranty", "customerTickets", customerId],
    queryFn: () => fn({ data: { actorId: user?.id, customerId } }),
    enabled: Boolean(user?.id && customerId),
  });
  const rows = (data?.rows ?? []) as any[];
  if (!rows.length) return null;
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Lịch sử bảo hành ({rows.length})</h3>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <Link key={r.id} to="/warranty" search={{ ...(r.kind === "dealer" ? { tab: "dealer" } : {}), ticket: r.id } as any} className="block rounded-lg border p-2.5 text-sm hover:bg-muted/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium"><span className="font-mono text-xs">{r.code}</span> · {dmy(vnDay(r.sent_date))}</span>
              <span className="flex flex-wrap items-center gap-1"><WarrantyBadge warranty={r.warranty} expiresOn={r.expires_on} motorIn={r.motor_in} /><StageBadge stage={r.stage} /></span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{[r.product_model, r.issue_note].filter(Boolean).join(" — ") || "—"}</div>
            {r.final_action && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {warrantyActionLabel(r.final_action)}{Number(r.spare_part_price) > 0 ? ` · ${money(r.spare_part_price)}đ` : ""}
              </div>
            )}
          </Link>
        ))}
      </div>
    </Card>
  );
}
