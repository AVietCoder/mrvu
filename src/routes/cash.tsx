// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listCash, createCashVoucher, updateCashVoucher,
  cancelCashVoucher, upsertCashVoucherType, deleteCashVoucherType,
} from "@/lib/cash.functions";
import { AppShell } from "@/components/AppShell";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, X, Wallet, Landmark, Search,
  CheckCircle2, XCircle, Pencil, Trash2, Settings2, ChevronDown, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/cash")({
  head: () => ({ meta: [{ title: "Sổ quỹ — Mr.Vũ" }] }),
  component: Page,
});

// ─── helpers ─────────────────────────────────────────────────────────────────
const moneyFmt = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n));
const fmtInput = (v: string) => {
  const n = v.replace(/\D/g, "");
  return n ? new Intl.NumberFormat("vi-VN").format(Number(n)) : "";
};
const parseInput = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const FUND_TABS = [
  { id: "tien_mat", label: "Tiền mặt", icon: Wallet },
  { id: "ngan_hang", label: "Ngân hàng", icon: Landmark },
  { id: "all", label: "Tổng quỹ", icon: null },
] as const;
type FundTab = "tien_mat" | "ngan_hang" | "all";

// ─── blank form ───────────────────────────────────────────────────────────────
const blankForm = () => ({
  amount: "",
  voucherTypeId: "",
  collectorUserId: "",
  payerCustomerId: "",
  payerUserId: "",
  receiverCustomerId: "",
  note: "",
  fundType: "tien_mat" as "tien_mat" | "ngan_hang",
  branchId: "",
  createdAt: toLocalInput(new Date()),       // ✨ thời gian tạo phiếu (mặc định = hiện tại)
});

