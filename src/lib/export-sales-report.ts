// @ts-nocheck
/**
 * export-sales-report.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Tạo & tải file Excel (.xlsx) BÁO CÁO BÁN HÀNG theo bộ lọc đang xem ở trang
 * "Bán hàng" (khoảng ngày + 1 khách hàng / 1 nhân viên / chi nhánh / trạng thái).
 *
 * Khác với "công nợ tổng" (export-customer-debt.ts) — báo cáo này trả lời:
 *   • Tổng đã bán bao nhiêu đơn / bao nhiêu tiền trong khoảng thời gian.
 *   • Đã thu được bao nhiêu (đặt cọc + thanh toán) — còn lại (công nợ) bao nhiêu.
 *   • Đã bán những SẢN PHẨM nào (số lượng + doanh thu từng sản phẩm).
 *
 * Chạy hoàn toàn ở client (gọi khi bấm nút). `exceljs` được import động nên
 * KHÔNG làm phình bundle chính và không ảnh hưởng SSR. File này là MỚI HOÀN TOÀN,
 * không sửa bất kỳ tính năng/đường dẫn nào đang có.
 */

const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất",
  reserved: "Đặt hàng",
  draft: "Nháp",
  cancelled: "Hủy",
  returned: "Đã trả hàng",
  partially_returned: "Trả hàng 1 phần",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** dd/MM/yyyy HH:mm — cho phụ đề trong file */
