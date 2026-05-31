// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import {
  listCash, createCashVoucher, updateCashVoucher,
  cancelCashVoucher, upsertCashVoucherType, deleteCashVoucherType,
} from "@/lib/cash.functions";
import { getSettings } from "@/lib/settings.functions";
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
  CheckCircle2, XCircle, Pencil, Trash2, Settings2,
  Loader2, ChevronRight, Copy, TrendingUp, TrendingDown, Scale,
  Building2, Clock, User, Users, FileText, CreditCard,
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
const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

const FUND_TABS = [
  { id: "tien_mat", label: "Tiền mặt", icon: Wallet },
  { id: "ngan_hang", label: "Ngân hàng", icon: Landmark },
  { id: "all", label: "Tổng quỹ", icon: Scale },
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
  createdAt: toLocalInput(new Date()),
  bankAccountIdx: "",
  bankContent: "",
});

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── BankSection ────────────────────────────────────────────────────────────
function BankSection({ bankAccountIdx, setF, bankList }: {
  bankAccountIdx: string;
  setF: (v: any) => void;
  bankList: any[];
}) {
  if (!bankList.length) return null;

  const handleChange = useCallback((e: any) => {
    const idx = e.target.value;
    const ba = bankList[parseInt(idx)];
    setF((prev: any) => ({
      ...prev,
      bankAccountIdx: idx,
      bankContent: ba ? ba.account_number : "",
    }));
  }, [setF, bankList]);

  const selectedBa = bankAccountIdx !== "" ? bankList[parseInt(bankAccountIdx)] : null;

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <Label className="text-xs text-muted-foreground">Tài khoản ngân hàng</Label>
      <select
        className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
        value={bankAccountIdx}
        onChange={handleChange}
      >
        <option value="">— Chọn tài khoản —</option>
        {bankList.map((ba: any, i: number) => (
          <option key={i} value={String(i)}>
            {ba.bank} - {ba.account_number} ({ba.account_name})
          </option>
        ))}
      </select>
      {selectedBa && (
        <div className="mt-1.5 rounded-lg border bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-0.5">
          <div className="font-semibold">{selectedBa.bank}</div>
          <div>STK: <span className="font-mono font-bold tracking-wide">{selectedBa.account_number}</span></div>
          <div>Chủ TK: {selectedBa.account_name}</div>
          {selectedBa.note && <div className="text-blue-600">{selectedBa.note}</div>}
        </div>
      )}
    </div>
  );
}

