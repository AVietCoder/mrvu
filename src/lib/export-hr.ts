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

// ─── Bảng lương (có công thức, bám cấu trúc file "BẢNG LƯƠNG KT HCM") ───────
/** Số cột (1-based) → chữ cột Excel: 1→A, 27→AA. */
function colName(n: number) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
/** Ô công thức kèm kết quả đã tính sẵn — Excel sẽ tính lại khi mở. */
const f = (formula: string, result?: number) => ({ formula, result: result ?? 0 });
const ref = (sheet: string, addr: string) => `'${sheet}'!${addr}`;
const n0 = (v: any) => Number(v) || 0;
const fill = (argb: string) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const SH_CC = "BẢNG CHẤM CÔNG";
const SH_DT = "DOANH THU KỸ THUẬT";
const SH_HH = "HOA HỒNG";
const SH_TL = "TỔNG LƯƠNG";
const SH_PL = "PHIẾU LƯƠNG";

function styleTable(ws: any, fromRow: number, toRow: number, toCol: number, moneyCols: number[] = []) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= toCol; c++) {
      const cell = ws.getCell(r, c);
      cell.border = border;
      if (moneyCols.includes(c)) cell.numFmt = "#,##0";
    }
  }
}

/**
 * Xuất bảng lương thành workbook NHIỀU SHEET NỐI CÔNG THỨC như file Excel đang dùng:
 *  - BẢNG CHẤM CÔNG: mã X/N/L/K từng ngày, COUNTIF từng mã, Tổng công = X + N/2 + L
 *  - DOANH THU KỸ THUẬT: từng lịch đã hoàn thành, Thành tiền = (giá×SL + phụ phí + phụ thu chung)/số người + phụ thu riêng
 *  - HOA HỒNG: đơn của nhóm khách × % hoa hồng
 *  - TỔNG LƯƠNG: Công TT ← chấm công, Lương TN = ROUND(LCB/công chuẩn×công TT), Tăng ca, Tổng, Thực lĩnh
 *  - PHIẾU LƯƠNG: mỗi người một phiếu, mọi số lấy từ TỔNG LƯƠNG
 * Sửa một ô chấm công / tăng ca trong file thì lương tự tính lại như file cũ.
 * Người ĐÃ CHỐT: số công, doanh số, hoa hồng ghi bằng số chốt (không nối công
 * thức) để file luôn khớp đúng số đã chi.
 */
