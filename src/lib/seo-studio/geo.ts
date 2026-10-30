// @ts-nocheck
/**
 * Tối ưu AI Overview (GEO): lấy AI Overview thật của Google qua DataForSEO, so sánh với trang của bạn
 * và các trang đang được trích dẫn, rồi dùng Claude đề xuất cách sửa kèm đoạn nội dung viết sẵn.
 * Chuyển từ mrvu-seo-studio/geo.py. Quy trình chia 5 bước (mỗi lần giao diện hỏi tiến độ chạy một bước)
 * để mỗi lần gọi máy chủ không vượt giới hạn thời gian của Vercel. Thông báo tiến độ giữ nguyên chữ
 * vì geo.html dựa vào đó để tô sáng các bước.
 */
import { SeoError, extractJson, loadConfig, now, one, pyRound, q, run, uniq, vnNum } from "./core";
import { claude, dfsPost } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { faqSchema } from "./audit";
import { PageParser, bareHost, decode, fetchPage, header, netloc, schemaTypes as schemaTypesOf } from "./web";

const QUESTION_WORDS = /\?|(?<![\p{L}\p{N}_])(là gì|như thế nào|thế nào|có nên|có tốt|có tốn|bao nhiêu|tại sao|vì sao|cách|khi nào|ở đâu|loại nào|nên mua|so sánh|có phải|bao lâu|ra sao)(?![\p{L}\p{N}_])/iu;

const host = (u: string) => bareHost(netloc(u.includes("://") ? u : "https://" + u));
function sameSite(u: string, target: string) {
  const h = host(u), t = host(target);
  return Boolean(h) && (h === t || h.endsWith("." + t));
}
const words = (s: string) => String(s || "").split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------- 1. SERP + AI Overview
function walk(obj: any, fn: (d: any) => void) {
  if (Array.isArray(obj)) for (const v of obj) walk(v, fn);
  else if (obj && typeof obj === "object") {
    fn(obj);
    for (const v of Object.values(obj)) walk(v, fn);
  }
}

export async function fetchSerp(cfg: any, keyword: string, loc: number, lang: string, paaDepth = 1, limit = 8) {
  const [task, cost] = await dfsPost(cfg, "/v3/serp/google/organic/live/advanced", [{
    keyword, location_code: Number(loc), language_code: lang, device: "desktop",
    depth: 10, load_async_ai_overview: true, people_also_ask_click_depth: Number(paaDepth) }], 150);
  const res = (task.result || [{}])[0] || {};
  const items = res.items || [];
  const aioItem = items.find((i: any) => i.type === "ai_overview");

  let aio = null;
  if (aioItem) {
    const refs: any[] = [];
    const seen = new Set();
    const grab = (d: any, loose = false) => {
      const isRef = d.type === "ai_overview_reference" || (loose && d.url && d.domain && "source" in d);
      const u = d.url;
      if (isRef && u && !seen.has(u)) {
        seen.add(u);
        refs.push({ url: u, domain: d.domain || host(u), title: d.title || "", source: d.source || "", text: String(d.text || "").slice(0, 600) });
      }
    };
    for (const r of aioItem.references || []) if (r && typeof r === "object") grab(r, true);
    walk(aioItem.items || [], (d) => grab(d));
    let md = aioItem.markdown || "";
    if (!md) md = (aioItem.items || []).map((el: any) => el.markdown || el.text || "").filter(Boolean).join("\n\n");
    aio = { markdown: md.trim(), references: refs.slice(0, 20), async: aioItem.asynchronous_ai_overview ?? null };
  }

  const organic = items.filter((i: any) => i.type === "organic").slice(0, 10)
    .map((i: any) => ({ pos: i.rank_group, url: i.url, domain: i.domain, title: i.title, description: i.description || "" }));
  const paa: string[] = [];
  for (const i of items) if (i.type === "people_also_ask") for (const el of i.items || []) if (el.title) paa.push(el.title);
  const related: string[] = [];
  for (const i of items) if (i.type === "related_searches") for (const el of i.items || []) related.push(typeof el === "string" ? el : el.title || el.query || "");
  return { aio, organic, paa: uniq(paa).slice(0, limit), related: uniq(related).filter(Boolean).slice(0, limit), item_types: res.item_types || [], cost };
}

