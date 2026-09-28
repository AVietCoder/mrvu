// @ts-nocheck
import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { leadReportFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { LEAD_LOST_REASONS, customerSourceLabel } from "@/lib/types";
import { Loader2, Users, Trophy, Percent, Wallet } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { money, shortStaff } from "./shared";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const COLORS = ["#8b1a1a", "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

function RateTable({ title, rows, label }: { title: string; rows: any[]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b px-4 py-3 font-semibold">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2 font-semibold"></th>
            <th className="px-2 text-right font-semibold">Lead</th>
            <th className="px-2 text-right font-semibold">Chốt</th>
            <th className="px-2 text-right font-semibold">Tỷ lệ</th>
            <th className="px-2 text-right font-semibold">Doanh thu</th>
            <th className="px-4 text-right font-semibold">TB ngày chốt</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Chưa có dữ liệu</td></tr>}
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-4 py-2">
                <div className="font-medium">{label(r.key)}</div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.leads / max) * 100}%` }} />
                </div>
              </td>
              <td className="px-2 text-right tabular-nums">{r.leads}</td>
              <td className="px-2 text-right tabular-nums text-emerald-700">{r.won}</td>
              <td className="px-2 text-right font-semibold tabular-nums">{pct(r.rate)}</td>
              <td className="px-2 text-right tabular-nums">{r.revenue ? money(r.revenue) : "—"}</td>
              <td className="px-4 text-right tabular-nums text-muted-foreground">{r.avgDays === null ? "—" : `${r.avgDays.toFixed(0)} ngày`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function LeadReport({ range, branchId, metaHook }: any) {
  const { user } = useAuth();
  const fn = useServerFn(leadReportFn);
  const from = range.from || "2000-01-01";
  const to = range.to || "2100-01-01";
  const { data, isLoading, error } = useQuery({
    queryKey: ["leads", "report", from, to, branchId],
    queryFn: () => fn({ data: { actorId: user?.id, from, to, branchId: branchId || undefined } }),
  });

  // Biểu đồ: số lead theo tháng, mỗi showroom một cột chồng.
  const { chart, branchKeys } = useMemo(() => {
    const byMonth = new Map<string, any>();
    const keys = new Set<string>();
    for (const r of data?.byMonth ?? []) {
      const [month, bid] = r.key.split("|");
      const name = metaHook.branchName(bid === "__none" ? null : bid).replace(/^Mr\.?\s*V[uũ]\s*-\s*/i, "");
      keys.add(name);
      const row = byMonth.get(month) ?? { month: `${Number(month.slice(5))}/${month.slice(2, 4)}` };
      row[name] = (row[name] ?? 0) + r.leads;
      row["Đã chốt"] = (row["Đã chốt"] ?? 0) + r.won;
      byMonth.set(month, row);
    }
    return { chart: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v), branchKeys: [...keys] };
  }, [data, metaHook]);

  if (isLoading) return <Card className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  const tot = (data?.byBranch ?? []).reduce((a: any, r: any) => ({ leads: a.leads + r.leads, won: a.won + r.won, revenue: a.revenue + r.revenue }), { leads: 0, won: 0, revenue: 0 });
  const lostTotal = (data?.lostReasons ?? []).reduce((a: number, r: any) => a + r.n, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Khách tiềm năng", tot.leads, Users, "bg-slate-100 text-slate-700"],
          ["Đã chốt", tot.won, Trophy, "bg-emerald-100 text-emerald-700"],
          ["Tỷ lệ chốt", tot.leads ? pct(tot.won / tot.leads) : "—", Percent, "bg-primary/10 text-primary"],
          ["Doanh thu từ lead", `${money(tot.revenue)}đ`, Wallet, "bg-amber-100 text-amber-700"],
        ].map(([l, v, Icon, tone]: any) => (
          <Card key={l} className="flex items-center gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">{l}</div>
              <div className="truncate text-2xl font-bold tabular-nums">{v}</div>
            </div>
          </Card>
        ))}
      </div>

      {chart.length > 0 && (
        <Card>
          <div className="mb-3 font-semibold">Khách tiềm năng theo tháng</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {branchKeys.map((k, i) => <Bar key={k} dataKey={k} stackId="b" fill={COLORS[i % COLORS.length]} />)}
                <Bar dataKey="Đã chốt" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RateTable title="Theo showroom" rows={data?.byBranch ?? []} label={(k) => (k === "__none" ? "(không rõ)" : metaHook.branchName(k))} />
        <RateTable title="Theo nhân viên phụ trách" rows={data?.byOwner ?? []} label={(k) => (k === "__none" ? "Chưa gán" : metaHook.staffName(k))} />
        <RateTable title="Theo nguồn (Biết Mr.Vũ qua đâu)" rows={data?.bySource ?? []} label={(k) => (k === "__none" ? "Chưa có nguồn" : customerSourceLabel(k))} />
        <RateTable title="Mẫu được hỏi nhiều nhất" rows={data?.byProduct ?? []} label={(k) => (data?.byProduct ?? []).find((p: any) => p.key === k)?.name ?? k} />
      </div>

      <Card>
        <div className="mb-3 font-semibold">Lý do không chốt ({lostTotal})</div>
        {lostTotal === 0 ? (
          <div className="text-sm text-muted-foreground">Chưa có.</div>
        ) : (
          <div className="space-y-2">
            {(data?.lostReasons ?? []).map((r: any) => (
              <div key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-56 shrink-0">{LEAD_LOST_REASONS.find((x) => x.key === r.key)?.label ?? "(không rõ)"}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${(r.n / lostTotal) * 100}%` }} />
                </div>
                <span className="w-16 text-right tabular-nums">{r.n} ({pct(r.n / lostTotal)})</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
