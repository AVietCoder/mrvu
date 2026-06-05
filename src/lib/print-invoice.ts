// ─────────────────────────────────────────────────────────────────────────────
// SHARED INVOICE PRINTER — single source of truth for the print form
// Dùng chung cho: orders/index, orders/$id, schedule
// Thiết kế gọn gàng, CHUYÊN NGHIỆP và CÓ MÀU — màu chủ đạo lấy từ
// site_settings.primary_color (chỉnh trong trang Admin). Mọi nội dung
// tiêu đề / chân trang / lưu ý bảo hành lấy từ "Mẫu in & Email"
// (settings.print_templates.order_invoice).
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceTemplate {
  header?: string;
  footer?: string;
  warranty?: string;
  showWarranty?: boolean;
}

export interface BuildInvoiceArgs {
  order: any;
  custName?: string;
  custPhone?: string;
  custAddress?: string;
  branchName?: string;
  /** Địa chỉ chi nhánh — nếu truyền vào sẽ ưu tiên hiển thị thay cho địa chỉ trong cài đặt admin */
  branchAddress?: string;
  /** Số điện thoại chi nhánh — nếu truyền vào sẽ ưu tiên hiển thị thay cho SĐT trong cài đặt admin */
  branchPhone?: string;
  empName?: string;
  items?: any[];
  products?: any[];
  moneyFmt: (n: number) => string;
  ss?: any; // siteSettings
  tplOverride?: InvoiceTemplate;
  /** Nhãn loại phiếu (kicker nhỏ phía trên tiêu đề). Mặc định: "Hóa đơn bán hàng" */
  docLabel?: string;
}

