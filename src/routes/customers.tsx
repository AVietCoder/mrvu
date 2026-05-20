import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import * as ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  listCustomers,
  upsertCustomer,
  deleteCustomer,
  importCustomersCsv,
} from "@/lib/customers.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/Pagination";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Trash2,
  TrendingDown,
  Eye,
  Phone,
  MapPin,
  Users,
  AlertTriangle,
  Upload,
  Download,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Khách hàng — QuatTran POS" }] }),
  component: CustomersPage,
});

const groupLabel: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};

const groupColor: Record<string, string> = {
  le: "bg-gray-100 text-gray-700",
  dai_ly: "bg-blue-100 text-blue-700",
  vip: "bg-yellow-100 text-yellow-700",
  cong_trinh: "bg-purple-100 text-purple-700",
};

const PROVINCES = [
  "An Giang",
  "Bà Rịa - Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

type FormState = {
  id?: string;
  name: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  address: string;
  group_name: string;
  debt: string;
};

type CustomerRow = {
  id: string;
  external_code?: string | null;
  name: string;
  phone?: string | null;
  province?: string | null;
  district?: string | null;
  ward?: string | null;
  address?: string | null;
  group_name: string;
  debt: number;
  created_at: string;
};

type OrderRow = {
  id: string;
  customer_id: string;
  status: string;
  total: number;
  code: string;
  created_at: string;
};

const empty: FormState = {
  name: "",
  phone: "",
  province: "",
  district: "",
  ward: "",
  address: "",
  group_name: "le",
  debt: "0",
};

function CustomersPage() {
  const { user } = useAuth();
  const list = useServerFn(listCustomers);
  const upsert = useServerFn(upsertCustomer);
  const del = useServerFn(deleteCustomer);
  const importCsv = useServerFn(importCustomersCsv);
  const qc = useQueryClient();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => list(),
  });

  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [page, setPage] = useState(1);
  const [filterGroup, setFilterGroup] = useState("");
  const [filterDebt, setFilterDebt] = useState("all");

  const customers = (data?.customers ?? []) as CustomerRow[];
  const orders = (data?.orders ?? []) as OrderRow[];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return customers
      .filter((c) => {
        const matchSearch =
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.external_code ?? "").toLowerCase().includes(q);

        const matchGroup = !filterGroup || c.group_name === filterGroup;

        const debtValue = Number(c.debt || 0);
        const matchDebt =
          filterDebt === "all"
            ? true
            : filterDebt === "debt"
              ? debtValue > 0
              : debtValue === 0;

        return matchSearch && matchGroup && matchDebt;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "debt_desc")
          return Number(b.debt || 0) - Number(a.debt || 0);
        if (sortBy === "debt_asc")
          return Number(a.debt || 0) - Number(b.debt || 0);
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
  }, [customers, search, sortBy, filterGroup, filterDebt]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [filtered, page],
  );

  const totalDebt = useMemo(
    () => filtered.reduce((s, c) => s + Number(c.debt || 0), 0),
    [filtered],
  );

  const debtorCount = useMemo(
    () => filtered.filter((c) => Number(c.debt || 0) > 0).length,
    [filtered],
  );

  function startEdit(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;

    setForm({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      province: c.province ?? "",
      district: c.district ?? "",
      ward: c.ward ?? "",
      address: c.address ?? "",
      group_name: c.group_name || "le",
      debt: String(c.debt ?? 0),
    });
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsert({
        data: {
          ...form,
          debt: Number(form.debt) || 0,
        },
      });

      toast.success(
        form.id ? "Đã cập nhật khách hàng thành công!" : "Đã thêm khách hàng thành công!",
      );

      setOpen(false);
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa khách hàng "${name}"?`)) return;

    try {
      await del({ data: { id } });
      toast.success("Đã xóa");
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  function readFileAsText(file: File, encoding: string) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, encoding);
    });
  }

  async function readCsvWithFallback(file: File) {
    const encodings = ["windows-1258", "utf-8"] as const;

    for (const encoding of encodings) {
      try {
        const text = await readFileAsText(file, encoding);
        if (text.includes("Mã khách hàng") || text.includes("Tên khách hàng")) {
          return text;
        }
      } catch {
        // thử encoding tiếp theo
      }
    }

    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.loading("Đang import khách hàng...", {
        id: "import-customers",
      });

      const text = await readCsvWithFallback(file);

      const result = await importCsv({
        data: { csv: text },
      });

      toast.success("Import hoàn tất", {
        id: "import-customers",
        description: `Thêm mới: ${result.created} • Cập nhật: ${result.updated} • Bỏ qua: ${result.skipped}`,
      });

      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Import thất bại", {
        id: "import-customers",
      });
    } finally {
      e.target.value = "";
    }
  }

  async function handleExportExcel() {
    try {
      if (!filtered.length) {
        toast.error("Không có dữ liệu để xuất");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "QuatTran POS";
      workbook.created = new Date();

      const ws = workbook.addWorksheet("KhachHang", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      ws.columns = [
        { header: "STT", key: "stt", width: 8 },
        { header: "Mã KH", key: "external_code", width: 16 },
        { header: "Tên khách hàng", key: "name", width: 28 },
        { header: "Điện thoại", key: "phone", width: 18 },
        { header: "Nhóm khách", key: "group_name", width: 16 },
        { header: "Công nợ", key: "debt", width: 14 },
        { header: "Địa chỉ", key: "address", width: 34 },
        { header: "Phường/Xã", key: "ward", width: 18 },
        { header: "Quận/Huyện", key: "district", width: 18 },
        { header: "Tỉnh/Thành phố", key: "province", width: 22 },
        { header: "Ngày tạo", key: "created_at", width: 14 },
      ];

      filtered.forEach((c, index) => {
        const row = ws.addRow({
          stt: index + 1,
          external_code: c.external_code || "",
          name: c.name,
          phone: c.phone || "",
          group_name: groupLabel[c.group_name] || c.group_name,
          debt: Number(c.debt || 0),
          address: c.address || "",
          ward: c.ward || "",
          district: c.district || "",
          province: c.province || "",
          created_at: new Date(c.created_at),
        });

        row.height = 20;

        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            left: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
            right: { style: "thin", color: { argb: "FFE5E7EB" } },
          };
          cell.alignment = { vertical: "middle", wrapText: true };

          if (colNumber === 6) {
            cell.numFmt = '#,##0 "₫"';
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }

          if (colNumber === 11) {
            cell.numFmt = "dd/mm/yyyy";
          }
        });

        if (index % 2 === 1) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF9FAFB" },
            };
          });
        }
      });

      const header = ws.getRow(1);
      header.height = 22;
      header.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      header.alignment = { vertical: "middle", horizontal: "center" };
      header.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1F2937" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FF111827" } },
          left: { style: "thin", color: { argb: "FF111827" } },
          bottom: { style: "thin", color: { argb: "FF111827" } },
          right: { style: "thin", color: { argb: "FF111827" } },
        };
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const fileName = `DanhSachKhachHang_${new Date()
        .toLocaleDateString("vi-VN")
        .replaceAll("/", "-")}.xlsx`;

      saveAs(blob, fileName);
      toast.success(`Đã xuất ${filtered.length} khách hàng`);
    } catch (err: any) {
      toast.error(err?.message ?? "Xuất file thất bại");
    }
  }

  const viewCustomer = viewId ? customers.find((c) => c.id === viewId) : null;
  const customerOrders = viewId ? orders.filter((o) => o.customer_id === viewId) : [];
  const completedOrders = customerOrders.filter((o) => o.status === "completed");
  const pendingOrders = customerOrders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled",
  );
  const totalSpent = completedOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  return (
    <AppShell title="Khách hàng">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="text-xs text-muted-foreground uppercase">Tổng khách</div>
          </div>
          <div className="text-2xl font-semibold">{customers.length}</div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="text-xs text-muted-foreground uppercase">Còn công nợ</div>
          </div>
          <div className="text-2xl font-semibold text-destructive">{debtorCount}</div>
        </Card>

        <Card className="md:col-span-2">
          <div className="text-xs text-muted-foreground uppercase flex items-center gap-1 mb-1">
            <TrendingDown className="h-3 w-3" /> Tổng công nợ phải thu (đang lọc)
          </div>
          <div className="text-2xl font-semibold text-destructive">{fmt(totalDebt)}</div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="font-medium">Danh sách khách hàng</div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportCsv}
            />

            <Button
              size="sm"
              variant="outline"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import CSV
            </Button>

            <Button size="sm" variant="outline" onClick={handleExportExcel}>
              <Download className="h-4 w-4 mr-1" />
              Export Excel
            </Button>

            <Button
              size="sm"
              onClick={() => {
                setForm(empty);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Thêm khách
            </Button>
          </div>
        </div>

        <SearchFilter
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Tìm tên, số điện thoại..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "debt_desc", label: "Nợ nhiều nhất" },
            { value: "debt_asc", label: "Nợ ít nhất" },
            { value: "date", label: "Mới nhất" },
          ]}
          sortValue={sortBy}
          onSort={(v) => {
            setSortBy(v);
            setPage(1);
          }}
          filterSlot={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
              >
                <option value="">Tất cả nhóm</option>
                {Object.entries(groupLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterDebt}
                onChange={(e) => setFilterDebt(e.target.value)}
              >
                <option value="all">Tất cả</option>
                <option value="debt">Có công nợ</option>
                <option value="no_debt">Không nợ</option>
              </select>
            </div>
          }
          total={filtered.length}
          totalLabel="khách"
        />

        <div className="overflow-auto rounded-xl border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground border-b z-10">
              <tr>
                <th className="py-2 pl-3 pr-3">Tên khách hàng</th>
                <th className="pr-3">SĐT</th>
                <th className="pr-3">Địa chỉ</th>
                <th className="pr-3">Nhóm</th>
                <th className="text-right pr-3">Công nợ</th>
                <th className="text-right pr-3">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => setViewId(c.id)}
                >
                  <td className="py-2 pl-3 pr-3 font-medium">
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      {c.external_code ? (
                        <span className="text-[11px] text-muted-foreground">
                          Mã: {c.external_code}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="pr-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="pr-3 text-muted-foreground text-xs max-w-[150px] truncate">
                    {[c.district, c.province].filter(Boolean).join(", ") || c.address || "—"}
                  </td>
                  <td className="pr-3">
                    <span className={`text-xs rounded-full px-2 py-0.5 ${groupColor[c.group_name] ?? "bg-gray-100 text-gray-700"}`}>
                      {groupLabel[c.group_name] ?? c.group_name}
                    </span>
                  </td>
                  <td
                    className={`text-right pr-3 font-medium ${
                      Number(c.debt || 0) > 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {Number(c.debt || 0) > 0 ? fmt(Number(c.debt || 0)) : "—"}
                  </td>
                  <td className="text-right pr-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="p-1 hover:text-blue-600"
                      title="Xem chi tiết"
                      onClick={() => setViewId(c.id)}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      className="p-1 hover:text-primary"
                      onClick={() => startEdit(c.id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="p-1 hover:text-destructive"
                      onClick={() => handleDelete(c.id, c.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Không có kết quả
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={filtered.length}
        onPageChange={setPage}
        label="khách hàng"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Sửa khách hàng" : "Thêm khách hàng"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>Tên *</Label>
              <Input
                className="mt-1"
                value={form.name}
                required
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <Label>Điện thoại</Label>
              <Input
                className="mt-1"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <Label>Tỉnh / Thành phố</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.province}
                onChange={(e) =>
                  setForm({ ...form, province: e.target.value, district: "", ward: "" })
                }
              >
                <option value="">— Chọn tỉnh/thành phố —</option>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Quận / Huyện</Label>
              <Input
                className="mt-1"
                placeholder="Nhập quận/huyện"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
              />
            </div>

            <div>
              <Label>Phường / Xã</Label>
              <Input
                className="mt-1"
                placeholder="Nhập phường/xã"
                value={form.ward}
                onChange={(e) => setForm({ ...form, ward: e.target.value })}
              />
            </div>

            <div>
              <Label>Địa chỉ chi tiết</Label>
              <Input
                className="mt-1"
                placeholder="Số nhà, tên đường..."
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div>
              <Label>Nhóm</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.group_name}
                onChange={(e) => setForm({ ...form, group_name: e.target.value })}
              >
                {Object.entries(groupLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Công nợ (₫)</Label>
              <Input
                className="mt-1"
                type="number"
                value={form.debt}
                onChange={(e) => setForm({ ...form, debt: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Hủy
              </Button>
              <Button type="submit">Lưu</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewId}
        onOpenChange={(o) => {
          if (!o) setViewId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg">{viewCustomer.name}</span>
                  {viewCustomer.external_code ? (
                    <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">
                      Mã: {viewCustomer.external_code}
                    </span>
                  ) : null}
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${groupColor[viewCustomer.group_name] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {groupLabel[viewCustomer.group_name] ?? viewCustomer.group_name}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Số điện thoại</div>
                    <div className="font-medium">{viewCustomer.phone ?? "Chưa có"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <TrendingDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Công nợ</div>
                    <div
                      className={`font-medium ${
                        Number(viewCustomer.debt || 0) > 0
                          ? "text-destructive"
                          : "text-green-600"
                      }`}
                    >
                      {Number(viewCustomer.debt || 0) > 0
                        ? fmt(Number(viewCustomer.debt || 0))
                        : "Không có nợ"}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2 flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-muted-foreground">Địa chỉ đầy đủ</div>
                    <div className="font-medium">
                      {[viewCustomer.address, viewCustomer.ward, viewCustomer.district, viewCustomer.province]
                        .filter(Boolean)
                        .join(", ") || "Chưa có"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold">{customerOrders.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Tổng đơn hàng</div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold text-green-600">
                    {completedOrders.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Đã hoàn tất</div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-sm font-semibold text-primary">
                    {fmt(totalSpent)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Tổng chi tiêu</div>
                </div>
              </div>

              {pendingOrders.length > 0 && (
                <div className="border-t pt-3">
                  <div className="font-medium mb-2 text-sm">
                    Đơn đang chờ / đặt trước ({pendingOrders.length})
                  </div>
                  <div className="space-y-1">
                    {pendingOrders.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      >
                        <span className="font-mono text-xs">{o.code}</span>
                        <span className="text-muted-foreground text-xs">
                          {new Date(o.created_at).toLocaleDateString("vi-VN")}
                        </span>
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">
                          {o.status === "reserved" ? "Đặt trước" : "Nháp"}
                        </span>
                        <span className="font-medium">{fmt(Number(o.total || 0))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {completedOrders.length > 0 && (
                <div className="border-t pt-3">
                  <div className="font-medium mb-2 text-sm">
                    Hóa đơn đã hoàn tất ({completedOrders.length})
                  </div>
                  <div className="overflow-auto max-h-48">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground border-b">
                        <tr>
                          <th className="py-1 text-left">Mã đơn</th>
                          <th className="text-left">Ngày</th>
                          <th className="text-right">Tổng tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completedOrders.map((o) => (
                          <tr key={o.id} className="border-b last:border-0">
                            <td className="py-1 font-mono text-xs">{o.code}</td>
                            <td className="text-xs text-muted-foreground">
                              {new Date(o.created_at).toLocaleDateString("vi-VN")}
                            </td>
                            <td className="text-right font-medium">
                              {fmt(Number(o.total || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewId(null);
                    startEdit(viewCustomer.id);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa
                </Button>
                <Button onClick={() => setViewId(null)}>Đóng</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}