// @ts-nocheck
/**
 * Câu hỏi AI (GEO nâng cao): tìm các câu hỏi người dùng hay hỏi Google/AI trong lĩnh vực kinh doanh, kiểm tra
 * ChatGPT, Gemini, Perplexity và Google AI Overview có nhắc / trích dẫn website của bạn không, rồi tư vấn
 * tối ưu từng câu hỏi (trang nào trả lời, đoạn trả lời mẫu, FAQ + schema, nguồn cần xuất hiện) và theo dõi hằng tháng.
 * Chuyển từ mrvu-seo-studio/aiq.py (bản 30/10/2026). Khác bản gốc vì chạy trên Vercel:
 *   - Tìm câu hỏi, kiểm tra AI, tư vấn là tác vụ nhiều bước (seo_jobs); mỗi lần giao diện hỏi tiến độ chạy một bước.
 *   - "Đang kiểm tra" (RUNNING của bản gốc) đọc từ seo_jobs thay vì biến trong bộ nhớ.
 *   - Lịch kiểm tra định kỳ chạy qua pg_cron (/seo-studio/cron → app.ts periodicTick), không phải luồng nền.
 *
 * Nguồn câu hỏi: Search Console (miễn phí), People Also Ask + tìm kiếm liên quan của Google, gợi ý từ khóa dạng câu hỏi
 * (DataForSEO Labs), LLM Mentions (câu hỏi trên AI có nhắc lĩnh vực), Claude bổ sung theo từng kiểu khách.
 * Kiểm tra AI: DataForSEO AI Optimization (LLM Scraper cho ChatGPT/Gemini, LLM Responses cho Perplexity) và SERP Google.
 */
import { SeoError, extractJson, jl, loadConfig, now, one, pool, pyRound, q, run, squash, tx, uniq } from "./core";
import { claude, dfsPost } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { moduleAs, overBudget } from "./costs";
import { fetchSerp, readPage } from "./geo";
import { STOP, bigrams, fold, hostOf, seedKeywords, slugText, spentTotal } from "./topics";
import { decode, fetchPage } from "./web";

export const PLATFORMS: Record<string, { label: string; path: string | null }> = {
  chatgpt: { label: "ChatGPT", path: "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced" },
  gemini: { label: "Gemini", path: "/v3/ai_optimization/gemini/llm_scraper/live/advanced" },
  perplexity: { label: "Perplexity", path: "/v3/ai_optimization/perplexity/llm_responses/live" },
  google: { label: "Google AI Overview", path: null },
};
const QWORDS = /\?|(?<![\p{L}\p{N}_])(là gì|la gi|như thế nào|thế nào|có nên|có tốt|có tốn|có bền|có êm|có mát|bao nhiêu|tại sao|vì sao|cách|khi nào|ở đâu|loại nào|hãng nào|nên mua|nên chọn|so sánh|khác nhau|có phải|bao lâu|ra sao|kinh nghiệm|hướng dẫn|review|đánh giá|tốt nhất|top|giá|mấy|được không|hay không|hay là)(?![\p{L}\p{N}_])/iu;
const AI_BOTS: [string, string][] = [["GPTBot", "OpenAI huấn luyện mô hình"], ["OAI-SearchBot", "ChatGPT tìm kiếm"], ["ChatGPT-User", "ChatGPT mở link khi trả lời"],
  ["PerplexityBot", "Perplexity"], ["Google-Extended", "Gemini / AI của Google"], ["ClaudeBot", "Claude"],
  ["Bingbot", "Bing (ChatGPT dùng chỉ mục Bing)"], ["Googlebot", "Google Search / AI Overview"]];
export const INTENT_VI: Record<string, string> = { buy: "Chọn mua", compare: "So sánh", price: "Giá", howto: "Hướng dẫn / lắp đặt",
  problem: "Sự cố / sửa chữa", info: "Tìm hiểu", local: "Mua ở đâu" };
const fatal = (e: any) => /hết tiền|Sai tài khoản/.test(String(e?.message || e));
const intersects = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

// ---------------------------------------------------------------- dự án
export async function getProject(pid: any) {
  const r = await one("SELECT * FROM seo_aiq_projects WHERE id=?", [pid]);
  if (!r) return null;
  const p: any = { ...r };
  for (const k of ["brands", "competitors", "topics", "platforms"]) {
    p[k] = jl(p[k + "_json"], []);
    delete p[k + "_json"];
  }
  for (const k of ["tech", "plan", "insights"]) {
    p[k] = jl(p[k + "_json"], null);
    delete p[k + "_json"];
  }
  return p;
}

