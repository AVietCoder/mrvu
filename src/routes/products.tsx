// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  listProducts, upsertProduct, deleteProduct, getProductStock,
  upsertCategory, upsertBrand, deleteBrand, deleteCategory,
} from "@/lib/products.functions";
import { uploadImageToCloudinary } from "@/lib/cloudinary";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Tags, ChevronLeft, ChevronRight, Eye, Package, AlertTriangle, ImagePlus, X, Upload, Loader2, Boxes, EyeOff, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [{ title: "Hàng hóa — Mr.Vũ" }] }),
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
  image_url: string;
  /** false = phụ kiện đi kèm, không đếm vào thống kê số hàng hóa. */
  count_in_total: boolean;
  /** true = ngừng kinh doanh: ẩn khỏi danh sách (trừ khi lọc "Cả hàng ẩn"). */
  is_hidden: boolean;
};

const empty: FormState = {
  name: "", category_id: "", brand_id: "",
  cost_price: "0", sale_price: "0", min_stock: "0", image_url: "",
  count_in_total: true,
  is_hidden: false,
};

/** Chưa chạy migration v15 thì cột không có (undefined) → coi là hàng chính. */
const isAccessory = (p: any) => p?.count_in_total === false;
/** Chưa chạy migration v17 thì cột không có → coi là đang kinh doanh. */
const isHidden = (p: any) => p?.is_hidden === true;

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
  const { user, isAdmin } = useAuth();
  const list      = useServerFn(listProducts);
  const upsert    = useServerFn(upsertProduct);
  const del       = useServerFn(deleteProduct);
  const upsertCat = useServerFn(upsertCategory);
  const upsertBr  = useServerFn(upsertBrand);
  const delBr     = useServerFn(deleteBrand);
  const delCat    = useServerFn(deleteCategory);
  const qc = useQueryClient();

  // Rỗng = tổng TOÀN HỆ THỐNG. Chọn chi nhánh = tổng theo chi nhánh đó.
  const [filterBranch, setFilterBranch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["products", filterBranch],
    queryFn: () => list({ data: { branch_id: filterBranch || undefined } }),
  });

  // Tồn kho chi tiết của 1 sản phẩm — nạp lười khi mở dialog, không kéo cả
  // bảng stock cho mọi sản phẩm như trước.
  const stockFn = useServerFn(getProductStock);
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // ⚡ Debounce ô tìm kiếm: chỉ lọc lại danh sách sản phẩm sau khi ngừng gõ.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterKind, setFilterKind] = useState<"" | "goods" | "accessory">("");
  // Mặc định chỉ hàng đang kinh doanh; hàng ẩn phải chọn bộ lọc mới hiện.
  const [filterHidden, setFilterHidden] = useState<"active" | "all" | "hidden">("active");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ⛔ Chống tạo trùng sản phẩm (double-submit). `saving` chỉ để hiển thị UI;
  // `savingRef` là khoá ĐỒNG BỘ — vì setState bất đồng bộ nên 2 lần gọi save()
  // trong cùng một nhịp (tap 2 lần, hoặc Enter + click) sẽ cùng đọc state cũ và
  // lọt qua. Ref khoá ngay lập tức nên chặn triệt để.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [adminOpen, setAdminOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editingBrandName, setEditingBrandName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [savingBrand, setSavingBrand] = useState<string | null>(null); // id đang lưu, "new" khi thêm mới
  const [savingCat, setSavingCat] = useState<string | null>(null);
  const [deletingBrand, setDeletingBrand] = useState<string | null>(null);
  const [deletingCat, setDeletingCat] = useState<string | null>(null);

  const filtered = useMemo(
    () => (data?.products ?? []).filter((p) => {
      const q = debouncedSearch.toLowerCase();
      const matchSearch = p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
      const matchCat = !filterCategory || p.category_id === filterCategory;
      const matchBrand = !filterBrand || (p as any).brand_id === filterBrand;
      const matchKind = !filterKind || (filterKind === "accessory") === isAccessory(p);
      const matchHidden = filterHidden === "all" || (filterHidden === "hidden") === isHidden(p);
      return matchSearch && matchCat && matchBrand && matchKind && matchHidden;
    }),
    [data, debouncedSearch, filterCategory, filterBrand, filterKind, filterHidden],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSearch(val: string) { setSearch(val); setPage(1); }

  // Tổng tồn giờ do Postgres trả sẵn trên từng dòng sản phẩm (RPC
  // products_with_stock), không còn cộng ở trình duyệt.
  const totalsByProduct = (id: string) =>
    Number((data?.products ?? []).find((p: any) => p.id === id)?.total_stock ?? 0);

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
      image_url: (p as any).image_url ?? "",
      count_in_total: !isAccessory(p),
      is_hidden: isHidden(p),
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Vui lòng nhập tên hàng");
    if (!form.category_id) return toast.error("Vui lòng chọn nhóm hàng hoá");
    if (!form.brand_id) return toast.error("Vui lòng chọn thương hiệu");
    // ⛔ Nếu đang lưu thì bỏ qua — chặn cú submit thứ 2 gây tạo trùng.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
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
          image_url: form.image_url.trim() || null,
          count_in_total: form.count_in_total,
          is_hidden: form.is_hidden,
          actor_id: user?.id,
        },
      });
      toast.success(form.id ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm thành công!");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Xóa sản phẩm "${name}"?`)) return;
    try {
      await del({ data: { id, actor_id: user?.id } });
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã xóa sản phẩm");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xóa sản phẩm");
    }
  }

  async function addBrand() {
    if (!newBrandName.trim()) return;
    setSavingBrand("new");
    try {
      await upsertBr({ data: { name: newBrandName.trim() } });
      setNewBrandName("");
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã thêm thương hiệu");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi thêm thương hiệu"); }
    finally { setSavingBrand(null); }
  }

  async function addCat() {
    if (!newCatName.trim()) return;
    setSavingCat("new");
    try {
      await upsertCat({ data: { name: newCatName.trim() } });
      setNewCatName("");
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã thêm danh mục");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi thêm danh mục"); }
    finally { setSavingCat(null); }
  }

  async function removeBrand(id: string) {
    if (!confirm("Xóa thương hiệu này?")) return;
    setDeletingBrand(id);
    try {
      await delBr({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã xóa thương hiệu");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi xóa"); }
    finally { setDeletingBrand(null); }
  }

  async function saveBrand(id: string) {
    if (!editingBrandName.trim()) return;
    setSavingBrand(id);
    try {
      await upsertBr({ data: { id, name: editingBrandName.trim() } });
      setEditingBrandId(null);
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã cập nhật thương hiệu");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi lưu"); }
    finally { setSavingBrand(null); }
  }

  async function removeCategory(id: string) {
    if (!confirm("Xóa danh mục này?")) return;
    setDeletingCat(id);
    try {
      await delCat({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã xóa danh mục");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi xóa"); }
    finally { setDeletingCat(null); }
  }

  async function saveCategory(id: string) {
    if (!editingCatName.trim()) return;
    setSavingCat(id);
    try {
      await upsertCat({ data: { id, name: editingCatName.trim() } });
      setEditingCatId(null);
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Đã cập nhật danh mục");
    } catch (e: any) { toast.error(e?.message ?? "Lỗi lưu"); }
    finally { setSavingCat(null); }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ảnh quá lớn, vui lòng chọn ảnh dưới 5MB");
      return;
    }
    setUploadingImage(true);
    try {
      const url = await uploadImageToCloudinary(file);
      setForm(f => ({ ...f, image_url: url }));
      toast.success("Tải ảnh lên thành công!");
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi tải ảnh lên Cloudinary");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // View product detail
  const viewProduct = viewId ? data?.products.find((p) => p.id === viewId) : null;
  const { data: viewStock = [] } = useQuery({
    queryKey: ["productStock", viewId],
    queryFn: () => stockFn({ data: { product_id: viewId! } }),
    enabled: Boolean(viewId),
  });
  const viewTotalStock = (viewStock as any[]).reduce((a: number, b: any) => a + Number(b.qty || 0), 0);

  // Low stock count — đọc thẳng total_stock, không lặp qua bảng stock nữa.
  const lowStockCount = (data?.products ?? []).filter(
    (p: any) => Number(p.total_stock ?? 0) <= p.min_stock,
  ).length;

  // TỔNG HÀNG TỒN: server đã cộng sẵn, CHỈ hàng hóa chính — phụ kiện đi kèm
  // (bỏ tick "Tính vào tổng số hàng hóa") được đếm riêng.
  const totalStock = Number(data?.totalStock ?? 0);
  const accessoryStock = Number(data?.accessoryStock ?? 0);
  const accessoryCount = Number(data?.accessoryCount ?? 0);
  const goodsCount = Number(data?.goodsCount ?? (data?.products ?? []).length);

  return (
    <AppShell title="Quản lý hàng hóa" loading={isLoading && !data}>
      {/* Stats */}
      <div className="hidden md:grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {/* TỔNG HÀNG TỒN — tổng số lượng đang tồn trong TẤT CẢ kho/chi nhánh,
            gộp ở Postgres. Chọn chi nhánh thì thành tổng của riêng nơi đó. */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Boxes className="h-4 w-4 text-primary" />
            <div className="text-xs text-muted-foreground uppercase">Tổng hàng tồn</div>
          </div>
          <div className="text-2xl font-semibold">
            {totalStock.toLocaleString("vi-VN")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {filterBranch
              ? (data?.branches ?? []).find((b: any) => b.id === filterBranch)?.name ?? "chi nhánh đã chọn"
              : "toàn bộ kho / chi nhánh"}
            {accessoryStock > 0 && <> · không gồm {accessoryStock.toLocaleString("vi-VN")} phụ kiện</>}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1"><Package className="h-4 w-4 text-muted-foreground" /><div className="text-xs text-muted-foreground uppercase">Tổng sản phẩm</div></div>
          <div className="text-2xl font-semibold">{goodsCount.toLocaleString("vi-VN")}</div>
          {accessoryCount > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5">+ {accessoryCount} mã phụ kiện đi kèm</div>
          )}
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

      {/* TOP 10 TỒN KHO NHIỀU NHẤT — chỉ hàng đang kinh doanh (không ẩn), là hàng
          hóa chính (không phải phụ kiện) và còn tồn. Theo chi nhánh đang lọc. */}
      {(data?.topStock ?? []).length > 0 && (
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
            <div className="flex items-center gap-2 font-semibold">
              <TrendingUp className="h-4 w-4 text-primary" />
              Top 10 tồn kho nhiều nhất
            </div>
            <div className="text-xs text-muted-foreground">
              {filterBranch
                ? (data?.branches ?? []).find((b: any) => b.id === filterBranch)?.name ?? "chi nhánh đã chọn"
                : "toàn bộ kho / chi nhánh"}{" "}
              · hàng đang kinh doanh, không gồm phụ kiện
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
            {(data?.topStock ?? []).map((p: any, i: number) => {
              const max = Number(data?.topStock?.[0]?.total_stock) || 1;
              return (
                <button
                  key={p.id}
                  onClick={() => setViewId(p.id)}
                  className="group flex items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/50"
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-primary">{p.name}</span>
                      <span className="shrink-0 text-sm font-bold tabular-nums">{p.total_stock.toLocaleString("vi-VN")}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (p.total_stock / max) * 100)}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

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
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filterKind} onChange={(e) => { setFilterKind(e.target.value as any); setPage(1); }}>
            <option value="">Hàng hóa + phụ kiện</option>
            <option value="goods">Chỉ hàng hóa</option>
            <option value="accessory">Chỉ phụ kiện đi kèm</option>
          </select>
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filterHidden} onChange={(e) => { setFilterHidden(e.target.value as any); setPage(1); }}>
            <option value="active">Đang kinh doanh</option>
            <option value="all">Cả hàng ẩn{data?.hiddenCount ? ` (${data.hiddenCount})` : ""}</option>
            <option value="hidden">Chỉ hàng ẩn{data?.hiddenCount ? ` (${data.hiddenCount})` : ""}</option>
          </select>
          {/* Lọc kho: đổi luôn con số "Tổng hàng tồn" ở trên — phân biệt rõ
              tổng toàn hệ thống với tổng của một chi nhánh. */}
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}>
            <option value="">Tồn toàn hệ thống</option>
            {(data?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3 w-10 text-center hidden md:table-cell">STT</th>
                    <th className="pr-3 w-14">Ảnh</th>
                    <th className="pr-2">Tên hàng</th>
                    <th className="text-right pr-2">Giá bán</th>
                    <th className="text-right pr-2">Tồn kho</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((p, idx) => {
                    const qty = totalsByProduct(p.id);
                    const low = qty <= p.min_stock;
                    const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <tr
                        key={p.id}
                        className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${isHidden(p) ? "opacity-60" : ""}`}
                        onClick={() => setViewId(p.id)}
                      >
                        <td className="py-2 text-muted-foreground pr-3 text-center text-xs hidden md:table-cell">{globalIdx}</td>
                        <td className="py-1.5 pr-3">
                          {(p as any).image_url
                            ? <img src={(p as any).image_url} alt={p.name} className="h-10 w-10 object-cover rounded-lg border shadow-sm" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            : <div className="h-10 w-10 rounded-lg border bg-muted/40 flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground/30" /></div>
                          }
                        </td>
                        <td className="font-medium pr-2">
                          <div>{p.name}</div>
                          <div className="flex items-center gap-1.5">
                            {p.sku && <span className="text-xs text-muted-foreground">{p.sku}</span>}
                            {isAccessory(p) && (
                              <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-medium text-slate-600" title="Không tính vào tổng số hàng hóa">
                                Phụ kiện đi kèm
                              </span>
                            )}
                            {isHidden(p) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-px text-[11px] font-medium text-amber-800" title="Ngừng kinh doanh — đang ẩn">
                                <EyeOff className="h-3 w-3" />Đã ẩn
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-right pr-2 font-semibold text-primary">{fmt(p.sale_price)}</td>
                        <td className={"text-right pr-2 font-medium " + (low ? "text-destructive" : "")}>{qty}{low && <AlertTriangle className="h-3 w-3 inline ml-1" />}</td>
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

              <label className="col-span-2 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={form.count_in_total}
                  onChange={(e) => setForm({ ...form, count_in_total: e.target.checked })}
                />
                <span className="text-sm">
                  <span className="font-medium">Tính vào tổng số hàng hóa</span>
                  <span className="block text-xs text-muted-foreground">
                    Bỏ tick nếu đây là <strong>phụ kiện đi kèm</strong> (điều khiển, ty, ốp…): vẫn bán và quản lý tồn kho bình thường
                    nhưng không được đếm trong thống kê số hàng hóa (Tổng hàng tồn, Tổng sản phẩm, Top sản phẩm bán, Tổng SL bán).
                  </span>
                </span>
              </label>

              <label className={`col-span-2 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 hover:bg-muted/40 ${form.is_hidden ? "border-amber-300 bg-amber-50/60" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={form.is_hidden}
                  onChange={(e) => setForm({ ...form, is_hidden: e.target.checked })}
                />
                <span className="text-sm">
                  <span className="font-medium">Ẩn hàng (không kinh doanh)</span>
                  <span className="block text-xs text-muted-foreground">
                    Ẩn khỏi danh sách hàng hóa và Top 10 tồn kho. Muốn xem lại: bộ lọc chọn <strong>Cả hàng ẩn</strong> hoặc <strong>Chỉ hàng ẩn</strong>.
                    Tồn kho, đơn cũ, phiếu nhập/xuất giữ nguyên.
                  </span>
                </span>
              </label>

              {/* Ảnh sản phẩm */}
              <Field label="Ảnh sản phẩm" className="col-span-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                {form.image_url ? (
                  <div className="relative group rounded-xl border-2 border-border overflow-hidden bg-muted/20" style={{minHeight: 160}}>
                    <img
                      src={form.image_url}
                      alt="Ảnh sản phẩm"
                      className="w-full max-h-48 object-contain"
                    />
                    {/* Overlay khi hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 bg-white text-gray-800 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-gray-100"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                      >
                        {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        Đổi ảnh
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 bg-red-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-600"
                        onClick={() => setForm(f => ({ ...f, image_url: "" }))}
                      >
                        <X className="h-3.5 w-3.5" /> Xóa ảnh
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 hover:bg-muted/20 hover:border-primary/40 transition-all flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm font-medium text-primary">Đang tải lên Cloudinary...</span>
                      </>
                    ) : (
                      <>
                        <ImagePlus className="h-8 w-8" />
                        <span className="text-sm font-medium">Click để chọn ảnh từ máy tính</span>
                        <span className="text-xs">PNG, JPG, WEBP — tối đa 5MB</span>
                      </>
                    )}
                  </button>
                )}
                {/* URL thủ công */}
                <div className="mt-2">
                  <Input
                    value={form.image_url}
                    onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                    placeholder="Hoặc dán URL ảnh trực tiếp..."
                    className="text-xs text-muted-foreground"
                  />
                </div>
              </Field>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Hủy</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Đang lưu...</>) : "Lưu"}
              </Button>
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
                {/* Ảnh sản phẩm */}
                {(viewProduct as any).image_url ? (
                  <div className="rounded-xl overflow-hidden border bg-muted/10">
                    <img
                      src={(viewProduct as any).image_url}
                      alt={viewProduct.name}
                      className="w-full max-h-56 object-contain"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/10 flex items-center justify-center h-28 text-muted-foreground/40">
                    <Package className="h-10 w-10" />
                  </div>
                )}

                {/* Thông tin chung */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {/* Admin-only: Danh mục, Thương hiệu, Giá vốn */}
                  {isAdmin && (
                    <>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Danh mục</div>
                        <div className="font-medium">{data?.categories.find((c) => c.id === viewProduct.category_id)?.name ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Thương hiệu</div>
                        <div className="font-medium">{data?.brands.find((b) => b.id === (viewProduct as any).brand_id)?.name ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border bg-amber-50 border-amber-200 p-3">
                        <div className="text-xs text-amber-700 mb-1">Giá vốn</div>
                        <div className="font-semibold text-amber-800">{fmt(viewProduct.cost_price)}</div>
                      </div>
                    </>
                  )}
                  <div className={`rounded-lg border bg-primary/5 border-primary/20 p-3 ${isAdmin ? "" : "col-span-2"}`}>
                    <div className="text-xs text-primary/70 mb-1">Giá bán</div>
                    <div className="font-bold text-lg text-primary">{fmt(viewProduct.sale_price)}</div>
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
                  {isAccessory(viewProduct) && (
                    <> · <span className="font-medium text-slate-700">Phụ kiện đi kèm — không tính vào tổng số hàng hóa</span></>
                  )}
                  {isHidden(viewProduct) && (
                    <> · <span className="font-medium text-amber-800">Đã ẩn (không kinh doanh)</span></>
                  )}
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

      {/* Dialog Danh mục & Thương hiệu — admin only */}
      <Dialog open={adminOpen} onOpenChange={(v) => { setAdminOpen(v); setEditingBrandId(null); setEditingCatId(null); }}>
        <DialogContent className="max-w-xl w-[95vw] max-h-[90vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b bg-muted/20 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Tags className="h-5 w-5 text-primary" />
              Quản lý danh mục & thương hiệu
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
            {/* Thương hiệu */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Thương hiệu</span>
                <span className="text-xs text-muted-foreground">{data?.brands.length ?? 0} mục</span>
              </div>
              {isAdmin && (
                <div className="flex gap-2 mb-3">
                  <Input
                    className="h-9 rounded-xl bg-muted/30 border-0 focus-visible:ring-1"
                    placeholder="Tên thương hiệu mới..."
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addBrand(); }}
                    disabled={savingBrand === "new"}
                  />
                  <Button size="sm" className="h-9 px-3 rounded-xl shrink-0" onClick={addBrand} disabled={savingBrand === "new"}>
                    {savingBrand === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              )}
              <div className="space-y-1.5 max-h-44 overflow-y-auto overscroll-contain">
                {(data?.brands ?? []).map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm group hover:bg-muted/30 transition-colors">
                    {editingBrandId === b.id ? (
                      <>
                        <Input
                          className="h-7 flex-1 text-sm rounded-lg"
                          value={editingBrandName}
                          onChange={(e) => setEditingBrandName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveBrand(b.id); if (e.key === "Escape") setEditingBrandId(null); }}
                          autoFocus
                          disabled={savingBrand === b.id}
                        />
                        <button className="text-xs text-primary font-semibold hover:underline px-1 flex items-center gap-1 disabled:opacity-50" onClick={() => saveBrand(b.id)} disabled={savingBrand === b.id}>
                          {savingBrand === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Lưu
                        </button>
                        <button className="text-xs text-muted-foreground hover:underline px-1" onClick={() => setEditingBrandId(null)} disabled={savingBrand === b.id}>Huỷ</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-medium">{b.name}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" onClick={() => { setEditingBrandId(b.id); setEditingBrandName(b.name); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={() => removeBrand(b.id)} disabled={deletingBrand === b.id}>
                            {deletingBrand === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {(data?.brands ?? []).length === 0 && (
                  <div className="py-4 text-center text-sm text-muted-foreground">Chưa có thương hiệu</div>
                )}
              </div>
            </div>

            <div className="border-t" />

            {/* Danh mục */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Danh mục (nhóm hàng)</span>
                <span className="text-xs text-muted-foreground">{data?.categories.length ?? 0} mục</span>
              </div>
              {isAdmin && (
                <div className="flex gap-2 mb-3">
                  <Input
                    className="h-9 rounded-xl bg-muted/30 border-0 focus-visible:ring-1"
                    placeholder="Tên danh mục mới..."
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addCat(); }}
                    disabled={savingCat === "new"}
                  />
                  <Button size="sm" className="h-9 px-3 rounded-xl shrink-0" onClick={addCat} disabled={savingCat === "new"}>
                    {savingCat === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              )}
              <div className="space-y-1.5 max-h-44 overflow-y-auto overscroll-contain">
                {(data?.categories ?? []).map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm group hover:bg-muted/30 transition-colors">
                    {editingCatId === c.id ? (
                      <>
                        <Input
                          className="h-7 flex-1 text-sm rounded-lg"
                          value={editingCatName}
                          onChange={(e) => setEditingCatName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveCategory(c.id); if (e.key === "Escape") setEditingCatId(null); }}
                          autoFocus
                          disabled={savingCat === c.id}
                        />
                        <button className="text-xs text-primary font-semibold hover:underline px-1 flex items-center gap-1 disabled:opacity-50" onClick={() => saveCategory(c.id)} disabled={savingCat === c.id}>
                          {savingCat === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Lưu
                        </button>
                        <button className="text-xs text-muted-foreground hover:underline px-1" onClick={() => setEditingCatId(null)} disabled={savingCat === c.id}>Huỷ</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-medium">{c.name}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" onClick={() => { setEditingCatId(c.id); setEditingCatName(c.name); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={() => removeCategory(c.id)} disabled={deletingCat === c.id}>
                            {deletingCat === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {(data?.categories ?? []).length === 0 && (
                  <div className="py-4 text-center text-sm text-muted-foreground">Chưa có danh mục</div>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t bg-muted/10 shrink-0 flex justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => setAdminOpen(false)}>Đóng</Button>
          </div>
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