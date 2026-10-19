// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cake, PartyPopper } from "lucide-react";
import { Card } from "@/components/AppShell";
import { getStaffBirthdaysFn } from "@/lib/team.functions";

/**
 * Tổng quan: hôm nay sinh nhật nhân viên nào + danh sách sinh nhật trong tháng.
 * Ai cũng xem được. Không có ai sinh tháng này → ẩn.
 */
export function StaffBirthdayCard({ isAdmin = false }: { isAdmin?: boolean }) {
  const fn = useServerFn(getStaffBirthdaysFn);
  const { data } = useQuery({ queryKey: ["staffBirthdays"], queryFn: () => fn(), staleTime: 30 * 60_000 });
  const month = (data?.month ?? []) as any[];
  if (!month.length) {
    // Chưa nhân viên nào có ngày sinh → nhắc admin nhập ở trang Nhân viên.
    if (isAdmin && data && data.withBirthday === 0) {
      return (
        <Card className="flex items-center gap-3 text-sm text-muted-foreground">
          <Cake className="h-5 w-5 shrink-0 text-pink-600" />
          <span>Chưa có nhân viên nào được nhập ngày sinh, nên mục "Sinh nhật nhân viên" chưa hiện. Nhập ngày sinh ở trang <a href="/employees" className="font-medium text-primary hover:underline">Nhân viên</a>.</span>
        </Card>
      );
    }
    return null;
  }
  const today = month.filter((u) => u.isToday);
  const m = Number(String(data.today).slice(5, 7));
  const dd = (u: any) => `${String(u.day).padStart(2, "0")}/${String(u.month).padStart(2, "0")}`;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-pink-100 text-pink-700"><Cake className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Sinh nhật nhân viên</div>
          <div className="text-xs text-muted-foreground">Tháng {m}: {month.length} người{today.length ? ` · hôm nay ${today.length} người` : ""}</div>
        </div>
      </div>
      {today.length > 0 && (
        <div className="border-b bg-pink-50/60 px-4 py-3 dark:bg-pink-950/20">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-pink-700"><PartyPopper className="h-4 w-4" />Hôm nay sinh nhật</div>
          <div className="flex flex-wrap gap-2">
            {today.map((u) => (
              <span key={u.id} className="rounded-full border border-pink-200 bg-card px-3 py-1 text-sm font-medium">
                🎂 {u.full_name}{u.age ? <span className="font-normal text-muted-foreground"> · {u.age} tuổi</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="divide-y">
        {month.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${u.isPast ? "opacity-55" : ""}`}>
            <span className={`w-12 shrink-0 font-mono text-xs tabular-nums ${u.isToday ? "font-bold text-pink-700" : "text-muted-foreground"}`}>{dd(u)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{u.full_name}</div>
              {(u.position || u.branches.length > 0) && (
                <div className="truncate text-xs text-muted-foreground">{[u.position, u.branches.join(", ")].filter(Boolean).join(" · ")}</div>
              )}
            </div>
            {u.isToday && <span className="whitespace-nowrap rounded-full bg-pink-100 px-2 py-0.5 text-xs font-semibold text-pink-700">Hôm nay</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