// ---------------------------------------------------------------- 2. Đọc trang
export async function readPage(url: string, limit = 9000, res: any = null) {
  res = res || (await fetchPage(url, 25));
  if (res.status !== 200) return { url, error: `HTTP ${res.status || res.error || "lỗi kết nối"}` };
  const html = decode(res);
  const p = new PageParser();
  try {
    p.feed(html);
  } catch {}
  const text = words(p.text.join(" ")).join(" ");
  const [types] = schemaTypesOf(p.jsonld);
  const h1 = p.headings.filter(([lv]) => lv === 1).map(([, t]) => t);
  // đoạn đầu tiên sau H1: lấy phần text ngay sau tiêu đề H1 trong text đã gộp
  let first = text;
  if (h1.length && h1[0] && text.includes(h1[0])) first = text.slice(text.indexOf(h1[0]) + h1[0].length);
  const robots = p.meta.robots || "";
  return {
    url: res.url, title: p.title || "", meta_description: p.meta.description || "",
    h1, headings: p.headings.filter(([, t]) => t).slice(0, 60), text: text.slice(0, limit), word_count: words(text).length,
    first_words: words(first).slice(0, 80).join(" "), schema: [...types].sort(),
    lists: (html.match(/<(ul|ol)\b/gi) || []).length, tables: (html.match(/<table\b/gi) || []).length,
    author: p.meta.author || (p.jsonld.join(" ").toLowerCase().includes("author") ? "Có trong schema" : "") || "",
    published: p.meta["article:published_time"] || "", modified: p.meta["article:modified_time"] || "",
    noindex: (robots + header(res, "x-robots-tag")).toLowerCase().includes("noindex"),
    nosnippet: robots.toLowerCase().includes("nosnippet") || robots.toLowerCase().includes("max-snippet:0"),
  };
}

// ---------------------------------------------------------------- 3. Kiểm tra cấu trúc (không cần AI)
export function structureChecks(page: any, keyword: string) {
  const C: any[] = [];
  const add = (label: string, status: string, value: string, fix: string, weight: number) => C.push({ label, status, value, fix, weight });

  if (page.noindex || page.nosnippet) {
    add("Cho phép Google dùng nội dung", "fail", "Trang có noindex/nosnippet",
      "Google không thể trích dẫn trang đang chặn index hoặc chặn đoạn trích. Gỡ noindex, nosnippet, max-snippet:0 trong thẻ meta robots.", 30);
  }
  const kw = keyword.toLowerCase();
  const fw = words(page.first_words.toLowerCase()).slice(0, 60).join(" ");
  const fwSet = new Set(words(fw));
  const toks = words(kw).filter((w) => w.length > 1);
  const hit = toks.filter((w) => fwSet.has(w)).length / Math.max(1, toks.length);
  const direct = fw.includes(kw) || hit >= 0.7;
  add("Trả lời ngay đầu bài", direct && words(page.first_words).length >= 30 ? "pass" : "warn",
    page.first_words ? page.first_words.slice(0, 220) + "…" : "Không đọc được đoạn mở đầu",
    "Ngay dưới H1, viết 1 đoạn 40–60 chữ trả lời thẳng câu hỏi của từ khóa (định nghĩa, con số, kết luận). AI Overview thường lấy đúng kiểu đoạn này.", 15);
  const qh = page.headings.filter(([lv, t]: any) => (lv === 2 || lv === 3) && QUESTION_WORDS.test(t)).map(([, t]: any) => t);
  add("Heading dạng câu hỏi", qh.length >= 2 ? "pass" : "warn", qh.length ? `${qh.length} heading: ` + qh.slice(0, 4).join(" | ") : "Không có",
    "Đặt H2/H3 theo đúng câu người dùng hỏi (ví dụ: “Quạt trần có tốn điện không?”, “Nên chọn sải cánh bao nhiêu?”), mỗi heading trả lời ngắn gọn ngay câu đầu.", 10);
  add("Danh sách / bảng", page.lists + page.tables >= 2 ? "pass" : "warn", `${page.lists} danh sách, ${page.tables} bảng`,
    "Trình bày các bước, tiêu chí, so sánh bằng danh sách gạch đầu dòng hoặc bảng. AI Overview hay trích nguyên dạng danh sách/bảng.", 8);
  const faq = page.schema.includes("FAQPage");
  const good = ["Article", "BlogPosting", "NewsArticle", "HowTo", "Product"].some((t) => page.schema.includes(t));
  add("Schema hỗ trợ", faq || good ? "pass" : "warn", page.schema.join(", ") || "Chưa có",
    "Thêm schema Article/BlogPosting (có tác giả, ngày cập nhật) và FAQPage cho mục câu hỏi thường gặp để Google hiểu rõ nội dung.", 7);
  const trust = Number(Boolean(page.author)) + Number(Boolean(page.modified || page.published));
  add("Tín hiệu tin cậy (tác giả, ngày cập nhật)", trust === 2 ? "pass" : "warn",
    `Tác giả: ${page.author || "không thấy"} · Ngày: ${String(page.modified || page.published || "không thấy").slice(0, 10)}`,
    "Ghi rõ tác giả có chuyên môn (kèm giới thiệu ngắn) và ngày cập nhật gần nhất. Google ưu tiên nguồn thể hiện kinh nghiệm, chuyên môn, độ tin cậy (E-E-A-T).", 8);
  const wc = page.word_count;
  add("Độ sâu nội dung", wc >= 700 ? "pass" : wc >= 300 ? "warn" : "fail", `${vnNum(wc)} chữ`,
    "Bổ sung nội dung trả lời đủ các ý con của chủ đề (xem bảng độ phủ). Trang quá mỏng hiếm khi được AI Overview chọn.", 7);
  return C;
}