async function saveProject(b: any) {
  const domain = hostOf(b.domain);
  if (!domain.includes(".")) throw new SeoError("Nhập tên miền website, ví dụ mrvu.vn");
  const tps = (b.topics || []).filter((t: any) => String(t).trim()).map(squash).slice(0, 10);
  if (!tps.length) throw new SeoError("Nhập ít nhất một lĩnh vực, ví dụ: quạt trần");
  let brands = (b.brands || []).filter((t: any) => String(t).trim()).map(squash).slice(0, 10);
  if (!brands.length) brands = [domain];
  const comps: any[] = [];
  for (let c of (b.competitors || []).slice(0, 10)) {
    if (typeof c === "string") c = { name: c };
    let name = squash(c.name || "");
    const dom = c.domain ? hostOf(c.domain) : "";
    if (!name && dom) name = dom;
    if (name) comps.push({ name, domain: dom.includes(".") ? dom : "" });
  }
  let pls = (b.platforms || Object.keys(PLATFORMS)).filter((x: string) => x in PLATFORMS);
  if (!pls.length) pls = Object.keys(PLATFORMS);
  const vals = [b.name || domain, domain, JSON.stringify(brands), JSON.stringify(comps), JSON.stringify(tps), parseInt(b.location) || 2704,
    b.language || "vi", JSON.stringify(pls), b.auto_check ? 1 : 0, Math.max(7, parseInt(b.auto_days) || 30),
    Math.max(5, Math.min(100, parseInt(b.auto_top) || 30)), b.site_id ? parseInt(b.site_id) : null];
  let pid: number;
  if (b.id) {
    pid = parseInt(b.id);
    await run(`UPDATE seo_aiq_projects SET name=?, domain=?, brands_json=?, competitors_json=?, topics_json=?, location=?, language=?,
               platforms_json=?, auto_check=?, auto_days=?, auto_top=?, site_id=? WHERE id=?`, [...vals, pid]);
  } else {
    pid = (await run(`INSERT INTO seo_aiq_projects(name, domain, brands_json, competitors_json, topics_json, location, language,
      platforms_json, auto_check, auto_days, auto_top, site_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, [...vals, now()])).rows[0].id;
  }
  return await getProject(pid);
}

async function setProject(pid: any, kv: Record<string, any>) {
  for (const [k, v] of Object.entries(kv)) {
    await run(`UPDATE seo_aiq_projects SET ${k}=? WHERE id=?`, [k.endsWith("_json") ? JSON.stringify(v) : v, pid]);
  }
}

/** Dự án / website đang được kiểm tra (thay RUNNING của bản gốc). Tác vụ không được hỏi tiến độ quá 10 phút coi như đã dừng. */
async function runningCheck(pid: any) {
  return Boolean(await one(`SELECT 1 FROM seo_jobs WHERE kind='aiq_check' AND status='running' AND (state->>'pid')::bigint=?
                            AND updated_at > now() - interval '10 minutes' LIMIT 1`, [pid]));
}

// ---------------------------------------------------------------- trang của website
async function myPages(domain: string) {
  const rows = await q("SELECT p.url, p.type FROM seo_audit_pages p JOIN seo_audit_sites s ON s.id=p.site_id WHERE s.domain=?", [domain]);
  const posts = await q("SELECT remote_url url, title FROM seo_ap_posts WHERE remote_url LIKE ?", [`%${domain}%`]);
  return [
    ...rows.map((r: any) => ({ url: r.url, type: r.type, text: slugText(r.url) || r.url })),
    ...posts.map((r: any) => ({ url: r.url, type: "post", text: r.title })),
  ];
}

/** Trang khớp câu hỏi nhất; bỏ qua các cặp âm tiết của lĩnh vực chung (vd. 'quat tran') vì trang nào cũng có. */
function matchPages(question: string, pages: any[], n = 5, ignore: string[] = []) {
  const igB = new Set<string>();
  for (const t of ignore) for (const b of bigrams(t)) igB.add(b);
  const igW = new Set(ignore.flatMap((t) => fold(t).split(" ").filter(Boolean)));
  const qb = [...bigrams(question)].filter((b) => !igB.has(b));
  const qw = new Set(fold(question).split(" ").filter((w) => w && !STOP.has(w) && w.length > 1));
  const scored: [number, any][] = [];
  for (const p of pages) {
    const words = new Set(fold(p.text).split(" "));
    const pb = bigrams(p.text);
    let s = 2 * qb.filter((b) => pb.has(b)).length;
    for (const w of qw) if (words.has(w)) s += igW.has(w) ? 0.5 : 1;
    if (s >= 2) scored.push([s + (p.type === "post" ? 0.5 : 0), p]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n).map(([, p]) => p);
}

// ---------------------------------------------------------------- 1. tìm câu hỏi
function isQuestion(s: string) {
  s = String(s || "").trim();
  return QWORDS.test(s) || s.split(/\s+/).filter(Boolean).length >= 6;
}

function relatedTo(s: string, tps: string[]) {
  const fq = fold(s);
  const fqw = fq.split(" ");
  for (const t of tps) {
    const ft = fold(t);
    if (fq.includes(ft) || intersects(bigrams(t), bigrams(s))) return true;
    const words = ft.split(" ").filter((w) => w && !STOP.has(w));
    if (words.length && words.every((w) => fqw.includes(w))) return true;
  }
  return false;
}

async function llmMentions(cfg: any, topic: string, loc: number, lang: string, notes: string[]): Promise<[any[], string[]]> {
  const body = [{ target: [{ keyword: topic, search_scope: "question" }], platform: "google", location_code: loc,
    language_code: lang, limit: 100, order_by: ["ai_search_volume,desc"] }];
  let task = null, err = "";
  for (const path of ["/v3/ai_optimization/llm_mentions/search_mentions/live", "/v3/ai_optimization/llm_mentions/search/live"]) {
    try {
      [task] = await dfsPost(cfg, path, body, 120);
      break;
    } catch (e: any) {
      if (!(e instanceof SeoError) || fatal(e)) throw e;
      err = e.message;
    }
  }
  if (!task) {
    notes.push(`LLM Mentions chưa có dữ liệu cho "${topic}" ở khu vực này (${err.slice(0, 120)}).`);
    return [[], []];
  }
  const items = ((task.result || [{}])[0] || {}).items || [];
  const qs: any[] = [], src: string[] = [];
  for (const it of items) {
    if (it.question) qs.push({ q: it.question, vol: it.ai_search_volume ?? null });
    for (const s of it.sources || []) if (s.domain) src.push(s.domain);
  }
  if (!items.length) notes.push(`LLM Mentions: không có câu hỏi nào cho "${topic}" ở khu vực này.`);
  return [qs, src];
}

async function aiVolume(cfg: any, questions: string[], loc: number, lang: string, notes: string[]) {
  const kws = questions.map((x) => x.slice(0, 250).toLowerCase()).slice(0, 1000);
  if (!kws.length) return {};
  let task;
  try {
    [task] = await dfsPost(cfg, "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live", [{ keywords: kws, location_code: loc, language_code: lang }], 120);
  } catch (e: any) {
    if (!(e instanceof SeoError) || fatal(e)) throw e;
    notes.push(`Chưa lấy được lượng tìm kiếm trên AI cho khu vực này (${e.message.slice(0, 120)}).`);
    return {};
  }
  const items = ((task.result || [{}])[0] || {}).items || [];
  return Object.fromEntries(items.filter((i: any) => i.keyword).map((i: any) => [fold(i.keyword), i.ai_search_volume ?? null]));
}

async function gscQuestions(domain: string, tps: string[]) {
  const cfg = await loadConfig();
  if (hostOf(String(cfg.gsc_site || "").replace("sc-domain:", "")) !== domain) return [];
  let rows: any[];
  try {
    rows = await q(`SELECT query, SUM(impressions) impr, SUM(clicks) clicks, MIN(position) pos FROM seo_gsc_rows
                    WHERE period='cur' GROUP BY query ORDER BY impr DESC LIMIT 3000`);
  } catch {
    return [];
  }
  return rows.filter((r: any) => isQuestion(r.query) && relatedTo(r.query, tps)).slice(0, 200);
}

function addQ(poolQ: Record<string, any>, text: any, src: string, vol: any = null, extra: any = null) {
  const s = squash(text).replace(/^[ .]+|[ .]+$/g, "");
  if (!s || s.length > 240) return;
  const e = (poolQ[fold(s)] ||= { q: s, src: [], vol: null, gsc: null });
  if (!e.src.includes(src)) e.src.push(src);
  if (vol !== null && vol !== undefined) e.vol = Math.max(e.vol || 0, vol);
  if (extra) Object.assign(e, extra);
}

const DISCOVER_MODS = ["{t}", "{t} loại nào tốt", "cách chọn {t}", "{t} giá bao nhiêu", "{t} có tốt không", "lắp đặt {t}"];

registerStep("aiq_discover", (job, ctx) => moduleAs("aiq_discover", async () => {
  const st = job.state;
  const p = await getProject(st.pid);
  if (!p) throw new SeoError("Không tìm thấy dự án.");
  const cfg = await loadConfig();
  const hasDfs = Boolean(cfg.login && cfg.password);
  const [loc, lang, tps] = [p.location, p.language, p.topics];
  const opts = st.opts || {};
  st.pool ||= {};
  st.notes ||= [];
  st.cited ||= [];

  if (st.step === "gsc") {
    if (!cfg.anthropic_api_key) throw new SeoError("Chưa có khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
    for (const g of await gscQuestions(p.domain, tps)) addQ(st.pool, g.query, "gsc", null, { gsc: { impr: g.impr, pos: pyRound(g.pos || 0, 1) } });
    if (hasDfs) {
      const mods = DISCOVER_MODS.slice(0, Math.max(1, parseInt(opts.serp_per_topic) || 4));
      st.serp = tps.flatMap((t: string) => mods.map((m) => [t, m.replace("{t}", t)]));
      st.si = 0;
      st.step = "serp";
      ctx.progress(`Đang lấy câu hỏi Google (People Also Ask) cho ${st.serp.length} lượt tìm…`);
    } else {
      st.notes.push("Chưa có tài khoản DataForSEO: chỉ dùng Search Console và AI gợi ý câu hỏi.");
      st.step = "ai";
      ctx.progress(`AI đang bổ sung câu hỏi và gom nhóm (${Object.keys(st.pool).length} câu đã thu thập)…`);
    }
    return;
  }
  const afterSerp = () => {
    if (opts.labs ?? true) {
      st.step = "labs";
      st.ti = 0;
      ctx.progress(`Đang lấy gợi ý tìm kiếm dạng câu hỏi cho "${tps[0]}"…`);
    } else afterLabs();
  };
  const afterLabs = () => {
    if (opts.mentions ?? true) {
      st.step = "mentions";
      st.ti = 0;
      ctx.progress(`Đang lấy câu hỏi trên AI có nhắc "${tps[0]}" (LLM Mentions)…`);
    } else toAi();
  };
  const toAi = () => {
    st.step = "ai";
    ctx.progress(`AI đang bổ sung câu hỏi và gom nhóm (${Object.keys(st.pool).length} câu đã thu thập)…`);
  };

  if (st.step === "serp") {
    while (st.si < st.serp.length && Date.now() < ctx.deadline) {
      const batch = st.serp.slice(st.si, st.si + 4);
      const res = await Promise.all(batch.map(async ([, kw]: any) => {
        try {
          return [kw, await fetchSerp(cfg, kw, loc, lang, 2, 40), null];
        } catch (e: any) {
          if (!(e instanceof SeoError)) throw e;
          return [kw, null, e.message];
        }
      }));
      for (const [kw, r, err] of res) {
        if (err) {
          st.notes.push(`Google "${kw}": ${err}`);
          continue;
        }
        for (const x of r.paa) addQ(st.pool, x, "paa");
        for (const x of r.related) if (isQuestion(x)) addQ(st.pool, x, "related");
        if (r.aio) st.cited.push(...r.aio.references.filter((x: any) => x.domain).map((x: any) => x.domain));
      }
      st.si += batch.length;
      ctx.progress(`Đang lấy câu hỏi Google (People Also Ask): ${st.si}/${st.serp.length} lượt tìm…`);
    }
    if (st.si >= st.serp.length) afterSerp();
    return;
  }
  if (st.step === "labs") {
    while (st.ti < tps.length && Date.now() < ctx.deadline) {
      const t = tps[st.ti];
      ctx.progress(`Đang lấy gợi ý tìm kiếm dạng câu hỏi cho "${t}"…`);
      try {
        for (const r of await seedKeywords(cfg, t, loc, lang, st.notes)) if (r.keyword && isQuestion(r.keyword)) addQ(st.pool, r.keyword, "google_suggest");
      } catch (e: any) {
        if (!(e instanceof SeoError)) throw e;
        st.notes.push(e.message);
      }
      st.ti++;
    }
    if (st.ti >= tps.length) afterLabs();
    return;
  }
  if (st.step === "mentions") {
    while (st.ti < tps.length && Date.now() < ctx.deadline) {
      const t = tps[st.ti];
      ctx.progress(`Đang lấy câu hỏi trên AI có nhắc "${t}" (LLM Mentions)…`);
      const [qs, src] = await llmMentions(cfg, t, loc, lang, st.notes);
      for (const x of qs) addQ(st.pool, x.q, "llm_mentions", x.vol);
      st.cited.push(...src);
      st.ti++;
    }
    if (st.ti >= tps.length) toAi();
    return;
  }
  if (st.step === "ai") {
    const collected = Object.values(st.pool).map((e: any, i) => [e, i] as const)
      .sort(([a, i], [b, j]) => b.src.length - a.src.length || (b.vol || 0) - (a.vol || 0) || i - j).map(([e]) => e).slice(0, 320);
    const existing = (await q("SELECT question FROM seo_aiq_questions WHERE project_id=? LIMIT 400", [st.pid])).map((r: any) => r.question);
    const lst = collected.map((e: any, i: number) => `${i + 1}. ${e.q}`).join("\n") || "(chưa có)";
    const prompt = `Bạn là chuyên gia GEO (tối ưu cho công cụ tìm kiếm AI) tại Việt Nam. Website: ${p.domain} (thương hiệu: ${p.brands.join(", ")}).
Lĩnh vực kinh doanh: ${tps.join(", ")}.

Câu hỏi thật thu thập từ Google, Search Console và dữ liệu AI:
${lst}

Câu hỏi đã có trong bộ (không lặp lại):
${existing.slice(0, 200).map((x: string) => "- " + x).join("\n") || "(chưa có)"}

Nhiệm vụ:
1. Giữ các câu hỏi thật sự liên quan tới lĩnh vực, viết lại cho chuẩn chính tả tiếng Việt có dấu, giữ nguyên ý. Gộp các câu trùng ý (ghi tất cả số thứ tự đã gộp vào "from").
2. BỔ SUNG khoảng 40-60 câu hỏi người Việt hay HỎI CHATGPT/GEMINI (dạng hội thoại, dài, có ngữ cảnh) theo từng kiểu khách:
   hộ gia đình (phòng khách, phòng ngủ, trần thấp, nhà phố), chủ nhà xưởng/kho/nhà hàng (quạt công nghiệp, quạt trần công nghiệp, diện tích lớn),
   kiến trúc sư/nhà thầu, người đang so sánh hãng/giá, người gặp sự cố. Câu bổ sung để "from": [].
3. Gán "cluster" (tên nhóm chủ đề ngắn, tối đa 12 nhóm), "intent" thuộc: buy, compare, price, howto, problem, info, local.
4. "priority": 3 = khách sắp mua hoặc câu rất phổ biến, 2 = quan trọng, 1 = phụ.
5. Tối đa 160 câu. Không lấy câu chứa tên thương hiệu đối thủ cụ thể trừ khi là câu so sánh phổ biến.

Chỉ trả về JSON hợp lệ: {"questions": [{"q": "câu hỏi", "from": [1, 5], "cluster": "…", "intent": "buy", "priority": 3}]}`;
    const [txt] = await claude(cfg, prompt, 16000, null, "aiq_discover");
    const out = extractJson(txt, "AI không trả về danh sách câu hỏi hợp lệ, hãy thử lại.").questions || [];
    if (!out.length) throw new SeoError("AI không trả về danh sách câu hỏi hợp lệ, hãy thử lại.");
    const final: any[] = [];
    for (const x of out) {
      const text = squash(x.q || "");
      if (!text) continue;
      const src = new Set<string>();
      let vol: any = null, gsc: any = null;
      for (const i of x.from || []) {
        const e = collected[parseInt(i) - 1];
        if (!e || parseInt(i) < 1) continue;
        e.src.forEach((s: string) => src.add(s));
        if (e.vol !== null && e.vol !== undefined) vol = Math.max(vol || 0, e.vol || 0);
        gsc = gsc || e.gsc;
      }
      if (!src.size) src.add("ai");
      final.push({ q: text, src: [...src].sort(), vol, gsc, cluster: String(x.cluster || "Khác").slice(0, 60),
        intent: x.intent in INTENT_VI ? x.intent : "info", priority: Math.max(1, Math.min(3, parseInt(x.priority) || 2)) });
    }
    st.final = final;
    st.collected_n = Object.keys(st.pool).length;
    st.pool = {};
    if (hasDfs && (opts.ai_volume ?? true)) {
      st.step = "aivol";
      ctx.progress("Đang lấy lượng tìm kiếm trên AI…");
    } else {
      st.step = "save";
      ctx.progress("Đang lưu bộ câu hỏi…");
    }
    return;
  }
  if (st.step === "aivol") {
    const av = await aiVolume(cfg, st.final.map((f: any) => f.q), loc, lang, st.notes);
    for (const f of st.final) {
      const v = av[fold(f.q)];
      if (v !== null && v !== undefined) f.vol = Math.max(f.vol || 0, v);
    }
    st.step = "save";
    ctx.progress("Đang lưu bộ câu hỏi…");
    return;
  }
  if (st.step === "save") {
    const pages = await myPages(p.domain);
    let added = 0;
    const final = [...st.final].map((f, i) => [f, i] as const)
      .sort(([a, i], [b, j]) => b.priority - a.priority || b.src.length - a.src.length || (b.vol || 0) - (a.vol || 0) || i - j).map(([f]) => f);
    await tx(async (t: any) => {
      let nTrack = (await one("SELECT COUNT(*) n FROM seo_aiq_questions WHERE project_id=? AND status='track'", [st.pid], t)).n;
      for (const f of final) {
        const norm = fold(f.q);
        const old = await one("SELECT id, sources_json FROM seo_aiq_questions WHERE project_id=? AND norm=?", [st.pid, norm], t);
        const g = f.gsc || {};
        if (old) {
          const src = uniq([...jl(old.sources_json, []), ...f.src]).sort();
          await run("UPDATE seo_aiq_questions SET sources_json=?, ai_volume=COALESCE(?, ai_volume), gsc_impr=COALESCE(?, gsc_impr), gsc_pos=COALESCE(?, gsc_pos) WHERE id=?",
            [JSON.stringify(src), f.vol, g.impr ?? null, g.pos ?? null, old.id], t);
          continue;
        }
        const status = f.priority === 3 && nTrack < 30 ? "track" : "new";
        if (status === "track") nTrack++;
        const tgt = matchPages(f.q, pages, 1, tps);
        await run(`INSERT INTO seo_aiq_questions(project_id, question, norm, cluster, intent, sources_json, ai_volume, gsc_impr, gsc_pos,
                   priority, status, target_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [st.pid, f.q, norm, f.cluster, f.intent, JSON.stringify(f.src), f.vol, g.impr ?? null, g.pos ?? null, f.priority, status, tgt.length ? tgt[0].url : "", now()], t);
        added++;
      }
    });
    const ins = p.insights || {};
    if (st.cited.length) {
      const cnt = new Map<string, number>();
      for (const d0 of st.cited) {
        const d = hostOf(d0);
        cnt.set(d, (cnt.get(d) || 0) + 1);
      }
      ins.discover_sources = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    }
    ins.discover_at = now();
    ins.discover_notes = st.notes;
    await setProject(st.pid, { insights_json: ins });
    const res = { added, total: st.final.length, collected: st.collected_n || 0, notes: st.notes };
    st.final = [];
    return { done: res };
  }
  throw new SeoError("Trạng thái tìm câu hỏi không hợp lệ");
}));

