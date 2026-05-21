// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, StatCard, fmt } from "@/components/AppShell";

import {
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Bar,
  BarChart,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Tổng quan — QuatTran POS" }] }),
  component: Dashboard,
});

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 142 76% 36%))",
  "hsl(var(--chart-3, 38 92% 50%))",
  "hsl(var(--chart-4, 262 83% 58%))",
  "hsl(var(--chart-5, 221 83% 53%))",
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-xl">
      {label && (
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      )}

      <div className="space-y-1">
        {payload.map((item: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: item.color }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-semibold">{fmt(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBarLoader() {
  return (
    <div className="w-full space-y-2 py-12 flex flex-col items-center justify-center">
      <div className="w-64 h-2 bg-muted rounded-full overflow-hidden relative border border-border">
        <div className="h-full bg-primary rounded-full absolute top-0 left-0 animate-[loading_1.5s_infinite_ease-in-out]" style={{ width: '40%' }} />
      </div>
      <span className="text-xs text-muted-foreground animate-pulse font-medium">Đang xử lý dữ liệu báo cáo...</span>
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

function Dashboard() {
  const fn = useServerFn(getReports);

  const { data, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: () => fn(),
  });

  return (
    <AppShell title="Tổng quan">
      {isLoading || !data ? (
        <ProgressBarLoader />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Doanh thu"
              value={fmt(data.totalRevenue)}
              sub={`${data.totalOrders} đơn hoàn tất`}
            />

            <StatCard
              label="Công nợ phải thu"
              value={fmt(data.totalDebt)}
              sub={`${data.debtors.length} khách còn nợ`}
            />

            <StatCard
              label="Sản phẩm"
              value={String(data.productCount)}
              sub={`${data.lowStock.length} cảnh báo tồn`}
            />

            <StatCard
              label="Khách hàng"
              value={String(data.customerCount)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2 border-primary/10 overflow-hidden">
              <div className="mb-1 text-lg font-semibold">
                Doanh thu 14 ngày gần nhất
              </div>

              <div className="mb-4 text-sm text-muted-foreground">
                Theo dõi tăng trưởng doanh thu theo ngày
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.days}
                    margin={{
                      top: 10,
                      right: 10,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="revenueGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0.45}
                        />
                        <stop
                          offset="100%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>

                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />

                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      tickMargin={10}
                    />

                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={60}
                      tickFormatter={(v) =>
                        `${(v / 1000000).toFixed(1)}M`
                      }
                    />

                    <Tooltip content={<CustomTooltip />} />

                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Doanh thu"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      fill="url(#revenueGradient)"
                      activeDot={{
                        r: 6,
                        strokeWidth: 0,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="border-primary/10">
              <div className="mb-1 text-lg font-semibold">
                Top sản phẩm
              </div>

              <div className="mb-4 text-sm text-muted-foreground">
                Tỷ trọng bán chạy
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.topProducts}
                      dataKey="qty"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={105}
                      paddingAngle={4}
                      cornerRadius={12}
                    >
                      {data.topProducts.map((_: any, index: number) => (
                        <Cell
                          key={index}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>

                    <Tooltip content={<CustomTooltip />} />

                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-primary/10">
              <div className="mb-1 text-lg font-semibold">
                Sản phẩm bán chạy
              </div>

              <div className="mb-4 text-sm text-muted-foreground">
                Biểu đồ cột bo góc hiện đại
              </div>

              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.topProducts}
                    margin={{
                      top: 10,
                      right: 10,
                      left: 0,
                      bottom: 18,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />

                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      tickMargin={10}
                      interval={0}
                    />

                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={40}
                    />

                    <Tooltip content={<CustomTooltip />} />

                    <Bar
                      dataKey="qty"
                      radius={[14, 14, 0, 0]}
                      maxBarSize={56}
                    >
                      {data.topProducts.map((_: any, index: number) => (
                        <Cell
                          key={index}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="border-primary/10">
              <div className="mb-1 text-lg font-semibold">
                Cảnh báo tồn kho thấp
              </div>

              <div className="mb-4 text-sm text-muted-foreground">
                Các sản phẩm sắp hết hàng
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2">Sản phẩm</th>
                      <th>SKU</th>
                      <th className="text-right">Tồn</th>
                      <th className="text-right">Tối thiểu</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.lowStock.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-6 text-center text-muted-foreground"
                        >
                          Không có cảnh báo.
                        </td>
                      </tr>
                    )}

                    {data.lowStock.map((p: any) => (
                      <tr
                        key={p.sku}
                        className="border-b last:border-0"
                      >
                        <td className="py-2">{p.name}</td>

                        <td className="text-muted-foreground">
                          {p.sku}
                        </td>

                        <td className="text-right font-semibold text-destructive">
                          {p.qty}
                        </td>

                        <td className="text-right">
                          {p.min}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card className="border-primary/10">
            <div className="mb-1 text-lg font-semibold">
              Khách công nợ cao nhất
            </div>

            <div className="mb-4 text-sm text-muted-foreground">
              Danh sách khách hàng còn công nợ
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2">Khách hàng</th>
                    <th>SĐT</th>
                    <th className="text-right">Công nợ</th>
                  </tr>
                </thead>

                <tbody>
                  {data.debtors.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Không có công nợ.
                      </td>
                    </tr>
                  )}

                  {data.debtors.map((c: any) => (
                    <tr
                      key={c.id}
                      className="border-b last:border-0"
                    >
                      <td className="py-2">
                        <Link to="/customers/$id" params={{ id: c.id }} className="font-medium hover:text-primary hover:underline">
                          {c.name}
                        </Link>
                      </td>

                      <td className="text-muted-foreground">
                        {c.phone}
                      </td>

                      <td className="text-right font-semibold text-destructive">
                        {fmt(c.debt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}