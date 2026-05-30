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
  MapPin,
  Landmark,
  Wallet,
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
  head: () => ({ meta: [{ title: "Bán hàng — Mr.Vũ" }] }),
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

const GROUP_LABEL: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};
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


// ─────────────────────────────────────────────────────────────────────────────
// SHARED INVOICE PRINTER  — dùng chung cho orders/index, orders/$id, schedule
// ─────────────────────────────────────────────────────────────────────────────
function buildInvoiceHtml({
  order,
  custName, custPhone, custAddress,
  branchName, empName,
  items, products,
  moneyFmt,
  ss,          // siteSettings
  tplOverride, // object {header?, footer?, warranty?, showWarranty?} từ admin
}: any): string {
  const _site   = ss?.site_name?.trim() || "Mr.Vũ";
  const _tpl    = tplOverride ?? (() => {
    try { return JSON.parse(ss?.print_templates || "{}").order_invoice ?? {}; } catch { return {}; }
  })();
  const _header  = (_tpl.header   ?? "PHIẾU XUẤT KHO / KIỂM BẢO HÀNH").replace("{Ten_Cua_Hang}", _site);
  const _footer  = (_tpl.footer   ?? `${_site} — Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ!`).replace("{Ten_Cua_Hang}", _site);
  const _showW   = _tpl.showWarranty !== false;
  const _warranty = _showW
    ? ((_tpl.warranty ?? `LƯU Ý: ${_site} KHUYẾN CÁO KIỂM TRA THIẾT BỊ ĐỊNH KỲ ÍT NHẤT 6 THÁNG/LẦN ĐỂ ĐẢM BẢO AN TOÀN.`).replace("{Ten_Cua_Hang}", _site))
    : "";

  const statusMap: Record<string, string> = { completed: "Hoàn tất", reserved: "Đặt hàng", draft: "Nháp" };
  const pmLabel = order.payment_method === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt";
  const dateStr = order.created_at
    ? new Date(order.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const rows = (items ?? []).map((item: any, i: number) => {
    const prod = (products ?? []).find((p: any) => p.id === item.product_id);
    const qty = Number(item.qty ?? 0);
    const price = Number(item.unit_price ?? 0);
    const disc = Number(item.discount ?? 0);
    const lineTotal = qty * price - disc;
    return `
    <tr>
      <td class="tc">${i + 1}</td>
      <td class="pl">${prod?.name ?? item.product_id ?? "—"}</td>
      <td class="tc">${qty}</td>
      <td class="tr">${moneyFmt(price)}</td>
      <td class="tr fw">${moneyFmt(lineTotal)}</td>
    </tr>`;
  }).join("");

  const subtotal  = Number(order.subtotal  ?? 0);
  const discount  = Number(order.discount  ?? 0);
  const vatAmt    = Number(order.vat_amount ?? 0);
  const total     = Number(order.total     ?? 0);
  const deposit   = Number(order.deposit   ?? 0);
  const paid      = Number(order.paid      ?? 0);
  const remaining = Math.max(0, total - deposit - paid);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_header} — ${order.code ?? ""}</title>
<style>
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Base ── */
body {
  font-family: 'Segoe UI', 'Arial Unicode MS', Tahoma, 'DejaVu Sans', Arial, sans-serif;
  font-size: 13.5px;
  color: #1a1a2e;
  background: #fff;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  padding: 36px 40px;
}
.page { max-width: 780px; margin: 0 auto; }

/* ── Header ── */
.hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 2.5px solid #1d4ed8;
}
.hdr-left { flex: 1; }
.logo { height: 56px; object-fit: contain; margin-bottom: 8px; display: block; }
.shop-name {
  font-size: 19px; font-weight: 800; color: #1d4ed8;
  letter-spacing: -0.3px; line-height: 1.2;
}
.shop-meta { font-size: 11.5px; color: #64748b; line-height: 1.75; margin-top: 5px; }
.hdr-right { text-align: right; flex-shrink: 0; }
.inv-badge {
  display: inline-block;
  background: #1d4ed8;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.inv-title {
  font-size: 16px; font-weight: 800;
  color: #111; text-transform: uppercase;
  letter-spacing: 0.5px; line-height: 1.3;
  margin-bottom: 8px;
}
.inv-meta { font-size: 12px; color: #64748b; line-height: 2; }
.inv-meta strong { color: #374151; }

/* ── Info grid ── */
.info-wrap {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 32px;
}
.info-cell .lbl {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #94a3b8;
  margin-bottom: 2px;
}
.info-cell .val {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
.info-full { grid-column: span 2; }

/* ── Divider ── */
.divider { border: none; border-top: 1px solid #e2e8f0; margin: 18px 0; }

/* ── Table ── */
.items-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}
.items-table thead tr {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff;
}
.items-table th {
  padding: 11px 10px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.items-table tbody tr:nth-child(even) { background: #f8fafc; }
.items-table tbody tr:hover { background: #eff6ff; }
.items-table td {
  padding: 10px;
  font-size: 13px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.tc { text-align: center; }
.tr { text-align: right; }
.pl { padding-left: 14px; }
.fw { font-weight: 700; }

/* ── Totals ── */
.totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
.totals-box {
  min-width: 280px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}
.t-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 13px;
  border-bottom: 1px solid #f1f5f9;
}
.t-row:last-child { border-bottom: none; }
.t-row.discount { color: #16a34a; }
.t-row.vat      { color: #d97706; }
.t-row.deposit  { color: #b45309; }
.t-row.paid-amt { color: #0891b2; }
.t-row.grand {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  padding: 11px 16px;
}

/* ── Note ── */
.note-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-left: 4px solid #f59e0b;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 22px;
}

/* ── Checklist ── */
.check-box {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 22px;
}
.check-title {
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 10px;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12.5px;
  color: #374151;
}
.checkbox {
  width: 14px; height: 14px;
  border: 1.5px solid #cbd5e1;
  border-radius: 3px;
  flex-shrink: 0;
  display: inline-block;
}
.customer-confirm {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #e2e8f0;
  font-size: 11.5px;
  color: #64748b;
}

/* ── Signatures ── */
.sign-section { margin-top: 12px; }
.sign-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  text-align: center;
}
.sign-card {
  padding: 8px;
}
.sign-role {
  font-size: 12.5px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 3px;
}
.sign-hint {
  font-size: 10.5px;
  color: #94a3b8;
  margin-bottom: 44px;
}
.sign-line {
  border-top: 1.5px dashed #cbd5e1;
  padding-top: 5px;
  font-size: 10.5px;
  color: #cbd5e1;
  letter-spacing: 1px;
}

/* ── Warranty ── */
.warranty-box {
  margin-top: 20px;
  padding: 12px 16px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-left: 4px solid #f97316;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  line-height: 1.8;
  color: #9a3412;
}

/* ── Footer ── */
.footer-text {
  margin-top: 18px;
  text-align: center;
  font-size: 12.5px;
  color: #64748b;
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
  line-height: 1.6;
}

/* ── Print ── */
@media print {
  body { padding: 10px 14px; }
  .items-table tbody tr:hover { background: inherit; }
}
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-left">
      ${ss?.logo_url ? `<img class="logo" src="${ss.logo_url}" alt="logo">` : ""}
      <div class="shop-name">${_site}</div>
      <div class="shop-meta">
        ${ss?.address    ? `<span>📍 ${ss.address}</span><br>` : ""}
        ${ss?.phone      ? `<span>📞 ${ss.phone}</span>` : ""}
        ${ss?.phone && ss?.email ? "&nbsp;&nbsp;|&nbsp;&nbsp;" : ""}
        ${ss?.email      ? `<span>✉ ${ss.email}</span>` : ""}
        ${ss?.tax_code   ? `<br><span>MST: ${ss.tax_code}</span>` : ""}
      </div>
    </div>
    <div class="hdr-right">
      <div class="inv-badge">Hóa đơn bán hàng</div>
      <div class="inv-title">${_header}</div>
      <div class="inv-meta">
        <strong>Mã phiếu</strong>&ensp;${order.code ?? "—"}<br>
        <strong>Ngày lập</strong>&ensp;${dateStr}<br>
        <strong>Trạng thái</strong>&ensp;${statusMap[order.status] ?? order.status ?? "—"}
      </div>
    </div>
  </div>

  <!-- INFO -->
  <div class="info-wrap">
    <div class="info-cell">
      <div class="lbl">Khách hàng</div>
      <div class="val">${custName ?? "Khách lẻ"}${custPhone ? `&ensp;<span style="color:#64748b;font-weight:400">📞 ${custPhone}</span>` : ""}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Chi nhánh</div>
      <div class="val">${branchName ?? "—"}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Nhân viên</div>
      <div class="val">${empName ?? "—"}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Hình thức thanh toán</div>
      <div class="val">${pmLabel}</div>
    </div>
    ${custAddress ? `
    <div class="info-cell info-full">
      <div class="lbl">Địa chỉ lắp đặt</div>
      <div class="val">${custAddress}</div>
    </div>` : ""}
  </div>

  <!-- PRODUCTS -->
  <table class="items-table">
    <thead>
      <tr>
        <th class="tc" style="width:44px">#</th>
        <th style="text-align:left;padding-left:14px">Tên sản phẩm</th>
        <th class="tc" style="width:58px">SL</th>
        <th class="tr" style="width:130px">Đơn giá</th>
        <th class="tr" style="width:140px">Thành tiền</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="t-row"><span>Tạm tính</span><span>${moneyFmt(subtotal)}</span></div>
      ${discount  > 0 ? `<div class="t-row discount"><span>Giảm giá</span><span>− ${moneyFmt(discount)}</span></div>` : ""}
      ${vatAmt    > 0 ? `<div class="t-row vat"     ><span>Thuế VAT</span><span>+ ${moneyFmt(vatAmt)}</span></div>` : ""}
      <div class="t-row" style="font-weight:700"><span>Tổng cộng</span><span>${moneyFmt(total)}</span></div>
      ${deposit   > 0 ? `<div class="t-row deposit"><span>Đã đặt cọc</span><span>− ${moneyFmt(deposit)}</span></div>` : ""}
      ${paid      > 0 ? `<div class="t-row paid-amt"><span>Đã thanh toán</span><span>− ${moneyFmt(paid)}</span></div>` : ""}
      <div class="t-row grand"><span>Khách cần trả</span><span>${moneyFmt(remaining)}</span></div>
    </div>
  </div>

  <!-- NOTE -->
  ${order.note ? `<div class="note-box"><strong>📝 Ghi chú:</strong>&ensp;${order.note}</div>` : ""}

  <!-- CHECKLIST -->
  <div class="check-box">
    <div class="check-title">✅&nbsp; Xác nhận bàn giao</div>
    ${["Đã giao hàng đúng mẫu và đầy đủ phụ kiện",
       "Đã lắp đặt hoàn thiện, thiết bị hoạt động ổn định",
       "Đã hướng dẫn sử dụng và bảo quản sản phẩm",
       "Đã thanh toán đúng số tiền ghi trên phiếu"]
      .map(t => `<div class="check-item"><span class="checkbox"></span><span>${t}</span></div>`)
      .join("")}
    <div class="customer-confirm">
      <strong>Xác nhận của khách hàng</strong>
      <span>Họ và tên: &emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&ensp; Chữ ký: &emsp;&emsp;&emsp;&emsp;&emsp;</span>
    </div>
  </div>

  <!-- SIGNATURES -->
  <div class="sign-section">
    <div class="sign-grid">
      ${["Kỹ thuật lắp đặt","Nhân viên bán hàng","Khách hàng","Thủ kho"]
        .map(r => `
        <div class="sign-card">
          <div class="sign-role">${r}</div>
          <div class="sign-hint">(Ký và ghi rõ họ tên)</div>
          <div class="sign-line">. . . . . . . . . .</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- WARRANTY -->
  ${_warranty ? `<div class="warranty-box">⚠&ensp;${_warranty}</div>` : ""}

  <!-- FOOTER -->
  ${_footer ? `<div class="footer-text">${_footer}</div>` : ""}

</div>
</body>
</html>`;
}

function printOrderSlip({
  items, customer, branch, employee, status, paymentMethod,
  discount, discountAmt, vatAmt, deposit, note, subtotal, total, includeVat, data, siteSettings, tpl,
}: any) {
  const moneyFmt  = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
  const custObj   = (data?.customers ?? []).find((c: any) => c.id === customer);
  const branchObj = (data?.branches  ?? []).find((b: any) => b.id === branch);
  const empObj    = (data?.employees ?? []).find((e: any) => e.id === employee);

  const fakeOrder = {
    code: undefined,
    created_at: new Date().toISOString(),
    status,
    payment_method: paymentMethod,
    subtotal,
    discount: discountAmt,
    vat_amount: includeVat ? vatAmt : 0,
    total,
    deposit,
    paid: 0,
    note,
  };

  const pw = window.open("", "_blank");
  if (!pw) return;
  pw.document.write(buildInvoiceHtml({
    order:       fakeOrder,
    custName:    custObj?.name,
    custPhone:   custObj?.phone,
    custAddress: custObj?.address,
    branchName:  branchObj?.name,
    empName:     empObj?.name,
    items,
    products:    data?.products ?? [],
    moneyFmt,
    ss:          siteSettings,
    tplOverride: tpl ?? (() => {
      try { return JSON.parse((siteSettings as any)?.print_templates || "{}").order_invoice ?? {}; }
      catch { return {}; }
    })(),
  }));
  pw.document.close();
  setTimeout(() => pw.print(), 300);
}

function Page() {
  const { user, isAdmin, activeBranchId } = useAuth();
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
  const [quickCustEmail, setQuickCustEmail] = useState("");
  const [quickCustGroup, setQuickCustGroup] = useState("le");
  const [quickCustType, setQuickCustType] = useState<"ca_nhan"|"to_chuc">("ca_nhan");
  const [quickCustNote, setQuickCustNote] = useState("");
  const [quickCustGender, setQuickCustGender] = useState("");
  const [quickCustBirthday, setQuickCustBirthday] = useState("");
  const [quickCustProvince, setQuickCustProvince] = useState("");
  const [quickCustWard, setQuickCustWard] = useState("");
  const [quickCustAddress, setQuickCustAddress] = useState("");
  const [quickCustCccd, setQuickCustCccd] = useState("");
  const [quickCustPassport, setQuickCustPassport] = useState("");
  const [quickCustCompany, setQuickCustCompany] = useState("");
  const [quickCustTaxCode, setQuickCustTaxCode] = useState("");
  const [quickCustBankName, setQuickCustBankName] = useState("");
  const [quickCustBankAccount, setQuickCustBankAccount] = useState("");
  const [quickCustDebt, setQuickCustDebt] = useState("0");
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
  const [vatInputMode, setVatInputMode] = useState<"pct" | "fixed">("pct");
  const [vatFixedAmt, setVatFixedAmt] = useState("0");
  const [depositRaw, setDepositRaw] = useState("0");
  const [khachThanhToanRaw, setKhachThanhToanRaw] = useState("");  // Số tiền khách trả thực tế
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
  const [filterBranch, setFilterBranch] = useState(() => activeBranchId ?? "");

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
  const vatAmt = includeVat
    ? (vatInputMode === "fixed"
        ? Math.max(0, parseInput(vatFixedAmt))
        : Math.round(afterDiscount * vatRate))
    : 0;
  const total = afterDiscount + vatAmt;
  const khachCanThanhToan = Math.max(0, total - deposit);

  // Payment panel calculations
  const khachThanhToan = khachThanhToanRaw === "" ? 0 : parseInput(khachThanhToanRaw);
  const congNo = Math.max(0, khachCanThanhToan - khachThanhToan);    // phần tính vào công nợ
  const tienThua = Math.max(0, khachThanhToan - khachCanThanhToan);  // tiền thừa trả lại

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
        if (sortBy === "oldest") {
          // Đơn hoàn tất: sort theo completed_at, còn lại theo created_at
          const dateA = a.status === "completed" && a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.created_at).getTime();
          const dateB = b.status === "completed" && b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.created_at).getTime();
          return dateA - dateB;
        }
        // newest (default): đơn hoàn tất sort theo completed_at, còn lại theo created_at
        const dateA = a.status === "completed" && a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.created_at).getTime();
        const dateB = b.status === "completed" && b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.created_at).getTime();
        return dateB - dateA;
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

  function resetQuickCustForm() {
    setQuickCustName(""); setQuickCustPhone(""); setQuickCustEmail("");
    setQuickCustGroup("le"); setQuickCustType("ca_nhan"); setQuickCustNote("");
    setQuickCustGender(""); setQuickCustBirthday(""); setQuickCustProvince("");
    setQuickCustWard(""); setQuickCustAddress(""); setQuickCustCccd("");
    setQuickCustPassport(""); setQuickCustCompany(""); setQuickCustTaxCode("");
    setQuickCustBankName(""); setQuickCustBankAccount(""); setQuickCustDebt("0");
  }

  async function handleQuickCreateCustomer() {
    if (!quickCustName.trim()) return toast.error("Nhập tên khách hàng");
    setSavingCust(true);
    try {
      await upsertCustomerFn({
        data: {
          name: quickCustName.trim(),
          phone: quickCustPhone.trim() || undefined,
          email: quickCustEmail.trim() || undefined,
          gender: quickCustGender || undefined,
          birthday: quickCustBirthday || undefined,
          province: quickCustProvince || undefined,
          ward: quickCustWard || undefined,
          address: quickCustAddress.trim() || undefined,
          group_name: quickCustGroup,
          customer_type: quickCustType,
          company_name: quickCustCompany.trim() || undefined,
          tax_code: quickCustTaxCode.trim() || undefined,
          cccd: quickCustCccd.trim() || undefined,
          passport_no: quickCustPassport.trim() || undefined,
          bank_name: quickCustBankName.trim() || undefined,
          bank_account: quickCustBankAccount.trim() || undefined,
          note: quickCustNote.trim() || undefined,
          debt: Number(quickCustDebt) || 0,
          _actor_id: user?.id,
        },
      });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Đã tạo khách hàng: ${quickCustName.trim()}`);
      setQuickCustOpen(false);
      const savedName = quickCustName.trim();
      const savedPhone = quickCustPhone.trim();
      resetQuickCustForm();
      // Auto-select the new customer after data refreshes
      setTimeout(async () => {
        const fresh = await listFn();
        const newCust = (fresh?.customers ?? []).find((c: any) => c.name === savedName && (!savedPhone || c.phone === savedPhone));
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
    setBranch(activeBranchId ?? allowedBranches[0]?.id ?? "");
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
    setVatInputMode("pct");
    setVatFixedAmt("0");
    setDepositRaw("0");
    setKhachThanhToanRaw("");
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
      // finalStatus:
      // - Nếu user đã chọn "completed" → luôn completed (dù paid=0, debt sẽ được cộng)
      // - Nếu paid > 0 (bất kể status chọn) → completed
      // - Còn lại → giữ status user đã chọn (reserved/draft)
      const finalStatus = status === "completed" || khachThanhToan > 0
        ? "completed"
        : status;

      const r = await create({
        data: {
          customer_id: customer || undefined,
          branch_id: branch,
          employee_id: employee || undefined,
          status: finalStatus,
          payment_method: paymentMethod,
          discount: discountAmt,
          discount_type: useDiscountPct ? "percent" : "amount",
          discount_pct: useDiscountPct ? parseFloat(discountPct) || 0 : 0,
          vat_rate: includeVat ? vatRate : 0,
          vat_amount: vatAmt,
          deposit,
          paid: khachThanhToan,
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
        khachThanhToan,
        congNo,
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
                      onClick={() => { resetQuickCustForm(); setQuickCustOpen(true); }}
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
                    // ✅ Tồn kho theo chi nhánh đang chọn, không phải stock tổng
                    const currentStock = (data?.stock ?? [])
                      .filter((s: any) => s.product_id === item.product_id && s.branch_id === branch)
                      .reduce((sum: number, s: any) => sum + Number(s.qty || 0), 0);
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
                            options={(data?.products ?? []).map((p: any) => {
                              // ✅ Tồn kho theo chi nhánh đang chọn
                              const branchStock = (data?.stock ?? [])
                                .filter((s: any) => s.product_id === p.id && s.branch_id === branch)
                                .reduce((sum: number, s: any) => sum + Number(s.qty || 0), 0);
                              return {
                                value: p.id,
                                label: p.name,
                                sub: p.sku
                                  ? `SKU: ${p.sku} | Tồn CN: ${branchStock}`
                                  : `Tồn CN: ${branchStock}`,
                              };
                            })}
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
                  <div className="border-t px-3 py-2.5 bg-orange-50/40 space-y-2.5">
                    {/* Toggle % / ₫ */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Cách nhập thuế:</span>
                      <div className="flex rounded-md border overflow-hidden text-xs">
                        <button type="button"
                          onClick={() => setVatInputMode("pct")}
                          className={`px-3 py-1 font-semibold transition-colors ${vatInputMode === "pct" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                          % Phần trăm
                        </button>
                        <button type="button"
                          onClick={() => setVatInputMode("fixed")}
                          className={`px-3 py-1 font-semibold transition-colors ${vatInputMode === "fixed" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                          ₫ Số tiền
                        </button>
                      </div>
                    </div>

                    {vatInputMode === "pct" ? (
                      /* Chế độ % */
                      <div className="flex flex-wrap items-center gap-3">
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
                    ) : (
                      /* Chế độ số tiền cụ thể */
                      <div className="flex items-center gap-2">
                        <Input
                          className="flex-1 h-8 text-sm font-mono"
                          placeholder="Nhập số tiền thuế..."
                          value={vatFixedAmt === "0" ? "" : new Intl.NumberFormat("vi-VN").format(Number(vatFixedAmt) || 0)}
                          onChange={(e) => setVatFixedAmt(e.target.value.replace(/\D/g, "") || "0")}
                          onFocus={(e) => { if (vatFixedAmt === "0") setVatFixedAmt(""); e.target.select(); }}
                        />
                        <span className="text-sm text-muted-foreground shrink-0">₫</span>
                        {Number(vatFixedAmt) > 0 && afterDiscount > 0 && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            ≈ {((Number(vatFixedAmt) / afterDiscount) * 100).toFixed(1)}%
                          </span>
                        )}
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
                  <span>Tổng tiền hàng ({items.length})</span>
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
                {deposit > 0 && (
                  <div className="flex justify-between text-sm mt-1 text-yellow-700">
                    <span>Đặt cọc</span>
                    <span>- {fmt(deposit)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t text-primary">
                  <span>Khách cần trả</span>
                  <span className="text-blue-600">{fmt(khachCanThanhToan)}</span>
                </div>
              </div>


              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
                  Hủy
                </Button>
                <Button
                  className="w-full sm:w-auto font-bold text-base h-12"
                  onClick={submit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang xử lý...</>
                  ) : "Tạo đơn"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Quick Create Customer Dialog — Full form đồng bộ với trang Khách hàng */}
        <Dialog open={quickCustOpen} onOpenChange={setQuickCustOpen}>
          <DialogContent style={{ padding: 0 }} className="max-h-[92vh] max-w-2xl overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
            <DialogHeader className="px-6 pt-6 pb-4 bg-muted/40 border-b">
              <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
                <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                  <UserPlus className="h-5 w-5" />
                </div>
                Thêm khách hàng mới
              </DialogTitle>
            </DialogHeader>

            <div className="p-4 space-y-5">
              {/* PHẦN 1: THÔNG TIN CƠ BẢN */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <UserPlus className="h-4 w-4" /> Thông tin cơ bản
                </div>
                <div className="flex gap-4">
                  {(["ca_nhan", "to_chuc"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="radio" name="qc_cust_type" value={t}
                        checked={quickCustType === t}
                        onChange={() => setQuickCustType(t)}
                        className="accent-primary" />
                      {t === "ca_nhan" ? "Cá nhân" : "Tổ chức / Hộ kinh doanh"}
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs font-medium">
                      {quickCustType === "to_chuc" ? "Tên người mua" : "Họ và tên"} <span className="text-destructive">*</span>
                    </Label>
                    <Input className="bg-background mt-1" placeholder="Nhập tên đầy đủ"
                      value={quickCustName} autoFocus
                      onChange={(e) => setQuickCustName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số điện thoại</Label>
                    <Input className="bg-background mt-1" placeholder="0912xxxxxx"
                      value={quickCustPhone} onChange={(e) => setQuickCustPhone(e.target.value)} />
                  </div>
                </div>
                {quickCustType === "ca_nhan" && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Email</Label>
                        <Input className="bg-background mt-1" placeholder="email@gmail.com"
                          value={quickCustEmail} onChange={(e) => setQuickCustEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Giới tính</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGender} onChange={(e) => setQuickCustGender(e.target.value)}>
                          <option value="">-- Chọn --</option>
                          <option value="nam">Nam</option>
                          <option value="nu">Nữ</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Ngày sinh</Label>
                        <Input type="date" className="bg-background mt-1"
                          value={quickCustBirthday} onChange={(e) => setQuickCustBirthday(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Nhóm đối tác</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGroup} onChange={(e) => setQuickCustGroup(e.target.value)}>
                          {Object.entries(GROUP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Số CCCD / CMND</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập số CCCD/CMND"
                          value={quickCustCccd} onChange={(e) => setQuickCustCccd(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Số hộ chiếu</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập số hộ chiếu"
                          value={quickCustPassport} onChange={(e) => setQuickCustPassport(e.target.value)} />
                      </div>
                    </div>
                  </>
                )}
                {quickCustType === "to_chuc" && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Tên công ty / Hộ kinh doanh</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập tên công ty"
                          value={quickCustCompany} onChange={(e) => setQuickCustCompany(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Mã số thuế</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập mã số thuế"
                          value={quickCustTaxCode} onChange={(e) => setQuickCustTaxCode(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Email</Label>
                        <Input className="bg-background mt-1" placeholder="email@company.com"
                          value={quickCustEmail} onChange={(e) => setQuickCustEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Nhóm đối tác</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGroup} onChange={(e) => setQuickCustGroup(e.target.value)}>
                          {Object.entries(GROUP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Ghi chú</Label>
                  <Input className="bg-background mt-1" placeholder="Ghi chú thêm về khách hàng..."
                    value={quickCustNote} onChange={(e) => setQuickCustNote(e.target.value)} />
                </div>
              </div>

              {/* PHẦN 2: ĐỊA CHỈ */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <MapPin className="h-4 w-4" /> Địa chỉ liên hệ
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Tỉnh / Thành phố</Label>
                    <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={quickCustProvince} onChange={(e) => setQuickCustProvince(e.target.value)}>
                      <option value="">-- Chọn tỉnh thành --</option>
                      {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Phường / Xã</Label>
                    <Input className="bg-background mt-1" placeholder="Nhập phường/xã"
                      value={quickCustWard} onChange={(e) => setQuickCustWard(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số nhà, tên đường</Label>
                  <Input className="bg-background mt-1" placeholder="Ví dụ: Số 123, đường Trần Hưng Đạo"
                    value={quickCustAddress} onChange={(e) => setQuickCustAddress(e.target.value)} />
                </div>
              </div>

              {/* PHẦN 3: NGÂN HÀNG */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <Landmark className="h-4 w-4" /> Thông tin ngân hàng
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Ngân hàng</Label>
                    <Input className="bg-background mt-1" placeholder="VD: Vietcombank, Techcombank..."
                      value={quickCustBankName} onChange={(e) => setQuickCustBankName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số tài khoản ngân hàng</Label>
                    <Input className="bg-background mt-1 font-mono" placeholder="Nhập số tài khoản"
                      value={quickCustBankAccount} onChange={(e) => setQuickCustBankAccount(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* PHẦN 4: CÔNG NỢ */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <Wallet className="h-4 w-4" /> Thiết lập tài chính
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Dư nợ công nợ đầu kỳ (nếu có)</Label>
                    <div className="relative mt-1">
                      <Input className="pl-8 bg-background font-medium text-destructive"
                        inputMode="numeric" placeholder="0"
                        value={quickCustDebt}
                        onChange={(e) => setQuickCustDebt(e.target.value.replace(/[^\d.]/g, ""))} />
                      <div className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">đ</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground pt-0 md:pt-6">
                    Khoản tiền khách đang nợ cửa hàng tính tới thời điểm tạo tài khoản.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setQuickCustOpen(false)}>Hủy bỏ</Button>
                <Button type="button" className="px-6" onClick={handleQuickCreateCustomer} disabled={savingCust}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {savingCust ? "Đang tạo..." : "Lưu thông tin"}
                </Button>
              </div>
            </div>
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