// ---------------------------------------------------------------- 2. hỏi AI
async function retryLoc(cfg: any, path: string, body: any[], notes: string[], label: string) {
  try {
    return (await dfsPost(cfg, path, body, 150))[0];
  } catch (e: any) {
    if (!(e instanceof SeoError) || fatal(e)) throw e;
    if (/location|language|40501|40502|Invalid Field/i.test(e.message)) {
      const note = `${label} chưa hỗ trợ khu vực Việt Nam; hỏi bằng tiếng Việt với khu vực mặc định (Mỹ).`;
      if (!notes.includes(note)) notes.push(note);
      return (await dfsPost(cfg, path, [{ ...body[0], location_code: 2840, language_code: "en" }], 150))[0];
    }
    throw e;
  }
}

/** Trả về {text, sources:[{url,domain,title}], brands:[..], fan_out:[..], note}. */
async function ask(cfg: any, platform: string, qtext: string, loc: number, lang: string, notes: string[]) {
  if (platform === "chatgpt" || platform === "gemini") {
    const task = await retryLoc(cfg, PLATFORMS[platform].path, [{ keyword: qtext, location_code: loc, language_code: lang, force_web_search: true }],
      notes, PLATFORMS[platform].label);
    const r = (task.result || [{}])[0] || {};
    const text = r.markdown || (r.items || []).map((i: any) => i.markdown || i.text || "").join("\n\n");
    const srcs = (r.sources || []).filter((s: any) => s.url).map((s: any) => ({ url: s.url, domain: hostOf(s.domain || s.url), title: s.title || "" }));
    const brands = (r.brand_entities || []).filter((b: any) => b.title).map((b: any) => b.title);
    return { text, sources: srcs, brands, fan_out: r.fan_out_queries || [] };
  }
  if (platform === "perplexity") {
    const [task] = await dfsPost(cfg, PLATFORMS.perplexity.path, [{
      user_prompt: qtext.slice(0, 500), model_name: cfg.aiq_perplexity_model || "sonar", max_output_tokens: 1500, web_search_country_iso_code: "VN",
      system_message: "Bạn trả lời người dùng tại Việt Nam, bằng tiếng Việt." }], 150);
    const r = (task.result || [{}])[0] || {};
    const text: string[] = [], srcs: any[] = [];
    for (const it of r.items || []) {
      for (const s of it.sections || []) {
        text.push(s.text || "");
        for (const a of s.annotations || []) if (a.url) srcs.push({ url: a.url, domain: hostOf(a.url), title: a.title || "" });
      }
    }
    return { text: text.join("\n\n"), sources: srcs, brands: [], fan_out: r.fan_out_queries || [] };
  }
  if (platform === "google") {
    const r = await fetchSerp(cfg, qtext, loc, lang);
    const organic = r.organic.map((o: any) => o.domain);
    if (!r.aio) return { text: "", sources: [], brands: [], fan_out: [], note: "Google không hiện AI Overview cho câu này", organic };
    return { text: r.aio.markdown, sources: r.aio.references.map((x: any) => ({ url: x.url, domain: hostOf(x.domain), title: x.title })),
      brands: [], fan_out: [], organic };
  }
  throw new SeoError("Nền tảng không hỗ trợ");
}

