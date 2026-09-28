// @ts-nocheck
/**
 * Xuất khách tiềm năng ra Excel theo ĐÚNG bố cục file cũ
 * "QUẢN LÝ KHÁCH HÀNG HCM - 2026.xlsx": mỗi showroom 1 sheet, 9 cột, dòng
 * phân cách "🌟Tháng m/yyyy🌟", dòng đã chốt tô xanh, không chốt tô đỏ.
 * exceljs import động — chỉ tải khi thực sự xuất file.
 */
import { LEAD_LOST_REASONS, leadStageOf, customerSourceLabel } from "./types";

const GREEN = "FF00FF00";
const RED = "FFFF0000";
const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export async function exportLeadsExcel(opts: {
  rows: any[];
  branchName: (id?: string | null) => string;
  staffName: (id?: string | null) => string;
  productName: (id: string) => string;
  fileName: string;
}) {
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mr.Vũ";

  const byBranch = new Map<string, any[]>();
  for (const r of opts.rows) byBranch.set(r.branch_id ?? "", [...(byBranch.get(r.branch_id ?? "") ?? []), r]);

  for (const [bid, list] of byBranch) {
    const sheetName = `SHR ${opts.branchName(bid).replace(/^Mr\.?\s*V[uũ]\s*-\s*/i, "")}`.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
    const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Ngày", "TÊN KH", "SỐ ĐT", "ĐỊA CHỈ", "QUAN TÂM HÀNG", "NGUỒN", "QUÁ TRÌNH CARE", "TÌNH TRẠNG KH", "NV TIẾP NHẬN"]);
    let month = "";
    for (const r of list.sort((a, b) => String(a.lead_date).localeCompare(String(b.lead_date)))) {
      const m = String(r.lead_date).slice(0, 7);
      if (m !== month) {
        month = m;
        const sep = ws.addRow([`🌟Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}🌟`]);
        ws.mergeCells(sep.number, 1, sep.number, 9);
        sep.getCell(1).font = { bold: true, color: { argb: "FF9C0006" } };
        sep.getCell(1).alignment = { horizontal: "center" };
        sep.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
      }
      const interest = [...(r.interest_product_ids ?? []).map(opts.productName), r.interest_note].filter(Boolean).join(", ");
      const stage = leadStageOf(r.stage).label;
      const statusText =
        r.stage === "won"
          ? `Đã chốt${r.won_order_code ? ` — đơn ${r.won_order_code}` : ""}`
          : r.stage === "lost"
            ? `Không chốt: ${LEAD_LOST_REASONS.find((x) => x.key === r.lost_reason)?.label ?? ""}${r.lost_note ? ` — ${r.lost_note}` : ""}`
            : stage;
      const staff = [opts.staffName(r.owner_id), ...(r.helper_ids ?? []).map(opts.staffName)].filter((x) => x && x !== "—").join(" + ") || r.legacy_staff || "";
      const [y, mo, d] = String(r.lead_date).split("-").map(Number);
      const row = ws.addRow([
        new Date(Date.UTC(y, mo - 1, d)),
        r.name,
        r.phone ?? "",
        r.address ?? "",
        interest,
        customerSourceLabel(r.source, r.source_note),
        r.care_text ?? "",
        statusText,
        staff,
      ]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(3).numFmt = "@";
      const fill = r.stage === "won" ? GREEN : r.stage === "lost" ? RED : null;
      row.eachCell({ includeEmpty: true }, (c: any, col: number) => {
        if (col > 9) return;
        c.border = border;
        c.alignment = { vertical: "top", wrapText: col === 7 || col === 5 || col === 8 };
        if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
    const head = ws.getRow(1);
    head.eachCell((c: any) => {
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      c.border = border;
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    [12, 26, 14, 18, 26, 18, 60, 30, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  }
  if (!byBranch.size) wb.addWorksheet("Trống").addRow(["Không có khách tiềm năng trong khoảng đã chọn"]);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.fileName;
  a.click();
  URL.revokeObjectURL(url);
}
