// orders/$id.tsx
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  listOrders,
  updateOrderStatus,
  returnOrder,
} from "@/lib/orders.functions";

import { AppShell, Card, fmt } from "@/components/AppShell";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  ArrowLeft,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  CornerUpLeft,
  Loader2,
  Minus,
  Package,
  Pencil,
  Plus,
  Printer,
  Receipt,
  User,
  UserCog,
} from "lucide-react";

import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/orders/$id")({
  component: OrderDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất",
  reserved: "Đặt hàng",
  draft: "Nháp",
  cancelled: "Hủy",
  returned: "Đã trả hàng",
  partially_returned: "Trả hàng 1 phần",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  reserved: "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-100 text-red-700",
  returned: "bg-purple-100 text-purple-700",
  partially_returned:
    "bg-purple-50 text-purple-700 border border-purple-200",
};

type ReturnItem = {
  id?: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  discount: number;
  max_qty: number;
  return_qty: number;
};

function fmtInput(val: string): string {
  const num = val.replace(/\D/g, "");
  if (!num) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(num));
}

function parseInput(val: string): number {
  return Number(val.replace(/\D/g, "")) || 0;
}

function calcReturnSummary(items: ReturnItem[]) {
  let totalOriginal = 0;
  let totalReturned = 0;
  let discountAllocated = 0;

  for (const item of items) {
    totalOriginal += item.unit_price * item.max_qty;

    if (item.return_qty > 0) {
      totalReturned += item.unit_price * item.return_qty;

      const ratio = item.return_qty / item.max_qty;

      discountAllocated += (item.discount || 0) * ratio;
    }
  }

  return {
    totalOriginal,
    totalReturned,
    discountAllocated,
  };
}