const terms = (names: string[]) => names.map(fold).filter((f) => f.replace(/ /g, "").length >= 3);

/** Có nhắc thương hiệu / trích link website không; đối thủ nào được nhắc. */
function detect(ans: any, project: any) {
  const text = fold(ans.text || "");
  const flat = text.replace(/ /g, "");
  const dom = project.domain;
  const find = (ts: string[]) => {
    let pos: number | null = null;
    for (const t of ts) {
      let i = text.indexOf(t);
      if (i < 0) {
        const j = flat.indexOf(t.replace(/ /g, ""));
        i = j >= 0 ? Math.trunc((j * text.length) / Math.max(1, flat.length)) : -1;
      }
      if (i >= 0) pos = pos === null ? i : Math.min(pos, i);
    }
    return pos;
  };
  const brandsF = (ans.brands || []).map(fold);
  const inBrands = (ts: string[]) => brandsF.some((b: string) => ts.some((t) => b.replace(/ /g, "").includes(t.replace(/ /g, ""))));
  const onSite = (d: string) => (ans.sources || []).some((s: any) => s.domain === d || String(s.domain || "").endsWith("." + d));
  const my = terms([...project.brands, dom, dom.split(".")[0]]);
  const pos = find(my);
  const mentioned = pos !== null || inBrands(my);
  const cited = onSite(dom);
  const comps: string[] = [];
  for (const c of project.competitors) {
    const ts = terms([c.name, ...(c.domain ? [c.domain, c.domain.split(".")[0]] : [])]);
    let hit = find(ts) !== null || inBrands(ts);
    hit = hit || Boolean(c.domain && onSite(c.domain));
    if (hit) comps.push(c.name);
  }
  return { mentioned: mentioned || cited, cited, mention_pos: pos !== null ? pyRound(pos / Math.max(1, text.length), 2) : null, competitors: comps };
}

const NO_HIT = { mentioned: false, cited: false, mention_pos: null, competitors: [] };

