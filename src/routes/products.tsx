import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listProducts, upsertProduct, deleteProduct,
  upsertCategory, upsertBrand, deleteBrand,
} from "@/lib/products.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Tags, Building } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [{ title: "Hàng hóa — QuatTran POS" }] }),
  component: ProductsPage,
});

type FormState = {
  id?: string; sku: string; name: string;
  category_id: string; brand_id: string;
  power: string; color: string; blade_size: string;
  cost_price: string; sale_price: string; min_stock: string;
  tech_fee: string;
};
const empty: FormState = {
  sku: "", name: "", category_id: "", brand_id: "",
  power: "", color: "", blade_size: "",
  cost_price: "0", sale_price: "0", min_stock: "0", tech_fee: "0",
};

function fmtInput(val: string): string {
  const num = val.replace(/\D/g, "");
  if (!num) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(num));
}
function parseInput(val: string): number {
  return Number(val.replace(/\D/g, "")) || 0;
}

function ProductsPage() {
  const { isAdmin } = useAuth();
  const list = useServerFn(listProducts);
  const upsert = useServerFn(upsertProduct);
  const del = useServerFn(deleteProduct);
  const upsertCat = useServerFn(upsertCategory);
  const upsertBr = useServerFn(upsertBrand);
  const delBr = useServerFn(deleteBrand);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Admin panel: quản lý thương hiệu & danh mục
  const [adminOpen, setAdminOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newCatName, setNewCatName] = useState("");

  const filtered = (data?.products ?? []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const totalsByProduct = (id: string) =>
    (data?.stock ?? []).filter((s) => s.product_id === id).reduce((a, b) => a + b.qty, 0);

  function startNew() { setForm(empty); setOpen(true); }
  function startEdit(id: string) {
    const p = data!.products.find((x) => x.id === id)!;
    setForm({
      id: p.id, sku: p.sku, name: p.name,
      category_id: p.category_id ?? "",
      brand_id: (p as any).brand_id ?? "",
      power: p.power ?? "", color: p.color ?? "",
      blade_size: p.blade_size ?? "",
      cost_price: String(p.cost_price),
      sale_price: String(p.sale_price),
      min_stock: String(p.min_stock),
      tech_fee: String((p as any).tech_fee ?? 0),
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Vui lòng nhập tên hàng");
    try {
      await upsert({
        data: {
          id: form.id,
          // SKU để trống → server tự sinh
          sku: form.sku.trim() || undefined,
          name: form.name.trim(),
          category_id: form.category_id || undefined,
          brand_id: form.brand_id || undefined,
          power: form.power || undefined,
          color: form.color || undefined,
          blade_size: form.blade_size || undefined,
          cost_price: parseInput(form.cost_price),
          sale_price: parseInput(form.sale_price),
          min_stock: Number(form.min_stock) || 0,
          tech_fee: parseInput(form.tech_fee),
        },
      });
      toast.success(form.id ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm thành công!");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi lưu"); }
  }

  async function remove(id: string) {
    if (!confirm("Xóa sản phẩm này?")) return;
    await del({ data: { id } });
    toast.success("Đã xóa sản phẩm");
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function addBrand() {
    if (!newBrandName.trim()) return;
    await upsertBr({ data: { name: newBrandName.trim() } });
    setNewBrandName("");
    qc.invalidateQueries({ queryKey: ["products"] });
    toast.success("Đã thêm thương hiệu");
  }

  async function addCat() {
    if (!newCatName.trim()) return;
    await upsertCat({ data: { name: newCatName.trim() } });
    setNewCatName("");
    qc.invalidateQueries({ queryKey: ["products"] });
    toast.success("Đã thêm danh mục");
  }

  async function removeBrand(id: string) {
    if (!confirm("Xóa thương hiệu này? Sản phẩm liên kết sẽ không bị xóa.")) return;
    await delBr({ data: { id } });
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
              <div
                onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); save(); } }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mã hàng (tự động nếu để trống)">
                    <Input
                      placeholder="Để trống để hệ thống tự sinh"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                  </Field>
                  <Field label="Tên hàng hoá *">
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>

                  {/* Nhóm hàng hoá — chọn từ list */}
                  <Field label="Nhóm hàng hoá">
                    <select
                      className="h-9 rounded-md border bg-background px-3 text-sm w-full"
                      value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    >
                      <option value="">— Chọn nhóm —</option>
                      {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>

                  {/* Thương hiệu — chọn từ list, admin mới thêm được */}
                  <Field label="Thương hiệu">
                    <select
                      className="h-9 rounded-md border bg-background px-3 text-sm w-full"
                      value={form.brand_id}
                      onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    >
                      <option value="">— Chọn thương hiệu —</option>
                      {data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>

                  <Field label="Công suất (W)">
                    <Input value={form.power} onChange={(e) => setForm({ ...form, power: e.target.value })} />
                  </Field>
                  <Field label="Màu sắc">
                    <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
                  </Field>
                  <Field label="Size cánh">
                    <Input value={form.blade_size} onChange={(e) => setForm({ ...form, blade_size: e.target.value })} />
                  </Field>
                  <Field label="Tồn tối thiểu (cảnh báo)">
                    <Input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
                  </Field>

                  {/* Giá — format có dấu chấm */}
                  <Field label="Giá vốn (₫)">
                    <Input
                      value={parseInput(form.cost_price) === 0 ? "" : new Intl.NumberFormat("vi-VN").format(parseInput(form.cost_price))}
                      placeholder="0"
                      onChange={(e) => setForm({ ...form, cost_price: fmtInput(e.target.value) })}
                      onFocus={(e) => e.target.select()}
                    />
                  </Field>
                  <Field label="Giá bán (₫)">
                    <Input
                      value={parseInput(form.sale_price) === 0 ? "" : new Intl.NumberFormat("vi-VN").format(parseInput(form.sale_price))}
                      placeholder="0"
                      onChange={(e) => setForm({ ...form, sale_price: fmtInput(e.target.value) })}
                      onFocus={(e) => e.target.select()}
                    />
                  </Field>
                  <Field label="Tiền công lắp đặt (₫)" >
                    <Input
                      value={parseInput(form.tech_fee) === 0 ? "" : new Intl.NumberFormat("vi-VN").format(parseInput(form.tech_fee))}
                      placeholder="0"
                      onChange={(e) => setForm({ ...form, tech_fee: fmtInput(e.target.value) })}
                      onFocus={(e) => e.target.select()}
                    />
                  </Field>
                </div>
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                  <Button onClick={save}>Lưu</Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>

          {/* Admin: quản lý thương hiệu & danh mục */}
          {isAdmin && (
            <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Tags className="h-4 w-4 mr-1" /> Danh mục & Thương hiệu
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Quản lý danh mục & thương hiệu</DialogTitle></DialogHeader>
                <div className="space-y-5">
                  {/* Thương hiệu */}
                  <div>
                    <div className="font-medium mb-2 flex items-center gap-1"><Building className="h-4 w-4" /> Thương hiệu</div>
                    <div className="flex gap-2 mb-2">
                      <Input placeholder="Tên thương hiệu mới..." value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addBrand(); }} />
                      <Button size="sm" onClick={addBrand}><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {data?.brands.map((b) => (
                        <div key={b.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
                          <span>{b.name}</span>
                          <button className="p-1 hover:text-destructive" onClick={() => removeBrand(b.id)}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Danh mục */}
                  <div>
                    <div className="font-medium mb-2 flex items-center gap-1"><Tags className="h-4 w-4" /> Danh mục (nhóm hàng)</div>
                    <div className="flex gap-2 mb-2">
                      <Input placeholder="Tên danh mục mới..." value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addCat(); }} />
                      <Button size="sm" onClick={addCat}><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {data?.categories.map((c) => (
                        <div key={c.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
                          <span>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setAdminOpen(false)}>Đóng</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Đang tải...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-2">SKU</th>
                <th className="pr-2">Tên hàng</th>
                <th className="pr-2">Thương hiệu</th>
                <th className="pr-2">Công suất</th>
                <th className="pr-2">Màu</th>
                <th className="pr-2">Size cánh</th>
                <th className="text-right pr-2">Giá bán</th>
                <th className="text-right pr-2">Tồn</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const qty = totalsByProduct(p.id);
                const low = qty <= p.min_stock;
                const brand = data?.brands.find((b) => b.id === (p as any).brand_id)?.name ?? (p as any).brand ?? "";
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 font-mono text-xs pr-2">{p.sku}</td>
                    <td className="font-medium pr-2">{p.name}</td>
                    <td className="pr-2">{brand}</td>
                    <td className="pr-2">{p.power}</td>
                    <td className="pr-2">{p.color}</td>
                    <td className="pr-2">{p.blade_size}</td>
                    <td className="text-right pr-2">{fmt(p.sale_price)}</td>
                    <td className={"text-right pr-2 " + (low ? "text-destructive font-medium" : "")}>{qty}</td>
                    <td className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(p.id)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Không có sản phẩm</td></tr>
              )}
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
