import {
  createFileRoute,
  useParams,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { listOrders, updateOrderStatus, updateOrder } from "@/lib/orders.functions";
import { getSettings } from "@/lib/settings.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  CalendarDays,
  Receipt,
  Clock,
  CheckCircle2,
  Package,
  User,
  Building2,
  UserCog,
  FileText,
  ExternalLink,
  Pencil,
  X,
  Plus,
  Save,
  Ban,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { SCHEDULE_TYPES } from "@/lib/types";

export const Route = createFileRoute("/orders/$id")({
  head: () => ({ meta: [{ title: "Chi tiết đơn hàng — QuatTran POS" }] }),
  component: OrderDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất",
  reserved: "Đặt hàng",
  draft: "Nháp",
  cancelled: "Hủy",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  reserved: "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-100 text-red-700",
};

const SCHEDULE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Chờ duyệt", color: "bg-yellow-100 text-yellow-700" },
  approved: { label: "Đã duyệt", color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "Đang làm", color: "bg-orange-100 text-orange-700" },
  done: { label: "Hoàn thành", color: "bg-green-100 text-green-700" },
  cancelled: { label: "Đã hủy", color: "bg-gray-100 text-gray-700" },
};

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

function OrderDetailPage() {
  const { id } = useParams({ from: "/orders/$id" });
  const { isAdmin } = useAuth();
  const listFn = useServerFn(listOrders);
  const updateStatusFn = useServerFn(updateOrderStatus);
  const updateOrderFn = useServerFn(updateOrder);
  const getSettingsFn = useServerFn(getSettings);
  const qc = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["orders"],
    queryFn: () => listFn(),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: siteSettings } = useQuery({
    queryKey: ["site_settings"],
    queryFn: () => getSettingsFn(),
  });

  const [completingOrder, setCompletingOrder] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);

  const order = useMemo(
    () => (data?.orders ?? []).find((o: any) => o.id === id),
    [data, id]
  );
  const orderItems = useMemo(
    () => (data?.items ?? []).filter((i: any) => i.order_id === id),
    [data, id]
  );
  const linkedSchedules = useMemo(
    () => (data?.schedules ?? []).filter((s: any) => s.order_id === id),
    [data, id]
  );

  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<LineItem[]>([]);
  const [editCustomer, setEditCustomer] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editEmployee, setEditEmployee] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState<"tien_mat" | "ngan_hang">("tien_mat");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editDeposit, setEditDeposit] = useState("0");
  const [editNote, setEditNote] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!order) return;
    setEditItems(
      orderItems.map((i: any) => ({
        product_id: i.product_id,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: i.discount ?? 0,
      }))
    );
    setEditCustomer(order.customer_id ?? "");
    setEditBranch(order.branch_id ?? "");
    setEditEmployee(order.employee_id ?? "");
    setEditStatus(order.status);
    setEditPaymentMethod(order.payment_method ?? "tien_mat");
    setEditDiscount(String(order.discount ?? 0));
    setEditDeposit(String(order.deposit ?? 0));
    setEditNote(order.note ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (editItems.length === 0) return toast.error("Đơn chưa có sản phẩm");
    setSaving(true);
    try {
      await updateOrderFn({
        data: {
          id,
          customer_id: editCustomer || undefined,
          branch_id: editBranch,
          employee_id: editEmployee || undefined,
          status: editStatus,
          payment_method: editPaymentMethod,
          discount: parseInput(editDiscount),
          deposit: parseInput(editDeposit),
          paid: 0,
          note: editNote || undefined,
          items: editItems,
        },
      });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await refetch();

      toast.success("Đã cập nhật đơn hàng");
      setEditing(false);

      navigate({
        to: "/orders",
        replace: true,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }

  function addEditItem() {
    const p = (data?.products ?? [])[0];
    if (!p) return;
    setEditItems([
      ...editItems,
      { product_id: p.id, qty: 1, unit_price: (p as any).sale_price, discount: 0 },
    ]);
  }

  const editSubtotal = useMemo(
    () => editItems.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [editItems]
  );
  const editTotal = Math.max(0, editSubtotal - parseInput(editDiscount));
  const khachCanThanhToanEdit = Math.max(0, editTotal - parseInput(editDeposit));

  async function completeOrder() {
    const stock = data?.stock ?? [];
    const branchId = order.branch_id;
    const shortages: string[] = [];

    for (const item of orderItems) {
      const available = stock
        .filter((s: any) => s.product_id === item.product_id && s.branch_id === branchId)
        .reduce((sum: number, s: any) => sum + Number(s.qty || 0), 0);

      const needed = Number(item.qty || 0);

      if (available < needed) {
        const prod = (data?.products ?? []).find((p: any) => p.id === item.product_id);
        shortages.push(`${prod?.name ?? item.product_id}: cần ${needed}, còn ${available}`);
      }
    }

    if (shortages.length > 0) {
      toast.error("Không đủ hàng để hoàn tất:\n" + shortages.join(" | "), { duration: 6000 });
      return;
    }

    setCompletingOrder(true);
    try {
      await updateStatusFn({ data: { id: order.id, status: "completed" } });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await refetch();

      toast.success("Đã hoàn tất đơn " + order.code);

      navigate({
        to: "/orders",
        replace: true,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi hoàn tất đơn");
    } finally {
      setCompletingOrder(false);
    }
  }

  async function cancelOrder() {
    if (!confirm("Hủy đơn hàng này?")) return;

    setCancellingOrder(true);
    try {
      await updateStatusFn({ data: { id: order.id, status: "cancelled" } });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await refetch();

      toast.success("Đã hủy đơn " + order.code);

      navigate({
        to: "/orders",
        replace: true,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi hủy đơn");
    } finally {
      setCancellingOrder(false);
    }
  }

  function printOrderSlip() {
    if (!order) return;
    const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
    const custObj = (data?.customers ?? []).find((c: any) => c.id === order.customer_id);
    const branchObj = (data?.branches ?? []).find((b: any) => b.id === order.branch_id);
    const empObj = (data?.employees ?? []).find((e: any) => e.id === order.employee_id);
    const statusLabels: Record<string, string> = {
      completed: "Hoàn tất",
      reserved: "Đặt hàng (chưa giao)",
      draft: "Nháp",
    };

    const rows = orderItems
      .map((item: any, i: number) => {
        const prod = (data?.products ?? []).find((p: any) => p.id === item.product_id);
        const lineTotal = item.qty * item.unit_price - (item.discount ?? 0);
        return `<tr>
          <td style="text-align:center;padding:8px;border:1px solid #ddd">${i + 1}</td>
          <td style="padding:8px;border:1px solid #ddd">${prod?.name ?? item.product_id}</td>
          <td style="text-align:center;padding:8px;border:1px solid #ddd">${item.qty}</td>
          <td style="text-align:right;padding:8px;border:1px solid #ddd">${moneyFmt(item.unit_price)}</td>
          <td style="text-align:right;padding:8px;border:1px solid #ddd">${moneyFmt(lineTotal)}</td>
        </tr>`;
      })
      .join("");

    const pw = window.open("", "_blank");
    if (!pw) return;

    pw.document.write(`<!DOCTYPE html><html><head><title>Phiếu đặt hàng</title>
    <style>*{box-sizing:border-box;font-family:Arial,sans-serif}body{padding:40px;color:#111}
    .header{text-align:center;margin-bottom:28px}.title{font-size:26px;font-weight:700;margin-bottom:6px}
    .sub{color:#666;font-size:13px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:9px;font-size:14px}
    th{background:#f5f5f5;text-align:left}.total-box{margin-top:18px;text-align:right;font-size:14px}
    .total-main{font-size:22px;font-weight:700;margin-top:4px}.sign{margin-top:60px;display:grid;grid-template-columns:1fr 1fr;gap:40px;text-align:center}
    .sign-box{padding-top:10px}@media print{body{padding:0}}</style></head><body>
    <div class="header">
    ${(siteSettings as any)?.logo_url ? `<img src="${(siteSettings as any).logo_url}" alt="Logo" style="height:60px;object-fit:contain;margin-bottom:8px" />` : ""}
    ${(siteSettings as any)?.site_name ? `<div style="font-size:15px;font-weight:600;color:#444;margin-bottom:4px">${(siteSettings as any).site_name}</div>` : ""}
    <div class="title">PHIẾU ĐẶT HÀNG</div>
    <div class="sub">Ngày: ${new Date(order.created_at).toLocaleDateString("vi-VN")} &nbsp;|&nbsp; Mã phiếu: ${order.code} &nbsp;|&nbsp; Trạng thái: ${statusLabels[order.status] ?? order.status}${(siteSettings as any)?.phone ? ` &nbsp;|&nbsp; ĐT: ${(siteSettings as any).phone}` : ""}</div></div>
    <div class="info-grid">
      <div><strong>Khách hàng:</strong> ${custObj?.name ?? "Khách lẻ"}</div>
      <div><strong>Chi nhánh:</strong> ${branchObj?.name ?? "—"}</div>
      <div><strong>Nhân viên:</strong> ${empObj?.name ?? "—"}</div>
      <div><strong>Hình thức thanh toán:</strong> ${order.payment_method === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt"}</div>
    </div>
    <table><thead><tr>
      <th style="width:50px;text-align:center">STT</th>
      <th>Sản phẩm</th>
      <th style="width:70px;text-align:center">SL</th>
      <th style="width:130px;text-align:right">Đơn giá</th>
      <th style="width:140px;text-align:right">Thành tiền</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="total-box">
      <div>Tạm tính: ${moneyFmt(order.subtotal)}</div>
      ${order.discount > 0 ? `<div>Giảm giá: - ${moneyFmt(order.discount)}</div>` : ""}
      <div>Tổng tiền: ${moneyFmt(order.total)}</div>
      ${order.deposit > 0 ? `<div style="color:#b45309;margin-top:4px">Đặt cọc: - ${moneyFmt(order.deposit)}</div>` : ""}
      <div class="total-main" style="color:#15803d;margin-top:8px">Khách cần thanh toán: ${moneyFmt(Math.max(0, order.total - order.deposit))}</div>
    </div>
    ${order.note ? `<div style="margin-top:20px;font-size:14px"><strong>Ghi chú:</strong> ${order.note}</div>` : ""}
    <div class="sign">
      <div class="sign-box"><div>Người lập phiếu</div><div style="margin-top:60px;font-weight:600">....................</div></div>
      <div class="sign-box"><div>Khách hàng xác nhận</div><div style="margin-top:60px">....................</div></div>
    </div>
    </body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
  }

  if (isLoading) {
    return (
      <AppShell title="Chi tiết đơn hàng">
        <div className="text-muted-foreground py-16 text-center">Đang tải...</div>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell title="Chi tiết đơn hàng">
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">Không tìm thấy đơn hàng.</p>
          <Link to="/orders">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Quay lại
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const cust = (data?.customers ?? []).find((c: any) => c.id === order.customer_id);
  const branch = (data?.branches ?? []).find((b: any) => b.id === order.branch_id);
  const emp = (data?.employees ?? []).find((e: any) => e.id === order.employee_id);

  return (
    <AppShell title={`Đơn hàng ${order.code}`}>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/orders" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Bán hàng
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium font-mono">{order.code}</span>

        {isAdmin && !editing && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={startEdit}>
            <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa đơn
          </Button>
        )}

        {editing && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              <X className="h-4 w-4 mr-1" /> Hủy
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm text-orange-800 flex items-center gap-2">
          <Pencil className="h-4 w-4 shrink-0" />
          Bạn đang chỉnh sửa đơn hàng. Nhớ nhấn <strong className="mx-1">Lưu thay đổi</strong> để áp dụng.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Receipt className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold font-mono">{order.code}</h2>

                  {!editing ? (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[order.status] ?? "bg-secondary"
                      }`}
                    >
                      {STATUS_LABEL[order.status]}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="h-7 rounded-full border bg-background px-3 text-xs"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                      >
                        <option value="completed">Hoàn tất</option>
                        <option value="reserved">Đặt hàng (chưa giao)</option>
                        <option value="draft">Nháp</option>
                        <option value="cancelled">Hủy</option>
                      </select>

                      <select
                        className="h-7 rounded-full border bg-background px-3 text-xs"
                        value={editPaymentMethod}
                        onChange={(e) => setEditPaymentMethod(e.target.value as any)}
                      >
                        <option value="tien_mat">Tiền mặt</option>
                        <option value="ngan_hang">Chuyển khoản (Ngân hàng)</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(order.created_at).toLocaleString("vi-VN")}
                </div>
              </div>

              {!editing && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={printOrderSlip}>
                    <Printer className="h-4 w-4 mr-1" /> In hóa đơn
                  </Button>

                  {isAdmin && (order.status === "reserved" || order.status === "draft") && (
                    <Button size="sm" onClick={completeOrder} disabled={completingOrder}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {completingOrder ? "Đang xử lý..." : "Hoàn tất"}
                    </Button>
                  )}

                  {isAdmin && order.status !== "cancelled" && (
                    <Button size="sm" variant="destructive" onClick={cancelOrder} disabled={cancellingOrder}>
                      <Ban className="h-4 w-4 mr-1" />
                      {cancellingOrder ? "Đang hủy..." : "Hủy đơn"}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {!editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <InfoBox icon={<User className="h-4 w-4" />} label="Khách hàng">
                  {cust ? (
                    <div>
                      <Link
                        to="/customers/$id"
                        params={{ id: cust.id }}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {cust.name}
                      </Link>
                      {cust.phone && <div className="text-xs text-muted-foreground">{cust.phone}</div>}
                      {(cust.address || cust.district) && (
                        <div className="text-xs text-muted-foreground">
                          {[cust.address, cust.ward, cust.district, cust.province]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Khách lẻ</span>
                  )}
                </InfoBox>

                <InfoBox icon={<Building2 className="h-4 w-4" />} label="Chi nhánh">
                  <span className="font-medium">{branch?.name ?? "—"}</span>
                </InfoBox>

                <InfoBox icon={<UserCog className="h-4 w-4" />} label="Nhân viên bán">
                  {emp ? (
                    <Link to="/employees" className="font-medium hover:text-primary hover:underline">
                      {emp.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </InfoBox>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Khách hàng</Label>
                  <SearchableSelect
                    value={editCustomer}
                    onChange={setEditCustomer}
                    emptyLabel="Khách lẻ"
                    placeholder="Tìm khách hàng..."
                    options={(data?.customers ?? []).map((c: any) => ({
                      value: c.id,
                      label: c.name,
                      sub: c.phone ?? undefined,
                    }))}
                  />
                </div>

                <div>
                  <Label>Chi nhánh</Label>
                  <SearchableSelect
                    value={editBranch}
                    onChange={setEditBranch}
                    placeholder="Tìm chi nhánh..."
                    options={(data?.branches ?? []).map((b: any) => ({
                      value: b.id,
                      label: b.name,
                    }))}
                  />
                </div>

                <div>
                  <Label>Nhân viên</Label>
                  <SearchableSelect
                    value={editEmployee}
                    onChange={setEditEmployee}
                    emptyLabel="—"
                    placeholder="Tìm nhân viên..."
                    options={(data?.employees ?? []).map((e: any) => ({
                      value: e.id,
                      label: e.name,
                    }))}
                  />
                </div>

                <div>
                  <Label>Ghi chú</Label>
                  <Input className="mt-1" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                </div>
              </div>
            )}

            {!editing && order.note && (
              <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-sm flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span>{order.note}</span>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">
                  Sản phẩm ({editing ? editItems.length : orderItems.length})
                </h3>
              </div>

              {editing && (
                <Button size="sm" variant="outline" onClick={addEditItem}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm SP
                </Button>
              )}
            </div>

            {!editing ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-2">Sản phẩm</th>
                      <th className="text-right pr-2">Đơn giá</th>
                      <th className="text-right pr-2">SL</th>
                      <th className="text-right pr-2">CK</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems.map((item: any) => {
                      const p = (data?.products ?? []).find((x: any) => x.id === item.product_id);
                      return (
                        <tr key={item.id ?? item.product_id} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-medium">{p?.name ?? item.product_id}</td>
                          <td className="text-right pr-2 text-muted-foreground">{fmt(item.unit_price)}</td>
                          <td className="text-right pr-2">{item.qty}</td>
                          <td className="text-right pr-2 text-muted-foreground">
                            {item.discount > 0 ? `- ${fmt(item.discount)}` : "—"}
                          </td>
                          <td className="text-right font-medium">{fmt(item.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-2">
                {editItems.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">Chưa có sản phẩm.</div>
                )}

                {editItems.map((item, idx) => {
                  const lineTotal = item.qty * item.unit_price - item.discount;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                      <div className="col-span-5">
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(val) => {
                            const p = (data?.products ?? []).find((x: any) => x.id === val);
                            const next = [...editItems];
                            next[idx] = {
                              ...next[idx],
                              product_id: val,
                              unit_price: (p as any)?.sale_price ?? 0,
                            };
                            setEditItems(next);
                          }}
                          placeholder="Chọn sản phẩm..."
                          options={(data?.products ?? []).map((p: any) => ({
                            value: p.id,
                            label: p.name,
                            sub: p.sku ?? undefined,
                          }))}
                        />
                      </div>

                      <Input
                        type="number"
                        className="col-span-1"
                        placeholder="SL"
                        value={item.qty}
                        onChange={(e) => {
                          const n = [...editItems];
                          n[idx].qty = Number(e.target.value);
                          setEditItems(n);
                        }}
                      />

                      <Input
                        className="col-span-3"
                        placeholder="Đơn giá"
                        value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                        onChange={(e) => {
                          const n = [...editItems];
                          n[idx].unit_price = parseInput(e.target.value);
                          setEditItems(n);
                        }}
                      />

                      <div className="col-span-2 text-right text-xs font-medium text-muted-foreground">
                        {fmt(lineTotal)}
                      </div>

                      <button
                        type="button"
                        className="col-span-1 flex items-center justify-center rounded-md border hover:text-destructive p-1"
                        onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold mb-3">Thanh toán</h3>

            {!editing ? (
              <div className="space-y-2 text-sm">
                <Row label="Tạm tính" value={fmt(order.subtotal)} />
                {order.discount > 0 && <Row label="Giảm giá" value={`- ${fmt(order.discount)}`} cls="text-red-600" />}
                <Row label="Tổng tiền hàng" value={fmt(order.total)} />
                <Row
                  label="Hình thức thanh toán"
                  value={order.payment_method === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt"}
                />
                {order.deposit > 0 && <Row label="Đặt cọc" value={`- ${fmt(order.deposit)}`} cls="text-yellow-700" />}
                <div className="border-t pt-2 flex justify-between font-bold text-base text-primary">
                  <span>Khách cần thanh toán</span>
                  <span>{fmt(Math.max(0, order.total - order.deposit))}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-muted/40 px-3 py-2 flex justify-between text-sm">
                  <span>Tạm tính</span>
                  <span className="font-medium">{fmt(editSubtotal)}</span>
                </div>

                <div>
                  <Label>Giảm giá (₫)</Label>
                  <Input
                    className="mt-1"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(fmtInput(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                <div className="rounded-md px-3 py-2 flex justify-between font-medium">
                  <span>Tổng tiền hàng</span>
                  <span>{fmt(editTotal)}</span>
                </div>

                <div>
                  <Label>Đặt cọc (₫)</Label>
                  <Input
                    className="mt-1"
                    value={editDeposit}
                    onChange={(e) => setEditDeposit(fmtInput(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                <div className="rounded-md bg-primary/5 px-3 py-2 flex justify-between font-bold text-primary mt-2 border border-primary/20">
                  <span>Khách cần thanh toán</span>
                  <span>{fmt(khachCanThanhToanEdit)}</span>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Lịch lắp đặt</h3>
              {linkedSchedules.length > 0 && (
                <span className="ml-auto text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                  {linkedSchedules.length} lịch
                </span>
              )}
            </div>

            {linkedSchedules.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">Chưa có lịch lắp đặt</div>
            ) : (
              <div className="space-y-2">
                {linkedSchedules.map((s: any) => {
                  const typeInfo = SCHEDULE_TYPES.find((t) => t.value === s.type);
                  const statusInfo = SCHEDULE_STATUS_LABELS[s.status];
                  const assignees = (data?.schedule_assignments ?? []).filter((a: any) => a.schedule_id === s.id);

                  return (
                    <div key={s.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="font-medium leading-snug">{s.title}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusInfo?.color}`}>
                          {statusInfo?.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {typeInfo && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${typeInfo.color}`}>
                            {typeInfo.label}
                          </span>
                        )}

                        {s.scheduled_date && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(s.scheduled_date).toLocaleDateString("vi-VN")}
                            {s.scheduled_time && ` ${s.scheduled_time}`}
                          </span>
                        )}
                      </div>

                      {assignees.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {assignees.map((a: any) => {
                            const u = (data?.users ?? []).find((u: any) => u.id === a.user_id);
                            return (
                              <span
                                key={a.user_id}
                                className="text-xs bg-muted rounded-full px-2 py-0.5"
                              >
                                {u?.full_name ?? "?"}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <Link
                        to="/schedule"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                      >
                        <ExternalLink className="h-3 w-3" /> Xem trong Lịch làm việc
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
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
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm">{children}</div>
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
      <span className="text-muted-foreground">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}