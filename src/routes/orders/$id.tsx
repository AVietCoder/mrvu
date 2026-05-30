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
import { listOrders, updateOrderStatus, updateOrder, createReturnOrder } from "@/lib/orders.functions";
import { updateScheduleOrderLink } from "@/lib/schedule.functions";
import { getSettings } from "@/lib/settings.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchableSelect } from "@/components/SearchableSelect";
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
  RotateCcw,
  Percent,
  Link2,
  Link2Off,
  AlertTriangle,
  PackageX,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { SCHEDULE_TYPES } from "@/lib/types";

export const Route = createFileRoute("/orders/$id")({
  head: () => ({ meta: [{ title: "Chi tiết đơn hàng — Mr.Vũ" }] }),
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
  const { isAdmin, user } = useAuth();
  const listFn = useServerFn(listOrders);
  const updateStatusFn = useServerFn(updateOrderStatus);
  const updateOrderFn = useServerFn(updateOrder);
  const createReturnFn = useServerFn(createReturnOrder);
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

  const updateScheduleLinkFn = useServerFn(updateScheduleOrderLink);

  const [completingOrder, setCompletingOrder] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);

  // ── Payment dialog state ──────────────────────────────────────────────────
  const [payOpen, setPayOpen] = useState(false);
  const [payMethodTab, setPayMethodTab] = useState<"tien_mat" | "ngan_hang">("tien_mat");
  const [payAmountRaw, setPayAmountRaw] = useState("");
  const [payBankIdx, setPayBankIdx] = useState("");
  const [shortageOpen, setShortageOpen] = useState(false);
  const [shortageItems, setShortageItems] = useState<{name: string; needed: number; available: number}[]>([]);

  // Return order state
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnItems, setReturnItems] = useState<LineItem[]>([]);
  const [returnDiscount, setReturnDiscount] = useState("0");
  const [returnRefunded, setReturnRefunded] = useState("0");
  const [returnNote, setReturnNote] = useState("");
  const [submittingReturn, setSubmittingReturn] = useState(false);

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

  // Có quyền sửa nếu: admin, HOẶC có quyền create_order VÀ là người tạo đơn VÀ đơn chưa hoàn tất/hủy
  const canEdit = isAdmin || (
    (user?.permissions?.includes("create_order") || false) &&
    !!order &&
    (order.created_by === user?.id || order.employee_id === user?.id) &&
    order?.status !== "completed" &&
    order?.status !== "cancelled"
  );
  const canManageOrder =
    isAdmin || (user?.permissions?.includes("create_order") || false);
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<LineItem[]>([]);
  const [editCustomer, setEditCustomer] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editEmployee, setEditEmployee] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState<"tien_mat" | "ngan_hang">("tien_mat");
  const [editBankAccountIdx, setEditBankAccountIdx] = useState("");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editDiscountMode, setEditDiscountMode] = useState<"amount" | "percent">("amount");
  const [editVat, setEditVat] = useState("0");       // VAT % khi dùng mode "pct"
  const [editVatMode, setEditVatMode] = useState<"pct" | "fixed">("pct"); // % hoặc số tiền
  const [editVatFixed, setEditVatFixed] = useState("0"); // VAT số tiền khi mode "fixed"
  const [editDeposit, setEditDeposit] = useState("0");
  const [editNote, setEditNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Schedule link editing
  const [editScheduleLinks, setEditScheduleLinks] = useState<string[]>([]); // schedule IDs linked to this order

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
    setEditBankAccountIdx("");  // reset STK khi mở edit
    // Khôi phục giảm giá đã lưu
    if (order.discount_type === "percent" && order.discount_pct > 0) {
      setEditDiscountMode("percent");
      setEditDiscount(String(order.discount_pct));
    } else {
      setEditDiscountMode("amount");
      setEditDiscount(String(order.discount ?? 0));
    }
    // Khôi phục VAT đã lưu
    if (order.vat_rate > 0) {
      setEditVat(String(Math.round(order.vat_rate * 100)));
      setEditVatMode("pct");
      setEditVatFixed("0");
    } else {
      setEditVat("0");
      setEditVatMode("pct");
      setEditVatFixed("0");
    }
    setEditDeposit(String(order.deposit ?? 0));
    setEditNote(order.note ?? "");
    setEditScheduleLinks(linkedSchedules.map((s: any) => s.id));
    setEditing(true);
  }

  async function saveEdit() {
    if (editItems.length === 0) return toast.error("Đơn chưa có sản phẩm");
    setSaving(true);
    try {
      // Tính lại discount amount để lưu xuống DB
      const discountAmt = editDiscountMode === "percent"
        ? Math.round(editSubtotal * Math.min(100, parseFloat(editDiscount) || 0) / 100)
        : parseInput(editDiscount);

      await updateOrderFn({
        data: {
          id,
          customer_id: editCustomer || undefined,
          branch_id: editBranch,
          employee_id: editEmployee || undefined,
          status: editStatus,
          payment_method: editPaymentMethod,
          discount: discountAmt,
          discount_type: editDiscountMode,
          discount_pct: editDiscountMode === "percent" ? parseFloat(editDiscount) || 0 : 0,
          vat_rate: editVatMode === "pct" && parseFloat(editVat) > 0 ? parseFloat(editVat) / 100 : 0,
          vat_amount: editVatAmt,
          deposit: parseInput(editDeposit),
          paid: 0,
          note: editNote || undefined,
          items: editItems,
        },
      });

      // Cập nhật liên kết lịch lắp đặt
      const oldLinks = linkedSchedules.map((s: any) => s.id);
      const toUnlink = oldLinks.filter((sid: string) => !editScheduleLinks.includes(sid));
      const toLink   = editScheduleLinks.filter((sid: string) => !oldLinks.includes(sid));
      await Promise.all([
        ...toLink.map((sid: string) =>
          updateScheduleLinkFn({ data: { schedule_id: sid, order_id: id, actor_id: user?.id } })
        ),
        ...toUnlink.map((sid: string) =>
          updateScheduleLinkFn({ data: { schedule_id: sid, order_id: null, actor_id: user?.id } })
        ),
      ]);

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
  // Tính giảm giá: nếu mode = percent thì tính % trên subtotal, nếu amount thì dùng trực tiếp
  const editDiscountAmt = useMemo(() => {
    if (editDiscountMode === "percent") {
      const pct = Math.min(100, Math.max(0, parseFloat(editDiscount) || 0));
      return Math.round(editSubtotal * pct / 100);
    }
    return parseInput(editDiscount);
  }, [editDiscount, editDiscountMode, editSubtotal]);
  const editAfterDiscount = Math.max(0, editSubtotal - editDiscountAmt);
  // VAT tính trên giá sau giảm
  const editVatAmt = useMemo(() => {
    if (editVatMode === "fixed") {
      return Math.max(0, parseFloat(editVatFixed.replace(/\D/g, "")) || 0);
    }
    const pct = Math.min(100, Math.max(0, parseFloat(editVat) || 0));
    return Math.round(editAfterDiscount * pct / 100);
  }, [editVat, editVatMode, editVatFixed, editAfterDiscount]);
  const editTotal = editAfterDiscount + editVatAmt;
  const khachCanThanhToanEdit = Math.max(0, editTotal - parseInput(editDeposit));

  function startReturn() {
    setReturnItems(
      orderItems.map((i: any) => ({
        product_id: i.product_id,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: i.discount ?? 0,
      }))
    );
    setReturnDiscount(String(order.discount ?? 0));
    setReturnRefunded("0");
    setReturnNote("");
    setReturnOpen(true);
  }

  const returnSubtotal = useMemo(
    () => returnItems.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [returnItems]
  );
  const returnTotal = Math.max(0, returnSubtotal - parseInput(returnDiscount));
  const khachCanNhanLai = returnTotal;

  async function submitReturn() {
    if (returnItems.length === 0) return toast.error("Chưa có sản phẩm trả");
    setSubmittingReturn(true);
    try {
      const result = await createReturnFn({
        data: {
          original_order_id: id,
          items: returnItems,
          discount: parseInput(returnDiscount),
          refunded_to_customer: parseInput(returnRefunded),
          note: returnNote || undefined,
          branch_id: order.branch_id,
          customer_id: order.customer_id || undefined,
          employee_id: order.employee_id || undefined,
        },
      });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await refetch();

      toast.success(`Đã tạo phiếu trả hàng ${result.code}`);
      setReturnOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tạo phiếu trả hàng");
    } finally {
      setSubmittingReturn(false);
    }
  }

  // Kiểm tra tồn kho rồi mở dialog thanh toán
  function completeOrder() {
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
      // ✅ Hiển thị dialog chuyên nghiệp thay vì toast
      const items = orderItems
        .map((item: any) => {
          const available = (data?.stock ?? [])
            .filter((s: any) => s.product_id === item.product_id && s.branch_id === branchId)
            .reduce((sum: number, s: any) => sum + Number(s.qty || 0), 0);
          const needed = Number(item.qty || 0);
          if (available < needed) {
            const prod = (data?.products ?? []).find((p: any) => p.id === item.product_id);
            return { name: prod?.name ?? item.product_id, needed, available };
          }
          return null;
        })
        .filter(Boolean) as {name: string; needed: number; available: number}[];
      setShortageItems(items);
      setShortageOpen(true);
      return;
    }

    // Mở dialog thanh toán
    const khachCan = Math.max(0, (order.total ?? 0) - (order.deposit ?? 0));
    setPayAmountRaw(String(khachCan));
    setPayMethodTab(order.payment_method === "ngan_hang" ? "ngan_hang" : "tien_mat");
    setPayBankIdx("");
    setPayOpen(true);
  }

  // Xác nhận thanh toán và hoàn tất đơn
  async function confirmPayAndComplete() {
    const khachCan = Math.max(0, (order.total ?? 0) - (order.deposit ?? 0));
    const paid = parseInput(payAmountRaw);

    setCompletingOrder(true);
    try {
      await updateStatusFn({
        data: {
          id: order.id,
          status: "completed",
          paid,
          payment_method: payMethodTab,
        },
      });

      await qc.invalidateQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await refetch();

      const congNo = Math.max(0, khachCan - paid);
      if (congNo > 0) {
        toast.success(`Hoàn tất đơn ${order.code} — Công nợ: ${new Intl.NumberFormat("vi-VN").format(congNo)} ₫`);
      } else {
        toast.success("Đã hoàn tất đơn " + order.code);
      }
      setPayOpen(false);
      navigate({ to: "/orders", replace: true });
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
    const custObj   = (data?.customers ?? []).find((c: any) => c.id === order.customer_id);
    const branchObj = (data?.branches  ?? []).find((b: any) => b.id === order.branch_id);
    const empObj    = (data?.employees ?? []).find((e: any) => e.id === order.employee_id);
    const ss = siteSettings as any;
    // Load print template from admin settings
    const _tpls = (() => { try { return JSON.parse(ss?.print_templates || "{}"); } catch { return {}; } })();
    const _tpl = _tpls["order_invoice"] ?? {};
    const _siteName = ss?.site_name ?? "Mr.Vũ";
    const _tplHeader = (_tpl.header ?? "PHIẾU XUẤT KHO KIỂM BẢO HÀNH").replace("{Ten_Cua_Hang}", _siteName);
    const _tplFooter = (_tpl.footer ?? `Quạt trần ${_siteName} chân thành cảm ơn sự tin tưởng của Quý khách hàng!`).replace("{Ten_Cua_Hang}", _siteName);
    const _showWarranty = _tpl.showWarranty !== false;
    const _tplWarranty = _showWarranty
      ? ((_tpl.warranty ?? `LƯU Ý: ${_siteName} KHUYẾN CÁO CẦN KIỂM TRA QUẠT ĐỊNH KỲ ÍT NHẤT 6 THÁNG/LẦN ĐỂ ĐẢM BẢO AN TOÀN TRONG QUÁ TRÌNH SỬ DỤNG.`).replace("{Ten_Cua_Hang}", _siteName))
      : "";

    const rows = orderItems.map((item: any, i: number) => {
      const prod = (data?.products ?? []).find((p: any) => p.id === item.product_id);
      const lineTotal = item.qty * item.unit_price - (item.discount ?? 0);
      return `<tr>
        <td style="text-align:center;padding:8px 6px;border-bottom:1px solid #e5e7eb">${i+1}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb">${prod?.name ?? item.product_id}</td>
        <td style="text-align:center;padding:8px 6px;border-bottom:1px solid #e5e7eb">${item.qty}</td>
        <td style="text-align:right;padding:8px 6px;border-bottom:1px solid #e5e7eb">${moneyFmt(item.unit_price)}</td>
        <td style="text-align:right;padding:8px 6px;border-bottom:1px solid #e5e7eb;font-weight:600">${moneyFmt(lineTotal)}</td>
      </tr>`;
    }).join("");

    const statusLabels: Record<string, string> = { completed: "Hoàn tất", reserved: "Đặt hàng", draft: "Nháp" };
    const pmLabel = order.payment_method === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt";

    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Hóa đơn ${order.code}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;padding:32px}
.page{max-width:760px;margin:0 auto}
.header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e5e7eb}
.shop-name{font-size:18px;font-weight:700;color:#1d4ed8}
.shop-info{font-size:11px;color:#6b7280;line-height:1.7;margin-top:4px}
.inv-title{font-size:20px;font-weight:800;text-transform:uppercase;color:#111;text-align:right;line-height:1.2}
.inv-meta{font-size:11px;color:#6b7280;text-align:right;margin-top:6px;line-height:1.8}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px}
.info-label{color:#6b7280;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px}
.info-value{font-weight:600;color:#111;font-size:12.5px;margin-top:1px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
thead tr{background:#1d4ed8;color:#fff}th{padding:10px 8px;font-size:12px;font-weight:600}
.total-section{display:flex;justify-content:flex-end;margin-bottom:20px}
.total-box{min-width:270px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
.total-row{display:flex;justify-content:space-between;padding:7px 14px;font-size:13px;border-bottom:1px solid #f3f4f6}
.total-row.grand{background:#1d4ed8;color:#fff;font-size:15px;font-weight:700;border-bottom:none}
.checklist{border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:12px}
.sign-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center;margin-top:8px}
.warranty{margin-top:16px;padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;line-height:1.7;color:#9a3412}
.footer{margin-top:14px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:12px}
@media print{body{padding:0}}
</style></head><body><div class="page">
<div class="header">
  <div>
    ${ss?.logo_url ? `<img src="${ss.logo_url}" alt="Logo" style="height:52px;object-fit:contain;margin-bottom:6px;display:block">` : ""}
    <div class="shop-name">${ss?.site_name ?? "Mr.Vũ"}</div>
    <div class="shop-info">
      ${ss?.address ? `📍 ${ss.address}<br>` : ""}
      ${ss?.phone ? `📞 ${ss.phone}` : ""}${ss?.phone && ss?.email ? " &nbsp;|&nbsp; " : ""}${ss?.email ? `✉ ${ss.email}` : ""}
      ${ss?.tax_code ? `<br>MST: ${ss.tax_code}` : ""}
    </div>
  </div>
  <div>
    <div class="inv-title">${_tplHeader}</div>
    <div class="inv-meta">
      <strong>Mã phiếu:</strong> ${order.code}<br>
      <strong>Ngày đặt hàng:</strong> ${new Date(order.created_at).toLocaleDateString("vi-VN")}<br>
      <strong>Ngày lập phiếu:</strong> ${new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}<br>
      ${order.completed_at ? `<strong>Ngày hoàn tất:</strong> ${new Date(order.completed_at).toLocaleDateString("vi-VN")}<br>` : ""}
      <strong>Trạng thái:</strong> ${statusLabels[order.status] ?? order.status}
    </div>
  </div>
</div>
<div class="info-grid">
  <div><div class="info-label">Khách hàng</div><div class="info-value">${custObj?.name ?? "Khách lẻ"}${custObj?.phone ? " — " + custObj.phone : ""}</div></div>
  <div><div class="info-label">Chi nhánh</div><div class="info-value">${branchObj?.name ?? "—"}</div></div>
  <div><div class="info-label">Nhân viên</div><div class="info-value">${empObj?.name ?? "—"}</div></div>
  <div><div class="info-label">Hình thức TT</div><div class="info-value">${pmLabel}</div></div>
  ${custObj?.address ? `<div style="grid-column:span 2"><div class="info-label">Địa chỉ</div><div class="info-value">${custObj.address}</div></div>` : ""}
</div>
<table>
  <thead><tr>
    <th style="width:42px;text-align:center">STT</th><th>Sản phẩm</th>
    <th style="width:56px;text-align:center">SL</th>
    <th style="width:120px;text-align:right">Đơn giá</th>
    <th style="width:130px;text-align:right">Thành tiền</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="total-section"><div class="total-box">
  <div class="total-row"><span>Tạm tính</span><span>${moneyFmt(order.subtotal)}</span></div>
  ${Number(order.discount) > 0 ? `<div class="total-row" style="color:#16a34a"><span>Giảm giá</span><span>- ${moneyFmt(order.discount)}</span></div>` : ""}
  ${Number(order.vat_amount) > 0 ? `<div class="total-row" style="color:#d97706"><span>Thuế VAT</span><span>+ ${moneyFmt(order.vat_amount)}</span></div>` : ""}
  <div class="total-row"><span>Tổng cộng</span><span style="font-weight:700">${moneyFmt(order.total)}</span></div>
  ${Number(order.deposit) > 0 ? `<div class="total-row" style="color:#b45309"><span>Đặt cọc</span><span>- ${moneyFmt(order.deposit)}</span></div>` : ""}
  ${Number(order.paid) > 0 ? `<div class="total-row" style="color:#059669"><span>Đã thanh toán</span><span>- ${moneyFmt(order.paid)}</span></div>` : ""}
  <div class="total-row grand"><span>Khách cần trả</span><span>${moneyFmt(Math.max(0, order.total - (order.deposit ?? 0) - (order.paid ?? 0)))}</span></div>
</div></div>
${order.note ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;font-size:12.5px;margin-bottom:20px"><strong>Ghi chú:</strong> ${order.note}</div>` : ""}
<div class="checklist">
  <div style="font-weight:700;margin-bottom:8px;font-size:12.5px">Xác nhận bàn giao:</div>
  ${["Đã giao hàng đúng mẫu và đầy đủ phụ kiện","Đã lắp đặt hoàn thiện, quạt chạy ổn định","Đã hướng dẫn sử dụng và bảo quản","Đã thanh toán đúng số tiền trên phiếu"]
    .map(it=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:13px;height:13px;border:1.5px solid #9ca3af;border-radius:2px;display:inline-block;flex-shrink:0"></span><span>${it}</span></div>`).join("")}
  <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:#6b7280">
    <strong>Khách hàng xác nhận</strong><span>Họ và tên: _________________ &nbsp;&nbsp; Chữ ký: ______________</span>
  </div>
</div>
<div class="sign-grid">
  ${["Kỹ thuật","Nhân viên","Khách hàng","Thủ kho"].map(r=>`
    <div>
      <div style="font-weight:700;font-size:12px;margin-bottom:3px">${r}</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:44px">(Ký, ghi rõ họ tên)</div>
      <div style="border-top:1px dashed #d1d5db;padding-top:4px;font-size:11px;color:#d1d5db">___________</div>
    </div>`).join("")}
</div>
${_tplWarranty ? `<div class="warranty">⚠ ${_tplWarranty}</div>` : ""}
${_tplFooter ? `<div class="footer">${_tplFooter}</div>` : ""}
</div></body></html>`;

    const pw = window.open("", "_blank");
    if (!pw) return;
    pw.document.write(html);
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

        {canEdit && !editing && (
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
                         style={{ display: "none" }}
                      >
                        <option value="tien_mat">Tiền mặt</option>
                        <option value="ngan_hang">Chuyển khoản (Ngân hàng)</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* ── Ngày tạo & Ngày hoàn tất — hiển thị rõ ràng cho người dùng ── */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1 bg-muted/50 rounded-md px-2 py-1">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>
                        <span className="font-semibold text-foreground">Ngày tạo đơn:</span>{" "}
                        {new Date(order.created_at).toLocaleString("vi-VN", {
                          day: "2-digit", month: "2-digit", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  {order.completed_at ? (
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-md px-2 py-1 text-green-700">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        <span>
                          <span className="font-semibold">Ngày hoàn tất:</span>{" "}
                          {new Date(order.completed_at).toLocaleString("vi-VN", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ) : order.status === "completed" ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/40 rounded-md px-2 py-1 w-fit">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      <span>Đã hoàn tất</span>
                    </div>
                  ) : null}
                </div>
              </div>

            {!editing && (
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={printOrderSlip}>
                  <Printer className="h-4 w-4 mr-1" /> In hóa đơn
                </Button>

                {canManageOrder &&
                  (order.status === "reserved" || order.status === "draft") && (
                    <Button
                      size="sm"
                      onClick={completeOrder}
                      disabled={completingOrder}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      {completingOrder ? "Đang xử lý..." : "Tạo hóa đơn"}
                    </Button>
                  )}

                {canManageOrder && order.status === "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    onClick={startReturn}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" /> Trả hàng
                  </Button>
                )}

                {isAdmin && order.status !== "cancelled" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={cancelOrder}
                    disabled={cancellingOrder}
                  >
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
              <>
              {/* Mobile: card list */}
              <div className="block sm:hidden space-y-2">
                {orderItems.map((item: any, idx: number) => {
                  const p = (data?.products ?? []).find((x: any) => x.id === item.product_id);
                  return (
                    <div key={item.id ?? item.product_id} className="rounded-lg border bg-muted/20 px-3 py-2.5">
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-medium text-sm leading-tight">{p?.name ?? item.product_id}</span>
                        <span className="font-semibold text-sm shrink-0">{fmt(item.total)}</span>
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{fmt(item.unit_price)} × <strong className="text-foreground">{item.qty}</strong></span>
                        {item.discount > 0 && <span className="text-orange-600">CK -{fmt(item.discount)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-2">Sản phẩm</th>
                      <th className="text-right pr-2">Đơn giá</th>
                      <th className="text-right pr-2 w-10">SL</th>
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
              </>
            ) : (
              <div className="space-y-2">
                {editItems.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">Chưa có sản phẩm.</div>
                )}

                {editItems.map((item, idx) => {
                  const lineTotal = item.qty * item.unit_price - item.discount;
                  return (
                    <div key={idx} className="rounded-lg border bg-muted/10 p-2 space-y-1.5">
                      {/* Row 1: product select + delete */}
                      <div className="flex gap-1.5 items-center">
                        <div className="flex-1">
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
                        <button
                          type="button"
                          className="flex items-center justify-center rounded-md border hover:text-destructive p-1.5 shrink-0"
                          onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {/* Row 2: SL + Đơn giá + Thành tiền */}
                      <div className="flex gap-1.5 items-center">
                        <div className="w-16 shrink-0">
                          <Input
                            type="number"
                            className="text-center h-8 text-sm"
                            placeholder="SL"
                            value={item.qty}
                            onChange={(e) => {
                              const n = [...editItems];
                              n[idx].qty = Number(e.target.value);
                              setEditItems(n);
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <Input
                            className="h-8 text-sm"
                            placeholder="Đơn giá"
                            value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                            onChange={(e) => {
                              const n = [...editItems];
                              n[idx].unit_price = parseInput(e.target.value);
                              setEditItems(n);
                            }}
                          />
                        </div>
                        <div className="text-right text-xs font-semibold min-w-[72px] shrink-0">
                          {fmt(lineTotal)}
                        </div>
                      </div>
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
                {order.discount > 0 && (
                  <Row
                    label={order.discount_type === "percent" && order.discount_pct > 0
                      ? `Giảm giá (${order.discount_pct}%)`
                      : "Giảm giá"}
                    value={`- ${fmt(order.discount)}`}
                    cls="text-red-600"
                  />
                )}
                {order.vat_amount > 0 && (
                  <Row
                    label={`Thuế VAT${order.vat_rate > 0 ? ` (${Math.round(order.vat_rate * 100)}%)` : ""}`}
                    value={`+ ${fmt(order.vat_amount)}`}
                    cls="text-orange-600"
                  />
                )}
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
                {/* Tạm tính */}
                <div className="rounded-md bg-muted/40 px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">Tạm tính</span>
                  <span className="font-medium">{fmt(editSubtotal)}</span>
                </div>

                {/* Giảm giá với toggle % / tiền */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Giảm giá</Label>
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      <button type="button"
                        className={`px-2.5 py-1 transition-colors ${editDiscountMode === "amount" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                        onClick={() => { setEditDiscountMode("amount"); setEditDiscount("0"); }}
                      >₫</button>
                      <button type="button"
                        className={`px-2.5 py-1 transition-colors ${editDiscountMode === "percent" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                        onClick={() => { setEditDiscountMode("percent"); setEditDiscount("0"); }}
                      ><Percent className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <div className="relative">
                    <Input
                      className="pr-10"
                      value={editDiscount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        setEditDiscount(editDiscountMode === "amount" ? fmtInput(v) : v);
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">
                      {editDiscountMode === "percent" ? "%" : "₫"}
                    </span>
                  </div>
                  {editDiscountAmt > 0 && editDiscountMode === "percent" && (
                    <p className="text-xs text-muted-foreground mt-0.5 text-right">= -{fmt(editDiscountAmt)}</p>
                  )}
                </div>

                {/* VAT — toggle % / số tiền */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Thuế VAT</Label>
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      <button type="button"
                        onClick={() => setEditVatMode("pct")}
                        className={`px-2.5 py-1 font-medium transition-colors ${editVatMode === "pct" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                        %
                      </button>
                      <button type="button"
                        onClick={() => setEditVatMode("fixed")}
                        className={`px-2.5 py-1 font-medium transition-colors ${editVatMode === "fixed" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                        ₫
                      </button>
                    </div>
                  </div>
                  {editVatMode === "pct" ? (
                    <div className="flex gap-1.5 mt-1">
                      {["0", "5", "8", "10"].map((v) => (
                        <button key={v} type="button"
                          onClick={() => setEditVat(v)}
                          className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors ${editVat === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                        >{v === "0" ? "Không" : `${v}%`}</button>
                      ))}
                      <div className="relative flex-1">
                        <Input
                          className="pr-5 text-xs h-8"
                          placeholder="Khác"
                          value={!["0","5","8","10"].includes(editVat) ? editVat : ""}
                          onChange={(e) => setEditVat(e.target.value.replace(/[^0-9.]/g, ""))}
                          onFocus={() => { if (["0","5","8","10"].includes(editVat)) setEditVat(""); }}
                        />
                        <span className="absolute right-2 top-2 text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  ) : (
                    <Input
                      className="mt-1"
                      placeholder="Nhập số tiền thuế..."
                      value={editVatFixed === "0" ? "" : new Intl.NumberFormat("vi-VN").format(Number(editVatFixed) || 0)}
                      onChange={(e) => setEditVatFixed(String(e.target.value.replace(/\D/g, "") || "0"))}
                      onFocus={(e) => { if (editVatFixed === "0") setEditVatFixed(""); e.target.select(); }}
                    />
                  )}
                  {editVatAmt > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 text-right">+{fmt(editVatAmt)} VAT</p>
                  )}
                </div>

                {/* Tổng sau giảm + VAT */}
                <div className="rounded-md px-3 py-2 flex justify-between font-semibold border">
                  <span>Tổng tiền hàng</span>
                  <span>{fmt(editTotal)}</span>
                </div>

                {/* Hình thức thanh toán */}
                <div>
                  <Label>Hình thức thanh toán</Label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={editPaymentMethod}
                    onChange={(e) => {
                      setEditPaymentMethod(e.target.value as any);
                      setEditBankAccountIdx("");
                    }}
                  >
                    <option value="tien_mat">Tiền mặt</option>
                    <option value="ngan_hang">Chuyển khoản (Ngân hàng)</option>
                  </select>
                  {/* ✅ Chọn STK khi chọn Ngân hàng */}
                  {editPaymentMethod === "ngan_hang" && (() => {
                    const bankList: any[] = (() => {
                      try { return JSON.parse((siteSettings as any)?.bank_accounts || "[]"); }
                      catch { return []; }
                    })();
                    if (!bankList.length) return null;
                    return (
                      <div className="mt-2 space-y-1.5">
                        <select
                          className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                          value={editBankAccountIdx}
                          onChange={(e) => setEditBankAccountIdx(e.target.value)}
                        >
                          <option value="">— Chọn tài khoản —</option>
                          {bankList.map((ba: any, i: number) => (
                            <option key={i} value={String(i)}>
                              {ba.bank} — {ba.account_number} ({ba.account_name})
                            </option>
                          ))}
                        </select>
                        {editBankAccountIdx !== "" && (() => {
                          const ba = bankList[parseInt(editBankAccountIdx)];
                          return ba ? (
                            <div className="rounded-lg border bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-0.5">
                              <div className="font-semibold">{ba.bank}</div>
                              <div>STK: <span className="font-mono font-bold">{ba.account_number}</span></div>
                              <div>Chủ TK: {ba.account_name}</div>
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })()}
                </div>

                {/* Đặt cọc */}
                <div>
                  <Label>Đặt cọc (₫)</Label>
                  <Input
                    className="mt-1"
                    value={editDeposit}
                    onChange={(e) => setEditDeposit(fmtInput(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    placeholder="0"
                  />
                </div>

                <div className="rounded-md bg-primary/5 px-3 py-2 flex justify-between font-bold text-primary border border-primary/20">
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

            {editing && (
              <div className="mb-3 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Liên kết lịch lắp đặt</Label>
                {(data?.schedules ?? [])
                  .filter((s: any) =>
                    s.customer_id === editCustomer ||
                    editScheduleLinks.includes(s.id) ||
                    linkedSchedules.some((ls: any) => ls.id === s.id)
                  )
                  .map((s: any) => {
                    const checked = editScheduleLinks.includes(s.id);
                    return (
                      <label key={s.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${checked ? "bg-primary/5 border-primary/30" : "hover:bg-muted/40"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setEditScheduleLinks(checked
                              ? editScheduleLinks.filter((x) => x !== s.id)
                              : [...editScheduleLinks, s.id])
                          }
                          className="accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{s.title}</div>
                          {s.scheduled_date && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(s.scheduled_date).toLocaleDateString("vi-VN")}
                              {s.scheduled_time && ` ${s.scheduled_time}`}
                            </div>
                          )}
                        </div>
                        {checked && <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </label>
                    );
                  })}
                {(data?.schedules ?? []).filter((s: any) =>
                  s.customer_id === editCustomer ||
                  editScheduleLinks.includes(s.id) ||
                  linkedSchedules.some((ls: any) => ls.id === s.id)
                ).length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-1">Không có lịch nào phù hợp với khách hàng này</p>
                )}
              </div>
            )}

            {!editing && linkedSchedules.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">Chưa có lịch lắp đặt</div>
            ) : !editing && (
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
      {/* Return Order Dialog */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <RotateCcw className="h-5 w-5" /> Trả hàng — {order?.code}
            </DialogTitle>
            <DialogDescription>
              Chỉnh sửa sản phẩm và số lượng cần trả. Tiền đã trả khách mặc định là 0 (chưa trả).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">Sản phẩm trả hàng</Label>
                <Button size="sm" variant="outline" onClick={() => {
                  const p = (data?.products ?? [])[0];
                  if (!p) return;
                  setReturnItems([...returnItems, { product_id: p.id, qty: 1, unit_price: (p as any).sale_price ?? 0, discount: 0 }]);
                }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm SP
                </Button>
              </div>

              <div className="space-y-2">
                {returnItems.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">Chưa có sản phẩm.</div>
                )}
                {returnItems.map((item, idx) => {
                  const lineTotal = item.qty * item.unit_price - item.discount;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                      <div className="col-span-5">
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(val) => {
                            const p = (data?.products ?? []).find((x: any) => x.id === val);
                            const next = [...returnItems];
                            next[idx] = { ...next[idx], product_id: val, unit_price: (p as any)?.sale_price ?? 0 };
                            setReturnItems(next);
                          }}
                          placeholder="Chọn sản phẩm..."
                          options={(data?.products ?? []).map((p: any) => ({ value: p.id, label: p.name, sub: p.sku ?? undefined }))}
                        />
                      </div>
                      <Input
                        type="number"
                        className="col-span-1"
                        placeholder="SL"
                        value={item.qty}
                        min={1}
                        onChange={(e) => {
                          const n = [...returnItems];
                          n[idx].qty = Math.max(1, Number(e.target.value) || 1);
                          setReturnItems(n);
                        }}
                      />
                      <Input
                        className="col-span-3"
                        placeholder="Đơn giá"
                        value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                        onChange={(e) => {
                          const n = [...returnItems];
                          n[idx].unit_price = parseInput(e.target.value);
                          setReturnItems(n);
                        }}
                      />
                      <div className="col-span-2 text-right text-xs font-medium text-muted-foreground">
                        {fmt(lineTotal)}
                      </div>
                      <button
                        type="button"
                        className="col-span-1 flex items-center justify-center rounded-md border hover:text-destructive p-1"
                        onClick={() => setReturnItems(returnItems.filter((_, i) => i !== idx))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

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
                <Label>Tiền đã trả lại khách (₫)</Label>
                <Input
                  className="mt-1"
                  value={returnRefunded}
                  onChange={(e) => setReturnRefunded(fmtInput(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="Mặc định 0 — chưa trả"
                />
              </div>
            </div>

            <div>
              <Label>Ghi chú</Label>
              <Input className="mt-1" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Lý do trả hàng..." />
            </div>

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
                <span>Khách cần nhận lại</span>
                <span>{fmt(khachCanNhanLai)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Đã trả lại khách</span>
                <span>{fmt(parseInput(returnRefunded))}</span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setReturnOpen(false)}>
              Hủy
            </Button>
            <Button
              className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700"
              onClick={submitReturn}
              disabled={submittingReturn}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {submittingReturn ? "Đang tạo..." : "Xác nhận trả hàng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Stock Shortage Dialog ──────────────────────────────────────────── */}
      <Dialog open={shortageOpen} onOpenChange={setShortageOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              Không đủ hàng để hoàn tất
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Một số sản phẩm trong đơn hàng không đủ tồn kho tại chi nhánh này.
              Vui lòng kiểm tra và bổ sung hàng trước khi hoàn tất.
            </p>

            <div className="rounded-xl border overflow-hidden">
              <div className="grid grid-cols-3 gap-2 bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="col-span-1">Sản phẩm</span>
                <span className="text-center">Cần</span>
                <span className="text-center">Còn lại</span>
              </div>
              <div className="divide-y">
                {shortageItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 px-4 py-3 items-center">
                    <div className="col-span-1 flex items-center gap-2">
                      <PackageX className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-sm font-medium leading-tight">{item.name}</span>
                    </div>
                    <div className="text-center">
                      <span className="inline-flex items-center justify-center h-6 min-w-[28px] px-2 rounded-md bg-orange-100 text-orange-700 text-sm font-bold">
                        {item.needed}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className={`inline-flex items-center justify-center h-6 min-w-[28px] px-2 rounded-md text-sm font-bold ${
                        item.available === 0
                          ? "bg-destructive/10 text-destructive"
                          : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {item.available}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Bạn có thể chuyển đơn về trạng thái <strong>Đặt hàng</strong> để chờ nhập thêm hàng, hoặc liên hệ thủ kho để bổ sung tồn kho.</span>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShortageOpen(false)} className="flex-1">
              Đóng
            </Button>
            <Button
              variant="default"
              className="flex-1"
              onClick={() => {
                setShortageOpen(false);
                navigate({ to: "/inventory" });
              }}
            >
              Đi đến Kho hàng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Payment Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Thanh toán đơn {order?.code}
            </DialogTitle>
          </DialogHeader>

          {order && (() => {
            const bankList: any[] = (() => {
              try { return JSON.parse(siteSettings?.bank_accounts || "[]"); }
              catch { return []; }
            })();
            const khachCan = Math.max(0, (order.total ?? 0) - (order.deposit ?? 0) - (order.discount ?? 0));
            const paid = parseInput(payAmountRaw);
            const congNo = Math.max(0, khachCan - paid);
            const tienThua = Math.max(0, paid - khachCan);
            const quickAmounts = (() => {
              const base = khachCan;
              if (base <= 0) return [];
              const r10  = Math.ceil(base / 10000) * 10000;
              const r50  = Math.ceil(base / 50000) * 50000;
              const r100 = Math.ceil(base / 100000) * 100000;
              const r500 = Math.ceil(base / 500000) * 500000;
              return [...new Set([base, r10, r50, r100, r500].filter(v => v >= base))].slice(0, 5);
            })();
            const moneyFmtLocal = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";

            return (
              <div className="space-y-4 pt-1">
                {/* Summary */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tổng tiền hàng ({orderItems.length})</span>
                    <span>{moneyFmtLocal(order.total ?? 0)}</span>
                  </div>
                  {(order.discount ?? 0) > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Giảm giá</span>
                      <span>- {moneyFmtLocal(order.discount)}</span>
                    </div>
                  )}
                  {(order.deposit ?? 0) > 0 && (
                    <div className="flex justify-between text-yellow-700">
                      <span>Đặt cọc</span>
                      <span>- {moneyFmtLocal(order.deposit)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-1 border-t text-blue-600">
                    <span>Khách cần trả</span>
                    <span>{moneyFmtLocal(khachCan)}</span>
                  </div>
                </div>

                {/* Payment method radio */}
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hình thức thanh toán</Label>
                  <div className="flex gap-4 mt-2">
                    {([{ value: "tien_mat", label: "Tiền mặt" }, { value: "ngan_hang", label: "Chuyển khoản" }] as const).map((opt) => (
                      <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="pay_method"
                          value={opt.value}
                          checked={payMethodTab === opt.value}
                          onChange={() => { setPayMethodTab(opt.value); setPayBankIdx(""); }}
                          className="accent-primary"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  {payMethodTab === "ngan_hang" && bankList.length > 0 && (
                    <div className="mt-2">
                      <select
                        className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                        value={payBankIdx}
                        onChange={(e) => setPayBankIdx(e.target.value)}
                      >
                        <option value="">— Chọn tài khoản —</option>
                        {bankList.map((ba: any, i: number) => (
                          <option key={i} value={String(i)}>
                            {ba.bank} - {ba.account_number} ({ba.account_name})
                          </option>
                        ))}
                      </select>
                      {payBankIdx !== "" && (() => {
                        const ba = bankList[parseInt(payBankIdx)];
                        return ba ? (
                          <div className="mt-1.5 rounded-lg border bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-0.5">
                            <div className="font-semibold">{ba.bank}</div>
                            <div>STK: <span className="font-mono font-bold">{ba.account_number}</span></div>
                            <div>Chủ TK: {ba.account_name}</div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>

                {/* Amount input */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-sm font-semibold">Khách thanh toán</Label>
                    {tienThua > 0 && <span className="text-xs text-green-600 font-medium">Tiền thừa: {moneyFmtLocal(tienThua)}</span>}
                  </div>
                  <Input
                    className="text-right font-mono text-lg h-12 border-2 focus:border-primary"
                    value={payAmountRaw}
                    onChange={(e) => setPayAmountRaw(e.target.value.replace(/\D/g, ""))}
                    onFocus={(e) => e.target.select()}
                    placeholder={moneyFmtLocal(khachCan).replace(" ₫", "")}
                  />
                </div>

                {/* Quick chips */}
                {quickAmounts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {quickAmounts.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setPayAmountRaw(String(amt))}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          paid === amt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-border"
                        }`}
                      >
                        {moneyFmtLocal(amt).replace(" ₫", "")}
                      </button>
                    ))}
                  </div>
                )}

                {/* Debt / paid full indicator */}
                {congNo > 0 && (
                  <div className="flex justify-between text-sm pt-1 border-t">
                    <span className="text-muted-foreground">Tính vào công nợ</span>
                    <span className="font-semibold text-red-600">+{moneyFmtLocal(congNo)}</span>
                  </div>
                )}
                {congNo === 0 && paid > 0 && (
                  <div className="flex justify-between text-sm pt-1 border-t text-green-600">
                    <span>✓ Thanh toán đủ</span>
                    <span className="font-semibold">{moneyFmtLocal(paid)}</span>
                  </div>
                )}

                <DialogFooter className="flex-col sm:flex-row gap-2 pt-1">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => setPayOpen(false)}>
                    Hủy
                  </Button>
                  <Button
                    className="w-full sm:w-auto font-bold text-base h-11"
                    onClick={confirmPayAndComplete}
                    disabled={completingOrder}
                  >
                    {completingOrder
                      ? <><span className="animate-spin mr-1.5">⏳</span>Đang xử lý...</>
                      : "Tạo hóa đơn"}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
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