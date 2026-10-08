// @ts-nocheck
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDailyReportFn } from "@/lib/daily-report.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerName } from "@/components/CustomerName";
import { SCHEDULE_TYPES, customerSourceLabel, warrantyStageOf } from "@/lib/types";
import { todayVN, addDaysVN, formatDateVN } from "@/lib/date-vn";
import {
  ChevronLeft, ChevronRight, RefreshCw, Loader2, TrendingUp, ShoppingBag, ClipboardList, Fan, Puzzle,
  UserPlus, Wrench, CalendarDays, ArrowDownToLine, ArrowUpFromLine, Wallet, Landmark,
} from "lucide-react";

const money = (n: any) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const weekdayOf = (d: string) => WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
const shortBranch = (name?: string | null) => String(name ?? "").replace(/^Mr\.?\s*V[uũUŨ]\s*-\s*/i, "");
const SCHEDULE_STATUS: Record<string, string> = { pending: "Chờ duyệt", approved: "Đã duyệt", in_progress: "Đang làm", done: "Hoàn thành" };

/** Khung sát mép cho bảng / danh sách (Card của AppShell luôn có lề p-5). */
function Panel({ children, className = "" }: any) {
  return <div className={`overflow-hidden rounded-xl border bg-card shadow-sm ${className}`}>{children}</div>;
}

/** Ô số liệu: nhãn + con số chính + dòng phụ. Màu chỉ ở biểu tượng, chữ giữ màu mực. */
function Tile({ label, value, unit, sub, Icon, tone = "bg-slate-100 text-slate-700", big = false }: any) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`truncate font-bold tabular-nums ${big ? "text-2xl sm:text-3xl" : "text-2xl"}`}>
          {value}{unit && <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </Card>
  );
}

