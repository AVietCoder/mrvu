/**
 * Xuất Excel lịch trực / bảng lương và in phiếu lương.
 * Bố cục bám theo 2 file Excel đang dùng để kế toán không phải làm quen lại.
 * exceljs import động — chỉ tải khi thực sự xuất file (giống export-customer-debt).
 */

const WEEKDAY = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const money = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));

async function download(wb: any, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function newWorkbook() {
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mr.Vũ";
  wb.created = new Date();
  return wb;
}

const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

// ─── Lịch trực ─────────────────────────────────────────────────────────────
export async function exportRosterExcel(opts: {
  month: string;
  /** Tên sheet / tên file tuỳ chọn (vd xuất theo tuần). */
  sheetName?: string;
  fileName?: string;
  dates: string[];
  rows: { branch: string; shift: string; cells: Record<string, string> }[];
  offCells: Record<string, string>;
}) {
  const wb = await newWorkbook();
  const [y, m] = opts.month.split("-");
  const ws = wb.addWorksheet(opts.sheetName || `Tháng ${Number(m)}`, { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });

  ws.addRow([
    "SHOWROOM",
    "CA TRỰC",
    ...opts.dates.map((d) => `${WEEKDAY[dow(d)]}\n${Number(d.slice(8))}/${Number(d.slice(5, 7))}`),
  ]);
  for (const r of opts.rows) ws.addRow([r.branch, r.shift, ...opts.dates.map((d) => r.cells[d] ?? "")]);
  ws.addRow([]);
  ws.addRow(["OFF / LỄ", "", ...opts.dates.map((d) => opts.offCells[d] ?? "")]);

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 14;
  for (let i = 3; i <= opts.dates.length + 2; i++) ws.getColumn(i).width = 11;

  ws.eachRow((row: any, rowNumber: number) => {
    row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      cell.border = border;
      cell.alignment = { wrapText: true, vertical: "middle", horizontal: col <= 2 ? "left" : "center" };
      if (rowNumber === 1) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      }
      // Tô Chủ nhật như file cũ để nhìn nhanh tuần.
      if (col > 2 && dow(opts.dates[col - 3] ?? "") === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      }
    });
  });
  ws.getRow(1).height = 32;

  await download(wb, opts.fileName || `lich-truc-${y}-${m}.xlsx`);
}

// ─── Bảng lương ────────────────────────────────────────────────────────────
export async function exportPayrollExcel(opts: { month: string; rows: any[] }) {
  const wb = await newWorkbook();
  const [y, m] = opts.month.split("-");
  const ws = wb.addWorksheet("TỔNG LƯƠNG", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });

  ws.addRow([`BẢNG LƯƠNG THÁNG ${m}/${y}`]);
  ws.mergeCells(1, 1, 1, 21);
  ws.getRow(1).font = { bold: true, size: 14 };

  const header = [
    "STT", "Tên NV", "Chức vụ", "Lương cơ bản", "Công chuẩn", "Công thực tế", "Lương thực nhận",
    "Lương doanh số", "Hoa hồng", "Tăng ca", "Xăng xe đi tỉnh", "Thưởng", "Phụ cấp thêm",
    "Tổng thu nhập", "Tạm ứng", "BHXH", "Công đoàn", "Trừ khác", "Thực lĩnh", "Ngân hàng", "Số tài khoản",
  ];
  ws.addRow(header);

  opts.rows.forEach((r, i) => {
    ws.addRow([
      i + 1, r.full_name, r.position ?? "", r.base_salary, r.standard_days, r.worked_days, r.salary_by_days,
      r.tech_revenue, r.commission, r.overtime_amount, r.travel_allowance, r.bonus, r.extra_allowance,
      r.gross, r.advance, r.social_insurance, r.union_fee, r.other_deduction, r.net_pay,
      r.bank_name ?? "", r.bank_account ?? "",
    ]);
  });
  const sum = (k: string) => opts.rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  ws.addRow([
    "", "TỔNG CỘNG", "", "", "", "", sum("salary_by_days"), sum("tech_revenue"), sum("commission"),
    sum("overtime_amount"), sum("travel_allowance"), sum("bonus"), sum("extra_allowance"), sum("gross"),
    sum("advance"), sum("social_insurance"), sum("union_fee"), sum("other_deduction"), sum("net_pay"), "", "",
  ]);

  ws.columns.forEach((c: any, i: number) => {
    c.width = i === 1 ? 26 : i === 20 ? 20 : i <= 2 ? 12 : 14;
  });
  ws.eachRow((row: any, n: number) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      cell.border = border;
      if (col >= 4 && col <= 19 && typeof cell.value === "number") cell.numFmt = "#,##0";
      if (n === 2 || n === ws.rowCount) cell.font = { bold: true };
      if (n === 2) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      }
    });
  });
  // Số tài khoản phải là chuỗi, không để Excel đổi thành số khoa học.
  ws.getColumn(21).numFmt = "@";

  await download(wb, `bang-luong-${y}-${m}.xlsx`);
}

