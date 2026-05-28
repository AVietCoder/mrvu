import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import {
  listCustomers,
  upsertCustomer,
  deleteCustomer,
} from "@/lib/customers.functions";

import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import {
  Pagination,
  DEFAULT_PAGE_SIZE,
} from "@/components/Pagination";

import { useAuth } from "@/context/AuthContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Plus,
  Pencil,
  Trash2,
  TrendingDown,
  TrendingUp,
  Eye,
  Users,
  AlertTriangle,
  Loader2,
  User,
  MapPin,
  Wallet,
  Landmark,
} from "lucide-react";

import { toast } from "sonner";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [{ title: "Khách hàng — QuatTran POS" }],
  }),
  component: CustomersPage,
});

const groupLabel: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
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
  email: string;
  gender: string;
  birthday: string;
  province: string;
  district: string;
  ward: string;
  address: string;
  group_name: string;
  customer_type: "ca_nhan" | "to_chuc";
  company_name: string;
  tax_code: string;
  cccd: string;
  passport_no: string;
  bank_name: string;
  bank_account: string;
  note: string;
  debt: string;
};

const empty: FormState = {
  name: "",
  phone: "",
  email: "",
  gender: "",
  birthday: "",
  province: "",
  district: "",
  ward: "",
  address: "",
  group_name: "le",
  customer_type: "ca_nhan",
  company_name: "",
  tax_code: "",
  cccd: "",
  passport_no: "",
  bank_name: "",
  bank_account: "",
  note: "",
  debt: "0",
};

function CustomersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useServerFn(listCustomers);
  const upsert = useServerFn(upsertCustomer);
  const del = useServerFn(deleteCustomer);

  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [page, setPage] = useState(1);

  const [filterGroup, setFilterGroup] = useState("");
  const [filterDebt, setFilterDebt] = useState("all");
  const [filterTotalBuy, setFilterTotalBuy] = useState("all");

  const {
    data,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: [
      "customers",
      page,
      search,
      sortBy,
      filterGroup,
      filterDebt,
      filterTotalBuy,
    ],
    queryFn: () =>
      list({
        data: {
          page,
          pageSize: DEFAULT_PAGE_SIZE,
          search,
          group: filterGroup,
          debtFilter: filterDebt,
          totalBuyFilter: filterTotalBuy,
          sortBy,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 30,
  });

  const customers = data?.customers ?? [];
  const orders = data?.orders ?? [];

  const totalDebtorCount = data?.meta?.totalDebtorCount ?? 0;
  const totalAllDebt = data?.meta?.totalAllDebt ?? 0;
  const totalFilteredCount = data?.meta?.totalFiltered ?? 0;

  const totalSales = useMemo(() => {
    return orders
      .filter((o) => o.status === "completed")
      .reduce((s, o) => s + o.total, 0);
  }, [orders]);

  function startEdit(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;

    setForm({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      gender: c.gender ?? "",
      birthday: c.birthday ? c.birthday.slice(0, 10) : "",
      province: c.province ?? "",
      district: c.district ?? "",
      ward: c.ward ?? "",
      address: c.address ?? "",
      group_name: c.group_name ?? "le",
      customer_type: c.customer_type ?? "ca_nhan",
      company_name: c.company_name ?? "",
      tax_code: c.tax_code ?? "",
      cccd: c.cccd ?? "",
      passport_no: c.passport_no ?? "",
      bank_name: c.bank_name ?? "",
      bank_account: c.bank_account ?? "",
      note: c.note ?? "",
      debt: String(c.debt),
    });

    setOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    try {
      await upsert({
        data: {
          ...form,
          debt: Number(form.debt) || 0,
        },
      });

      toast.success(
        form.id
          ? "Đã cập nhật khách hàng thành công!"
          : "Đã thêm khách hàng thành công!"
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

  return (
    <AppShell title="Khách hàng">
      {/* LOADING PROGRESS */}
      {(isLoading || isFetching) && (
        <div className="fixed left-0 right-0 top-0 z-[9999]">
          <div className="h-1 w-full overflow-hidden bg-primary/10">
            <div className="loading-bar h-full bg-primary" />
          </div>
          <div className="absolute right-4 top-3 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1 shadow-sm backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              Đang tải dữ liệu khách hàng...
            </span>
          </div>
        </div>
      )}

      {/* STATS */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="text-xs uppercase text-muted-foreground">Tổng khách</div>
          </div>
          <div className="text-2xl font-semibold">{totalFilteredCount}</div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="text-xs uppercase text-muted-foreground">Còn công nợ</div>
          </div>
          <div className="text-2xl font-semibold text-destructive">{totalDebtorCount}</div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            <div className="text-xs uppercase text-muted-foreground">Tổng bán</div>
          </div>
          <div className="text-2xl font-semibold text-green-600">{fmt(totalSales)}</div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <div className="text-xs uppercase text-muted-foreground">Tổng công nợ</div>
          </div>
          <div className="text-2xl font-semibold text-destructive">{fmt(totalAllDebt)}</div>
        </Card>
      </div>

      {/* TABLE */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="font-medium">Danh sách khách hàng</div>
          <Button
            size="sm"
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Thêm khách
          </Button>
        </div>

        <SearchFilter
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          placeholder="Tìm tên, số điện thoại..."
          sortOptions={[
            { value: "date", label: "Mới nhất" },
            { value: "name", label: "Tên A→Z" },
            { value: "total_buy_desc", label: "Tổng bán (cao→thấp)" },
            { value: "total_buy_asc", label: "Tổng bán (thấp→cao)" },
            { value: "debt_desc", label: "Nợ nhiều nhất" },
            { value: "debt_asc", label: "Nợ ít nhất" },
          ]}
          sortValue={sortBy}
          onSort={(v) => { setSortBy(v); setPage(1); }}
          filterSlot={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterGroup}
                onChange={(e) => { setFilterGroup(e.target.value); setPage(1); }}
              >
                <option value="">Tất cả nhóm</option>
                {Object.entries(groupLabel).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterDebt}
                onChange={(e) => { setFilterDebt(e.target.value); setPage(1); }}
              >
                <option value="all">Tất cả</option>
                <option value="debt">Có công nợ</option>
                <option value="no_debt">Không nợ</option>
              </select>
            </div>
          }
          total={totalFilteredCount}
          totalLabel="khách"
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Tên khách hàng</th>
                <th className="pr-3">SĐT</th>
                <th className="pr-3">Địa chỉ</th>
                <th
                  className="pr-3 text-right cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => { setSortBy(s => s === "total_buy_desc" ? "total_buy_asc" : "total_buy_desc"); setPage(1); }}
                  title="Click để sắp xếp theo Tổng bán"
                >
                  Tổng bán {sortBy === "total_buy_desc" ? " ↓" : sortBy === "total_buy_asc" ? " ↑" : " ↕"}
                </th>
                <th
                  className="pr-3 text-right cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => { setSortBy(s => s === "debt_desc" ? "debt_asc" : "debt_desc"); setPage(1); }}
                  title="Click để sắp xếp theo Công nợ"
                >
                  Công nợ {sortBy === "debt_desc" ? " ↓" : sortBy === "debt_asc" ? " ↑" : " ↕"}
                </th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => setViewId(c.id)}
                >
                  <td className="py-2 pr-3 font-medium">
                    <Link
                      to="/customers/$id"
                      params={{ id: c.id }}
                      className="hover:text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="pr-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="max-w-[200px] truncate pr-3 text-xs text-muted-foreground">
                    {[c.address, c.ward, c.province].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="pr-3 text-right font-medium text-green-600">{fmt(c.total_buy || 0)}</td>
                  <td className={`pr-3 text-right font-medium ${c.debt > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {c.debt > 0 ? fmt(c.debt) : "—"}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to="/customers/$id"
                      params={{ id: c.id }}
                      className="inline-flex p-1 hover:text-blue-600"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                    <button className="p-1 hover:text-primary" onClick={() => startEdit(c.id)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button className="p-1 hover:text-destructive" onClick={() => handleDelete(c.id, c.name)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
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
        total={totalFilteredCount}
        onPageChange={setPage}
        label="khách hàng"
      />

      {/* DIALOG ĐƯỢC MỞ RỘNG RỘNG VÀ DÀI HƠN RA 2 BÊN (max-w-2xl) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{padding :0 }} className="max-h-[92vh] max-w-2xl overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 bg-muted/40 border-b">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <Users className="h-5 w-5" />
              </div>
              {form.id ? "Cập nhật thông tin đối tác" : "Thêm khách hàng mới"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Điền các thông tin liên hệ và phân nhóm khách hàng để đồng bộ vào hệ thống POS.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="p-4 space-y-5">

            {/* ── PHẦN 1: THÔNG TIN CƠ BẢN ── */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <User className="h-4 w-4" /> Thông tin cơ bản
              </div>

              {/* Loại khách hàng */}
              <div className="flex gap-4">
                {(["ca_nhan", "to_chuc"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="customer_type"
                      value={t}
                      checked={form.customer_type === t}
                      onChange={() => setForm({ ...form, customer_type: t })}
                      className="accent-primary"
                    />
                    {t === "ca_nhan" ? "Cá nhân" : "Tổ chức / Hộ kinh doanh"}
                  </label>
                ))}
              </div>

              {/* Tên + SĐT */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1">
                  <Label className="text-xs font-medium">
                    {form.customer_type === "to_chuc" ? "Tên người mua" : "Họ và tên"} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    className="bg-background mt-1"
                    placeholder="Nhập tên đầy đủ"
                    value={form.name}
                    required
                    autoFocus
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số điện thoại</Label>
                  <Input
                    className="bg-background mt-1"
                    placeholder="0912xxxxxx"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* Email + Giới tính + Ngày sinh (cá nhân) */}
              {form.customer_type === "ca_nhan" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1 sm:col-span-1">
                    <Label className="text-xs font-medium">Email</Label>
                    <Input
                      className="bg-background mt-1"
                      placeholder="email@gmail.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Giới tính</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.gender}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    >
                      <option value="">-- Chọn --</option>
                      <option value="nam">Nam</option>
                      <option value="nu">Nữ</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Ngày sinh</Label>
                    <Input
                      type="date"
                      className="bg-background mt-1"
                      value={form.birthday}
                      onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Nhóm + CCCD + Hộ chiếu (cá nhân) */}
              {form.customer_type === "ca_nhan" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Nhóm đối tác</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.group_name}
                      onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                    >
                      {Object.entries(groupLabel).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số CCCD / CMND</Label>
                    <Input
                      className="bg-background mt-1"
                      placeholder="Nhập số CCCD/CMND"
                      value={form.cccd}
                      onChange={(e) => setForm({ ...form, cccd: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số hộ chiếu</Label>
                    <Input
                      className="bg-background mt-1"
                      placeholder="Nhập số hộ chiếu"
                      value={form.passport_no}
                      onChange={(e) => setForm({ ...form, passport_no: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Tổ chức: tên công ty + MST + email + nhóm */}
              {form.customer_type === "to_chuc" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Tên công ty / Hộ kinh doanh</Label>
                      <Input
                        className="bg-background mt-1"
                        placeholder="Nhập tên công ty"
                        value={form.company_name}
                        onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Mã số thuế</Label>
                      <Input
                        className="bg-background mt-1"
                        placeholder="Nhập mã số thuế"
                        value={form.tax_code}
                        onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Email</Label>
                      <Input
                        className="bg-background mt-1"
                        placeholder="email@company.com"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Nhóm đối tác</Label>
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.group_name}
                        onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                      >
                        {Object.entries(groupLabel).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Ghi chú */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Ghi chú</Label>
                <Input
                  className="bg-background mt-1"
                  placeholder="Ghi chú thêm về khách hàng..."
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
            </div>

            {/* ── PHẦN 2: ĐỊA CHỈ LIÊN HỆ ── */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <MapPin className="h-4 w-4" /> Địa chỉ liên hệ
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tỉnh / Thành phố</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.province}
                    onChange={(e) => setForm({ ...form, province: e.target.value })}
                  >
                    <option value="">-- Chọn tỉnh thành --</option>
                    {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Quận / Huyện</Label>
                  <Input
                    className="bg-background mt-1"
                    placeholder="Nhập quận/huyện"
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Phường / Xã</Label>
                  <Input
                    className="bg-background mt-1"
                    placeholder="Nhập phường/xã"
                    value={form.ward}
                    onChange={(e) => setForm({ ...form, ward: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Số nhà, tên đường</Label>
                <Input
                  className="bg-background mt-1"
                  placeholder="Ví dụ: Số 123, đường Trần Hưng Đạo"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>

            {/* ── PHẦN 3: NGÂN HÀNG ── */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <Landmark className="h-4 w-4" /> Thông tin ngân hàng
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Ngân hàng</Label>
                  <Input
                    className="bg-background mt-1"
                    placeholder="VD: Vietcombank, Techcombank..."
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số tài khoản ngân hàng</Label>
                  <Input
                    className="bg-background mt-1 font-mono"
                    placeholder="Nhập số tài khoản"
                    value={form.bank_account}
                    onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* ── PHẦN 4: TÀI CHÍNH CÔNG NỢ ── */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <Wallet className="h-4 w-4" /> Thiết lập tài chính
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Dư nợ công nợ đầu kỳ (nếu có)</Label>
                  <div className="relative mt-1">
                    <Input
                      className="pl-8 bg-background font-medium text-destructive"
                      inputMode="numeric"
                      placeholder="0"
                      value={form.debt}
                      onChange={(e) => setForm({ ...form, debt: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                    <div className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">đ</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pt-0 md:pt-6">
                  Khoản tiền khách đang nợ cửa hàng tính tới thời điểm tạo tài khoản.
                </p>
              </div>
            </div>

            <DialogFooter className="pt-3 border-t gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Hủy bỏ</Button>
              <Button type="submit" className="px-6">Lưu thông tin</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <style>{`
        .loading-bar {
          animation: loading 1.2s ease-in-out infinite;
        }

        @keyframes loading {
          0% {
            transform: translateX(-100%);
            width: 40%;
          }
          50% {
            width: 60%;
          }
          100% {
            transform: translateX(250%);
            width: 40%;
          }
        }
      `}</style>
    </AppShell>
  );
}