// Convert Date -> "YYYY-MM-DDTHH:mm" cho <input type="datetime-local">
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  // "YYYY-MM-DDTHH:mm" → ISO chuẩn để lưu DB
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── VoucherForm — Đưa ra ngoài Page để tránh re-render gây lag input ────────
function VoucherForm({
  kind, f, setF, voucherTypes, staffOptions, customerOptions, isAdmin
}: {
  kind: "thu" | "chi";
  f: any;
  setF: (v: any) => void;
  voucherTypes: any[];
  staffOptions: any[];
  customerOptions: any[];
  isAdmin: boolean;
}) {
  const typeOpts = voucherTypes
    .filter((t: any) => t.kind === kind)
    .map((t: any) => ({ value: t.id, label: t.name }));

  return (
    <div className="space-y-3">
      {/* Số tiền */}
      <div>
        <Label>Số tiền <span className="text-destructive">*</span></Label>
        <Input
          className="mt-1"
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: fmtInput(e.target.value) })}
          onFocus={(e) => e.target.select()}
          placeholder="0"
        />
      </div>

      {/* Loại thu/chi */}
      <div>
        <Label>Loại {kind === "thu" ? "thu" : "chi"}</Label>
        <SearchableSelect
          className="w-full"
          value={f.voucherTypeId}
          onChange={(v) => setF({ ...f, voucherTypeId: v })}
          emptyLabel="-- Không chọn --"
          placeholder="Tìm loại..."
          options={typeOpts}
        />
      </div>

      {kind === "thu" ? (
        <>
          {/* Người thu tiền (user/nhân viên) */}
          <div>
            <Label>Người thu tiền</Label>
            <SearchableSelect
              className="w-full"
              value={f.collectorUserId}
              onChange={(v) => setF({ ...f, collectorUserId: v })}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm nhân viên..."
              options={staffOptions}
              disabled={!isAdmin}  // non-admin bị khoá, luôn là bản thân
            />
            {!isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">Mặc định là bạn đang đăng nhập</p>
            )}
          </div>

          {/* Người nộp tiền (customer) */}
          <div>
            <Label>Người nộp tiền</Label>
            <SearchableSelect
              className="w-full"
              value={f.payerCustomerId}
              onChange={(v) => setF({ ...f, payerCustomerId: v })}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm khách hàng..."
              options={customerOptions}
            />
          </div>
        </>
      ) : (
        <>
          {/* Người chi tiền (user/nhân viên) */}
          <div>
            <Label>Người chi tiền</Label>
            <SearchableSelect
              className="w-full"
              value={f.payerUserId}
              onChange={(v) => setF({ ...f, payerUserId: v })}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm nhân viên..."
              options={staffOptions}
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">Mặc định là bạn đang đăng nhập</p>
            )}
          </div>

          {/* Người nhận tiền (customer) */}
          <div>
            <Label>Người nhận tiền</Label>
            <SearchableSelect
              className="w-full"
              value={f.receiverCustomerId}
              onChange={(v) => setF({ ...f, receiverCustomerId: v })}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm khách hàng..."
              options={customerOptions}
            />
          </div>
        </>
      )}

      {/* Ghi chú */}
      <div>
        <Label>Ghi chú</Label>
        <Input
          className="mt-1"
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="Ghi chú thêm..."
        />
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
function Page() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listCash);
  const createFn = useServerFn(createCashVoucher);
  const updateFn = useServerFn(updateCashVoucher);
  const cancelFn = useServerFn(cancelCashVoucher);
  const upsertTypeFn = useServerFn(upsertCashVoucherType);
  const deleteTypeFn = useServerFn(deleteCashVoucherType);

  const { data, isLoading } = useQuery({ queryKey: ["cash"], queryFn: () => listFn() });

  // ── quyền xem ────────────────────────────────────────────────────────
  const canViewAll =
    isAdmin || user?.permissions.includes("view_cash_all");
  const canViewBranch =
    isAdmin ||
    user?.permissions.includes("view_cash_all") ||
    user?.permissions.includes("view_cash_branch");

  // Nếu không có quyền nào → không hiển thị gì
  if (!canViewBranch) {
    return (
      <AppShell title="Sổ quỹ" loading={isLoading && !data}>
        <div className="py-16 text-center text-muted-foreground">
          Bạn không có quyền xem Sổ quỹ. Liên hệ quản trị viên để được cấp quyền.
        </div>
      </AppShell>
    );
  }

  // ── state ─────────────────────────────────────────────────────────────
  const [fund, setFund] = useState<FundTab>("tien_mat");
  const [filterBranch, setFilterBranch] = useState<string>(() => {
    // Mặc định chọn chi nhánh đầu tiên của user (nếu không phải admin/view_all)
    if (isAdmin || user?.permissions.includes("view_cash_all")) return "";
    return user?.branch_ids?.[0] ?? "";
  });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"" | "thu" | "chi">("");

  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [createKind, setCreateKind] = useState<"thu" | "chi">("thu");
  const [openEdit, setOpenEdit] = useState(false);
  const [openCancel, setOpenCancel] = useState(false);
  const [openTypes, setOpenTypes] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(blankForm);
  const [editForm, setEditForm] = useState(blankForm);

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeKind, setNewTypeKind] = useState<"thu" | "chi">("thu");

  // ── raw data ──────────────────────────────────────────────────────────
  const allVouchers  = data?.vouchers     ?? [];
  const branches     = data?.branches     ?? [];
  const users        = data?.users        ?? [];
  const customers    = data?.customers    ?? [];
  const voucherTypes = data?.voucherTypes ?? [];

  // Chi nhánh user có quyền thấy
  const visibleBranches = useMemo(() => {
    if (canViewAll) return branches;
    return branches.filter((b: any) =>
      !user?.branch_ids?.length || user.branch_ids.includes(b.id),
    );
  }, [branches, canViewAll, user]);

  // Nhân viên của branch đang chọn (dùng cho picker người thu/chi)
  // Admin thấy tất cả; nhân viên thường chỉ thấy bản thân
  const staffOptions = useMemo(() => {
    const list = users.map((u: any) => ({
      value: u.id,
      label: u.full_name,
    }));
    if (isAdmin) return list;
    // Non-admin: chỉ hiện bản thân (mặc định) — không cho chọn người khác
    return list.filter((u: any) => u.value === user?.id);
  }, [users, isAdmin, user]);

  const customerOptions = useMemo(
    () => customers.map((c: any) => ({ value: c.id, label: c.name, sub: c.phone ?? undefined })),
    [customers],
  );

  // ── stats ─────────────────────────────────────────────────────────────
  const branchStats = useMemo(() => {
    const currentFund = fund === "all" ? null : fund;
    const list = allVouchers.filter(
      (v: any) =>
        v.status === "active" &&
        (currentFund ? v.fund_type === currentFund : true) &&
        (filterBranch ? v.branch_id === filterBranch : true),
    );
    const thu = list
      .filter((v: any) => v.type === "thu")
      .reduce((s: number, v: any) => s + v.amount, 0);
    const chi = list
      .filter((v: any) => v.type === "chi")
      .reduce((s: number, v: any) => s + v.amount, 0);
    return { thu, chi, ton: thu - chi };
  }, [allVouchers, fund, filterBranch]);

  // ── filtered list ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const currentFund = fund === "all" ? null : fund;
    return allVouchers.filter((v: any) => {
      const matchFund   = !currentFund || v.fund_type === currentFund;
      const matchBranch = !filterBranch || v.branch_id === filterBranch;
      // Nhân viên không có view_cash_all chỉ thấy chi nhánh mình
      const matchAccess =
        canViewAll ||
        (user?.branch_ids?.length === 0) ||
        user?.branch_ids?.includes(v.branch_id);
      const matchType  = !filterType || v.type === filterType;
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        v.code?.toLowerCase().includes(q) ||
        getCustomerName(v.payer_customer_id)?.toLowerCase().includes(q) ||
        getCustomerName(v.receiver_customer_id)?.toLowerCase().includes(q) ||
        getUserName(v.collector_user_id)?.toLowerCase().includes(q) ||
        getUserName(v.payer_user_id)?.toLowerCase().includes(q) ||
        v.note?.toLowerCase().includes(q);
      return matchFund && matchBranch && matchAccess && matchType && matchSearch;
    });
  }, [allVouchers, fund, filterBranch, filterType, search, canViewAll, user]);

  // ── lookup helpers ────────────────────────────────────────────────────
  const getBranchName    = (id: string) => branches.find((b: any) => b.id === id)?.name ?? "—";
  const getUserName      = (id: string) => users.find((u: any) => u.id === id)?.full_name ?? "";
  const getCustomerName  = (id: string) => customers.find((c: any) => c.id === id)?.name ?? "";
  const getTypeName      = (id: string) => voucherTypes.find((t: any) => t.id === id)?.name ?? "—";

  // ── open create ───────────────────────────────────────────────────────
  function openCreateDialog(kind: "thu" | "chi") {
    setCreateKind(kind);
    setForm({
      ...blankForm(),
      branchId: filterBranch || visibleBranches[0]?.id || "",
      fundType: fund === "all" ? "tien_mat" : (fund as any),
      // Mặc định người thu/chi = người đang đăng nhập
      collectorUserId: kind === "thu" ? (user?.id ?? "") : "",
      payerUserId:     kind === "chi" ? (user?.id ?? "") : "",
    });
    setOpenCreate(true);
  }

  function openEditDialog(v: any) {
    setSelectedVoucher(v);
    setEditForm({
      amount:               moneyFmt(v.amount),
      voucherTypeId:        v.voucher_type_id ?? "",
      collectorUserId:      v.collector_user_id ?? "",
      payerCustomerId:      v.payer_customer_id ?? "",
      payerUserId:          v.payer_user_id ?? "",
      receiverCustomerId:   v.receiver_customer_id ?? "",
      note:                 v.note ?? "",
      fundType:             v.fund_type,
      branchId:             v.branch_id,
    });
    setOpenEdit(true);
  }

  // ── save ──────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (saving) return; // Chặn double click gửi request trùng
    if (!parseInput(form.amount)) return toast.error("Nhập số tiền");
    setSaving(true);
    try {
      await createFn({
        data: {
          type:                 createKind,
          fund_type:            form.fundType,
          branch_id:            form.branchId,
          amount:               parseInput(form.amount),
          voucher_type_id:      form.voucherTypeId || null,
          collector_user_id:    createKind === "thu" ? (form.collectorUserId || null) : null,
          payer_customer_id:    createKind === "thu" ? (form.payerCustomerId || null) : null,
          payer_user_id:        createKind === "chi" ? (form.payerUserId || null) : null,
          receiver_customer_id: createKind === "chi" ? (form.receiverCustomerId || null) : null,
          note:                 form.note || null,
          created_by:           user?.id ?? null,
        },
      });
      toast.success(`Tạo phiếu ${createKind === "thu" ? "thu" : "chi"} thành công`);
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenCreate(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleEdit() {
    if (saving) return; // Chặn double click
    if (!parseInput(editForm.amount)) return toast.error("Nhập số tiền");
    setSaving(true);
    try {
      await updateFn({
        data: {
          id:                   selectedVoucher.id,
          amount:               parseInput(editForm.amount),
          voucher_type_id:      editForm.voucherTypeId || null,
          collector_user_id:    selectedVoucher.type === "thu" ? (editForm.collectorUserId || null) : null,
          payer_customer_id:    selectedVoucher.type === "thu" ? (editForm.payerCustomerId || null) : null,
          payer_user_id:        selectedVoucher.type === "chi" ? (editForm.payerUserId || null) : null,
          receiver_customer_id: selectedVoucher.type === "chi" ? (editForm.receiverCustomerId || null) : null,
          note:                 editForm.note || null,
        },
      });
      toast.success("Cập nhật phiếu thành công");
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenEdit(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    if (saving) return; // Chặn double click
    setSaving(true);
    try {
      await cancelFn({ data: { id: selectedVoucher.id } });
      toast.success("Đã hủy phiếu");
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenCancel(false);
      setSelectedVoucher(null);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleAddType() {
    if (!newTypeName.trim()) return;
    try {
      await upsertTypeFn({ data: { name: newTypeName.trim(), kind: newTypeKind } });
      setNewTypeName("");
      qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success("Đã thêm loại thu/chi");
    } catch (e: any) { toast.error(e.message); }
  }


  // ── render ────────────────────────────────────────────────────────────
  return (
    <AppShell title="Sổ quỹ" loading={isLoading && !data}>
      <div className="space-y-4">

        {/* ── Header actions ── */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2">
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => openCreateDialog("thu")}
            >
              <Plus className="h-4 w-4 mr-1" />Phiếu thu
            </Button>
            <Button variant="destructive" onClick={() => openCreateDialog("chi")}>
              <Plus className="h-4 w-4 mr-1" />Phiếu chi
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpenTypes(true)}>
            <Settings2 className="h-4 w-4 mr-1" />Loại thu/chi
          </Button>
        </div>

        {/* ── Fund tabs ── */}
        <div className="flex gap-1 border-b">
          {FUND_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setFund(tab.id)}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                  fund === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Stats + Branch selector ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Chi nhánh */}
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1.5">Chi nhánh</div>
            <select
              className="w-full text-sm bg-transparent outline-none cursor-pointer"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
            >
              {canViewAll && <option value="">Tất cả chi nhánh</option>}
              {visibleBranches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tổng thu</div>
            <div className="font-semibold text-green-600 text-lg">
              +{moneyFmt(branchStats.thu)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tổng chi</div>
            <div className="font-semibold text-red-600 text-lg">
              -{moneyFmt(branchStats.chi)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tồn quỹ</div>
            <div className={`font-semibold text-lg ${branchStats.ton >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {moneyFmt(branchStats.ton)}
            </div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9 w-60"
              placeholder="Tìm mã phiếu, khách hàng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="">Tất cả loại</option>
            <option value="thu">Phiếu thu</option>
            <option value="chi">Phiếu chi</option>
          </select>
        </div>

        {/* ── Table ── */}
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Mã phiếu</th>
                  <th className="px-3 py-2.5 text-left font-medium">Thời gian</th>
                  <th className="px-3 py-2.5 text-left font-medium">Loại</th>
                  <th className="px-3 py-2.5 text-left font-medium">Quỹ</th>
                  <th className="px-3 py-2.5 text-left font-medium">Người thu/chi</th>
                  <th className="px-3 py-2.5 text-left font-medium">Người nộp/nhận</th>
                  {canViewAll && (
                    <th className="px-3 py-2.5 text-left font-medium">Chi nhánh</th>
                  )}
                  <th className="px-3 py-2.5 text-left font-medium">Trạng thái</th>
                  <th className="px-3 py-2.5 text-right font-medium">Giá trị</th>
                  <th className="px-3 py-2.5 text-center font-medium w-16">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-muted-foreground">
                      Đang tải dữ liệu...
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-muted-foreground">
                      Chưa có phiếu nào
                    </td>
                  </tr>
                )}
                {filtered.map((v: any) => {
                  const isActive = v.status === "active";
                  const isThu = v.type === "thu";
                  const staffName = isThu
                    ? getUserName(v.collector_user_id)
                    : getUserName(v.payer_user_id);
                  const customerName = isThu
                    ? getCustomerName(v.payer_customer_id)
                    : getCustomerName(v.receiver_customer_id);

                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-muted/30 cursor-pointer ${!isActive ? "opacity-50 line-through" : ""}`}
                      onClick={() =>
                        setSelectedVoucher(selectedVoucher?.id === v.id ? null : v)
                      }
                    >
                      <td className="px-3 py-2.5 font-mono font-medium text-xs">
                        {v.code}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                        {fmtDate(v.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full
                            ${isThu
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                            }`}
                        >
                          {isThu ? "Thu" : "Chi"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {v.fund_type === "tien_mat" ? "Tiền mặt" : "Ngân hàng"}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {staffName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {customerName || <span className="text-muted-foreground">—</span>}
                      </td>
                      {canViewAll && (
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {getBranchName(v.branch_id)}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        {isActive ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 whitespace-nowrap">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Đã lưu
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-500 whitespace-nowrap">
                            <XCircle className="h-3.5 w-3.5 shrink-0" />Đã hủy
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums text-sm
                          ${isThu ? "text-green-600" : "text-red-600"}`}
                      >
                        {isThu ? "+" : "-"}{moneyFmt(v.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {isActive && (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              title="Sửa"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(v);
                              }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Hủy phiếu"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVoucher(v);
                                setOpenCancel(true);
                              }}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Detail panel (click row để xem) ── */}
        {selectedVoucher && !openEdit && !openCancel && (
          <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">
                Chi tiết phiếu:{" "}
                <span className="font-mono">{selectedVoucher.code}</span>
              </span>
              <button
                onClick={() => setSelectedVoucher(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Loại phiếu: </span>
                {selectedVoucher.type === "thu" ? "Phiếu thu" : "Phiếu chi"}
              </div>
              <div>
                <span className="text-muted-foreground">Quỹ: </span>
                {selectedVoucher.fund_type === "tien_mat" ? "Tiền mặt" : "Ngân hàng"}
              </div>
              <div>
                <span className="text-muted-foreground">Số tiền: </span>
                <strong>{moneyFmt(selectedVoucher.amount)} ₫</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Loại thu/chi: </span>
                {selectedVoucher.voucher_type_id
                  ? getTypeName(selectedVoucher.voucher_type_id)
                  : "—"}
              </div>
              {selectedVoucher.type === "thu" ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Người thu: </span>
                    {getUserName(selectedVoucher.collector_user_id) || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Người nộp: </span>
                    {getCustomerName(selectedVoucher.payer_customer_id) || "—"}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-muted-foreground">Người chi: </span>
                    {getUserName(selectedVoucher.payer_user_id) || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Người nhận: </span>
                    {getCustomerName(selectedVoucher.receiver_customer_id) || "—"}
                  </div>
                </>
              )}
              <div>
                <span className="text-muted-foreground">Chi nhánh: </span>
                {getBranchName(selectedVoucher.branch_id)}
              </div>
              <div>
                <span className="text-muted-foreground">Người tạo: </span>
                {getUserName(selectedVoucher.created_by) || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Thời gian: </span>
                {fmtDate(selectedVoucher.created_at)}
              </div>
              {selectedVoucher.note && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-muted-foreground">Ghi chú: </span>
                  {selectedVoucher.note}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ════ Create dialog ════ */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {createKind === "thu" ? "✅ Tạo phiếu thu" : "🔴 Tạo phiếu chi"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Quỹ + Chi nhánh */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quỹ</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.fundType}
                  onChange={(e) => setForm({ ...form, fundType: e.target.value as any })}
                >
                  <option value="tien_mat">Tiền mặt</option>
                  <option value="ngan_hang">Ngân hàng</option>
                </select>
              </div>
              <div>
                <Label>Chi nhánh</Label>
                <SearchableSelect
                  value={form.branchId}
                  onChange={(v) => setForm({ ...form, branchId: v })}
                  placeholder="Tìm chi nhánh..."
                  options={visibleBranches.map((b: any) => ({ value: b.id, label: b.name }))}
                />
              </div>
            </div>

            <VoucherForm 
              kind={createKind} 
              f={form} 
              setF={setForm}
              voucherTypes={voucherTypes}
              staffOptions={staffOptions}
              customerOptions={customerOptions}
              isAdmin={isAdmin} 
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Hủy</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang lưu...</> : "Lưu phiếu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════ Edit dialog ════ */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa phiếu {selectedVoucher?.code}</DialogTitle>
          </DialogHeader>
          <VoucherForm
            kind={selectedVoucher?.type ?? "thu"}
            f={editForm}
            setF={setEditForm}
            voucherTypes={voucherTypes}
            staffOptions={staffOptions}
            customerOptions={customerOptions}
            isAdmin={isAdmin}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)}>Hủy</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang lưu...</> : "Cập nhật"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════ Cancel confirm ════ */}
      <Dialog open={openCancel} onOpenChange={setOpenCancel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hủy phiếu?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Xác nhận hủy phiếu{" "}
            <strong className="font-mono">{selectedVoucher?.code}</strong>?
            Thao tác này không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCancel(false)}>
              Không
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang hủy...</> : "Hủy phiếu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════ Voucher type manager ════ */}
      <Dialog open={openTypes} onOpenChange={setOpenTypes}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quản lý loại thu/chi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm shrink-0"
                value={newTypeKind}
                onChange={(e) => setNewTypeKind(e.target.value as any)}
              >
                <option value="thu">Thu</option>
                <option value="chi">Chi</option>
              </select>
              <Input
                className="flex-1"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="Tên loại mới..."
                onKeyDown={(e) => e.key === "Enter" && handleAddType()}
              />
              <Button onClick={handleAddType}>Thêm</Button>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(["thu", "chi"] as const).map((kind) => (
                <div key={kind}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-1.5 px-1">
                    {kind === "thu" ? "Loại thu" : "Loại chi"}
                  </div>
                  {voucherTypes.filter((t: any) => t.kind === kind).length === 0 && (
                    <div className="text-xs text-muted-foreground px-1 pb-1 italic">
                      Chưa có loại nào
                    </div>
                  )}
                  {voucherTypes
                    .filter((t: any) => t.kind === kind)
                    .map((t: any) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50"
                      >
                        <span className="text-sm">{t.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            deleteTypeFn({ data: { id: t.id } }).then(() =>
                              qc.invalidateQueries({ queryKey: ["cash"] }),
                            )
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTypes(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}