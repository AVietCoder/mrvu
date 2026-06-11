// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  searchCompletedOrders,
  getOrderForQuickReturn,
  createReturnOrder,
} from "@/lib/orders.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  RotateCcw,
  Search,
  Package,
  User,
  Building2,
  ChevronRight,
  X,
  Plus,
  Minus,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "@tanstack/react-router";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export const Route = createFileRoute("/quick-return")({
  head: () => ({ meta: [{ title: "Trả hàng nhanh — Mr.Vũ" }] }),
  component: QuickReturnPage,
});

type LineItem = {
  product_id: string;
  qty: number;
  unit_price: number;
  discount: number;
};

function fmtInput(val: string): string {
  const num = val.replace(/\D/g, "");
  if (!num) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(num));
}

function parseInput(val: string): number {
  return Number(val.replace(/\D/g, "")) || 0;
}

// ─── Bước hiển thị ───────────────────────────────────────────────────────────
type Step = "search" | "review" | "done";

function QuickReturnPage() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const searchFn = useServerFn(searchCompletedOrders);
  const detailFn = useServerFn(getOrderForQuickReturn);
  const createReturnFn = useServerFn(createReturnOrder);

  // ── Bảo vệ: chỉ admin ────────────────────────────────────────────────────
  useEffect(() => {
    if (isAdmin === false) {
      navigate({ to: "/" });
    }
  }, [isAdmin, navigate]);

  // ── Bước ─────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("search");

  // ── Bước 1: tìm đơn ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQ = useDebouncedValue(searchQuery, 300);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ["quickReturnSearch", debouncedQ],
    queryFn: () => searchFn({ data: { q: debouncedQ } }),
    enabled: debouncedQ.length >= 2,
    staleTime: 10_000,
  });
  const searchResults = searchData?.orders ?? [];

  // ── Bước 2: chi tiết đơn + form trả ─────────────────────────────────────
  const { data: orderDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["quickReturnDetail", selectedOrderId],
    queryFn: () => detailFn({ data: { id: selectedOrderId! } }),
    enabled: !!selectedOrderId,
    staleTime: 30_000,
  });

  const [returnItems, setReturnItems] = useState<LineItem[]>([]);
  const [returnDiscount, setReturnDiscount] = useState("0");
  const [returnNote, setReturnNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Bước 3: kết quả ──────────────────────────────────────────────────────
  const [doneCode, setDoneCode] = useState("");

  // Khi tải xong chi tiết đơn, điền sẵn toàn bộ sản phẩm
  useEffect(() => {
    if (orderDetail?.items && orderDetail.items.length > 0) {
      setReturnItems(
        orderDetail.items.map((i: any) => ({
          product_id: i.product_id,
          qty: i.qty,
          unit_price: i.unit_price,
          discount: i.discount ?? 0,
        }))
      );
      setReturnDiscount(String(orderDetail.order?.discount ?? 0));
      setReturnNote("");
    }
  }, [orderDetail]);

  function selectOrder(id: string) {
    setSelectedOrderId(id);
    setStep("review");
  }

  function goBackToSearch() {
    setStep("search");
    setSelectedOrderId(null);
    setReturnItems([]);
    setReturnDiscount("0");
    setReturnNote("");
  }

  function resetAll() {
    setStep("search");
    setSelectedOrderId(null);
    setSearchQuery("");
    setReturnItems([]);
    setReturnDiscount("0");
    setReturnNote("");
    setDoneCode("");
  }

  const returnSubtotal = useMemo(
    () => returnItems.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [returnItems]
  );
  const returnTotal = Math.max(0, returnSubtotal - parseInput(returnDiscount));

  async function submitReturn() {
    if (returnItems.length === 0) return toast.error("Chưa có sản phẩm trả");
    if (!selectedOrderId || !orderDetail?.order) return;
    setSubmitting(true);
    try {
      const result = await createReturnFn({
        data: {
          original_order_id: selectedOrderId,
          items: returnItems,
          discount: parseInput(returnDiscount),
          refunded_to_customer: 0,
          note: returnNote || undefined,
          branch_id: orderDetail.order.branch_id,
          customer_id: orderDetail.order.customer_id || undefined,
          employee_id: orderDetail.order.employee_id || undefined,
          actor_id: user?.id,
        },
      });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      setDoneCode(result.code);
      setStep("done");
      toast.success(`Đã tạo phiếu trả hàng ${result.code}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tạo phiếu trả hàng");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell title="Trả hàng nhanh">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Breadcrumb steps */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={resetAll}
            className={step === "search" ? "text-foreground font-medium" : "hover:text-foreground"}
          >
            Tìm đơn
          </button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className={step === "review" ? "text-foreground font-medium" : step === "done" ? "" : "opacity-40"}>
            Xác nhận trả
          </span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className={step === "done" ? "text-green-600 font-medium" : "opacity-40"}>
            Hoàn tất
          </span>
        </div>

        {/* ── BƯỚC 1: TÌM ĐƠN ─────────────────────────────────────────────── */}
        {step === "search" && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <RotateCcw className="h-5 w-5 text-orange-600" />
              <h2 className="font-semibold text-base">Tìm đơn hàng cần trả</h2>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9 h-11 text-base"
                placeholder="Nhập mã đơn (VD: HD000123) hoặc tên / SĐT khách..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground mt-3 text-center py-4">
                Không tìm thấy đơn hoàn tất nào khớp với "{searchQuery}"
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {searchResults.length} đơn tìm thấy — chọn đơn cần trả hàng:
                </p>
                {searchResults.map((order: any) => (
                  <button
                    key={order.id}
                    onClick={() => selectOrder(order.id)}
                    className="w-full text-left rounded-lg border bg-card hover:bg-muted/50 hover:border-orange-300 transition-colors p-3 flex items-center justify-between gap-3 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-orange-700">{order.code}</span>
                        <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                          Hoàn tất
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 truncate">
                        {order.customer_id ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 inline" />
                            {order.customer_name ?? order.customer_id}
                          </span>
                        ) : (
                          <span className="italic">Khách lẻ</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(order.created_at).toLocaleDateString("vi-VN")}
                        {" · "}
                        <span className="font-medium text-foreground">{fmt(order.total)}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length === 0 && (
              <div className="mt-6 rounded-lg bg-orange-50 border border-orange-100 p-4 text-sm text-orange-800">
                <p className="font-medium mb-1">💡 Hướng dẫn:</p>
                <ul className="space-y-1 text-orange-700">
                  <li>• Nhập mã đơn hàng: <span className="font-mono">HD000123</span></li>
                  <li>• Nhập tên khách: <span className="font-mono">Nguyễn Văn A</span></li>
                  <li>• Nhập số điện thoại: <span className="font-mono">0901234567</span></li>
                </ul>
                <p className="mt-2 text-xs text-orange-600">
                  Chỉ hiển thị đơn đã hoàn tất. Quyền thực hiện: Quản trị viên.
                </p>
              </div>
            )}
          </Card>
        )}

        {/* ── BƯỚC 2: XEM & XÁC NHẬN TRẢ HÀNG ────────────────────────────── */}
        {step === "review" && (
          <>
            <button
              onClick={goBackToSearch}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Quay lại tìm đơn
            </button>

            {loadingDetail ? (
              <Card className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Đang tải chi tiết đơn...</span>
              </Card>
            ) : orderDetail ? (
              <>
                {/* Thông tin đơn gốc */}
                <Card className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">Đơn gốc: </span>
                    <Link
                      to="/orders/$id"
                      params={{ id: selectedOrderId! }}
                      className="text-primary hover:underline font-mono font-semibold"
                    >
                      {orderDetail.order.code}
                    </Link>
                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                      Hoàn tất
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {orderDetail.customer && (
                      <div className="flex items-start gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                        <div>
                          <div className="text-xs text-muted-foreground">Khách hàng</div>
                          <div className="font-medium">{orderDetail.customer.name}</div>
                          {orderDetail.customer.phone && (
                            <div className="text-xs text-muted-foreground">{orderDetail.customer.phone}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {orderDetail.order.branch_id && (
                      <div className="flex items-start gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                        <div>
                          <div className="text-xs text-muted-foreground">Chi nhánh</div>
                          <div className="font-medium">
                            {orderDetail.branches?.find((b: any) => b.id === orderDetail.order.branch_id)?.name ?? "—"}
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-muted-foreground">Ngày tạo</div>
                      <div>{new Date(orderDetail.order.created_at).toLocaleDateString("vi-VN")}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Tổng đơn gốc</div>
                      <div className="font-semibold">{fmt(orderDetail.order.total)}</div>
                    </div>
                  </div>
                </Card>

                {/* Form trả hàng */}
                <Card className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-orange-600" />
                      <span className="font-semibold">Sản phẩm trả hàng</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const p = orderDetail.products?.[0];
                        if (!p) return;
                        setReturnItems([
                          ...returnItems,
                          { product_id: p.id, qty: 1, unit_price: p.sale_price ?? 0, discount: 0 },
                        ]);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Thêm SP
                    </Button>
                  </div>

                  {returnItems.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-3">
                      Chưa có sản phẩm.
                    </div>
                  )}

                  <div className="space-y-2">
                    {returnItems.map((item, idx) => {
                      const lineTotal = item.qty * item.unit_price - item.discount;
                      const prod = orderDetail.products?.find((p: any) => p.id === item.product_id);
                      return (
                        <div key={idx} className="rounded-lg border bg-muted/10 p-2.5 space-y-2">
                          {/* Row 1: sản phẩm + xóa */}
                          <div className="flex gap-2 items-center">
                            <div className="flex-1">
                              <SearchableSelect
                                value={item.product_id}
                                onChange={(val) => {
                                  const p = (orderDetail.products ?? []).find((x: any) => x.id === val);
                                  const next = [...returnItems];
                                  next[idx] = {
                                    ...next[idx],
                                    product_id: val,
                                    unit_price: p?.sale_price ?? 0,
                                  };
                                  setReturnItems(next);
                                }}
                                placeholder="Chọn sản phẩm..."
                                options={(orderDetail.products ?? []).map((p: any) => ({
                                  value: p.id,
                                  label: p.name,
                                  sub: p.sku ?? undefined,
                                }))}
                              />
                            </div>
                            <button
                              type="button"
                              className="flex items-center justify-center rounded-md border hover:text-destructive p-1.5 shrink-0"
                              onClick={() => setReturnItems(returnItems.filter((_, i) => i !== idx))}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          {/* Row 2: SL + giá + tổng */}
                          <div className="flex gap-2 items-center">
                            <div className="shrink-0">
                              <Label className="text-xs text-muted-foreground block mb-0.5">Số lượng</Label>
                              <div className="flex items-center border rounded-md overflow-hidden w-28">
                                <button
                                  type="button"
                                  className="px-2 py-1.5 hover:bg-muted border-r text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    const n = [...returnItems];
                                    n[idx].qty = Math.max(1, n[idx].qty - 1);
                                    setReturnItems(n);
                                  }}
                                >－</button>
                                <input
                                  type="number"
                                  className="w-10 text-center text-sm py-1.5 bg-background border-0 outline-none [appearance:textfield] font-semibold"
                                  value={item.qty}
                                  min={1}
                                  onChange={(e) => {
                                    const n = [...returnItems];
                                    n[idx].qty = Math.max(1, Number(e.target.value) || 1);
                                    setReturnItems(n);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="px-2 py-1.5 hover:bg-muted border-l text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    const n = [...returnItems];
                                    n[idx].qty = n[idx].qty + 1;
                                    setReturnItems(n);
                                  }}
                                >＋</button>
                              </div>
                            </div>
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground block mb-0.5">Đơn giá</Label>
                              <Input
                                className="h-9"
                                value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                                onChange={(e) => {
                                  const n = [...returnItems];
                                  n[idx].unit_price = parseInput(e.target.value);
                                  setReturnItems(n);
                                }}
                              />
                            </div>
                            <div className="text-right shrink-0 min-w-[80px]">
                              <Label className="text-xs text-muted-foreground block mb-0.5">Thành tiền</Label>
                              <div className="text-sm font-semibold text-orange-700">{fmt(lineTotal)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Giảm giá + ghi chú */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Giảm giá trên phiếu trả (₫)</Label>
                      <Input
                        className="mt-1"
                        value={returnDiscount}
                        onChange={(e) => setReturnDiscount(fmtInput(e.target.value))}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                    <div>
                      <Label>Ghi chú / Lý do trả</Label>
                      <Input
                        className="mt-1"
                        value={returnNote}
                        onChange={(e) => setReturnNote(e.target.value)}
                        placeholder="VD: Hàng lỗi, sai màu..."
                      />
                    </div>
                  </div>

                  {/* Tóm tắt */}
                  <div className="rounded-lg border p-3 bg-orange-50/40 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tạm tính</span>
                      <span>{fmt(returnSubtotal)}</span>
                    </div>
                    {parseInput(returnDiscount) > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Giảm giá</span>
                        <span>- {fmt(parseInput(returnDiscount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-orange-800 border-t pt-1.5">
                      <span>Giá trị hàng trả</span>
                      <span>{fmt(returnTotal)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      Hàng trả sẽ được hoàn lại kho. Không ghi nhận tiền.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" className="flex-1" onClick={goBackToSearch}>
                      Hủy
                    </Button>
                    <Button
                      className="flex-1 bg-orange-600 hover:bg-orange-700"
                      onClick={submitReturn}
                      disabled={submitting || returnItems.length === 0}
                    >
                      {submitting ? (
                        <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Đang tạo...</>
                      ) : (
                        <><RotateCcw className="h-4 w-4 mr-1" />Xác nhận trả hàng</>
                      )}
                    </Button>
                  </div>
                </Card>
              </>
            ) : null}
          </>
        )}

        {/* ── BƯỚC 3: HOÀN TẤT ─────────────────────────────────────────────── */}
        {step === "done" && (
          <Card className="text-center py-8 space-y-4">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Trả hàng thành công!</h2>
              <p className="text-muted-foreground mt-1">
                Phiếu trả hàng <span className="font-mono font-semibold text-orange-700">{doneCode}</span> đã được tạo.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Hàng đã được hoàn lại kho.
              </p>
            </div>
            <div className="flex justify-center gap-3 flex-wrap">
              <Button variant="outline" onClick={resetAll}>
                <RotateCcw className="h-4 w-4 mr-1" /> Trả hàng tiếp
              </Button>
              <Link to="/orders">
                <Button variant="outline">
                  <Package className="h-4 w-4 mr-1" /> Về danh sách đơn
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
