import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { listOrders, createOrder } from "@/lib/orders.functions";
import { createSchedule, listWorkTypes } from "@/lib/schedule.functions";
import { upsertCustomer } from "@/lib/customers.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  X,
  ShoppingBag,
  Clock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Minus,
  Loader2,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "Bán hàng — QuatTran POS" }] }),
  component: Page,
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

const PAGE_SIZE = 20;
// Thêm 2 status này vào dòng 48 (ngay dưới cancelled):
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
  partially_returned: "bg-purple-50 text-purple-600 border border-purple-200",
};

// Bên dưới hàm Page() -> Filter Slot (Dòng ~550) thêm tùy chọn lọc:


function printOrderSlip({
  items,
  customer,
  branch,
  employee,
  status,
  paymentMethod,
  discount,
  discountAmt,
  vatAmt,
  deposit,
  note,
  subtotal,
  total,
  includeVat,
  data,
  siteSettings,
  tpl,
}: any) {
  const tplHeader   = tpl?.header   ?? "PHIẾU XUẤT KHO KIỂM BẢO HÀNH";
  const tplFooter   = tpl?.footer   ?? "Quạt trần chân thành cảm ơn sự tin tưởng của Quý khách hàng!";
  const tplWarranty = (tpl?.showWarranty !== false && tpl?.showWarranty !== undefined ? tpl?.showWarranty : true)
    ? (tpl?.warranty ?? "LƯU Ý: KHUYẾN CÁO CẦN KIỂM TRA QUẠT ĐỊNH KỲ ÍT NHẤT 6 THÁNG/LẦN ĐỂ ĐẢM BẢO AN TOÀN TRONG QUÁ TRÌNH SỬ DỤNG.")
    : "";
  const siteName = siteSettings?.site_name ?? "";
  const moneyFmt = (n: number) =>
    new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";

  const custName = customer
    ? (data?.customers ?? []).find((c: any) => c.id === customer)?.name ??
      "Khách lẻ"
    : "Khách lẻ";

  const branchName = branch
    ? (data?.branches ?? []).find((b: any) => b.id === branch)?.name ?? "—"
    : "—";

  const empName = employee
    ? (data?.employees ?? []).find((e: any) => e.id === employee)?.name ?? "—"
    : "—";

  const statusLabels: Record<string, string> = {
    completed: "Hoàn tất",
    reserved: "Đặt hàng (chưa giao)",
    draft: "Nháp",
  };

  const rows = items
    .map((item: any, i: number) => {
      const prod = (data?.products ?? []).find(
        (p: any) => p.id === item.product_id,
      );
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
  ${siteSettings?.logo_url ? `<img src="${siteSettings.logo_url}" alt="Logo" style="height:60px;object-fit:contain;margin-bottom:8px" />` : ""}
  ${siteSettings?.site_name ? `<div style="font-size:15px;font-weight:600;color:#444;margin-bottom:4px">${siteSettings.site_name}</div>` : ""}
  <div class="title">${tplHeader.replace("{Ten_Cua_Hang}", siteName || "Mr.Vũ").toUpperCase()}</div>
  <div class="sub">Ngày: ${new Date().toLocaleDateString("vi-VN")} &nbsp;|&nbsp; Trạng thái: ${statusLabels[status] ?? status}${siteSettings?.phone ? ` &nbsp;|&nbsp; ĐT: ${siteSettings.phone}` : ""}</div></div>
  <div class="info-grid">
    <div><strong>Khách hàng:</strong> ${custName}</div>
    <div><strong>Chi nhánh:</strong> ${branchName}</div>
    <div><strong>Nhân viên:</strong> ${empName}</div>
    <div><strong>Hình thức thanh toán:</strong> ${paymentMethod === "ngan_hang" ? "Chuyển khoản (Ngân hàng)" : "Tiền mặt"}</div>
    <div><strong>Mã phiếu:</strong> #${Date.now().toString().slice(-6)}</div>
  </div>
  <table><thead><tr>
    <th style="width:50px;text-align:center">STT</th>
    <th>Sản phẩm</th>
    <th style="width:70px;text-align:center">SL</th>
    <th style="width:130px;text-align:right">Đơn giá</th>
    <th style="width:140px;text-align:right">Thành tiền</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="total-box">
    <div>Tạm tính: ${moneyFmt(subtotal)}</div>
    ${discountAmt > 0 ? `<div>Giảm giá: - ${moneyFmt(discountAmt)}</div>` : ""}
    ${includeVat ? `<div>Thuế VAT (10%): + ${moneyFmt(vatAmt)}</div>` : ""}
    <div>Tổng tiền: ${moneyFmt(total)}</div>
    ${deposit > 0 ? `<div style="color:#b45309;margin-top:4px">Đặt cọc: - ${moneyFmt(deposit)}</div>` : ""}
    <div class="total-main" style="color:#15803d;margin-top:8px">Khách cần thanh toán: ${moneyFmt(Math.max(0, total - deposit))}</div>
  </div>
  ${note ? `<div style="margin-top:20px;font-size:14px"><strong>Ghi chú:</strong> ${note}</div>` : ""}
  <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:20px;text-align:center;font-size:13px">
    ${["Kỹ thuật","Nhân viên","Khách hàng","Thủ kho"].map(r=>`<div><div style="font-weight:600">${r}</div><div style="color:#999;font-size:11px">(Ký, ghi rõ họ tên)</div><div style="margin-top:50px;border-top:1px dashed #bbb;padding-top:4px;color:#ccc">__________</div></div>`).join("")}
  </div>
  <div style="margin-top:24px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px">
    <div style="font-weight:600;margin-bottom:8px">Vui lòng chọn nội dung dưới đây</div>
    ${["Đã giao hàng đúng mẫu và đầy đủ phụ kiện","Đã lắp đặt hoàn thiện, Quạt chạy ổn định","Đã hướng dẫn sử dụng","Đã thanh toán tiền mặt theo số tiền trên phiếu"].map(it=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="display:inline-block;width:14px;height:14px;border:1px solid #aaa;border-radius:2px"></span>${it}</div>`).join("")}
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px"><span><strong>Khách hàng xác nhận</strong></span><span>Họ tên: ___________________</span></div>
  </div>
  ${tplWarranty ? `<div style="margin-top:18px;font-size:12px;font-weight:700;text-transform:uppercase;line-height:1.6;border-top:1px solid #eee;padding-top:12px">${tplWarranty.replace("{Ten_Cua_Hang}", siteName||"Mr.Vũ")}</div>` : ""}
  ${tplFooter ? `<div style="margin-top:14px;text-align:center;font-size:13px;color:#555;border-top:1px solid #eee;padding-top:12px">${tplFooter.replace("{Ten_Cua_Hang}", siteName||"Mr.Vũ")}</div>` : ""}
  </body></html>`);

  pw.document.close();
  setTimeout(() => pw.print(), 300);
}

function Page() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listOrders);
  const create = useServerFn(createOrder);
  const createScheduleFn = useServerFn(createSchedule);
  const listWorkTypesFn = useServerFn(listWorkTypes);
  const upsertCustomerFn = useServerFn(upsertCustomer);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["orders"],
    queryFn: () => listFn(),
  });

  const getSettingsFn = useServerFn(getSettings);
  const { data: siteSettings } = useQuery({
    queryKey: ["site_settings"],
    queryFn: () => getSettingsFn(),
  });

  const { data: workTypes = [] } = useQuery({
    queryKey: ["workTypes"],
    queryFn: () => listWorkTypesFn(),
  });

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "reserved">("orders");
  const [page, setPage] = useState(1);

  const [receiptOrder, setReceiptOrder] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Quick create customer state
  const [quickCustOpen, setQuickCustOpen] = useState(false);
  const [quickCustName, setQuickCustName] = useState("");
  const [quickCustPhone, setQuickCustPhone] = useState("");
  const [savingCust, setSavingCust] = useState(false);

  const [items, setItems] = useState<LineItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [branch, setBranch] = useState("");
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState<"completed" | "reserved" | "draft">(
    "reserved",
  );
  const [paymentMethod, setPaymentMethod] = useState<
    "tien_mat" | "ngan_hang"
  >("tien_mat");
  const [bankAccountIdx, setBankAccountIdx] = useState<string>("");
  const [bankContent, setBankContent] = useState("");
  const [discountRaw, setDiscountRaw] = useState("0");
  const [discountPct, setDiscountPct] = useState("0");
  const [useDiscountPct, setUseDiscountPct] = useState(false);
  const [includeVat, setIncludeVat] = useState(false);
  const [vatMode, setVatMode] = useState<"8" | "10" | "custom">("10");
  const [vatCustomPercent, setVatCustomPercent] = useState("5");
  const [depositRaw, setDepositRaw] = useState("0");
  const [note, setNote] = useState("");

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5);
  const [createScheduleOnOrder, setCreateScheduleOnOrder] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    work_type_id: "",
    scheduled_date: todayStr,
    scheduled_time: nowTimeStr,
    address: "",
    note: "",
  });

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterBranch, setFilterBranch] = useState("");

  const customerMap = useMemo(
    () => new Map((data?.customers ?? []).map((c: any) => [c.id, c])),
    [data?.customers],
  );

  useEffect(() => {
    if (createScheduleOnOrder) {
      const cust = customer ? customerMap.get(customer) : null;
      const currentType = workTypes.find((t: any) => t.id === scheduleForm.work_type_id);
      const currentTypeLabel = currentType?.name ?? "Công việc";
      
      const autoTitle = cust 
        ? `${currentTypeLabel} — ${cust.name}` 
        : `${currentTypeLabel} — Khách lẻ`;

      const autoAddress = cust
        ? [cust.address, cust.ward, cust.province].filter(Boolean).join(", ")
        : "";

      setScheduleForm(f => ({
        ...f,
        title: autoTitle,
        address: f.address || autoAddress,
      }));
    }
  }, [customer, scheduleForm.work_type_id, createScheduleOnOrder, customerMap, workTypes]);

  const discount = useDiscountPct ? 0 : parseInput(discountRaw);
  const deposit = parseInput(depositRaw);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [items],
  );

  const discountAmt = useDiscountPct
    ? Math.round(subtotal * (Math.min(100, Math.max(0, parseFloat(discountPct) || 0)) / 100))
    : parseInput(discountRaw);
  const afterDiscount = Math.max(0, subtotal - discountAmt);

  const customVatRate = Math.min(100, Math.max(0, parseFloat(vatCustomPercent) || 0)) / 100;
  const vatRate = vatMode === "8" ? 0.08 : vatMode === "10" ? 0.1 : customVatRate;
  const vatAmt = includeVat ? Math.round(afterDiscount * vatRate) : 0;
  const total = afterDiscount + vatAmt;
  const khachCanThanhToan = Math.max(0, total - deposit);

  const branchMap = useMemo(
    () => new Map((data?.branches ?? []).map((b: any) => [b.id, b])),
    [data?.branches],
  );

  const scheduleMap = useMemo(() => {
    const map = new Map<string, any[]>();
    (data?.schedules ?? []).forEach((s: any) => {
      const key = s.order_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [data?.schedules]);

  const allOrders = useMemo(() => {
    const orders = data?.orders ?? [];
    if (!isAdmin && user && user.branch_ids.length > 0) {
      return orders.filter((o: any) => user.branch_ids.includes(o.branch_id));
    }
    return orders;
  }, [data?.orders, isAdmin, user]);

  const invoiceOrders = useMemo(
    () => allOrders.filter((o: any) => o.status !== "reserved"),
    [allOrders],
  );

  const reservedOrders = useMemo(
    () => allOrders.filter((o: any) => o.status === "reserved"),
    [allOrders],
  );

  function applyFilter(list: typeof allOrders) {
    const q = search.trim().toLowerCase();
    return list
      .filter((o) => {
        const custName = customerMap.get(o.customer_id)?.name ?? "";
        return (
          (o.code.toLowerCase().includes(q) ||
            custName.toLowerCase().includes(q)) &&
          (!filterStatus || o.status === filterStatus) &&
          (!filterBranch || o.branch_id === filterBranch)
        );
      })
      .sort((a, b) => {
        if (sortBy === "total_desc") return b.total - a.total;
        if (sortBy === "total_asc") return a.total - b.total;
        if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }

  const filteredOrders = useMemo(
    () => applyFilter(activeTab === "reserved" ? reservedOrders : invoiceOrders),
    [activeTab, reservedOrders, invoiceOrders, search, sortBy, filterStatus, filterBranch, customerMap],
  );

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleSort(v: string) {
    setSortBy(v);
    setPage(1);
  }

  function handleTab(t: "orders" | "reserved") {
    handleTabExecute(t);
  }

  function handleTabExecute(t: "orders" | "reserved") {
    setActiveTab(t);
    setPage(1);
    setSearch("");
    setFilterStatus("");
  }

  async function handleQuickCreateCustomer() {
    if (!quickCustName.trim()) return toast.error("Nhập tên khách hàng");
    setSavingCust(true);
    try {
      await upsertCustomerFn({
        data: {
          name: quickCustName.trim(),
          phone: quickCustPhone.trim() || undefined,
          group_name: "le",
          debt: 0,
        },
      });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Đã tạo khách hàng: ${quickCustName.trim()}`);
      setQuickCustOpen(false);
      setQuickCustName("");
      setQuickCustPhone("");
      // Auto-select the new customer after data refreshes
      setTimeout(async () => {
        const fresh = await listFn();
        const newCust = (fresh?.customers ?? []).find((c: any) => c.name === quickCustName.trim() && (!quickCustPhone || c.phone === quickCustPhone));
        if (newCust) setCustomer(newCust.id);
      }, 500);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tạo khách hàng");
    } finally {
      setSavingCust(false);
    }
  }

  function reset() {
    const allowedBranches = (data?.branches ?? []).filter(
      (b: any) => isAdmin || !user || user.branch_ids.length === 0 || user.branch_ids.includes(b.id),
    );

    setItems([]);
    setCustomer("");
    setBranch(allowedBranches[0]?.id ?? "");
    setEmployee(user?.id ?? "");
    setStatus("reserved");
    setPaymentMethod("tien_mat");
    setBankAccountIdx("");
    setBankContent("");
    setDiscountRaw("0");
    setDiscountPct("0");
    setUseDiscountPct(false);
    setIncludeVat(false);
    setVatMode("10");
    setVatCustomPercent("5");
    setDepositRaw("0");
    setNote("");
    setCreateScheduleOnOrder(false);
    setScheduleForm({
      title: "",
      work_type_id: workTypes?.[0]?.id || "",
      scheduled_date: new Date().toISOString().slice(0, 10),
      scheduled_time: new Date().toTimeString().slice(0, 5),
      address: "",
      note: "",
    });
  }

  function addItem() {
    const p = data?.products?.[0];
    if (!p) return;
    setItems([
      ...items,
      {
        product_id: p.id,
        qty: 1,
        unit_price: (p as any).sale_price ?? 0,
        discount: 0,
      },
    ]);
  }

  async function submit() {
    if (items.length === 0) return toast.error("Đơn chưa có sản phẩm");
    if (!branch) return toast.error("Chọn chi nhánh");

    if (createScheduleOnOrder && !scheduleForm.title) {
      return toast.error("Vui lòng nhập tiêu đề lịch làm việc");
    }

    setSubmitting(true);
    try {
      const r = await create({
        data: {
          customer_id: customer || undefined,
          branch_id: branch,
          employee_id: employee || undefined,
          status,
          payment_method: paymentMethod,
          discount: discountAmt,
          deposit,
          paid: 0,
          note: note || undefined,
          items,
        },
      });

      if (createScheduleOnOrder && scheduleForm.title && user) {
        try {
          await createScheduleFn({
            data: {
              ...scheduleForm,
              order_id: r.id,
              customer_id: customer || undefined,
              branch_id: branch,
              created_by: user.id,
              assigned_by: undefined,
            },
          });
        } catch (se: any) {
          toast.warning("Đơn đã tạo nhưng lịch làm việc lỗi: " + (se?.message ?? ""));
        }
      }

      setReceiptOrder({
        ...r,
        subtotal,
        discountAmt,
        vatAmt,
        total,
        deposit,
        khachCanThanhToan,
        items,
        customer,
        branch,
        employee,
        paymentMethod,
        note,
        includeVat,
      });

      toast.success("Tạo đơn " + r.code);
      reset();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setReceiptOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      setSubmitting(false);
    }
  }

  function OrderTable({ rows }: { rows: typeof allOrders }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2 pr-2 w-8 text-center">STT</th>
              <th className="pr-2">Mã đơn</th>
              <th className="pr-2">Ngày</th>
              <th className="pr-2">Khách hàng</th>
              <th className="pr-2">Chi nhánh</th>
              <th className="text-right pr-2">Tổng</th>
              <th className="pr-2">Trạng thái</th>
              <th className="pr-2">Lịch lắp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, idx) => {
              const cust = customerMap.get(o.customer_id)?.name ?? "Khách lẻ";
              const br = branchMap.get(o.branch_id)?.name ?? "—";
              const linked = scheduleMap.get(o.id) ?? [];
              const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;

              return (
                <tr
                  key={o.id}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => navigate({ to: "/orders/$id", params: { id: o.id } })}
                >
                  <td className="py-2 text-center text-xs text-muted-foreground pr-2">
                    {globalIdx}
                  </td>
                  <td className="font-mono text-xs pr-2 font-medium">{o.code}</td>
                  <td className="text-xs text-muted-foreground pr-2 whitespace-nowrap">
                    {new Date(o.created_at).toLocaleString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="pr-2 max-w-[140px] truncate">{cust}</td>
                  <td className="pr-2 text-xs text-muted-foreground">{br}</td>
                  <td className="text-right font-medium pr-2 whitespace-nowrap">
                    {fmt(o.total)}
                  </td>
                  <td className="pr-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? "bg-secondary"}`}
                    >
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="pr-2" onClick={(e) => e.stopPropagation()}>
                    {linked.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Link
                        to="/schedule"
                        className="inline-flex items-center gap-1 text-xs rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 hover:bg-blue-100"
                      >
                        <CalendarDays className="h-3 w-3" /> {linked.length} lịch
                      </Link>
                    )}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to="/orders/$id"
                      params={{ id: o.id }}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      title="Xem chi tiết"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  Không có đơn nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AppShell title="Bán hàng" loading={!data}>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              Tạo đơn hàng
            </Button>
          </DialogTrigger>

          <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Tạo đơn hàng</DialogTitle>
              <DialogDescription>
                Tạo hóa đơn bán hàng hoặc đơn đặt hàng cho khách.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Khách hàng</Label>
                    <button
                      type="button"
                      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                      onClick={() => { setQuickCustName(""); setQuickCustPhone(""); setQuickCustOpen(true); }}
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Tạo mới
                    </button>
                  </div>
                  <SearchableSelect
                    value={customer}
                    onChange={setCustomer}
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
                    value={branch}
                    onChange={setBranch}
                    placeholder="Tìm chi nhánh..."
                    options={(data?.branches ?? [])
                      .filter((b: any) => isAdmin || !user || user.branch_ids.length === 0 || user.branch_ids.includes(b.id))
                      .map((b: any) => ({ value: b.id, label: b.name }))}
                  />
                </div>

                <div>
                  <Label>Nhân viên</Label>
                  <SearchableSelect
                    value={employee}
                    onChange={setEmployee}
                    emptyLabel="---"
                    placeholder="Tìm nhân viên..."
                    options={(data?.employees ?? []).map((e: any) => ({
                      value: e.id,
                      label: e.name,
                    }))}
                  />
                </div>

                <div>
                  <Label>Trạng thái</Label>
                  <SearchableSelect
                    value={status}
                    onChange={(v) => setStatus(v as any)}
                    placeholder="Chọn trạng thái..."
                    options={[
                      { value: "reserved", label: "Đặt hàng (chưa giao)" },
                      { value: "draft", label: "Nháp" },
                    ]}
                  />
                </div>

                <div>
                  <Label>Hình thức thanh toán</Label>
                  <SearchableSelect
                    value={paymentMethod}
                    onChange={(v) => {
                      setPaymentMethod(v as any);
                      setBankAccountIdx("");
                      setBankContent("");
                    }}
                    placeholder="Chọn hình thức..."
                    options={[
                      { value: "tien_mat", label: "Tiền mặt" },
                      { value: "ngan_hang", label: "Chuyển khoản (Ngân hàng)" },
                    ]}
                  />
                  {paymentMethod === "ngan_hang" && (() => {
                    const bankList: any[] = (() => {
                      try { return JSON.parse(siteSettings?.bank_accounts || "[]"); }
                      catch { return []; }
                    })();
                    return (
                      <div className="mt-2 space-y-2">
                        {bankList.length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Chọn tài khoản nhận tiền</Label>
                            <select
                              className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                              value={bankAccountIdx}
                              onChange={e => {
                                const idx = e.target.value;
                                setBankAccountIdx(idx);
                                if (idx !== "") {
                                  const ba = bankList[parseInt(idx)];
                                  if (ba && !bankContent) {
                                    setBankContent(`${siteSettings?.site_name ?? "CK"} ${ba.account_number}`);
                                  }
                                }
                              }}
                            >
                              <option value="">— Chọn STK —</option>
                              {bankList.map((ba: any, i: number) => (
                                <option key={i} value={String(i)}>
                                  {ba.bank} - {ba.account_number} ({ba.account_name})
                                </option>
                              ))}
                            </select>
                            {bankAccountIdx !== "" && (() => {
                              const ba = bankList[parseInt(bankAccountIdx)];
                              return ba ? (
                                <div className="mt-1.5 rounded-lg border bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-0.5">
                                  <div className="font-semibold text-sm">{ba.bank}</div>
                                  <div>STK: <span className="font-mono font-bold tracking-wide">{ba.account_number}</span></div>
                                  <div>Chủ TK: {ba.account_name}</div>
                                  {ba.note && <div className="text-blue-600">{ba.note}</div>}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        )}
                        <div>
                          <Label className="text-xs text-muted-foreground">Nội dung chuyển khoản</Label>
                          <div className="mt-1 relative">
                            <Input
                              value={bankContent}
                              onChange={e => setBankContent(e.target.value)}
                              placeholder="VD: DATHANG0001 NGUYEN VAN A"
                              className="pr-10 font-mono text-sm"
                            />
                            {bankContent && (
                              <button
                                type="button"
                                className="absolute right-2 top-2 text-xs text-primary hover:underline"
                                onClick={() => { navigator.clipboard.writeText(bankContent); toast.success("Đã copy nội dung CK!"); }}
                              >Copy</button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Sản phẩm</Label>
                  <Button size="sm" type="button" variant="outline" onClick={addItem}>
                    <Plus className="h-4 w-4 mr-1" /> Thêm SP
                  </Button>
                </div>

                <div className="space-y-2">
                  {items.length === 0 && (
                    <div className="text-muted-foreground text-sm py-2">
                      Chưa có sản phẩm. Bấm "Thêm SP".
                    </div>
                  )}

                  {items.map((item, idx) => {
                    const currentProd = (data?.products ?? []).find((x: any) => x.id === item.product_id);
                    const currentStock = currentProd?.stock ?? 0;
                    const lineTotal = item.qty * item.unit_price - item.discount;
                    
                    return (
                      <div key={idx} className="flex flex-col gap-1.5 rounded-lg border p-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <SearchableSelect
                            className="flex-1"
                            value={item.product_id}
                            onChange={(val) => {
                              const p = (data?.products ?? []).find((x: any) => x.id === val);
                              const next = [...items];
                              next[idx] = {
                                ...next[idx],
                                product_id: val,
                                unit_price: (p as any)?.sale_price ?? 0,
                              };
                              setItems(next);
                            }}
                            placeholder="Chọn sản phẩm..."
                            options={(data?.products ?? []).map((p: any) => ({
                              value: p.id,
                              label: p.name,
                              sub: p.sku ? `SKU: ${p.sku} | Tồn: ${p.stock ?? 0}` : `Tồn: ${p.stock ?? 0}`,
                            }))}
                          />
                          <button
                            type="button"
                            className="flex items-center justify-center rounded-md border hover:text-destructive p-1.5 shrink-0"
                            onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center border rounded-md overflow-hidden shrink-0">
                            <button
                              type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-r text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const n = [...items];
                                n[idx].qty = Math.max(1, n[idx].qty - 1);
                                setItems(n);
                              }}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              className="w-12 text-center text-sm py-1.5 bg-background border-0 outline-none [appearance:textfield]"
                              value={item.qty}
                              min={1}
                              onChange={(e) => {
                                const n = [...items];
                                n[idx].qty = Math.max(1, Number(e.target.value) || 1);
                                setItems(n);
                              }}
                            />
                            <button
                              type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-l text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const n = [...items];
                                n[idx].qty = n[idx].qty + 1;
                                setItems(n);
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input
                            className="flex-1"
                            placeholder="Đơn giá"
                            value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                            onChange={(e) => {
                              const n = [...items];
                              n[idx].unit_price = parseInput(e.target.value);
                              setItems(n);
                            }}
                          />
                          <div className="flex flex-col justify-center text-right shrink-0 min-w-[100px]">
                            <span className="text-sm font-semibold text-primary">{fmt(lineTotal)}</span>
                            <span className={`text-[11px] font-medium ${currentStock < item.qty ? "text-destructive" : "text-muted-foreground"}`}>
                              Kho: {currentStock}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>Giảm giá</Label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={useDiscountPct}
                        onCheckedChange={(v) => setUseDiscountPct(!!v)}
                        id="use-pct"
                      />
                      Theo %
                    </label>
                  </div>
                  {useDiscountPct ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="flex-1"
                        placeholder="0"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  ) : (
                    <Input
                      className="mt-1"
                      value={discountRaw}
                      onChange={(e) => setDiscountRaw(fmtInput(e.target.value))}
                      onFocus={(e) => e.target.select()}
                    />
                  )}
                </div>

                <div>
                  <Label>Đặt cọc (₫)</Label>
                  <Input
                    className="mt-1"
                    value={depositRaw}
                    onChange={(e) => setDepositRaw(fmtInput(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2.5 hover:bg-muted/30 transition-colors">
                  <Checkbox checked={includeVat} onCheckedChange={(v) => setIncludeVat(!!v)} id="vat" />
                  <span className="text-sm font-medium">Thu thuế VAT</span>
                  {includeVat && <span className="ml-auto text-sm font-semibold text-orange-600">+ {fmt(vatAmt)}</span>}
                </label>
                {includeVat && (
                  <div className="border-t px-3 py-2.5 bg-orange-50/40 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground font-medium">Thuế suất:</span>
                    {(["8", "10"] as const).map(rate => (
                      <label key={rate} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="vat-rate"
                          value={rate}
                          checked={vatMode === rate}
                          onChange={() => setVatMode(rate)}
                          className="accent-primary"
                        />
                        {rate}%
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="vat-rate"
                        value="custom"
                        checked={vatMode === "custom"}
                        onChange={() => setVatMode("custom")}
                        className="accent-primary"
                      />
                      Tự nhập
                    </label>
                    {vatMode === "custom" && (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="w-24 h-7 text-sm"
                          placeholder="% VAT"
                          value={vatCustomPercent}
                          onChange={(e) => setVatCustomPercent(e.target.value)}
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Label>Ghi chú đơn hàng</Label>
                <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <div className="rounded-lg border overflow-hidden">
                <label className="flex items-center gap-2 cursor-pointer select-none bg-blue-50/60 px-3 py-2.5 hover:bg-blue-100/60 transition-colors">
                  <Checkbox
                    checked={createScheduleOnOrder}
                    onCheckedChange={(v) => setCreateScheduleOnOrder(!!v)}
                    id="create-schedule"
                  />
                  <CalendarDays className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Tạo lịch làm việc đi kèm luôn</span>
                </label>
                {createScheduleOnOrder && (
                  <div className="p-3 space-y-3 bg-blue-50/20 border-t">
                    <div>
                      <Label className="text-xs font-semibold">Tiêu đề lịch làm việc *</Label>
                      <Input
                        className="mt-1 h-9 text-sm font-medium"
                        value={scheduleForm.title}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                        placeholder="Tiêu đề tự động tạo ra hoặc nhập mới..."
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold">Loại hình công việc</Label>
                        <select
                          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={scheduleForm.work_type_id}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, work_type_id: e.target.value })}
                        >
                          <option value="">-- Chọn loại công việc --</option>
                          {workTypes?.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name} {t.price ? `(${fmt(t.price)})` : ""}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Ngày thực hiện</Label>
                        <Input
                          type="date"
                          className="mt-1 h-9 text-sm"
                          value={scheduleForm.scheduled_date}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_date: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold">Giờ thực hiện</Label>
                        <Input
                          type="time"
                          className="mt-1 h-9 text-sm"
                          value={scheduleForm.scheduled_time}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_time: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Địa chỉ công việc</Label>
                        <Input
                          className="mt-1 h-9 text-sm"
                          value={scheduleForm.address}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, address: e.target.value })}
                          placeholder="Địa chỉ giao hàng / lắp đặt..."
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Ghi chú công việc</Label>
                      <Input
                        className="mt-1 h-9 text-sm"
                        value={scheduleForm.note}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, note: e.target.value })}
                        placeholder="Nội dung nhắc nhở thêm cho kỹ thuật..."
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-4 bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span>Tạm tính</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {discountAmt > 0 && (
                  <div className="flex justify-between text-sm mt-1 text-green-700">
                    <span>Giảm giá{useDiscountPct ? ` (${discountPct}%)` : ""}</span>
                    <span>- {fmt(discountAmt)}</span>
                  </div>
                )}
                {includeVat && (
                  <div className="flex justify-between text-sm mt-1 text-orange-600">
                    <span>Thuế VAT ({vatMode === "custom" ? `${vatCustomPercent || 0}%` : `${vatMode}%`})</span>
                    <span>+ {fmt(vatAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm mt-1 font-medium">
                  <span>Tổng tiền</span>
                  <span>{fmt(total)}</span>
                </div>
                {deposit > 0 && (
                  <div className="flex justify-between text-sm mt-1 text-yellow-700">
                    <span>Đặt cọc</span>
                    <span>- {fmt(deposit)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-lg mt-2 pt-2 border-t text-primary">
                  <span>Khách cần thanh toán</span>
                  <span>{fmt(khachCanThanhToan)}</span>
                </div>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
                  Hủy
                </Button>
                <Button className="w-full sm:w-auto" onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang tạo...</>
                  ) : "Tạo đơn"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Quick Create Customer Dialog */}
        <Dialog open={quickCustOpen} onOpenChange={setQuickCustOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" /> Tạo khách hàng nhanh
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Tên khách hàng *</Label>
                <Input
                  className="mt-1"
                  autoFocus
                  value={quickCustName}
                  onChange={(e) => setQuickCustName(e.target.value)}
                  placeholder="Nhập tên khách..."
                  onKeyDown={(e) => { if (e.key === "Enter") handleQuickCreateCustomer(); }}
                />
              </div>
              <div>
                <Label>Số điện thoại</Label>
                <Input
                  className="mt-1"
                  value={quickCustPhone}
                  onChange={(e) => setQuickCustPhone(e.target.value)}
                  placeholder="Số điện thoại (tùy chọn)"
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setQuickCustOpen(false)}>
                Hủy
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleQuickCreateCustomer} disabled={savingCust}>
                <UserPlus className="h-4 w-4 mr-1" />
                {savingCust ? "Đang tạo..." : "Tạo khách hàng"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
          <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-green-700 flex items-center gap-2">
                <span className="text-xl">✅</span> Đơn hàng đã tạo thành công!
              </DialogTitle>
              <DialogDescription>
                Phiếu thu dưới đây để truy thu số tiền còn nợ. In hoặc đóng để tiếp tục.
              </DialogDescription>
            </DialogHeader>
            {receiptOrder && (() => {
              const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
              const custName = receiptOrder.customer
                ? (data?.customers ?? []).find((c: any) => c.id === receiptOrder.customer)?.name ?? "Khách lẻ"
                : "Khách lẻ";
              const branchName = receiptOrder.branch
                ? (data?.branches ?? []).find((b: any) => b.id === receiptOrder.branch)?.name ?? "—"
                : "—";
              const empName = receiptOrder.employee
                ? (data?.employees ?? []).find((e: any) => e.id === receiptOrder.employee)?.name ?? "—"
                : "—";
              return (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3">
                    <div><span className="text-muted-foreground">Mã đơn: </span><strong className="font-mono">{receiptOrder.code}</strong></div>
                    <div><span className="text-muted-foreground">Khách: </span>{custName}</div>
                    <div><span className="text-muted-foreground">Chi nhánh: </span>{branchName}</div>
                    <div><span className="text-muted-foreground">Nhân viên: </span>{empName}</div>
                    <div><span className="text-muted-foreground">Thanh toán: </span>{receiptOrder.paymentMethod === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt"}</div>
                  </div>

                  <div className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tạm tính</span>
                      <span>{moneyFmt(receiptOrder.subtotal)}</span>
                    </div>
                    {receiptOrder.discountAmt > 0 && (
                      <div className="flex justify-between text-green-700">
                        <span>Giảm giá</span>
                        <span>- {moneyFmt(receiptOrder.discountAmt)}</span>
                      </div>
                    )}
                    {receiptOrder.includeVat && (
                      <div className="flex justify-between text-orange-600">
                        <span>Thuế VAT</span>
                        <span>+ {moneyFmt(receiptOrder.vatAmt)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium border-t pt-1.5">
                      <span>Tổng tiền</span>
                      <span>{moneyFmt(receiptOrder.total)}</span>
                    </div>
                    {receiptOrder.deposit > 0 && (
                      <div className="flex justify-between text-yellow-700">
                        <span>Đặt cọc</span>
                        <span>- {moneyFmt(receiptOrder.deposit)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg pt-1 border-t text-green-700">
                      <span>Còn phải thu</span>
                      <span>{moneyFmt(receiptOrder.khachCanThanhToan)}</span>
                    </div>
                  </div>

                  {receiptOrder.note && <div className="text-muted-foreground text-xs">Ghi chú: {receiptOrder.note}</div>}
                </div>
              );
            })()}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (receiptOrder && data && siteSettings) {
                    printOrderSlip({
                      items: receiptOrder.items,
                      customer: receiptOrder.customer,
                      branch: receiptOrder.branch,
                      employee: receiptOrder.employee,
                      status: receiptOrder.status,
                      paymentMethod: receiptOrder.paymentMethod,
                      discount: receiptOrder.discountAmt,
                      discountAmt: receiptOrder.discountAmt,
                      vatAmt: receiptOrder.vatAmt,
                      deposit: receiptOrder.deposit,
                      note: receiptOrder.note,
                      subtotal: receiptOrder.subtotal,
                      total: receiptOrder.total,
                      includeVat: receiptOrder.includeVat,
                      data,
                      siteSettings,
                      tpl: (() => { try { return JSON.parse(siteSettings?.print_templates || "{}").order_invoice; } catch { return {}; } })(),
                    });
                  }
                }}
              >
                🖨️ In phiếu
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => setReceiptOpen(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {reservedOrders.length > 0 && (
          <span className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1 flex items-center gap-1">
            <Clock className="h-3 w-3" /> {reservedOrders.length} đơn đặt hàng chờ giao
          </span>
        )}
      </div>

      <div className="flex gap-1 mb-3 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "orders" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("orders")}
        >
          <ShoppingBag className="h-4 w-4 inline mr-1" /> Hóa đơn bán hàng
        </button>

        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeTab === "reserved" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("reserved")}
        >
          <Clock className="h-4 w-4 inline mr-1" /> Đơn đặt hàng
          {reservedOrders.length > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5">
              {reservedOrders.length}
            </span>
          )}
        </button>
      </div>

      <Card>
        <SearchFilter
          search={search}
          onSearch={handleSearch}
          placeholder="Tìm mã đơn, khách hàng..."
          sortOptions={[
            { value: "newest", label: "Mới nhất" },
            { value: "oldest", label: "Cũ nhất" },
            { value: "total_desc", label: "Giá trị cao nhất" },
            { value: "total_asc", label: "Giá trị thấp nhất" },
          ]}
          sortValue={sortBy}
          onSort={handleSort}
          filterSlot={
            <div className="flex flex-wrap gap-2">
              {activeTab === "orders" && (
<select
  className="h-9 rounded-md border bg-background px-2 text-sm"
  value={filterStatus}
  onChange={(e) => {
    setFilterStatus(e.target.value);
    setPage(1);
  }}
>
  <option value="">Tất cả trạng thái</option>
  <option value="completed">Hoàn tất</option>
  <option value="partially_returned">Trả hàng 1 phần</option>
  <option value="returned">Đã trả hàng</option>
  <option value="draft">Nháp</option>
  <option value="cancelled">Hủy</option>
</select>
              )}

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterBranch}
                onChange={(e) => {
                  setFilterBranch(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả chi nhánh</option>
                {(data?.branches ?? []).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          }
          total={filteredOrders.length}
          totalLabel={activeTab === "reserved" ? "đơn đặt hàng" : "đơn hàng"}
        />

        <OrderTable rows={pagedOrders} />

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm flex-wrap gap-2">
            <span className="text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredOrders.length)} / {filteredOrders.length}
            </span>

            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((n) => (
                <Button key={n} size="sm" variant={n === page ? "default" : "outline"} className="w-8 h-8 p-0" onClick={() => setPage(n)}>
                  {n}
                </Button>
              ))}
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
}