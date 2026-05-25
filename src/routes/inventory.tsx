// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";

import {
  listInventory,
  createMovement,
  createTransfer,
  confirmTransfer,
  cancelTransfer,
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
  const { user, isAdmin } = useAuth();

  const list = useServerFn(listInventory);
  const move = useServerFn(createMovement);
  const createTrf = useServerFn(createTransfer);
  const confirmTrf = useServerFn(confirmTransfer);
  const cancelTrf = useServerFn(cancelTransfer);
  const getSettingsFn = useServerFn(getSettings);

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => list(),
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
  const [page, setPage] = useState(1);

  const [filterBranch, setFilterBranch] =
    useState(user?.branch_ids?.[0] ?? "");

  const [sortBy, setSortBy] =
    useState("name");

  const [stockBy, setStockBy] =
    useState("stock_desc");

  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});

  const [voucherNote, setVoucherNote] =
    useState("");

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
    useState("");

  const [transferTo, setTransferTo] =
    useState("");

  const [transferItems, setTransferItems] =
    useState<TransferItem[]>([
      createTransferItem(),
    ]);

  const products = data?.products ?? [];
  const branches = data?.branches ?? [];
  const pendingOrderSummaries = data?.pending_order_summaries ?? [];

  const pendingOrderMap = useMemo(() => {
    const map = new Map<string, { qty: number; order_count: number }>();
    for (const row of pendingOrderSummaries as any[]) {
      const key = `${row.product_id}__${row.branch_id ?? ""}`;
      map.set(key, {
        qty: Number(row.qty || 0),
        order_count: Number(row.order_count || 0),
      });
    }
    return map;
  }, [pendingOrderSummaries]);

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of (data?.stock ?? []) as any[]) {
      map.set(`${row.product_id}__${row.branch_id}`, Number(row.qty || 0));
    }
    return map;
  }, [data?.stock]);

  const pendingTransfers =
    (data?.transfers ?? []).filter(
      (t: any) => t.status === "pending"
    );

  const historyMovements =
    data?.movements ?? [];

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

    setType(t);

    const p0 = products[0]?.id ?? "";
    const b0 = branches[0]?.id ?? "";
    const b1 = branches[1]?.id ?? b0;

    setVoucherNote("");

    setInBranch(b0);
    setInItems([
      createMovementItem(p0, 1, 0),
    ]);

    setOutBranch(b0);
    setOutItems([
      createMovementItem(p0, 1, 0),
    ]);

    setTransferFrom(b0);
    setTransferTo(b1);

    setTransferItems([
      createTransferItem(p0, 1),
    ]);

    setOpen(true);
  }

  function buildNote() {
    return voucherNote.trim();
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

    if (transferFrom === transferTo)
      return toast.error(
        "Chi nhánh nguồn và đích không được giống nhau"
      );

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

      qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    } catch (e: any) {
      toast.error(
        e?.message ?? "Có lỗi xảy ra"
      );
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

  const visibleBranches = filterBranch
    ? branches.filter(
        (b) =>
          b.id === filterBranch
      )
    : branches;

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

    for (const product of products as any[]) {
      map.set(
        product.id,
        visibleBranches.map((branch) => {
          const stock = stockMap.get(`${product.id}__${branch.id}`) ?? 0;
          const pending = pendingOrderMap.get(`${product.id}__${branch.id}`);

          return {
            branchId: branch.id,
            branchName: branch.name,
            stock,
            pendingQty: pending?.qty ?? 0,
            pendingOrders: pending?.order_count ?? 0,
          };
        }),
      );
    }

    return map;
  }, [products, visibleBranches, stockMap, pendingOrderMap]);

  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const q =
          search.toLowerCase();

        return (
          p.name
            .toLowerCase()
            .includes(q) ||
          p.sku
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === "name")
          return a.name.localeCompare(
            b.name
          );

        if (sortBy === "sku")
          return a.sku.localeCompare(
            b.sku
          );

        const stockA = visibleBranches.reduce(
          (sum, branch) => sum + (stockMap.get(`${a.id}__${branch.id}`) ?? 0),
          0,
        );

        const stockB = visibleBranches.reduce(
          (sum, branch) => sum + (stockMap.get(`${b.id}__${branch.id}`) ?? 0),
          0,
        );

        return stockBy ===
          "stock_asc"
          ? stockA - stockB
          : stockB - stockA;
      });
  }, [
    products,
    search,
    sortBy,
    stockBy,
    stockMap,
    visibleBranches,
  ]);

  const paginatedProducts = useMemo(
    () => filteredProducts.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [filteredProducts, page],
  );

  const voucherTitle =
    type === "in"
      ? "Phiếu nhập hàng"
      : "Phiếu chuyển kho";

  // Xuất CSV danh sách tồn kho > 0 theo từng chi nhánh
  function exportStockExcel() {
    const branchesList = data?.branches ?? [];
    const productsList = data?.products ?? [];
    const stockList = data?.stock ?? [];

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
    <AppShell title="Quản lý tồn kho" loading={isLoading && !data}>
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
          <div className="mb-2 font-medium text-yellow-800">
            Phiếu chuyển kho chờ xác nhận (
            {pendingTransfers.length})
          </div>

          <div className="space-y-2">
            {pendingTransfers.map(
              (t: any) => {
                const fromName =
                  branches.find(
                    (b) =>
                      b.id ===
                      t.from_branch
                  )?.name ??
                  t.from_branch;

                const toName =
                  branches.find(
                    (b) =>
                      b.id ===
                      t.to_branch
                  )?.name ??
                  t.to_branch;

                return (
                  <div
                    key={t.id}
                    className="flex flex-col gap-3 rounded border bg-white px-3 py-2 text-sm md:flex-row md:items-center"
                  >
                    <div className="flex-1">
                      <span className="font-medium">
                        {fromName}
                      </span>{" "}
                      →{" "}
                      <span className="font-medium">
                        {toName}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-300 text-green-700"
                        onClick={async () => {
                          await confirmTrf({
                            data: {
                              transfer_id:
                                t.id,
                            },
                          });

                          toast.success(
                            "Đã xác nhận"
                          );

                          qc.invalidateQueries(
                            {
                              queryKey: [
                                "inventory",
                              ],
                            }
                          );
                        }}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Xác nhận
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/30 text-destructive"
                        onClick={async () => {
                          await cancelTrf({
                            data: {
                              transfer_id:
                                t.id,
                            },
                          });

                          toast.success(
                            "Đã hủy"
                          );

                          qc.invalidateQueries(
                            {
                              queryKey: [
                                "inventory",
                              ],
                            }
                          );
                        }}
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Hủy
                      </Button>
                    </div>
                  </div>
                );
              }
            )}
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
                {filteredProducts.length} sản phẩm
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
                onChange={(e) =>
                  setFilterBranch(
                    e.target.value
                  )
                }
              >
                <option value="">
                  Tất cả chi nhánh
                </option>

                {branches.map((b) => (
                  <option
                    key={b.id}
                    value={b.id}
                  >
                    {b.name}
                  </option>
                ))}
              </select>
            }
            total={filteredProducts.length}
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
                                  <span>Click để xem tổng ở từng chi nhánh</span>
                                </div>

                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                  {branchStats.map((item) => {
                                    const isLowStock = item.stock <= p.min_stock;
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

                                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
                                            Tồn {item.stock}
                                          </span>
                                          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700">
                                            Đặt {item.pendingQty}
                                          </span>
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
        total={filteredProducts.length}
        onPageChange={setPage}
        label="sản phẩm"
      />

      <Card className="mb-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4" />
          <div className="font-medium">
            Lịch sử kho
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto rounded-xl border">
          <table className="w-full text-sm">
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
              {historyMovements.map((m: any) => {
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
        ">
          <div className="border-b bg-white px-4 py-4 shadow-sm sm:px-6">
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
            h-full
            min-h-0
            bg-[#f4f6f8]
            lg:grid-cols-[minmax(0,1fr)_420px]
          ">
            <div className="
              min-h-0
              overflow-hidden
              border-b
              bg-white
              lg:border-b-0
              lg:border-r
            ">
              <div className="px-4 py-4 sm:px-6">
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
                  overflow-auto
                  rounded-2xl
                  border
                  bg-white
                  shadow-sm
                ">
                  <table className="w-full min-w-[920px] text-sm">
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
              <div className="space-y-4 pb-10">
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
                        options={branches.map((b) => ({ value: b.id, label: b.name }))}
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
                        options={branches.map((b) => ({ value: b.id, label: b.name }))}
                      />
                    </div>
                  )}

                  {type ===
                    "transfer" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>
                          Từ CN
                        </Label>

                        <SearchableSelect
                          value={transferFrom}
                          onChange={setTransferFrom}
                          placeholder="Tìm chi nhánh..."
                          options={branches.map((b) => ({ value: b.id, label: b.name }))}
                        />
                      </div>

                      <div>
                        <Label>
                          Đến CN
                        </Label>

                        <SearchableSelect
                          value={transferTo}
                          onChange={setTransferTo}
                          placeholder="Tìm chi nhánh..."
                          options={branches.map((b) => ({ value: b.id, label: b.name }))}
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
                                  ${voucherTitle.toUpperCase()}
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

                              <div class="sign">
                                <div class="sign-box">
                                  <div>
                                    Người lập phiếu
                                  </div>

                                  <div style="margin-top:70px;font-weight:600">
                                    ${
                                      user?.full_name ||
                                      "................"
                                    }
                                  </div>
                                </div>

                                <div class="sign-box">
                                  <div>
                                    Người nhận
                                  </div>

                                  <div style="margin-top:70px">
                                    ........................
                                  </div>
                                </div>
                              </div>
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
    </AppShell>
  );
}