// ── VoucherForm ────────────────────────────────────────────────────────────
function VoucherForm({
  kind, f, setF, voucherTypes, staffOptions, customerOptions, isAdmin, siteSettings, visibleBranches,
}: {
  kind: "thu" | "chi";
  f: any;
  setF: (v: any) => void;
  voucherTypes: any[];
  staffOptions: any[];
  customerOptions: any[];
  isAdmin: boolean;
  siteSettings: any;
  visibleBranches: any[];
}) {
  // ── Tính toán ổn định, không tạo lại khi gõ phím ────────────────────────
  const typeOpts = useMemo(
    () => voucherTypes.filter((t: any) => t.kind === kind).map((t: any) => ({ value: t.id, label: t.name })),
    [voucherTypes, kind]
  );
  const bankList: any[] = useMemo(() => {
    try { return JSON.parse(siteSettings?.bank_accounts || "[]"); }
    catch { return []; }
  }, [siteSettings?.bank_accounts]);
  const branchOptions = useMemo(
    () => visibleBranches.map((b: any) => ({ value: b.id, label: b.name })),
    [visibleBranches]
  );

  // ── Handlers ổn định — không tạo mới khi re-render ────────────────────────
  const handleFundType  = useCallback((e: any) =>
    setF((prev: any) => ({ ...prev, fundType: e.target.value, bankAccountIdx: "", bankContent: "" })),
    [setF]);
  const handleBranch    = useCallback((v: string) => setF((prev: any) => ({ ...prev, branchId: v })), [setF]);
  const handleAmount    = useCallback((e: any) =>
    setF((prev: any) => ({ ...prev, amount: fmtInput(e.target.value) })), [setF]);
  const handleAmountFocus = useCallback((e: any) => e.target.select(), []);
  const handleTypeId    = useCallback((v: string) => setF((prev: any) => ({ ...prev, voucherTypeId: v })), [setF]);
  const handleCollector = useCallback((v: string) => setF((prev: any) => ({ ...prev, collectorUserId: v })), [setF]);
  const handlePayer     = useCallback((v: string) => setF((prev: any) => ({ ...prev, payerCustomerId: v })), [setF]);
  const handlePayerUser = useCallback((v: string) => setF((prev: any) => ({ ...prev, payerUserId: v })), [setF]);
  const handleReceiver  = useCallback((v: string) => setF((prev: any) => ({ ...prev, receiverCustomerId: v })), [setF]);
  const handleNote      = useCallback((e: any) => setF((prev: any) => ({ ...prev, note: e.target.value })), [setF]);

  return (
    <div className="space-y-3">
      {/* Quỹ + Chi nhánh */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Hình thức <span className="text-destructive">*</span></Label>
          <select
            className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={f.fundType}
            onChange={handleFundType}
          >
            <option value="tien_mat">Tiền mặt</option>
            <option value="ngan_hang">Chuyển khoản (NH)</option>
          </select>
        </div>
        <div>
          <Label>Chi nhánh</Label>
          <SearchableSelect
            className="mt-1"
            value={f.branchId}
            onChange={handleBranch}
            placeholder="Tìm chi nhánh..."
            options={branchOptions}
          />
        </div>
      </div>

      {/* Bank section bắt buộc khi chọn ngân hàng */}
      {f.fundType === "ngan_hang" && (
        <div>
          <BankSection bankAccountIdx={f.bankAccountIdx} setF={setF} bankList={bankList} />
          {bankList.length > 0 && f.bankAccountIdx === "" && (
            <p className="text-xs text-destructive mt-1">Vui lòng chọn tài khoản ngân hàng</p>
          )}
        </div>
      )}

      {/* Số tiền */}
      <div>
        <Label>Số tiền <span className="text-destructive">*</span></Label>
        <Input
          className="mt-1"
          value={f.amount}
          onChange={handleAmount}
          onFocus={handleAmountFocus}
          placeholder="0"
        />
      </div>

      {/* Loại thu/chi */}
      <div>
        <Label>Loại {kind === "thu" ? "thu" : "chi"}</Label>
        <SearchableSelect
          className="mt-1 w-full"
          value={f.voucherTypeId}
          onChange={handleTypeId}
          emptyLabel="-- Không chọn --"
          placeholder="Tìm loại..."
          options={typeOpts}
        />
      </div>

      {kind === "thu" ? (
        <>
          <div>
            <Label>Người thu tiền</Label>
            <SearchableSelect
              className="mt-1 w-full"
              value={f.collectorUserId}
              onChange={handleCollector}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm nhân viên..."
              options={staffOptions}
              disabled={!isAdmin}
            />
            {!isAdmin && <p className="text-xs text-muted-foreground mt-1">Mặc định là bạn đang đăng nhập</p>}
          </div>
          <div>
            <Label>Người nộp tiền</Label>
            <SearchableSelect
              className="mt-1 w-full"
              value={f.payerCustomerId}
              onChange={handlePayer}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm khách hàng..."
              options={customerOptions}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Người chi tiền</Label>
            <SearchableSelect
              className="mt-1 w-full"
              value={f.payerUserId}
              onChange={handlePayerUser}
              emptyLabel="-- Không chọn --"
              placeholder="Tìm nhân viên..."
              options={staffOptions}
              disabled={!isAdmin}
            />
            {!isAdmin && <p className="text-xs text-muted-foreground mt-1">Mặc định là bạn đang đăng nhập</p>}
          </div>
          <div>
            <Label>Người nhận tiền</Label>
            <SearchableSelect
              className="mt-1 w-full"
              value={f.receiverCustomerId}
              onChange={handleReceiver}
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
          onChange={handleNote}
          placeholder="Ghi chú thêm..."
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
function Page() {
  const { user, isAdmin , activeBranchId } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listCash);
  const createFn = useServerFn(createCashVoucher);
  const updateFn = useServerFn(updateCashVoucher);
  const cancelFn = useServerFn(cancelCashVoucher);
  const upsertTypeFn = useServerFn(upsertCashVoucherType);
  const deleteTypeFn = useServerFn(deleteCashVoucherType);
  const getSettingsFn = useServerFn(getSettings);

  const { data, isLoading } = useQuery({ queryKey: ["cash"], queryFn: () => listFn() });
  const { data: siteSettings } = useQuery({ queryKey: ["site_settings"], queryFn: () => getSettingsFn() });

  const canViewAll = isAdmin || user?.permissions.includes("view_cash_all");
  const canViewBranch =
    isAdmin ||
    user?.permissions.includes("view_cash_all") ||
    user?.permissions.includes("view_cash_branch");

  if (!canViewBranch) {
    return (
      <AppShell title="Sổ quỹ" loading={isLoading && !data}>
        <div className="py-16 text-center text-muted-foreground">
          Bạn không có quyền xem Sổ quỹ.
        </div>
      </AppShell>
    );
  }

  const [fund, setFund] = useState<FundTab>("tien_mat");
  const [filterBranch, setFilterBranch] = useState<string>(() => {
    if (isAdmin || user?.permissions.includes("view_cash_all")) return "";
    return activeBranchId ?? user?.branch_ids?.[0] ?? "";
  });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"" | "thu" | "chi">("");
  const [filterBank, setFilterBank] = useState<string>("");  // lọc theo STK ngân hàng (note chứa số TK)
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [createKind, setCreateKind] = useState<"thu" | "chi">("thu");
  const [openEdit, setOpenEdit] = useState(false);
  const [openCancel, setOpenCancel] = useState(false);
  const [openTypes, setOpenTypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [deletingTypeId, setDeletingTypeId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [editForm, setEditForm] = useState(blankForm);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeKind, setNewTypeKind] = useState<"thu" | "chi">("thu");

  const allVouchers  = data?.vouchers     ?? [];
  const branches     = data?.branches     ?? [];
  const users        = data?.users        ?? [];
  const customers    = data?.customers    ?? [];
  const voucherTypes = data?.voucherTypes ?? [];

  const visibleBranches = useMemo(() => {
    if (canViewAll) return branches;
    return branches.filter((b: any) =>
      !user?.branch_ids?.length || user.branch_ids.includes(b.id),
    );
  }, [branches, canViewAll, user]);

  const staffOptions = useMemo(() => {
    const list = users.map((u: any) => ({ value: u.id, label: u.full_name }));
    if (isAdmin) return list;
    return list.filter((u: any) => u.value === user?.id);
  }, [users, isAdmin, user]);

  const customerOptions = useMemo(
    () => customers.map((c: any) => ({ value: c.id, label: c.name, sub: c.phone ?? undefined })),
    [customers],
  );

  const branchStats = useMemo(() => {
    const currentFund = fund === "all" ? null : fund;
    const list = allVouchers.filter(
      (v: any) =>
        v.status === "active" &&
        (currentFund ? v.fund_type === currentFund : true) &&
        (filterBranch ? v.branch_id === filterBranch : true),
    );
    const thu = list.filter((v: any) => v.type === "thu").reduce((s: number, v: any) => s + v.amount, 0);
    const chi = list.filter((v: any) => v.type === "chi").reduce((s: number, v: any) => s + v.amount, 0);
    return { thu, chi, ton: thu - chi };
  }, [allVouchers, fund, filterBranch]);

  const getBranchName   = (id: string) => branches.find((b: any) => b.id === id)?.name ?? "—";
  const getUserName     = (id: string) => users.find((u: any) => u.id === id)?.full_name ?? "";
  const getCustomerName = (id: string) => customers.find((c: any) => c.id === id)?.name ?? "";
  const getTypeName     = (id: string) => voucherTypes.find((t: any) => t.id === id)?.name ?? "—";

  // Lấy thông tin tài khoản ngân hàng từ note (số TK được nhúng vào đầu note)
  const getBankAccountInfo = (v: any): { bank: string; account_number: string; account_name: string } | null => {
    if (v.fund_type !== "ngan_hang" || !v.note) return null;
    const bankList: any[] = (() => { try { return JSON.parse(siteSettings?.bank_accounts || "[]"); } catch { return []; } })();
    const accountNumber = v.note.split(" — ")[0];
    const found = bankList.find((ba: any) => ba.account_number === accountNumber);
    return found ?? null;
  };

  const filtered = useMemo(() => {
    const currentFund = fund === "all" ? null : fund;
    return allVouchers.filter((v: any) => {
      const matchFund   = !currentFund || v.fund_type === currentFund;
      const matchBranch = !filterBranch || v.branch_id === filterBranch;
      const matchAccess =
        canViewAll || (user?.branch_ids?.length === 0) || user?.branch_ids?.includes(v.branch_id);
      const matchType  = !filterType || v.type === filterType;
      const matchBank  = !filterBank || (v.note ?? "").includes(filterBank); // lọc theo số TK trong note
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        v.code?.toLowerCase().includes(q) ||
        getCustomerName(v.payer_customer_id)?.toLowerCase().includes(q) ||
        getCustomerName(v.receiver_customer_id)?.toLowerCase().includes(q) ||
        getUserName(v.collector_user_id)?.toLowerCase().includes(q) ||
        getUserName(v.payer_user_id)?.toLowerCase().includes(q) ||
        v.note?.toLowerCase().includes(q);
      return matchFund && matchBranch && matchAccess && matchType && matchBank && matchSearch;
    });
  }, [allVouchers, fund, filterBranch, filterType, filterBank, search, canViewAll, user]);



  function openCreateDialog(kind: "thu" | "chi") {
    setCreateKind(kind);
    setForm({
      ...blankForm(),
      branchId: filterBranch || visibleBranches[0]?.id || "",
      fundType: fund === "all" ? "tien_mat" : (fund as any),
      collectorUserId: kind === "thu" ? (user?.id ?? "") : "",
      payerUserId: kind === "chi" ? (user?.id ?? "") : "",
    });
    setOpenCreate(true);
  }

  function openEditDialog(v: any) {
    setSelectedVoucher(v);
    setEditForm({
      amount:             moneyFmt(v.amount),
      voucherTypeId:      v.voucher_type_id ?? "",
      collectorUserId:    v.collector_user_id ?? "",
      payerCustomerId:    v.payer_customer_id ?? "",
      payerUserId:        v.payer_user_id ?? "",
      receiverCustomerId: v.receiver_customer_id ?? "",
      note:               v.note ?? "",
      fundType:           v.fund_type,
      branchId:           v.branch_id,
      // ✅ Khi edit phiếu NH: tìm lại bankAccountIdx từ note (note lưu số TK)
      bankAccountIdx:     (() => {
        if (v.fund_type !== "ngan_hang" || !v.note) return "";
        try {
          const list = JSON.parse(siteSettings?.bank_accounts || "[]");
          const idx = list.findIndex((ba: any) => v.note?.includes(ba.account_number));
          return idx >= 0 ? String(idx) : "";
        } catch { return ""; }
      })(),
      bankContent:        v.fund_type === "ngan_hang" && v.note ? v.note.split(" — ")[0] : "",
    });
    setOpenEdit(true);
  }

  // Build note — bao gồm số TK ngân hàng để sau có thể filter
  function buildNote(f: any): string | null {
    const parts = [];
    // ✅ Nhúng số TK vào note để filter theo ngân hàng hoạt động
    if (f.fundType === "ngan_hang" && f.bankContent) parts.push(f.bankContent);
    if (f.note) parts.push(f.note);
    return parts.join(" — ") || null;
  }

  async function handleCreate() {
    if (saving) return;
    if (!parseInput(form.amount)) return toast.error("Nhập số tiền");
    const bankListCreate: any[] = (() => { try { return JSON.parse(siteSettings?.bank_accounts || "[]"); } catch { return []; } })();
    if (form.fundType === "ngan_hang" && bankListCreate.length > 0 && form.bankAccountIdx === "") {
      return toast.error("Vui lòng chọn tài khoản ngân hàng");
    }
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
          note:                 buildNote(form),
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
    if (saving) return;
    if (!parseInput(editForm.amount)) return toast.error("Nhập số tiền");
    const bankListEdit: any[] = (() => { try { return JSON.parse(siteSettings?.bank_accounts || "[]"); } catch { return []; } })();
    if (editForm.fundType === "ngan_hang" && bankListEdit.length > 0 && editForm.bankAccountIdx === "") {
      return toast.error("Vui lòng chọn tài khoản ngân hàng");
    }
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
          note:                 buildNote(editForm),
          fund_type:            editForm.fundType,
          branch_id:            editForm.branchId,
        },
      });
      await qc.invalidateQueries({ queryKey: ["cash"] });
      await qc.refetchQueries({ queryKey: ["cash"] });
      toast.success("Cập nhật phiếu thành công");
      setSelectedVoucher(null);
      setOpenEdit(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    if (saving) return;
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
    if (addingType) return;
    if (!newTypeName.trim()) return;
    setAddingType(true);
    try {
      await upsertTypeFn({ data: { name: newTypeName.trim(), kind: newTypeKind } });
      setNewTypeName("");
      await qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success("Đã thêm loại thu/chi");
    } catch (e: any) { toast.error(e.message); }
    finally { setAddingType(false); }
  }

  async function handleDeleteType(typeId: string) {
    if (deletingTypeId) return;
    setDeletingTypeId(typeId);
    try {
      await deleteTypeFn({ data: { id: typeId } });
      await qc.invalidateQueries({ queryKey: ["cash"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setDeletingTypeId(null); }
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
                onClick={() => { setFund(tab.id); setFilterBank(""); }}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                  fund === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />Chi nhánh
            </div>
            <select
              className="w-full text-sm font-medium bg-transparent outline-none cursor-pointer"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
            >
              {canViewAll && <option value="">Tất cả</option>}
              {visibleBranches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
              Tổng thu{fund !== "all" ? ` (${fund === "tien_mat" ? "Tiền mặt" : "Ngân hàng"})` : ""}
            </div>
            <div className="font-bold text-green-600 text-base sm:text-lg tabular-nums">
              +{moneyFmt(branchStats.thu)}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              Tổng chi{fund !== "all" ? ` (${fund === "tien_mat" ? "Tiền mặt" : "Ngân hàng"})` : ""}
            </div>
            <div className="font-bold text-red-600 text-base sm:text-lg tabular-nums">
              -{moneyFmt(branchStats.chi)}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5 text-blue-500" />
              Tồn quỹ{fund !== "all" ? ` (${fund === "tien_mat" ? "Tiền mặt" : "Ngân hàng"})` : ""}
            </div>
            <div className={`font-bold text-base sm:text-lg tabular-nums ${branchStats.ton >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {moneyFmt(branchStats.ton)}
            </div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9"
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

          {/* Lọc theo tài khoản ngân hàng — chỉ hiện khi tab Ngân hàng */}
          {fund === "ngan_hang" && (() => {
            const bankList: any[] = (() => {
              try { return JSON.parse(siteSettings?.bank_accounts || "[]"); }
              catch { return []; }
            })();
            if (!bankList.length) return null;
            return (
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filterBank}
                onChange={(e) => setFilterBank(e.target.value)}
              >
                <option value="">Tất cả tài khoản</option>
                {bankList.map((ba: any, i: number) => (
                  <option key={i} value={ba.account_number}>
                    {ba.bank} - {ba.account_number}
                  </option>
                ))}
              </select>
            );
          })()}
        </div>

        {/* ── Card list (mobile-first) / Table (desktop) ── */}
        {isLoading && (
          <div className="py-12 text-center text-muted-foreground">Đang tải dữ liệu...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">Chưa có phiếu nào</div>
        )}

        {/* Mobile cards */}
        {!isLoading && filtered.length > 0 && (
          <div className="block sm:hidden space-y-2">
            {filtered.map((v: any) => {
              const isActive = v.status === "active";
              const isThu = v.type === "thu";
              const staffName = isThu ? getUserName(v.collector_user_id) : getUserName(v.payer_user_id);
              const customerName = isThu ? getCustomerName(v.payer_customer_id) : getCustomerName(v.receiver_customer_id);
              const isSelected = selectedVoucher?.id === v.id;
              const canEditVoucher = isAdmin || v.created_by === user?.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVoucher(isSelected ? null : v)}
                  className={[
                    "rounded-xl border bg-card p-3 shadow-sm cursor-pointer transition-all",
                    !isActive ? "opacity-50" : "",
                    isSelected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/30",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${isThu ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {isThu ? "Thu" : "Chi"}
                      </span>
                      <span className="font-mono text-xs font-medium text-muted-foreground truncate">{v.code}</span>
                    </div>
                    <span className={`shrink-0 font-bold tabular-nums ${isThu ? "text-green-600" : "text-red-600"}`}>
                      {isThu ? "+" : "-"}{moneyFmt(v.amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      {v.fund_type === "tien_mat" ? <Wallet className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
                      {v.fund_type === "tien_mat" ? "Tiền mặt" : "Ngân hàng"}
                    </span>
                    {customerName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{customerName}</span>}
                    {staffName && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{staffName}</span>}
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateShort(v.created_at)}</span>
                  </div>
                  {/* Expanded detail */}
                  {isSelected && (
                    <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div><span className="text-muted-foreground">Loại: </span>{getTypeName(v.voucher_type_id) !== "—" ? getTypeName(v.voucher_type_id) : "—"}</div>
                        <div><span className="text-muted-foreground">Chi nhánh: </span>{getBranchName(v.branch_id)}</div>
                        <div><span className="text-muted-foreground">Người tạo: </span>{getUserName(v.created_by) || "—"}</div>
                        <div><span className="text-muted-foreground">Thời gian: </span>{fmtDate(v.created_at)}</div>
                        {v.fund_type === "ngan_hang" && (() => {
                          const ba = getBankAccountInfo(v);
                          return ba ? (
                            <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 space-y-0.5">
                              <div className="flex items-center gap-1 text-blue-700 font-semibold"><Landmark className="h-3 w-3" />{ba.bank}</div>
                              <div className="text-blue-800">STK: <span className="font-mono font-bold tracking-wide">{ba.account_number}</span></div>
                              <div className="text-blue-700">Chủ TK: {ba.account_name}</div>
                            </div>
                          ) : (
                            <div className="col-span-2 flex items-center gap-1 text-blue-700">
                              <Landmark className="h-3 w-3" />Chuyển khoản ngân hàng
                            </div>
                          );
                        })()}
                        {v.note && (() => {
                          const displayNote = v.fund_type === "ngan_hang" ? v.note.split(" — ").slice(1).join(" — ") : v.note;
                          return displayNote ? <div className="col-span-2"><span className="text-muted-foreground">Ghi chú: </span>{displayNote}</div> : null;
                        })()}
                      </div>
                      {isActive && (
                        <div className="flex gap-2 pt-1">
                          {canEditVoucher && (
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={(e) => { e.stopPropagation(); openEditDialog(v); }}>
                              <Pencil className="h-3 w-3 mr-1" />Sửa
                            </Button>
                          )}
                          {canEditVoucher && (
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setSelectedVoucher(v); setOpenCancel(true); }}>
                              <X className="h-3 w-3 mr-1" />Hủy phiếu
                            </Button>
                          )}
                          {!canEditVoucher && (
                            <span className="text-xs text-muted-foreground italic">Chỉ người tạo mới được sửa/hủy</span>
                          )}
                        </div>
                      )}
                      {!isActive && (
                        <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3.5 w-3.5" />Đã hủy</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop table */}
        {!isLoading && filtered.length > 0 && (
          <div className="hidden sm:block rounded-xl border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Mã phiếu</th>
                    <th className="px-4 py-3 text-left font-semibold">Thời gian</th>
                    <th className="px-4 py-3 text-left font-semibold">Loại</th>
                    <th className="px-4 py-3 text-left font-semibold">Hình thức</th>
                    <th className="px-4 py-3 text-left font-semibold">Người thu/chi</th>
                    <th className="px-4 py-3 text-left font-semibold">Người nộp/nhận</th>
                    {canViewAll && <th className="px-4 py-3 text-left font-semibold">Chi nhánh</th>}
                    <th className="px-4 py-3 text-right font-semibold">Giá trị</th>
                    <th className="px-4 py-3 text-center font-semibold w-20">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((v: any) => {
                    const isActive = v.status === "active";
                    const isThu = v.type === "thu";
                    const staffName = isThu ? getUserName(v.collector_user_id) : getUserName(v.payer_user_id);
                    const customerName = isThu ? getCustomerName(v.payer_customer_id) : getCustomerName(v.receiver_customer_id);
                    const isSelected = selectedVoucher?.id === v.id;
                    const canEditVoucher = isAdmin || v.created_by === user?.id;
                    return (
                      <>
                        <tr
                          key={v.id}
                          className={[
                            "hover:bg-muted/20 cursor-pointer transition-colors",
                            !isActive ? "opacity-40" : "",
                            isSelected ? "bg-primary/5" : "",
                          ].join(" ")}
                          onClick={() => setSelectedVoucher(isSelected ? null : v)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${isSelected ? "rotate-90" : ""}`} />
                              <span className="font-mono text-xs font-semibold">{v.code}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${isThu ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {isThu ? "Thu" : "Chi"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                              {v.fund_type === "tien_mat" ? <Wallet className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5 text-blue-500" />}
                              {v.fund_type === "tien_mat" ? "Tiền mặt" : (() => {
                                const ba = getBankAccountInfo(v);
                                return ba ? `${ba.bank} ••${ba.account_number.slice(-4)}` : "Ngân hàng";
                              })()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">{staffName || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-3 text-xs">{customerName || <span className="text-muted-foreground">—</span>}</td>
                          {canViewAll && <td className="px-4 py-3 text-xs text-muted-foreground">{getBranchName(v.branch_id)}</td>}
                          <td className={`px-4 py-3 text-right font-bold tabular-nums ${isThu ? "text-green-600" : "text-red-600"}`}>
                            {isThu ? "+" : "-"}{moneyFmt(v.amount)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isActive && (
                              <div className="flex items-center justify-center gap-1">
                                {canEditVoucher && (
                                  <button type="button" title="Sửa" onClick={(e) => { e.stopPropagation(); openEditDialog(v); }}
                                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canEditVoucher && (
                                  <button type="button" title="Hủy phiếu" onClick={(e) => { e.stopPropagation(); setSelectedVoucher(v); setOpenCancel(true); }}
                                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {!canEditVoucher && (
                                  <span className="text-xs text-muted-foreground/50 px-1" title="Chỉ người tạo mới được sửa">🔒</span>
                                )}
                              </div>
                            )}
                            {!isActive && <XCircle className="h-4 w-4 text-red-400 mx-auto" />}
                          </td>
                        </tr>
                        {/* Inline expand row */}
                        {isSelected && (
                          <tr key={`${v.id}-detail`} className="bg-muted/10">
                            <td colSpan={canViewAll ? 9 : 8} className="px-6 py-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground font-medium">Loại thu/chi</div>
                                  <div>{getTypeName(v.voucher_type_id)}</div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground font-medium">Chi nhánh</div>
                                  <div>{getBranchName(v.branch_id)}</div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground font-medium">Người tạo</div>
                                  <div>{getUserName(v.created_by) || "—"}</div>
                                </div>
                                {v.fund_type === "ngan_hang" && (() => {
                                  const ba = getBankAccountInfo(v);
                                  return ba ? (
                                    <div className="col-span-2 sm:col-span-4 space-y-0.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                      <div className="flex items-center gap-1 text-blue-700 font-semibold"><Landmark className="h-3 w-3" />{ba.bank}</div>
                                      <div className="text-blue-800">STK: <span className="font-mono font-bold tracking-wide">{ba.account_number}</span></div>
                                      <div className="text-blue-700">Chủ TK: {ba.account_name}</div>
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      <div className="text-muted-foreground font-medium">Hình thức</div>
                                      <div className="flex items-center gap-1 text-blue-700">
                                        <Landmark className="h-3 w-3" />Chuyển khoản NH
                                      </div>
                                    </div>
                                  );
                                })()}
                                {v.note && (() => {
                                  const displayNote = v.fund_type === "ngan_hang" ? v.note.split(" — ").slice(1).join(" — ") : v.note;
                                  return displayNote ? (
                                    <div className="col-span-2 sm:col-span-4 space-y-0.5">
                                      <div className="text-muted-foreground font-medium">Ghi chú</div>
                                      <div className="text-foreground">{displayNote}</div>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
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
          <VoucherForm
            kind={createKind}
            f={form}
            setF={setForm}
            voucherTypes={voucherTypes}
            staffOptions={staffOptions}
            customerOptions={customerOptions}
            isAdmin={isAdmin}
            siteSettings={siteSettings}
            visibleBranches={visibleBranches}
          />
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
            siteSettings={siteSettings}
            visibleBranches={visibleBranches}
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
            <Button variant="outline" onClick={() => setOpenCancel(false)}>Không</Button>
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
              <Button onClick={handleAddType} disabled={addingType || !newTypeName.trim()}>
                {addingType ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang thêm...</> : "Thêm"}
              </Button>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(["thu", "chi"] as const).map((kind) => (
                <div key={kind}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-1.5 px-1">
                    {kind === "thu" ? "Loại thu" : "Loại chi"}
                  </div>
                  {voucherTypes.filter((t: any) => t.kind === kind).length === 0 && (
                    <div className="text-xs text-muted-foreground px-1 pb-1 italic">Chưa có loại nào</div>
                  )}
                  {voucherTypes.filter((t: any) => t.kind === kind).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50">
                      <span className="text-sm">{t.name}</span>
                      <button type="button"
                        disabled={deletingTypeId === t.id}
                        onClick={() => handleDeleteType(t.id)}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50">
                        {deletingTypeId === t.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTypes(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
