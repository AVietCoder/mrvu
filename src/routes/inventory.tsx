// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import {
  searchInventoryPage,
  getInventoryRefs,
  getStockExport,
  createMovement,
  createTransfer,
  confirmTransfer,
  cancelTransfer,
  updateTransferItems,
  adjustStockDirect,
} from "@/lib/inventory.functions";

import { SearchableSelect } from "@/components/SearchableSelect";
import { AppShell, Card } from "@/components/AppShell";
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
} from "@/components/ui/dialog";

import {
  ArrowDownToLine,
  Repeat,
  Plus,
  Trash2,
  FileText,
  ShieldOff,
  CheckCircle2,
  XCircle,
  Printer,
  History,
  ChevronDown,
  ChevronUp,
  Package2,
  ShoppingCart,
  Loader2,
  Pencil,
  Check,
  X,
} from "lucide-react";

import { toast } from "sonner";
import { hasPermission } from "@/lib/types";
import { getSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [{ title: "Tồn kho — Mr.Vũ" }],
  }),
  component: Page,
});

type MovementItem = {
  product_id: string;
  qty: number;
  unit_cost: number;
};

type TransferItem = {
  product_id: string;
  qty: number;
};

const moneyFormatter = new Intl.NumberFormat("vi-VN");

function formatMoney(v: number) {
  return moneyFormatter.format(Number(v || 0));
}