/** Thu hoặc chi: tổng, tách tiền mặt / ngân hàng, và từng loại phiếu. */
function CashCard({ title, side, rows, internal, Icon, tone }: any) {
  const max = Math.max(1, ...rows.map((r: any) => r.amount));
  return (
    <Panel>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="text-2xl font-bold tabular-nums">{money(side.total)}<span className="ml-1 text-base font-semibold text-muted-foreground">đ</span></div>
        </div>
        <div className="text-right text-xs text-muted-foreground">{side.count} phiếu</div>
      </div>
      <div className="grid grid-cols-2 divide-x border-b text-sm">
        <div className="flex items-center gap-2 px-4 py-2.5"><Wallet className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Tiền mặt</span><strong className="ml-auto tabular-nums">{money(side.tien_mat)}</strong></div>
        <div className="flex items-center gap-2 px-4 py-2.5"><Landmark className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Ngân hàng</span><strong className="ml-auto tabular-nums">{money(side.ngan_hang)}</strong></div>
      </div>
      <div className="divide-y text-sm">
        {rows.length === 0 && <div className="px-4 py-5 text-center text-muted-foreground">Không có phiếu nào</div>}
        {rows.map((r: any) => (
          <div key={r.name} className="px-4 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{r.name} <span className="text-xs text-muted-foreground">· {r.count} phiếu</span></span>
              <span className="shrink-0 font-medium tabular-nums">{money(r.amount)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.amount / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      {internal > 0 && <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Trong đó chuyển quỹ nội bộ: <strong className="tabular-nums text-foreground">{money(internal)}đ</strong> (không phải tiền {title.includes("thu") ? "khách trả" : "chi phí"}).</div>}
    </Panel>
  );
}

function OrdersTable({ title, rows, total, empty, showCollected }: any) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <div className="font-semibold">{title} <span className="font-normal text-muted-foreground">({total})</span></div>
        {total > rows.length && <div className="text-xs text-muted-foreground">hiện {rows.length} đơn lớn nhất</div>}
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="w-[84px] px-3 py-2 font-semibold sm:w-[92px] sm:px-4">Mã đơn</th>
              <th className="px-2 font-semibold">Khách hàng · showroom</th>
              <th className="w-[96px] pl-2 pr-3 text-right font-semibold sm:w-[104px] sm:px-2">Tổng tiền</th>
              {/* Điện thoại: ẩn cột Đã thu để tên khách đủ chỗ */}
              {showCollected && <th className="hidden w-[104px] pl-2 pr-4 text-right font-semibold sm:table-cell">Đã thu</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((o: any) => (
              <tr key={o.id} className="cursor-pointer border-t align-top hover:bg-muted/40" onClick={() => window.open(`/orders/${o.id}`, "_blank", "noopener,noreferrer")} title="Mở chi tiết đơn ở tab mới">
                <td className="px-3 py-2 font-mono text-xs font-semibold sm:px-4">{o.code}</td>
                <td className="px-2 py-2">
                  <CustomerName name={o.customer_name} company={o.customer_company} className="font-medium" />
                  <div className="truncate text-xs text-muted-foreground">{[shortBranch(o.branch_name), o.employee_name].filter(Boolean).join(" · ") || "—"}</div>
                </td>
                <td className="py-2 pl-2 pr-3 text-right font-medium tabular-nums sm:px-2">{money(o.total)}</td>
                {showCollected && <td className="hidden py-2 pl-2 pr-4 text-right tabular-nums text-muted-foreground sm:table-cell">{money(o.collected)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Báo cáo 1 ngày: mọi chỉ số của một ngày (giờ Việt Nam) trên một màn hình. Chỉ admin. */
export function DailyReport() {
  const { user } = useAuth();
  const fn = useServerFn(getDailyReportFn);
  const today = todayVN();
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState("");
  const { data: d, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["dailyReport", date, branchId],
    queryFn: () => fn({ data: { actorId: user?.id, date, branchId: branchId || undefined } }),
    enabled: Boolean(user?.id),
    placeholderData: (prev: any) => prev,
    staleTime: 30_000,
  });
  const sched = (type: string) => d?.schedules?.byType?.[type] ?? { total: 0, done: 0 };
  const otherSchedules = (d?.schedules?.total ?? 0) - sched("install").total - sched("delivery").total - sched("warranty").total;
  const typeLabel = (t: string) => SCHEDULE_TYPES.find((x) => x.value === t)?.label ?? t;

  return (
    <div className="space-y-4">
      {/* Chọn ngày + chi nhánh — một hàng phía trên số liệu */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Ngày trước" onClick={() => setDate(addDaysVN(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" className="h-10 w-44" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Ngày sau" disabled={date >= today} onClick={() => setDate(addDaysVN(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <div className="flex gap-1 rounded-lg border bg-background p-1">
          {[["Hôm nay", today], ["Hôm qua", addDaysVN(today, -1)]].map(([label, v]) => (
            <button key={label} type="button" onClick={() => setDate(v)} className={`rounded-md px-3 py-1 text-sm ${date === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
        <div className="text-sm font-medium">{weekdayOf(date)}, {formatDateVN(date)}</div>
        <select className="ml-auto h-10 rounded-md border bg-background px-3 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Tất cả chi nhánh</option>
          {(d?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Tải lại" onClick={() => refetch()}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error ? (
        <Card className="text-sm text-destructive">{String((error as any).message)}</Card>
      ) : isLoading || !d ? (
        <Card className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : (
        <div className={`space-y-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
          {/* Tiền */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Tile big label="Doanh thu bán hàng" value={money(d.revenue.net)} unit="đ" Icon={TrendingUp} tone="bg-primary/10 text-primary"
              sub={d.revenue.returns > 0 ? `Bán ${money(d.revenue.sales)} − trả hàng ${money(d.revenue.returns)} (${d.revenue.returnCount} phiếu)` : "Đơn hoàn tất trong ngày, không có trả hàng"} />
            <Tile big label="Tổng tiền thu về" value={money(d.cash.thu.total)} unit="đ" Icon={ArrowDownToLine} tone="bg-emerald-100 text-emerald-700"
              sub={`Tiền mặt ${money(d.cash.thu.tien_mat)} · Ngân hàng ${money(d.cash.thu.ngan_hang)}`} />
            <Tile big label="Tổng tiền chi ra" value={money(d.cash.chi.total)} unit="đ" Icon={ArrowUpFromLine} tone="bg-rose-100 text-rose-700"
              sub={`Tiền mặt ${money(d.cash.chi.tien_mat)} · Ngân hàng ${money(d.cash.chi.ngan_hang)}`} />
          </div>

          {/* Đơn hàng + hàng bán ra */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Đơn bán hàng" value={d.sales.count} unit="đơn" Icon={ShoppingBag} tone="bg-sky-100 text-sky-700" sub={`Tổng ${money(d.sales.total)}đ`} />
            <Tile label="Đơn đặt hàng" value={d.reserved.count} unit="đơn" Icon={ClipboardList} tone="bg-amber-100 text-amber-700"
              sub={`Tổng ${money(d.reserved.total)}đ${d.reserved.deposit > 0 ? ` · đã cọc ${money(d.reserved.deposit)}đ` : ""}`} />
            <Tile label="Quạt bán ra" value={d.units.fan} unit="chiếc" Icon={Fan} tone="bg-violet-100 text-violet-700" sub={d.units.fanReturned > 0 ? `Khách trả lại ${d.units.fanReturned} chiếc` : "Trên đơn hoàn tất"} />
            <Tile label="Phụ kiện bán ra" value={d.units.accessory} unit="món" Icon={Puzzle} tone="bg-slate-100 text-slate-700"
              sub={[d.units.service > 0 ? `Dịch vụ: ${d.units.service}` : "", d.units.accessoryReturned > 0 ? `trả lại ${d.units.accessoryReturned}` : ""].filter(Boolean).join(" · ") || "Trên đơn hoàn tất"} />
          </div>

          {/* Khách, bảo hành, lịch */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Khách hàng mới" value={d.newCustomers.count} unit="khách" Icon={UserPlus} tone="bg-emerald-100 text-emerald-700" sub={branchId ? "Toàn hệ thống (khách không gắn chi nhánh)" : undefined} />
            <Tile label="Ca bảo hành mới" value={d.warranty.count} unit="ca" Icon={Wrench} tone="bg-orange-100 text-orange-700"
              sub={d.missing?.includes("warranty") ? "Chưa có bảng bảo hành" : `Khách lẻ ${d.warranty.retail} · Đại lý ${d.warranty.dealer}`} />
            {["install", "delivery", "warranty"].map((t) => (
              <Tile key={t} label={`Lịch ${typeLabel(t).toLowerCase()}`} value={sched(t).total} unit="lịch" Icon={CalendarDays} tone="bg-blue-100 text-blue-700"
                sub={sched(t).total ? `Đã hoàn thành ${sched(t).done}/${sched(t).total}` : "Không có lịch"} />
            ))}
          </div>
          {(otherSchedules > 0 || d.cancelled.count > 0) && (
            <div className="text-xs text-muted-foreground">
              {[otherSchedules > 0 ? `Ngoài ra có ${otherSchedules} lịch loại khác (khảo sát…)` : "", d.cancelled.count > 0 ? `${d.cancelled.count} đơn tạo trong ngày đã huỷ (${money(d.cancelled.total)}đ)` : ""].filter(Boolean).join(" · ")}
            </div>
          )}

          {/* Thu / chi theo loại phiếu */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <CashCard title="Tiền thu về" side={d.cash.thu} rows={d.cash.byType.filter((r: any) => r.type === "thu")} internal={d.cash.internalThu} Icon={ArrowDownToLine} tone="bg-emerald-100 text-emerald-700" />
            <CashCard title="Tiền chi ra" side={d.cash.chi} rows={d.cash.byType.filter((r: any) => r.type === "chi")} internal={d.cash.internalChi} Icon={ArrowUpFromLine} tone="bg-rose-100 text-rose-700" />
          </div>

          {/* Chi tiết đơn */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <OrdersTable title="Đơn bán hàng (hoàn tất)" rows={d.orders.completed} total={d.sales.count} empty="Chưa có đơn hoàn tất trong ngày" showCollected />
            <OrdersTable title="Đơn đặt hàng" rows={d.orders.reserved} total={d.reserved.count} empty="Không có đơn đặt hàng mới" showCollected />
          </div>
          {d.orders.returned.length > 0 && <OrdersTable title="Phiếu trả hàng" rows={d.orders.returned} total={d.revenue.returnCount} empty="" />}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel>
              <div className="border-b px-4 py-3 font-semibold">Hàng bán ra nhiều nhất</div>
              <div className="divide-y text-sm">
                {d.topProducts.length === 0 && <div className="py-6 text-center text-muted-foreground">Chưa bán hàng nào</div>}
                {d.topProducts.map((p: any) => (
                  <div key={p.product_id} className="flex items-baseline gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                    {p.kind === "accessory" && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-xs text-slate-600">phụ kiện</span>}
                    <strong className="tabular-nums">{p.qty}</strong>
                    <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <div className="border-b px-4 py-3 font-semibold">Lịch trong ngày <span className="font-normal text-muted-foreground">({d.schedules.total})</span></div>
              <div className="max-h-80 divide-y overflow-y-auto text-sm">
                {d.schedules.rows.length === 0 && <div className="py-6 text-center text-muted-foreground">Không có lịch</div>}
                {d.schedules.rows.map((s: any) => (
                  <div key={s.id} className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${SCHEDULE_TYPES.find((x) => x.value === s.type)?.color ?? "bg-muted"}`}>{typeLabel(s.type)}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{s.time ?? ""}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{SCHEDULE_STATUS[s.status] ?? s.status}</span>
                    </div>
                    <div className="mt-0.5 truncate">{s.title}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel>
                <div className="border-b px-4 py-3 font-semibold">Khách hàng mới <span className="font-normal text-muted-foreground">({d.newCustomers.count})</span></div>
                <div className="max-h-40 divide-y overflow-y-auto text-sm">
                  {d.newCustomers.rows.length === 0 && <div className="py-5 text-center text-muted-foreground">Không có khách mới</div>}
                  {d.newCustomers.rows.map((c: any) => (
                    <a key={c.id} href={`/customers/${c.id}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 hover:bg-muted/40">
                      <CustomerName name={c.name} company={c.company_name} className="font-medium" />
                      <div className="text-xs text-muted-foreground">{[c.phone, customerSourceLabel(c.source)].filter(Boolean).join(" · ") || "—"}</div>
                    </a>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div className="border-b px-4 py-3 font-semibold">Ca bảo hành mới <span className="font-normal text-muted-foreground">({d.warranty.count})</span></div>
                <div className="max-h-40 divide-y overflow-y-auto text-sm">
                  {d.warranty.rows.length === 0 && <div className="py-5 text-center text-muted-foreground">Không có ca bảo hành mới</div>}
                  {d.warranty.rows.map((t: any) => (
                    <a key={t.id} href={`/warranty?${t.kind === "dealer" ? "tab=dealer&" : ""}ticket=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 hover:bg-muted/40">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{t.code}</span>
                        <span className="truncate">{t.customer_name}</span>
                        <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-xs ${warrantyStageOf(t.stage).tone}`}>{warrantyStageOf(t.stage).label}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{t.kind === "dealer" ? "Đại lý" : "Khách lẻ"} · {t.product_model || "—"}</div>
                    </a>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Cách tính:</strong> Doanh thu và đơn bán hàng = đơn <em>hoàn tất</em> trong ngày (trừ phiếu trả hàng), khớp trang "Doanh thu theo kỳ".
            Đơn đặt hàng = đơn còn ở trạng thái đặt hàng tạo trong ngày. Tiền thu / chi = phiếu thu / phiếu chi đang hiệu lực trong Sổ quỹ, khớp "Tổng thu / Tổng chi" ở Sổ quỹ.
            Ca bảo hành tính theo ngày gửi bảo hành; lịch tính theo ngày hẹn (không tính lịch đã huỷ). Mọi mốc ngày theo giờ Việt Nam.
          </div>
        </div>
      )}
    </div>
  );
}
