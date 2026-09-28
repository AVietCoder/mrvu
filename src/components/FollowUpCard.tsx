// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { myFollowUpsFn } from "@/lib/leads.functions";
import { Card } from "@/components/AppShell";
import { CalendarClock, ChevronRight } from "lucide-react";
import { StageBadge, dm } from "@/components/leads/shared";

/**
 * "Cần chăm hôm nay": khách tiềm năng mình phụ trách / hỗ trợ đã tới hoặc quá
 * ngày hẹn chăm. Không có gì cần chăm (hoặc chưa chạy migration v22) → ẩn.
 */
export function FollowUpCard({ userId }: { userId: string }) {
  const fn = useServerFn(myFollowUpsFn);
  const { data } = useQuery({
    queryKey: ["myFollowUps", userId],
    queryFn: () => fn({ data: { actorId: userId } }),
    enabled: Boolean(userId),
    refetchInterval: 5 * 60_000,
  });
  const rows = (data?.rows ?? []) as any[];
  if (!rows.length) return null;
  const today = data.today;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-700"><CalendarClock className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Cần chăm hôm nay</div>
          <div className="text-xs text-muted-foreground">{rows.length} khách tiềm năng tới hẹn</div>
        </div>
        <Link to="/customers" search={{ tab: "leads" } as any} className="text-sm text-primary hover:underline">Xem tất cả</Link>
      </div>
      <div className="divide-y">
        {rows.slice(0, 8).map((r) => (
          <Link key={r.id} to="/customers" search={{ tab: "leads", lead: r.id } as any} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.name} <span className="font-normal text-muted-foreground">{r.phone ?? ""}</span></div>
              <div className="truncate text-xs text-muted-foreground">{r.interest_note || "—"}</div>
            </div>
            <StageBadge stage={r.stage} />
            <span className={`w-14 text-right text-xs font-semibold ${r.next_follow_up < today ? "text-rose-600" : "text-amber-700"}`}>
              {r.next_follow_up < today ? `trễ ${dm(r.next_follow_up)}` : "hôm nay"}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
