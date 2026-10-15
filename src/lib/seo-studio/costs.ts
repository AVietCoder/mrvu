// @ts-nocheck
/**
 * Quản lý chi phí: bảng giá, ước tính trước mỗi lần dùng, sổ chi tiêu thật, ngân sách tháng và cảnh báo.
 * Chuyển nguyên từ mrvu-seo-studio/costs.py.
 */
import { SeoError, loadConfig, saveConfig, q, one, run, vnNum } from "./core";

// Giá mặc định (USD) — tra ngày 15/10/2026, chỉnh được trong Cài đặt chi phí
export const DEFAULT_PRICES: Record<string, number> = {
  dfs_volume_task: 0.09, // Google Ads Search Volume Live, tối đa 1.000 từ/lần
  dfs_serp_page: 0.002, // 1 trang 10 kết quả, Live regular
  dfs_aio_extra: 0.002, // thêm khi tải AI Overview
  dfs_paa_click: 0.00015, // mở rộng People also ask
  dfs_bl_request: 0.02, // Backlinks API mỗi lần gọi
  dfs_bl_row: 0.00003, // Backlinks API mỗi dòng
  claude_in: 2.0, // USD / 1 triệu token đầu vào (Claude Sonnet 5.5)
  claude_out: 10.0, // USD / 1 triệu token đầu ra
};
export const DEFAULT_BUDGET: Record<string, any> = {
  budget_month_vnd: 300000, // ngân sách tháng
  confirm_over_vnd: 5000, // một lần dùng từ mức này trở lên thì hỏi trước
  warn_pct: 80, // cảnh báo khi đã dùng % ngân sách
  auto_stop: true, // dừng lịch Autopost khi vượt ngân sách
  rank_recent_days: 6, // bỏ qua từ khóa vừa quét trong N ngày
  geo_recent_days: 7, // cảnh báo phân tích GEO trùng trong N ngày
  bl_recent_days: 7, // cảnh báo cập nhật backlink dày hơn N ngày
  // Thêm khi chuyển vào POS (Vercel): admin giới hạn để không vượt thông số máy chủ
  crawl_max_pages: 2000, // số trang tối đa mỗi lần quét website (Audit)
  autopost_daily_max: 10, // tổng số bài lịch tự động được viết mỗi ngày (mọi website)
};
// Lượng token ước tính cho mỗi việc dùng AI (đầu vào, đầu ra) — tiếng Việt
export const AI_TOKENS: Record<string, [number, number]> = {
  audit_ai: [5000, 1500], geo: [12000, 2000], ai_outreach: [4000, 900],
  gsc_title: [1500, 600], gsc_plan: [8000, 5000], gsc_report: [12000, 3000],
};
export const MODULE: Record<string, string> = {
  volume: "Tra cứu Volume", rank: "Rank Tracker", audit_ai: "Audit On-page", autopost_write: "Autopost",
  geo: "AI Overview", bl_refresh: "Backlink", bl_gap: "Backlink", bl_examples: "Backlink", ai_outreach: "Backlink",
  gsc_title: "Search Console", gsc_plan: "Search Console", gsc_report: "Search Console",
};
export const LABEL: Record<string, string> = {
  volume: "Tra volume", rank: "Quét thứ hạng", audit_ai: "Gợi ý AI cho trang", autopost_write: "AI viết bài",
  geo: "Phân tích AI Overview", bl_refresh: "Cập nhật backlink", bl_gap: "Tìm cơ hội từ đối thủ",
  bl_examples: "Xem link mẫu của đối thủ", ai_outreach: "AI soạn tin xin link", gsc_title: "AI viết lại title",
  gsc_plan: "AI lập kế hoạch nội dung", gsc_report: "AI viết báo cáo tư vấn",
};

export async function settings(cfg?: any): Promise<[any, any, number]> {
  cfg = cfg || (await loadConfig());
  const s = { ...DEFAULT_BUDGET, ...(cfg.cost_budget || {}) };
  const p = { ...DEFAULT_PRICES, ...(cfg.cost_prices || {}) };
  const rate = Number(cfg.usd_vnd || 26000);
  return [s, p, rate];
}

