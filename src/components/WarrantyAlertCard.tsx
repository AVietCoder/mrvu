// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { warrantyAlertsFn } from "@/lib/warranty.functions";
import { Card } from "@/components/AppShell";
import { AlarmClock, ChevronRight, Hourglass } from "lucide-react";

/**
 * Cảnh báo bảo hành ở trang Tổng quan:
 *   - phiếu quá 24h chưa phản hồi (trong các chi nhánh mình được gán);
 *   - hàng lỗi nhà máy quá hạn gửi trả (chỉ admin).
 * Không có gì cần nhắc (hoặc chưa chạy migration v23) → ẩn.
 */
export function WarrantyAlertCard({ userId }: { userId: string }) {
  const fn = useServerFn(warrantyAlertsFn);
  const { data } = useQuery({
    queryKey: ["warrantyAlerts", userId],
    queryFn: () => fn({ data: { actorId: userId } }),
    enabled: Boolean(userId),
    refetchInterval: 5 * 60_000,
  });
  const tickets = (data?.tickets ?? []) as any[];
  const claims = (data?.claims ?? []) as any[];
  if (!tickets.length && !claims.length) return null;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-rose-100 text-rose-700"><AlarmClock className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Bảo hành cần xử lý</div>
          <div className="text-xs text-muted-foreground">
            {[data.ticketCount ? `${data.ticketCount} phiếu quá 24h chưa phản hồi` : "", data.claimCount ? `${data.claimCount} hàng nhà máy quá hạn gửi trả` : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Link to="/warranty" className="text-sm text-primary hover:underline">Xem tất cả</Link>
      </div>
      <div className="divide-y">
        {tickets.map((t) => (
          <Link key={t.id} to="/warranty" search={{ ...(t.kind === "dealer" ? { tab: "dealer" } : {}), ticket: t.id } as any} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium"><span className="font-mono text-xs">{t.code}</span> · {t.customer_name}</div>
              <div className="truncate text-xs text-muted-foreground">{t.kind === "dealer" ? "Đại lý" : "Khách lẻ"} · {t.product_model || "—"}</div>
            </div>
            <span className="whitespace-nowrap text-xs font-semibold text-rose-600">chờ {t.hours_waiting >= 48 ? `${Math.floor(t.hours_waiting / 24)} ngày` : `${t.hours_waiting} giờ`}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
        {claims.map((c) => (
          <Link key={c.id} to="/warranty" search={{ tab: "awaiting" } as any} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
            <Hourglass className="h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium"><span className="font-mono text-xs">{c.code}</span> · {c.factory_name ?? "Nhà máy"}</div>
              <div className="truncate text-xs text-muted-foreground">Chờ nhà máy gửi trả · {c.product_model || "—"}</div>
            </div>
            <span className="whitespace-nowrap text-xs font-semibold text-rose-600">{c.days_waiting} ngày (hạn {c.sla_days})</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
