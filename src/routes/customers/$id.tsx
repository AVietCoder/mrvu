// @ts-nocheck
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { getCustomerById, upsertCustomer, collectCustomerPayment } from "@/lib/customers.functions";
import { getSettings } from "@/lib/settings.functions";
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
  DialogDescription,
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
  Mail,
  Building2,
  CreditCard,
  Wallet,
  Landmark,
  FileText,
  CalendarDays,
  Users,
  Receipt,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

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
  "An Giang","Bà Rịa - Vũng Tàu","Bắc Giang","Bắc Kạn","Bạc Liêu","Bắc Ninh","Bến Tre",
  "Bình Định","Bình Dương","Bình Phước","Bình Thuận","Cà Mau","Cần Thơ","Cao Bằng","Đà Nẵng",
  "Đắk Lắk","Đắk Nông","Điện Biên","Đồng Nai","Đồng Tháp","Gia Lai","Hà Giang","Hà Nam",
  "Hà Nội","Hà Tĩnh","Hải Dương","Hải Phòng","Hậu Giang","Hòa Bình","Hưng Yên","Khánh Hòa",
  "Kiên Giang","Kon Tum","Lai Châu","Lâm Đồng","Lạng Sơn","Lào Cai","Long An","Nam Định",
  "Nghệ An","Ninh Bình","Ninh Thuận","Phú Thọ","Phú Yên","Quảng Bình","Quảng Nam","Quảng Ngãi",
  "Quảng Ninh","Quảng Trị","Sóc Trăng","Sơn La","Tây Ninh","Thái Bình","Thái Nguyên","Thanh Hóa",
  "Thừa Thiên Huế","Tiền Giang","TP. Hồ Chí Minh","Trà Vinh","Tuyên Quang","Vĩnh Long","Vĩnh Phúc","Yên Bái",
];

type EditFormState = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  gender: string;
  birthday: string;
  province: string;
  ward: string;
  address: string;
  group_name: string;
  customer_type: "ca_nhan" | "to_chuc";
  company_name: string;
  tax_code: string;
  cccd: string;
  passport_no: string;
  bank_name: string;
  bank_account: string;
  note: string;
  debt: string;
};

