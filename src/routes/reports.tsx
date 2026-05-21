// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Download, ShieldOff } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Báo cáo — Mr.Vũ" }] }),
  component: Page,
});

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#8b5cf6"];

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

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const canView = user?.is_admin || user?.permissions.includes("view_reports");

  const fn = useServerFn(getReports);
  const { data, isLoading } = useQuery({
    queryKey: ["reports-full"],
    queryFn: () => fn(),
    enabled: !!canView,
  });

  if (!canView) {
    return (
      <AppShell title="Báo cáo & Thống kê">
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <ShieldOff className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Không có quyền truy cập</h2>
          <p className="text-muted-foreground text-sm max-w-sm">
            Bạn không có quyền xem báo cáo doanh thu. Liên hệ admin để được cấp quyền.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => navigate({ to: "/" })}>
            Về trang chủ
          </Button>
        </div>
      </AppShell>
    );
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[] = [];
    rows.push("Báo cáo doanh thu theo chi nhánh");
    rows.push("Chi nhánh,Số đơn,Doanh thu");
    (data.byBranch as any[]).forEach((b) => rows.push(`${b.name},${b.orders},${b.revenue}`));
    rows.push("");
    rows.push("Top sản phẩm");
    rows.push("Sản phẩm,Số lượng");
    (data.topProducts as any[]).forEach((p) => rows.push(`${p.name},${p.qty}`));
    rows.push("");
    rows.push("Công nợ");
    rows.push("Khách hàng,Công nợ");
    (data.debtors as any[]).forEach((d) => rows.push(`${d.name},${d.debt}`));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bao-cao.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Báo cáo & Thống kê">
      <div className="flex justify-end mb-4">
        <Button onClick={exportCsv} disabled={isLoading || !data}>
          <Download className="h-4 w-4 mr-1" /> Xuất CSV
        </Button>
      </div>

      {isLoading || !data ? (
        <ProgressBarLoader />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><div className="text-xs text-muted-foreground uppercase">Doanh thu</div><div className="text-xl font-bold mt-1">{fmt(data.totalRevenue as number)}</div></Card>
            <Card><div className="text-xs text-muted-foreground uppercase">Tổng đơn</div><div className="text-xl font-bold mt-1">{data.totalOrders as number}</div></Card>
            <Card><div className="text-xs text-muted-foreground uppercase">Công nợ</div><div className="text-xl font-bold mt-1 text-destructive">{fmt(data.totalDebt as number)}</div></Card>
            <Card><div className="text-xs text-muted-foreground uppercase">Khách hàng</div><div className="text-xl font-bold mt-1">{data.customerCount as number}</div></Card>
          </div>

          <Card>
            <div className="font-medium mb-3">Doanh thu 14 ngày gần nhất</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.days as any[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={11} tickFormatter={(v) => (v / 1000000).toFixed(1) + "M"} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="font-medium mb-3">Doanh thu theo chi nhánh</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.byBranch as any[]}
                      dataKey="revenue" nameKey="name"
                      cx="50%" cy="50%" outerRadius={80}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {(data.byBranch as any[]).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="font-medium mb-3">Top sản phẩm bán chạy</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProducts as any[]} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="qty" fill="#6366f1" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="font-medium mb-3">Doanh thu theo nhân viên</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byEmployee as any[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => (v / 1000000).toFixed(1) + "M"} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="revenue" fill="#22c55e" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="font-medium mb-3">Cảnh báo tồn kho thấp</div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Sản phẩm</th><th className="text-right">Tồn</th><th className="text-right">Min</th></tr>
                </thead>
                <tbody>
                  {(data.lowStock as any[]).length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-muted-foreground">Không có cảnh báo</td></tr>
                  )}
                  {(data.lowStock as any[]).map((p: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 text-xs">{p.name}</td>
                      <td className="text-right text-destructive font-medium">{p.qty}</td>
                      <td className="text-right text-muted-foreground">{p.min}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card>
            <div className="font-medium mb-3">Công nợ phải thu</div>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Khách hàng</th><th className="text-right">Công nợ</th></tr>
              </thead>
              <tbody>
                {(data.debtors as any[]).length === 0 && (
                  <tr><td colSpan={2} className="py-4 text-muted-foreground">Không có công nợ</td></tr>
                )}
                {(data.debtors as any[]).map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5">
                      <Link to="/customers/$id" params={{ id: c.id }} className="font-medium hover:text-primary hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="text-right font-medium text-destructive">{fmt(c.debt)}</td>
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