// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBranches, upsertBranch, deleteBranch } from "@/lib/staff.functions";
import { getReports } from "@/lib/reports.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/branches")({
  head: () => ({ meta: [{ title: "Chi nhánh — QuatTran POS" }] }),
  component: Page,
});

type Form = { id?: string; name: string; address: string; phone: string };
const empty: Form = { name: "", address: "", phone: "" };

function Page() {
  const list = useServerFn(listBranches);
  const upsert = useServerFn(upsertBranch);
  const del = useServerFn(deleteBranch);
  const reports = useServerFn(getReports);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["branches"], queryFn: () => list() });
  const { data: rep } = useQuery({ queryKey: ["reports-branch"], queryFn: () => reports() });

  const [form, setForm] = useState<Form>(empty);
  const [open, setOpen] = useState(false);

  async function save() {
    try {
      await upsert({ data: { id: form.id, name: form.name.trim(), address: form.address || undefined, phone: form.phone || undefined } });
      toast.success("Đã lưu"); setOpen(false); qc.invalidateQueries({ queryKey: ["branches"] }); qc.invalidateQueries({ queryKey: ["reports-branch"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  return (
    <AppShell title="Quản lý chi nhánh">
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">{data?.branches.length ?? 0} chi nhánh / kho</div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={() => setForm(empty)}><Plus className="h-4 w-4 mr-1" />Thêm chi nhánh</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{form.id ? "Sửa chi nhánh" : "Thêm chi nhánh"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Tên *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Địa chỉ</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div><Label>SĐT</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button onClick={save}>Lưu</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Tên</th><th>Địa chỉ</th><th>SĐT</th><th></th></tr></thead>
          <tbody>
            {data?.branches.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{b.name}</td><td>{b.address}</td><td>{b.phone}</td>
                <td className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: b.id, name: b.name, address: b.address ?? "", phone: b.phone ?? "" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={async () => { if (confirm("Xóa?")) { await del({ data: { id: b.id } }); qc.invalidateQueries({ queryKey: ["branches"] }); } }}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="font-medium mb-3">So sánh hiệu quả kinh doanh</div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b"><tr><th className="py-2">Chi nhánh</th><th className="text-right">Số đơn</th><th className="text-right">Doanh thu</th></tr></thead>
          <tbody>
            {rep?.byBranch.map((b, i) => (
              <tr key={i} className="border-b last:border-0"><td className="py-2 font-medium">{b.name}</td><td className="text-right">{b.orders}</td><td className="text-right">{fmt(b.revenue)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
