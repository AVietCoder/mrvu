import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Báo cáo — QuatTran POS" }] }),
  component: Page,
});

function Page() {
  const fn = useServerFn(getReports);
  const { data } = useQuery({ queryKey: ["reports-full"], queryFn: () => fn() });

  function exportCsv() {
    if (!data) return;
    const rows: string[] = [];
    rows.push("Báo cáo doanh thu theo chi nhánh");
    rows.push("Chi nhánh,Số đơn,Doanh thu");
    data.byBranch.forEach((b) => rows.push(`${b.name},${b.orders},${b.revenue}`));
    rows.push("");
    rows.push("Báo cáo doanh thu theo nhân viên");
    rows.push("Nhân viên,Doanh thu");
    data.byEmployee.forEach((e) => rows.push(`${e.name},${e.revenue}`));
    rows.push("");
    rows.push("Top sản phẩm bán chạy");
    rows.push("Sản phẩm,Số lượng");
    data.topProducts.forEach((p) => rows.push(`${p.name},${p.qty}`));
    rows.push("");
    rows.push("Tồn kho cảnh báo");
    rows.push("SKU,Sản phẩm,Tồn,Tối thiểu");
    data.lowStock.forEach((p) => rows.push(`${p.sku},${p.name},${p.qty},${p.min}`));
    rows.push("");
    rows.push("Công nợ");
    rows.push("Khách hàng,Công nợ");
    data.debtors.forEach((d) => rows.push(`${d.name},${d.debt}`));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "bao-cao.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Báo cáo & Thống kê">
      <div className="flex justify-end mb-4">
        <Button onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Xuất Excel/CSV</Button>
      </div>
      {!data ? <div className="text-muted-foreground">Đang tải...</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="font-medium mb-3">Doanh thu theo chi nhánh</div>
            <table className="w-full text-sm"><thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Chi nhánh</th><th className="text-right">Đơn</th><th className="text-right">Doanh thu</th></tr></thead><tbody>
              {data.byBranch.map((b, i) => <tr key={i} className="border-b last:border-0"><td className="py-2">{b.name}</td><td className="text-right">{b.orders}</td><td className="text-right font-medium">{fmt(b.revenue)}</td></tr>)}
            </tbody></table>
          </Card>
          <Card>
            <div className="font-medium mb-3">Doanh thu theo nhân viên</div>
            <table className="w-full text-sm"><thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Nhân viên</th><th className="text-right">Doanh thu</th></tr></thead><tbody>
              {data.byEmployee.map((e, i) => <tr key={i} className="border-b last:border-0"><td className="py-2">{e.name}</td><td className="text-right font-medium">{fmt(e.revenue)}</td></tr>)}
            </tbody></table>
          </Card>
          <Card>
            <div className="font-medium mb-3">Top sản phẩm bán chạy</div>
            <table className="w-full text-sm"><thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Sản phẩm</th><th className="text-right">Số lượng</th></tr></thead><tbody>
              {data.topProducts.map((p, i) => <tr key={i} className="border-b last:border-0"><td className="py-2">{p.name}</td><td className="text-right">{p.qty}</td></tr>)}
            </tbody></table>
          </Card>
          <Card>
            <div className="font-medium mb-3">Tồn kho cảnh báo</div>
            <table className="w-full text-sm"><thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Sản phẩm</th><th className="text-right">Tồn</th><th className="text-right">Min</th></tr></thead><tbody>
              {data.lowStock.length === 0 && <tr><td colSpan={3} className="py-3 text-muted-foreground">Không có cảnh báo</td></tr>}
              {data.lowStock.map((p, i) => <tr key={i} className="border-b last:border-0"><td className="py-2">{p.name}</td><td className="text-right text-destructive font-medium">{p.qty}</td><td className="text-right">{p.min}</td></tr>)}
            </tbody></table>
          </Card>
          <Card className="lg:col-span-2">
            <div className="font-medium mb-3">Công nợ phải thu</div>
            <table className="w-full text-sm"><thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Khách hàng</th><th className="text-right">Công nợ</th></tr></thead><tbody>
              {data.debtors.length === 0 && <tr><td colSpan={2} className="py-3 text-muted-foreground">Không có công nợ</td></tr>}
              {data.debtors.map((c) => <tr key={c.id} className="border-b last:border-0"><td className="py-2">{c.name}</td><td className="text-right font-medium">{fmt(c.debt)}</td></tr>)}
            </tbody></table>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
