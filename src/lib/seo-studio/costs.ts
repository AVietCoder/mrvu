// @ts-nocheck
/**
 * Quản lý chi phí: bảng giá, ước tính trước mỗi lần dùng, sổ chi tiêu thật, ngân sách tháng và cảnh báo.
 * Chuyển nguyên từ mrvu-seo-studio/costs.py.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { SeoError, loadConfig, saveConfig, q, one, run, vnNum } from "./core";

// Giá mặc định (USD) — tra ngày 15/10/2026, chỉnh được trong Cài đặt chi phí
export const DEFAULT_PRICES: Record<string, number> = {
  dfs_volume_task: 0.09, // Google Ads Search Volume Live, tối đa 1.000 từ/lần
  dfs_serp_page: 0.002, // 1 trang 10 kết quả, Live regular
  dfs_aio_extra: 0.002, // thêm khi tải AI Overview
  dfs_paa_click: 0.00015, // mở rộng People also ask
  dfs_bl_request: 0.02, // Backlinks API mỗi lần gọi
  dfs_bl_row: 0.00003, // Backlinks API mỗi dòng
  dfs_labs_task: 0.01, // DataForSEO Labs mỗi lần gọi (gợi ý chủ đề)
  dfs_labs_item: 0.0001, // DataForSEO Labs mỗi dòng trả về
  dfs_aiv_task: 0.01, // AI Keyword Data (lượng tìm kiếm trên AI) mỗi lần gọi
  dfs_aiv_item: 0.0001, // AI Keyword Data mỗi từ
  dfs_llmm_task: 0.1, // LLM Mentions mỗi lần gọi
  dfs_llmm_row: 0.001, // LLM Mentions mỗi dòng
  dfs_llm_scrape: 0.004, // LLM Scraper (ChatGPT, Gemini) mỗi câu hỏi, chế độ Live
  dfs_llm_resp: 0.0006, // LLM Responses (Perplexity) phí nền mỗi câu
  llm_provider_est: 0.006, // ước tính phí hãng AI (Perplexity) mỗi câu trả lời
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
  tp_recent_days: 30, // cảnh báo phân tích gợi ý chủ đề trùng trong N ngày
  aiq_recent_days: 14, // cảnh báo kiểm tra AI lặp lại trong N ngày
  smap_recent_days: 7, // cảnh báo phân tích toàn website lặp lại trong N ngày
  // Thêm khi chuyển vào POS (Vercel): admin giới hạn để không vượt thông số máy chủ
  crawl_max_pages: 2000, // số trang tối đa mỗi lần quét website (Audit)
  autopost_daily_max: 10, // tổng số bài lịch tự động được viết mỗi ngày (mọi website)
};
// Lượng token ước tính cho mỗi việc dùng AI (đầu vào, đầu ra) — tiếng Việt
export const AI_TOKENS: Record<string, [number, number]> = {
  audit_ai: [5000, 1500], geo: [12000, 2000], ai_outreach: [4000, 900],
  gsc_title: [1500, 600], gsc_plan: [8000, 5000], gsc_report: [12000, 3000],
  topics: [14000, 6000],
  aiq_discover: [16000, 9000], aiq_advise: [7000, 2200], aiq_plan: [14000, 6000],
  smap_page: [6000, 1800], smap_place: [3000, 400], smap_report: [9000, 2500],
};
export const MODULE: Record<string, string> = {
  volume: "Tra cứu Volume", rank: "Rank Tracker", audit_ai: "Audit On-page", autopost_write: "Autopost",
  geo: "AI Overview", bl_refresh: "Backlink", bl_gap: "Backlink", bl_examples: "Backlink", ai_outreach: "Backlink",
  gsc_title: "Search Console", gsc_plan: "Search Console", gsc_report: "Search Console",
  topics: "Gợi ý chủ đề",
  aiq_discover: "Câu hỏi AI", aiq_check: "Câu hỏi AI", aiq_advise: "Câu hỏi AI", aiq_plan: "Câu hỏi AI",
  smap_cycle: "Bản đồ website", smap_report: "Bản đồ website", smap_page: "Bản đồ website", smap_place: "Bản đồ website",
};
export const LABEL: Record<string, string> = {
  volume: "Tra volume", rank: "Quét thứ hạng", audit_ai: "Gợi ý AI cho trang", autopost_write: "AI viết bài",
  geo: "Phân tích AI Overview", bl_refresh: "Cập nhật backlink", bl_gap: "Tìm cơ hội từ đối thủ",
  bl_examples: "Xem link mẫu của đối thủ", ai_outreach: "AI soạn tin xin link", gsc_title: "AI viết lại title",
  gsc_plan: "AI lập kế hoạch nội dung", gsc_report: "AI viết báo cáo tư vấn",
  topics: "Phân tích gợi ý chủ đề",
  aiq_discover: "Tìm câu hỏi người dùng hỏi AI", aiq_check: "Kiểm tra câu trả lời của AI",
  aiq_advise: "AI tư vấn tối ưu câu hỏi", aiq_plan: "AI lập kế hoạch GEO",
  smap_cycle: "Phân tích toàn website", smap_report: "AI báo cáo website", smap_page: "AI tư vấn một trang", smap_place: "AI tìm vị trí đặt link",
};

// Ghi mọi chi phí phát sinh trong một khối vào một thao tác cụ thể (costs.module_as của bản Python, dùng threading.local).
const actionCtx = new AsyncLocalStorage<string>();
export function moduleAs<T>(action: string, fn: () => Promise<T>): Promise<T> {
  return actionCtx.run(action, fn);
}

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
  const ov = actionCtx.getStore();
  if (ov) [m, a] = [MODULE[ov] || "DataForSEO", ov];
  else if (path.includes("/ai_optimization/")) [m, a] = ["Câu hỏi AI", "aiq_check"];
  else if (path.includes("dataforseo_labs") || path.includes("keywords_for_")) [m, a] = ["Gợi ý chủ đề", "topics"];
  else if (path.includes("keywords_data")) [m, a] = ["Tra cứu Volume", "volume"];
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
  if (!tag) tag = actionCtx.getStore() || null;
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
  } else if (action === "topics") {
    const c = Math.max(0, Math.min(3, parseInt(prm.competitors || 0) || 0));
    let data = 0;
    if ((prm.mode || "full") !== "free") {
      const seed = 2 * (p.dfs_labs_task + 150 * p.dfs_labs_item);
      const comp = c * (p.dfs_labs_task + 300 * p.dfs_labs_item);
      const mine = p.dfs_labs_task + 300 * p.dfs_labs_item;
      add("Từ khóa liên quan đến chủ đề (2 lần gọi DataForSEO)", seed);
      if (c) add(`Từ khóa đối thủ đang lên Top: ${c} đối thủ × tối đa 300 từ`, comp);
      add("Từ khóa website của bạn đang có thứ hạng", mine);
      data = seed + comp + mine;
    }
    parts.push({ label: `Đọc sitemap ${c} đối thủ + website của bạn + Search Console`, usd: 0 });
    add("Claude gom nhóm, chấm điểm, gợi ý góc viết (ước tính)", aiCost(...AI_TOKENS.topics, p));
    if (data) options.push({ id: "free_mode", checked: false, saving_usd: data, label: "Chế độ tiết kiệm: bỏ dữ liệu volume, chỉ đọc sitemap đối thủ và Search Console" });
    if (prm.recent_days !== undefined && prm.recent_days !== null && prm.recent_days < (s.tp_recent_days ?? 30)) {
      warns.push({ level: "warn", text: `Đã phân tích chủ đề này với cùng đối thủ ${prm.recent_days ? prm.recent_days + " ngày trước" : "hôm nay"}. Đối thủ ít thay đổi trong vài tuần, nên mở lại kết quả cũ ở mục Lần phân tích trước.` });
    }
    tips.push("Kết quả được lưu lại: mở lại lần phân tích cũ không tốn thêm tiền. Mỗi chủ đề phân tích 1 lần/tháng là đủ.");
  } else if (action === "aiq_discover") {
    const n = Math.max(1, parseInt(prm.topics || 1) || 1);
    const qq = parseInt(prm.serp_per_topic || 4) || 4;
    add(`Câu hỏi Google (People Also Ask, tìm kiếm liên quan): ${n} lĩnh vực × ${qq} lần tìm`, n * qq * (p.dfs_serp_page + p.dfs_aio_extra + 4 * p.dfs_paa_click));
    if (prm.labs ?? true) add(`Gợi ý từ khóa dạng câu hỏi: ${n} lĩnh vực`, n * (p.dfs_labs_task + 300 * p.dfs_labs_item));
    if (prm.mentions ?? true) add(`Câu hỏi trên AI có nhắc lĩnh vực (LLM Mentions): ${n} lần × tối đa 100 dòng`, n * (p.dfs_llmm_task + 100 * p.dfs_llmm_row));
    if (prm.ai_volume ?? true) add("Lượng tìm kiếm trên AI cho tối đa 300 câu", p.dfs_aiv_task + 300 * p.dfs_aiv_item);
    parts.push({ label: "Câu hỏi từ Search Console của bạn", usd: 0 });
    add("Claude bổ sung câu hỏi theo từng kiểu khách, gom nhóm, chấm ưu tiên (ước tính)", aiCost(...AI_TOKENS.aiq_discover, p));
    if (prm.mentions ?? true) {
      options.push({ id: "no_mentions", checked: false, saving_usd: n * (p.dfs_llmm_task + 100 * p.dfs_llmm_row), label: "Bỏ nguồn LLM Mentions (dữ liệu Việt Nam có thể ít)" });
    }
  } else if (action === "aiq_check") {
    const n = parseInt(prm.questions || 0) || 0;
    const pls = prm.platforms || ["chatgpt", "gemini", "perplexity", "google"];
    const per: Record<string, [string, number]> = {
      chatgpt: ["ChatGPT", p.dfs_llm_scrape], gemini: ["Gemini", p.dfs_llm_scrape],
      perplexity: ["Perplexity", p.dfs_llm_resp + p.llm_provider_est], google: ["Google AI Overview", p.dfs_serp_page + p.dfs_aio_extra],
    };
    for (const k of pls) if (per[k]) add(`${per[k][0]}: ${n} câu hỏi`, n * per[k][1]);
    parts.push({ label: "Dò thương hiệu, nguồn trích dẫn trong câu trả lời (tại máy)", usd: 0 });
    if (prm.recent_days !== undefined && prm.recent_days !== null && prm.recent_days < (s.aiq_recent_days ?? 14)) {
      warns.push({ level: "warn", text: `Lần kiểm tra trước ${prm.recent_days ? "mới cách " + prm.recent_days + " ngày" : "là hôm nay"}. Câu trả lời của AI thay đổi theo tuần; kiểm tra 2–4 tuần một lần là đủ để thấy xu hướng.` });
    }
    tips.push("Mỗi lần kiểm tra chỉ chọn các câu hỏi đang theo dõi (ưu tiên cao). Kết quả lưu lại để so sánh theo thời gian.");
  } else if (action === "aiq_advise") {
    const n = Math.max(1, parseInt(prm.questions || 1) || 1);
    add(`Claude tư vấn tối ưu ${n} câu hỏi (ước tính)`, n * aiCost(...AI_TOKENS.aiq_advise, p));
  } else if (action === "smap_cycle") {
    const n = parseInt(prm.pages || 300) || 300;
    const aiN = prm.ai_pages !== undefined && prm.ai_pages !== null ? parseInt(prm.ai_pages) || 0 : n;
    parts.push({ label: `Quét ${n} trang, liên kết nội bộ, chấm điểm SEO/GEO (tại máy)`, usd: 0 });
    parts.push({ label: "Search Console, GA4, kiểm tra index, tốc độ PageSpeed (Google, miễn phí)", usd: 0 });
    if (prm.labs ?? true) add("Từ khóa website đang có thứ hạng (DataForSEO Labs, tối đa 1.000 từ)", p.dfs_labs_task + 1000 * p.dfs_labs_item);
    if (aiN) add(`Claude gán từ khóa, nhóm chủ đề cho ${aiN} trang (ước tính)`, aiN * aiCost(180, 115, p));
    add("Claude viết báo cáo và việc cần làm (ước tính)", aiCost(...AI_TOKENS.smap_report, p));
    if (prm.recent_days !== undefined && prm.recent_days !== null && prm.recent_days < (s.smap_recent_days ?? 7)) {
      warns.push({ level: "warn", text: `Lần phân tích trước ${prm.recent_days ? "mới cách " + prm.recent_days + " ngày" : "là hôm nay"}. Số liệu Search Console thay đổi chậm; phân tích mỗi 2–4 tuần là hợp lý.` });
    }
    tips.push('Lần phân tích sau chỉ gán lại từ khóa cho trang mới, nên rẻ hơn nhiều. Chọn "Gán lại toàn bộ" khi đổi chiến lược từ khóa.');
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