export async function exportPayrollExcel(opts: { month: string; rows: any[] }) {
  const wb = await newWorkbook();
  wb.calcProperties = { fullCalcOnLoad: true };
  const [y, m] = opts.month.split("-");
  const rows = opts.rows;
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const dates = Array.from({ length: last }, (_, i) => `${y}-${m}-${String(i + 1).padStart(2, "0")}`);

  // Thứ tự sheet như file gốc: TỔNG LƯƠNG đứng đầu.
  const tl = wb.addWorksheet(SH_TL, { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  const cc = wb.addWorksheet(SH_CC, { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  const dt = wb.addWorksheet(SH_DT);
  const hh = wb.addWorksheet(SH_HH);
  const pl = wb.addWorksheet(SH_PL);

  // ── BẢNG CHẤM CÔNG ──
  const D0 = 4; // cột ngày đầu tiên (D)
  const cX = D0 + dates.length, cN = cX + 1, cL = cX + 2, cK = cX + 3, cT = cX + 4, cNote = cX + 5;
  cc.getCell(1, 1).value = `BẢNG CHẤM CÔNG THÁNG ${Number(m)}/${y}`;
  cc.getCell(1, 1).font = { bold: true, size: 14 };
  cc.getCell(2, 1).value = "X = cả ngày · N = nửa ngày · L = nghỉ hưởng lương · K = nghỉ không lương";
  cc.getCell(2, 1).font = { italic: true, color: { argb: "FF666666" } };
  const h3 = cc.getRow(3), h4 = cc.getRow(4);
  ["STT", "HỌ VÀ TÊN", "CHỨC VỤ"].forEach((t, i) => { h3.getCell(i + 1).value = t; cc.mergeCells(3, i + 1, 4, i + 1); });
  dates.forEach((d, i) => {
    h3.getCell(D0 + i).value = Number(d.slice(8));
    h4.getCell(D0 + i).value = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][dow(d)];
  });
  [["Làm nguyên ngày", cX], ["Làm nửa ngày", cN], ["Nghỉ hưởng lương", cL], ["Nghỉ không lương", cK], ["TỔNG NGÀY CÔNG", cT], ["GHI CHÚ", cNote]].forEach(([t, c]: any) => {
    h3.getCell(c).value = t;
    cc.mergeCells(3, c, 4, c);
  });
  const ccRowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    const rn = 5 + i;
    ccRowOf.set(r.user_id, rn);
    const row = cc.getRow(rn);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = r.full_name;
    row.getCell(3).value = r.position ?? "";
    dates.forEach((d, j) => { const code = r.att_codes?.[d]; if (code) row.getCell(D0 + j).value = code; });
    const span = `${colName(D0)}${rn}:${colName(D0 + dates.length - 1)}${rn}`;
    const t = r.attendance ?? {};
    row.getCell(cX).value = f(`COUNTIF(${span},"X")`, n0(t.X));
    row.getCell(cN).value = f(`COUNTIF(${span},"N")`, n0(t.N));
    row.getCell(cL).value = f(`COUNTIF(${span},"L")`, n0(t.L));
    row.getCell(cK).value = f(`COUNTIF(${span},"K")`, n0(t.K));
    row.getCell(cT).value = f(`${colName(cX)}${rn}+(${colName(cN)}${rn}/2)+${colName(cL)}${rn}`, n0(r.worked_days));
    if (r.locked) row.getCell(cNote).value = "Đã chốt lương";
  });
  const ccLast = 4 + rows.length;
  styleTable(cc, 3, ccLast, cNote);
  for (let r = 3; r <= ccLast; r++) {
    for (let c = 1; c <= cNote; c++) {
      const cell = cc.getCell(r, c);
      cell.alignment = { vertical: "middle", horizontal: c === 2 || c === 3 ? "left" : "center", wrapText: r <= 4 };
      if (r <= 4) { cell.font = { bold: true }; cell.fill = fill("FFF2F2F2"); }
      if (c >= D0 && c < cX && dow(dates[c - D0]) === 0) cell.fill = fill("FFFFF2CC");
      if (c === cT && r > 4) cell.font = { bold: true };
    }
  }
  cc.getColumn(1).width = 5; cc.getColumn(2).width = 26; cc.getColumn(3).width = 12;
  for (let c = D0; c < cX; c++) cc.getColumn(c).width = 4.5;
  for (let c = cX; c <= cT; c++) cc.getColumn(c).width = 10;
  cc.getColumn(cNote).width = 18;
  cc.getRow(3).height = 32;

  // ── DOANH THU KỸ THUẬT ──
  dt.getCell(1, 1).value = `DOANH THU LẮP CỦA KỸ THUẬT - ${m}/${y} (chỉ lịch đã hoàn thành)`;
  dt.getCell(1, 1).font = { bold: true, size: 14 };
  const dtHeader = ["Ngày", "Công việc", "Loại việc", "Đơn giá", "SL", "Phụ phí khó", "Phụ thu chia chung", "Số người", "Phụ thu riêng", "Thành tiền"];
  const techCell = new Map<string, string>();
  let dr = 3;
  for (const r of rows) {
    const lines = r.tech_lines ?? [];
    if (!lines.length || r.snapshot) continue;
    dt.getCell(dr, 1).value = r.full_name;
    dt.getCell(dr, 1).font = { bold: true, size: 12 };
    dt.getCell(dr, 1).fill = fill("FFDDEBF7");
    dt.mergeCells(dr, 1, dr, dtHeader.length);
    dr++;
    const hr = dt.getRow(dr);
    dtHeader.forEach((t, i) => { hr.getCell(i + 1).value = t; hr.getCell(i + 1).font = { bold: true }; hr.getCell(i + 1).fill = fill("FFF2F2F2"); });
    const headRow = dr;
    dr++;
    const first = dr;
    for (const l of lines) {
      const row = dt.getRow(dr);
      const price = n0(l.work_type?.price);
      const qty = l.work_type ? n0(l.work_type.qty) || 1 : 0;
      const diff = (l.difficulties ?? []).reduce((s: number, d: any) => s + n0(d.bonus) * (n0(d.qty) || 1), 0);
      const items = l.extra_income ?? [];
      const shared = items.filter((it: any) => !it.user_id).reduce((s: number, it: any) => s + n0(it.amount), 0);
      const own = items.filter((it: any) => it.user_id === r.user_id).reduce((s: number, it: any) => s + n0(it.amount), 0);
      const people = n0(l.num_people) || 1;
      row.getCell(1).value = String(l.scheduled_date ?? "").split("-").reverse().join("/");
      row.getCell(2).value = [l.title, (l.difficulties ?? []).map((d: any) => d.name).join(", ")].filter(Boolean).join(" — ");
      row.getCell(3).value = l.work_type?.name ?? "";
      row.getCell(4).value = price;
      row.getCell(5).value = qty;
      row.getCell(6).value = diff;
      row.getCell(7).value = shared;
      row.getCell(8).value = people;
      row.getCell(9).value = own;
      row.getCell(10).value = f(`(D${dr}*E${dr}+F${dr}+G${dr})/H${dr}+I${dr}`, n0(l.money_share));
      dr++;
    }
    const tot = dt.getRow(dr);
    tot.getCell(1).value = "Lương doanh số";
    dt.mergeCells(dr, 1, dr, 9);
    tot.getCell(10).value = f(`SUM(J${first}:J${dr - 1})`, lines.reduce((s: number, l: any) => s + n0(l.money_share), 0));
    tot.font = { bold: true };
    styleTable(dt, headRow, dr, dtHeader.length, [4, 6, 7, 9, 10]);
    techCell.set(r.user_id, `J${dr}`);
    dr += 2;
  }
  if (dr === 3) dt.getCell(3, 1).value = "Không có lịch kỹ thuật đã hoàn thành trong tháng (hoặc người đã chốt lương).";
  [11, 40, 14, 11, 6, 12, 14, 9, 12, 14].forEach((w, i) => (dt.getColumn(i + 1).width = w));

  // ── HOA HỒNG ──
  hh.getCell(1, 1).value = `DOANH THU TÍNH HOA HỒNG - ${m}/${y}`;
  hh.getCell(1, 1).font = { bold: true, size: 14 };
  const commCell = new Map<string, string>();
  let hr2 = 3;
  for (const r of rows) {
    if (!(n0(r.commission_rate) > 0) || r.snapshot) continue;
    const orders = r.commission_orders ?? [];
    hh.getCell(hr2, 1).value = `${r.full_name} — nhóm khách "${r.commission_group ?? ""}" — ${r.commission_rate}%`;
    hh.getCell(hr2, 1).font = { bold: true, size: 12 };
    hh.getCell(hr2, 1).fill = fill("FFDDEBF7");
    hh.mergeCells(hr2, 1, hr2, 5);
    hr2++;
    const head = hr2;
    ["STT", "Hoá đơn", "Khách hàng", "Ngày", "Doanh thu"].forEach((t, i) => {
      const c = hh.getCell(hr2, i + 1); c.value = t; c.font = { bold: true }; c.fill = fill("FFF2F2F2");
    });
    hr2++;
    const first = hr2;
    orders.forEach((o: any, i: number) => {
      const row = hh.getRow(hr2);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = o.code;
      row.getCell(3).value = o.customer_name;
      row.getCell(4).value = String(o.date ?? "").slice(0, 10).split("-").reverse().join("/");
      row.getCell(5).value = n0(o.total);
      hr2++;
    });
    const sumRow = hr2;
    hh.getCell(sumRow, 1).value = "Tổng doanh thu";
    hh.mergeCells(sumRow, 1, sumRow, 4);
    hh.getCell(sumRow, 5).value = orders.length ? f(`SUM(E${first}:E${sumRow - 1})`, n0(r.commission_base)) : 0;
    hh.getCell(sumRow + 1, 1).value = "Tỷ lệ hoa hồng (%)";
    hh.mergeCells(sumRow + 1, 1, sumRow + 1, 4);
    hh.getCell(sumRow + 1, 5).value = n0(r.commission_rate);
    hh.getCell(sumRow + 2, 1).value = "Hoa hồng";
    hh.mergeCells(sumRow + 2, 1, sumRow + 2, 4);
    hh.getCell(sumRow + 2, 5).value = f(`ROUND(E${sumRow}*E${sumRow + 1}/100,0)`, n0(r.commission_auto));
    for (let k = sumRow; k <= sumRow + 2; k++) hh.getRow(k).font = { bold: true };
    styleTable(hh, head, sumRow + 2, 5, [5]);
    hh.getCell(sumRow + 1, 5).numFmt = "0.00";
    commCell.set(r.user_id, `E${sumRow + 2}`);
    hr2 = sumRow + 4;
  }
  if (hr2 === 3) hh.getCell(3, 1).value = "Không có nhân viên hưởng hoa hồng theo nhóm khách.";
  [6, 14, 36, 12, 16].forEach((w, i) => (hh.getColumn(i + 1).width = w));

  // ── TỔNG LƯƠNG ──
  const TL_HEAD = [
    "STT", "Tên NV", "Chức vụ", "Lương cơ bản", "Số công chuẩn", "Số công thực tế", "Lương thực nhận",
    "Lương doanh số", "Hoa hồng", "Giờ TC ×1,5", "Giờ TC ×2", "Tăng ca", "Xăng xe đi tỉnh", "Thưởng", "Phụ cấp thêm",
    "Tổng thu nhập", "Tạm ứng", "BHXH", "Công đoàn", "Trừ khác", "Tổng khấu trừ", "Thực lĩnh", "Ngân hàng", "Số tài khoản", "Ghi chú",
  ];
  const TLC = TL_HEAD.length;
  tl.getCell(1, 1).value = `BẢNG LƯƠNG THÁNG ${m}/${y}`;
  tl.getCell(1, 1).font = { bold: true, size: 14 };
  tl.mergeCells(1, 1, 1, TLC);
  // Nhóm cột như file gốc
  const groups: [string, number, number][] = [["Lương và thời gian làm việc", 4, 7], ["Phụ cấp / thu nhập thêm", 8, 15], ["Khấu trừ", 17, 21]];
  for (const [t, a, b] of groups) { tl.getCell(2, a).value = t; tl.mergeCells(2, a, 2, b); }
  for (const c of [1, 2, 3, 16, 22, 23, 24, 25]) { tl.getCell(2, c).value = TL_HEAD[c - 1]; tl.mergeCells(2, c, 3, c); }
  TL_HEAD.forEach((t, i) => { if (![1, 2, 3, 16, 22, 23, 24, 25].includes(i + 1)) tl.getCell(3, i + 1).value = t; });

  const tlRowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    const rn = 4 + i;
    tlRowOf.set(r.user_id, rn);
    const row = tl.getRow(rn);
    const ccRow = ccRowOf.get(r.user_id);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = r.full_name;
    row.getCell(3).value = r.position ?? "";
    row.getCell(4).value = n0(r.base_salary);
    row.getCell(5).value = n0(r.standard_days);
    row.getCell(6).value = !r.locked && ccRow ? f(ref(SH_CC, `${colName(cT)}${ccRow}`), n0(r.worked_days)) : n0(r.worked_days);
    row.getCell(7).value = f(`ROUND(D${rn}/E${rn}*F${rn},0)`, n0(r.salary_by_days));
    const tc = techCell.get(r.user_id);
    row.getCell(8).value = tc ? f(`ROUND(${ref(SH_DT, tc)},0)`, n0(r.tech_revenue)) : n0(r.tech_revenue);
    const hc = commCell.get(r.user_id);
    const overridden = r.commission_override !== null && r.commission_override !== undefined;
    row.getCell(9).value = hc && !overridden ? f(ref(SH_HH, hc), n0(r.commission)) : n0(r.commission);
    row.getCell(10).value = n0(r.ot_hours_15);
    row.getCell(11).value = n0(r.ot_hours_20);
    row.getCell(12).value = f(`ROUND(D${rn}/E${rn}/8*(J${rn}*1.5+K${rn}*2),0)`, n0(r.overtime_amount));
    row.getCell(13).value = n0(r.travel_allowance);
    row.getCell(14).value = n0(r.bonus);
    row.getCell(15).value = n0(r.extra_allowance);
    row.getCell(16).value = f(`G${rn}+H${rn}+I${rn}+L${rn}+M${rn}+N${rn}+O${rn}`, n0(r.gross));
    row.getCell(17).value = n0(r.advance);
    row.getCell(18).value = n0(r.social_insurance);
    row.getCell(19).value = n0(r.union_fee);
    row.getCell(20).value = n0(r.other_deduction);
    row.getCell(21).value = f(`SUM(Q${rn}:T${rn})`, n0(r.deductions));
    row.getCell(22).value = f(`P${rn}-U${rn}`, n0(r.net_pay));
    row.getCell(23).value = r.bank_name ?? "";
    row.getCell(24).value = r.bank_account ? String(r.bank_account) : "";
    row.getCell(25).value = [
      r.locked ? "Đã chốt" : "",
      overridden ? "Hoa hồng nhập tay" : "",
      r.travel_note ? `Xăng xe: ${r.travel_note}` : "",
      r.extra_note ? `Phụ cấp: ${r.extra_note}` : "",
      r.other_note ? `Trừ khác: ${r.other_note}` : "",
    ].filter(Boolean).join("; ");
  });
  const tlFirst = 4, tlLastData = 3 + rows.length, tlSum = tlLastData + 1;
  const sumRow = tl.getRow(tlSum);
  sumRow.getCell(2).value = "TỔNG CỘNG";
  for (const c of [7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
    const L = colName(c);
    sumRow.getCell(c).value = rows.length ? f(`SUM(${L}${tlFirst}:${L}${tlLastData})`) : 0;
  }
  sumRow.font = { bold: true };
  // TỔNG CHI như ô Q4 file gốc — chỉ cộng người thực lĩnh dương (người âm không chi).
  const payRow = tl.getRow(tlSum + 1);
  payRow.getCell(2).value = "TỔNG CHI (thực lĩnh > 0)";
  payRow.getCell(22).value = rows.length ? f(`SUMIF(V${tlFirst}:V${tlLastData},">0")`) : 0;
  payRow.font = { bold: true, color: { argb: "FFC00000" } };

  styleTable(tl, 2, tlSum + 1, TLC, [4, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  for (let r = 2; r <= 3; r++) {
    for (let c = 1; c <= TLC; c++) {
      const cell = tl.getCell(r, c);
      cell.font = { bold: true };
      cell.fill = fill("FFF2F2F2");
      cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    }
  }
  for (let r = tlFirst; r <= tlSum + 1; r++) {
    tl.getCell(r, 22).font = { bold: true, ...(r === tlSum + 1 ? { color: { argb: "FFC00000" } } : {}) };
    tl.getCell(r, 24).numFmt = "@"; // STK là chuỗi, không để Excel đổi thành số khoa học
  }
  tl.getRow(3).height = 32;
  [5, 26, 12, 13, 9, 9, 13, 13, 12, 8, 8, 12, 12, 12, 12, 14, 12, 11, 11, 11, 13, 14, 12, 18, 30].forEach((w, i) => (tl.getColumn(i + 1).width = w));

  // ── PHIẾU LƯƠNG (mọi số lấy từ TỔNG LƯƠNG) ──
  [30, 14, 16, 34].forEach((w, i) => (pl.getColumn(i + 1).width = w));
  let pr = 1;
  for (const r of rows) {
    const rn = tlRowOf.get(r.user_id)!;
    const T = (col: string) => ref(SH_TL, `${col}${rn}`);
    const start = pr;
    pl.getCell(pr, 1).value = `PHIẾU LƯƠNG THÁNG ${m}.${y}`;
    pl.getCell(pr, 3).value = String(r.full_name ?? "").toUpperCase();
    pl.mergeCells(pr, 1, pr, 2); pl.mergeCells(pr, 3, pr, 4);
    pl.getRow(pr).font = { bold: true, size: 12 };
    pl.getRow(pr).eachCell((c: any) => (c.fill = fill("FFF2F2F2")));
    pr++;
    pl.getRow(pr).values = ["Năm bắt đầu làm", r.start_label ?? "", "Khu vực", r.area ?? ""]; pr++;
    pl.getRow(pr).values = ["Bộ phận", r.position ?? "", "Lương cơ bản", f(T("D"), n0(r.base_salary))];
    pl.getCell(pr, 4).numFmt = "#,##0"; pr++;
    pl.getRow(pr).values = ["Diễn giải", "Ngày công", "Thành tiền", "Ghi chú"];
    pl.getRow(pr).font = { bold: true }; pr++;
    const incomeFirst = pr;
    const ot = [r.ot_hours_15 ? `${r.ot_hours_15}h×1,5` : "", r.ot_hours_20 ? `${r.ot_hours_20}h×2` : ""].filter(Boolean).join(" + ");
    const incomes: [string, any, string, number, string][] = [
      ["Lương thực tế", f(T("F"), n0(r.worked_days)), "G", n0(r.salary_by_days), `/ ${r.standard_days} công chuẩn`],
      ["Tăng ca", ot, "L", n0(r.overtime_amount), ""],
      ["Lương doanh số", "", "H", n0(r.tech_revenue), ""],
      ["Hoa hồng", "", "I", n0(r.commission), ""],
      ["Xăng xe", "", "M", n0(r.travel_allowance), r.travel_note ?? ""],
      ["Thưởng", "", "N", n0(r.bonus), ""],
      ["Phụ cấp", "", "O", n0(r.extra_allowance), r.extra_note ?? ""],
    ];
    for (const [label, days, col, val, note] of incomes) {
      pl.getRow(pr).values = [label, days, f(T(col), val), note]; pr++;
    }
    const grossRow = pr;
    pl.getRow(pr).values = ["Tổng lương (1)", "", f(`SUM(C${incomeFirst}:C${pr - 1})`, n0(r.gross)), ""];
    pl.getRow(pr).font = { bold: true }; pr++;
    const dedFirst = pr;
    const deds: [string, string, number, string][] = [
      ["BHXH", "R", n0(r.social_insurance), ""],
      ["Tạm ứng", "Q", n0(r.advance), ""],
      ["Quỹ công đoàn", "S", n0(r.union_fee), ""],
      ["Trừ khác", "T", n0(r.other_deduction), r.other_note ?? ""],
    ];
    for (const [label, col, val, note] of deds) {
      pl.getRow(pr).values = [label, "", f(T(col), val), note]; pr++;
    }
    const dedRow = pr;
    pl.getRow(pr).values = ["Tổng khấu trừ (2)", "", f(`SUM(C${dedFirst}:C${pr - 1})`, n0(r.deductions)), ""];
    pl.getRow(pr).font = { bold: true }; pr++;
    pl.getRow(pr).values = ["Thực lĩnh (= 1 − 2)", "", f(`C${grossRow}-C${dedRow}`, n0(r.net_pay)), ""];
    pl.getRow(pr).font = { bold: true, size: 12 };
    pl.getCell(pr, 3).fill = fill("FFFFF2CC"); pr++;
    if (r.bank_account) { pl.getRow(pr).values = ["Chuyển khoản", `${r.bank_name ?? ""} — ${r.bank_account}`]; pl.mergeCells(pr, 2, pr, 4); pr++; }
    styleTable(pl, start, pr - 1, 4);
    for (let k = start; k < pr; k++) {
      pl.getCell(k, 3).numFmt = "#,##0";
      pl.getCell(k, 3).alignment = { horizontal: "right" };
      pl.getCell(k, 2).alignment = { horizontal: "center" };
    }
    pr += 2;
  }

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
