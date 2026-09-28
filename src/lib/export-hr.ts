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
 *  - TỔNG LƯƠNG: Công TT ← chấm công, Lương TN = ROUND(LCB/công chuẩn×công TT), Tăng ca, Tổng, Thực lĩnh
 *  - PHIẾU LƯƠNG: mỗi người một phiếu, mọi số lấy từ TỔNG LƯƠNG
 * Sửa một ô chấm công / tăng ca trong file thì lương tự tính lại như file cũ.
 * Người ĐÃ CHỐT: số công, doanh số ghi bằng số chốt (không nối công
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
    dates.forEach((d, j) => {
      const code = r.att_codes?.[d];
      if (code) row.getCell(D0 + j).value = code;
      // Ghi chú ngày (lý do nghỉ, tăng ca…) → comment của ô, như comment Excel.
      const note = r.att_notes?.[d];
      if (note) row.getCell(D0 + j).note = String(note);
    });
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
    tot.getCell(1).value = "DS kỹ thuật";
    dt.mergeCells(dr, 1, dr, 9);
    tot.getCell(10).value = f(`SUM(J${first}:J${dr - 1})`, lines.reduce((s: number, l: any) => s + n0(l.money_share), 0));
    tot.font = { bold: true };
    styleTable(dt, headRow, dr, dtHeader.length, [4, 6, 7, 9, 10]);
    techCell.set(r.user_id, `J${dr}`);
    dr += 2;
  }
  if (dr === 3) dt.getCell(3, 1).value = "Không có lịch kỹ thuật đã hoàn thành trong tháng (hoặc người đã chốt lương).";
  [11, 40, 14, 11, 6, 12, 14, 9, 12, 14].forEach((w, i) => (dt.getColumn(i + 1).width = w));

  // ── TỔNG LƯƠNG ──
  // Cột khai báo theo KHOÁ để công thức tham chiếu bằng tên (C.gross…) — thêm /
  // bớt cột không phải sửa tay từng chữ cái.
  const TL_COLS = [
    ["stt", "STT", 5], ["name", "Tên NV", 26], ["pos", "Chức vụ", 12], ["base", "Lương cơ bản", 13],
    ["std", "Số công chuẩn", 9], ["worked", "Số công thực tế", 9], ["salary", "Lương thực nhận", 13],
    ["tech", "DS kỹ thuật", 13], ["sales", "DS bán hàng", 13], ["biz", "DS kinh doanh", 13],
    ["ot15", "Giờ TC ×1,5", 8], ["ot20", "Giờ TC ×2", 8], ["ot", "Tăng ca", 12], ["travel", "Xăng xe đi tỉnh", 12],
    ["bonus", "Thưởng", 12], ["extra", "Phụ cấp thêm", 12], ["gross", "Tổng thu nhập", 14],
    ["adv", "Tạm ứng", 12], ["bhxh", "BHXH", 11], ["union", "Công đoàn", 11], ["other", "Trừ khác", 11],
    ["ded", "Tổng khấu trừ", 13], ["net", "Thực lĩnh", 14], ["bank", "Ngân hàng", 12], ["acct", "Số tài khoản", 18], ["note", "Ghi chú", 30],
  ] as const;
  const CI: Record<string, number> = Object.fromEntries(TL_COLS.map(([k], i) => [k, i + 1]));
  const L = (k: string) => colName(CI[k]);
  const TLC = TL_COLS.length;
  tl.getCell(1, 1).value = `BẢNG LƯƠNG THÁNG ${m}/${y}`;
  tl.getCell(1, 1).font = { bold: true, size: 14 };
  tl.mergeCells(1, 1, 1, TLC);
  // Nhóm cột như file gốc; các cột đứng riêng thì gộp 2 dòng tiêu đề.
  const groups: [string, string, string][] = [
    ["Lương và thời gian làm việc", "base", "salary"],
    ["Phụ cấp / thu nhập thêm", "tech", "extra"],
    ["Khấu trừ", "adv", "ded"],
  ];
  const grouped = new Set<number>();
  for (const [t, a, b] of groups) {
    tl.getCell(2, CI[a]).value = t;
    tl.mergeCells(2, CI[a], 2, CI[b]);
    for (let c = CI[a]; c <= CI[b]; c++) grouped.add(c);
  }
  TL_COLS.forEach(([, label], i) => {
    const c = i + 1;
    if (grouped.has(c)) tl.getCell(3, c).value = label;
    else { tl.getCell(2, c).value = label; tl.mergeCells(2, c, 3, c); }
  });

  const tlRowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    const rn = 4 + i;
    tlRowOf.set(r.user_id, rn);
    const row = tl.getRow(rn);
    const set = (k: string, v: any) => (row.getCell(CI[k]).value = v);
    const at = (k: string) => `${L(k)}${rn}`;
    const ccRow = ccRowOf.get(r.user_id);
    set("stt", i + 1);
    set("name", r.full_name);
    set("pos", r.position ?? "");
    set("base", n0(r.base_salary));
    set("std", n0(r.standard_days));
    set("worked", !r.locked && ccRow ? f(ref(SH_CC, `${colName(cT)}${ccRow}`), n0(r.worked_days)) : n0(r.worked_days));
    set("salary", f(`ROUND(${at("base")}/${at("std")}*${at("worked")},0)`, n0(r.salary_by_days)));
    const tc = techCell.get(r.user_id);
    set("tech", tc ? f(`ROUND(${ref(SH_DT, tc)},0)`, n0(r.tech_revenue)) : n0(r.tech_revenue));
    // DS bán hàng / DS kinh doanh: tính từ tiền thực thu cả nhóm → ghi số (xem chi tiết trên app).
    set("sales", n0(r.commission));
    set("biz", n0(r.business_revenue));
    set("ot15", n0(r.ot_hours_15));
    set("ot20", n0(r.ot_hours_20));
    set("ot", f(`ROUND(${at("base")}/${at("std")}/8*(${at("ot15")}*1.5+${at("ot20")}*2),0)`, n0(r.overtime_amount)));
    set("travel", n0(r.travel_allowance));
    set("bonus", n0(r.bonus));
    set("extra", n0(r.extra_allowance));
    set("gross", f(["salary", "tech", "sales", "biz", "ot", "travel", "bonus", "extra"].map(at).join("+"), n0(r.gross)));
    set("adv", n0(r.advance));
    set("bhxh", n0(r.social_insurance));
    set("union", n0(r.union_fee));
    set("other", n0(r.other_deduction));
    set("ded", f(`SUM(${at("adv")}:${at("other")})`, n0(r.deductions)));
    set("net", f(`${at("gross")}-${at("ded")}`, n0(r.net_pay)));
    set("bank", r.bank_name ?? "");
    set("acct", r.bank_account ? String(r.bank_account) : "");
    set("note", [
      r.locked ? "Đã chốt" : "",
      r.commission_override !== null && r.commission_override !== undefined ? "DS bán hàng do admin sửa" : "",
      r.business_override !== null && r.business_override !== undefined ? "DS kinh doanh do admin sửa" : "",
      r.travel_note ? `Xăng xe: ${r.travel_note}` : "",
      r.extra_note ? `Phụ cấp: ${r.extra_note}` : "",
      r.other_note ? `Trừ khác: ${r.other_note}` : "",
    ].filter(Boolean).join("; "));
  });
  const tlFirst = 4, tlLastData = 3 + rows.length, tlSum = tlLastData + 1;
  const MONEY_KEYS = ["base", "salary", "tech", "sales", "biz", "ot", "travel", "bonus", "extra", "gross", "adv", "bhxh", "union", "other", "ded", "net"];
  const sumRow = tl.getRow(tlSum);
  sumRow.getCell(CI.name).value = "TỔNG CỘNG";
  for (const k of MONEY_KEYS.filter((k) => k !== "base")) {
    sumRow.getCell(CI[k]).value = rows.length ? f(`SUM(${L(k)}${tlFirst}:${L(k)}${tlLastData})`) : 0;
  }
  sumRow.font = { bold: true };
  // TỔNG CHI như ô Q4 file gốc — chỉ cộng người thực lĩnh dương (người âm không chi).
  const payRow = tl.getRow(tlSum + 1);
  payRow.getCell(CI.name).value = "TỔNG CHI (thực lĩnh > 0)";
  payRow.getCell(CI.net).value = rows.length ? f(`SUMIF(${L("net")}${tlFirst}:${L("net")}${tlLastData},">0")`) : 0;
  payRow.font = { bold: true, color: { argb: "FFC00000" } };

  styleTable(tl, 2, tlSum + 1, TLC, MONEY_KEYS.map((k) => CI[k]));
  for (let r = 2; r <= 3; r++) {
    for (let c = 1; c <= TLC; c++) {
      const cell = tl.getCell(r, c);
      cell.font = { bold: true };
      cell.fill = fill("FFF2F2F2");
      cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    }
  }
  for (let r = tlFirst; r <= tlSum + 1; r++) {
    tl.getCell(r, CI.net).font = { bold: true, ...(r === tlSum + 1 ? { color: { argb: "FFC00000" } } : {}) };
    tl.getCell(r, CI.acct).numFmt = "@"; // STK là chuỗi, không để Excel đổi thành số khoa học
  }
  tl.getRow(3).height = 32;
  TL_COLS.forEach(([, , w], i) => (tl.getColumn(i + 1).width = w));

  // ── PHIẾU LƯƠNG (mọi số lấy từ TỔNG LƯƠNG) ──
  [30, 14, 16, 34].forEach((w, i) => (pl.getColumn(i + 1).width = w));
  let pr = 1;
  for (const r of rows) {
    const rn = tlRowOf.get(r.user_id)!;
    const T = (k: string) => ref(SH_TL, `${L(k)}${rn}`);
    const start = pr;
    pl.getCell(pr, 1).value = `PHIẾU LƯƠNG THÁNG ${m}.${y}`;
    pl.getCell(pr, 3).value = String(r.full_name ?? "").toUpperCase();
    pl.mergeCells(pr, 1, pr, 2); pl.mergeCells(pr, 3, pr, 4);
    pl.getRow(pr).font = { bold: true, size: 12 };
    pl.getRow(pr).eachCell((c: any) => (c.fill = fill("FFF2F2F2")));
    pr++;
    pl.getRow(pr).values = ["Năm bắt đầu làm", r.start_label ?? "", "Khu vực", r.area ?? ""]; pr++;
    pl.getRow(pr).values = ["Bộ phận", r.position ?? "", "Lương cơ bản", f(T("base"), n0(r.base_salary))];
    pl.getCell(pr, 4).numFmt = "#,##0"; pr++;
    pl.getRow(pr).values = ["Diễn giải", "Ngày công", "Thành tiền", "Ghi chú"];
    pl.getRow(pr).font = { bold: true }; pr++;
    const incomeFirst = pr;
    const ot = [r.ot_hours_15 ? `${r.ot_hours_15}h×1,5` : "", r.ot_hours_20 ? `${r.ot_hours_20}h×2` : ""].filter(Boolean).join(" + ");
    const incomes: [string, any, string, number, string][] = [
      ["Lương thực tế", f(T("worked"), n0(r.worked_days)), "salary", n0(r.salary_by_days), `/ ${r.standard_days} công chuẩn`],
      ["Tăng ca", ot, "ot", n0(r.overtime_amount), ""],
      ["DS kỹ thuật", "", "tech", n0(r.tech_revenue), ""],
      ["DS bán hàng", "", "sales", n0(r.commission), ""],
      ["DS kinh doanh", "", "biz", n0(r.business_revenue), ""],
      ["Xăng xe", "", "travel", n0(r.travel_allowance), r.travel_note ?? ""],
      ["Thưởng", "", "bonus", n0(r.bonus), ""],
      ["Phụ cấp", "", "extra", n0(r.extra_allowance), r.extra_note ?? ""],
    ];
    for (const [label, days, key, val, note] of incomes) {
      pl.getRow(pr).values = [label, days, f(T(key), val), note]; pr++;
    }
    const grossRow = pr;
    pl.getRow(pr).values = ["Tổng lương (1)", "", f(`SUM(C${incomeFirst}:C${pr - 1})`, n0(r.gross)), ""];
    pl.getRow(pr).font = { bold: true }; pr++;
    const dedFirst = pr;
    const deds: [string, string, number, string][] = [
      ["BHXH", "bhxh", n0(r.social_insurance), ""],
      ["Tạm ứng", "adv", n0(r.advance), ""],
      ["Quỹ công đoàn", "union", n0(r.union_fee), ""],
      ["Trừ khác", "other", n0(r.other_deduction), r.other_note ?? ""],
    ];
    for (const [label, key, val, note] of deds) {
      pl.getRow(pr).values = [label, "", f(T(key), val), note]; pr++;
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
      ${line("DS kỹ thuật", "", r.tech_revenue)}
      ${line("DS bán hàng", "", r.commission)}
      ${line("DS kinh doanh", "", r.business_revenue)}
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