function OrderDetailPage() {
  const { id } = useParams({ from: "/orders/$id" });

  const { isAdmin } = useAuth();

  const router = useRouter();
  const navigate = useNavigate();

  const qc = useQueryClient();

  const listFn = useServerFn(listOrders);
  const updateStatusFn = useServerFn(updateOrderStatus);
  const returnOrderFn = useServerFn(returnOrder);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["orders"],
    queryFn: () => listFn(),
  });

  const order = useMemo(
    () => (data?.orders ?? []).find((o: any) => o.id === id),
    [data, id],
  );

  const orderItems = useMemo(
    () => (data?.items ?? []).filter((i: any) => i.order_id === id),
    [data, id],
  );

  const [returnOpen, setReturnOpen] = useState(false);

  const [isReturning, setIsReturning] = useState(false);

  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  const [returnNote, setReturnNote] = useState("");

  const [returnFee, setReturnFee] = useState("0");

  const [otherRefund, setOtherRefund] = useState("0");

  const [refundAmount, setRefundAmount] = useState("0");

  function openReturnModal() {
    const mapped: ReturnItem[] = orderItems.map((i: any) => {
      const prod = (data?.products ?? []).find(
        (p: any) => p.id === i.product_id,
      );

      return {
        id: i.id,
        product_id: i.product_id,
        product_name: prod?.name ?? i.product_id,
        unit_price: Number(i.unit_price || 0),
        discount: Number(i.discount || 0),
        max_qty: Number(i.qty || 0),
        return_qty: 0,
      };
    });

    const summary = calcReturnSummary(mapped);

    const needRefund = Math.max(
      0,
      summary.totalReturned - summary.discountAllocated,
    );

    setReturnItems(mapped);

    setReturnFee("0");

    setOtherRefund("0");

    setRefundAmount(String(needRefund));

    setReturnNote("");

    setReturnOpen(true);
  }

  async function submitReturn() {
    const itemsToReturn = returnItems.filter((i) => i.return_qty > 0);

    if (itemsToReturn.length === 0) {
      return toast.error("Vui lòng chọn sản phẩm trả");
    }

    const isFullReturn = returnItems.every(
      (i) => i.return_qty >= i.max_qty,
    );

    try {
      setIsReturning(true);

      await returnOrderFn({
        data: {
          order_id: order.id,
          customer_id: order.customer_id,
          branch_id: order.branch_id,

          items: itemsToReturn.map((i) => ({
            product_id: i.product_id,
            return_qty: i.return_qty,
            unit_price: i.unit_price,
          })),

          refund_total: parseInput(refundAmount),

          note: returnNote,

          status: isFullReturn
            ? "returned"
            : "partially_returned",
        },
      });

      await qc.invalidateQueries({
        queryKey: ["orders"],
      });

      await router.invalidate();

      await refetch();

      toast.success("Đã xử lý trả hàng");

      setReturnOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi trả hàng");
    } finally {
      setIsReturning(false);
    }
  }

  async function completeOrder() {
    try {
      await updateStatusFn({
        data: {
          id: order.id,
          status: "completed",
        },
      });

      await qc.invalidateQueries({
        queryKey: ["orders"],
      });

      await refetch();

      toast.success("Đã hoàn tất đơn");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  async function cancelOrder() {
    if (!confirm("Hủy đơn?")) return;

    try {
      await updateStatusFn({
        data: {
          id: order.id,
          status: "cancelled",
        },
      });

      await qc.invalidateQueries({
        queryKey: ["orders"],
      });

      await refetch();

      toast.success("Đã hủy đơn");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  function printOrderSlip() {
    window.print();
  }

  if (isLoading) {
    return (
      <AppShell title="Chi tiết đơn hàng">
        <div className="py-16 text-center">
          Đang tải...
        </div>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell title="Chi tiết đơn hàng">
        <div className="py-16 text-center">
          Không tìm thấy đơn hàng
        </div>
      </AppShell>
    );
  }

  const cust = (data?.customers ?? []).find(
    (c: any) => c.id === order.customer_id,
  );

  const branch = (data?.branches ?? []).find(
    (b: any) => b.id === order.branch_id,
  );

  const emp = (data?.employees ?? []).find(
    (e: any) => e.id === order.employee_id,
  );

  return (
    <AppShell title={`Đơn hàng ${order.code}`}>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/orders"
          className="hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Bán hàng
        </Link>

        <span>/</span>

        <span className="font-medium text-foreground font-mono">
          {order.code}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Receipt className="h-5 w-5 text-primary" />

                  <h2 className="text-xl font-bold font-mono">
                    {order.code}
                  </h2>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_COLOR[order.status]
                    }`}
                  >
                    {STATUS_LABEL[order.status]}
                  </span>
                </div>

                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />

                  {new Date(order.created_at).toLocaleString(
                    "vi-VN",
                  )}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={printOrderSlip}
                >
                  <Printer className="h-4 w-4 mr-1" />
                  In hóa đơn
                </Button>

                {(order.status === "completed" ||
                  order.status ===
                    "partially_returned") && (
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={openReturnModal}
                  >
                    <CornerUpLeft className="h-4 w-4 mr-1" />
                    Trả hàng
                  </Button>
                )}

                {isAdmin &&
                  (order.status === "reserved" ||
                    order.status === "draft") && (
                    <Button
                      size="sm"
                      onClick={completeOrder}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Hoàn tất
                    </Button>
                  )}

                {isAdmin &&
                  order.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={cancelOrder}
                    >
                      <Ban className="h-4 w-4 mr-1" />
                      Hủy
                    </Button>
                  )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoBox
                icon={<User className="h-4 w-4" />}
                label="Khách hàng"
              >
                {cust?.name ?? "Khách lẻ"}
              </InfoBox>

              <InfoBox
                icon={<Building2 className="h-4 w-4" />}
                label="Chi nhánh"
              >
                {branch?.name ?? "—"}
              </InfoBox>

              <InfoBox
                icon={<UserCog className="h-4 w-4" />}
                label="Nhân viên"
              >
                {emp?.name ?? "—"}
              </InfoBox>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-primary" />

              <h3 className="font-semibold">
                Sản phẩm ({orderItems.length})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2">
                      Sản phẩm
                    </th>

                    <th className="text-right pr-2">
                      Đơn giá
                    </th>

                    <th className="text-right pr-2">
                      SL
                    </th>

                    <th className="text-right">
                      Thành tiền
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {orderItems.map((item: any) => {
                    const p = (
                      data?.products ?? []
                    ).find(
                      (x: any) =>
                        x.id === item.product_id,
                    );

                    return (
                      <tr
                        key={
                          item.id ??
                          item.product_id
                        }
                        className="border-b last:border-0"
                      >
                        <td className="py-2 pr-2 font-medium">
                          {p?.name ??
                            item.product_id}
                        </td>

                        <td className="text-right pr-2 text-muted-foreground">
                          {fmt(item.unit_price)}
                        </td>

                        <td className="text-right pr-2">
                          {item.qty}
                        </td>

                        <td className="text-right font-medium">
                          {fmt(item.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold mb-3">
              Thanh toán
            </h3>

            <div className="space-y-2 text-sm">
              <Row
                label="Tạm tính"
                value={fmt(order.subtotal)}
              />

              {order.discount > 0 && (
                <Row
                  label="Giảm giá"
                  value={`- ${fmt(order.discount)}`}
                  cls="text-red-600"
                />
              )}

              <Row
                label="Tổng tiền hàng"
                value={fmt(order.total)}
              />

              <div className="border-t pt-2 flex items-center justify-between text-base font-bold text-primary">
                <span>Đã thanh toán</span>

                <span>{fmt(order.total)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Dialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
      >
        <DialogContent className="          h-[100dvh]
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
          sm:rounded-2xl" style={{ overflow: 'scroll' }}>
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <CornerUpLeft className="h-5 w-5 text-purple-600" />
              Trả hàng / Rollback
            </DialogTitle>

            <DialogDescription>
              Chọn sản phẩm cần trả lại kho
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="border-r">
              <div className="border-b bg-muted/20 px-6 py-4">
                <div className="font-semibold">
                  {order.code}
                </div>

                <div className="mt-1 text-sm text-muted-foreground">
                  {new Date().toLocaleString(
                    "vi-VN",
                  )}
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-6 space-y-3">
                {returnItems.map((item, idx) => {
                  const lineReturn =
                    item.unit_price *
                    item.return_qty;

                  return (
                    <div
                      key={idx}
                      className="rounded-2xl border bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            {item.product_name}
                          </div>

                          <div className="mt-1 text-xs text-muted-foreground">
                            Đơn giá:{" "}
                            {fmt(
                              item.unit_price,
                            )}{" "}
                            · Đã mua:{" "}
                            {item.max_qty}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">
                            Thành tiền
                          </div>

                          <div className="font-semibold">
                            {fmt(lineReturn)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end">
                        <div className="flex items-center overflow-hidden rounded-full border bg-slate-50">
                          <button
                            type="button"
                            className="px-3 py-2 hover:bg-slate-100"
                            onClick={() => {
                              const next = [
                                ...returnItems,
                              ];

                              next[
                                idx
                              ].return_qty =
                                Math.max(
                                  0,
                                  next[idx]
                                    .return_qty - 1,
                                );

                              setReturnItems(
                                next,
                              );
                            }}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>

                          <div className="w-16 text-center font-semibold">
                            {item.return_qty}
                          </div>

                          <button
                            type="button"
                            className="px-3 py-2 hover:bg-slate-100"
                            onClick={() => {
                              const next = [
                                ...returnItems,
                              ];

                              next[
                                idx
                              ].return_qty =
                                Math.min(
                                  item.max_qty,
                                  next[idx]
                                    .return_qty + 1,
                                );

                              setReturnItems(
                                next,
                              );
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white">
              <div className="border-b px-6 py-5">
                <div className="text-lg font-semibold">
                  {cust?.name ?? "Khách lẻ"}
                </div>

                <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    Trả hàng /
                  </span>{" "}
                  {order.code}
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {(() => {
                  const summary =
                    calcReturnSummary(
                      returnItems,
                    );

                  const needRefund =
                    Math.max(
                      0,
                      summary.totalReturned -
                        summary.discountAllocated -
                        parseInput(
                          returnFee,
                        ) +
                        parseInput(
                          otherRefund,
                        ),
                    );

                  return (
                    <>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Tổng giá gốc
                          </span>

                          <span>
                            {fmt(
                              summary.totalOriginal,
                            )}
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Tổng tiền hàng trả
                          </span>

                          <span>
                            {fmt(
                              summary.totalReturned,
                            )}
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Giảm giá
                          </span>

                          <span>
                            {fmt(
                              summary.discountAllocated,
                            )}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">
                            Phí trả hàng
                          </span>

                          <Input
                            className="h-9 w-32 text-right"
                            value={fmtInput(
                              returnFee,
                            )}
                            onChange={(e) =>
                              setReturnFee(
                                e.target.value,
                              )
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">
                            Hoàn trả thu khác
                          </span>

                          <Input
                            className="h-9 w-32 text-right"
                            value={fmtInput(
                              otherRefund,
                            )}
                            onChange={(e) =>
                              setOtherRefund(
                                e.target.value,
                              )
                            }
                          />
                        </div>

                        <div className="border-t pt-3 flex justify-between text-base">
                          <span className="font-semibold">
                            Cần trả khách
                          </span>

                          <span className="font-bold text-primary">
                            {fmt(needRefund)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <Label className="mb-2 block">
                          Tiền trả khách
                        </Label>

                        <Input
                          className="h-11 text-right text-lg font-semibold"
                          value={fmtInput(
                            refundAmount,
                          )}
                          onChange={(e) =>
                            setRefundAmount(
                              e.target.value,
                            )
                          }
                        />
                      </div>

                      <div>
                        <Label className="mb-2 block">
                          Ghi chú
                        </Label>

                        <Input
                          placeholder="Lý do trả hàng..."
                          value={returnNote}
                          onChange={(e) =>
                            setReturnNote(
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="mt-auto border-t p-6">
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setReturnOpen(false)
                    }
                  >
                    Hủy
                  </Button>

                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={submitReturn}
                    disabled={isReturning}
                  >
                    {isReturning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CornerUpLeft className="mr-2 h-4 w-4" />
                    )}

                    Xác nhận trả hàng
                  </Button>
                </DialogFooter>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function InfoBox({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>

      <div className="text-sm">
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  cls = "",
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">
        {label}
      </span>

      <span className={cls}>
        {value}
      </span>
    </div>
  );
}

export default OrderDetailPage;