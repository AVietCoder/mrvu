// @ts-nocheck
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMySalaryFn } from "@/lib/hr.functions";
import { getSettings } from "@/lib/settings.functions";
import { printPayslips } from "@/lib/export-hr";
import { todayVN } from "@/lib/date-vn";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Wallet, ChevronLeft, ChevronRight, Eye, EyeOff, Printer, Loader2, Lock, CheckCircle2, Clock } from "lucide-react";

const money = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const shiftMonth = (m: string, d: number) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1 + d, 1)).toISOString().slice(0, 7);
};
const HIDE_KEY = "mrvu.mySalary.hidden";

/**
 * "Lương của tôi" — nhân viên xem bảng lương của CHÍNH MÌNH theo tháng.
 * Hiện ở trang Tổng quan cho mọi người trừ admin (admin đã có Báo cáo /
 * Bảng lương). Số tiền có nút ẩn/hiện (nhớ trong trình duyệt) vì màn hình
 * quầy thường có người khác nhìn thấy.
 */
export function MySalaryCard({ userId }: { userId: string }) {
  const fn = useServerFn(getMySalaryFn);
  const settingsFn = useServerFn(getSettings);
  const thisMonth = todayVN().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleHidden = () => {
    setHidden((h) => {
      try {
        localStorage.setItem(HIDE_KEY, h ? "0" : "1");
      } catch {}
      return !h;
    });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["mySalary", userId, month],
    queryFn: () => fn({ data: { actorId: userId, month } }),
    enabled: Boolean(userId),
  });
  const { data: settings } = useQuery({ queryKey: ["site_settings"], queryFn: () => settingsFn(), staleTime: 60_000 });

  const r = data?.row;
  const [y, mm] = month.split("-");
  const v = (n: number) => (hidden ? "••••••" : money(n));

  const status = !r ? null : r.paid
    ? { label: "Đã chi lương", cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 }
    : r.locked
      ? { label: "Đã chốt, chờ chi", cls: "bg-orange-100 text-orange-700", Icon: Lock }
      : { label: "Tạm tính — chưa chốt", cls: "bg-slate-100 text-slate-600", Icon: Clock };

  const incomes: [string, number, string?][] = r
    ? [
        [`Lương theo công (${r.worked_days}/${r.standard_days} công)`, r.salary_by_days],
        [`DS kỹ thuật${r.tech_count ? ` (${r.tech_count} lịch)` : ""}`, r.tech_revenue],
        ["DS bán hàng", r.commission],
        [`DS kinh doanh${month === thisMonth ? " (tính đến hôm nay)" : ""}`, r.business_revenue],
        [`Tăng ca${r.ot_hours_15 || r.ot_hours_20 ? ` (${[r.ot_hours_15 ? `${r.ot_hours_15}h×1,5` : "", r.ot_hours_20 ? `${r.ot_hours_20}h×2` : ""].filter(Boolean).join(" + ")})` : ""}`, r.overtime_amount],
        ["Xăng xe đi tỉnh", r.travel_allowance, r.travel_note],
        ["Thưởng", r.bonus],
        ["Phụ cấp", r.extra_allowance, r.extra_note],
      ].filter(([, n]) => Number(n))
    : [];
  const deductions: [string, number, string?][] = r
    ? [
        ["Tạm ứng lương", r.advance],
        ["BHXH", r.social_insurance],
        ["Công đoàn", r.union_fee],
        ["Trừ khác", r.other_deduction, r.other_note],
      ].filter(([, n]) => Number(n))
    : [];

  return (
    <Card className="p-0 overflow-hidden">
      {/* Đầu thẻ */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Wallet className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Lương của tôi</div>
          <div className="text-xs text-muted-foreground">Chỉ bạn nhìn thấy</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Tháng trước">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[96px] text-center text-sm font-semibold">Tháng {Number(mm)}/{y}</div>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Tháng sau">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleHidden} title={hidden ? "Hiện số tiền" : "Ẩn số tiền"}>
          {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="px-4 py-6 text-sm text-destructive">{String((error as any).message)}</div>
      ) : !r ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Chưa có bảng lương tháng {Number(mm)}/{y} của bạn.
          <div className="mt-1 text-xs">Nếu bạn nghĩ đây là nhầm lẫn, hãy báo quản lý / kế toán thêm hồ sơ lương cho bạn.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,260px)_1fr]">
          {/* Thực lĩnh */}
          <div className="flex flex-col justify-center gap-2 border-b bg-primary/5 px-5 py-5 md:border-b-0 md:border-r">
            <div className="text-sm text-muted-foreground">Thực lĩnh</div>
            <div className={`text-3xl font-bold tabular-nums tracking-tight ${r.net_pay < 0 ? "text-rose-600" : "text-primary"}`}>
              {v(r.net_pay)}<span className="ml-0.5 text-lg">đ</span>
            </div>
            {status && (
              <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                <status.Icon className="h-3.5 w-3.5" />{status.label}
              </span>
            )}
            {r.sales_pending && (
              <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                DS bán hàng tính theo cả tháng — sẽ hiện sau khi hết tháng {Number(mm)}/{y}. Thực lĩnh trên chưa gồm khoản này.
              </div>
            )}
            {r.no_attendance && !r.locked && (
              <div className="text-xs text-orange-600">Tháng này chưa được chấm công — số liệu còn thay đổi.</div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
              onClick={() => printPayslips([r], month, settings?.site_name?.trim() || "MR*VU")}
            >
              <Printer className="mr-1.5 h-4 w-4" />In phiếu lương
            </Button>
          </div>

          {/* Chi tiết */}
          <div className="grid grid-cols-1 gap-x-6 px-5 py-4 text-sm sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">Thu nhập</div>
              <div className="space-y-1">
                {incomes.length === 0 && <div className="text-muted-foreground">—</div>}
                {incomes.map(([l, n, note]) => (
                  <div key={l} className="flex justify-between gap-3">
                    <span className="text-slate-600" title={note || undefined}>{l}</span>
                    <span className="shrink-0 font-medium tabular-nums">{v(n)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-1 font-semibold">
                  <span>Tổng thu nhập</span><span className="tabular-nums">{v(r.gross)}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 sm:mt-0">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700">Khấu trừ</div>
              <div className="space-y-1">
                {deductions.length === 0 && <div className="text-muted-foreground">Không có</div>}
                {deductions.map(([l, n, note]) => (
                  <div key={l} className="flex justify-between gap-3">
                    <span className="text-slate-600" title={note || undefined}>{l}</span>
                    <span className="shrink-0 font-medium tabular-nums">{v(n)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-1 font-semibold">
                  <span>Tổng khấu trừ</span><span className="tabular-nums">{v(r.deductions)}</span>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Lương cơ bản {v(r.base_salary)}đ · {r.standard_days} công chuẩn
                {r.bank_account && <> · Nhận qua {r.bank_name} {hidden ? "••••" : r.bank_account}</>}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