// ---------------------------------------------------------------- 4. Claude phân tích
async function aiAnalyze(cfg: any, keyword: string, page: any, serp: any, competitors: any[], checks: any[]) {
  const aio = serp.aio;
  const compTxt = competitors.map((c, i) => [c, i] as const).filter(([c]) => !c.error)
    .map(([c, i]) => `[Nguồn ${i + 1}] ${c.url}\nĐoạn Google trích: ${String(c.cited_text || "").slice(0, 500)}\nNội dung trang (rút gọn): ${String(c.text || "").slice(0, 2500)}`)
    .join("\n\n");
  const issues = checks.map((c) => `- ${c.label}: ${c.status} (${String(c.value).slice(0, 120)})`).join("\n");
  const heads = page.headings.slice(0, 40).map(([lv, t]: any) => `H${lv}: ${t}`).join("\n");
  const prompt = `Bạn là chuyên gia GEO (tối ưu để được Google AI Overview trích dẫn) cho website tiếng Việt.

Từ khóa: "${keyword}"
Trang cần tối ưu: ${page.url}
Trang này ${serp.cited ? "ĐANG được AI Overview trích dẫn" : "CHƯA được AI Overview trích dẫn"}.

=== AI OVERVIEW HIỆN TẠI CỦA GOOGLE ===
${String(aio?.markdown || "").slice(0, 5000)}

=== CÁC NGUỒN ĐANG ĐƯỢC TRÍCH DẪN ===
${compTxt || "(không đọc được)"}

=== CÂU HỎI LIÊN QUAN (People also ask) ===
${(serp.paa || []).join("\n") || "(không có)"}

=== TRANG CỦA BẠN ===
Title: ${page.title}
Meta description: ${page.meta_description}
Heading:
${heads}
Nội dung (rút gọn):
"""${page.text.slice(0, 7000)}"""

=== KIỂM TRA CẤU TRÚC TỰ ĐỘNG ===
${issues}

Nhiệm vụ: so sánh trang của bạn với AI Overview và các nguồn được trích, chỉ ra vì sao trang chưa/được chọn, và đưa đoạn nội dung viết sẵn để chèn.
Chỉ dựa vào thông tin ở trên; không bịa số liệu, giá, thông số. Nếu cần con số mà trang chưa có, ghi rõ [CẦN ĐIỀN: ...].
Chỉ trả về JSON hợp lệ:
{
  "summary": "2-3 câu nhận định tổng quan",
  "coverage_score": 0-100,
  "aio_points": [{"point": "một ý AI Overview đang nêu", "covered": "yes|partial|no", "note": "trang bạn nói ở đâu / thiếu gì"}],
  "why_sources_win": ["lý do cụ thể các nguồn kia được chọn"],
  "answer_box": "đoạn 40-60 chữ trả lời thẳng câu hỏi, đặt ngay dưới H1",
  "fixes": [{"priority": 1, "action": "việc cần làm", "why": "vì sao", "placement": "chèn ở đâu", "snippet": "nội dung viết sẵn (văn bản hoặc HTML đơn giản), có thể rỗng"}],
  "faq": [{"q": "câu hỏi", "a": "trả lời 1-3 câu"}],
  "missing_entities": ["khái niệm, thông số, thương hiệu mà AI Overview/nguồn nhắc nhưng trang bạn chưa có"],
  "better_title": "đề xuất title mới nếu cần, hoặc rỗng"
}
fixes: 4-8 việc, sắp theo mức ảnh hưởng. faq: 3-5 câu, ưu tiên câu trong People also ask.`;
  const [txt, usage] = await claude(cfg, prompt, 10000, null, "geo");
  const out = extractJson(txt);
  out.usage = usage;
  return out;
}

