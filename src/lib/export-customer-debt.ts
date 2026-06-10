// @ts-nocheck
/**
 * export-customer-debt.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Tạo & tải file Excel (.xlsx) báo cáo CÔNG NỢ khách hàng.
 *
 * Chạy hoàn toàn ở client (gọi khi bấm nút), `exceljs` được import động nên
 * KHÔNG làm phình bundle chính và không ảnh hưởng SSR.
 *
 * Mỗi dòng khách dùng đúng các cột do RPC `search_customers_page` trả về:
 *   total_buy, total_paid, total_paid_back, debt_adjustment, display_debt
 * → công thức công nợ y hệt bảng đang hiển thị, không tính lại sai lệch.
 */

const GROUP_LABEL: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};

const TYPE_LABEL: Record<string, string> = {
  ca_nhan: "Cá nhân",
  to_chuc: "Tổ chức",
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

/** yyyy-MM-dd — cho tên file */
function fmtDateForName(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function joinAddress(c: any): string {
  return (
    [c.address, c.ward, c.district, c.province].filter(Boolean).join(", ") || ""
  );
}

export interface ExportCustomerDebtOptions {
  /** Danh sách khách (đã lấy hết theo bộ lọc hiện tại) */
  customers: any[];
  /** Mô tả bộ lọc đang áp dụng, hiển thị ở dòng phụ đề (không bắt buộc) */
  filterText?: string;
}

/**
 * Build workbook + tải về. Trả về số dòng đã xuất để caller hiện toast.
 */
export async function exportCustomerDebtToExcel(
  opts: ExportCustomerDebtOptions,
): Promise<number> {
  const customers = opts.customers ?? [];

  // Import động — chỉ nạp exceljs khi thực sự cần xuất file.
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;

  const now = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mr.Vũ";
  wb.created = now;

  const ws = wb.addWorksheet("Công nợ khách hàng", {
    views: [{ state: "frozen", ySplit: 4 }], // ghim 3 dòng tiêu đề + 1 dòng header
  });

  const cols = [
    { key: "stt", header: "STT", width: 6 },
    { key: "name", header: "Tên khách hàng", width: 28 },
    { key: "phone", header: "SĐT", width: 14 },
    { key: "group", header: "Nhóm", width: 12 },
    { key: "type", header: "Loại", width: 10 },
    { key: "company", header: "Công ty", width: 22 },
    { key: "address", header: "Địa chỉ", width: 36 },
    { key: "total_buy", header: "Tổng mua", width: 16 },
    { key: "total_paid", header: "Đã thu", width: 16 },
    { key: "total_paid_back", header: "Chi trả lại", width: 16 },
    { key: "debt_adjustment", header: "Điều chỉnh", width: 14 },
    { key: "debt", header: "Công nợ", width: 18 },
  ];
  ws.columns = cols;

  const lastCol = ws.getColumn(cols.length).letter;

  // ── Dòng 1: tiêu đề ──────────────────────────────────────────────────────
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = "BÁO CÁO CÔNG NỢ KHÁCH HÀNG";
  titleCell.font = { bold: true, size: 16, color: { argb: "FF1F2937" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  // ── Dòng 2: phụ đề (ngày xuất + bộ lọc) ───────────────────────────────────
  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell("A2");
  const filterPart = opts.filterText ? ` · Bộ lọc: ${opts.filterText}` : "";
  subCell.value = `Xuất ngày ${fmtDateTime(now)} · ${customers.length} khách${filterPart}`;
  subCell.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  subCell.alignment = { horizontal: "center" };

  // ── Dòng 3: khoảng trắng ──────────────────────────────────────────────────
  ws.getRow(3).height = 4;

  // ── Dòng 4: header ────────────────────────────────────────────────────────
  const headerRow = ws.getRow(4);
  cols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  headerRow.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFDBFE" } } };
  });
  headerRow.height = 20;

  // Định dạng tiền VND (số âm hiển thị màu đỏ trong Excel)
  const MONEY = '#,##0" ₫";[Red]-#,##0" ₫"';
  const moneyKeys = [
    "total_buy",
    "total_paid",
    "total_paid_back",
    "debt_adjustment",
    "debt",
  ];
  const idxOf = (key: string) => cols.findIndex((c) => c.key === key) + 1;
  const debtIdx = idxOf("debt");

  let totBuy = 0,
    totPaid = 0,
    totBack = 0,
    totAdj = 0,
    totDebt = 0;

  customers.forEach((c, i) => {
    const totalBuy = Number(c.total_buy ?? 0);
    const totalPaid = Number(c.total_paid ?? 0);
    const totalBack = Number(c.total_paid_back ?? 0);
    const adj = Number(c.debt_adjustment ?? 0);
    const debt = Number(c.display_debt ?? 0);

    const row = ws.addRow({
      stt: i + 1,
      name: c.name ?? "",
      phone: c.phone ?? "",
      group: GROUP_LABEL[c.group_name] ?? c.group_name ?? "",
      type: TYPE_LABEL[c.customer_type] ?? c.customer_type ?? "",
      company: c.company_name ?? "",
      address: joinAddress(c),
      total_buy: totalBuy,
      total_paid: totalPaid,
      total_paid_back: totalBack,
      debt_adjustment: adj,
      debt: debt,
    });

    moneyKeys.forEach((k) => {
      row.getCell(idxOf(k)).numFmt = MONEY;
    });

    // Tô màu ô công nợ: dương = đỏ (khách còn nợ), âm = xanh (mình nợ khách)
    const debtCell = row.getCell(debtIdx);
    if (debt > 0) debtCell.font = { color: { argb: "FFDC2626" }, bold: true };
    else if (debt < 0)
      debtCell.font = { color: { argb: "FF2563EB" }, bold: true };

    row.getCell(idxOf("total_buy")).font = { color: { argb: "FF059669" } };

    totBuy += totalBuy;
    totPaid += totalPaid;
    totBack += totalBack;
    totAdj += adj;
    totDebt += debt;
  });

  // ── Dòng tổng cộng ────────────────────────────────────────────────────────
  const totalRow = ws.addRow({
    stt: "",
    name: "TỔNG CỘNG",
    phone: "",
    group: "",
    type: "",
    company: "",
    address: "",
    total_buy: totBuy,
    total_paid: totPaid,
    total_paid_back: totBack,
    debt_adjustment: totAdj,
    debt: totDebt,
  });
  totalRow.eachCell((cell: any) => {
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };
    cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  moneyKeys.forEach((k) => {
    totalRow.getCell(idxOf(k)).numFmt = MONEY;
  });
  if (totDebt > 0)
    totalRow.getCell(debtIdx).font = {
      bold: true,
      color: { argb: "FFDC2626" },
    };

  // Bộ lọc tự động trên hàng header để dễ tra cứu trong Excel
  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: cols.length },
  };

  // ── Xuất buffer & tải về ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cong-no-khach-hang-${fmtDateForName(now)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return customers.length;
}