function CustomerDetailPage() {
  const { id } = useParams({ from: "/customers/$id" });
  const qc = useQueryClient();
  const { isAdmin, user } = useAuth();

  const getCustomer = useServerFn(getCustomerById);
  const upsert = useServerFn(upsertCustomer);
  const collectPaymentFn = useServerFn(collectCustomerPayment);
  const getSettingsFn = useServerFn(getSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    enabled: !!id,
    queryFn: () => getCustomer({ data: { id: id! } }),
  });

  const { data: siteSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettingsFn(),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "payments">("orders");
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payBranch, setPayBranch] = useState("");
  const [payFundType, setPayFundType] = useState<"tien_mat" | "ngan_hang">("tien_mat");
  const [bankAccountIdx, setBankAccountIdx] = useState<string>("");
  const [bankContent, setBankContent] = useState("");
  const [submittingPay, setSubmittingPay] = useState(false);

  const [form, setForm] = useState<EditFormState>({
    name: "",
    phone: "",
    email: "",
    gender: "",
    birthday: "",
    province: "",
    ward: "",
    address: "",
    group_name: "le",
    customer_type: "ca_nhan",
    company_name: "",
    tax_code: "",
    cccd: "",
    passport_no: "",
    bank_name: "",
    bank_account: "",
    note: "",
    debt: "0",
  });

  const customer = data?.customer ?? null;
  const customerOrders = data?.orders ?? [];
  const allBranches = data?.branches ?? [];
  const paymentHistory = data?.paymentHistory ?? [];
  const allUsers = data?.users ?? [];

  const branches = isAdmin || !user?.branch_ids?.length
    ? allBranches
    : allBranches.filter((b: any) => user.branch_ids.includes(b.id));

  const completedOrders = customerOrders.filter((o: any) => o.status === "completed");
  const pendingOrders = customerOrders.filter((o: any) => o.status !== "completed" && o.status !== "cancelled");
  const cancelledOrders = customerOrders.filter((o: any) => o.status === "cancelled");
  const totalSpent = completedOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const totalPaid = paymentHistory.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  const creatorName = useMemo(() => {
    if (!customer?.created_by) return null;
    return allUsers.find((u: any) => u.id === customer.created_by)?.full_name ?? null;
  }, [customer, allUsers]);

  function fmtInput(val: string): string {
    const num = val.replace(/\D/g, "");
    if (!num) return "";
    return new Intl.NumberFormat("vi-VN").format(Number(num));
  }

  function parseInput(val: string): number {
    return Number(val.replace(/\D/g, "")) || 0;
  }

  function startEdit() {
    if (!customer) return;
    setForm({
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      gender: customer.gender ?? "",
      birthday: customer.birthday ? customer.birthday.slice(0, 10) : "",
      province: customer.province ?? "",
      ward: customer.ward ?? "",
      address: customer.address ?? "",
      group_name: customer.group_name ?? "le",
      customer_type: customer.customer_type ?? "ca_nhan",
      company_name: customer.company_name ?? "",
      tax_code: customer.tax_code ?? "",
      cccd: customer.cccd ?? "",
      passport_no: customer.passport_no ?? "",
      bank_name: customer.bank_name ?? "",
      bank_account: customer.bank_account ?? "",
      note: customer.note ?? "",
      debt: String(customer.debt ?? 0),
    });
    setEditOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsert({
        data: {
          ...form,
          debt: Number(form.debt) || 0,
          _actor_id: user?.id,
        },
      });
      toast.success("Đã cập nhật khách hàng!");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["customer-detail", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  function openPayDialog() {
    setPayAmount("");
    setPayNote("");
    setPayFundType("tien_mat");
    const defaultBranch =
      customer?.branch_id ||
      (branches.length === 1 ? branches[0].id : "") ||
      user?.branch_ids?.[0] || "";
    setPayBranch(defaultBranch);
    setBankAccountIdx("");
    setBankContent("");
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
          fund_type: payFundType,
          employee_id: user?.id,
          note: payNote || (payFundType === "ngan_hang" && bankContent ? `CK: ${bankContent}` : undefined),
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

  if (isLoading) {
    return (
      <AppShell title="Chi tiết khách hàng">
        <div className="text-muted-foreground py-16 text-center">Đang tải...</div>
      </AppShell>
    );
  }

  if (!customer) {
    return (
      <AppShell title="Chi tiết khách hàng">
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">Không tìm thấy khách hàng.</p>
          <Link to="/customers">
            <Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Quay lại</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={customer.name}>
      {/* Breadcrumb + actions */}
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
        )}      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          {/* Profile card */}
          <Card>
            <div className="flex items-start gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{customer.name}</h2>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className={`text-xs rounded-full px-2 py-0.5 ${groupColor[customer.group_name] ?? "bg-gray-100 text-gray-700"}`}>
                    {groupLabel[customer.group_name] ?? customer.group_name}
                  </span>
                  {customer.customer_type === "to_chuc" && (
                    <span className="text-xs rounded-full px-2 py-0.5 bg-indigo-100 text-indigo-700">Tổ chức</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {customer.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0" />
                  <span>{customer.phone}</span>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  <span>{customer.email}</span>
                </div>
              )}
              {(customer.address || customer.province) && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {[customer.address, customer.ward, customer.province]
                      .filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
              {customer.gender && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4 shrink-0" />
                  <span>{customer.gender === "nam" ? "Nam" : "Nữ"}</span>
                </div>
              )}
              {customer.birthday && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  <span>{new Date(customer.birthday).toLocaleDateString("vi-VN")}</span>
                </div>
              )}
            </div>

            {/* Extra info if to_chuc */}
            {customer.customer_type === "to_chuc" && (customer.company_name || customer.tax_code) && (
              <div className="mt-3 pt-3 border-t space-y-1.5 text-sm">
                {customer.company_name && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span>{customer.company_name}</span>
                  </div>
                )}
                {customer.tax_code && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span>MST: {customer.tax_code}</span>
                  </div>
                )}
              </div>
            )}

            {/* CCCD/Passport for ca_nhan */}
            {customer.customer_type !== "to_chuc" && (customer.cccd || customer.passport_no) && (
              <div className="mt-3 pt-3 border-t space-y-1.5 text-sm">
                {customer.cccd && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CreditCard className="h-4 w-4 shrink-0" />
                    <span>CCCD: {customer.cccd}</span>
                  </div>
                )}
                {customer.passport_no && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CreditCard className="h-4 w-4 shrink-0" />
                    <span>HC: {customer.passport_no}</span>
                  </div>
                )}
              </div>
            )}

            {/* Bank info */}
            {(customer.bank_name || customer.bank_account) && (
              <div className="mt-3 pt-3 border-t space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Landmark className="h-4 w-4 shrink-0" />
                  <span>
                    {[customer.bank_name, customer.bank_account].filter(Boolean).join(" — ")}
                  </span>
                </div>
              </div>
            )}

            {/* Note */}
            {customer.note && (
              <div className="mt-3 pt-3 border-t text-sm text-muted-foreground italic">
                {customer.note}
              </div>
            )}

            {/* Creator info */}
            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-0.5">
              {creatorName && (
                <div>Người tạo: <span className="font-medium text-foreground">{creatorName}</span></div>
              )}
              {customer.created_at && (
                <div>Ngày tạo: <span className="font-medium text-foreground">
                  {new Date(customer.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </span></div>
              )}
            </div>
          </Card>

          {/* Stats card */}
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
              {paymentHistory.length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Receipt className="h-4 w-4 text-green-600" /> Đã thanh toán
                  </span>
                  <span className="font-semibold text-green-600">{fmt(totalPaid)}</span>
                </div>
              )}
              {Number(customer.debt || 0) !== 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    {Number(customer.debt) < 0 ? "Thanh toán thừa" : "Công nợ"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${Number(customer.debt) < 0 ? "text-green-600" : "text-destructive"}`}>
                      {Number(customer.debt) < 0 ? `+${fmt(Math.abs(customer.debt))}` : fmt(customer.debt)}
                    </span>
                    {Number(customer.debt) > 0 && (
                      <button
                        onClick={openPayDialog}
                        className="text-xs text-green-700 border border-green-300 bg-green-50 hover:bg-green-100 rounded px-1.5 py-0.5 font-medium"
                      >
                        Thu tiền
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-2 space-y-4">
          {pendingOrders.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-yellow-600" />
                <h3 className="font-semibold">Đơn đang chờ / đặt hàng ({pendingOrders.length})</h3>
              </div>
              <OrderTable orders={pendingOrders} />
            </Card>
          )}

          {/* Tab: Đơn hàng | Lịch sử thanh toán */}
          <Card>
            <div className="flex gap-1 border-b mb-4">
              <button
                onClick={() => setActiveTab("orders")}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "orders"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <ShoppingBag className="h-4 w-4" />
                Hóa đơn đã hoàn tất ({completedOrders.length})
              </button>
              <button
                onClick={() => setActiveTab("payments")}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                  activeTab === "payments"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Receipt className="h-4 w-4" />
                Lịch sử thu tiền ({paymentHistory.length})
              </button>
            </div>

            {activeTab === "orders" ? (
              completedOrders.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Chưa có hóa đơn hoàn tất</div>
              ) : (
                <OrderTable orders={completedOrders} />
              )
            ) : (
              paymentHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Chưa có lịch sử thu tiền</div>
              ) : (
                <PaymentHistoryTable payments={paymentHistory} users={allUsers} />
              )
            )}
          </Card>

          {cancelledOrders.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="font-semibold text-muted-foreground">Đơn đã hủy ({cancelledOrders.length})</h3>
              </div>
              <OrderTable orders={cancelledOrders} />
            </Card>
          )}
        </div>
      </div>

      {/* ─── Edit Dialog (full fields) ─── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent style={{ padding: 0 }} className="max-h-[92vh] max-w-2xl overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 bg-muted/40 border-b">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <User className="h-5 w-5" />
              </div>
              Cập nhật thông tin khách hàng
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="p-4 space-y-5">
            {/* Loại khách hàng */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <User className="h-4 w-4" /> Thông tin cơ bản
              </div>
              <div className="flex gap-4">
                {(["ca_nhan", "to_chuc"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="customer_type_edit"
                      value={t}
                      checked={form.customer_type === t}
                      onChange={() => setForm({ ...form, customer_type: t })}
                      className="accent-primary"
                    />
                    {t === "ca_nhan" ? "Cá nhân" : "Tổ chức / Hộ kinh doanh"}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1">
                  <Label className="text-xs font-medium">
                    {form.customer_type === "to_chuc" ? "Tên người mua" : "Họ và tên"} <span className="text-destructive">*</span>
                  </Label>
                  <Input className="bg-background mt-1" value={form.name} required autoFocus
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số điện thoại</Label>
                  <Input className="bg-background mt-1" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>

              {form.customer_type === "ca_nhan" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Email</Label>
                      <Input className="bg-background mt-1" placeholder="email@gmail.com" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Giới tính</Label>
                      <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                        <option value="">-- Chọn --</option>
                        <option value="nam">Nam</option>
                        <option value="nu">Nữ</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Ngày sinh</Label>
                      <Input type="date" className="bg-background mt-1" value={form.birthday}
                        onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Nhóm đối tác</Label>
                      <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })}>
                        {Object.entries(groupLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Số CCCD / CMND</Label>
                      <Input className="bg-background mt-1" value={form.cccd}
                        onChange={(e) => setForm({ ...form, cccd: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Số hộ chiếu</Label>
                      <Input className="bg-background mt-1" value={form.passport_no}
                        onChange={(e) => setForm({ ...form, passport_no: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {form.customer_type === "to_chuc" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Tên công ty / Hộ kinh doanh</Label>
                      <Input className="bg-background mt-1" value={form.company_name}
                        onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Mã số thuế</Label>
                      <Input className="bg-background mt-1" value={form.tax_code}
                        onChange={(e) => setForm({ ...form, tax_code: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Email</Label>
                      <Input className="bg-background mt-1" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Nhóm đối tác</Label>
                      <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })}>
                        {Object.entries(groupLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-medium">Ghi chú</Label>
                <Input className="bg-background mt-1" value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>

            {/* Địa chỉ */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <MapPin className="h-4 w-4" /> Địa chỉ liên hệ
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tỉnh / Thành phố</Label>
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
                    <option value="">-- Chọn tỉnh thành --</option>
                    {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Phường / Xã</Label>
                  <Input className="bg-background mt-1" placeholder="Nhập phường/xã"
                    value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Số nhà, tên đường</Label>
                <Input className="bg-background mt-1" placeholder="Ví dụ: Số 123, đường Trần Hưng Đạo"
                  value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>

            {/* Ngân hàng */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <Landmark className="h-4 w-4" /> Thông tin ngân hàng
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Ngân hàng</Label>
                  <Input className="bg-background mt-1" placeholder="VD: Vietcombank..." value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số tài khoản</Label>
                  <Input className="bg-background mt-1 font-mono" value={form.bank_account}
                    onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Công nợ */}
            <div className="space-y-4 p-5 bg-muted/30 rounded-xl border">
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                <Wallet className="h-4 w-4" /> Công nợ
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Dư nợ hiện tại</Label>
                <div className="relative mt-1">
                  <Input className="pl-8 bg-background font-medium text-destructive" inputMode="numeric"
                    value={form.debt}
                    onChange={(e) => setForm({ ...form, debt: e.target.value.replace(/[^\d.]/g, "") })} />
                  <div className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">đ</div>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-3 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Hủy bỏ</Button>
              <Button type="submit" className="px-6">Lưu thông tin</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Thu tiền Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
              <Input className="mt-1" autoFocus value={payAmount}
                onChange={(e) => setPayAmount(fmtInput(e.target.value))}
                onFocus={(e) => e.target.select()}
                placeholder="Nhập số tiền..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hình thức thanh toán</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={payFundType}
                  onChange={(e) => { setPayFundType(e.target.value as any); setBankAccountIdx(""); setBankContent(""); }}>
                  <option value="tien_mat">Tiền mặt</option>
                  <option value="ngan_hang">Chuyển khoản (Ngân hàng)</option>
                </select>
              </div>
              <div>
                <Label>Chi nhánh</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={payBranch} onChange={(e) => setPayBranch(e.target.value)}>
                  <option value="">-- Mặc định --</option>
                  {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>

            {payFundType === "ngan_hang" && (() => {
              const bankList: any[] = (() => {
                try { return JSON.parse(siteSettings?.bank_accounts || "[]"); } catch { return []; }
              })();
              return (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                  {bankList.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Tài khoản nhận tiền</Label>
                      <select className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                        value={bankAccountIdx}
                        onChange={(e) => {
                          const idx = e.target.value;
                          setBankAccountIdx(idx);
                          if (idx !== "") {
                            const ba = bankList[parseInt(idx)];
                            if (ba && !bankContent) setBankContent(`${siteSettings?.site_name ?? "CK"} ${ba.account_number}`);
                          }
                        }}>
                        <option value="">— Chọn STK —</option>
                        {bankList.map((ba: any, i: number) => (
                          <option key={i} value={String(i)}>{ba.bank} - {ba.account_number} ({ba.account_name})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">Nội dung chuyển khoản</Label>
                    <div className="mt-1 relative">
                      <Input value={bankContent} onChange={(e) => setBankContent(e.target.value)}
                        placeholder="VD: THUTIEN NGUYEN VAN A" className="pr-12 font-mono text-sm" />
                      {bankContent && (
                        <button type="button" className="absolute right-2 top-2 text-xs text-primary hover:underline"
                          onClick={() => { navigator.clipboard.writeText(bankContent); toast.success("Đã copy!"); }}>
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div>
              <Label>Ghi chú</Label>
              <Input className="mt-1" value={payNote} onChange={(e) => setPayNote(e.target.value)}
                placeholder="Nội dung thu tiền..." />
            </div>
            {parseInput(payAmount) > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Còn lại sau khi thu</span>
                <span className="font-bold text-green-700">
                  {fmt(Math.max(0, Number(customer.debt) - parseInput(payAmount)))}
                </span>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setPayOpen(false)}>Hủy</Button>
            <Button className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
              onClick={handleCollectPayment} disabled={submittingPay}>
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
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? "bg-secondary"}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
              </td>
              <td className="text-right pr-2 font-medium">
                {new Intl.NumberFormat("vi-VN").format(o.total)} ₫
              </td>
              <td className="text-right">
                <Link to="/orders/$id" params={{ id: o.id }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
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

function PaymentHistoryTable({ payments, users }: { payments: any[]; users: any[] }) {
  const getUserName = (id: string) => users.find((u: any) => u.id === id)?.full_name ?? "—";
  const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[420px]">
        <thead className="text-left text-muted-foreground border-b">
          <tr>
            <th className="py-2 pr-2">Mã phiếu</th>
            <th className="pr-2">Ngày</th>
            <th className="pr-2">Hình thức</th>
            <th className="pr-2">Người thu</th>
            <th className="pr-2">Ghi chú</th>
            <th className="text-right pr-2">Số tiền</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p: any) => (
            <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="py-2 pr-2 font-mono text-xs font-medium text-green-700">{p.code}</td>
              <td className="pr-2 text-xs text-muted-foreground whitespace-nowrap">
                {new Date(p.created_at).toLocaleDateString("vi-VN")}
              </td>
              <td className="pr-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {p.fund_type === "ngan_hang"
                    ? <><Landmark className="h-3 w-3" />Ngân hàng</>
                    : <><Wallet className="h-3 w-3" />Tiền mặt</>}
                </span>
              </td>
              <td className="pr-2 text-xs text-muted-foreground">
                {getUserName(p.collector_user_id)}
              </td>
              <td className="pr-2 text-xs text-muted-foreground max-w-[150px] truncate">{p.note ?? "—"}</td>
              <td className="text-right pr-2 font-bold text-green-600">
                +{moneyFmt(p.amount)} ₫
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
