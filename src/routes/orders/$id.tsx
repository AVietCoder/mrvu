import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { listOrders, updateOrderStatus } from "@/lib/orders.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, CalendarDays, Receipt, Clock,
  CheckCircle2, Package, User, Building2, UserCog, FileText,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { SCHEDULE_TYPES } from "@/lib/types";

export const Route = createFileRoute("/orders/$id")({
  head: () => ({ meta: [{ title: "Chi tiết đơn hàng — QuatTran POS" }] }),
  component: OrderDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất", reserved: "Đặt trước",
  draft: "Nháp", cancelled: "Hủy",
};
const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  reserved: "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-100 text-red-700",
};
const SCHEDULE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Chờ duyệt",  color: "bg-yellow-100 text-yellow-700" },
  approved:    { label: "Đã duyệt",   color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "Đang làm",   color: "bg-orange-100 text-orange-700" },
  done:        { label: "Hoàn thành", color: "bg-green-100 text-green-700" },
  cancelled:   { label: "Đã hủy",     color: "bg-gray-100 text-gray-700" },
};

function OrderDetailPage() {
  const { id } = useParams({ from: "/orders/$id" });
  const { isAdmin } = useAuth();
  const listFn = useServerFn(listOrders);
  const updateStatusFn = useServerFn(updateOrderStatus);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["orders"], queryFn: () => listFn() });

  const order = useMemo(() => (data?.orders ?? []).find((o: any) => o.id === id), [data, id]);
  const items = useMemo(() => (data?.items ?? []).filter((i: any) => i.order_id === id), [data, id]);
  const linkedSchedules = useMemo(
    () => (data?.schedules ?? []).filter((s: any) => s.order_id === id),
    [data, id],
  );

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
          <Link to="/orders"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Quay lại</Button></Link>
        </div>
      </AppShell>
    );
  }

  const cust = (data?.customers ?? []).find((c: any) => c.id === order.customer_id);
  const branch = (data?.branches ?? []).find((b: any) => b.id === order.branch_id);
  const emp = (data?.employees ?? []).find((e: any) => e.id === order.employee_id);

  async function completeOrder() {
    await updateStatusFn({ data: { id: order.id, status: "completed" } });
    toast.success("Đã hoàn tất đơn " + order.code);
    qc.invalidateQueries({ queryKey: ["orders"] });
  }

  async function cancelOrder() {
    if (!confirm("Hủy đơn hàng này?")) return;
    await updateStatusFn({ data: { id: order.id, status: "cancelled" } });
    toast.success("Đã hủy đơn " + order.code);
    qc.invalidateQueries({ queryKey: ["orders"] });
  }

  return (
    <AppShell title={`Đơn hàng ${order.code}`}>
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/orders" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Bán hàng
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{order.code}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cột trái: thông tin đơn hàng + sản phẩm */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header đơn hàng */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Receipt className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold font-mono">{order.code}</h2>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status] ?? "bg-secondary"}`}>
                    {STATUS_LABEL[order.status]}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(order.created_at).toLocaleString("vi-VN")}
                </div>
              </div>

              {/* Actions — admin */}
              {isAdmin && (
                <div className="flex gap-2 flex-wrap">
                  {(order.status === "reserved" || order.status === "draft") && (
                    <Button size="sm" onClick={completeOrder}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Hoàn tất
                    </Button>
                  )}
                  {order.status !== "cancelled" && order.status !== "completed" && (
                    <Button size="sm" variant="destructive" onClick={cancelOrder}>Hủy đơn</Button>
                  )}
                </div>
              )}
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoBox icon={<User className="h-4 w-4" />} label="Khách hàng">
                {cust ? (
                  <div>
                    <div className="font-medium">{cust.name}</div>
                    {cust.phone && <div className="text-xs text-muted-foreground">{cust.phone}</div>}
                    {(cust.address || cust.district) && (
                      <div className="text-xs text-muted-foreground">
                        {[cust.address, cust.ward, cust.district, cust.province].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                ) : <span className="text-muted-foreground">Khách lẻ</span>}
              </InfoBox>

              <InfoBox icon={<Building2 className="h-4 w-4" />} label="Chi nhánh">
                <span className="font-medium">{branch?.name ?? "—"}</span>
              </InfoBox>

              <InfoBox icon={<UserCog className="h-4 w-4" />} label="Nhân viên bán">
                <span className="font-medium">{emp?.name ?? "—"}</span>
              </InfoBox>
            </div>

            {order.note && (
              <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-sm flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span>{order.note}</span>
              </div>
            )}
          </Card>

          {/* Sản phẩm */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Sản phẩm ({items.length})</h3>
            </div>
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
                  {items.map((item: any) => {
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
          </Card>
        </div>

        {/* Cột phải: thanh toán + lịch lắp đặt */}
        <div className="space-y-4">
          {/* Tóm tắt thanh toán */}
          <Card>
            <h3 className="font-semibold mb-3">Thanh toán</h3>
            <div className="space-y-2 text-sm">
              <Row label="Tạm tính" value={fmt(order.subtotal)} />
              {order.discount > 0 && <Row label="Giảm giá" value={`- ${fmt(order.discount)}`} cls="text-red-600" />}
              <div className="border-t pt-2 flex justify-between font-bold text-base">
                <span>Tổng cộng</span>
                <span className="text-primary">{fmt(order.total)}</span>
              </div>
              {order.deposit > 0 && <Row label="Đặt cọc" value={fmt(order.deposit)} cls="text-yellow-700" />}
              {order.paid > 0 && <Row label="Đã thanh toán" value={fmt(order.paid)} cls="text-green-700" />}
              {(() => {
                const remaining = order.total - order.paid;
                return remaining > 0 ? (
                  <div className="rounded-md bg-red-50 px-3 py-2 flex justify-between text-red-700 font-medium">
                    <span>Còn nợ</span><span>{fmt(remaining)}</span>
                  </div>
                ) : null;
              })()}
            </div>
          </Card>

          {/* Lịch lắp đặt liên kết */}
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
              <div className="text-sm text-muted-foreground text-center py-4">
                Chưa có lịch lắp đặt nào
              </div>
            ) : (
              <div className="space-y-2">
                {linkedSchedules.map((s: any) => {
                  const typeInfo = SCHEDULE_TYPES.find((t) => t.value === s.type);
                  const statusInfo = SCHEDULE_STATUS_LABELS[s.status];
                  const assignees = (data?.schedule_assignments ?? [])
                    .filter((a: any) => a.schedule_id === s.id);
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
                              <span key={a.user_id} className="text-xs bg-muted rounded-full px-2 py-0.5">
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

function InfoBox({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}{label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}