const esc = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// ── Màu chủ đạo: chỉ chấp nhận mã hex hợp lệ, ngược lại dùng mặc định. ──
function sanitizeHex(c: any): string {
  const v = String(c ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : "#2563eb";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Tạo bảng màu phái sinh từ 1 màu chủ đạo (đậm/nhạt/viền/chữ tương phản).
function buildPalette(primary: string) {
  const { r, g, b } = hexToRgb(primary);
  const dark = `rgb(${Math.round(r * 0.78)}, ${Math.round(g * 0.78)}, ${Math.round(b * 0.78)})`;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const onBrand = lum > 0.62 ? "#1a1a1a" : "#ffffff";
  return {
    brand: primary,
    brandDark: dark,
    onBrand,
    tint: `rgba(${r}, ${g}, ${b}, 0.07)`,
    tintStrong: `rgba(${r}, ${g}, ${b}, 0.13)`,
    border: `rgba(${r}, ${g}, ${b}, 0.28)`,
  };
}

export function buildInvoiceHtml({
  order,
  custName,
  custPhone,
  custAddress,
  branchName,
  branchAddress,
  branchPhone,
  empName,
  items,
  products,
  moneyFmt,
  ss,
  tplOverride,
  docLabel,
}: BuildInvoiceArgs): string {
  const _site = ss?.site_name?.trim() || "Mr.Vũ";
  const P = buildPalette(sanitizeHex(ss?.primary_color));

  const _tpl: InvoiceTemplate =
    tplOverride ??
    (() => {
      try {
        return JSON.parse(ss?.print_templates || "{}").order_invoice ?? {};
      } catch {
        return {};
      }
    })();

  const _header = (_tpl.header ?? "PHIẾU XUẤT KHO / KIỂM BẢO HÀNH").replace("{Ten_Cua_Hang}", _site);
  const _footer = (_tpl.footer ?? `${_site} — Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ!`).replace("{Ten_Cua_Hang}", _site);
  const _showW = _tpl.showWarranty !== false;
  const _warranty = _showW
    ? (_tpl.warranty ?? `LƯU Ý: ${_site} KHUYẾN CÁO KIỂM TRA THIẾT BỊ ĐỊNH KỲ ÍT NHẤT 6 THÁNG/LẦN ĐỂ ĐẢM BẢO AN TOÀN.`).replace("{Ten_Cua_Hang}", _site)
    : "";

  const statusMap: Record<string, string> = {
    completed: "Hoàn tất",
    reserved: "Đặt hàng",
    draft: "Nháp",
    cancelled: "Đã hủy",
    returned: "Đã trả hàng",
    partially_returned: "Trả hàng 1 phần",
  };
  const pmLabel = order.payment_method === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt";

  // Ngày in trên phiếu: đơn hoàn tất ưu tiên ngày hoàn tất, còn lại ngày tạo.
  const _dateSource =
    order.status === "completed" && order.completed_at ? order.completed_at : order.created_at;
  const dateStr = _dateSource
    ? new Date(_dateSource).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const rows = (items ?? [])
    .map((item: any, i: number) => {
      const prod = (products ?? []).find((p: any) => p.id === item.product_id);
      const qty = Number(item.qty ?? 0);
      const price = Number(item.unit_price ?? 0);
      const disc = Number(item.discount ?? 0);
      const lineTotal = qty * price - disc;
      return `
    <tr>
      <td class="tc muted">${i + 1}</td>
      <td class="pl name">${esc(prod?.name ?? item.product_id ?? "—")}</td>
      <td class="tc">${qty}</td>
      <td class="tr">${moneyFmt(price)}</td>
      <td class="tr fw">${moneyFmt(lineTotal)}</td>
    </tr>`;
    })
    .join("");

  const subtotal = Number(order.subtotal ?? 0);
  const discount = Number(order.discount ?? 0);
  const vatAmt = Number(order.vat_amount ?? 0);
  const total = Number(order.total ?? 0);
  const deposit = Number(order.deposit ?? 0);
  const paid = Number(order.paid ?? 0);
  const remaining = Math.max(0, total - deposit - paid);

  const vatRatePct = Number(order.vat_rate ?? 0) > 0
    ? Math.round(Number(order.vat_rate) * 100 * 100) / 100
    : 0;
  const vatLabel = vatRatePct > 0 ? `Thuế VAT (${vatRatePct}%)` : "Thuế VAT";
  const discountLabel = order.discount_type === "percent" && Number(order.discount_pct ?? 0) > 0
    ? `Giảm giá (${Number(order.discount_pct)}%)`
    : "Giảm giá";

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(_header)} — ${esc(order.code ?? "")}</title>
<style>
:root{
  --brand:${P.brand};
  --brand-dark:${P.brandDark};
  --on-brand:${P.onBrand};
  --tint:${P.tint};
  --tint-2:${P.tintStrong};
  --bd:${P.border};
  --ink:#1f2430;
  --ink-soft:#6b7280;
  --line:#e7e9ee;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{
  font-family:'Segoe UI','Arial Unicode MS',Tahoma,'DejaVu Sans',Arial,sans-serif;
  font-size:13.5px;color:var(--ink);background:#fff;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  padding:34px 38px;
}
.page{max-width:780px;margin:0 auto;position:relative;}
.page::before{content:"";position:absolute;top:-34px;left:-38px;right:-38px;height:6px;
  background:linear-gradient(90deg,var(--brand),var(--brand-dark));}

/* ── Header ── */
.hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;
  padding:6px 0 18px;margin-bottom:20px;border-bottom:2px solid var(--brand);}
.hdr-left{flex:1;display:flex;gap:14px;align-items:flex-start;}
.logo{height:54px;width:54px;object-fit:contain;border-radius:8px;}
.shop-name{font-size:20px;font-weight:800;color:var(--brand-dark);letter-spacing:-.3px;line-height:1.15;}
.shop-meta{font-size:11.5px;color:var(--ink-soft);line-height:1.7;margin-top:5px;}
.hdr-right{text-align:right;flex-shrink:0;}
.kicker{display:inline-block;background:var(--brand);color:var(--on-brand);
  font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;
  padding:4px 11px;border-radius:999px;margin-bottom:8px;}
.inv-title{font-size:15px;font-weight:800;color:var(--ink);text-transform:uppercase;
  letter-spacing:.4px;line-height:1.3;margin-bottom:8px;}
.inv-meta{font-size:12px;color:var(--ink-soft);line-height:1.9;}
.inv-meta b{color:var(--ink);font-weight:600;}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;font-weight:700;font-size:11px;
  background:var(--tint-2);color:var(--brand-dark);}

