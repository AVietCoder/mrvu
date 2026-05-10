import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCustomers, upsertCustomer, deleteCustomer } from "@/lib/customers.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, TrendingDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Khách hàng — QuatTran POS" }] }),
  component: CustomersPage,
});

const groupLabel: Record<string, string> = {
  le: "Khách lẻ", dai_ly: "Đại lý", vip: "VIP", cong_trinh: "Công trình",
};
const groupColor: Record<string, string> = {
  le: "bg-gray-100 text-gray-700", dai_ly: "bg-blue-100 text-blue-700",
  vip: "bg-yellow-100 text-yellow-700", cong_trinh: "bg-purple-100 text-purple-700",
};

type FormState = { id?: string; name: string; phone: string; address: string; group_name: string; debt: string };
const empty: FormState = { name: "", phone: "", address: "", group_name: "le", debt: "0" };

function CustomersPage() {
  const { user } = useAuth();
  const list = useServerFn(listCustomers);
  const upsert = useServerFn(upsertCustomer);
  const del = useServerFn(deleteCustomer);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["customers"], queryFn: () => list() });
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterDebt, setFilterDebt] = useState("all");

  const customers = data?.customers ?? [];

  const filtered = useMemo(() => {
    return customers
      .filter((c) => {
        const q = search.toLowerCase();
        const matchSearch = c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q);
        const matchGroup = !filterGroup || c.group_name === filterGroup;
        const matchDebt = filterDebt === "all" ? true : filterDebt === "debt" ? c.debt > 0 : c.debt === 0;
        return matchSearch && matchGroup && matchDebt;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "debt_desc") return b.debt - a.debt;
        if (sortBy === "debt_asc") return a.debt - b.debt;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [customers, search, sortBy, filterGroup, filterDebt]);

  const totalDebt = useMemo(() => filtered.reduce((s, c) => s + c.debt, 0), [filtered]);
  const debtorCount = useMemo(() => filtered.filter((c) => c.debt > 0).length, [filtered]);

  function startEdit(id: string) {
    const c = customers.find((x) => x.id === id)!;
    setForm({ id: c.id, name: c.name, phone: c.phone ?? "", address: c.address ?? "", group_name: c.group_name, debt: String(c.debt) });
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsert({ data: { ...form, debt: Number(form.debt) || 0 } });
      toast.success(form.id ? "Đã cập nhật" : "Đã thêm khách hàng");
      setOpen(false); setForm(empty);
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) { toast.error(err?.message ?? "Lỗi"); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa khách hàng "${name}"?`)) return;
    try {
      await del({ data: { id } });
      toast.success("Đã xóa");
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) { toast.error(err?.message ?? "Lỗi"); }
  }

  return (
    <AppShell title="Khách hàng">
      {/* Tổng quan nợ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card><div className="text-xs text-muted-foreground uppercase">Tổng khách hàng</div><div className="text-2xl font-semibold mt-1">{customers.length}</div></Card>
        <Card><div className="text-xs text-muted-foreground uppercase">Còn công nợ</div><div className="text-2xl font-semibold mt-1 text-destructive">{debtorCount}</div></Card>
        <Card className="md:col-span-2">
          <div className="text-xs text-muted-foreground uppercase flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Tổng công nợ phải thu (đang lọc)</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">{fmt(totalDebt)}</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium">Danh sách khách hàng</div>
          <Button size="sm" onClick={() => { setForm(empty); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Thêm khách
          </Button>
        </div>

        <SearchFilter
          search={search} onSearch={setSearch}
          placeholder="Tìm tên, số điện thoại..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "debt_desc", label: "Nợ nhiều nhất" },
            { value: "debt_asc", label: "Nợ ít nhất" },
            { value: "date", label: "Mới nhất" },
          ]}
          sortValue={sortBy} onSort={setSortBy}
          filterSlot={
            <div className="flex gap-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                <option value="">Tất cả nhóm</option>
                {Object.entries(groupLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterDebt} onChange={(e) => setFilterDebt(e.target.value)}>
                <option value="all">Tất cả</option>
                <option value="debt">Có công nợ</option>
                <option value="no_debt">Không nợ</option>
              </select>
            </div>
          }
          total={filtered.length} totalLabel="khách"
        />

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3">Tên khách hàng</th>
                <th className="pr-3">SĐT</th>
                <th className="pr-3">Địa chỉ</th>
                <th className="pr-3">Nhóm</th>
                <th className="text-right pr-3">Công nợ</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  <td className="pr-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="pr-3 text-muted-foreground text-xs max-w-[150px] truncate">{c.address ?? "—"}</td>
                  <td className="pr-3">
                    <span className={`text-xs rounded-full px-2 py-0.5 ${groupColor[c.group_name]}`}>
                      {groupLabel[c.group_name]}
                    </span>
                  </td>
                  <td className={`text-right pr-3 font-medium ${c.debt > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {c.debt > 0 ? fmt(c.debt) : "—"}
                  </td>
                  <td className="text-right">
                    <button className="p-1 hover:text-primary" onClick={() => startEdit(c.id)}><Pencil className="h-4 w-4" /></button>
                    <button className="p-1 hover:text-destructive" onClick={() => handleDelete(c.id, c.name)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Không có kết quả</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Sửa khách hàng" : "Thêm khách hàng"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>Tên *</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Điện thoại</Label><Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Địa chỉ</Label><Input className="mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Nhóm</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })}>
                {Object.entries(groupLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><Label>Công nợ (₫)</Label><Input className="mt-1" type="number" value={form.debt} onChange={(e) => setForm({ ...form, debt: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
              <Button type="submit">Lưu</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}