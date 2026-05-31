// ─────────────────────────────────────────────────────────────────────────────
// SHARED INVOICE PRINTER — single source of truth for the print form
// Dùng chung cho: orders/index, orders/$id, schedule
// Thiết kế tối giản TRẮNG / ĐEN (monochrome) — chuyên nghiệp, gọn gàng.
// Mọi nội dung tiêu đề / chân trang / lưu ý bảo hành đều lấy từ "Mẫu in & Email"
// trong trang Admin (settings.print_templates.order_invoice).
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
  empName?: string;
  items?: any[];
  products?: any[];
  moneyFmt: (n: number) => string;
  ss?: any; // siteSettings
  tplOverride?: InvoiceTemplate;
  /** Tiêu đề loại phiếu hiển thị ở góc phải (badge). Mặc định: "Hóa đơn bán hàng" */
  docLabel?: string;
}

const esc = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function buildInvoiceHtml({
  order,
  custName,
  custPhone,
  custAddress,
  branchName,
  empName,
  items,
  products,
  moneyFmt,
  ss,
  tplOverride,
  docLabel,
}: BuildInvoiceArgs): string {
  const _site = ss?.site_name?.trim() || "Mr.Vũ";
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
  };
  const pmLabel = order.payment_method === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt";
  const dateStr = order.created_at
    ? new Date(order.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
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
      <td class="tc">${i + 1}</td>
      <td class="pl">${esc(prod?.name ?? item.product_id ?? "—")}</td>
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

  // Nhãn VAT: hiển thị % nếu có vat_rate, ngược lại chỉ ghi "Thuế VAT" (trường hợp nhập theo số tiền)
  const vatRatePct = Number(order.vat_rate ?? 0) > 0
    ? Math.round(Number(order.vat_rate) * 100 * 100) / 100
    : 0;
  const vatLabel = vatRatePct > 0 ? `Thuế VAT (${vatRatePct}%)` : "Thuế VAT";
  // Nhãn giảm giá: kèm % nếu giảm theo phần trăm
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
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Base (monochrome) ── */
body {
  font-family: 'Segoe UI', 'Arial Unicode MS', Tahoma, 'DejaVu Sans', Arial, sans-serif;
  font-size: 13.5px;
  color: #111;
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
  border-bottom: 2px solid #111;
}
.hdr-left { flex: 1; }
.logo { height: 56px; object-fit: contain; margin-bottom: 8px; display: block; filter: grayscale(100%); }
.shop-name {
  font-size: 19px; font-weight: 800; color: #111;
  letter-spacing: -0.3px; line-height: 1.2;
}
.shop-meta { font-size: 11.5px; color: #555; line-height: 1.75; margin-top: 5px; }
.hdr-right { text-align: right; flex-shrink: 0; }
.inv-badge {
  display: inline-block;
  border: 1px solid #111;
  color: #111;
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
.inv-meta { font-size: 12px; color: #555; line-height: 2; }
.inv-meta strong { color: #111; }

/* ── Info grid ── */
.info-wrap {
  background: #fafafa;
  border: 1px solid #ddd;
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
  color: #888;
  margin-bottom: 2px;
}
.info-cell .val {
  font-size: 13px;
  font-weight: 600;
  color: #111;
}
.info-full { grid-column: span 2; }

/* ── Divider ── */
.divider { border: none; border-top: 1px solid #ddd; margin: 18px 0; }

/* ── Table ── */
.items-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #ccc;
}
.items-table thead tr {
  background: #111;
  color: #fff;
}
.items-table th {
  padding: 11px 10px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.items-table tbody tr:nth-child(even) { background: #fafafa; }
.items-table td {
  padding: 10px;
  font-size: 13px;
  border-bottom: 1px solid #eee;
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
  border: 1px solid #ccc;
  border-radius: 8px;
  overflow: hidden;
}
.t-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 13px;
  border-bottom: 1px solid #eee;
  color: #333;
}
.t-row:last-child { border-bottom: none; }
.t-row.grand {
  background: #111;
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  padding: 11px 16px;
}

/* ── Note ── */
.note-box {
  background: #fafafa;
  border: 1px solid #ddd;
  border-left: 4px solid #111;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 22px;
  color: #333;
}

/* ── Checklist ── */
.check-box {
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 22px;
}
.check-title {
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 10px;
  color: #111;
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
  color: #333;
}
.checkbox {
  width: 14px; height: 14px;
  border: 1.5px solid #888;
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
  border-top: 1px dashed #ccc;
  font-size: 11.5px;
  color: #555;
}

/* ── Signatures ── */
.sign-section { margin-top: 12px; }
.sign-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  text-align: center;
}
.sign-card { padding: 8px; }
.sign-role {
  font-size: 12.5px;
  font-weight: 700;
  color: #111;
  margin-bottom: 3px;
}
.sign-hint {
  font-size: 10.5px;
  color: #888;
  margin-bottom: 44px;
}
.sign-line {
  border-top: 1.5px dashed #bbb;
  padding-top: 5px;
  font-size: 10.5px;
  color: #bbb;
  letter-spacing: 1px;
}

/* ── Warranty ── */
.warranty-box {
  margin-top: 20px;
  padding: 12px 16px;
  background: #f5f5f5;
  border: 1px solid #ccc;
  border-left: 4px solid #111;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  line-height: 1.8;
  color: #111;
}

/* ── Footer ── */
.footer-text {
  margin-top: 18px;
  text-align: center;
  font-size: 12.5px;
  color: #555;
  border-top: 1px solid #eee;
  padding-top: 14px;
  line-height: 1.6;
}

/* ── Print ── */
@media print {
  body { padding: 10px 14px; }
  .items-table thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .t-row.grand { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="hdr">
    <div class="hdr-left">
      ${ss?.logo_url ? `<img class="logo" src="${esc(ss.logo_url)}" alt="logo">` : ""}
      <div class="shop-name">${esc(_site)}</div>
      <div class="shop-meta">
        ${ss?.address ? `<span>${esc(ss.address)}</span><br>` : ""}
        ${ss?.phone ? `<span>ĐT: ${esc(ss.phone)}</span>` : ""}
        ${ss?.phone && ss?.email ? "&nbsp;&nbsp;|&nbsp;&nbsp;" : ""}
        ${ss?.email ? `<span>Email: ${esc(ss.email)}</span>` : ""}
        ${ss?.tax_code ? `<br><span>MST: ${esc(ss.tax_code)}</span>` : ""}
      </div>
    </div>
    <div class="hdr-right">
      <div class="inv-badge">${esc(docLabel ?? "Hóa đơn bán hàng")}</div>
      <div class="inv-title">${esc(_header)}</div>
      <div class="inv-meta">
        <strong>Mã phiếu</strong>&ensp;${esc(order.code ?? "—")}<br>
        <strong>Ngày lập</strong>&ensp;${dateStr}<br>
        <strong>Trạng thái</strong>&ensp;${esc(statusMap[order.status] ?? order.status ?? "—")}
      </div>
    </div>
  </div>

  <!-- INFO -->
  <div class="info-wrap">
    <div class="info-cell">
      <div class="lbl">Khách hàng</div>
      <div class="val">${esc(custName ?? "Khách lẻ")}${custPhone ? `&ensp;<span style="color:#555;font-weight:400">ĐT: ${esc(custPhone)}</span>` : ""}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Chi nhánh</div>
      <div class="val">${esc(branchName ?? "—")}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Nhân viên</div>
      <div class="val">${esc(empName ?? "—")}</div>
    </div>
    <div class="info-cell">
      <div class="lbl">Hình thức thanh toán</div>
      <div class="val">${pmLabel}</div>
    </div>
    ${custAddress ? `
    <div class="info-cell info-full">
      <div class="lbl">Địa chỉ lắp đặt</div>
      <div class="val">${esc(custAddress)}</div>
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
    <tbody>${rows || `<tr><td colspan="5" class="tc" style="color:#888;padding:16px">Chưa có sản phẩm</td></tr>`}</tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="t-row"><span>Tạm tính</span><span>${moneyFmt(subtotal)}</span></div>
      ${discount > 0 ? `<div class="t-row"><span>${esc(discountLabel)}</span><span>− ${moneyFmt(discount)}</span></div>` : ""}
      ${vatAmt > 0 ? `<div class="t-row"><span>${esc(vatLabel)}</span><span>+ ${moneyFmt(vatAmt)}</span></div>` : ""}
      <div class="t-row" style="font-weight:700;color:#111"><span>Tổng cộng</span><span>${moneyFmt(total)}</span></div>
      ${deposit > 0 ? `<div class="t-row"><span>Đã đặt cọc</span><span>− ${moneyFmt(deposit)}</span></div>` : ""}
      ${paid > 0 ? `<div class="t-row"><span>Đã thanh toán</span><span>− ${moneyFmt(paid)}</span></div>` : ""}
      <div class="t-row grand"><span>Khách cần trả</span><span>${moneyFmt(remaining)}</span></div>
    </div>
  </div>

  <!-- NOTE -->
  ${order.note ? `<div class="note-box"><strong>Ghi chú:</strong>&ensp;${esc(order.note)}</div>` : ""}

  <!-- CHECKLIST -->
  <div class="check-box">
    <div class="check-title">Xác nhận bàn giao</div>
    ${["Đã giao hàng đúng mẫu và đầy đủ phụ kiện",
       "Đã lắp đặt hoàn thiện, thiết bị hoạt động ổn định",
       "Đã hướng dẫn sử dụng và bảo quản sản phẩm",
       "Đã thanh toán đúng số tiền ghi trên phiếu"]
      .map((t) => `<div class="check-item"><span class="checkbox"></span><span>${t}</span></div>`)
      .join("")}
    <div class="customer-confirm">
      <strong>Xác nhận của khách hàng</strong>
      <span>Họ và tên: &emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&ensp; Chữ ký: &emsp;&emsp;&emsp;&emsp;&emsp;</span>
    </div>
  </div>

  <!-- SIGNATURES -->
  <div class="sign-section">
    <div class="sign-grid">
      ${["Kỹ thuật lắp đặt", "Nhân viên bán hàng", "Khách hàng", "Thủ kho"]
        .map((r) => `
        <div class="sign-card">
          <div class="sign-role">${r}</div>
          <div class="sign-hint">(Ký và ghi rõ họ tên)</div>
          <div class="sign-line">. . . . . . . . . .</div>
        </div>`)
        .join("")}
    </div>
  </div>

  <!-- WARRANTY -->
  ${_warranty ? `<div class="warranty-box">${esc(_warranty)}</div>` : ""}

  <!-- FOOTER -->
  ${_footer ? `<div class="footer-text">${esc(_footer)}</div>` : ""}

</div>
</body>
</html>`;
}
