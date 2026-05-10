import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listProducts, upsertProduct, deleteProduct } from "@/lib/products.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [{ title: "Hàng hóa — QuatTran POS" }] }),
  component: ProductsPage,
});

type FormState = {
  id?: string; sku: string; name: string; category_id: string;
  brand: string; power: string; color: string; blade_size: string;
  cost_price: string; sale_price: string; min_stock: string;
};
const empty: FormState = {
  sku: "", name: "", category_id: "", brand: "", power: "", color: "",
  blade_size: "", cost_price: "0", sale_price: "0", min_stock: "0",
};

function ProductsPage() {
  const list = useServerFn(listProducts);
  const upsert = useServerFn(upsertProduct);
  const del = useServerFn(deleteProduct);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = (data?.products ?? []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const totalsByProduct = (id: string) =>
    (data?.stock ?? []).filter((s) => s.product_id === id).reduce((a, b) => a + b.qty, 0);

  function startNew() { setForm(empty); setOpen(true); }
  function startEdit(id: string) {
    const p = data!.products.find((x) => x.id === id)!;
    setForm({
      id: p.id, sku: p.sku, name: p.name, category_id: p.category_id ?? "",
      brand: p.brand ?? "", power: p.power ?? "", color: p.color ?? "",
      blade_size: p.blade_size ?? "", cost_price: String(p.cost_price),
      sale_price: String(p.sale_price), min_stock: String(p.min_stock),
    });
    setOpen(true);
  }

  async function save() {
    try {
      await upsert({
        data: {
          id: form.id,
          sku: form.sku.trim(), name: form.name.trim(),
          category_id: form.category_id || undefined,
          brand: form.brand || undefined, power: form.power || undefined,
          color: form.color || undefined, blade_size: form.blade_size || undefined,
          cost_price: Number(form.cost_price) || 0,
          sale_price: Number(form.sale_price) || 0,
          min_stock: Number(form.min_stock) || 0,
        },
      });
      toast.success("Đã lưu sản phẩm");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi lưu"); }
  }

  async function remove(id: string) {
    if (!confirm("Xóa sản phẩm này?")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <AppShell title="Quản lý hàng hóa">
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Tìm theo tên hoặc SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Thêm sản phẩm</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{form.id ? "Sửa sản phẩm" : "Thêm sản phẩm"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mã SKU *"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
                <Field label="Tên hàng *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Thương hiệu"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
                <Field label="Công suất (W)"><Input value={form.power} onChange={(e) => setForm({ ...form, power: e.target.value })} /></Field>
                <Field label="Màu sắc"><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
                <Field label="Size cánh"><Input value={form.blade_size} onChange={(e) => setForm({ ...form, blade_size: e.target.value })} /></Field>
                <Field label="Danh mục">
                  <select className="h-9 rounded-md border bg-background px-3 text-sm w-full" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    <option value="">— Chọn —</option>
                    {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Tồn tối thiểu (cảnh báo)"><Input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /></Field>
                <Field label="Giá nhập"><Input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
                <Field label="Giá bán"><Input type="number" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} /></Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                <Button onClick={save}>Lưu</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Đang tải...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2">SKU</th><th>Tên hàng</th><th>Thương hiệu</th>
                <th>Công suất</th><th>Màu</th><th>Size cánh</th>
                <th className="text-right">Giá bán</th><th className="text-right">Tồn</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const qty = totalsByProduct(p.id);
                const low = qty <= p.min_stock;
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{p.sku}</td>
                    <td className="font-medium">{p.name}</td>
                    <td>{p.brand}</td>
                    <td>{p.power}</td>
                    <td>{p.color}</td>
                    <td>{p.blade_size}</td>
                    <td className="text-right">{fmt(p.sale_price)}</td>
                    <td className={"text-right " + (low ? "text-destructive font-medium" : "")}>{qty}</td>
                    <td className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(p.id)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
