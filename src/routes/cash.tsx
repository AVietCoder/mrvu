import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listCash,
  createCashVoucher,
  updateCashVoucher,
  cancelCashVoucher,
  upsertCashVoucherType,
  deleteCashVoucherType,
} from "@/lib/cash.functions";
import { AppShell, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, X, Wallet, Landmark, ChevronRight, Search, FileDown,
  CheckCircle2, XCircle, Pencil, Trash2, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/cash")({
  head: () => ({ meta: [{ title: "Sổ quỹ — QuatTran POS" }] }),
  component: Page,
});

// ─── helpers ─────────────────────────────────────────────────────────────────
function moneyFmt(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n));
}
function fmtInput(v: string) {
  const n = v.replace(/\D/g, "");
  if (!n) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(n));
}
function parseInput(v: string) {
  return Number(v.replace(/\D/g, "")) || 0;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const FUND_TABS = [
  { id: "tien_mat", label: "Tiền mặt", icon: Wallet },
  { id: "ngan_hang", label: "Ngân hàng", icon: Landmark },
  { id: "all", label: "Tổng quỹ", icon: null },
] as const;

type FundTab = "tien_mat" | "ngan_hang" | "all";

// ─── Page ─────────────────────────────────────────────────────────────────────
function Page() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listCash);
  const createFn = useServerFn(createCashVoucher);
  const updateFn = useServerFn(updateCashVoucher);
  const cancelFn = useServerFn(cancelCashVoucher);
  const upsertTypeFn = useServerFn(upsertCashVoucherType);
  const deleteTypeFn = useServerFn(deleteCashVoucherType);

  const { data, isLoading } = useQuery({ queryKey: ["cash"], queryFn: () => listFn() });

  const [fund, setFund] = useState<FundTab>("tien_mat");
  const [filterBranch, setFilterBranch] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"" | "thu" | "chi">("");
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null);

  // Dialog states
  const [openCreate, setOpenCreate] = useState(false);
  const [createKind, setCreateKind] = useState<"thu" | "chi">("thu");
  const [openEdit, setOpenEdit] = useState(false);
  const [openTypes, setOpenTypes] = useState(false);
  const [openCancel, setOpenCancel] = useState(false);

  // Create form
  const [cAmount, setCAmount] = useState("");
  const [cVoucherTypeId, setCVoucherTypeId] = useState("");
  const [cPayerReceiver, setCPayerReceiver] = useState("");
  const [cNote, setCNote] = useState("");
  const [cAccounting, setCAccounting] = useState(true);
  const [cBranch, setCBranch] = useState("");
  const [cFund, setCFund] = useState<"tien_mat" | "ngan_hang">("tien_mat");
  const [saving, setSaving] = useState(false);

  // Edit form
  const [eAmount, setEAmount] = useState("");
  const [eVoucherTypeId, setEVoucherTypeId] = useState("");
  const [ePayerReceiver, setEPayerReceiver] = useState("");
  const [eNote, setENoteState] = useState("");
  const [eAccounting, setEAccounting] = useState(true);

  // Type manager
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeKind, setNewTypeKind] = useState<"thu" | "chi">("thu");

  const vouchers = data?.vouchers ?? [];
  const branches = data?.branches ?? [];
  const users = data?.users ?? [];
  const voucherTypes = data?.voucherTypes ?? [];

  // ─── computed stats ──────────────────────────────────────────────────────
  function stats(fundType: "tien_mat" | "ngan_hang" | null, branchId: string) {
    const list = vouchers.filter((v: any) =>
      v.status === "active" &&
      (fundType ? v.fund_type === fundType : true) &&
      (branchId ? v.branch_id === branchId : true),
    );
    const thu = list.filter((v: any) => v.type === "thu").reduce((s: number, v: any) => s + v.amount, 0);
    const chi = list.filter((v: any) => v.type === "chi").reduce((s: number, v: any) => s + v.amount, 0);
    return { thu, chi, ton: thu - chi };
  }

  const currentFund = fund === "all" ? null : fund;
  const branchStats = stats(currentFund, filterBranch);

  // ─── filtered list ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return vouchers.filter((v: any) => {
      const matchFund = fund === "all" || v.fund_type === fund;
      const matchBranch = !filterBranch || v.branch_id === filterBranch;
      const matchType = !filterType || v.type === filterType;
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        v.code?.toLowerCase().includes(q) ||
        v.payer_receiver?.toLowerCase().includes(q) ||
        v.note?.toLowerCase().includes(q);
      return matchFund && matchBranch && matchType && matchSearch;
    });
  }, [vouchers, fund, filterBranch, filterType, search]);

  // ─── actions ─────────────────────────────────────────────────────────────
  function openCreateDialog(kind: "thu" | "chi") {
    setCreateKind(kind);
    setCAmount("");
    setCVoucherTypeId("");
    setCPayerReceiver("");
    setCNote("");
    setCAccounting(true);
    setCBranch(branches[0]?.id ?? "");
    setCFund(fund === "all" ? "tien_mat" : fund as any);
    setOpenCreate(true);
  }

  async function handleCreate() {
    if (!parseInput(cAmount)) return toast.error("Nhập số tiền");
    setSaving(true);
    try {
      await createFn({
        data: {
          type: createKind,
          fund_type: cFund,
          branch_id: cBranch,
          amount: parseInput(cAmount),
          voucher_type_id: cVoucherTypeId || null,
          payer_receiver: cPayerReceiver || null,
          note: cNote || null,
          accounting: cAccounting,
          created_by: user?.id ?? null,
        },
      });
      toast.success(`Tạo phiếu ${createKind === "thu" ? "thu" : "chi"} thành công`);
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenCreate(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openEditDialog(v: any) {
    setSelectedVoucher(v);
    setEAmount(moneyFmt(v.amount));
    setEVoucherTypeId(v.voucher_type_id ?? "");
    setEPayerReceiver(v.payer_receiver ?? "");
    setENoteState(v.note ?? "");
    setEAccounting(v.accounting ?? true);
    setOpenEdit(true);
  }

  async function handleEdit() {
    if (!parseInput(eAmount)) return toast.error("Nhập số tiền");
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: selectedVoucher.id,
          amount: parseInput(eAmount),
          voucher_type_id: eVoucherTypeId || null,
          payer_receiver: ePayerReceiver || null,
          note: eNote || null,
          accounting: eAccounting,
        },
      });
      toast.success("Cập nhật phiếu thành công");
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenEdit(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setSaving(true);
    try {
      await cancelFn({ data: { id: selectedVoucher.id } });
      toast.success("Đã hủy phiếu");
      qc.invalidateQueries({ queryKey: ["cash"] });
      setOpenCancel(false);
      setSelectedVoucher(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddType() {
    if (!newTypeName.trim()) return;
    try {
      await upsertTypeFn({ data: { name: newTypeName.trim(), kind: newTypeKind } });
      setNewTypeName("");
      qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success("Đã thêm loại thu/chi");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleDeleteType(id: string) {
    try {
      await deleteTypeFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["cash"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  // ─── voucher form fields (shared for create/edit) ─────────────────────────
  function VoucherFields({
    kind, amount, setAmount, voucherTypeId, setVoucherTypeId,
    payerReceiver, setPayerReceiver, note, setNote,
    accounting, setAccounting,
  }: any) {
    const typeOptions = voucherTypes.filter((t: any) => t.kind === kind);
    return (
      <div className="space-y-3">
        <div>
          <Label>Số tiền *</Label>
          <Input
            className="mt-1"
            value={amount}
            onChange={(e) => setAmount(fmtInput(e.target.value))}
            onFocus={(e) => e.target.select()}
            placeholder="0"
          />
        </div>
        <div>
          <Label>Loại {kind === "thu" ? "thu" : "chi"}</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={voucherTypeId}
            onChange={(e) => setVoucherTypeId(e.target.value)}
          >
            <option value="">-- Chọn loại --</option>
            {typeOptions.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Người {kind === "thu" ? "nộp" : "nhận"}</Label>
          <Input
            className="mt-1"
            value={payerReceiver}
            onChange={(e) => setPayerReceiver(e.target.value)}
            placeholder="Họ tên / số điện thoại"
          />
        </div>
        <div>
          <Label>Ghi chú</Label>
          <Input
            className="mt-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú thêm..."
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="accounting"
            checked={accounting}
            onChange={(e) => setAccounting(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          <label htmlFor="accounting" className="text-sm cursor-pointer">
            Hạch toán vào kết quả kinh doanh
          </label>
        </div>
      </div>
    );
  }

  const branchName = (id: string) => branches.find((b: any) => b.id === id)?.name ?? "—";
  const userName = (id: string) => users.find((u: any) => u.id === id)?.full_name ?? "—";
  const typeName = (id: string) => voucherTypes.find((t: any) => t.id === id)?.name ?? "—";

  // ─── render ──────────────────────────────────────────────────────────────
  return (
    <AppShell title="Sổ quỹ">
      <div className="space-y-4">
        {/* Header actions */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2">
            <Button onClick={() => openCreateDialog("thu")} className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4 mr-1" />Phiếu thu
            </Button>
            <Button onClick={() => openCreateDialog("chi")} variant="destructive">
              <Plus className="h-4 w-4 mr-1" />Phiếu chi
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpenTypes(true)}>
              <Settings2 className="h-4 w-4 mr-1" />Loại thu/chi
            </Button>
          </div>
        </div>

        {/* Fund tabs */}
        <div className="flex gap-1 border-b">
          {FUND_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setFund(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors
                  ${fund === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Chi nhánh</div>
            <select
              className="w-full text-sm bg-transparent outline-none"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
            >
              <option value="">Tất cả</option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tổng thu</div>
            <div className="font-semibold text-green-600">{moneyFmt(branchStats.thu)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tổng chi</div>
            <div className="font-semibold text-red-600">-{moneyFmt(branchStats.chi)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tồn quỹ</div>
            <div className={`font-semibold ${branchStats.ton >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {moneyFmt(branchStats.ton)}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9 w-56"
              placeholder="Tìm mã phiếu, người..."
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

        {/* Table */}
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Mã phiếu</th>
                  <th className="px-3 py-2 text-left font-medium">Thời gian</th>
                  <th className="px-3 py-2 text-left font-medium">Loại</th>
                  <th className="px-3 py-2 text-left font-medium">Quỹ</th>
                  <th className="px-3 py-2 text-left font-medium">Người nộp/nhận</th>
                  <th className="px-3 py-2 text-left font-medium">Chi nhánh</th>
                  <th className="px-3 py-2 text-left font-medium">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-medium">Giá trị</th>
                  <th className="px-3 py-2 text-center font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading && (
                  <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Đang tải...</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Chưa có phiếu nào</td></tr>
                )}
                {filtered.map((v: any) => {
                  const isActive = v.status === "active";
                  const isThu = v.type === "thu";
                  return (
                    <tr
                      key={v.id}
                      className={`hover:bg-muted/30 cursor-pointer ${!isActive ? "opacity-50" : ""}`}
                      onClick={() => setSelectedVoucher(selectedVoucher?.id === v.id ? null : v)}
                    >
                      <td className="px-3 py-2.5 font-mono font-medium">{v.code}</td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(v.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                          ${isThu ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {isThu ? "Thu" : "Chi"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {v.fund_type === "tien_mat" ? "Tiền mặt" : "Ngân hàng"}
                      </td>
                      <td className="px-3 py-2.5">{v.payer_receiver || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{branchName(v.branch_id)}</td>
                      <td className="px-3 py-2.5">
                        {isActive ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" />Đã lưu
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-500">
                            <XCircle className="h-3.5 w-3.5" />Đã hủy
                          </span>
                        )}
                        {isActive && !v.accounting && (
                          <span className="text-xs text-amber-600 block">Không hạch toán</span>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums
                        ${isThu ? "text-green-600" : "text-red-600"}`}>
                        {isThu ? "+" : "-"}{moneyFmt(v.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {isActive && (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openEditDialog(v); }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Sửa"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelectedVoucher(v); setOpenCancel(true); }}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Hủy"
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

        {/* Detail panel */}
        {selectedVoucher && !openEdit && !openCancel && (
          <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">
                Chi tiết phiếu: <span className="font-mono">{selectedVoucher.code}</span>
              </div>
              <button onClick={() => setSelectedVoucher(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground">Loại phiếu:</span> {selectedVoucher.type === "thu" ? "Phiếu thu" : "Phiếu chi"}</div>
              <div><span className="text-muted-foreground">Quỹ:</span> {selectedVoucher.fund_type === "tien_mat" ? "Tiền mặt" : "Ngân hàng"}</div>
              <div><span className="text-muted-foreground">Số tiền:</span> <strong>{moneyFmt(selectedVoucher.amount)}</strong></div>
              <div><span className="text-muted-foreground">Loại thu/chi:</span> {selectedVoucher.voucher_type_id ? typeName(selectedVoucher.voucher_type_id) : "—"}</div>
              <div><span className="text-muted-foreground">Người nộp/nhận:</span> {selectedVoucher.payer_receiver || "—"}</div>
              <div><span className="text-muted-foreground">Chi nhánh:</span> {branchName(selectedVoucher.branch_id)}</div>
              <div><span className="text-muted-foreground">Người tạo:</span> {userName(selectedVoucher.created_by)}</div>
              <div><span className="text-muted-foreground">Thời gian:</span> {fmtDate(selectedVoucher.created_at)}</div>
              <div><span className="text-muted-foreground">Hạch toán:</span> {selectedVoucher.accounting ? "Có" : "Không"}</div>
              {selectedVoucher.note && (
                <div className="col-span-2 sm:col-span-3"><span className="text-muted-foreground">Ghi chú:</span> {selectedVoucher.note}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Create dialog ───────────────────────────────────────────────── */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createKind === "thu" ? "Tạo phiếu thu" : "Tạo phiếu chi"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quỹ</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={cFund}
                  onChange={(e) => setCFund(e.target.value as any)}
                >
                  <option value="tien_mat">Tiền mặt</option>
                  <option value="ngan_hang">Ngân hàng</option>
                </select>
              </div>
              <div>
                <Label>Chi nhánh</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={cBranch}
                  onChange={(e) => setCBranch(e.target.value)}
                >
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <VoucherFields
              kind={createKind}
              amount={cAmount} setAmount={setCAmount}
              voucherTypeId={cVoucherTypeId} setVoucherTypeId={setCVoucherTypeId}
              payerReceiver={cPayerReceiver} setPayerReceiver={setCPayerReceiver}
              note={cNote} setNote={setCNote}
              accounting={cAccounting} setAccounting={setCAccounting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Hủy</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu phiếu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit dialog ─────────────────────────────────────────────────── */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa phiếu {selectedVoucher?.code}</DialogTitle>
          </DialogHeader>
          <VoucherFields
            kind={selectedVoucher?.type ?? "thu"}
            amount={eAmount} setAmount={setEAmount}
            voucherTypeId={eVoucherTypeId} setVoucherTypeId={setEVoucherTypeId}
            payerReceiver={ePayerReceiver} setPayerReceiver={setEPayerReceiver}
            note={eNote} setNote={setENoteState}
            accounting={eAccounting} setAccounting={setEAccounting}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)}>Hủy</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? "Đang lưu..." : "Cập nhật"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Cancel confirm ──────────────────────────────────────────────── */}
      <Dialog open={openCancel} onOpenChange={setOpenCancel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hủy phiếu?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bạn có chắc muốn hủy phiếu <strong>{selectedVoucher?.code}</strong>? Thao tác này không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCancel(false)}>Không</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={saving}>
              {saving ? "Đang hủy..." : "Hủy phiếu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Voucher type manager ─────────────────────────────────────────── */}
      <Dialog open={openTypes} onOpenChange={setOpenTypes}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quản lý loại thu/chi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
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
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {["thu", "chi"].map((kind) => (
                <div key={kind}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-1.5 px-1">
                    {kind === "thu" ? "Loại thu" : "Loại chi"}
                  </div>
                  {voucherTypes.filter((t: any) => t.kind === kind).length === 0 && (
                    <div className="text-xs text-muted-foreground px-1 pb-1">Chưa có loại nào</div>
                  )}
                  {voucherTypes
                    .filter((t: any) => t.kind === kind)
                    .map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50">
                        <span className="text-sm">{t.name}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteType(t.id)}
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
            <Button variant="outline" onClick={() => setOpenTypes(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