/* ── Info ── */
.info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);
  border-radius:10px;overflow:hidden;margin-bottom:20px;}
.info .cell{padding:11px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);}
.info .cell:nth-child(2n){border-right:none;}
.info .full{grid-column:span 2;border-right:none;}
.info .lbl{font-size:9.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--brand-dark);margin-bottom:3px;}
.info .val{font-size:13px;font-weight:600;color:var(--ink);}
.info .val small{color:var(--ink-soft);font-weight:400;}

/* ── Items table ── */
.items{width:100%;border-collapse:collapse;margin-bottom:18px;border:1px solid var(--bd);
  border-radius:10px;overflow:hidden;}
.items thead tr{background:var(--brand);color:var(--on-brand);}
.items th{padding:11px 10px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;}
.items tbody td{padding:10px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle;}
.items tbody tr:last-child td{border-bottom:none;}
.items tbody tr:nth-child(even){background:var(--tint);}
.items .name{font-weight:600;}
.tc{text-align:center;}.tr{text-align:right;}.pl{padding-left:14px;}
.fw{font-weight:700;color:var(--brand-dark);}.muted{color:var(--ink-soft);}

/* ── Totals ── */
.totals{display:flex;justify-content:flex-end;margin-bottom:20px;}
.tbox{min-width:300px;border:1px solid var(--bd);border-radius:10px;overflow:hidden;}
.trow{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;
  font-size:13px;border-bottom:1px solid var(--line);color:var(--ink);}
.trow.sub{background:var(--tint);font-weight:700;}
.trow.grand{background:var(--brand);color:var(--on-brand);font-size:15px;font-weight:800;padding:12px 16px;border-bottom:none;}
.neg{color:#b42318;}

/* ── Note ── */
.note{background:var(--tint);border:1px solid var(--bd);border-left:4px solid var(--brand);
  border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:18px;color:var(--ink);}
.note b{color:var(--brand-dark);}

/* ── Warranty ── */
.warranty{margin-bottom:18px;padding:11px 15px;background:var(--tint-2);border:1px solid var(--bd);
  border-left:4px solid var(--brand);border-radius:8px;font-size:11.5px;font-weight:700;
  text-transform:uppercase;line-height:1.7;color:var(--brand-dark);}

/* ── Signatures ── */
.signs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;text-align:center;margin-top:6px;}
.sign .role{font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:2px;}
.sign .hint{font-size:10px;color:var(--ink-soft);margin-bottom:46px;}
.sign .line{border-top:1.5px dashed var(--bd);padding-top:5px;font-size:10px;color:var(--ink-soft);letter-spacing:1px;}

/* ── Footer ── */
.footer{margin-top:18px;text-align:center;font-size:12px;color:var(--ink-soft);
  border-top:1px solid var(--line);padding-top:13px;line-height:1.6;}
.footer .heart{color:var(--brand);}