/** Tháng theo giờ Việt Nam (bản gốc dùng giờ máy chủ; máy chủ Vercel chạy giờ UTC). */
export function monthKey(d = new Date()): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
}

/** Ghi chi phí thật. An toàn khi lỗi — không làm hỏng việc chính. */
export async function record(module: string, action: string, usd: number, detail = "") {
  if (!usd) return;
  try {
    const at = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19) + "+07:00";
    await run("INSERT INTO seo_spend(at, month, module, action, usd, detail) VALUES (?,?,?,?,?,?)",
      [at, monthKey(), module, action, Number(usd), String(detail).slice(0, 200)]);
  } catch (e: any) {
    console.error("[chi phí] không ghi được:", e?.message);
  }
}

export async function recordDfs(path: string, cost: number) {
  let m: string, a: string;
  if (path.includes("keywords_data")) [m, a] = ["Tra cứu Volume", "volume"];
  else if (path.includes("/serp/") && path.includes("advanced")) [m, a] = ["AI Overview", "geo"];
  else if (path.includes("/serp/")) [m, a] = ["Rank Tracker", "rank"];
  else if (path.includes("/backlinks/")) [m, a] = ["Backlink", "backlinks"];
  else [m, a] = ["DataForSEO", "khác"];
  await record(m, a, cost, path.split("/v3/").pop());
}

export function claudeUsd(usage: any, p: any) {
  return ((usage?.input_tokens || 0) * p.claude_in + (usage?.output_tokens || 0) * p.claude_out) / 1e6;
}

export async function recordClaude(tag: string | null, usage: any) {
  const [, p] = await settings();
  await record(MODULE[tag || ""] || "AI", tag || "ai", claudeUsd(usage, p), `${usage?.input_tokens || 0}+${usage?.output_tokens || 0} token`);
}

export async function monthSpent(month?: string): Promise<number> {
  const r = await one("SELECT COALESCE(SUM(usd),0) s FROM seo_spend WHERE month=?", [month || monthKey()]);
  return Number(r?.s || 0);
}

export async function overBudget(): Promise<boolean> {
  const [s, , rate] = await settings();
  return (await monthSpent()) * rate >= s.budget_month_vnd;
}

// ---------------------------------------------------------------- ước tính
function aiCost(i: number, o: number, p: any) {
  return (i * p.claude_in + o * p.claude_out) / 1e6;
}
const fmtPct0 = (x: number) => String(Math.round(x));