registerStep("aiq_check", (job, ctx) => moduleAs("aiq_check", async () => {
  const st = job.state;
  const p = await getProject(st.pid);
  if (!p) throw new SeoError("Không tìm thấy dự án.");
  const cfg = await loadConfig();
  if (st.step === "init") {
    if (!(cfg.login && cfg.password)) throw new SeoError("Kiểm tra câu trả lời của AI cần tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).");
    const qs = st.qids?.length
      ? await q("SELECT id, question FROM seo_aiq_questions WHERE project_id=? AND id IN (?)", [st.pid, st.qids])
      : await q("SELECT id, question FROM seo_aiq_questions WHERE project_id=? AND status='track' ORDER BY priority DESC, id LIMIT ?", [st.pid, p.auto_top]);
    if (!qs.length) throw new SeoError("Chưa có câu hỏi nào đang theo dõi. Bấm Tìm câu hỏi hoặc chọn câu hỏi ở Bộ câu hỏi.");
    const platforms = (st.platforms || []).filter((x: string) => x in PLATFORMS);
    st.platforms = platforms.length ? platforms : p.platforms;
    st.notes = [];
    st.t0 = await spentTotal();
    st.rid = (await run("INSERT INTO seo_aiq_runs(project_id, at, platforms_json, n_questions, auto) VALUES (?,?,?,?,?) RETURNING id",
      [st.pid, now(), JSON.stringify(st.platforms), qs.length, st.auto ? 1 : 0])).rows[0].id;
    st.jobs = qs.flatMap((x: any) => st.platforms.map((pl: string) => [x.id, x.question, pl]));
    st.ji = 0;
    st.step = "ask";
    ctx.progress(`Đang hỏi AI 0/${st.jobs.length} lượt…`);
    return;
  }
  if (st.step === "ask") {
    while (st.ji < st.jobs.length && Date.now() < ctx.deadline) {
      const batch = st.jobs.slice(st.ji, st.ji + 6);
      await Promise.all(batch.map(async ([qid, qtext, pl]: any) => {
        let ans: any, d: any, ok: number, err: string;
        try {
          ans = await ask(cfg, pl, qtext, p.location, p.language, st.notes);
          d = ans.text ? detect(ans, p) : NO_HIT;
          ok = ans.text ? 1 : 0;
          err = ans.note || "";
        } catch (e: any) {
          if (!(e instanceof SeoError) || /hết tiền/.test(e.message)) throw e;
          ans = { text: "", sources: [], brands: [] };
          d = NO_HIT;
          ok = 0;
          err = e.message.slice(0, 300);
        }
        await run(`INSERT INTO seo_aiq_checks(run_id, project_id, question_id, platform, at, ok, answer, mentioned, cited, mention_pos,
                   sources_json, brands_json, competitors_json, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [st.rid, st.pid, qid, pl, now(), ok, String(ans.text || "").slice(0, 8000), d.mentioned ? 1 : 0, d.cited ? 1 : 0, d.mention_pos,
            JSON.stringify(ans.sources || []), JSON.stringify(ans.brands || []), JSON.stringify(d.competitors), err]);
      }));
      st.ji += batch.length;
      const [, lastQ, lastPl] = batch[batch.length - 1];
      ctx.progress(`Đã hỏi ${st.ji}/${st.jobs.length} lượt (${PLATFORMS[lastPl].label}: ${String(lastQ).slice(0, 60)})`);
    }
    if (st.ji < st.jobs.length) return;
    const summ: any = await runSummary(st.rid, p);
    summ.notes = st.notes;
    const cost = Math.max(0, (await spentTotal()) - st.t0);
    await run("UPDATE seo_aiq_runs SET summary_json=?, cost_usd=? WHERE id=?", [JSON.stringify(summ), cost, st.rid]);
    st.jobs = [];
    return { done: { run_id: st.rid, summary: summ, cost_usd: cost } };
  }
  throw new SeoError("Trạng thái kiểm tra không hợp lệ");
}));

async function runSummary(rid: any, p: any) {
  const rows = await q("SELECT * FROM seo_aiq_checks WHERE run_id=?", [rid]);
  const per: Record<string, any> = {}, comp = new Map<string, number>(), dom = new Map<string, number>();
  const qset = new Set(), qvis = new Set();
  for (const r of rows) {
    const s = (per[r.platform] ||= { asked: 0, answered: 0, mentioned: 0, cited: 0, errors: 0 });
    s.asked++;
    s.answered += r.ok;
    s.mentioned += r.mentioned;
    s.cited += r.cited;
    s.errors += !r.ok && r.note && !r.note.includes("AI Overview") ? 1 : 0;
    qset.add(r.question_id);
    if (r.mentioned) qvis.add(r.question_id);
    for (const c of jl(r.competitors_json, [])) comp.set(c, (comp.get(c) || 0) + 1);
    for (const d of new Set(jl(r.sources_json, []).filter((x: any) => x.domain).map((x: any) => x.domain))) dom.set(d, (dom.get(d) || 0) + 1);
  }
  const vals = Object.values(per);
  const answered = vals.reduce((a, s: any) => a + s.answered, 0);
  const mentioned = vals.reduce((a, s: any) => a + s.mentioned, 0);
  for (const s of vals) s.visibility = s.answered ? pyRound((s.mentioned / s.answered) * 100) : null;
  const sov = [{ name: p.brands.length ? p.brands[0] : p.domain, mine: true, count: mentioned },
    ...[...comp.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ name: c, mine: false, count: n }))];
  return {
    platforms: per, visibility: answered ? pyRound((mentioned / answered) * 100) : 0, answered, mentioned,
    cited: vals.reduce((a, s: any) => a + s.cited, 0), questions: qset.size, questions_visible: qvis.size, share_of_voice: sov,
    top_domains: [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  };
}

// ---------------------------------------------------------------- 3. tư vấn
async function latestChecks(qid: any) {
  const rows = await q(`SELECT c.* FROM seo_aiq_checks c JOIN (SELECT platform, MAX(id) mid FROM seo_aiq_checks WHERE question_id=? GROUP BY platform) t
                        ON c.id=t.mid`, [qid]);
  const out: Record<string, any> = {};
  for (const r of rows) {
    const d: any = { ...r, sources: jl(r.sources_json, []), brands: jl(r.brands_json, []), competitors: jl(r.competitors_json, []) };
    delete d.sources_json;
    delete d.brands_json;
    delete d.competitors_json;
    out[d.platform] = d;
  }
  return out;
}

function faqJsonld(items: [string, string][]) {
  return { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: items.filter(([qq, a]) => qq && a).map(([qq, a]) => ({ "@type": "Question", name: qq, acceptedAnswer: { "@type": "Answer", text: a } })) };
}

async function adviseOne(qid: any, cfg: any) {
  const qrow = await one("SELECT * FROM seo_aiq_questions WHERE id=?", [qid]);
  if (!qrow) throw new SeoError("Không tìm thấy câu hỏi");
  const checks = await latestChecks(qid);
  const p = await getProject(qrow.project_id);
  const pages = await myPages(p.domain);
  const cands = matchPages(qrow.question, pages, 6, p.topics);
  const target = qrow.target_url || (cands.length ? cands[0].url : "");
  const page: any = target ? await readPage(target, 5000) : null;
  const ansTxt = Object.entries(checks).map(([pl, c]: any) => {
    const stt = c.cited ? "CÓ trích link website" : c.mentioned ? "CÓ nhắc thương hiệu" : "KHÔNG nhắc website";
    return `### ${PLATFORMS[pl]?.label || pl} (${stt}; đối thủ được nhắc: ${c.competitors.join(", ") || "không"})\n`
      + `Nguồn được trích: ${uniq(c.sources.map((s: any) => s.domain)).join(", ").slice(0, 400) || "không"}\n`
      + `${String(c.answer || c.note || "").slice(0, 1400)}`;
  });
  let pageTxt = "";
  if (page && !page.error) {
    pageTxt = `URL: ${page.url}\nTitle: ${page.title}\nH1: ${page.h1.join(", ")}\nHeadings: `
      + page.headings.slice(0, 25).map(([, t]: any) => t).join(" | ") + `\nSchema: ${page.schema.join(", ")}\nSố chữ: ${page.word_count}\n`
      + `Nội dung (trích): ${page.text.slice(0, 3500)}`;
  } else if (target) pageTxt = `Không đọc được trang ${target}: ${page?.error || ""}`;
  const cfgVars = (cfg.ap_variables || []).filter((v: any) => v.name && v.value).map((v: any) => `- ${v.name}: ${v.value}`).join("\n");
  const prompt = `Bạn là chuyên gia GEO (Generative Engine Optimization) tại Việt Nam. Mục tiêu: khi người dùng hỏi AI (ChatGPT, Gemini, Perplexity, Google AI Overview)
câu hỏi dưới đây, câu trả lời phải NHẮC và TRÍCH DẪN website ${p.domain} (thương hiệu: ${p.brands.join(", ")}).

Câu hỏi: "${qrow.question}"  (nhóm: ${qrow.cluster}, ý định: ${INTENT_VI[qrow.intent] || qrow.intent})

## AI đang trả lời thế nào
${ansTxt.join("\n") || "(chưa kiểm tra câu trả lời của AI)"}

## Trang của website đang phù hợp nhất
${pageTxt || "(chưa có trang phù hợp)"}

## Các trang khác có thể liên quan
${cands.slice(1).map((c: any) => c.url).join("\n") || "(không có)"}

## Thông tin doanh nghiệp (chỉ dùng thông tin có thật ở đây, không bịa)
${cfgVars || "(không có)"}

Đưa ra tư vấn cụ thể, làm được ngay. Chỉ trả về JSON hợp lệ:
{
  "verdict": "1-2 câu: hiện trạng và vì sao AI chưa/đã chọn website",
  "priority": "cao|trung bình|thấp",
  "target": {"type": "existing|new", "url": "URL trang có sẵn nên sửa (nếu existing)", "title": "tiêu đề bài mới (nếu new)", "reason": "vì sao"},
  "answer_block": {"heading": "H2 đúng dạng câu hỏi", "paragraph": "đoạn 40-60 chữ trả lời thẳng, có con số/tiêu chí cụ thể, nhắc thương hiệu tự nhiên nếu hợp", "bullets": ["3-6 ý chi tiết dạng gạch đầu dòng"]},
  "facts_needed": ["thông số, số liệu, bảng so sánh, ảnh/video thực tế cần bổ sung để AI tin và trích dẫn"],
  "faq": [{"q": "câu hỏi liên quan", "a": "trả lời 30-50 chữ"}],
  "on_page": ["việc sửa cụ thể trên trang: vị trí, nội dung, schema, tiêu đề..."],
  "entity": ["tín hiệu thương hiệu/độ tin cậy cần có: tác giả, kinh nghiệm, địa chỉ, chính sách, đánh giá..."],
  "off_site": [{"domain": "website AI hay trích (lấy từ nguồn ở trên)", "action": "cách xuất hiện ở đó một cách chính đáng (bài chuyên gia, review, PR có gắn rel sponsored...)"}],
  "competitor_gap": "đối thủ được AI nhắc có điểm gì website chưa có (nếu có)"
}`;
  const [txt] = await claude(cfg, prompt, 3500, null, "aiq_advise");
  const data = extractJson(txt, "AI trả về dữ liệu không hợp lệ, hãy thử lại.");
  const ab = data.answer_block || {};
  data.jsonld = faqJsonld([[ab.heading || qrow.question, ab.paragraph || ""], ...(data.faq || []).map((f: any) => [f.q, f.a])]);
  data.question = qrow.question;
  data.target_page = target;
  data.candidates = cands.map((c: any) => c.url);
  await run("INSERT INTO seo_aiq_advice(question_id, at, data_json) VALUES (?,?,?) ON CONFLICT (question_id) DO UPDATE SET at=EXCLUDED.at, data_json=EXCLUDED.data_json",
    [qid, now(), JSON.stringify(data)]);
  if (!qrow.target_url && data.target?.type === "existing" && data.target.url) await run("UPDATE seo_aiq_questions SET target_url=? WHERE id=?", [data.target.url, qid]);
  return data;
}

registerStep("aiq_advise", (job, ctx) => moduleAs("aiq_advise", async () => {
  const st = job.state;
  const cfg = await loadConfig();
  if (!cfg.anthropic_api_key) throw new SeoError("Chưa có khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
  st.out ||= [];
  st.errs ||= [];
  st.i ||= 0;
  // Mỗi bước tư vấn tối đa 3 câu song song (bản gốc: 3 luồng), mỗi câu ~30–60 giây.
  const batch = st.qids.slice(st.i, st.i + 3);
  await Promise.all(batch.map(async (qid: any) => {
    try {
      await adviseOne(qid, cfg);
      st.out.push(qid);
    } catch (e: any) {
      if (!(e instanceof SeoError)) console.error("[câu hỏi AI] tư vấn lỗi:", e);
      st.errs.push(String(e?.message || e));
    }
  }));
  st.i += batch.length;
  ctx.progress(`AI đã tư vấn ${st.i}/${st.qids.length} câu hỏi…`);
  if (st.i < st.qids.length) return;
  if (!st.out.length && st.errs.length) throw new SeoError(st.errs[0]);
  return { done: { done: st.out.length, errors: st.errs.slice(0, 5), ids: st.out } };
}));

registerStep("aiq_plan", (job, ctx) => moduleAs("aiq_plan", async () => {
  const pid = job.state.pid;
  const p = await getProject(pid);
  if (!p) throw new SeoError("Không tìm thấy dự án.");
  const cfg = await loadConfig();
  const ov = await overview(pid);
  const qs = await q("SELECT id, question, cluster, intent, priority, status, target_url FROM seo_aiq_questions WHERE project_id=? AND status<>'ignored' ORDER BY priority DESC LIMIT 160", [pid]);
  const vis = ov.by_question || {};
  const lines = qs.map((x: any) => `- [${x.cluster}] ${x.question} | ưu tiên ${x.priority} | trang: ${x.target_url || "chưa có"} | AI nhắc: ${vis[String(x.id)]?.mentioned ?? "?"}/${vis[String(x.id)]?.answered ?? "?"}`);
  const tech = p.tech || {};
  const last = ov.last_run || {};
  const prompt = `Bạn là chuyên gia GEO tại Việt Nam. Lập KẾ HOẠCH 90 NGÀY để website ${p.domain} (thương hiệu ${p.brands.join(", ")}) được ChatGPT, Gemini, Perplexity
và Google AI Overview nhắc và trích dẫn khi người dùng hỏi về: ${p.topics.join(", ")}.

Mức hiện diện hiện tại: ${last.visibility ?? "chưa kiểm tra"}% câu trả lời có nhắc website.
Đối thủ được AI nhắc nhiều: ${(last.share_of_voice || []).slice(1, 6).map((x: any) => `${x.name} (${x.count})`).join(", ") || "chưa có dữ liệu"}.
Website AI hay trích dẫn: ${(last.top_domains || []).slice(0, 15).map(([d]: any) => d).join(", ") || "chưa có dữ liệu"}.
Kỹ thuật: ${JSON.stringify(tech.summary || {})}

Bộ câu hỏi:
${lines.join("\n")}

Chỉ trả về JSON hợp lệ:
{
  "headline": "1 câu tóm tắt chiến lược",
  "hubs": [{"title": "trang trung tâm (hub) cho 1 nhóm câu hỏi", "url_suggest": "đường dẫn gợi ý hoặc URL có sẵn", "clusters": ["nhóm"], "why": "..."}],
  "phases": [{"name": "Tuần 1-2", "tasks": ["việc cụ thể"]}, {"name": "Tuần 3-6", "tasks": []}, {"name": "Tuần 7-12", "tasks": []}],
  "entity": ["việc củng cố thương hiệu/độ tin cậy"],
  "off_site": ["kênh/website nên xuất hiện và cách làm chính đáng"],
  "kpi": ["chỉ số theo dõi và mục tiêu"]
}`;
  const [txt] = await claude(cfg, prompt, 6000, null, "aiq_plan");
  const data = extractJson(txt, "AI trả về dữ liệu không hợp lệ, hãy thử lại.");
  data.at = now();
  await setProject(pid, { plan_json: data });
  return { done: data };
}));

// ---------------------------------------------------------------- 4. kỹ thuật (miễn phí)
/** quote() của Python (giữ '/', mã hóa cả !'()*). */
const pyQuote = (s: string) => encodeURIComponent(s).replace(/%2F/gi, "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const pyUnquote = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** urllib.robotparser.RobotFileParser.parse + can_fetch (bản gốc dùng để xem bot AI có bị chặn không). */
function robotsCanFetch(txt: string, ua: string, url: string) {
  const entries: any[] = [];
  let def: any = null;
  let entry: any = { agents: [], rules: [] };
  let state = 0;
  const addEntry = (e: any) => {
    if (e.agents.includes("*")) {
      if (!def) def = e;
    } else entries.push(e);
  };
  for (const raw of txt.split(/\r\n|\n|\r/)) {
    if (!raw) {
      if (state === 1) {
        entry = { agents: [], rules: [] };
        state = 0;
      } else if (state === 2) {
        addEntry(entry);
        entry = { agents: [], rules: [] };
        state = 0;
      }
    }
    let line = raw;
    const i = line.indexOf("#");
    if (i >= 0) line = line.slice(0, i);
    line = line.trim();
    if (!line) continue;
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim().toLowerCase();
    const v = pyUnquote(line.slice(c + 1).trim());
    if (k === "user-agent") {
      if (state === 2) {
        addEntry(entry);
        entry = { agents: [], rules: [] };
      }
      entry.agents.push(v);
      state = 1;
    } else if (k === "disallow" || k === "allow") {
      if (state !== 0) {
        const allow = k === "allow" || v === "";
        entry.rules.push({ path: pyQuote(v), allow });
        state = 2;
      }
    }
  }
  if (state === 2) addEntry(entry);
  const name = ua.split("/")[0].toLowerCase();
  const applies = (e: any) => e.agents.some((a: string) => a === "*" || name.includes(a.toLowerCase()));
  let path = pyQuote(pyUnquote(new URL(url).pathname || "/")) || "/";
  const allowance = (e: any) => {
    for (const r of e.rules) if (r.path === "*" || path.startsWith(r.path)) return r.allow;
    return true;
  };
  for (const e of entries) if (applies(e)) return allowance(e);
  if (def) return allowance(def);
  return true;
}

registerStep("aiq_tech", async (job, ctx) => {
  const pid = job.state.pid;
  const p = await getProject(pid);
  if (!p) throw new SeoError("Không tìm thấy dự án.");
  const d = p.domain;
  const base = `https://${d}`;
  ctx.progress("Đang đọc robots.txt…");
  let rb = await fetchPage(base + "/robots.txt", 15);
  if (rb.status === 0) rb = await fetchPage(`https://www.${d}/robots.txt`, 15);
  const txt = rb.status === 200 ? decode(rb) : "";
  const bots = AI_BOTS.map(([b, w]) => ({ bot: b, what: w, allowed: txt ? robotsCanFetch(txt, b, base + "/") : true }));
  ctx.progress("Đang kiểm tra llms.txt và trang chủ…");
  const llms = await fetchPage(base + "/llms.txt", 15);
  const home: any = await readPage(base + "/", 3000);
  const checks: any[] = [];
  const add = (label: string, ok: any, value: string, fix: string) =>
    checks.push({ label, status: ok === true ? "pass" : ok === null || ok === undefined ? "warn" : "fail", value, fix });
  const blocked = bots.filter((b) => !b.allowed).map((b) => b.bot);
  const searchBlocked = blocked.filter((b) => !["GPTBot", "Google-Extended", "ClaudeBot"].includes(b));
  add("Cho phép bot AI đọc website", !blocked.length || (searchBlocked.length ? false : null),
    blocked.length ? "Bị chặn: " + blocked.join(", ") : "Tất cả bot AI chính đều được phép",
    "Trong robots.txt, không chặn OAI-SearchBot, ChatGPT-User, PerplexityBot, Bingbot, Googlebot. Bot bị chặn thì AI đó không thể đọc và trích dẫn website. (GPTBot/Google-Extended chỉ ảnh hưởng việc huấn luyện; nên cho phép nếu muốn AI biết thương hiệu.)");
  add("Có robots.txt", rb.status === 200, `HTTP ${rb.status}`, "Tạo robots.txt ở thư mục gốc, khai báo Sitemap.");
  const hasSm = txt.toLowerCase().includes("sitemap:");
  add("Có sitemap trong robots.txt", hasSm || null, hasSm ? "Có" : "Không khai báo",
    "Thêm dòng Sitemap: https://" + d + "/sitemap.xml vào robots.txt để bot AI tìm hết trang.");
  const llmsOk = llms.status === 200 && llms.body.length > 50 && !Buffer.from(llms.body.subarray(0, 300)).toString("latin1").toLowerCase().includes("<html");
  add("Tệp llms.txt", llmsOk || null, llmsOk ? "Có" : "Chưa có",
    "Tùy chọn (chưa phải chuẩn chính thức): tạo /llms.txt tóm tắt doanh nghiệp, danh mục sản phẩm và các trang hướng dẫn quan trọng bằng Markdown.");
  if (home && !home.error) {
    const sch = new Set(home.schema || []);
    const brandSchema = ["Organization", "LocalBusiness", "Store", "HomeAndConstructionBusiness"].some((x) => sch.has(x));
    add("Schema thương hiệu ở trang chủ", brandSchema || null, [...sch].sort().join(", ") || "Không có",
      "Thêm JSON-LD Organization/LocalBusiness: tên, logo, địa chỉ, hotline, sameAs (Facebook, YouTube, Zalo OA, Google Maps). AI dùng để nhận diện thương hiệu.");
    const blockedSnip = Boolean(home.noindex || home.nosnippet);
    add("Trang chủ không chặn index/đoạn trích", !blockedSnip, !blockedSnip ? "OK" : "Có noindex/nosnippet", "Gỡ noindex/nosnippet/max-snippet:0.");
  } else {
    add("Đọc được trang chủ", false, home?.error || "lỗi", "Kiểm tra website có mở được không.");
  }
  const res = { at: now(), bots, checks, robots_status: rb.status, summary: Object.fromEntries(checks.map((c) => [c.label, c.status])) };
  await setProject(pid, { tech_json: res });
  return { done: res };
});

// ---------------------------------------------------------------- tổng quan
export async function overview(pid: any) {
  const p = await getProject(pid);
  const runs = await q("SELECT id, at, platforms_json, n_questions, summary_json, cost_usd, auto FROM seo_aiq_runs WHERE project_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 24", [pid]);
  const qn = await q("SELECT status, COUNT(*) n FROM seo_aiq_questions WHERE project_id=? GROUP BY status", [pid]);
  const clusters = await q(`SELECT cluster, COUNT(*) n, SUM(CASE WHEN status='track' THEN 1 ELSE 0 END) track FROM seo_aiq_questions
                            WHERE project_id=? AND status<>'ignored' GROUP BY cluster ORDER BY n DESC`, [pid]);
  const byq: Record<string, any> = {};
  for (const r of await q(`SELECT c.question_id, q.cluster, c.platform, c.ok, c.mentioned, c.cited FROM seo_aiq_checks c
                           JOIN (SELECT question_id, platform, MAX(id) mid FROM seo_aiq_checks WHERE project_id=? GROUP BY question_id, platform) t ON c.id=t.mid
                           JOIN seo_aiq_questions q ON q.id=c.question_id`, [pid])) {
    const b = (byq[String(r.question_id)] ||= { answered: 0, mentioned: 0, cited: 0, cluster: r.cluster });
    b.answered += r.ok;
    b.mentioned += r.mentioned;
    b.cited += r.cited;
  }
  const nAdv = (await one("SELECT COUNT(*) n FROM seo_aiq_advice a JOIN seo_aiq_questions q ON q.id=a.question_id WHERE q.project_id=?", [pid])).n;
  for (const c of clusters) {
    const qs = Object.values(byq).filter((v: any) => v.cluster === c.cluster);
    const ans = qs.reduce((a, v: any) => a + v.answered, 0);
    c.visibility = ans ? pyRound((qs.reduce((a, v: any) => a + v.mentioned, 0) / ans) * 100) : null;
  }
  const trend = [...runs].reverse().map((r: any) => {
    const s = jl(r.summary_json, {});
    return { at: r.at, visibility: s.visibility, platforms: Object.fromEntries(Object.entries(s.platforms || {}).map(([k, v]: any) => [k, v.visibility])) };
  });
  let last: any = runs.length ? jl(runs[0].summary_json, {}) : null;
  if (last) Object.assign(last, { id: runs[0].id, at: runs[0].at, cost_usd: runs[0].cost_usd });
  return {
    project: p, questions: Object.fromEntries(qn.map((r: any) => [r.status, r.n])), clusters, last_run: last, trend,
    runs: runs.map((r: any) => ({ id: r.id, at: r.at, n: r.n_questions, visibility: jl(r.summary_json, {}).visibility, cost_usd: r.cost_usd, auto: r.auto,
      platforms: jl(r.platforms_json, []) })),
    by_question: byq, advised: nAdv, running: await runningCheck(pid),
  };
}

async function questionsList(pid: any) {
  const rows = await q("SELECT * FROM seo_aiq_questions WHERE project_id=? ORDER BY priority DESC, id", [pid]);
  const last = new Map<number, any>();
  for (const r of await q(`SELECT c.question_id, c.platform, c.ok, c.mentioned, c.cited, c.competitors_json, c.note FROM seo_aiq_checks c
                           JOIN (SELECT question_id, platform, MAX(id) mid FROM seo_aiq_checks WHERE project_id=? GROUP BY question_id, platform) t ON c.id=t.mid`, [pid])) {
    if (!last.has(r.question_id)) last.set(r.question_id, {});
    last.get(r.question_id)[r.platform] = { ok: r.ok, m: r.mentioned, c: r.cited, comp: jl(r.competitors_json, []), note: r.note || "" };
  }
  const adv = new Map((await q("SELECT a.question_id, a.at FROM seo_aiq_advice a JOIN seo_aiq_questions q ON q.id=a.question_id WHERE q.project_id=?", [pid]))
    .map((r: any) => [r.question_id, r.at]));
  return rows.map((r: any) => {
    const { sources_json, ...x } = r;
    return { ...x, sources: jl(sources_json, []), checks: last.get(r.id) || {}, advised_at: adv.get(r.id) ?? null };
  });
}

async function questionDetail(qid: any) {
  const r = await one("SELECT * FROM seo_aiq_questions WHERE id=?", [qid]);
  if (!r) return null;
  const { sources_json, ...x } = r;
  const d: any = { ...x, sources: jl(sources_json, []) };
  d.latest = await latestChecks(qid);
  d.history = await q("SELECT platform, at, ok, mentioned, cited FROM seo_aiq_checks WHERE question_id=? ORDER BY id", [qid]);
  const a = await one("SELECT at, data_json FROM seo_aiq_advice WHERE question_id=?", [qid]);
  d.advice = a ? { ...jl(a.data_json, {}), at: a.at } : null;
  return d;
}

async function runDetail(rid: any) {
  const r = await one("SELECT * FROM seo_aiq_runs WHERE id=?", [rid]);
  if (!r) return null;
  const rows = await q(`SELECT c.question_id, q.question, q.cluster, c.platform, c.ok, c.mentioned, c.cited, c.competitors_json, c.note
                        FROM seo_aiq_checks c JOIN seo_aiq_questions q ON q.id=c.question_id WHERE c.run_id=?`, [rid]);
  const mat = new Map<number, any>();
  for (const x of rows) {
    if (!mat.has(x.question_id)) mat.set(x.question_id, { id: x.question_id, question: x.question, cluster: x.cluster, cells: {} });
    mat.get(x.question_id).cells[x.platform] = { ok: x.ok, m: x.mentioned, c: x.cited, comp: jl(x.competitors_json, []), note: x.note || "" };
  }
  const score = (e: any) => -Object.values(e.cells).reduce((a: number, c: any) => a + c.m, 0);
  return {
    id: r.id, at: r.at, platforms: jl(r.platforms_json, []), summary: jl(r.summary_json, {}), cost_usd: r.cost_usd,
    rows: [...mat.values()].sort((a, b) => score(a) - score(b) || String(a.cluster || "").localeCompare(String(b.cluster || ""))),
  };
}

// ---------------------------------------------------------------- chuyển sang công cụ khác
async function sendAutopost(qids: number[], siteId: number) {
  let added = 0, skipped = 0;
  const site = await one("SELECT id FROM seo_ap_sites WHERE id=?", [siteId]);
  if (!site) throw new SeoError("Chọn website Autopost để gửi.");
  for (const qid of qids) {
    const d = await questionDetail(qid);
    if (!d) continue;
    const a = d.advice || {};
    const ab = a.answer_block || {};
    const brief = {
      keywords: (a.faq || []).map((f: any) => f.q).slice(0, 6), title: (a.target || {}).title || "",
      angle: "Bài trả lời câu hỏi người dùng hay hỏi AI. Mở bài bằng đoạn trả lời thẳng: " + (ab.paragraph || "")
        + (a.facts_needed?.length ? " | Cần có: " + a.facts_needed.join("; ").slice(0, 400) : ""),
      intent: d.intent, type: "cluster", pillar: "", link_target: "", competitors: [], seed: d.question, source: "aiq",
    };
    const r = await run("INSERT INTO seo_ap_keywords(site_id, keyword, status, brief_json, created_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (site_id, keyword) DO NOTHING",
      [siteId, d.question, "pending", JSON.stringify(brief), now(), now()]);
    added += r.count;
    skipped += 1 - r.count;
  }
  return { added, skipped };
}

const escHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

async function faqExport(qids: number[]) {
  const items: [string, string, string[]][] = [];
  for (const qid of qids) {
    const d = await questionDetail(qid);
    const ab = (d?.advice || {}).answer_block || {};
    if (ab.paragraph) items.push([d.question.replace(/\?+$/, "") + "?", ab.paragraph, ab.bullets || []]);
  }
  if (!items.length) throw new SeoError("Các câu đã chọn chưa có tư vấn AI. Bấm Tư vấn tối ưu trước.");
  const html = '<section class="faq">\n<h2>Câu hỏi thường gặp</h2>\n' + items.map(([qq, a, bl]) =>
    `<h3>${escHtml(qq)}</h3>\n<p>${escHtml(a)}</p>` + (bl.length ? "\n<ul>" + bl.map((b) => `<li>${escHtml(b)}</li>`).join("") + "</ul>" : "")).join("\n") + "\n</section>";
  const ld = faqJsonld(items.map(([qq, a]) => [qq, a]));
  return { html, jsonld: JSON.stringify(ld, null, 2), count: items.length };
}

// ---------------------------------------------------------------- lịch kiểm tra định kỳ (pg_cron → app.ts)
/** Bắt đầu kiểm tra định kỳ cho MỘT dự án đến hạn (nếu có). Trả về id tác vụ hoặc null. */
export async function startDueCheck(): Promise<string | null> {
  for (const p of await q("SELECT id, auto_days, platforms_json FROM seo_aiq_projects WHERE auto_check=1 ORDER BY id")) {
    const last = (await one("SELECT MAX(at) m FROM seo_aiq_runs WHERE project_id=?", [p.id])).m;
    const due = !last || Date.parse(last) < Date.now() - parseInt(p.auto_days) * 864e5;
    if (!due || (await runningCheck(p.id)) || (await overBudget())) continue;
    console.log(`[câu hỏi AI] kiểm tra định kỳ dự án #${p.id}`);
    return await startJob("aiq_check", { step: "init", pid: p.id, qids: [], platforms: jl(p.platforms_json, []), auto: true }, "Đang bắt đầu…", {}, true);
  }
  return null;
}

// ---------------------------------------------------------------- API
const MIGRATION = "Chưa chạy sql_migration_v27_seo_ban_do_website.sql trong Supabase (bảng của Bản đồ website / Câu hỏi AI).";

export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3); // /api/aiq/<seg...>
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  const pid = parseInt(h.query.get("project_id") || "0") || 0;
  try {
    if (method === "GET" && is("projects")) {
      const ids = (await q("SELECT id FROM seo_aiq_projects ORDER BY id")).map((r: any) => r.id);
      const items = [];
      for (const i of ids) items.push(await getProject(i));
      return h.send_json({ items, platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, v.label])) });
    }
    if (method === "POST" && is("projects")) return h.send_json(await saveProject(await h.read_json()));
    if (method === "DELETE" && is("projects", "*")) {
      await tx(async (t: any) => {
        for (const tb of ["seo_aiq_checks", "seo_aiq_runs"]) await run(`DELETE FROM ${tb} WHERE project_id=?`, [seg[1]], t);
        await run("DELETE FROM seo_aiq_advice WHERE question_id IN (SELECT id FROM seo_aiq_questions WHERE project_id=?)", [seg[1]], t);
        await run("DELETE FROM seo_aiq_questions WHERE project_id=?", [seg[1]], t);
        await run("DELETE FROM seo_aiq_projects WHERE id=?", [seg[1]], t);
      });
      return h.send_json({ ok: true });
    }
    if (method === "GET" && is("overview")) return h.send_json(await overview(pid));
    if (method === "GET" && is("questions")) return h.send_json({ items: await questionsList(pid) });
    if (method === "POST" && is("questions")) {
      const b = await h.read_json();
      const pr = await getProject(parseInt(b.project_id));
      if (!pr) return h.send_json({ error: "Chưa có dự án" }, 400);
      const pages = await myPages(pr.domain);
      let n = 0;
      for (const x0 of b.questions || []) {
        const x = squash(x0);
        if (!x) continue;
        const t = matchPages(x, pages, 1, pr.topics);
        n += (await run(`INSERT INTO seo_aiq_questions(project_id, question, norm, cluster, intent, sources_json, priority, status, target_url, created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (project_id, norm) DO NOTHING`,
          [pr.id, x, fold(x), b.cluster || "Tự thêm", "info", '["manual"]', 2, "track", t.length ? t[0].url : "", now()])).count;
      }
      return h.send_json({ added: n });
    }
    if (method === "POST" && is("questions", "bulk")) {
      const b = await h.read_json();
      const ids = (b.ids || []).map((i: any) => parseInt(i)).filter((i: number) => !Number.isNaN(i));
      if (ids.length && ["new", "track", "ignored"].includes(b.status)) await run("UPDATE seo_aiq_questions SET status=? WHERE id IN (?)", [b.status, ids]);
      return h.send_json({ ok: true });
    }
    if (is("questions", "*")) {
      if (method === "DELETE") {
        await run("DELETE FROM seo_aiq_questions WHERE id=?", [seg[1]]);
        await run("DELETE FROM seo_aiq_checks WHERE question_id=?", [seg[1]]);
        await run("DELETE FROM seo_aiq_advice WHERE question_id=?", [seg[1]]);
        return h.send_json({ ok: true });
      }
      if (method === "POST") {
        const b = await h.read_json();
        for (const k of ["status", "target_url", "cluster", "priority", "note"]) if (k in b) await run(`UPDATE seo_aiq_questions SET ${k}=? WHERE id=?`, [b[k], seg[1]]);
        return h.send_json({ ok: true });
      }
      const d = await questionDetail(parseInt(seg[1]));
      return d ? h.send_json(d) : h.send_json({ error: "Không tìm thấy câu hỏi" }, 404);
    }
    if (method === "POST" && is("discover")) {
      const b = await h.read_json();
      const p2 = parseInt(b.project_id) || 0;
      if (!(await getProject(p2))) return h.send_json({ error: "Chưa có dự án" }, 400);
      return h.send_json({ job_id: await startJob("aiq_discover", { step: "gsc", pid: p2, opts: b.options || {} }, "Đang lấy câu hỏi từ Search Console…") });
    }
    if (method === "POST" && is("check")) {
      const b = await h.read_json();
      const p2 = parseInt(b.project_id) || 0;
      if (await runningCheck(p2)) return h.send_json({ error: "Dự án này đang được kiểm tra." }, 409);
      const qids = (b.question_ids || []).map((i: any) => parseInt(i)).filter((i: number) => !Number.isNaN(i)).slice(0, 200);
      return h.send_json({ job_id: await startJob("aiq_check", { step: "init", pid: p2, qids, platforms: b.platforms || [], auto: false }, "Đang bắt đầu…") });
    }
    if (method === "POST" && is("advise")) {
      const b = await h.read_json();
      const ids = (b.question_ids || []).map((i: any) => parseInt(i)).filter((i: number) => !Number.isNaN(i)).slice(0, 30);
      if (!ids.length) return h.send_json({ error: "Chọn ít nhất một câu hỏi" }, 400);
      return h.send_json({ job_id: await startJob("aiq_advise", { qids: ids }, `AI đang tư vấn 0/${ids.length} câu hỏi…`) });
    }
    if (method === "POST" && is("plan")) return h.send_json({ job_id: await startJob("aiq_plan", { pid: parseInt((await h.read_json()).project_id) }, "AI đang lập kế hoạch GEO…") });
    if (method === "POST" && is("tech")) return h.send_json({ job_id: await startJob("aiq_tech", { pid: parseInt((await h.read_json()).project_id) }, "Đang đọc robots.txt…") });
    if (method === "GET" && is("job", "*")) return h.send_json(await advance(seg[1]));
    if (method === "GET" && is("run", "*")) {
      const d = await runDetail(parseInt(seg[1]));
      return d ? h.send_json(d) : h.send_json({ error: "Không tìm thấy lần kiểm tra" }, 404);
    }
    if (method === "POST" && is("send-autopost")) {
      const b = await h.read_json();
      return h.send_json(await sendAutopost((b.question_ids || []).map((i: any) => parseInt(i)), parseInt(b.site_id) || 0));
    }
    if (method === "POST" && is("faq")) return h.send_json(await faqExport(((await h.read_json()).question_ids || []).map((i: any) => parseInt(i))));
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, /DataForSEO|Claude/.test(e.message) ? 502 : 400);
    if (e?.code === "42P01") return h.send_json({ error: MIGRATION }, 400);
    throw e;
  }
}
