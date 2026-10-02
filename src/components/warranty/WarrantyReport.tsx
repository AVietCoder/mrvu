// @ts-nocheck
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { warrantyReportFn, factoryReportFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ScrollX";
import { FACTORY_SOLUTIONS, WARRANTY_STAGES, warrantyActionLabel, warrantyIssueLabel } from "@/lib/types";
import { Loader2, ShieldCheck, ShieldAlert, Wallet, ClipboardList, AlarmClock, PackageCheck, Hourglass, X } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { PRESETS, presetRange, money, shortStaff, shortBranch } from "./shared";

// Màu đã kiểm an toàn cho người mù màu (xanh ↔ đỏ cách nhau đủ xa); "chưa rõ" là xám trung tính.
const C_IN = "#1baf7a";
const C_OUT = "#c81e4a";
const C_PARTIAL = "#eda100";
const C_UNKNOWN = "#94a3b8";
// Hướng xử lý của nhà máy — thứ tự màu CỐ ĐỊNH theo FACTORY_SOLUTIONS.
const SOLUTION_COLOR: Record<string, string> = { replace_part: "#2a78d6", replace_motor: "#eb6834", reject_expired: "#1baf7a", reject_user_fault: "#eda100", __none: "#cbd5e1" };
const SELECT = "h-10 rounded-md border bg-background px-3 text-sm";
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(n / d < 0.1 ? 1 : 0)}%` : "—");
const hours = (h: number | null) => (h === null || h === undefined ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} ngày` : `${h} giờ`);

function Kpi({ label, value, sub, Icon, tone }: any) {
  return (
    <Card className="flex items-center gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="truncate text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
    </Card>
  );
}

