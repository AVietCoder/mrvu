// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, ShieldOff, TrendingUp, ShoppingBag, Users, Package, CreditCard, CalendarDays, Filter, BarChart3, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Báo cáo — Mr.Vũ" }] }),
  component: Page,
});

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899"];

const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + " đ";

function ProgressBarLoader() {
  return (
    <div className="w-full space-y-2 py-12 flex flex-col items-center justify-center">
      <div className="w-64 h-2 bg-muted rounded-full overflow-hidden relative border border-border">
        <div className="h-full bg-primary rounded-full absolute top-0 left-0 animate-[loading_1.5s_infinite_ease-in-out]" style={{ width: '40%' }} />
      </div>
      <span className="text-xs text-muted-foreground animate-pulse font-medium">Đang kết xuất biểu đồ và thống kê...</span>
      <style>{`
        @keyframes loading {
          0% { left: -40%; }
          50% { left: 100%; width: 50%; }
          100% { left: 100%; width: 40%; }
        }
      `}</style>
    </div>
  );
}

function todayStr() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-xl text-sm">
      {label && <div className="mb-1 text-xs text-muted-foreground">{label}</div>}
      {payload.map((item: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          <span className="text-muted-foreground">{item.name}</span>
          <span className="font-semibold">{typeof item.value === "number" && item.value > 999 ? moneyFmt(item.value) : item.value}</span>
        </div>
      ))}
    </div>
  );
}