export async function estimate(action: string, prm: any = {}) {
  const [s, p, rate] = await settings();
  const parts: any[] = [], warns: any[] = [], tips: string[] = [], options: any[] = [];
  let usd = 0;
  const add = (label: string, v: number) => {
    usd += v;
    parts.push({ label, usd: v });
  };

  if (action === "volume") {
    const n = parseInt(prm.count || 0) || 0;
    const tasks = Math.max(1, Math.ceil(n / 1000));
    add(`${tasks} lần tra × ${p.dfs_volume_task} USD (tính theo lần, tối đa 1.000 từ/lần)`, tasks * p.dfs_volume_task);
    if (n && n < 200) tips.push(`Giá tính theo lần tra chứ không theo số từ: tra ${n} từ hay 1.000 từ đều tốn như nhau. Nên gom thêm từ khóa rồi tra một lần.`);
    if (prm.dupes) warns.push({ level: "warn", text: `${prm.dupes}/${n} từ đã tra trong 30 ngày qua, có sẵn trong Lịch sử kiểm tra.` });
  } else if (action === "rank") {
    const n = parseInt(prm.count || 0) || 0;
    const depth = parseInt(prm.depth || 10) || 10;
    const pages = Math.ceil(depth / 10);
    const per = pages * p.dfs_serp_page;
    const eng = 1;
    add(`${n} từ × ${pages} trang kết quả Google × ${p.dfs_serp_page} USD`, n * per);
    const recent = parseInt(prm.recent || 0) || 0;
    if (recent) options.push({ id: "skipRecent", checked: true, saving_usd: recent * eng * per, label: `Bỏ qua ${recent} từ đã quét trong ${s.rank_recent_days} ngày gần đây` });
    if (depth > 10) tips.push(`Quét Top ${depth} tốn gấp ${pages} lần Top 10. Chỉ nên quét sâu với từ còn xa top; từ đã ở top 10 thì quét Top 10.`);
  } else if (action === "geo") {
    add("Kết quả Google + AI Overview (DataForSEO)", p.dfs_serp_page + p.dfs_aio_extra + p.dfs_paa_click);
    if (prm.ai === undefined || prm.ai) add("Claude so sánh và viết đề xuất (ước tính)", aiCost(...AI_TOKENS.geo, p));
    if (prm.recent_days !== undefined && prm.recent_days !== null && prm.recent_days < s.geo_recent_days) {
      warns.push({ level: "warn", text: `URL và từ khóa này vừa phân tích ${prm.recent_days ? prm.recent_days + " ngày trước" : "hôm nay"}. AI Overview ít thay đổi trong vài ngày, nên mở lại báo cáo cũ trong Lịch sử.` });
    }
    tips.push("Từ khóa mua hàng (giá, mua, tên sản phẩm) hiếm khi có AI Overview; khi đó công cụ không gọi AI nên chỉ tốn phần dữ liệu Google.");
  } else if (action === "autopost_write") {
    const w = parseInt(prm.words || 1200) || 1200;
    const out = Math.trunc(w * 3.2) + 900;
    add(`Claude lập dàn ý + viết bài ~${vnNum(w)} chữ (ước tính)`, aiCost(3500 + 2000, out, p));
    if (prm.images === "pexels") parts.push({ label: "Ảnh Pexels", usd: 0 });
    if (w >= 2500) tips.push("Bài 2.500 chữ tốn gấp đôi bài 1.200 chữ. Chỉ viết dài cho chủ đề thật sự cần.");
  } else if (action === "bl_refresh") {
    add("4 lần gọi Backlinks API", 4 * p.dfs_bl_request);
    add("Khoảng 2.000 dòng dữ liệu", 2200 * p.dfs_bl_row);
    if (prm.days_since !== undefined && prm.days_since !== null && prm.days_since < s.bl_recent_days) {
      warns.push({ level: "warn", text: `Lần cập nhật trước ${prm.days_since ? "mới cách " + prm.days_since + " ngày" : "là hôm nay"}. Backlink thay đổi chậm; cập nhật mỗi tuần hoặc mỗi tháng là đủ.` });
    }
    tips.push("Muốn miễn phí: nhập file CSV từ Google Search Console thay vì cập nhật qua API.");
  } else if (action === "bl_gap") {
    const c = parseInt(prm.competitors || 1) || 1;
    add(`${c} đối thủ × (1 lần gọi + tối đa 1.000 dòng)`, c * (p.dfs_bl_request + 1000 * p.dfs_bl_row));
    if (prm.no_snapshot) add("Lấy danh sách link của bạn", p.dfs_bl_request + 1000 * p.dfs_bl_row);
  } else if (action === "bl_examples") {
    const c = Math.min(3, parseInt(prm.competitors || 1) || 1);
    add(`${c} lần tìm link mẫu`, c * (p.dfs_bl_request + 5 * p.dfs_bl_row));
  } else if (AI_TOKENS[action]) {
    add(LABEL[action] + " (ước tính)", aiCost(...AI_TOKENS[action], p));
  } else {
    throw new SeoError("Không rõ thao tác cần ước tính.");
  }

  const spent = await monthSpent();
  const budgetUsd = s.budget_month_vnd / rate;
  const after = spent + usd;
  const pctAfter = budgetUsd ? (after / budgetUsd) * 100 : 0;
  const vnd = usd * rate;
  if (after > budgetUsd) {
    warns.unshift({ level: "bad", text: `Lần này sẽ làm vượt ngân sách tháng (${vnNum(Math.round(spent * rate))} đ đã dùng / ${vnNum(s.budget_month_vnd)} đ).` });
  } else if (pctAfter >= s.warn_pct) {
    warns.unshift({ level: "warn", text: `Sau lần này đã dùng ${fmtPct0(pctAfter)}% ngân sách tháng.` });
  }
  if (vnd >= s.confirm_over_vnd * 4) {
    warns.unshift({ level: "bad", text: `Chi phí lần này lớn: gấp ${fmtPct0(vnd / s.confirm_over_vnd)} lần ngưỡng hỏi trước bạn đặt.` });
  }
  const need = vnd >= s.confirm_over_vnd || warns.some((w) => w.level === "bad" || w.level === "warn") || options.length > 0;
  return {
    action, label: LABEL[action] || action, usd, vnd, parts, warnings: warns, tips, options, need_confirm: need, rate,
    month: { spent_vnd: spent * rate, budget_vnd: s.budget_month_vnd, after_vnd: after * rate, pct_after: pctAfter },
  };
}