/** Thanh tỷ lệ 100% có nhãn trực tiếp (thay biểu đồ tròn). */
function ShareBar({ parts, total }: { parts: { label: string; value: number; color: string }[]; total: number }) {
  const shown = parts.filter((p) => p.value > 0);
  if (!total) return <div className="text-sm text-muted-foreground">Chưa có dữ liệu</div>;
  return (
    <div>
      <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded-md">
        {shown.map((p) => (
          <div key={p.label} title={`${p.label}: ${p.value} (${pct(p.value, total)})`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} <strong className="tabular-nums">{p.value}</strong>
            <span className="text-muted-foreground tabular-nums">({pct(p.value, total)})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Bảng xếp hạng: nhãn + thanh mảnh một màu + số. Bấm dòng để lọc (nếu có onPick). */
function RankTable({ title, hint, rows, cols, onPick }: { title: string; hint?: string; rows: any[]; cols?: { head: string; cell: (r: any) => any }[]; onPick?: (r: any) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b px-4 py-3">
        <div className="font-semibold">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2 font-semibold"></th>
            <th className="px-2 text-right font-semibold">Số ca</th>
            {(cols ?? []).map((c) => <th key={c.head} className="px-2 text-right font-semibold last:pr-4">{c.head}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={2 + (cols?.length ?? 0)} className="py-6 text-center text-muted-foreground">Chưa có dữ liệu</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.key ?? i} className={`border-t ${onPick ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={onPick ? () => onPick(r) : undefined}>
              <td className="px-4 py-2">
                <div className="font-medium">{r.label}</div>
                {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </td>
              <td className="px-2 text-right font-semibold tabular-nums">{r.count}</td>
              {(cols ?? []).map((c) => <td key={c.head} className="px-2 text-right tabular-nums text-muted-foreground last:pr-4">{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TicketReport({ metaHook, range }: any) {
  const { user } = useAuth();
  const { meta } = metaHook;
  const fn = useServerFn(warrantyReportFn);
  const [kind, setKind] = useState("");
  const [branchId, setBranchId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [product, setProduct] = useState<any>(null); // { product_id, name }
  const [dealer, setDealer] = useState<any>(null); // { customer_id, name }

  const { data, isLoading, error } = useQuery({
    queryKey: ["warranty", "report", range.from, range.to, kind, branchId, technicianId, product?.product_id, dealer?.customer_id],
    queryFn: () =>
      fn({
        data: {
          actorId: user?.id, from: range.from || undefined, to: range.to || undefined, kind: kind || undefined,
          branchId: branchId || undefined, technicianId: technicianId || undefined,
          productId: product?.product_id || undefined, customerId: dealer?.customer_id || undefined,
        },
      }),
    enabled: Boolean(user?.id),
  });

  const chart = useMemo(
    () => (data?.byMonth ?? []).map((m: any) => ({ month: `${Number(m.month.slice(5))}/${m.month.slice(2, 4)}`, "Còn hạn": m.in, "Hết hạn": m.out, "Chưa xác định": m.count - m.in - m.out })),
    [data],
  );
  const technicians = (meta?.staff ?? []).filter((u: any) => u.is_technician);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT} value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === "retail") setDealer(null); }}>
          <option value="">Khách lẻ + đại lý</option>
          <option value="retail">Chỉ khách lẻ</option>
          <option value="dealer">Chỉ đại lý</option>
        </select>
        {(meta?.branches ?? []).length > 1 && (
          <select className={SELECT} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Tất cả showroom</option>
            {(meta?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{shortBranch(b.name)}</option>)}
          </select>
        )}
        <select className={SELECT} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Mọi kỹ thuật</option>
          {technicians.map((u: any) => <option key={u.id} value={u.id}>{shortStaff(u.full_name)}</option>)}
        </select>
        {product && <button type="button" onClick={() => setProduct(null)} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 text-xs font-medium text-primary">Mẫu: {product.name}<X className="h-3.5 w-3.5" /></button>}
        {dealer && <button type="button" onClick={() => setDealer(null)} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 text-xs font-medium text-primary">Đại lý: {dealer.name}<X className="h-3.5 w-3.5" /></button>}
      </div>

      {isLoading ? (
        <Card className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : error ? (
        <Card className="text-sm text-destructive">{String((error as any).message)}</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Tổng ca bảo hành" value={data.total} sub={`${data.byKind?.retail ?? 0} khách lẻ · ${data.byKind?.dealer ?? 0} đại lý`} Icon={ClipboardList} tone="bg-slate-100 text-slate-700" />
            <Kpi label="Còn hạn bảo hành" value={pct(data.inCount, data.total)} sub={`${data.inCount} ca`} Icon={ShieldCheck} tone="bg-emerald-100 text-emerald-700" />
            <Kpi label="Hết hạn bảo hành" value={pct(data.outCount, data.total)} sub={`${data.outCount} ca`} Icon={ShieldAlert} tone="bg-rose-100 text-rose-700" />
            <Kpi label="Doanh thu linh kiện" value={`${money(data.partRevenue)}đ`} sub={`${data.partCount} ca có thu tiền`} Icon={Wallet} tone="bg-amber-100 text-amber-700" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Quá 24h chưa phản hồi" value={data.overdue} sub="đang mở" Icon={AlarmClock} tone="bg-rose-100 text-rose-700" />
            <Kpi label="Thời gian phản hồi TB" value={hours(data.avgResponseHours)} sub="từ lúc gửi đến phản hồi đầu" Icon={Hourglass} tone="bg-sky-100 text-sky-700" />
            {WARRANTY_STAGES.filter((s) => ["processing", "done"].includes(s.key)).map((s) => (
              <Kpi key={s.key} label={s.label} value={data.byStage?.[s.key] ?? 0} sub="ca" Icon={s.key === "done" ? PackageCheck : ClipboardList} tone="bg-slate-100 text-slate-700" />
            ))}
          </div>

          <Card>
            <div className="mb-3 font-semibold">Tỷ lệ còn hạn / hết hạn bảo hành</div>
            <ShareBar
              total={data.total}
              parts={[
                { label: "Còn hạn", value: data.inCount, color: C_IN },
                { label: "Còn hạn một phần (chưa rõ bộ phận lỗi)", value: data.partialCount ?? 0, color: C_PARTIAL },
                { label: "Hết hạn", value: data.outCount, color: C_OUT },
                { label: "Chưa rõ ngày mua", value: data.unknownCount, color: C_UNKNOWN },
              ]}
            />
          </Card>

          {chart.length > 0 && (
            <Card>
              <div className="mb-3 font-semibold">Số ca bảo hành theo tháng</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Legend />
                    <Bar dataKey="Còn hạn" stackId="a" fill={C_IN} maxBarSize={24} stroke="#fff" strokeWidth={2} />
                    <Bar dataKey="Hết hạn" stackId="a" fill={C_OUT} maxBarSize={24} stroke="#fff" strokeWidth={2} />
                    <Bar dataKey="Chưa xác định" stackId="a" fill={C_UNKNOWN} maxBarSize={24} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RankTable
              title="Mẫu quạt bị bảo hành nhiều nhất"
              hint="Bấm một dòng để lọc báo cáo theo mẫu đó"
              rows={(data.byProduct ?? []).map((p: any) => ({ ...p, key: p.product_id ?? p.name, label: p.name }))}
              cols={[{ head: "Còn hạn", cell: (r) => r.in }, { head: "Hết hạn", cell: (r) => r.out }]}
              onPick={(r) => r.product_id && setProduct({ product_id: r.product_id, name: r.name })}
            />
            <RankTable
              title="Lỗi phổ biến nhất"
              rows={(data.byIssue ?? []).map((x: any) => ({ ...x, label: x.key === "__none" ? "Chưa phân loại" : warrantyIssueLabel(x.key) }))}
              cols={[{ head: "Tỷ lệ", cell: (r) => pct(r.count, data.total) }]}
            />
            {kind !== "retail" && (
              <RankTable
                title="Đại lý có nhiều yêu cầu bảo hành nhất"
                hint="Bấm một dòng để lọc báo cáo theo đại lý đó"
                rows={(data.byDealer ?? []).map((d: any) => ({ ...d, key: d.customer_id ?? d.name, label: d.name, sub: d.company }))}
                cols={[{ head: "Tiền linh kiện", cell: (r) => (r.part_revenue ? money(r.part_revenue) : "—") }]}
                onPick={(r) => r.customer_id && setDealer({ customer_id: r.customer_id, name: r.name })}
              />
            )}
            <RankTable
              title="Kết quả xử lý cuối"
              rows={(data.byAction ?? []).map((x: any) => ({ ...x, label: warrantyActionLabel(x.key) }))}
              cols={[{ head: "Tỷ lệ", cell: (r) => pct(r.count, data.total) }]}
            />
            <RankTable
              title="Hiệu suất kỹ thuật"
              hint="Thời gian xử lý TB = từ ngày gửi đến lúc hoàn tất (chỉ tính ca đã hoàn tất)"
              rows={(data.byTechnician ?? []).map((x: any) => ({ ...x, key: x.technician_id ?? "__none", label: x.technician_id ? metaHook.staffName(x.technician_id) : "Chưa phân công" }))}
              cols={[{ head: "Hoàn tất", cell: (r) => r.done }, { head: "Xử lý TB / ca", cell: (r) => hours(r.avgHours) }]}
            />
            {(meta?.allBranches ?? []).length > 1 && (
              <RankTable
                title="Theo showroom tiếp nhận"
                rows={(data.byBranch ?? []).map((x: any) => ({ ...x, key: x.branch_id ?? "__none", label: shortBranch(metaHook.branchName(x.branch_id)) }))}
                cols={[{ head: "Tỷ lệ", cell: (r) => pct(r.count, data.total) }]}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FactoryReport({ metaHook, range }: any) {
  const { user } = useAuth();
  const { meta } = metaHook;
  const fn = useServerFn(factoryReportFn);
  const [factoryId, setFactoryId] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["warranty", "factoryReport", range.from, range.to, factoryId],
    queryFn: () => fn({ data: { actorId: user?.id, from: range.from || undefined, to: range.to || undefined, factoryId: factoryId || undefined } }),
    enabled: Boolean(user?.id),
  });
  const legend = [...FACTORY_SOLUTIONS.map((s) => ({ key: s.key, label: s.label })), { key: "__none", label: "NM chưa trả lời" }];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT} value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
          <option value="">Tất cả nhà máy</option>
          {(meta?.factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <Card className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : error ? (
        <Card className="text-sm text-destructive">{String((error as any).message)}</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Tổng ca lỗi gửi nhà máy" value={data.total} Icon={ClipboardList} tone="bg-slate-100 text-slate-700" />
            <Kpi label="Nhà máy nợ chưa trả" value={data.awaiting} sub="linh kiện / động cơ đang chờ" Icon={Hourglass} tone="bg-amber-100 text-amber-700" />
            <Kpi label="Quá hạn gửi trả" value={data.overdue} Icon={AlarmClock} tone="bg-rose-100 text-rose-700" />
            <Kpi label="Đã nhận hàng trả" value={data.returned} Icon={PackageCheck} tone="bg-emerald-100 text-emerald-700" />
          </div>

          <Card>
            <div className="mb-1 font-semibold">Tỷ lệ hướng giải quyết của từng nhà máy</div>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {legend.map((l) => (
                <span key={l.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOLUTION_COLOR[l.key] }} />{l.label}</span>
              ))}
            </div>
            {(data.factories ?? []).length === 0 && <div className="text-sm text-muted-foreground">Chưa có dữ liệu</div>}
            <div className="space-y-3">
              {(data.factories ?? []).map((f: any) => (
                <div key={f.factory_id ?? f.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground tabular-nums">{f.total} ca</span>
                  </div>
                  <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded-md">
                    {legend.map((l) => {
                      const n = l.key === "__none" ? f.noSolution : f.solutions?.[l.key] ?? 0;
                      if (!n) return null;
                      return <div key={l.key} title={`${l.label}: ${n} (${pct(n, f.total)})`} style={{ width: `${(n / f.total) * 100}%`, background: SOLUTION_COLOR[l.key] }} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="border-b px-4 py-3 font-semibold">Chi tiết theo nhà máy</div>
            <ScrollX>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Nhà máy</th>
                    <th className="px-2 text-right font-semibold">Số ca</th>
                    {FACTORY_SOLUTIONS.map((s) => <th key={s.key} className="px-2 text-right font-semibold">{s.label}</th>)}
                    <th className="px-2 text-right font-semibold">Đang nợ</th>
                    <th className="px-2 text-right font-semibold">TB ngày trả</th>
                    <th className="px-4 font-semibold">Mẫu lỗi nhiều nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.factories ?? []).length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Chưa có dữ liệu</td></tr>}
                  {(data.factories ?? []).map((f: any) => (
                    <tr key={f.factory_id ?? f.name} className="border-t align-top">
                      <td className="px-4 py-2 font-medium">{f.name}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{f.total}</td>
                      {FACTORY_SOLUTIONS.map((s) => {
                        const n = f.solutions?.[s.key] ?? 0;
                        return <td key={s.key} className="px-2 py-2 text-right tabular-nums">{n ? <>{n} <span className="text-xs text-muted-foreground">({pct(n, f.total)})</span></> : <span className="text-muted-foreground">—</span>}</td>;
                      })}
                      <td className="px-2 py-2 text-right tabular-nums">{f.awaiting}{f.overdue > 0 && <span className="ml-1 text-xs font-semibold text-rose-600">({f.overdue} quá hạn)</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{f.avgReturnDays === null ? "—" : `${f.avgReturnDays} ngày`}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{(f.topProducts ?? []).map((p: any) => `${p.name} (${p.count})`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          </Card>
        </>
      )}
    </div>
  );
}

/** Báo cáo bảo hành: khách lẻ / đại lý (mọi người, theo chi nhánh) và nhà máy (admin). */
export function WarrantyReport({ metaHook }: any) {
  const isAdmin = Boolean(metaHook.meta?.me?.isAdmin);
  const [which, setWhich] = useState<"tickets" | "factory">("tickets");
  const [preset, setPreset] = useState("year");
  const [range, setRange] = useState(presetRange("year"));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <div className="flex gap-1 rounded-lg border bg-background p-1">
            {[["tickets", "Khách lẻ & đại lý"], ["factory", "Nhà máy"]].map(([k, label]: any) => (
              <button key={k} type="button" onClick={() => setWhich(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${which === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setPreset(k); setRange(presetRange(k)); }} className={`rounded-md px-2.5 py-1 text-sm ${preset === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
        <Input type="date" className="h-10 w-40" value={range.from} onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} />
        <span className="text-muted-foreground">→</span>
        <Input type="date" className="h-10 w-40" value={range.to} onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} />
      </div>
      {which === "factory" && isAdmin ? <FactoryReport metaHook={metaHook} range={range} /> : <TicketReport metaHook={metaHook} range={range} />}
    </div>
  );
}