// ─── Phiếu lương (in) ──────────────────────────────────────────────────────
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function slipHtml(r: any, month: string, siteName: string) {
  const [y, m] = month.split("-");
  const line = (label: string, days: string, amount: number | null, note = "") => `
    <tr><td>${label}</td><td class="c">${days}</td><td class="r">${amount === null ? "" : money(amount)}</td><td class="n">${esc(note)}</td></tr>`;
  const ot = [r.ot_hours_15 ? `${r.ot_hours_15}h×1,5` : "", r.ot_hours_20 ? `${r.ot_hours_20}h×2` : ""].filter(Boolean).join(" + ");
  return `
  <div class="slip">
    <table>
      <tr><th colspan="2">PHIẾU LƯƠNG THÁNG ${m}.${y}</th><th colspan="2">${esc(String(r.full_name).toUpperCase())}</th></tr>
      <tr><td>Năm bắt đầu làm</td><td>${esc(r.start_label ?? "")}</td><td>Khu vực</td><td>${esc(r.area ?? "")}</td></tr>
      <tr><td>Bộ phận</td><td>${esc(r.position ?? "")}</td><td>Lương cơ bản</td><td class="r">${money(r.base_salary)}</td></tr>
      <tr class="h"><td>Diễn giải</td><td class="c">Ngày công</td><td class="r">Thành tiền</td><td>Ghi chú</td></tr>
      ${line("Lương thực tế", String(r.worked_days ?? ""), r.salary_by_days, `/ ${r.standard_days} công chuẩn`)}
      ${line("Tăng ca", ot, r.overtime_amount)}
      ${line("Lương doanh số", "", r.tech_revenue)}
      ${line("Hoa hồng", "", r.commission)}
      ${line("Xăng xe", "", r.travel_allowance, r.travel_note)}
      ${line("Thưởng", "", r.bonus)}
      ${line("Phụ cấp", "", r.extra_allowance, r.extra_note)}
      <tr class="b"><td>Tổng lương (1)</td><td></td><td class="r">${money(r.gross)}</td><td></td></tr>
      ${line("BHXH", "", r.social_insurance)}
      ${line("Tạm ứng", "", r.advance)}
      ${line("Quỹ công đoàn", "", r.union_fee)}
      ${line("Trừ khác", "", r.other_deduction, r.other_note)}
      <tr class="b"><td>Tổng khấu trừ (2)</td><td></td><td class="r">${money(r.deductions)}</td><td></td></tr>
      <tr class="t"><td>Thực lĩnh (= 1 − 2)</td><td></td><td class="r">${money(r.net_pay)}</td><td></td></tr>
      ${r.bank_account ? `<tr><td>Chuyển khoản</td><td colspan="3">${esc(r.bank_name ?? "")} — ${esc(r.bank_account)}</td></tr>` : ""}
      <tr><td colspan="4" class="f">${esc(siteName)} chân thành cảm ơn sự đóng góp của các bạn!</td></tr>
    </table>
  </div>`;
}

/** In phiếu lương, 2 phiếu mỗi trang A4 như sheet PHIẾU LƯƠNG. */
export function printPayslips(rows: any[], month: string, siteName = "MR*VU") {
  const pw = window.open("", "_blank");
  if (!pw) {
    alert("Trình duyệt đang chặn cửa sổ in — cho phép pop-up rồi thử lại.");
    return;
  }
  pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu lương ${month}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
    .page { display: flex; flex-direction: column; gap: 10mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .slip table { width: 100%; border-collapse: collapse; }
    .slip td, .slip th { border: 1px solid #999; padding: 4px 6px; }
    .slip th { background: #f2f2f2; font-size: 13px; }
    .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
    .n { color: #555; font-size: 11px; }
    .h td { background: #fafafa; font-weight: bold; }
    .b td { font-weight: bold; }
    .t td { font-weight: bold; font-size: 14px; background: #fff7e6; }
    .f { text-align: center; font-style: italic; color: #555; }
  </style></head><body>`);
  for (let i = 0; i < rows.length; i += 2) {
    pw.document.write(`<div class="page">${slipHtml(rows[i], month, siteName)}${rows[i + 1] ? slipHtml(rows[i + 1], month, siteName) : ""}</div>`);
  }
  pw.document.write("</body></html>");
  pw.document.close();
  setTimeout(() => pw.print(), 300);
}