// ---------------------------------------------------------------- 5. Quy trình (từng bước)
const MSG = {
  serp: "Đang lấy kết quả Google và AI Overview…",
  page: "Đang đọc trang của bạn…",
  comps: "Đang đọc các trang được AI Overview trích dẫn…",
  ai: "AI đang so sánh và viết đề xuất sửa…",
};

registerStep("geo", async (job, ctx) => {
  const st = job.state;
  const cfg = await loadConfig();
  if (st.step === "serp") {
    const serp: any = await fetchSerp(cfg, st.keyword, st.loc, st.lang);
    const aio = serp.aio;
    serp.cited = Boolean(aio && aio.references.some((r: any) => sameSite(r.url, st.url)));
    serp.cited_exact = Boolean(aio && aio.references.some((r: any) => r.url.replace(/\/+$/, "") === st.url.replace(/\/+$/, "")));
    st.serp = serp;
    st.step = "page";
    ctx.progress(MSG.page);
    return;
  }
  if (st.step === "page") {
    const page: any = await readPage(st.url);
    if (page.error) throw new SeoError(`Không đọc được trang ${st.url}: ${page.error}`);
    st.page = page;
    st.checks = structureChecks(page, st.keyword);
    if (st.serp.aio) {
      st.step = "comps";
      ctx.progress(MSG.comps);
    } else st.step = "save";
    return;
  }
  if (st.step === "comps") {
    const others = st.serp.aio.references.filter((r: any) => !sameSite(r.url, st.url)).slice(0, 4);
    const pages = await Promise.all(others.map((r: any) => readPage(r.url, 4000)));
    st.competitors = others.map((r: any, i: number) => ({ ...pages[i], cited_text: r.text || "", domain: r.domain }));
    if (cfg.anthropic_api_key) {
      st.step = "ai";
      ctx.progress(MSG.ai);
    } else {
      st.ai_error = "Chưa có khóa Claude API nên chưa có phần phân tích độ phủ và đoạn viết sẵn. Đặt ANTHROPIC_API_KEY trong biến môi trường.";
      st.step = "save";
    }
    return;
  }
  if (st.step === "ai") {
    try {
      const ai = await aiAnalyze(cfg, st.keyword, st.page, st.serp, st.competitors || [], st.checks);
      if (ai.faq?.length) ai.faq_schema = faqSchema(ai.faq);
      st.ai = ai;
    } catch (e: any) {
      st.ai_error = String(e?.message || e);
    }
    st.step = "save";
    // không return: lưu luôn trong bước này
  }
  if (st.step === "save") return { done: await save(st) };
  throw new SeoError("Trạng thái GEO không hợp lệ");
});