function fmtDateTime(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** dd/MM/yyyy HH:mm cho 1 mốc thời gian bất kỳ (ngày bán của đơn) */
function fmtCellDateTime(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return fmtDateTime(d);
}

/** yyyy-MM-dd — cho tên file */
function fmtDateForName(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export interface SalesOrderRow {
  code: string;
  status: string;
  date: string; // completed_at hoặc created_at
  customer_name: string;
  employee_name: string;
  branch_name: string;
  total: number;
  deposit: number;
  paid: number;
  collected: number; // deposit + paid
  remaining: number; // còn lại (công nợ đơn) = max(0, total - collected)
}

export interface SalesProductRow {
  sku: string;
  name: string;
  qty: number;
  revenue: number;
}

export interface ExportSalesReportOptions {
  orders: SalesOrderRow[];
  products: SalesProductRow[];
  summary: {
    orderCount: number;
    totalAmount: number;
    totalCollected: number;
    totalRemaining: number;
  };
  /** Tiêu đề báo cáo (mặc định "BÁO CÁO BÁN HÀNG") */
  reportTitle?: string;
  /** Mô tả bộ lọc đang áp dụng, hiển thị ở dòng phụ đề (không bắt buộc) */
  filterText?: string;
}

// Định dạng tiền VND (số âm hiển thị màu đỏ trong Excel)
const MONEY = '#,##0" ₫";[Red]-#,##0" ₫"';

/**
 * Build workbook (2 sheet: "Đơn đã bán" + "Sản phẩm đã bán") rồi tải về.
 * Trả về số ĐƠN đã xuất để caller hiện toast.
 */
export async function exportSalesReportToExcel(
  opts: ExportSalesReportOptions,
): Promise<number> {
  const orders = opts.orders ?? [];
  const products = opts.products ?? [];
  const summary = opts.summary ?? {
    orderCount: orders.length,
    totalAmount: 0,
    totalCollected: 0,
    totalRemaining: 0,
  };
  const reportTitle = opts.reportTitle || "BÁO CÁO BÁN HÀNG";

  // Import động — chỉ nạp exceljs khi thực sự cần xuất file.
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;

  const now = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mr.Vũ";
  wb.created = now;

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 1 — "Đơn đã bán"
  // ══════════════════════════════════════════════════════════════════════════
  const ws = wb.addWorksheet("Đơn đã bán", {
    views: [{ state: "frozen", ySplit: 9 }], // ghim phần tiêu đề + tổng quan + header
  });

  const cols = [
    { key: "stt", header: "STT", width: 6 },
    { key: "code", header: "Mã đơn", width: 14 },
    { key: "date", header: "Ngày bán", width: 18 },
    { key: "customer", header: "Khách hàng", width: 30 },
    { key: "employee", header: "Nhân viên", width: 20 },
    { key: "branch", header: "Chi nhánh", width: 18 },
    { key: "status", header: "Trạng thái", width: 14 },
    { key: "total", header: "Tổng tiền", width: 16 },
    { key: "collected", header: "Đã thu", width: 16 },
    { key: "remaining", header: "Còn lại", width: 16 },
  ];
  ws.columns = cols;
  const lastCol = ws.getColumn(cols.length).letter; // "J"

  // ── Dòng 1: tiêu đề ──────────────────────────────────────────────────────
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = reportTitle;
  titleCell.font = { bold: true, size: 16, color: { argb: "FF1F2937" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  // ── Dòng 2: phụ đề (ngày xuất + bộ lọc) ───────────────────────────────────
  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell("A2");
  const filterPart = opts.filterText ? ` · Bộ lọc: ${opts.filterText}` : "";
  subCell.value = `Xuất ngày ${fmtDateTime(now)} · ${orders.length} đơn${filterPart}`;
  subCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  subCell.alignment = { horizontal: "center" };

  // ── Dòng 3: khoảng trắng ──────────────────────────────────────────────────
  ws.getRow(3).height = 4;

  // ── Dòng 4–7: KHỐI TỔNG QUAN (label trái, số phải) ────────────────────────
  const summaryRows: Array<{ label: string; value: number; money: boolean; color?: string }> = [
    { label: "Tổng số đơn đã bán", value: summary.orderCount, money: false },
    { label: "Tổng tiền hàng", value: summary.totalAmount, money: true, color: "FF059669" },
    { label: "Đã thu (đặt cọc + thanh toán)", value: summary.totalCollected, money: true, color: "FF2563EB" },
    { label: "Còn lại (công nợ)", value: summary.totalRemaining, money: true, color: "FFDC2626" },
  ];
  summaryRows.forEach((s, i) => {
    const r = 4 + i;
    ws.mergeCells(`A${r}:C${r}`);
    ws.mergeCells(`D${r}:E${r}`);
    const labelCell = ws.getCell(`A${r}`);
    labelCell.value = s.label;
    labelCell.font = { bold: true, size: 11, color: { argb: "FF374151" } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };

    const valCell = ws.getCell(`D${r}`);
    valCell.value = s.value;
    valCell.numFmt = s.money ? MONEY : "#,##0";
    valCell.font = { bold: true, size: 12, color: { argb: s.color ?? "FF111827" } };
    valCell.alignment = { horizontal: "right", vertical: "middle" };
    valCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    ws.getRow(r).height = 18;
  });

  // ── Dòng 8: khoảng trắng ──────────────────────────────────────────────────
  ws.getRow(8).height = 6;

  // ── Dòng 9: header bảng đơn ───────────────────────────────────────────────
  const headerRow = ws.getRow(9);
  cols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  headerRow.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFDBFE" } } };
  });
  headerRow.height = 20;

  const idxOf = (key: string) => cols.findIndex((c) => c.key === key) + 1;
  const moneyKeys = ["total", "collected", "remaining"];

  orders.forEach((o, i) => {
    const row = ws.addRow({
      stt: i + 1,
      code: o.code ?? "",
      date: fmtCellDateTime(o.date),
      customer: o.customer_name ?? "",
      employee: o.employee_name ?? "",
      branch: o.branch_name ?? "",
      status: STATUS_LABEL[o.status] ?? o.status ?? "",
      total: Number(o.total ?? 0),
      collected: Number(o.collected ?? 0),
      remaining: Number(o.remaining ?? 0),
    });

    moneyKeys.forEach((k) => {
      row.getCell(idxOf(k)).numFmt = MONEY;
    });

    // Tô màu: tổng tiền xanh lá, đã thu xanh dương, còn lại đỏ (nếu > 0).
    row.getCell(idxOf("total")).font = { color: { argb: "FF059669" } };
    row.getCell(idxOf("collected")).font = { color: { argb: "FF2563EB" } };
    const remCell = row.getCell(idxOf("remaining"));
    if (Number(o.remaining ?? 0) > 0)
      remCell.font = { color: { argb: "FFDC2626" }, bold: true };

    row.getCell(idxOf("code")).font = { bold: true };
  });

  // ── Dòng tổng cộng ────────────────────────────────────────────────────────
  const totalRow = ws.addRow({
    stt: "",
    code: "TỔNG CỘNG",
    date: "",
    customer: "",
    employee: "",
    branch: "",
    status: "",
    total: summary.totalAmount,
    collected: summary.totalCollected,
    remaining: summary.totalRemaining,
  });
  totalRow.eachCell((cell: any) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  moneyKeys.forEach((k) => {
    totalRow.getCell(idxOf(k)).numFmt = MONEY;
  });
  if (summary.totalRemaining > 0)
    totalRow.getCell(idxOf("remaining")).font = { bold: true, color: { argb: "FFDC2626" } };

  // Bộ lọc tự động trên hàng header (row 9) để dễ tra cứu trong Excel.
  ws.autoFilter = {
    from: { row: 9, column: 1 },
    to: { row: 9, column: cols.length },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 2 — "Sản phẩm đã bán"
  // ══════════════════════════════════════════════════════════════════════════
  const wsP = wb.addWorksheet("Sản phẩm đã bán", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  const pcols = [
    { key: "stt", header: "STT", width: 6 },
    { key: "sku", header: "Mã SP", width: 18 },
    { key: "name", header: "Tên sản phẩm", width: 42 },
    { key: "qty", header: "SL bán", width: 12 },
    { key: "revenue", header: "Doanh thu", width: 18 },
  ];
  wsP.columns = pcols;
  const pLastCol = wsP.getColumn(pcols.length).letter; // "E"

  wsP.mergeCells(`A1:${pLastCol}1`);
  const pTitle = wsP.getCell("A1");
  pTitle.value = "SẢN PHẨM ĐÃ BÁN";
  pTitle.font = { bold: true, size: 16, color: { argb: "FF1F2937" } };
  pTitle.alignment = { horizontal: "center", vertical: "middle" };
  wsP.getRow(1).height = 26;

  wsP.mergeCells(`A2:${pLastCol}2`);
  const pSub = wsP.getCell("A2");
  const totalQty = products.reduce((s, p) => s + Number(p.qty ?? 0), 0);
  pSub.value = `${products.length} sản phẩm · Tổng SL bán: ${new Intl.NumberFormat("vi-VN").format(totalQty)}${filterPart}`;
  pSub.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  pSub.alignment = { horizontal: "center" };

  wsP.getRow(3).height = 4;

  const pHeader = wsP.getRow(4);
  pcols.forEach((c, i) => {
    pHeader.getCell(i + 1).value = c.header;
  });
  pHeader.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFA7F3D0" } } };
  });
  pHeader.height = 20;

  const pIdxOf = (key: string) => pcols.findIndex((c) => c.key === key) + 1;
  let totRevenue = 0;
  products.forEach((p, i) => {
    const row = wsP.addRow({
      stt: i + 1,
      sku: p.sku ?? "",
      name: p.name ?? "",
      qty: Number(p.qty ?? 0),
      revenue: Number(p.revenue ?? 0),
    });
    row.getCell(pIdxOf("qty")).numFmt = "#,##0";
    row.getCell(pIdxOf("qty")).alignment = { horizontal: "center" };
    row.getCell(pIdxOf("revenue")).numFmt = MONEY;
    row.getCell(pIdxOf("revenue")).font = { color: { argb: "FF059669" } };
    totRevenue += Number(p.revenue ?? 0);
  });

  const pTotalRow = wsP.addRow({
    stt: "",
    sku: "",
    name: "TỔNG CỘNG",
    qty: totalQty,
    revenue: totRevenue,
  });
  pTotalRow.eachCell((cell: any) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  pTotalRow.getCell(pIdxOf("qty")).numFmt = "#,##0";
  pTotalRow.getCell(pIdxOf("qty")).alignment = { horizontal: "center" };
  pTotalRow.getCell(pIdxOf("revenue")).numFmt = MONEY;

  wsP.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: pcols.length },
  };

  // ── Xuất buffer & tải về ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bao-cao-ban-hang-${fmtDateForName(now)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return orders.length;
}
