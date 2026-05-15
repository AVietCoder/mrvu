// src/routes/inventory.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  listInventory,
  createMovement,
  createTransfer,
  confirmTransfer,
  cancelTransfer,
} from "@/lib/inventory.functions";

import { AppShell, Card } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
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
  ArrowUpFromLine,
  Repeat,
  Plus,
  Trash2,
  FileText,
  ShieldOff,
  CheckCircle2,
  XCircle,
  Printer,
  History,
} from "lucide-react";

import { toast } from "sonner";
import { hasPermission } from "@/lib/types";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [{ title: "Tồn kho — QuatTran POS" }],
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

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => list(),
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

  const canAnyMove =
    canIn || canOut || canTransfer;

  const [type, setType] = useState<
    "in" | "out" | "transfer"
  >("in");

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");

  const [filterBranch, setFilterBranch] =
    useState(user?.branch_ids?.[0] ?? "");

  const [sortBy, setSortBy] =
    useState("name");

  const [stockBy, setStockBy] =
    useState("stock_desc");

  // shared
  const [partnerName, setPartnerName] =
    useState("");

  const [voucherNote, setVoucherNote] =
    useState("");

  // IN
  const [inBranch, setInBranch] =
    useState("");

  const [inItems, setInItems] =
    useState<MovementItem[]>([
      createMovementItem(),
    ]);

  // OUT
  const [outBranch, setOutBranch] =
    useState("");

  const [outItems, setOutItems] =
    useState<MovementItem[]>([
      createMovementItem(),
    ]);

  // TRANSFER
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

  const pendingTransfers =
    (data?.transfers ?? []).filter(
      (t: any) => t.status === "pending"
    );

  const historyMovements =
    data?.movements ?? [];

  function startAction(
    t: "in" | "out" | "transfer"
  ) {
    if (t === "in" && !canIn)
      return toast.error(
        "Bạn không có quyền nhập kho"
      );

    if (t === "out" && !canOut)
      return toast.error(
        "Bạn không có quyền xuất kho"
      );

    if (t === "transfer" && !canTransfer)
      return toast.error(
        "Bạn không có quyền chuyển kho"
      );

    setType(t);

    const p0 = products[0]?.id ?? "";
    const b0 = branches[0]?.id ?? "";
    const b1 = branches[1]?.id ?? b0;

    setPartnerName("");
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
    const partner =
      partnerName.trim()
        ? `${
            type === "in"
              ? "NCC"
              : type === "out"
                ? "Khách hàng"
                : "Đối tác"
          }: ${partnerName.trim()}`
        : "";

    return [partner, voucherNote]
      .filter(Boolean)
      .join(" • ");
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

        const stockA = (
          data?.stock ?? []
        )
          .filter(
            (s) =>
              s.product_id === a.id
          )
          .reduce(
            (x, y) => x + y.qty,
            0
          );

        const stockB = (
          data?.stock ?? []
        )
          .filter(
            (s) =>
              s.product_id === b.id
          )
          .reduce(
            (x, y) => x + y.qty,
            0
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
    data?.stock,
  ]);

  const visibleBranches = filterBranch
    ? branches.filter(
        (b) =>
          b.id === filterBranch
      )
    : branches;

  const voucherTitle =
    type === "in"
      ? "Phiếu nhập hàng"
      : type === "out"
        ? "Phiếu xuất kho"
        : "Phiếu chuyển kho";

  return (
    <AppShell title="Quản lý tồn kho">
      {canAnyMove ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {canIn && (
            <Button
              onClick={() =>
                startAction("in")
              }
            >
              <ArrowDownToLine className="mr-1 h-4 w-4" />
              Nhập kho
            </Button>
          )}

          {canOut && (
            <Button
              variant="secondary"
              onClick={() =>
                startAction("out")
              }
            >
              <ArrowUpFromLine className="mr-1 h-4 w-4" />
              Xuất kho
            </Button>
          )}

          {canTransfer && (
            <Button
              variant="outline"
              onClick={() =>
                startAction("transfer")
              }
            >
              <Repeat className="mr-1 h-4 w-4" />
              Chuyển kho
            </Button>
          )}
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <ShieldOff className="h-4 w-4" />
          Bạn chỉ có quyền xem tồn kho
        </div>
      )}

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

      <Card className="mb-6">
        <div className="mb-3 font-medium">
          Tồn kho theo sản phẩm × chi nhánh
        </div>

        <SearchFilter
          search={search}
          onSearch={setSearch}
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
          onSort={setSortBy}
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

        {isLoading ? (
          <div className="text-muted-foreground">
            Đang tải...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">
                    SKU
                  </th>

                  <th className="pr-3">
                    Tên hàng
                  </th>

                  {visibleBranches.map(
                    (b) => (
                      <th
                        key={b.id}
                        className="pr-3 text-right"
                      >
                        {b.name}
                      </th>
                    )
                  )}

                  <th className="text-right">
                    Tổng
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(
                  (p) => {
                    const cells =
                      visibleBranches.map(
                        (b) =>
                          data?.stock.find(
                            (s) =>
                              s.product_id ===
                                p.id &&
                              s.branch_id ===
                                b.id
                          )?.qty ?? 0
                      );

                    const total =
                      cells.reduce(
                        (a, b) =>
                          a + b,
                        0
                      );

                    return (
                      <tr
                        key={p.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="py-2 pr-3 font-mono text-xs">
                          {p.sku}
                        </td>

                        <td className="pr-3 font-medium">
                          {p.name}
                        </td>

                        {cells.map(
                          (
                            c,
                            i
                          ) => (
                            <td
                              key={i}
                              className={`pr-3 text-right ${
                                c <=
                                p.min_stock
                                  ? "font-medium text-destructive"
                                  : ""
                              }`}
                            >
                              {c}
                            </td>
                          )
                        )}

                        <td className="text-right font-semibold">
                          {total}
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* HISTORY */}
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
                <th className="px-4 py-3 text-left">
                  Thời gian
                </th>

                <th className="px-4 py-3 text-left">
                  Loại
                </th>

                <th className="px-4 py-3 text-left">
                  Sản phẩm
                </th>

                <th className="px-4 py-3 text-right">
                  SL
                </th>

                <th className="px-4 py-3 text-right">
                  Giá
                </th>

                <th className="px-4 py-3 text-left">
                  Ghi chú
                </th>
              </tr>
            </thead>

            <tbody>
              {historyMovements.map(
                (m: any) => {
                  const product =
                    products.find(
                      (p) =>
                        p.id ===
                        m.product_id
                    );

                  return (
                    <tr
                      key={m.id}
                      className="border-b hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(
                          m.created_at
                        ).toLocaleString(
                          "vi-VN"
                        )}
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
                          {m.type === "in"
                            ? "Nhập"
                            : m.type === "out"
                              ? "Xuất"
                              : "Chuyển"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {product?.name ||
                            "—"}
                        </div>

                        <div className="text-xs text-muted-foreground">
                          {product?.sku}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right font-medium">
                        {m.qty}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {m.unit_cost
                          ? `${formatMoney(m.unit_cost)} đ`
                          : "—"}
                      </td>

                      <td className="px-4 py-3 text-muted-foreground">
                        {m.note || "—"}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={setOpen}
      >
        <DialogContent className="h-[95vh] w-[98vw] max-w-7xl overflow-hidden bg-[#fafafa] p-0 dark:bg-background sm:rounded-2xl">
          <div className="border-b px-4 py-4 sm:px-6">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {voucherTitle}
              </DialogTitle>
            </DialogHeader>

            <div className="mt-1 text-sm text-muted-foreground">
              Voucher inventory UI
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="rounded-md border bg-muted/40 px-2 py-1">
                Mã phiếu #
                {Date.now()
                  .toString()
                  .slice(-6)}
              </div>

              <div className="rounded-md border bg-muted/40 px-2 py-1">
                {new Date().toLocaleString(
                  "vi-VN"
                )}
              </div>

              <div className="rounded-md border bg-muted/40 px-2 py-1">
                Người tạo:{" "}
                {user?.name ||
                  user?.email ||
                  "—"}
              </div>
            </div>
          </div>

          <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_380px]">
            {/* LEFT */}
            <div className="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r">
              <div className="px-4 py-4 sm:px-6">
                <div className="mb-4 flex items-center justify-between">
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

                <div className="overflow-x-auto rounded-2xl border bg-white">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur">
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
                              className="border-b align-top hover:bg-muted/20"
                            >
                              <td className="px-3 py-3 text-muted-foreground">
                                {idx + 1}
                              </td>

                              <td className="min-w-[320px] px-3 py-3">
                                <select
                                  className="h-10 w-full rounded-md border bg-background px-3"
                                  value={
                                    item.product_id
                                  }
                                  onChange={(
                                    e
                                  ) => {
                                    const v =
                                      e
                                        .target
                                        .value;

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
                                        product_id:
                                          v,
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
                                        product_id:
                                          v,
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
                                        product_id:
                                          v,
                                      };

                                      setTransferItems(
                                        next
                                      );
                                    }
                                  }}
                                >
                                  <option value="">
                                    — Chọn sản phẩm —
                                  </option>

                                  {products.map(
                                    (
                                      p
                                    ) => (
                                      <option
                                        key={
                                          p.id
                                        }
                                        value={
                                          p.id
                                        }
                                      >
                                        {
                                          p.sku
                                        }{" "}
                                        —{" "}
                                        {
                                          p.name
                                        }
                                      </option>
                                    )
                                  )}
                                </select>

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

            {/* RIGHT */}
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

                      <select
                        className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                        value={inBranch}
                        onChange={(e) =>
                          setInBranch(
                            e.target.value
                          )
                        }
                      >
                        {branches.map(
                          (b) => (
                            <option
                              key={
                                b.id
                              }
                              value={
                                b.id
                              }
                            >
                              {
                                b.name
                              }
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  )}

                  {type === "out" && (
                    <div>
                      <Label>
                        Chi nhánh xuất
                      </Label>

                      <select
                        className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                        value={outBranch}
                        onChange={(e) =>
                          setOutBranch(
                            e.target.value
                          )
                        }
                      >
                        {branches.map(
                          (b) => (
                            <option
                              key={
                                b.id
                              }
                              value={
                                b.id
                              }
                            >
                              {
                                b.name
                              }
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  )}

                  {type ===
                    "transfer" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>
                          Từ CN
                        </Label>

                        <select
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                          value={
                            transferFrom
                          }
                          onChange={(
                            e
                          ) =>
                            setTransferFrom(
                              e
                                .target
                                .value
                            )
                          }
                        >
                          {branches.map(
                            (
                              b
                            ) => (
                              <option
                                key={
                                  b.id
                                }
                                value={
                                  b.id
                                }
                              >
                                {
                                  b.name
                                }
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      <div>
                        <Label>
                          Đến CN
                        </Label>

                        <select
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                          value={
                            transferTo
                          }
                          onChange={(
                            e
                          ) =>
                            setTransferTo(
                              e
                                .target
                                .value
                            )
                          }
                        >
                          {branches.map(
                            (
                              b
                            ) => (
                              <option
                                key={
                                  b.id
                                }
                                value={
                                  b.id
                                }
                              >
                                {
                                  b.name
                                }
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <Label>
                      Đối tác
                    </Label>

                    <Input
                      className="mt-1"
                      value={
                        partnerName
                      }
                      onChange={(e) =>
                        setPartnerName(
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="mt-3">
                    <Label>
                      Ghi chú
                    </Label>

                    <Input
                      className="mt-1"
                      value={
                        voucherNote
                      }
                      onChange={(e) =>
                        setVoucherNote(
                          e.target.value
                        )
                      }
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
          <div class="title">
            ${voucherTitle.toUpperCase()}
          </div>

          <div class="sub">
            Mã phiếu #${Date.now()
              .toString()
              .slice(-6)}
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
              user?.name ||
              user?.email ||
              "—"
            }
          </div>

          <div>
            <strong>Chi nhánh:</strong>
            ${branchName || "—"}
          </div>

          <div>
            <strong>Đối tác:</strong>
            ${partnerName || "—"}
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
                user?.name ||
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
{/* 
                    <Button
                      variant="outline"
                      onClick={() =>
                        setOpen(false)
                      }
                    >
                      Hủy
                    </Button> */}

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