function parseDigits(v: string) {
  const n = Number(v.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function createMovementItem(
  product_id = "",
  qty = 1,
  unit_cost = 0
): MovementItem {
  return {
    product_id,
    qty,
    unit_cost,
  };
}

function createTransferItem(
  product_id = "",
  qty = 1
): TransferItem {
  return {
    product_id,
    qty,
  };
}

function Page() {
  const { user, isAdmin, activeBranchId } = useAuth();

  const refsFn = useServerFn(getInventoryRefs);
  const invFn = useServerFn(searchInventoryPage);
  const exportFn = useServerFn(getStockExport);
  const move = useServerFn(createMovement);
  const createTrf = useServerFn(createTransfer);
  const confirmTrf = useServerFn(confirmTransfer);
  const cancelTrf = useServerFn(cancelTransfer);
  const updateTrfItems = useServerFn(updateTransferItems);
  const getSettingsFn = useServerFn(getSettings);
  const adjustStockFn = useServerFn(adjustStockDirect);

  const qc = useQueryClient();

  // Dữ liệu phụ trợ: chi nhánh, sản phẩm (gọn) cho phiếu nhập/chuyển, lịch sử
  // nhập-xuất, phiếu chuyển đang chờ. KHÔNG còn tải toàn bộ stock + toàn bộ đơn.
  const { data } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => refsFn(),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const { data: siteSettings } = useQuery({
    queryKey: ["site_settings"],
    queryFn: () => getSettingsFn(),
  });

  const canIn =
    !!user &&
    (isAdmin || hasPermission(user, "stock_in"));

  const canOut =
    !!user &&
    (isAdmin || hasPermission(user, "stock_out"));

  const canTransfer =
    !!user &&
    (isAdmin || hasPermission(user, "stock_transfer"));

  const [type, setType] = useState<
    "in" | "transfer"
  >("in");

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");
  // ⚡ Debounce ô tìm kiếm tồn kho: lọc lại sau khi ngừng gõ → mượt hơn khi
  // danh mục sản phẩm lớn.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);

  const [filterBranch, setFilterBranch] =
    useState(() => activeBranchId ?? user?.branch_ids?.[0] ?? "");

  const [sortBy, setSortBy] =
    useState("name");

  const [stockBy, setStockBy] =
    useState("stock_desc");

  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});

  // ── Admin inline stock edit ───────────────────────────────────────────
  // editingStock[productId__branchId] = current edit value string
  const [editingStock, setEditingStock] = useState<Record<string, string>>({});
  // savingStock[productId__branchId] = true khi đang gửi request
  const [savingStock, setSavingStock] = useState<Record<string, boolean>>({});

  function stockEditKey(productId: string, branchId: string) {
    return `${productId}__${branchId}`;
  }

  function startEditStock(productId: string, branchId: string, currentQty: number) {
    setEditingStock((prev) => ({
      ...prev,
      [stockEditKey(productId, branchId)]: String(currentQty),
    }));
  }

  function cancelEditStock(productId: string, branchId: string) {
    setEditingStock((prev) => {
      const next = { ...prev };
      delete next[stockEditKey(productId, branchId)];
      return next;
    });
  }

  async function saveEditStock(productId: string, branchId: string) {
    const key = stockEditKey(productId, branchId);
    const raw = editingStock[key];
    if (raw === undefined) return;
    const newQty = Math.max(0, parseInt(raw.replace(/\D/g, "") || "0", 10));
    setSavingStock((prev) => ({ ...prev, [key]: true }));
    try {
      await adjustStockFn({
        data: {
          product_id: productId,
          branch_id: branchId,
          new_qty: newQty,
          actor_id: user?.id,
        },
      });
      toast.success(`Đã cập nhật tồn kho`);
      cancelEditStock(productId, branchId);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Có lỗi xảy ra");
    } finally {
      setSavingStock((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // ✅ Bảng tồn kho theo TRANG từ server (RPC search_inventory_page): tìm kiếm,
  //    lọc chi nhánh, sort, tính tồn + đơn chờ đều ở Postgres. Mỗi lần ~20 dòng
  //    kèm sẵn chi tiết theo chi nhánh (JSON). placeholderData giữ trang cũ.
  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ["inventory", "page", page, debouncedSearch, sortBy, filterBranch],
    queryFn: () =>
      invFn({
        data: {
          page,
          pageSize: DEFAULT_PAGE_SIZE,
          search: debouncedSearch,
          branch: filterBranch,
          sort: sortBy,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const [voucherNote, setVoucherNote] =
    useState("");

  // ── KiotViet-style transfer detail dialog ────────────────────────────
  const [trfDetailOpen, setTrfDetailOpen] = useState(false);
  const [trfDetailId, setTrfDetailId] = useState<string | null>(null);
  const [trfEditItems, setTrfEditItems] = useState<TransferItem[]>([]);
  const [trfSaving, setTrfSaving] = useState(false);

  const [inBranch, setInBranch] =
    useState("");

  const [inItems, setInItems] =
    useState<MovementItem[]>([
      createMovementItem(),
    ]);

  const [outBranch, setOutBranch] =
    useState("");

  const [outItems, setOutItems] =
    useState<MovementItem[]>([
      createMovementItem(),
    ]);

  const [transferFrom, setTransferFrom] =
    useState(() => activeBranchId ?? "");  // ✅ mặc định = CN đăng nhập

  const [transferTo, setTransferTo] =
    useState("");

  const [transferItems, setTransferItems] =
    useState<TransferItem[]>([
      createTransferItem(),
    ]);

  const products = data?.products ?? [];
  const branches = data?.branches ?? [];
  // allowedBranches = CN được phân quyền thao tác (nhập/xuất/chuyển)
  const allowedBranchIds = useMemo(() => {
    if (isAdmin) return branches.map((b: any) => b.id);
    return user?.branch_ids?.length ? [...user.branch_ids] : [];
  }, [branches, isAdmin, user?.branch_ids]);

  const allowedBranches = useMemo(() => {
    if (isAdmin) return branches;
    const allowedSet = new Set(allowedBranchIds);
    return branches.filter((b: any) => allowedSet.has(b.id));
  }, [branches, isAdmin, allowedBranchIds]);

  const allowedBranchSet = useMemo(
    () => new Set(allowedBranchIds),
    [allowedBranchIds]
  );

  // ✅ allBranches = tất cả CN để hiển thị trong filter (nhân viên xem full)
  const allBranches = branches;

  // (Đơn chờ & tồn theo chi nhánh giờ do RPC trả kèm mỗi dòng — không dựng map ở client.)

  const pendingTransfers = useMemo(() => {
    const transfers = (data?.transfers ?? []) as any[];
    const base = transfers.filter((t: any) => t.status === "pending");

    if (isAdmin) return base;

    return base.filter((t: any) =>
      allowedBranchSet.has(t.from_branch) || allowedBranchSet.has(t.to_branch)
    );
  }, [data?.transfers, isAdmin, allowedBranchSet]);

  const historyMovements = useMemo(() => {
    const movements = (data?.movements ?? []) as any[];

    if (isAdmin) return movements;

    return movements.filter((m: any) => {
      const fromOk = m.from_branch ? allowedBranchSet.has(m.from_branch) : false;
      const toOk = m.to_branch ? allowedBranchSet.has(m.to_branch) : false;
      return fromOk || toOk;
    });
  }, [data?.movements, isAdmin, allowedBranchSet]);

  // ── Bộ lọc lịch sử kho ───────────────────────────────────────────────
  const [histFilterType, setHistFilterType] = useState<"" | "in" | "transfer">("");
  const [histFilterProduct, setHistFilterProduct] = useState("");
  const [histFilterFrom, setHistFilterFrom] = useState("");
  const [histFilterTo, setHistFilterTo] = useState("");

  const filteredHistoryMovements = useMemo(() => {
    return historyMovements.filter((m: any) => {
      if (histFilterType && m.type !== histFilterType) return false;
      if (histFilterProduct && m.product_id !== histFilterProduct) return false;
      if (histFilterFrom) {
        const mDate = new Date(m.created_at);
        const fromDate = new Date(histFilterFrom);
        if (mDate < fromDate) return false;
      }
      if (histFilterTo) {
        const mDate = new Date(m.created_at);
        const toDate = new Date(histFilterTo);
        toDate.setHours(23, 59, 59, 999);
        if (mDate > toDate) return false;
      }
      return true;
    });
  }, [historyMovements, histFilterType, histFilterProduct, histFilterFrom, histFilterTo]);

  function startAction(
    t: "in" | "transfer"
  ) {
    if (t === "in" && !canIn)
      return toast.error(
        "Bạn không có quyền nhập kho"
      );

    if (t === "transfer" && !canTransfer)
      return toast.error(
        "Bạn không có quyền chuyển kho"
      );

    if (!products.length) {
      return toast.error("Chưa có sản phẩm để thao tác");
    }

    if (!allowedBranches.length) {
      return toast.error(
        "Bạn chưa được phân quyền chi nhánh để thao tác kho"
      );
    }

    setType(t);

    const p0 = products[0]?.id ?? "";
    const b0 = allowedBranches[0]?.id ?? "";
    const b1 = allowedBranches[1]?.id ?? allowedBranches[0]?.id ?? "";

    setVoucherNote("");

    setInBranch(b0);
    setInItems([
      createMovementItem(p0, 1, 0),
    ]);

    setOutBranch(b0);
    setOutItems([
      createMovementItem(p0, 1, 0),
    ]);

    setTransferFrom(activeBranchId ?? b0);  // ✅ mặc định = CN đang đăng nhập
    setTransferTo(b1 !== (activeBranchId ?? b0) ? b1 : "");

    setTransferItems([
      createTransferItem(p0, 1),
    ]);

    setOpen(true);
  }

  function buildNote() {
    return voucherNote.trim();
  }

  function isBranchAllowed(branchId: string) {
    return isAdmin || allowedBranchSet.has(branchId);
  }

  const validInItems = inItems.filter(
    (i) => i.product_id && i.qty > 0
  );

  const validOutItems = outItems.filter(
    (i) => i.product_id && i.qty > 0
  );

  const validTransferItems =
    transferItems.filter(
      (i) => i.product_id && i.qty > 0
    );

  const activeItems =
    type === "in"
      ? validInItems
      : type === "out"
        ? validOutItems
        : validTransferItems;

  const totalQty = activeItems.reduce(
    (s, i: any) => s + Number(i.qty || 0),
    0
  );

  const totalMoney = useMemo(() => {
    if (type === "transfer") return 0;

    return (
      activeItems as MovementItem[]
    ).reduce(
      (sum, item) =>
        sum +
        Number(item.qty || 0) *
          Number(item.unit_cost || 0),
      0
    );
  }, [activeItems, type]);

  async function submitIn() {
    if (!validInItems.length)
      return toast.error(
        "Vui lòng chọn sản phẩm"
      );

    if (!inBranch || !isBranchAllowed(inBranch))
      return toast.error(
        "Chi nhánh nhập không hợp lệ"
      );

    try {
      await Promise.all(
        validInItems.map((item) =>
          move({
            data: {
              type: "in",
              product_id: item.product_id,
              branch_id: inBranch,
              qty: item.qty,
              unit_cost:
                item.unit_cost || undefined,
              note:
                buildNote() || undefined,
              created_by: user?.id,
            },
          })
        )
      );

      toast.success(
        `Đã nhập ${validInItems.length} mặt hàng`
      );

      setOpen(false);
      setInItems([createMovementItem()]);
      setVoucherNote("");

      qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    } catch (e: any) {
      toast.error(
        e?.message ?? "Có lỗi xảy ra"
      );
    }
  }

  async function submitOut() {
    if (!validOutItems.length)
      return toast.error(
        "Vui lòng chọn sản phẩm"
      );

    if (!outBranch || !isBranchAllowed(outBranch))
      return toast.error(
        "Chi nhánh xuất không hợp lệ"
      );

    try {
      await Promise.all(
        validOutItems.map((item) =>
          move({
            data: {
              type: "out",
              product_id: item.product_id,
              branch_id: outBranch,
              qty: item.qty,
              unit_cost:
                item.unit_cost || undefined,
              note:
                buildNote() || undefined,
              created_by: user?.id,
            },
          })
        )
      );

      toast.success(
        `Đã xuất ${validOutItems.length} mặt hàng`
      );

      setOpen(false);
      setOutItems([createMovementItem()]);
      setVoucherNote("");

      qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    } catch (e: any) {
      toast.error(
        e?.message ?? "Có lỗi xảy ra"
      );
    }
  }

  async function submitTransfer() {
    if (!validTransferItems.length)
      return toast.error(
        "Vui lòng chọn sản phẩm"
      );

    if (!transferFrom || !transferTo)
      return toast.error(
        "Vui lòng chọn đủ chi nhánh nguồn và đích"
      );

    // ✅ Chỉ cần kho nguồn thuộc quyền của user; kho đích có thể là bất kỳ CN
    if (!isAdmin && !isBranchAllowed(transferFrom))
      return toast.error("Bạn không có quyền chuyển từ chi nhánh này");

    if (transferFrom === transferTo)
      return toast.error("Chi nhánh nguồn và đích không được giống nhau");

    try {
      await createTrf({
        data: {
          from_branch: transferFrom,
          to_branch: transferTo,
          items: validTransferItems,
          note:
            buildNote() || undefined,
          created_by: user?.id,
        },
      });

      toast.success(
        "Đã tạo phiếu chuyển kho"
      );

      setOpen(false);
      setTransferFrom(activeBranchId ?? "");  // ✅ giữ CN nguồn mặc định
      setTransferTo("");
      setTransferItems([createTransferItem()]);
      setVoucherNote("");

      qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    } catch (e: any) {
      toast.error(
        e?.message ?? "Có lỗi xảy ra"
      );
    }
  }

  // Mở dialog chi tiết phiếu chuyển kho
  function openTransferDetail(transfer: any) {
    const items = ((data?.transfer_items ?? []) as any[])
      .filter((i: any) => i.transfer_id === transfer.id)
      .map((i: any) => ({ product_id: i.product_id, qty: i.qty }));
    setTrfDetailId(transfer.id);
    setTrfEditItems(items.length ? items : [createTransferItem()]);
    setTrfDetailOpen(true);
  }

  async function handleTrfConfirm() {
    if (!trfDetailId) return;
    setTrfSaving(true);
    try {
      const valid = trfEditItems.filter((i) => i.product_id && i.qty > 0);
      if (!valid.length) return toast.error("Cần ít nhất 1 sản phẩm hợp lệ");
      // Cập nhật SL trước nếu có thay đổi
      await updateTrfItems({ data: { transfer_id: trfDetailId, items: valid } });
      // Xác nhận phiếu
      await confirmTrf({ data: { transfer_id: trfDetailId } });
      toast.success("Đã hoàn thành phiếu chuyển kho");
      setTrfDetailOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Có lỗi xảy ra");
    } finally {
      setTrfSaving(false);
    }
  }

  async function handleTrfCancel() {
    if (!trfDetailId) return;
    if (!confirm("Hủy phiếu chuyển kho này?")) return;
    setTrfSaving(true);
    try {
      await cancelTrf({ data: { transfer_id: trfDetailId } });
      toast.success("Đã hủy phiếu");
      setTrfDetailOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Có lỗi xảy ra");
    } finally {
      setTrfSaving(false);
    }
  }

  function exportTransferTxt() {
    const lines = validTransferItems.map(
      (item) => {
        const p = products.find(
          (x) => x.id === item.product_id
        );

        return `- ${p?.name}: ${item.qty}`;
      }
    );

    const content = [
      "PHIẾU CHUYỂN KHO",
      "",
      ...lines,
    ].join("\n");

    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8",
    });

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement("a");

    a.href = url;

    a.download = `transfer-${Date.now()}.txt`;

    a.click();

    URL.revokeObjectURL(url);

    toast.success(
      "Đã xuất phiếu chuyển"
    );
  }

  // ✅ visibleBranches = tất cả CN (kể cả nhân viên được xem full tồn kho)
  // allowedBranches chỉ dùng để kiểm tra quyền THAO TÁC (nhập/xuất/chuyển)
  const visibleBranches = filterBranch
    ? branches.filter((b: any) => b.id === filterBranch)
    : branches;

  // Dòng hiển thị lấy thẳng từ server (đã lọc/sort/phân trang).
  const paginatedProducts = inventoryData?.products ?? [];
  const totalFiltered = inventoryData?.meta?.totalFiltered ?? 0;

  // Dựng lại branchStatsMap từ JSON "branches" mà RPC trả về cho từng dòng.
  const branchStatsMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        branchId: string;
        branchName: string;
        stock: number;
        pendingQty: number;
        pendingOrders: number;
      }>
    >();
    for (const row of paginatedProducts as any[]) {
      map.set(
        row.id,
        ((row.branches ?? []) as any[]).map((b) => ({
          branchId: b.branch_id,
          branchName: b.branch_name,
          stock: Number(b.stock || 0),
          pendingQty: Number(b.pending_qty || 0),
          pendingOrders: Number(b.pending_orders || 0),
        })),
      );
    }
    return map;
  }, [paginatedProducts]);

  const voucherTitle =
    type === "in"
      ? "Phiếu nhập hàng"
      : "Phiếu chuyển kho";

  // Xuất CSV danh sách tồn kho > 0 theo từng chi nhánh
  async function exportStockExcel() {
    const branchesList = allowedBranches;
    // Tải toàn bộ tồn kho CHỈ tại thời điểm bấm xuất (không tải lúc vào trang).
    const { products: productsList, stock: stockList } = await exportFn();

    const rows: string[][] = [];
    rows.push(["STT", "Mã SP", "Tên sản phẩm", ...branchesList.map((b: any) => b.name), "Tổng tồn"]);

    let stt = 1;
    for (const p of productsList) {
      const branchQtys = branchesList.map((b: any) => {
        const s = stockList.find((s: any) => s.product_id === p.id && s.branch_id === b.id);
        return (s?.qty ?? 0) as number;
      });
      const total = branchQtys.reduce((a, b) => a + b, 0);
      if (total > 0) {
        rows.push([String(stt++), p.sku ?? "", p.name, ...branchQtys.map(String), String(total)]);
      }
    }

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ton-kho-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất danh sách hàng tồn kho!");
  }

  function toggleExpanded(productId: string) {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }));
  }

  return (
    <AppShell title="Quản lý tồn kho" loading={isLoading}>
      <div className="mb-4 flex flex-wrap gap-2">
        {canIn && (
          <Button onClick={() => startAction("in")}>
            <ArrowDownToLine className="mr-1 h-4 w-4" />
            Nhập kho
          </Button>
        )}
        {canTransfer && (
          <Button variant="outline" onClick={() => startAction("transfer")}>
            <Repeat className="mr-1 h-4 w-4" />
            Chuyển kho
          </Button>
        )}
        <Button variant="outline" onClick={exportStockExcel}>
          <FileText className="mr-1 h-4 w-4" />
          Xuất Excel tồn kho
        </Button>
        {!canIn && !canTransfer && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <ShieldOff className="h-4 w-4" />
            Bạn chỉ có quyền xem tồn kho
          </div>
        )}
      </div>

      {pendingTransfers.length > 0 && (
        <Card className="mb-4 border-yellow-200 bg-yellow-50/50">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-semibold text-yellow-800">
              Phiếu chuyển kho chờ xác nhận ({pendingTransfers.length})
            </span>
            <span className="text-xs text-yellow-600 bg-yellow-100 rounded-full px-2 py-0.5">Bấm vào phiếu để xem & chỉnh sửa</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pendingTransfers.map((t: any) => {
              const fromName = branches.find((b: any) => b.id === t.from_branch)?.name ?? t.from_branch;
              const toName   = branches.find((b: any) => b.id === t.to_branch)?.name ?? t.to_branch;
              const itemCount = ((data?.transfer_items ?? []) as any[]).filter((i: any) => i.transfer_id === t.id).length;
              return (
                <button
                  key={t.id}
                  onClick={() => openTransferDetail(t)}
                  className="text-left rounded-xl border bg-white hover:border-primary/40 hover:bg-primary/5 transition-all px-4 py-3 shadow-sm group"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-mono text-muted-foreground">#{t.id.slice(-6).toUpperCase()}</span>
                    <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("vi-VN")}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-blue-700 truncate">{fromName}</span>
                    <span className="text-muted-foreground shrink-0">→</span>
                    <span className="text-green-700 truncate">{toName}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{itemCount} sản phẩm</span>
                    <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">Mở phiếu →</span>
                  </div>
                  {t.note && <div className="mt-1 text-xs text-muted-foreground truncate">{t.note}</div>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b bg-gradient-to-r from-background to-muted/20 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                <Package2 className="h-4 w-4 text-muted-foreground" />
                Tồn kho theo sản phẩm × chi nhánh
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Xem nhanh tồn kho, đơn chờ xử lý và mở rộng theo từng chi nhánh.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border bg-background px-3 py-1.5">
                {visibleBranches.length} chi nhánh
              </span>
              <span className="rounded-full border bg-background px-3 py-1.5">
                {totalFiltered} sản phẩm
              </span>
            </div>
          </div>

          <SearchFilter
            search={search}
            onSearch={(v) => { setSearch(v); setPage(1); }}
            placeholder="Tìm SKU, tên sản phẩm..."
            sortOptions={[
              {
                value: "name",
                label: "Tên A→Z",
              },
              {
                value: "sku",
                label: "SKU",
              },
              {
                value: "stock_desc",
                label: "Tồn nhiều nhất",
              },
              {
                value: "stock_asc",
                label: "Tồn ít nhất",
              },
            ]}
            sortValue={sortBy}
            onSort={(v) => { setSortBy(v as any); setPage(1); }}
            filterSlot={
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterBranch}
                onChange={(e) => {
                  setFilterBranch(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">
                  Tất cả chi nhánh
                </option>

                {/* ✅ Hiện tất cả CN để xem tồn kho */}
                {allBranches.map((b: any) => (
                  <option
                    key={b.id}
                    value={b.id}
                  >
                    {b.name}
                  </option>
                ))}
              </select>
            }
            total={totalFiltered}
            totalLabel="sản phẩm"
          />
        </div>

        {isLoading ? (
          <div className="px-4 py-6 text-muted-foreground">
            Đang tải...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="w-[120px] py-2 pr-3">
                    SKU
                  </th>
                  <th className="pr-3">
                    Hàng tồn / đặt hàng
                  </th>
                  <th className="w-[100px] text-right">
                    Tồn
                  </th>
                  <th className="w-[120px] text-right">
                    Đặt hàng
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedProducts.map((p) => {
                  const branchStats = branchStatsMap.get(p.id) ?? [];
                  const total = branchStats.reduce((sum, item) => sum + item.stock, 0);
                  const pending = branchStats.reduce((sum, item) => sum + item.pendingQty, 0);
                  const pendingOrderCount = branchStats.reduce((sum, item) => sum + item.pendingOrders, 0);
                  const expanded = !!expandedProducts[p.id];

                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b last:border-0 hover:bg-muted/30 align-top">
                        <td className="py-3 pr-3 font-mono text-xs pt-4">
                          {p.sku}
                        </td>

                        <td className="pr-3 py-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-base font-semibold leading-tight">{p.name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Hàng tồn hiện tại và đơn chờ theo chi nhánh.
                                </div>
                              </div>

                              <button
                                className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                                onClick={() => toggleExpanded(p.id)}
                              >
                                {expanded ? (
                                  <>
                                    Thu gọn <ChevronUp className="h-3.5 w-3.5" />
                                  </>
                                ) : (
                                  <>
                                    Chi tiết <ChevronDown className="h-3.5 w-3.5" />
                                  </>
                                )}
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1.5 rounded-full border bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                                <Package2 className="h-3.5 w-3.5" />
                                Tổng tồn: <b>{total}</b>
                              </span>

                              <span className="inline-flex items-center gap-1.5 rounded-full border bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Đặt hàng: <b>{pending}</b>
                                <span className="text-amber-600/80">({pendingOrderCount} đơn)</span>
                              </span>
                            </div>

                            {expanded && (
                              <div className="rounded-2xl border bg-muted/20 p-3">
                                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>Chi tiết theo chi nhánh</span>
                                  {isAdmin
                                    ? <span className="flex items-center gap-1 text-primary/70"><Pencil className="h-3 w-3" />Bấm ✏️ để chỉnh số lượng</span>
                                    : <span>Click để xem tổng ở từng chi nhánh</span>
                                  }
                                </div>

                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                  {branchStats.map((item) => {
                                    const isLowStock = item.stock <= p.min_stock;
                                    const eKey = stockEditKey(p.id, item.branchId);
                                    const isEditing = eKey in editingStock;
                                    const isSaving = !!savingStock[eKey];
                                    return (
                                      <div
                                        key={item.branchId}
                                        className={`rounded-xl border bg-background px-3 py-2 shadow-sm ${
                                          isLowStock ? "border-destructive/20" : "border-muted"
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-semibold">{item.branchName}</div>
                                            <div className="mt-1 text-[11px] text-muted-foreground">
                                              {item.pendingOrders > 0
                                                ? `${item.pendingOrders} đơn chờ`
                                                : "Không có đơn chờ"}
                                            </div>
                                          </div>

                                          <div className="text-right text-[11px] text-muted-foreground">
                                            {isLowStock ? "Sắp hết" : "Ổn định"}
                                          </div>
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                                          {isAdmin && isEditing ? (
                                            /* ── Admin: inline edit mode ── */
                                            <div className="flex items-center gap-1 w-full">
                                              <input
                                                type="text"
                                                inputMode="numeric"
                                                className="h-7 w-20 rounded-lg border border-primary/50 bg-primary/5 px-2 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                value={editingStock[eKey]}
                                                autoFocus
                                                onChange={(e) =>
                                                  setEditingStock((prev) => ({
                                                    ...prev,
                                                    [eKey]: e.target.value.replace(/\D/g, ""),
                                                  }))
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") saveEditStock(p.id, item.branchId);
                                                  if (e.key === "Escape") cancelEditStock(p.id, item.branchId);
                                                }}
                                                disabled={isSaving}
                                              />
                                              <button
                                                onClick={() => saveEditStock(p.id, item.branchId)}
                                                disabled={isSaving}
                                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                                                title="Lưu"
                                              >
                                                {isSaving
                                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                  : <Check className="h-3.5 w-3.5" />}
                                              </button>
                                              <button
                                                onClick={() => cancelEditStock(p.id, item.branchId)}
                                                disabled={isSaving}
                                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
                                                title="Hủy"
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          ) : (
                                            /* ── Normal / view mode ── */
                                            <>
                                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
                                                Tồn {item.stock}
                                              </span>
                                              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700">
                                                Đặt {item.pendingQty}
                                              </span>
                                              {isAdmin && (
                                                <button
                                                  onClick={() => startEditStock(p.id, item.branchId, item.stock)}
                                                  className="ml-auto h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                                  title="Chỉnh số lượng (Admin)"
                                                >
                                                  <Pencil className="h-3 w-3" />
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-3 text-right font-semibold text-base pt-4">
                          {total}
                        </td>

                        <td className="py-3 pt-4 text-right">
                          <div className="font-semibold text-base">
                            {pending}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {pendingOrderCount > 0
                              ? `${pendingOrderCount} đơn chờ`
                              : "Không có"}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={totalFiltered}
        onPageChange={setPage}
        label="sản phẩm"
      />

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            <History className="h-4 w-4" />
            <div className="font-medium">Lịch sử kho</div>
          </div>

          {/* Lọc theo loại */}
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={histFilterType}
            onChange={(e) => setHistFilterType(e.target.value as "" | "in" | "transfer")}
          >
            <option value="">Tất cả loại</option>
            <option value="in">Nhập kho</option>
            <option value="transfer">Chuyển kho</option>
          </select>

          {/* Lọc theo sản phẩm */}
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm max-w-[200px]"
            value={histFilterProduct}
            onChange={(e) => setHistFilterProduct(e.target.value)}
          >
            <option value="">Tất cả sản phẩm</option>
            {products.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Lọc từ ngày */}
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={histFilterFrom}
            onChange={(e) => setHistFilterFrom(e.target.value)}
            title="Từ ngày"
          />
          <span className="text-muted-foreground text-xs">–</span>
          {/* Lọc đến ngày */}
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={histFilterTo}
            onChange={(e) => setHistFilterTo(e.target.value)}
            title="Đến ngày"
          />

          {/* Nút xóa lọc */}
          {(histFilterType || histFilterProduct || histFilterFrom || histFilterTo) && (
            <button
              className="h-8 px-2 text-xs rounded-md border bg-muted hover:bg-muted/70 text-muted-foreground"
              onClick={() => { setHistFilterType(""); setHistFilterProduct(""); setHistFilterFrom(""); setHistFilterTo(""); }}
            >
              Xóa lọc
            </button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {filteredHistoryMovements.length} / {historyMovements.length} bản ghi
          </span>
        </div>

        <div className="max-h-[420px] overflow-auto rounded-xl border">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="sticky top-0 bg-background border-b z-10">
              <tr className="text-muted-foreground">
                <th className="px-4 py-3 text-left">Thời gian</th>
                <th className="px-4 py-3 text-left">Loại</th>
                <th className="px-4 py-3 text-left">Sản phẩm</th>
                <th className="px-4 py-3 text-left">Luồng kho</th>
                <th className="px-4 py-3 text-right">SL</th>
                <th className="px-4 py-3 text-left">Ghi chú</th>
              </tr>
            </thead>

            <tbody>
              {filteredHistoryMovements.map((m: any) => {
                const product = products.find((p) => p.id === m.product_id);
                const fromName = m.from_branch
                  ? (branches.find((b) => b.id === m.from_branch)?.name ?? m.from_branch)
                  : null;
                const toName = m.to_branch
                  ? (branches.find((b) => b.id === m.to_branch)?.name ?? m.to_branch)
                  : null;

                let flowLabel: React.ReactNode = "—";
                if (m.type === "in" && toName) {
                  flowLabel = (
                    <span>
                      Nhập vào <b>{toName}</b>
                    </span>
                  );
                } else if (m.type === "out" && fromName) {
                  flowLabel = (
                    <span>
                      Xuất khỏi <b>{fromName}</b>
                    </span>
                  );
                } else if (m.type === "transfer" && fromName && toName) {
                  flowLabel = (
                    <span>
                      <b>{fromName}</b> → <b>{toName}</b>
                    </span>
                  );
                }

                return (
                  <tr key={m.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          m.type === "in"
                            ? "bg-green-100 text-green-700"
                            : m.type === "out"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {m.type === "in" ? "Nhập" : m.type === "out" ? "Xuất" : "Chuyển"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{product?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{product?.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{flowLabel}</td>
                    <td className="px-4 py-3 text-right font-medium">{m.qty}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.note || "—"}</td>
                  </tr>
                );
              })}
              {filteredHistoryMovements.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {histFilterType || histFilterProduct || histFilterFrom || histFilterTo
                      ? "Không có bản ghi nào khớp với bộ lọc."
                      : "Chưa có lịch sử kho."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="
          h-[100dvh]
          w-[100vw]
          max-w-none
          overflow-hidden
          border-0
          bg-[#f4f6f8]
          p-0
          dark:bg-background
          sm:h-[96vh]
          sm:w-[98vw]
          sm:max-w-[1600px]
          sm:rounded-2xl
          flex flex-col
        ">
          <div className="shrink-0 border-b bg-white px-4 py-4 shadow-sm sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold tracking-tight">
                    {voucherTitle}
                  </DialogTitle>
                </DialogHeader>

                <div className="mt-1 text-sm text-muted-foreground">
                  Inventory Voucher System
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <div className="rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground">
                    Mã phiếu
                  </div>

                  <div className="font-semibold">
                    #
                    {Date.now()
                      .toString()
                      .slice(-6)}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground">
                    Thời gian
                  </div>

                  <div className="font-semibold">
                    {new Date().toLocaleString(
                      "vi-VN"
                    )}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="text-muted-foreground">
                    Người tạo
                  </div>

                  <div className="font-semibold">
                    {user?.full_name ||
                      user?.email ||
                      "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="
            grid
            flex-1
            min-h-0
            bg-[#f4f6f8]
            lg:grid-cols-[minmax(0,1fr)_420px]
          ">
            <div className="
              flex
              min-h-0
              flex-col
              overflow-hidden
              border-b
              bg-white
              lg:border-b-0
              lg:border-r
            ">
              <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 sm:px-6">
                <div className="
                  mb-4
                  flex
                  flex-col
                  gap-3
                  sm:flex-row
                  sm:items-center
                  sm:justify-between
                ">
                  <div>
                    <div className="font-medium">
                      Danh sách sản phẩm
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Multi line-items
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (
                        type === "in"
                      ) {
                        setInItems([
                          ...inItems,
                          createMovementItem(
                            products[0]
                              ?.id ?? "",
                            1,
                            0
                          ),
                        ]);
                      }

                      if (
                        type === "out"
                      ) {
                        setOutItems([
                          ...outItems,
                          createMovementItem(
                            products[0]
                              ?.id ?? "",
                            1,
                            0
                          ),
                        ]);
                      }

                      if (
                        type ===
                        "transfer"
                      ) {
                        setTransferItems([
                          ...transferItems,
                          createTransferItem(
                            products[0]
                              ?.id ?? "",
                            1
                          ),
                        ]);
                      }
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Thêm
                  </Button>
                </div>

                <div className="
                  min-h-0
                  flex-1
                  overflow-auto
                  rounded-2xl
                  border
                  bg-white
                  shadow-sm
                ">
                  <table className="w-full min-w-[780px] text-sm">
                    <thead className="
                      sticky
                      top-0
                      z-20
                      bg-[#f8fafc]
                      shadow-sm
                      backdrop-blur
                    ">
                      <tr className="border-b">
                        <th className="px-3 py-3 text-left">
                          #
                        </th>

                        <th className="px-3 py-3 text-left">
                          Sản phẩm
                        </th>

                        <th className="px-3 py-3 text-right">
                          SL
                        </th>

                        {(type ===
                          "in" ||
                          type ===
                            "out") && (
                          <>
                            <th className="px-3 py-3 text-right">
                              Đơn giá
                            </th>

                            <th className="px-3 py-3 text-right">
                              Thành tiền
                            </th>
                          </>
                        )}

                        <th className="px-3 py-3"></th>
                      </tr>
                    </thead>

                    <tbody>
                      {(type === "in"
                        ? inItems
                        : type ===
                            "out"
                          ? outItems
                          : transferItems
                      ).map(
                        (
                          item: any,
                          idx: number
                        ) => {
                          const product =
                            products.find(
                              (
                                p
                              ) =>
                                p.id ===
                                item.product_id
                            );

                          return (
                            <tr
                              key={idx}
                              className="
                                border-b
                                align-top
                                transition-colors
                                hover:bg-blue-50/40
                              "
                            >
                              <td className="px-3 py-3 text-muted-foreground">
                                {idx + 1}
                              </td>

                              <td className="min-w-[320px] px-3 py-3">
                                <SearchableSelect
                                  value={item.product_id}
                                  onChange={(v) => {
                                    if (type === "in") {
                                      const next = [...inItems];
                                      next[idx] = { ...item, product_id: v };
                                      setInItems(next);
                                    }
                                    if (type === "out") {
                                      const next = [...outItems];
                                      next[idx] = { ...item, product_id: v };
                                      setOutItems(next);
                                    }
                                    if (type === "transfer") {
                                      const next = [...transferItems];
                                      next[idx] = { ...item, product_id: v };
                                      setTransferItems(next);
                                    }
                                  }}
                                  emptyLabel="— Chọn sản phẩm —"
                                  placeholder="Tìm sản phẩm..."
                                  options={products.map((p) => ({
                                    value: p.id,
                                    label: p.name,
                                    sub: p.sku ?? undefined,
                                  }))}
                                />

                                {product && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    SKU:{" "}
                                    {
                                      product.sku
                                    }
                                  </div>
                                )}
                              </td>

                              <td className="px-3 py-3">
                                <Input
                                  className="text-right"
                                  value={
                                    item.qty
                                  }
                                  onChange={(
                                    e
                                  ) => {
                                    const qty =
                                      parseDigits(
                                        e
                                          .target
                                          .value
                                      );

                                    if (
                                      type ===
                                      "in"
                                    ) {
                                      const next =
                                        [
                                          ...inItems,
                                        ];

                                      next[
                                        idx
                                      ] = {
                                        ...item,
                                        qty,
                                      };

                                      setInItems(
                                        next
                                      );
                                    }

                                    if (
                                      type ===
                                      "out"
                                    ) {
                                      const next =
                                        [
                                          ...outItems,
                                        ];

                                      next[
                                        idx
                                      ] = {
                                        ...item,
                                        qty,
                                      };

                                      setOutItems(
                                        next
                                      );
                                    }

                                    if (
                                      type ===
                                      "transfer"
                                    ) {
                                      const next =
                                        [
                                          ...transferItems,
                                        ];

                                      next[
                                        idx
                                      ] = {
                                        ...item,
                                        qty,
                                      };

                                      setTransferItems(
                                        next
                                      );
                                    }
                                  }}
                                />
                              </td>

                              {(type ===
                                "in" ||
                                type ===
                                  "out") && (
                                <>
                                  <td className="px-3 py-3">
                                    <Input
                                      className="text-right"
                                      value={
                                        item.unit_cost
                                          ? formatMoney(
                                              item.unit_cost
                                            )
                                          : ""
                                      }
                                      onChange={(
                                        e
                                      ) => {
                                        const unit_cost =
                                          parseDigits(
                                            e
                                              .target
                                              .value
                                          );

                                        if (
                                          type ===
                                          "in"
                                        ) {
                                          const next =
                                            [
                                              ...inItems,
                                            ];

                                          next[
                                            idx
                                          ] =
                                            {
                                              ...item,
                                              unit_cost,
                                            };

                                          setInItems(
                                            next
                                          );
                                        }

                                        if (
                                          type ===
                                          "out"
                                        ) {
                                          const next =
                                            [
                                              ...outItems,
                                            ];

                                          next[
                                            idx
                                          ] =
                                            {
                                              ...item,
                                              unit_cost,
                                            };

                                          setOutItems(
                                            next
                                          );
                                        }
                                      }}
                                    />
                                  </td>

                                  <td className="px-3 py-3 text-right font-medium whitespace-nowrap">
                                    {formatMoney(
                                      item.qty *
                                        item.unit_cost
                                    )}{" "}
                                    đ
                                  </td>
                                </>
                              )}

                              <td className="px-3 py-3 text-right">
                                <button
                                  className="rounded-md p-2 hover:bg-muted"
                                  onClick={() => {
                                    if (
                                      type ===
                                      "in"
                                    ) {
                                      setInItems(
                                        inItems.filter(
                                          (
                                            _,
                                            i
                                          ) =>
                                            i !==
                                            idx
                                        )
                                      );
                                    }

                                    if (
                                      type ===
                                      "out"
                                    ) {
                                      setOutItems(
                                        outItems.filter(
                                          (
                                            _,
                                            i
                                          ) =>
                                            i !==
                                            idx
                                        )
                                      );
                                    }

                                    if (
                                      type ===
                                      "transfer"
                                    ) {
                                      setTransferItems(
                                        transferItems.filter(
                                          (
                                            _,
                                            i
                                          ) =>
                                            i !==
                                            idx
                                        )
                                      );
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto bg-muted/20 px-4 py-4 sm:px-6">
              <div className="space-y-4 pb-10 lg:sticky lg:top-0">
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="mb-3 font-medium">
                    Thông tin phiếu
                  </div>

                  {type === "in" && (
                    <div>
                      <Label>
                        Chi nhánh nhập
                      </Label>

                      <SearchableSelect
                        value={inBranch}
                        onChange={setInBranch}
                        placeholder="Tìm chi nhánh..."
                        options={allowedBranches.map((b) => ({ value: b.id, label: b.name }))}
                      />
                    </div>
                  )}

                  {type === "out" && (
                    <div>
                      <Label>
                        Chi nhánh xuất
                      </Label>

                      <SearchableSelect
                        value={outBranch}
                        onChange={setOutBranch}
                        placeholder="Tìm chi nhánh..."
                        options={allowedBranches.map((b) => ({ value: b.id, label: b.name }))}
                      />
                    </div>
                  )}

                  {type ===
                    "transfer" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="flex items-center gap-1">
                          Từ kho
                          <span className="text-xs text-muted-foreground font-normal">(CN của bạn)</span>
                        </Label>
                        {/* ✅ Chỉ CN được phân quyền */}
                        <SearchableSelect
                          value={transferFrom}
                          onChange={setTransferFrom}
                          placeholder="Tìm chi nhánh..."
                          options={allowedBranches.map((b) => ({ value: b.id, label: b.name }))}
                        />
                      </div>

                      <div>
                        <Label className="flex items-center gap-1">
                          Đến kho
                          <span className="text-xs text-muted-foreground font-normal">(Tất cả)</span>
                        </Label>
                        {/* ✅ Toàn bộ chi nhánh */}
                        <SearchableSelect
                          value={transferTo}
                          onChange={setTransferTo}
                          placeholder="Tìm chi nhánh..."
                          options={branches.map((b: any) => ({
                            value: b.id,
                            label: b.name,
                            disabled: b.id === transferFrom,  // không chuyển về chính nó
                          }))}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <Label>Ghi chú</Label>
                    <Input
                      className="mt-1"
                      value={voucherNote}
                      onChange={(e) => setVoucherNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (type === "in") submitIn();
                          else if (type === "out") submitOut();
                          else submitTransfer();
                        }
                      }}
                      placeholder="Nhấn Enter để xác nhận..."
                    />
                  </div>
                </div>

                <div className="rounded-2xl border-2 border-primary/20 bg-white p-5 shadow-sm">
                  <div className="text-sm font-medium">
                    Tổng kết
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Mặt hàng
                      </span>

                      <span className="font-medium">
                        {
                          activeItems.length
                        }
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Tổng SL
                      </span>

                      <span className="font-medium">
                        {totalQty}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl bg-primary/5 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Tổng thanh toán
                    </div>

                    <div className="mt-2 text-3xl font-bold tracking-tight">
                      {type ===
                      "transfer"
                        ? "—"
                        : `${formatMoney(totalMoney)} đ`}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const rows = (
                          type === "in"
                            ? validInItems
                            : type === "out"
                              ? validOutItems
                              : validTransferItems
                        )
                          .map((item: any, idx: number) => {
                            const p = products.find(
                              (x) => x.id === item.product_id
                            );

                            const total =
                              Number(item.qty || 0) *
                              Number(item.unit_cost || 0);

                            return `
                              <tr>
                                <td>${idx + 1}</td>
                                <td>
                                  <div style="font-weight:600">
                                    ${p?.name || ""}
                                  </div>
                                  <div style="font-size:12px;color:#666">
                                    ${p?.sku || ""}
                                  </div>
                                </td>
                                <td style="text-align:right">
                                  ${item.qty}
                                </td>
                                ${
                                  type !== "transfer"
                                    ? `
                                  <td style="text-align:right">
                                    ${formatMoney(
                                      item.unit_cost || 0
                                    )}
                                  </td>
                                  <td style="text-align:right;font-weight:600">
                                    ${formatMoney(total)}
                                  </td>
                                `
                                    : ""
                                }
                              </tr>
                            `;
                          })
                          .join("");

                        const branchName =
                          type === "in"
                            ? branches.find(
                                (b) => b.id === inBranch
                              )?.name
                            : type === "out"
                              ? branches.find(
                                  (b) => b.id === outBranch
                                )?.name
                              : `${branches.find(
                                  (b) =>
                                    b.id === transferFrom
                                )?.name} → ${
                                  branches.find(
                                    (b) =>
                                      b.id === transferTo
                                  )?.name
                                }`;

                        // Resolve admin template
                        const _invTplKey = type === "transfer" ? "transfer_slip" : "import_slip";
                        const _invTpls = (() => { try { return JSON.parse(siteSettings?.print_templates || "{}"); } catch { return {}; } })();
                        const _tpl = _invTpls[_invTplKey] ?? {};
                        const _siteName = siteSettings?.site_name ?? "";
                        const _tplHeader   = (_tpl.header   ?? (type === "transfer" ? "PHIẾU CHUYỂN KHO" : "PHIẾU NHẬP KHO")).replace("{Ten_Cua_Hang}", _siteName);
                        const _tplFooter   = (_tpl.footer   ?? "").replace("{Ten_Cua_Hang}", _siteName);
                        const _showWarranty = _tpl.showWarranty !== false;
                        const _tplWarranty = _showWarranty ? ((_tpl.warranty ?? (type === "transfer" ? "Hàng hoá đã được kiểm tra đầy đủ trước khi bàn giao. Người nhận ký xác nhận chịu trách nhiệm sau khi nhận hàng." : "Hàng hoá được kiểm tra đầy đủ trước khi nhập kho. Mọi khiếu nại vui lòng phản hồi trong vòng 24 giờ.")).replace("{Ten_Cua_Hang}", _siteName)) : "";

                        const printWindow =
                          window.open("", "_blank");

                        if (!printWindow) return;

                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>${voucherTitle}</title>

                              <style>
                                *{
                                  box-sizing:border-box;
                                  font-family:Arial;
                                }

                                body{
                                  padding:40px;
                                  color:#111;
                                }

                                .header{
                                  text-align:center;
                                  margin-bottom:32px;
                                }

                                .title{
                                  font-size:28px;
                                  font-weight:700;
                                  margin-bottom:8px;
                                }

                                .sub{
                                  color:#666;
                                  font-size:13px;
                                }

                                .section{
                                  margin-bottom:24px;
                                }

                                .info-grid{
                                  display:grid;
                                  grid-template-columns:1fr 1fr;
                                  gap:12px;
                                  font-size:14px;
                                }

                                table{
                                  width:100%;
                                  border-collapse:collapse;
                                  margin-top:12px;
                                }

                                th,td{
                                  border:1px solid #ddd;
                                  padding:10px;
                                  font-size:14px;
                                  vertical-align:top;
                                }

                                th{
                                  background:#f5f5f5;
                                  text-align:left;
                                }

                                .total{
                                  margin-top:20px;
                                  text-align:right;
                                }

                                .total .money{
                                  font-size:26px;
                                  font-weight:700;
                                }

                                .sign{
                                  margin-top:70px;
                                  display:grid;
                                  grid-template-columns:1fr 1fr;
                                  gap:40px;
                                  text-align:center;
                                }

                                .sign-box{
                                  padding-top:12px;
                                }

                                @media print{
                                  body{
                                    padding:0;
                                  }
                                }
                              </style>
                            </head>

                            <body>
                              <div class="header">
                                ${siteSettings?.logo_url ? `<img src="${siteSettings.logo_url}" alt="Logo" style="height:60px;object-fit:contain;margin-bottom:8px" />` : ""}
                                ${siteSettings?.site_name ? `<div style="font-size:15px;font-weight:600;color:#444;margin-bottom:6px">${siteSettings.site_name}</div>` : ""}
                                <div class="title">
                                  ${_tplHeader.toUpperCase()}
                                </div>

                                <div class="sub">
                                  Mã phiếu #${Date.now()
                                    .toString()
                                    .slice(-6)}
                                  ${siteSettings?.phone ? ` &nbsp;|&nbsp; ĐT: ${siteSettings.phone}` : ""}
                                  ${siteSettings?.address ? ` &nbsp;|&nbsp; ${siteSettings.address}` : ""}
                                </div>
                              </div>

                              <div class="section info-grid">
                                <div>
                                  <strong>Ngày:</strong>
                                  ${new Date().toLocaleString(
                                    "vi-VN"
                                  )}
                                </div>

                                <div>
                                  <strong>Người tạo:</strong>
                                  ${
                                    user?.full_name ||
                                    user?.email ||
                                    "—"
                                  }
                                </div>

                                <div>
                                  <strong>Chi nhánh:</strong>
                                  ${branchName || "—"}
                                </div>
                              </div>

                              <div class="section">
                                <table>
                                  <thead>
                                    <tr>
                                      <th style="width:60px">
                                        STT
                                      </th>

                                      <th>
                                        Sản phẩm
                                      </th>

                                      <th style="width:100px;text-align:right">
                                        SL
                                      </th>

                                      ${
                                        type !== "transfer"
                                          ? `
                                        <th style="width:140px;text-align:right">
                                          Đơn giá
                                        </th>

                                        <th style="width:160px;text-align:right">
                                          Thành tiền
                                        </th>
                                      `
                                          : ""
                                      }
                                    </tr>
                                  </thead>

                                  <tbody>
                                    ${rows}
                                  </tbody>
                                </table>
                              </div>

                              ${
                                type !== "transfer"
                                  ? `
                                <div class="total">
                                  <div>Tổng thanh toán</div>

                                  <div class="money">
                                    ${formatMoney(
                                      totalMoney
                                    )} đ
                                  </div>
                                </div>
                              `
                                  : ""
                              }

                              ${
                                voucherNote
                                  ? `
                                <div class="section" style="margin-top:30px">
                                  <strong>Ghi chú:</strong>
                                  ${voucherNote}
                                </div>
                              `
                                  : ""
                              }

                              <div style="margin-top:32px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center;font-size:13px">
                                ${["Kỹ thuật","Nhân viên","Khách hàng","Thủ kho"].map(r=>`<div><div style="font-weight:600">${r}</div><div style="color:#999;font-size:11px">(Ký, ghi rõ họ tên)</div><div style="margin-top:50px;border-top:1px dashed #bbb;padding-top:4px;color:#ccc">__________</div></div>`).join("")}
                              </div>
                              ${_tplWarranty ? `<div style="margin-top:18px;font-size:12px;font-weight:700;text-transform:uppercase;line-height:1.6;border-top:1px solid #eee;padding-top:12px">${_tplWarranty}</div>` : ""}
                              ${_tplFooter ? `<div style="margin-top:14px;text-align:center;font-size:13px;color:#555;border-top:1px solid #eee;padding-top:12px">${_tplFooter}</div>` : ""}
                            </body>
                          </html>
                        `);

                        printWindow.document.close();

                        setTimeout(() => {
                          printWindow.print();
                        }, 300);
                      }}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      In phiếu
                    </Button>

                    {type ===
                      "transfer" && (
                      <Button
                        variant="outline"
                        onClick={
                          exportTransferTxt
                        }
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Xuất TXT
                      </Button>
                    )}

                    {type === "in" && (
                      <Button
                        onClick={
                          submitIn
                        }
                      >
                        Xác nhận nhập
                      </Button>
                    )}

                    {type ===
                      "out" && (
                      <Button
                        onClick={
                          submitOut
                        }
                      >
                        Xác nhận xuất
                      </Button>
                    )}

                    {type ===
                      "transfer" && (
                      <Button
                        onClick={
                          submitTransfer
                        }
                      >
                        Tạo phiếu chuyển
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Transfer Detail Dialog (KiotViet style) ─────────────────────── */}
      <Dialog open={trfDetailOpen} onOpenChange={setTrfDetailOpen}>
        <DialogContent className="max-w-lg rounded-2xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 border-b px-5 py-4 shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                <Repeat className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="font-bold text-base leading-tight">Phiếu chuyển kho</div>
                <div className="text-xs text-muted-foreground">
                  {new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </div>
              </div>
            </div>
            {trfDetailId && (() => {
              const t = (data?.transfers ?? []).find((x: any) => x.id === trfDetailId);
              if (!t) return null;
              const fromName = branches.find((b: any) => b.id === t.from_branch)?.name ?? t.from_branch;
              const toName   = branches.find((b: any) => b.id === t.to_branch)?.name ?? t.to_branch;
              return (
                <div className="mt-3 flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2 border text-sm font-medium">
                  <span className="text-muted-foreground bg-muted/40 rounded-lg px-2 py-0.5">{fromName}</span>
                  <svg className="h-4 w-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  <span className="text-primary font-semibold bg-primary/8 rounded-lg px-2 py-0.5">{toName}</span>
                  {t.status && (
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                      t.status === "pending" ? "bg-amber-100 text-amber-700" :
                      t.status === "done" ? "bg-green-100 text-green-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {t.status === "pending" ? "Chờ xác nhận" : t.status === "done" ? "Hoàn thành" : "Đã hủy"}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-auto px-5 py-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Danh sách hàng hóa
            </div>
            <div className="space-y-2">
              {trfEditItems.map((item, idx) => {
                const product = products.find((p: any) => p.id === item.product_id);
                return (
                  <div key={idx} className="flex items-center gap-2 bg-muted/20 rounded-xl border px-2 py-1.5">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        value={item.product_id}
                        onChange={(v) => {
                          const next = [...trfEditItems];
                          next[idx] = { ...item, product_id: v };
                          setTrfEditItems(next);
                        }}
                        emptyLabel="— Chọn SP —"
                        placeholder="Tìm sản phẩm..."
                        options={products.map((p: any) => ({ value: p.id, label: p.name, sub: p.sku ?? undefined }))}
                      />
                    </div>
                    <div className="w-20 shrink-0">
                      <Input
                        className="text-right h-9 font-mono text-sm"
                        value={item.qty}
                        onChange={(e) => {
                          const qty = Number(e.target.value.replace(/\D/g, "")) || 0;
                          const next = [...trfEditItems];
                          next[idx] = { ...item, qty };
                          setTrfEditItems(next);
                        }}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrfEditItems(trfEditItems.filter((_, i) => i !== idx))}
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      disabled={trfEditItems.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed mt-2 rounded-xl"
              onClick={() => setTrfEditItems([...trfEditItems, createTransferItem(products[0]?.id ?? "", 1)])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Thêm sản phẩm
            </Button>

            {/* Summary */}
            <div className="mt-4 flex items-center justify-between rounded-xl bg-primary/5 border border-primary/15 px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Tổng số lượng</span>
              <span className="font-bold text-primary text-lg">
                {trfEditItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)}
              </span>
            </div>
          </div>

          {/* Footer actions */}
          <div className="border-t bg-muted/10 px-5 py-4 flex gap-2.5 shrink-0">
            <Button
              variant="outline"
              className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/5 rounded-xl"
              onClick={handleTrfCancel}
              disabled={trfSaving}
            >
              {trfSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <XCircle className="h-4 w-4 mr-1.5" />}
              Hủy phiếu
            </Button>
            <Button
              className="flex-1 font-bold rounded-xl"
              onClick={handleTrfConfirm}
              disabled={trfSaving}
            >
              {trfSaving ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang xử lý...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-1.5" />Xác nhận hoàn thành</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}