export async function summary() {
  const [s, p, rate] = await settings();
  const mk = monthKey();
  const by = await q("SELECT module, COUNT(*) n, SUM(usd) usd FROM seo_spend WHERE month=? GROUP BY module ORDER BY usd DESC", [mk]);
  const recent = await q("SELECT at, module, action, usd, detail FROM seo_spend ORDER BY id DESC LIMIT 30");
  const months = await q("SELECT month, SUM(usd) usd FROM seo_spend GROUP BY month ORDER BY month DESC LIMIT 6");
  const spent = by.reduce((a: number, x: any) => a + Number(x.usd || 0), 0);
  const vn = new Date(Date.now() + 7 * 3600_000);
  const day = vn.getUTCDate();
  const dim = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    month: mk, spent_usd: spent, spent_vnd: spent * rate, budget_vnd: s.budget_month_vnd,
    pct: s.budget_month_vnd ? ((spent * rate) / s.budget_month_vnd) * 100 : 0,
    forecast_vnd: ((spent * rate) / Math.max(day, 1)) * dim,
    by_module: by.map((x: any) => ({ ...x, vnd: x.usd * rate })),
    recent: recent.map((x: any) => ({ ...x, vnd: x.usd * rate, label: LABEL[x.action] || x.action })),
    months: months.map((x: any) => ({ ...x, vnd: x.usd * rate })),
    settings: s, prices: p, rate, over: spent * rate >= s.budget_month_vnd,
  };
}

export async function saveSettings(b: any) {
  const [s, p] = await settings();
  for (const k of Object.keys(DEFAULT_BUDGET)) {
    if (k in b && b[k] !== null && b[k] !== "" && b[k] !== undefined) {
      s[k] = typeof DEFAULT_BUDGET[k] === "boolean" ? Boolean(b[k]) : Number.isInteger(DEFAULT_BUDGET[k]) ? Math.trunc(Number(b[k])) : Number(b[k]);
      if (typeof s[k] === "number" && Number.isNaN(s[k])) throw new SeoError(`Giá trị không hợp lệ: ${k}`);
    }
  }
  for (const k of Object.keys(DEFAULT_PRICES)) {
    const v = (b.prices || {})[k];
    if (v !== undefined && v !== null && v !== "") {
      p[k] = Number(v);
      if (Number.isNaN(p[k])) throw new SeoError(`Giá trị không hợp lệ: ${k}`);
    }
  }
  const up: any = { cost_budget: s, cost_prices: p };
  if (b.usd_vnd) up.usd_vnd = Number(b.usd_vnd);
  await saveConfig(up);
  return await summary();
}

export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3);
  try {
    if (seg.join("/") === "summary") return h.send_json(await summary());
    if (method === "POST" && seg.join("/") === "estimate") {
      const b = await h.read_json();
      return h.send_json(await estimate(b.action, b.params || {}));
    }
    if (method === "POST" && seg.join("/") === "settings") return h.send_json(await saveSettings(await h.read_json()));
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 400);
    throw e;
  }
}
