// Nhập file "🌷QUẢN LÝ KHÁCH HÀNG HCM - 2026 🍀.xlsx" vào bảng customer_leads (migration v22).
//
//   node scripts/import-leads-2026.mjs            → CHẠY THỬ: chỉ in báo cáo quy đổi, không ghi gì
//   node scripts/import-leads-2026.mjs --commit   → ghi thật
//
// An toàn khi chạy lại: id lead / nhật ký sinh cố định từ vị trí dòng (import_ref)
// và ghi kiểu "bỏ qua nếu đã có" → không nhân đôi, không đè những gì nhân viên
// đã sửa trên app sau lần nhập trước.
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Showroom theo tên sheet (đã chốt với anh) ──
const SHEET_BRANCH = [
  [/T3/i, /Số 2 TTT/i, "T3"],
  [/ĐBP/i, /451 ĐBP/i, "DBP"],
  [/UT/i, /84\/8 TĐX/i, "UT"],
];

const txt = (v) =>
  v && typeof v === "object"
    ? String(v.richText ? v.richText.map((t) => t.text).join("") : v.text ?? v.result ?? "")
    : String(v ?? "");
const fold = (s) => String(s ?? "").toLowerCase().normalize("NFC").trim();
const digits = (s) => String(s ?? "").replace(/\D/g, "");
function normPhone(raw) {
  // "_0903855719" (gạch dưới để Excel giữ số 0 đầu), "đã add zalo - 0918923366":
  // lấy số khi ô chứa ĐÚNG MỘT số điện thoại; nhiều số / chỉ có chữ → bỏ.
  const s0 = String(raw ?? "").replace(/[​-‏‪-‮﻿]/g, "").trim().replace(/^_+/, "");
  const found = s0.replace(/[\s.]/g, "").match(/(?:\+?84|0)\d{9}/g);
  const s = /^[\d\s.()+-]+$/.test(s0) ? s0 : found && found.length === 1 ? found[0] : "";
  if (!s) return null;
  let d = digits(s);
  if (d.startsWith("84") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9) d = "0" + d;
  return d.length >= 10 && d.length <= 11 ? d : null;
}

// ── Nguồn: thứ tự kiểm tra quan trọng ("khách zalo cũ" → khách cũ, "gr hẹn ra shr" → group) ──
function mapSource(raw) {
  const s = fold(raw);
  if (!s) return { source: null, note: null };
  if (/cũ|mua lại/.test(s)) return { source: "khach_cu", note: null };
  if (/chuyển|đưa|nhờ|báo qua|giới thiệu|gt\b/.test(s)) return { source: "noi_bo", note: raw.trim() };
  if (/web/.test(s)) return { source: "web", note: null };
  if (/tiktok/.test(s)) return { source: "tiktok", note: null };
  if (/google|gg\b/.test(s)) return { source: "google", note: null };
  if (/page|fanpage/.test(s)) return { source: "fb_page", note: null };
  if (/(^|\W)(gr|group|nhóm)(\W|$)/.test(s)) return { source: "fb_group", note: null };
  if (/zalo/.test(s)) return { source: "zalo", note: null };
  if (/shr|showroom|shroom|sh room/.test(s)) return { source: "showroom", note: null };
  return { source: "khac", note: raw.trim() };
}

// ── Trạng thái theo MÀU dòng + chữ ──
const GREEN = "FF00FF00", RED = new Set(["FFFF0000", "FFCC0000"]);
function mapStage(row, care, status) {
  const fills = [];
  for (let c = 1; c <= 9; c++) fills.push(row.getCell(c).fill?.fgColor?.argb);
  const t = fold(`${care} ${status}`);
  // Màu xanh là căn cứ chính. Chữ chỉ tính khi cột TÌNH TRẠNG bắt đầu bằng
  // "đã chốt" — vì "chưa chốt", "đợi khách cọc", "đã chốt bên anh Thi"… trong
  // cột care KHÔNG phải là mình chốt được đơn.
  if (fills.includes(GREEN) || /^(kh |khách )?đã chốt/.test(fold(status))) return "won";
  if (fills.some((f) => RED.has(f))) return "lost";
  if (/hẹn (ra|qua|đến) (shr|showroom|sh)/.test(t)) return "appointment";
  if (/báo giá|(^|\W)bg(\W|$)/.test(t)) return "quoted";
  return "consulting";
}
function mapLostReason(care, status) {
  const t = fold(`${care} ${status}`);
  if (/giá|mắc|đắt/.test(t)) return "gia_cao";
  if (/chưa xây|chưa hoàn thiện|nhà chưa|đang xây/.test(t)) return "chua_xay";
  if (/(không|ko|k) (phản hồi|nghe|trả lời|bắt máy)|chưa phản hồi/.test(t)) return "ko_phan_hoi";
  if (/(mua|lấy) (ở |chỗ |bên |hãng )?(khác|nơi khác)|hãng khác/.test(t)) return "mua_noi_khac";
  return "khac";
}

