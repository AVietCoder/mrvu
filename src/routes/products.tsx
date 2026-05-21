// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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
import { Plus, Pencil, Trash2, Search, Tags, ChevronLeft, ChevronRight, Eye, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [{ title: "Hàng hóa — QuatTran POS" }] }),
  component: ProductsPage,
});

type FormState = {
  id?: string;
  name: string;
  category_id: string;
  brand_id: string;
  cost_price: string;
  sale_price: string;
  min_stock: string;
};

const empty: FormState = {
  name: "", category_id: "", brand_id: "",
  cost_price: "0", sale_price: "0", min_stock: "0",
};

const PAGE_SIZE = 20;

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
  const list      = useServerFn(listProducts);
  const upsert    = useServerFn(upsertProduct);
  const del       = useServerFn(deleteProduct);
  const upsertCat = useServerFn(upsertCategory);
  const upsertBr  = useServerFn(upsertBrand);
  const delBr     = useServerFn(deleteBrand);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");

  const [adminOpen, setAdminOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newCatName, setNewCatName] = useState("");

  const filtered = useMemo(
    () => (data?.products ?? []).filter((p) => {
      const q = search.toLowerCase();
      const matchSearch = p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
      const matchCat = !filterCategory || p.category_id === filterCategory;
      const matchBrand = !filterBrand || (p as any).brand_id === filterBrand;
      return matchSearch && matchCat && matchBrand;
    }),
    [data, search, filterCategory, filterBrand],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSearch(val: string) { setSearch(val); setPage(1); }

  const totalsByProduct = (id: string) =>
    (data?.stock ?? []).filter((s) => s.product_id === id).reduce((a, b) => a + b.qty, 0);

  function startNew() { setForm(empty); setOpen(true); }
  function startEdit(id: string) {
    const p = data!.products.find((x) => x.id === id)!;
    setForm({
      id: p.id, name: p.name,
      category_id: p.category_id ?? "",
      brand_id: (p as any).brand_id ?? "",
      cost_price: String(p.cost_price),
      sale_price: String(p.sale_price),
      min_stock: String(p.min_stock),
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Vui lòng nhập tên hàng");
    if (!form.category_id) return toast.error("Vui lòng chọn nhóm hàng hoá");
    if (!form.brand_id) return toast.error("Vui lòng chọn thương hiệu");
    try {
      await upsert({
        data: {
          id: form.id,
          name: form.name.trim(),
          category_id: form.category_id,
          brand_id: form.brand_id,
          cost_price: parseInput(form.cost_price),
          sale_price: parseInput(form.sale_price),
          min_stock: Number(form.min_stock) || 0,
        },
      });
      toast.success(form.id ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm thành công!");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi lưu"); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Xóa sản phẩm "${name}"?`)) return;
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
    if (!confirm("Xóa thương hiệu này?")) return;
    await delBr({ data: { id } });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  // View product detail
  const viewProduct = viewId ? data?.products.find((p) => p.id === viewId) : null;
  const viewStock = viewId ? (data?.stock ?? []).filter((s) => s.product_id === viewId) : [];
  const viewTotalStock = viewStock.reduce((a, b) => a + b.qty, 0);

  // Low stock count
  const lowStockCount = (data?.products ?? []).filter((p) => totalsByProduct(p.id) <= p.min_stock).length;

  return (
    <AppShell title="Quản lý hàng hóa" loading={isLoading && !data}>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card>
          <div className="flex items-center gap-2 mb-1"><Package className="h-4 w-4 text-muted-foreground" /><div className="text-xs text-muted-foreground uppercase">Tổng sản phẩm</div></div>
          <div className="text-2xl font-semibold">{(data?.products ?? []).length}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="h-4 w-4 text-destructive" /><div className="text-xs text-muted-foreground uppercase">Tồn kho thấp</div></div>
          <div className="text-2xl font-semibold text-destructive">{lowStockCount}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase mb-1">Danh mục</div>
          <div className="text-2xl font-semibold">{(data?.categories ?? []).length}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase mb-1">Thương hiệu</div>
          <div className="text-2xl font-semibold">{(data?.brands ?? []).length}</div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm theo tên, SKU..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}>
            <option value="">Tất cả danh mục</option>
            {(data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filterBrand} onChange={(e) => { setFilterBrand(e.target.value); setPage(1); }}>
            <option value="">Tất cả thương hiệu</option>
            {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {isAdmin && (
            <>
              <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Thêm sản phẩm</Button>
              <Button variant="outline" size="sm" onClick={() => setAdminOpen(true)}>
                <Tags className="h-4 w-4 mr-1" /> Danh mục & TH
              </Button>
            </>
          )}
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Đang tải...</div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3 w-10 text-center">STT</th>
                    <th className="pr-2">Tên hàng</th>
                    <th className="pr-2">Danh mục</th>
                    <th className="pr-2">Thương hiệu</th>
                    <th className="text-right pr-2">Giá vốn</th>
                    <th className="text-right pr-2">Giá bán</th>
                    <th className="text-right pr-2">Tồn kho</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((p, idx) => {
                    const qty = totalsByProduct(p.id);
                    const low = qty <= p.min_stock;
                    const cat = data?.categories.find((c) => c.id === p.category_id)?.name ?? "—";
                    const brand = data?.brands.find((b) => b.id === (p as any).brand_id)?.name ?? "—";
                    const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <tr
                        key={p.id}
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                        onClick={() => setViewId(p.id)}
                      >
                        <td className="py-2 text-muted-foreground pr-3 text-center text-xs">{globalIdx}</td>
                        <td className="font-medium pr-2">{p.name}</td>
                        <td className="pr-2 text-muted-foreground text-xs">{cat}</td>
                        <td className="pr-2 text-muted-foreground text-xs">{brand}</td>
                        <td className="text-right pr-2 text-xs text-muted-foreground">{fmt(p.cost_price)}</td>
                        <td className="text-right pr-2 font-medium">{fmt(p.sale_price)}</td>
                        <td className={"text-right pr-2 " + (low ? "text-destructive font-medium" : "")}>{qty}{low && <AlertTriangle className="h-3 w-3 inline ml-1" />}</td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button className="p-1 hover:text-blue-600" onClick={() => setViewId(p.id)}><Eye className="h-4 w-4" /></button>
                          {isAdmin && (
                            <>
                              <button className="p-1 hover:text-primary" onClick={() => startEdit(p.id)}><Pencil className="h-4 w-4" /></button>
                              <button className="p-1 hover:text-destructive" onClick={() => remove(p.id, p.name)}><Trash2 className="h-4 w-4" /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">Không có sản phẩm</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm border-t pt-3">
                <span className="text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length} sản phẩm
                </span>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((n) => (
                    <Button key={n} size="sm" variant={n === page ? "default" : "outline"} className="w-8 h-8 p-0" onClick={() => setPage(n)}>{n}</Button>
                  ))}
                  <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Dialog Thêm/Sửa sản phẩm */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Sửa sản phẩm" : "Thêm sản phẩm"}</DialogTitle>
          </DialogHeader>
          <div
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA" && (e.target as HTMLElement).tagName !== "SELECT") {
                e.preventDefault();
                save();
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tên hàng hoá *" className="col-span-2">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </Field>
              <Field label="Nhóm hàng hoá *">
                <select className="h-9 rounded-md border bg-background px-3 text-sm w-full"
                  value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">— Chọn nhóm —</option>
                  {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Thương hiệu *">
                <select className="h-9 rounded-md border bg-background px-3 text-sm w-full"
                  value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">— Chọn thương hiệu —</option>
                  {data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
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
              <Field label="Tồn tối thiểu (cảnh báo)">
                <Input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
              </Field>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
              <Button onClick={save}>Lưu</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Xem chi tiết sản phẩm */}
      <Dialog open={!!viewId} onOpenChange={(o) => { if (!o) setViewId(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {viewProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{viewProduct.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Thông tin chung */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Danh mục</div>
                    <div className="font-medium">{data?.categories.find((c) => c.id === viewProduct.category_id)?.name ?? "—"}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Thương hiệu</div>
                    <div className="font-medium">{data?.brands.find((b) => b.id === (viewProduct as any).brand_id)?.name ?? "—"}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Giá vốn</div>
                    <div className="font-medium">{fmt(viewProduct.cost_price)}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Giá bán</div>
                    <div className="font-semibold text-primary">{fmt(viewProduct.sale_price)}</div>
                  </div>
                </div>

                {/* Tồn kho theo chi nhánh */}
                <div>
                  <div className="font-medium text-sm mb-2">Tồn kho theo chi nhánh</div>
                  <div className="space-y-1.5">
                    {(data?.branches ?? []).map((b) => {
                      const qty = viewStock.find((s) => s.branch_id === b.id)?.qty ?? 0;
                      const low = qty <= viewProduct.min_stock;
                      return (
                        <div key={b.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                          <span>{b.name}</span>
                          <span className={`font-semibold ${low ? "text-destructive" : "text-foreground"}`}>
                            {qty} {low && <AlertTriangle className="h-3 w-3 inline ml-1" />}
                          </span>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between rounded border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold">
                      <span>Tổng tồn kho</span>
                      <span className="text-primary">{viewTotalStock}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Tồn tối thiểu cảnh báo: <span className="font-medium">{viewProduct.min_stock}</span>
                </div>
              </div>

              <DialogFooter>
                {isAdmin && (
                  <Button variant="outline" onClick={() => { setViewId(null); startEdit(viewProduct.id); }}>
                    <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa
                  </Button>
                )}
                <Button onClick={() => setViewId(null)}>Đóng</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Danh mục & Thương hiệu */}
      <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Quản lý danh mục & thương hiệu</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div>
              <div className="font-medium mb-2">Thương hiệu</div>
              <div className="flex gap-2 mb-2">
                <Input placeholder="Tên thương hiệu mới..."
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addBrand(); }} />
                <Button size="sm" onClick={addBrand}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {data?.brands.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
                    <span>{b.name}</span>
                    <button className="p-1 hover:text-destructive" onClick={() => removeBrand(b.id)}><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-medium mb-2">Danh mục (nhóm hàng)</div>
              <div className="flex gap-2 mb-2">
                <Input placeholder="Tên danh mục mới..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
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
          <DialogFooter><Button onClick={() => setAdminOpen(false)}>Đóng</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"space-y-1.5 " + className}>
      <Label>{label}</Label>{children}
    </div>
  );
}