function StatBox({ icon, label, value, sub, color = "text-primary" }: any) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className={`mt-0.5 ${color} bg-muted/60 rounded-lg p-2`}>{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-lg font-bold mt-0.5">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canView = Boolean(user?.is_admin);

  const fn = useServerFn(getReports);
  const { data, isLoading } = useQuery({
    queryKey: ["reports-full"],
    queryFn: () => fn(),
    enabled: !!canView,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const [fromDate, setFromDate] = useState(daysAgoStr(29));
  const [toDate, setToDate] = useState(todayStr());
  const [mode, setMode] = useState<"day" | "month">("day");
  const [activePreset, setActivePreset] = useState<string>("30d");

  const presets = [
    { label: "7 ngày", days: 6, key: "7d" },
    { label: "30 ngày", days: 29, key: "30d" },
    { label: "90 ngày", days: 89, key: "90d" },
    { label: "Năm nay", days: -1, key: "ytd" },
  ];

  function applyPreset(p: typeof presets[0]) {
    setActivePreset(p.key);
    if (p.key === "ytd") {
      const y = new Date().getFullYear();
      setFromDate(`${y}-01-01`);
      setToDate(todayStr());
    } else {
      setFromDate(daysAgoStr(p.days));
      setToDate(todayStr());
    }
  }

  const {
    filteredOrders,
    filteredItems,
    dailySeries,
    monthlySeries,
    byBranchFiltered,
    byEmployeeFiltered,
    topProductsFiltered,
    ordersByStatus,
    avgOrderValue,
    newCustomers,
    totalRevenue,
    totalCompletedOrders
  } = useMemo(() => {
    if (!data) return {
      filteredOrders: [], filteredItems: [], dailySeries: [], monthlySeries: [],
      byBranchFiltered: [], byEmployeeFiltered: [], topProductsFiltered: [],
      ordersByStatus: {}, avgOrderValue: 0, newCustomers: 0, totalRevenue: 0, totalCompletedOrders: 0
    };

    const TZ = "Asia/Ho_Chi_Minh";
    const dtf = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ });
    const fmtDate = (v: any) => dtf.format(new Date(v));
    const from = fromDate;
    const to = toDate;

    const allOrders: any[] = (data as any)._rawOrders ?? [];
    const allItems: any[] = (data as any)._rawItems ?? [];

    const custOrders = new Map<string, string>();
    allOrders.forEach((o: any) => {
      if (!o.customer_id) return;
      const d = fmtDate(o.created_at);
      const cur = custOrders.get(o.customer_id);
      if (!cur || d < cur) custOrders.set(o.customer_id, d);
    });

    const filteredOrders: any[] = [];
    const completedFiltered: any[] = [];
    const ordersByStatus: any = {};
    
    const dailyMap = new Map<string, { revenue: number; orders: number }>();
    const monthlyMap = new Map<string, { revenue: number; orders: number }>();
    const branchMap = new Map<string, { revenue: number; orders: number }>();
    const employeeMap = new Map<string, { revenue: number; orders: number }>();

    let totalRevenue = 0;

    allOrders.forEach((o: any) => {
      // Ngày tính báo cáo: đơn hoàn tất theo NGÀY HOÀN TẤT (completed_at),
      // các đơn khác theo ngày tạo. Khớp với bộ lọc đơn hàng.
      const d = (o.status === "completed" && o.completed_at)
        ? fmtDate(o.completed_at)
        : fmtDate(o.created_at);
      if (d >= from && d <= to) {
        filteredOrders.push(o);
        ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;

        if (o.status === "completed") {
          completedFiltered.push(o);
          const amt = Number(o.total || 0);
          totalRevenue += amt;

          const curDay = dailyMap.get(d) || { revenue: 0, orders: 0 };
          dailyMap.set(d, { revenue: curDay.revenue + amt, orders: curDay.orders + 1 });

          const m = d.slice(0, 7);
          const curMonth = monthlyMap.get(m) || { revenue: 0, orders: 0 };
          monthlyMap.set(m, { revenue: curMonth.revenue + amt, orders: curMonth.orders + 1 });

          if (o.branch_id) {
            const curB = branchMap.get(o.branch_id) || { revenue: 0, orders: 0 };
            branchMap.set(o.branch_id, { revenue: curB.revenue + amt, orders: curB.orders + 1 });
          }

          if (o.employee_id) {
            const curE = employeeMap.get(o.employee_id) || { revenue: 0, orders: 0 };
            employeeMap.set(o.employee_id, { revenue: curE.revenue + amt, orders: curE.orders + 1 });
          }
        }
      }
    });

    const completedIds = new Set(completedFiltered.map((o: any) => o.id));
    const filteredItems = allItems.filter((i: any) => completedIds.has(i.order_id));

    const daily: { date: string; revenue: number; orders: number }[] = [];
    // Tạo series ngày hiệu quả hơn bằng cách đếm milliseconds thay vì tạo Date mới mỗi vòng
    const msPerDay = 86_400_000;
    const startMs = new Date(from + "T00:00:00+07:00").getTime();
    const endMs = new Date(to + "T23:59:59+07:00").getTime();
    for (let ms = startMs; ms <= endMs; ms += msPerDay) {
      const key = dtf.format(new Date(ms));
      const dayStats = dailyMap.get(key) || { revenue: 0, orders: 0 };
      daily.push({
        date: key.slice(5),
        revenue: dayStats.revenue,
        orders: dayStats.orders,
      });
    }

    const monthly = [...monthlyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ date: k, ...v }));

    const branches: any[] = (data as any)._rawBranches ?? [];
    const byBranch = branches.map((b: any) => {
      const stats = branchMap.get(b.id) || { revenue: 0, orders: 0 };
      return { name: b.name, revenue: stats.revenue, orders: stats.orders };
    }).filter((b: any) => b.orders > 0).sort((a: any, b: any) => b.revenue - a.revenue);

    const users: any[] = (data as any)._rawUsers ?? [];
    const byEmployee = users.map((u: any) => {
      const stats = employeeMap.get(u.id) || { revenue: 0, orders: 0 };
      return { name: u.full_name ?? u.name ?? "?", revenue: stats.revenue, orders: stats.orders };
    }).filter((e: any) => e.orders > 0).sort((a: any, b: any) => b.revenue - a.revenue);

    const products: any[] = (data as any)._rawProducts ?? [];
    const productMap = new Map<string, any>(products.map((p: any) => [String(p.id), p]));
    const qtyMap = new Map<string, { qty: number; revenue: number }>();
    filteredItems.forEach((i: any) => {
      const cur = qtyMap.get(String(i.product_id)) ?? { qty: 0, revenue: 0 };
      qtyMap.set(String(i.product_id), { qty: cur.qty + Number(i.qty || 0), revenue: cur.revenue + Number(i.qty || 0) * Number(i.unit_price || 0) });
    });
    const topProducts = [...qtyMap.entries()]
      .map(([pid, v]) => ({ name: (productMap.get(pid) as any)?.name ?? pid, ...v }))
      .sort((a, b) => b.qty - a.qty).slice(0, 8);

    const totalCompletedOrders = completedFiltered.length;
    const avgOrderValue = totalCompletedOrders > 0 ? totalRevenue / totalCompletedOrders : 0;

    const newCust = [...custOrders.values()].filter(d => d >= from && d <= to).length;

    return {
      filteredOrders,
      filteredItems,
      dailySeries: daily,
      monthlySeries: monthly,
      byBranchFiltered: byBranch,
      byEmployeeFiltered: byEmployee,
      topProductsFiltered: topProducts,
      ordersByStatus,
      avgOrderValue,
      newCustomers: newCust,
      totalRevenue,
      totalCompletedOrders
    };
  }, [data, fromDate, toDate]);

  const totalAllOrders = filteredOrders.length;

  if (!canView) {
    return (
      <AppShell title="Báo cáo & Thống kê">
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <ShieldOff className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Không có quyền truy cập</h2>
          <p className="text-muted-foreground text-sm max-w-sm">Bạn không có quyền xem báo cáo doanh thu. Liên hệ admin để được cấp quyền.</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate({ to: "/" })}>Về trang chủ</Button>
        </div>
      </AppShell>
    );
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[] = [];
    rows.push(`Báo cáo doanh thu từ ${fromDate} đến ${toDate}`);
    rows.push("");
    rows.push("Doanh thu theo ngày");
    rows.push("Ngày,Doanh thu,Số đơn");
    dailySeries.forEach((d) => rows.push(`${d.date},${d.revenue},${d.orders}`));
    rows.push("");
    rows.push("Top sản phẩm");
    rows.push("Sản phẩm,Số lượng");
    topProductsFiltered.forEach((p) => rows.push(`${p.name},${p.qty}`));
    rows.push("");
    rows.push("Doanh thu theo chi nhánh");
    rows.push("Chi nhánh,Số đơn,Doanh thu");
    byBranchFiltered.forEach((b) => rows.push(`${b.name},${b.orders},${b.revenue}`));
    rows.push("");
    rows.push("Công nợ");
    rows.push("Khách hàng,Công nợ");
    (data.debtors as any[]).forEach((d) => rows.push(`${d.name},${d.debt}`));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bao-cao-${fromDate}-${toDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const series = mode === "day" ? dailySeries : monthlySeries;
  const totalRevData = byBranchFiltered.map((b: any) => ({ name: b.name, value: b.revenue }));

  return (
    <AppShell title="Báo cáo & Thống kê">
      <div className="mb-5 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Từ ngày</Label>
            <Input type="date" className="mt-1 h-9 w-36" value={fromDate} max={toDate} onChange={(e) => { setFromDate(e.target.value); setActivePreset(""); }} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Đến ngày</Label>
            <Input type="date" className="mt-1 h-9 w-36" value={toDate} min={fromDate} onChange={(e) => { setToDate(e.target.value); setActivePreset(""); }} />
          </div>
          <div className="flex gap-1.5">
            {presets.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={activePreset === p.key ? "default" : "outline"}
                className="text-xs h-9"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-1.5 ml-auto">
            <div className="flex rounded-md border overflow-hidden text-xs">
              <button type="button" className={`px-3 py-1.5 font-medium transition-colors ${mode === "day" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`} onClick={() => setMode("day")}>Ngày</button>
              <button type="button" className={`px-3 py-1.5 font-medium transition-colors ${mode === "month" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`} onClick={() => setMode("month")}>Tháng</button>
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={isLoading || !data} className="h-9">
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <ProgressBarLoader />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox icon={<TrendingUp className="h-5 w-5" />} label="Doanh thu" value={moneyFmt(totalRevenue)} sub={`${totalCompletedOrders} đơn hoàn tất`} color="text-green-600" />
            <StatBox icon={<ShoppingBag className="h-5 w-5" />} label="Đơn hoàn tất" value={totalCompletedOrders} sub={`Tổng đơn trong kỳ: ${totalAllOrders}`} color="text-blue-600" />
            <StatBox icon={<CreditCard className="h-5 w-5" />} label="Giá trị TB/đơn" value={moneyFmt(avgOrderValue)} sub="Đơn hoàn tất" color="text-purple-600" />
            <StatBox icon={<Users className="h-5 w-5" />} label="KH mới" value={newCustomers} sub="Trong kỳ" color="text-orange-600" />
          </div>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-base">Doanh thu theo {mode === "day" ? "ngày" : "tháng"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{fromDate} → {toDate}</div>
              </div>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" name="Doanh thu" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="font-semibold mb-3">Số đơn hàng theo {mode === "day" ? "ngày" : "tháng"}</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} width={32} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="orders" name="Số đơn" stroke="#6366f1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="font-semibold mb-3">Trạng thái đơn hàng</div>
              <div className="space-y-2">
                {[
                  { key: "completed", label: "Hoàn tất", color: "bg-green-500" },
                  { key: "reserved", label: "Đặt hàng", color: "bg-yellow-400" },
                  { key: "draft", label: "Nháp", color: "bg-gray-400" },
                  { key: "cancelled", label: "Đã hủy", color: "bg-red-400" },
                ].map((s) => {
                  const cnt = ordersByStatus[s.key] ?? 0;
                  const pct = totalAllOrders > 0 ? (cnt / totalAllOrders) * 100 : 0;
                  return (
                    <div key={s.key}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="font-semibold">{cnt} <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${s.color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {totalAllOrders === 0 && <div className="text-sm text-muted-foreground text-center py-4">Không có đơn nào trong kỳ này</div>}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="font-semibold mb-3">Doanh thu theo chi nhánh</div>
              {byBranchFiltered.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Không có dữ liệu</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={totalRevData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3}>
                        {totalRevData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => moneyFmt(v)} />
                      <Legend fontSize={12} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {byBranchFiltered.length > 0 && (
                <table className="w-full text-sm mt-2">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr><th className="py-1.5">Chi nhánh</th><th className="text-right">Đơn</th><th className="text-right">Doanh thu</th></tr>
                  </thead>
                  <tbody>
                    {byBranchFiltered.map((b: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          {b.name}
                        </td>
                        <td className="text-right">{b.orders}</td>
                        <td className="text-right font-medium">{moneyFmt(b.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <div className="font-semibold mb-3">Doanh thu theo nhân viên</div>
              {byEmployeeFiltered.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Không có dữ liệu</div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byEmployeeFiltered} layout="vertical" margin={{ left: 8 }}>
                      <XAxis type="number" hide tickFormatter={(v) => `${(v/1000000).toFixed(1)}M`} />
                      <YAxis type="category" dataKey="name" width={110} fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="revenue" name="Doanh thu" fill="#22c55e" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {byEmployeeFiltered.length > 0 && (
                <table className="w-full text-sm mt-2">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr><th className="py-1.5">Nhân viên</th><th className="text-right">Đơn</th><th className="text-right">Doanh thu</th></tr>
                  </thead>
                  <tbody>
                    {byEmployeeFiltered.slice(0, 6).map((e: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5">{e.name}</td>
                        <td className="text-right">{e.orders}</td>
                        <td className="text-right font-medium">{moneyFmt(e.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="font-semibold mb-3">Top sản phẩm bán chạy</div>
              {topProductsFiltered.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Không có dữ liệu</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductsFiltered} layout="vertical" margin={{ left: 8 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={130} fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Bar dataKey="qty" name="Số lượng" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <div className="font-semibold mb-3">Cảnh báo tồn kho thấp</div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Sản phẩm</th><th className="text-right">Tồn</th><th className="text-right">Min</th></tr>
                </thead>
                <tbody>
                  {(data.lowStock as any[]).length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">Không có cảnh báo</td></tr>
                  )}
                  {(data.lowStock as any[]).map((p: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 text-xs">{p.name}</td>
                      <td className="text-right text-destructive font-semibold">{p.qty}</td>
                      <td className="text-right text-muted-foreground">{p.min}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card>
            <div className="font-semibold mb-3">Công nợ phải thu ({data.debtors?.length ?? 0} khách)</div>
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Khách hàng</th><th>SĐT</th><th className="text-right">Công nợ</th></tr>
              </thead>
              <tbody>
                {(data.debtors as any[]).length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-muted-foreground">Không có công nợ</td></tr>
                )}
                {(data.debtors as any[]).map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5">
                      <Link to="/customers/$id" params={{ id: c.id }} className="font-medium hover:text-primary hover:underline">{c.name}</Link>
                    </td>
                    <td className="text-muted-foreground text-xs">{c.phone}</td>
                    <td className="text-right font-medium text-destructive">{moneyFmt(c.debt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </AppShell>
  );
}