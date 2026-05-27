// @ts-nocheck
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getCustomerById, upsertCustomer, collectCustomerPayment } from "@/lib/customers.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Phone,
  MapPin,
  TrendingDown,
  TrendingUp,
  Pencil,
  ExternalLink,
  ShoppingBag,
  Clock,
  User,
  Banknote,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers/$id")({
  head: () => ({ meta: [{ title: "Chi tiết khách hàng — QuatTran POS" }] }),
  component: CustomerDetailPage,
});

const groupLabel: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};

const groupColor: Record<string, string> = {
  le: "bg-gray-100 text-gray-700",
  dai_ly: "bg-blue-100 text-blue-700",
  vip: "bg-yellow-100 text-yellow-700",
  cong_trinh: "bg-purple-100 text-purple-700",
};

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

const PROVINCES = [
  "An Giang",
  "Bà Rịa - Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

type FormState = {
  id?: string;
  name: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  address: string;
  group_name: string;
  debt: string;
};

function CustomerDetailPage() {
  const { id } = useParams({ from: "/customers/$id" });
  const qc = useQueryClient();

  const getCustomer = useServerFn(getCustomerById);
  const upsert = useServerFn(upsertCustomer);
  const collectPaymentFn = useServerFn(collectCustomerPayment);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    enabled: !!id,
    queryFn: () => getCustomer({ data: { id: id! } }),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payBranch, setPayBranch] = useState("");
  const [submittingPay, setSubmittingPay] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: "",
    phone: "",
    province: "",
    district: "",
    ward: "",
    address: "",
    group_name: "le",
    debt: "0",
  });

  const customer = data?.customer ?? null;
  const customerOrders = data?.orders ?? [];
  const completedOrders = customerOrders.filter(
    (o: any) => o.status === "completed"
  );
  const pendingOrders = customerOrders.filter(
    (o: any) => o.status !== "completed" && o.status !== "cancelled"
  );
  const cancelledOrders = customerOrders.filter(
    (o: any) => o.status === "cancelled"
  );
  const totalSpent = completedOrders.reduce(
    (s: number, o: any) => s + Number(o.total || 0),
    0
  );

  function startEdit() {
    if (!customer) return;
    setForm({
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      province: customer.province ?? "",
      district: customer.district ?? "",
      ward: customer.ward ?? "",
      address: customer.address ?? "",
      group_name: customer.group_name,
      debt: String(customer.debt ?? 0),
    });
    setEditOpen(true);
  }

  function fmtInput(val: string): string {
    const num = val.replace(/\D/g, "");
    if (!num) return "";
    return new Intl.NumberFormat("vi-VN").format(Number(num));
  }

  function parseInput(val: string): number {
    return Number(val.replace(/\D/g, "")) || 0;
  }

  function openPayDialog() {
    setPayAmount("");
    setPayNote("");
    setPayOpen(true);
  }

  async function handleCollectPayment() {
    const amount = parseInput(payAmount);
    if (amount <= 0) return toast.error("Nhập số tiền cần thu");
    setSubmittingPay(true);
    try {
      const result = await collectPaymentFn({
        data: {
          customer_id: customer.id,
          amount,
          branch_id: payBranch || customer.branch_id || "",
          note: payNote || undefined,
        },
      });
      toast.success(`Đã tạo phiếu thu ${result.code} — Còn nợ: ${fmt(result.new_debt)}`);
      setPayOpen(false);
      qc.invalidateQueries({ queryKey: ["customer-detail", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tạo phiếu thu");
    } finally {
      setSubmittingPay(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsert({ data: { ...form, debt: Number(form.debt) || 0 } });
      toast.success("Đã cập nhật khách hàng!");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["customer-detail", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  if (isLoading) {
    return (
      <AppShell title="Chi tiết khách hàng">
        <div className="text-muted-foreground py-16 text-center">
          Đang tải...
        </div>
      </AppShell>
    );
  }

  if (!customer) {
    return (
      <AppShell title="Chi tiết khách hàng">
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">Không tìm thấy khách hàng.</p>
          <Link to="/customers">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Quay lại
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={customer.name}>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/customers" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Khách hàng
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{customer.name}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={startEdit}>
          <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa
        </Button>
        {Number(customer.debt || 0) > 0 && (
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={openPayDialog}>
            <Banknote className="h-4 w-4 mr-1" /> Thu tiền
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{customer.name}</h2>
                <span className={`text-xs rounded-full px-2 py-0.5 ${groupColor[customer.group_name]}`}>
                  {groupLabel[customer.group_name]}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4 shrink-0" />
                <span>{customer.phone ?? "Chưa có số điện thoại"}</span>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {[customer.address, customer.ward, customer.district, customer.province]
                    .filter(Boolean)
                    .join(", ") || "Chưa có địa chỉ"}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold mb-3">Thống kê</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <ShoppingBag className="h-4 w-4" /> Tổng đơn hàng
                </span>
                <span className="font-semibold">{customerOrders.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Đã hoàn tất</span>
                <span className="font-semibold text-green-600">{completedOrders.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Đang chờ</span>
                <span className="font-semibold text-yellow-600">{pendingOrders.length}</span>
              </div>
              <div className="border-t pt-3 flex justify-between items-center">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" /> Tổng chi tiêu
                </span>
                <span className="font-bold text-primary">{fmt(totalSpent)}</span>
              </div>
              {Number(customer.debt || 0) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="h-4 w-4 text-destructive" /> Công nợ
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-destructive">{fmt(customer.debt)}</span>
                    <button
                      onClick={openPayDialog}
                      className="text-xs text-green-700 border border-green-300 bg-green-50 hover:bg-green-100 rounded px-1.5 py-0.5 font-medium"
                    >
                      Thu tiền
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {pendingOrders.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-yellow-600" />
                <h3 className="font-semibold">
                  Đơn đang chờ / đặt hàng ({pendingOrders.length})
                </h3>
              </div>
              <OrderTable orders={pendingOrders} />
            </Card>
          )}

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">
                Hóa đơn đã hoàn tất ({completedOrders.length})
              </h3>
            </div>
            {completedOrders.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Chưa có hóa đơn hoàn tất
              </div>
            ) : (
              <OrderTable orders={completedOrders} />
            )}
          </Card>

          {cancelledOrders.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="font-semibold text-muted-foreground">
                  Đơn đã hủy ({cancelledOrders.length})
                </h3>
              </div>
              <OrderTable orders={cancelledOrders} />
            </Card>
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa khách hàng</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>Tên *</Label>
              <Input
                className="mt-1"
                value={form.name}
                required
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Điện thoại</Label>
              <Input
                className="mt-1"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Tỉnh / Thành phố</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.province}
                onChange={(e) =>
                  setForm({ ...form, province: e.target.value, district: "", ward: "" })
                }
              >
                <option value="">— Chọn tỉnh/thành phố —</option>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Quận / Huyện</Label>
              <Input
                className="mt-1"
                placeholder="Nhập quận/huyện"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
              />
            </div>
            <div>
              <Label>Phường / Xã</Label>
              <Input
                className="mt-1"
                placeholder="Nhập phường/xã"
                value={form.ward}
                onChange={(e) => setForm({ ...form, ward: e.target.value })}
              />
            </div>
            <div>
              <Label>Địa chỉ chi tiết</Label>
              <Input
                className="mt-1"
                placeholder="Số nhà, tên đường..."
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div>
              <Label>Nhóm</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.group_name}
                onChange={(e) => setForm({ ...form, group_name: e.target.value })}
              >
                {Object.entries(groupLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Công nợ (₫)</Label>
              <Input
                className="mt-1"
                type="number"
                value={form.debt}
                onChange={(e) => setForm({ ...form, debt: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Hủy
              </Button>
              <Button type="submit">Lưu</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Thu tiền Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <Banknote className="h-5 w-5" /> Thu tiền từ khách
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm flex justify-between">
              <span className="text-muted-foreground">Công nợ hiện tại</span>
              <span className="font-bold text-destructive">{fmt(customer.debt)}</span>
            </div>
            <div>
              <Label>Số tiền thu (₫) *</Label>
              <Input
                className="mt-1"
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(fmtInput(e.target.value))}
                onFocus={(e) => e.target.select()}
                placeholder="Nhập số tiền..."
              />
            </div>
            <div>
              <Label>Ghi chú</Label>
              <Input
                className="mt-1"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Nội dung thu tiền..."
              />
            </div>
            {parseInput(payAmount) > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Còn lại sau khi thu</span>
                <span className="font-bold text-green-700">{fmt(Math.max(0, Number(customer.debt) - parseInput(payAmount)))}</span>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setPayOpen(false)}>
              Hủy
            </Button>
            <Button
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
              onClick={handleCollectPayment}
              disabled={submittingPay}
            >
              <Banknote className="h-4 w-4 mr-1" />
              {submittingPay ? "Đang xử lý..." : "Xác nhận thu tiền"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function OrderTable({ orders }: { orders: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[420px]">
        <thead className="text-left text-muted-foreground border-b">
          <tr>
            <th className="py-2 pr-2">Mã đơn</th>
            <th className="pr-2">Ngày</th>
            <th className="pr-2">Trạng thái</th>
            <th className="text-right pr-2">Tổng tiền</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o: any) => (
            <tr key={o.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="py-2 pr-2 font-mono text-xs font-medium">{o.code}</td>
              <td className="pr-2 text-xs text-muted-foreground whitespace-nowrap">
                {new Date(o.created_at).toLocaleDateString("vi-VN")}
              </td>
              <td className="pr-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                    STATUS_COLOR[o.status] ?? "bg-secondary"
                  }`}
                >
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
              </td>
              <td className="text-right pr-2 font-medium">
                {new Intl.NumberFormat("vi-VN").format(o.total)} ₫
              </td>
              <td className="text-right">
                <Link
                  to="/orders/$id"
                  params={{ id: o.id }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  title="Xem chi tiết đơn"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}