@media print{
  body{padding:8px 12px;}
  .page::before,.kicker,.items thead tr,.trow.grand,.trow.sub,.note,.warranty,.info .lbl,.chip{
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
</style>
</head>
<body>
<div class="page">

  <div class="hdr">
    <div class="hdr-left">
      ${ss?.logo_url ? `<img class="logo" src="${esc(ss.logo_url)}" alt="logo">` : ""}
      <div>
        <div class="shop-name">${esc(_site)}</div>
        <div class="shop-meta">
          ${ss?.address ? `${esc(branchAddress || ss.address)}<br>` : (branchAddress ? `${esc(branchAddress)}<br>` : "")}
          ${(branchPhone || ss?.phone) ? `ĐT: ${esc(branchPhone || ss.phone)}` : ""}${(branchPhone || ss?.phone) && ss?.email ? "&nbsp;·&nbsp;" : ""}${ss?.email ? `Email: ${esc(ss.email)}` : ""}
          ${ss?.tax_code ? `<br>MST: ${esc(ss.tax_code)}` : ""}
        </div>
      </div>
    </div>
    <div class="hdr-right">
      <div class="kicker">${esc(docLabel ?? "Hóa đơn bán hàng")}</div>
      <div class="inv-title">${esc(_header)}</div>
      <div class="inv-meta">
        <b>Mã phiếu</b> ${esc(order.code ?? "—")}<br>
        <b>Ngày lập</b> ${dateStr}<br>
        <b>Trạng thái</b> <span class="chip">${esc(statusMap[order.status] ?? order.status ?? "—")}</span>
      </div>
    </div>
  </div>

  <div class="info">
    <div class="cell">
      <div class="lbl">Khách hàng</div>
      <div class="val">${esc(custName ?? "Khách lẻ")}${custPhone ? ` <small>· ${esc(custPhone)}</small>` : ""}</div>
    </div>
    <div class="cell">
      <div class="lbl">Chi nhánh</div>
      <div class="val">${esc(branchName ?? "—")}</div>
    </div>
    <div class="cell">
      <div class="lbl">Nhân viên</div>
      <div class="val">${esc(empName ?? "—")}</div>
    </div>
    <div class="cell">
      <div class="lbl">Thanh toán</div>
      <div class="val">${pmLabel}</div>
    </div>
    ${custAddress ? `
    <div class="cell full">
      <div class="lbl">Địa chỉ lắp đặt</div>
      <div class="val">${esc(custAddress)}</div>
    </div>` : ""}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="tc" style="width:42px">#</th>
        <th style="text-align:left;padding-left:14px">Tên sản phẩm</th>
        <th class="tc" style="width:54px">SL</th>
        <th class="tr" style="width:128px">Đơn giá</th>
        <th class="tr" style="width:138px">Thành tiền</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="5" class="tc muted" style="padding:16px">Chưa có sản phẩm</td></tr>`}</tbody>
  </table>

  <div class="totals">
    <div class="tbox">
      <div class="trow"><span>Tạm tính</span><span>${moneyFmt(subtotal)}</span></div>
      ${discount > 0 ? `<div class="trow"><span>${esc(discountLabel)}</span><span class="neg">− ${moneyFmt(discount)}</span></div>` : ""}
      ${vatAmt > 0 ? `<div class="trow"><span>${esc(vatLabel)}</span><span>+ ${moneyFmt(vatAmt)}</span></div>` : ""}
      <div class="trow sub"><span>Tổng cộng</span><span>${moneyFmt(total)}</span></div>
      ${deposit > 0 ? `<div class="trow"><span>Đã đặt cọc</span><span class="neg">− ${moneyFmt(deposit)}</span></div>` : ""}
      ${paid > 0 ? `<div class="trow"><span>Đã thanh toán</span><span class="neg">− ${moneyFmt(paid)}</span></div>` : ""}
      <div class="trow grand"><span>Khách cần trả</span><span>${moneyFmt(remaining)}</span></div>
    </div>
  </div>

  ${order.note ? `<div class="note"><b>Ghi chú:</b> ${esc(order.note)}</div>` : ""}

  ${_warranty ? `<div class="warranty">${esc(_warranty)}</div>` : ""}

  <div class="signs">
    ${["Nhân viên bán hàng", "Kỹ thuật lắp đặt", "Khách hàng"]
      .map((r) => `
      <div class="sign">
        <div class="role">${r}</div>
        <div class="hint">(Ký, ghi rõ họ tên)</div>
        <div class="line">. . . . . . . . . .</div>
      </div>`)
      .join("")}
  </div>

  ${_footer ? `<div class="footer">${esc(_footer)}</div>` : ""}

</div>
</body>
</html>`;
}