const STAFF_FIX = { traam: "trâm", "c loan": "loan", "nhung nhung": "nhung" };

(async () => {
  const file = fs.readdirSync(ROOT).find((x) => x.includes("HCM - 2026") && x.endsWith(".xlsx"));
  if (!file) throw new Error("Không thấy file QUẢN LÝ KHÁCH HÀNG HCM - 2026 trong thư mục dự án");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(ROOT, file));

  const [{ data: branches }, { data: users }] = await Promise.all([
    db.from("branches").select("id, name"),
    db.from("users").select("id, full_name, active"),
  ]);
  const { data: ub } = await db.from("user_branches").select("user_id, branch_id");
  const userBranches = new Map();
  for (const r of ub ?? []) userBranches.set(r.user_id, [...(userBranches.get(r.user_id) ?? []), r.branch_id]);

  // Khách hàng theo SĐT (chuẩn hoá) — 17k khách, tải theo trang.
  const custByPhone = new Map();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("customers").select("id, phone").range(off, off + 999);
    for (const c of data ?? []) { const p = normPhone(c.phone); if (p && !custByPhone.has(p)) custByPhone.set(p, c.id); }
    if ((data ?? []).length < 1000) break;
  }

  function matchStaff(token, branchId) {
    const t = STAFF_FIX[token] ?? token;
    const cands = (users ?? []).filter((u) => u.active !== false && fold(u.full_name).split(/[\s.\-]+/).includes(t));
    if (cands.length <= 1) return cands[0] ?? null;
    return cands.find((u) => (userBranches.get(u.id) ?? []).includes(branchId)) ?? cands[0];
  }

  const leads = [];
  const acts = [];
  const unmatchedStaff = new Map();
  const sourceMap = new Map();
  const stats = { sheets: {}, stages: {}, linkedCustomer: 0, wonWithOrder: 0, noPhone: 0 };

  for (const ws of wb.worksheets) {
    const conf = SHEET_BRANCH.find(([re]) => re.test(ws.name));
    if (!conf) { console.log("Bỏ qua sheet lạ:", ws.name); continue; }
    const branch = (branches ?? []).find((b) => conf[1].test(b.name));
    if (!branch) throw new Error(`Không thấy chi nhánh cho sheet ${ws.name}`);
    stats.sheets[ws.name.trim()] = 0;

    ws.eachRow((row, r) => {
      const d = row.getCell(1).value;
      const name = txt(row.getCell(2).value).trim();
      if (!(d instanceof Date) || !name || /nghỉ|không có khách|^off$/i.test(name)) return;
      stats.sheets[ws.name.trim()]++;
      const leadDate = d.toISOString().slice(0, 10);
      const rawPhone = txt(row.getCell(3).value).trim();
      const phone = normPhone(rawPhone);
      if (!phone) stats.noPhone++;
      const care = txt(row.getCell(7).value).trim();
      const status = txt(row.getCell(8).value).trim();
      const rawSource = txt(row.getCell(6).value).trim();
      const src = mapSource(rawSource);
      sourceMap.set(`${fold(rawSource) || "(trống)"} → ${src.source ?? "(trống)"}`, (sourceMap.get(`${fold(rawSource) || "(trống)"} → ${src.source ?? "(trống)"}`) ?? 0) + 1);

      const rawStaff = txt(row.getCell(9).value).trim();
      const tokens = fold(rawStaff).split(/\s*(?:\+|,|\/|&|\svà\s)\s*/).map((x) => x.trim()).filter(Boolean);
      const matched = [];
      let unmatched = false;
      for (const tk of tokens) {
        const u = matchStaff(tk, branch.id);
        if (u) matched.push(u.id);
        else { unmatched = true; unmatchedStaff.set(tk, (unmatchedStaff.get(tk) ?? 0) + 1); }
      }
      const stage = mapStage(row, care, status);
      stats.stages[stage] = (stats.stages[stage] ?? 0) + 1;
      const customerId = phone ? custByPhone.get(phone) ?? null : null;
      if (customerId) stats.linkedCustomer++;

      const ref = `${conf[2]}!r${r}`;
      const id = `imp-${ref.replace(/[^A-Za-z0-9]/g, "-")}`;
      leads.push({
        id, import_ref: ref, branch_id: branch.id, lead_date: leadDate, name,
        phone, address: txt(row.getCell(4).value).trim() || null,
        interest_note: txt(row.getCell(5).value).trim() || null,
        source: src.source, source_note: src.source === "khac" || src.source === "noi_bo" ? src.note : null,
        stage,
        lost_reason: stage === "lost" ? mapLostReason(care, status) : null,
        lost_note: stage === "lost" ? (status || care || null) : null,
        owner_id: matched[0] ?? null,
        helper_ids: [...new Set(matched.slice(1))].filter((h) => h !== matched[0]),
        customer_id: customerId,
        legacy_staff: unmatched || !matched.length ? rawStaff || null : null,
        legacy_status: status || null,
        won_auto: false,
        won_at: stage === "won" ? `${leadDate}T12:00:00+07:00` : null,
        created_at: `${leadDate}T12:00:00+07:00`,
        updated_at: new Date().toISOString(),
        last_activity_at: care || status ? `${leadDate}T12:00:00+07:00` : null,
      });
      const noteParts = [care, status && status !== care ? `Tình trạng: ${status}` : "", !phone && rawPhone ? `SĐT ghi: ${rawPhone}` : "", `(Nhập từ Excel — NV: ${rawStaff || "—"})`].filter(Boolean);
      acts.push({ id: `${id}-a1`, lead_id: id, at: `${leadDate}T12:00:00+07:00`, user_id: matched[0] ?? null, kind: "note", content: noteParts.join("\n") });
    });
  }

  // Lead đã chốt: nối đơn (khách cùng SĐT, đơn từ 7 ngày trước đến 180 ngày sau ngày lead).
  const wonLinked = leads.filter((l) => l.stage === "won" && l.customer_id);
  const custIds = [...new Set(wonLinked.map((l) => l.customer_id))];
  const ordersByCust = new Map();
  for (let i = 0; i < custIds.length; i += 200) {
    const { data } = await db.from("orders").select("id, customer_id, total, created_at, completed_at, status").in("customer_id", custIds.slice(i, i + 200)).in("status", ["completed", "reserved"]);
    for (const o of data ?? []) ordersByCust.set(o.customer_id, [...(ordersByCust.get(o.customer_id) ?? []), o]);
  }
  for (const l of wonLinked) {
    const t0 = Date.parse(`${l.lead_date}T00:00:00+07:00`);
    const hit = (ordersByCust.get(l.customer_id) ?? [])
      .filter((o) => { const t = Date.parse(o.created_at); return t >= t0 - 7 * 86400e3 && t <= t0 + 180 * 86400e3; })
      .sort((a, b) => Math.abs(Date.parse(a.created_at) - t0) - Math.abs(Date.parse(b.created_at) - t0))[0];
    if (hit) {
      l.won_order_id = hit.id;
      l.won_amount = Number(hit.total) || 0;
      l.won_at = hit.completed_at || hit.created_at;
      stats.wonWithOrder++;
    }
  }

  console.log(`\nFILE: ${file}`);
  console.log("Lead theo sheet:", stats.sheets, "→ tổng", leads.length);
  console.log("Trạng thái:", stats.stages);
  console.log("Nối được khách có sẵn (theo SĐT):", stats.linkedCustomer, "| không có SĐT hợp lệ:", stats.noPhone);
  console.log("Đã chốt nối được đơn hàng:", stats.wonWithOrder, "/", leads.filter((l) => l.stage === "won").length);
  console.log("Lý do không chốt:", leads.filter((l) => l.stage === "lost").reduce((m, l) => ((m[l.lost_reason] = (m[l.lost_reason] ?? 0) + 1), m), {}));
  const owners = leads.reduce((m, l) => { const u = (users ?? []).find((x) => x.id === l.owner_id); const k = u ? u.full_name : "(chưa gán)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log("Người phụ trách:", owners);
  console.log("Tên NV KHÔNG khớp tài khoản (giữ nguyên chữ ở legacy_staff):", Object.fromEntries(unmatchedStaff));
  console.log("\nQuy đổi nguồn (chữ gốc → mã):");
  for (const [k, n] of [...sourceMap.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  if (!COMMIT) {
    console.log("\n(CHẠY THỬ — chưa ghi gì. Thêm --commit để ghi thật.)");
    return;
  }
  let inserted = 0;
  for (let i = 0; i < leads.length; i += 200) {
    const { data, error } = await db.from("customer_leads").upsert(leads.slice(i, i + 200), { onConflict: "import_ref", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    inserted += (data ?? []).length;
  }
  for (let i = 0; i < acts.length; i += 200) {
    const { error } = await db.from("lead_activities").upsert(acts.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { count } = await db.from("customer_leads").select("id", { count: "exact", head: true }).not("import_ref", "is", null);
  console.log(`\nĐÃ GHI: ${inserted} lead mới lần này | tổng lead nhập từ Excel trong DB: ${count}`);
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
