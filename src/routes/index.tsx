import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, StatCard, fmt } from "@/components/AppShell";
import {
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  Bar, BarChart,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Tổng quan — QuatTran POS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(getReports);
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => fn() });

  return (
    <AppShell title="Tổng quan">
      {isLoading || !data ? (
        <div className="text-muted-foreground">Đang tải dữ liệu...</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Doanh thu" value={fmt(data.totalRevenue)} sub={`${data.totalOrders} đơn hoàn tất`} />
            <StatCard label="Công nợ phải thu" value={fmt(data.totalDebt)} sub={`${data.debtors.length} khách còn nợ`} />
            <StatCard label="Sản phẩm" value={String(data.productCount)} sub={`${data.lowStock.length} mặt hàng cảnh báo tồn`} />
            <StatCard label="Khách hàng" value={String(data.customerCount)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <div className="font-medium mb-3">Doanh thu 14 ngày gần nhất</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.days}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Line type="monotone" dataKey="revenue" stroke="oklch(0.62 0.18 257)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div className="font-medium mb-3">Top sản phẩm bán chạy</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProducts} layout="vertical" margin={{ left: 30 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={120} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="qty" fill="oklch(0.62 0.18 257)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="font-medium mb-3">Cảnh báo tồn kho thấp</div>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr><th className="py-1.5">Sản phẩm</th><th>SKU</th><th className="text-right">Tồn</th><th className="text-right">Tối thiểu</th></tr>
                </thead>
                <tbody>
                  {data.lowStock.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">Không có cảnh báo.</td></tr>}
                  {data.lowStock.map((p) => (
                    <tr key={p.sku} className="border-t">
                      <td className="py-1.5">{p.name}</td><td>{p.sku}</td>
                      <td className="text-right text-destructive font-medium">{p.qty}</td>
                      <td className="text-right">{p.min}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <div className="font-medium mb-3">Khách công nợ cao nhất</div>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr><th className="py-1.5">Khách hàng</th><th>SĐT</th><th className="text-right">Công nợ</th></tr>
                </thead>
                <tbody>
                  {data.debtors.length === 0 && <tr><td colSpan={3} className="py-4 text-muted-foreground">Không có công nợ.</td></tr>}
                  {data.debtors.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-1.5">{c.name}</td><td>{c.phone}</td>
                      <td className="text-right font-medium">{fmt(c.debt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}