async function save(st: any) {
  const { serp, page, checks, keyword, loc } = st;
  const aio = serp.aio;
  const ai = st.ai || null;
  const competitors = st.competitors || [];
  const myOrg = serp.organic.find((o: any) => sameSite(o.url || "", st.url)) || null;

  // Điểm GEO /100
  const soft = checks.filter((c: any) => c.weight < 30);
  const structMax = soft.reduce((a: number, c: any) => a + c.weight, 0);
  const structGot = soft.reduce((a: number, c: any) => a + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const structPct = structMax ? structGot / structMax : 0;
  const blocked = checks.some((c: any) => c.weight >= 30);
  let score = null;
  if (aio) {
    const citePts = serp.cited ? 30 : myOrg && myOrg.pos <= 5 ? 12 : myOrg ? 6 : 0;
    const cov = ai?.coverage_score;
    if (cov !== undefined && cov !== null) score = pyRound(citePts + (40 * Math.min(100, Math.max(0, Number(cov)))) / 100 + 30 * structPct);
    else score = pyRound(((citePts + 30 * structPct) / 60) * 100);
    if (blocked) score = Math.min(score, 10);
  }

  const report: any = {
    url: page.url, keyword, location: String(loc), created_at: now(),
    has_aio: Boolean(aio), cited: serp.cited, cited_exact: serp.cited_exact,
    organic_position: myOrg ? myOrg.pos : null, score, structure_score: pyRound(structPct * 100),
    aio, organic: serp.organic, paa: serp.paa, related: serp.related,
    checks, ai, ai_error: st.ai_error || null,
    competitors: competitors.map((c: any) => ({ url: c.url, domain: c.domain, word_count: c.word_count, schema: c.schema, lists: c.lists, tables: c.tables, error: c.error })),
    page: { title: page.title, meta_description: page.meta_description, word_count: page.word_count, schema: page.schema, lists: page.lists, tables: page.tables },
    cost: serp.cost,
  };
  const ins = await run(
    "INSERT INTO seo_geo_checks(created_at, url, keyword, location, score, has_aio, cited, report_json) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
    [report.created_at, report.url, keyword, String(loc), score, aio ? 1 : 0, serp.cited ? 1 : 0, JSON.stringify(report)]);
  return ins.rows[0].id;
}

export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3);
  try {
    if (method === "POST" && seg.length === 1 && seg[0] === "analyze") {
      const b = await h.read_json();
      let url = String(b.url || "").trim();
      const kw = words(b.keyword || "").join(" ");
      if (!url.includes(".") || !kw) return h.send_json({ error: "Nhập URL trang và từ khóa mục tiêu." }, 400);
      const cfg = await loadConfig();
      if (!(cfg.login && cfg.password)) throw new SeoError("Cần tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD) để lấy AI Overview thật của Google.");
      if (!url.startsWith("http")) url = "https://" + url;
      const jid = await startJob("geo", { step: "serp", url, keyword: kw, loc: parseInt(b.location_code) || 2704, lang: b.language_code || "vi" }, MSG.serp);
      return h.send_json({ job_id: jid });
    }
    if (method === "GET" && seg.length === 2 && seg[0] === "job") return h.send_json(await advance(seg[1]));
    if (method === "GET" && seg.length === 1 && seg[0] === "history") {
      const rows = await q("SELECT id, created_at, url, keyword, score, has_aio, cited FROM seo_geo_checks ORDER BY id DESC LIMIT 200");
      return h.send_json({ items: rows });
    }
    if (seg.length === 2 && seg[0] === "report") {
      if (method === "DELETE") {
        await run("DELETE FROM seo_geo_checks WHERE id=?", [seg[1]]);
        return h.send_json({ ok: true });
      }
      const r = await one("SELECT id, report_json FROM seo_geo_checks WHERE id=?", [seg[1]]);
      if (!r) return h.send_json({ error: "Không tìm thấy lần kiểm tra này" }, 404);
      const rep = JSON.parse(r.report_json);
      rep.id = r.id;
      return h.send_json(rep);
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
}
