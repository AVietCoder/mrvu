// @ts-nocheck
/**
 * Gợi ý chủ đề cho Autopost: từ chủ đề + website của bạn + tối đa 3 đối thủ, tìm khoảng trống nội dung,
 * gom nhóm từ khóa thành bài viết, chấm điểm ưu tiên, rồi đưa vào hàng chờ viết bài (kèm "brief" cho AI viết).
 * Chuyển từ mrvu-seo-studio/topics.py (bản 19/10/2026). Khác bản gốc vì chạy trên Vercel:
 *   - Phân tích là tác vụ nhiều bước (website của bạn → từng đối thủ → DataForSEO → AI); mỗi lần giao
 *     diện hỏi tiến độ chạy một bước. Đọc sitemap dùng chung bộ quét từng bước của Audit (crawlStep).
 *   - Đối thủ đọc lần lượt (bản gốc đọc song song 3 luồng).
 *
 * Nguồn dữ liệu:
 * - Miễn phí: sitemap đối thủ và website của bạn (bộ quét của Audit), bài đã viết, hàng chờ, Search Console.
 * - Trả phí (chế độ đầy đủ): DataForSEO Labs (từ khóa liên quan, từ khóa đối thủ đang lên Top, từ khóa của bạn).
 *   Nếu Labs không hỗ trợ khu vực/ngôn ngữ, tự chuyển sang Google Ads (keywords_for_keywords / keywords_for_site).
 */
import { SeoError, extractJson, loadConfig, nowUtc, one, pyRound, q, run, uniq } from "./core";
import { claude, dfsPost } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { classify, crawlStep } from "./audit";
import { urlParts } from "./web";

const MAX_COMPETITORS = 3;
const INTENT_W: Record<string, number> = { informational: 1.0, commercial: 1.25, transactional: 0.8, navigational: 0.3 };
const STOP = new Set(`cach chon co khong nao tot gia bao nhieu loai cua cho va la nhu the gi tai sao voi mot cac nhung nen mua o dau hay
hoac nha tren duoi trong ngoai den tu ra vao duoc bi rat qua nhat hon kieu mau moi cu re dep top review danh gia so sanh
huong dan kinh nghiem meo khi thi se da dang dung lam ve sau truoc nay kia day do ay ban toi minh chung ta hien nay nam`.split(/\s+/));

// ---------------------------------------------------------------- tiện ích chữ
/** Bỏ dấu, viết thường: 'Quạt trần' → 'quat tran'. */
export function fold(s: any) {
  const t = String(s ?? "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/\p{Mn}/gu, "");
  return t.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean).join(" ");
}

function hostOf(u: any) {
  u = String(u ?? "").trim().toLowerCase();
  if (!u.includes("://")) u = "https://" + u;
  const h = urlParts(u).netloc.split(":")[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

/** Đường dẫn bài → cụm chữ đọc được: /tin-tuc/cach-chon-quat-tran.html → 'cach chon quat tran'. */
export function slugText(url: string) {
  let path = urlParts(url).path;
  try {
    path = decodeURIComponent(path);
  } catch {}
  path = path.replace(/\/+$/, "");
  let seg = path ? path.split("/").pop() : "";
  seg = seg.replace(/\.(html?|aspx?|php)$/i, "");
  seg = seg.replace(/(^|[-_])(p|id|n)?\d{3,}($|[-_])/g, " ");
  const words = seg.split(/[-_+\s]+/).filter((w) => w && !/^\d+$/.test(w));
  return words.length >= 3 ? words.join(" ") : "";
}

function bigrams(text: string): Set<string> {
  const w = fold(text).split(" ").filter((x) => x && !STOP.has(x) && x.length > 1);
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) out.add(w[i] + " " + w[i + 1]);
  if (w.length === 1) out.add(w[0]);
  return out;
}
const intersects = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

// ---------------------------------------------------------------- nội dung website
async function auditPagesOf(domain: string): Promise<[string, string][]> {
  const rows = await q("SELECT p.url, p.type FROM seo_audit_pages p JOIN seo_audit_sites s ON s.id=p.site_id WHERE s.domain=?", [domain]);
  return rows.map((r: any) => [r.url, r.type]);
}

/** Lấy cụm chữ từ đường dẫn, ưu tiên bài viết rồi tới trang khác (bỏ trang chủ, danh mục). */
function contentTitles(pages: [string, string][], limit: number): [string, string][] {
  const out: [string, string][] = [];
  for (const kind of ["post", "other", "product"]) {
    for (const [u, t] of pages) {
      if (t !== kind) continue;
      const s = slugText(u);
      if (s) out.push([s, u]);
    }
  }
  const seen = new Set<string>();
  return out.filter(([s]) => (seen.has(s) ? false : (seen.add(s), true))).slice(0, limit);
}

/** Lưu danh sách trang website của bạn vào dữ liệu Audit, để lần sau và AI viết bài dùng làm link nội bộ. */
async function rememberPages(domain: string, pages: [string, string][], method: string) {
  await run("INSERT INTO seo_audit_sites(domain) VALUES (?) ON CONFLICT (domain) DO NOTHING", [domain]);
  const sid = (await one("SELECT id FROM seo_audit_sites WHERE domain=?", [domain])).id;
  for (let i = 0; i < pages.length; i += 400) {
    const part = pages.slice(i, i + 400);
    await run(`INSERT INTO seo_audit_pages(site_id, url, type, source) VALUES ${part.map(() => "(?,?,?,?)").join(",")} ON CONFLICT (site_id, url) DO NOTHING`,
      part.flatMap(([u, t]) => [sid, u, t, "topics"]));
  }
  const n = (await one("SELECT COUNT(*) n FROM seo_audit_pages WHERE site_id=?", [sid])).n;
  await run("UPDATE seo_audit_sites SET start_url=COALESCE(start_url, ?), crawled_at=?, method=?, count=? WHERE id=?", [`https://${domain}/`, nowUtc(), method, n, sid]);
}

async function myContent(site: any, domain: string, pages: [string, string][], src: string) {
  const posts = (await q("SELECT title FROM seo_ap_posts WHERE site_id=? ORDER BY id DESC LIMIT 150", [site.id])).map((r: any) => r.title);
  const queue = (await q("SELECT keyword FROM seo_ap_keywords WHERE site_id=?", [site.id])).map((r: any) => r.keyword);
  let gsc: any[] = [];
  const cfg = await loadConfig();
  if (hostOf(String(cfg.gsc_site || "").replace("sc-domain:", "")) === domain) {
    try {
      gsc = await q(`SELECT query, SUM(impressions) impr, SUM(clicks) clicks, MIN(position) pos FROM seo_gsc_rows
                     WHERE period='cur' GROUP BY query ORDER BY impr DESC LIMIT 150`);
    } catch {
      gsc = [];
    }
  }
  const links = pages.filter(([, t]) => t === "category" || t === "product").map(([u]) => u).slice(0, 80);
  return { pages_count: pages.length, source: src, titles: contentTitles(pages, 200), posts, queue, gsc, link_targets: links };
}

// ---------------------------------------------------------------- DataForSEO
const labsItems = (task: any) => ((task.result || [{}])[0] || {}).items || [];
const normKw = (k: any) => String(k ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const fatalDfs = (e: any) => /hết tiền|Sai tài khoản/.test(String(e?.message || e));

/** Chuẩn hóa một dòng từ khóa của Labs (keyword_data hoặc dòng phẳng). */
function kwRow(kd: any, extra: any = {}) {
  const info = kd.keyword_info || {};
  const props = kd.keyword_properties || {};
  return {
    keyword: normKw(kd.keyword), volume: info.search_volume ?? null, kd: props.keyword_difficulty ?? null,
    intent: (kd.search_intent_info || {}).main_intent ?? null, cpc: info.cpc ?? null, ...extra,
  };
}

async function seedKeywords(cfg: any, seed: string, loc: number, lang: string, notes: string[]) {
  const rows: any[] = [];
  try {
    let [t] = await dfsPost(cfg, "/v3/dataforseo_labs/google/keyword_suggestions/live", [{
      keyword: seed, location_code: loc, language_code: lang, limit: 150, include_seed_keyword: true, order_by: ["keyword_info.search_volume,desc"] }]);
    rows.push(...labsItems(t).map((i: any) => kwRow(i)));
    [t] = await dfsPost(cfg, "/v3/dataforseo_labs/google/related_keywords/live", [{ keyword: seed, location_code: loc, language_code: lang, depth: 1, limit: 150 }]);
    rows.push(...labsItems(t).map((i: any) => kwRow(i.keyword_data || {})));
  } catch (e: any) {
    if (!(e instanceof SeoError) || fatalDfs(e)) throw e;
    notes.push(`DataForSEO Labs chưa hỗ trợ khu vực này (${e.message}); chuyển sang dữ liệu Google Ads.`);
    const [t] = await dfsPost(cfg, "/v3/keywords_data/google_ads/keywords_for_keywords/live", [{ keywords: [seed], location_code: loc, language_code: lang, sort_by: "search_volume" }]);
    rows.push(...(t.result || []).slice(0, 300).map((i: any) => ({ keyword: normKw(i.keyword), volume: i.search_volume ?? null, kd: i.competition_index ?? null, intent: null, cpc: i.cpc ?? null })));
  }
  return rows;
}

/** Từ khóa một tên miền đang có thứ hạng Top 20 (Labs), hoặc từ khóa Google Ads gợi ý cho website đó. */
async function rankedKeywords(cfg: any, domain: string, loc: number, lang: string, limit: number, notes: string[]): Promise<[any[], string]> {
  try {
    const [t] = await dfsPost(cfg, "/v3/dataforseo_labs/google/ranked_keywords/live", [{
      target: domain, location_code: loc, language_code: lang, limit,
      filters: ["ranked_serp_element.serp_item.rank_group", "<=", 20], order_by: ["keyword_data.keyword_info.search_volume,desc"] }]);
    return [labsItems(t).map((i: any) => {
      const it = (i.ranked_serp_element || {}).serp_item || {};
      return kwRow(i.keyword_data || {}, { pos: it.rank_group ?? null, url: it.url ?? null });
    }), "ranked"];
  } catch (e: any) {
    if (!(e instanceof SeoError) || fatalDfs(e)) throw e;
    notes.push(`Không lấy được từ khóa đang lên Top của ${domain} (${e.message}); dùng từ khóa Google Ads gợi ý cho website.`);
    let t;
    try {
      [t] = await dfsPost(cfg, "/v3/keywords_data/google_ads/keywords_for_site/live", [{ target: domain, target_type: "site", location_code: loc, language_code: lang, sort_by: "search_volume" }]);
    } catch (e2: any) {
      if (!(e2 instanceof SeoError)) throw e2;
      notes.push(`${domain}: ${e2.message}`);
      return [[], "none"];
    }
    return [(t.result || []).slice(0, limit).map((i: any) => ({ keyword: normKw(i.keyword), volume: i.search_volume ?? null, kd: i.competition_index ?? null, intent: null, pos: null, url: null })), "site"];
  }
}

// ---------------------------------------------------------------- AI
async function aiCluster(cfg: any, ctx: any) {
  const compTxt = Object.entries(ctx.comp_titles).map(([d, titles]: any) => `### ${d}\n` + titles.slice(0, 130).map(([s]: any) => `- ${s}`).join("\n")).join("\n") || "(không có)";
  const cand = ctx.candidates.slice(0, 260);
  const candTxt = cand.map((c: any) => `- ${c.keyword} | vol ${c.volume !== null && c.volume !== undefined ? c.volume : "?"} | đối thủ: ${(c.comps || []).join(", ") || "-"}`).join("\n")
    || "(không có dữ liệu volume — chế độ tiết kiệm)";
  let mineTxt = ctx.mine.titles.slice(0, 160).map(([s]: any) => `- ${s}`).join("\n");
  mineTxt += ctx.mine.posts.slice(0, 80).map((t: string) => `\n- (bài đã viết) ${t}`).join("");
  mineTxt += ctx.mine.queue.slice(0, 120).map((k: string) => `\n- (hàng chờ) ${k}`).join("");
  const gscTxt = ctx.mine.gsc.slice(0, 100).filter((g: any) => g.pos).map((g: any) => `- ${g.query} | hiển thị ${g.impr} | vị trí ${Number(g.pos).toFixed(0)}`).join("\n");
  const rankTxt = ctx.my_ranked.slice(0, 120).filter((r: any) => r.pos).map((r: any) => `- ${r.keyword} | Top ${r.pos}`).join("\n");
  const links = ctx.mine.link_targets.slice(0, 80).join("\n") || "(không có)";
  const prompt = `Bạn là chuyên gia SEO nội dung tiếng Việt. Lập danh sách CHỦ ĐỀ BÀI VIẾT NÊN VIẾT cho website ${ctx.domain} (website: ${ctx.site_name}).

Chủ đề người dùng muốn phát triển: "${ctx.seed}"

## Website của bạn đã có (đường dẫn bài, bài đã viết, hàng chờ)
${mineTxt || "(chưa có)"}

## Từ khóa website của bạn đang có hiển thị trên Google (Search Console)
${gscTxt || "(không có)"}

## Từ khóa website của bạn đang có thứ hạng
${rankTxt || "(không có)"}

## Bài viết của đối thủ (lấy từ đường dẫn trong sitemap, chữ không dấu)
${compTxt}

## Từ khóa ứng viên (từ chủ đề và từ đối thủ đang lên Top)
${candTxt}

## Trang danh mục/sản phẩm trên website của bạn (để gắn link từ bài viết)
${links}

Nhiệm vụ:
1. Chỉ giữ chủ đề LIÊN QUAN tới "${ctx.seed}" và phù hợp lĩnh vực của website. Bỏ từ khóa thương hiệu đối thủ, từ khóa điều hướng.
2. Gom các từ khóa CÙNG Ý ĐỊNH TÌM KIẾM thành MỘT bài (không tách bài cho từng biến thể). Mỗi bài 1 từ khóa chính + 2-8 từ khóa phụ.
3. Đánh dấu "covered" nếu website của bạn ĐÃ có bài/hàng chờ cùng ý định (ghi rõ bài nào); vẫn liệt kê nhưng để covered.
4. Ưu tiên chủ đề đối thủ đã viết hoặc đang lên Top mà website của bạn chưa có (khoảng trống).
5. Xác định 1-3 bài TRỤ CỘT (pillar, bao quát) và các bài VỆ TINH (cluster) trỏ về bài trụ cột.
6. Nhận xét chủ đề "${ctx.seed}" có hợp với website không (ví dụ website làm mát công nghiệp mà chủ đề là đồ gia dụng).
7. Tối đa 30 bài. Từ khóa chính viết có dấu, tự nhiên như người Việt tìm trên Google.

Chỉ trả về JSON hợp lệ:
{
  "site_fit": {"ok": true, "note": "nhận xét ngắn về mức phù hợp của chủ đề với website"},
  "summary": "2-3 câu tóm tắt cơ hội nội dung",
  "clusters": [
    {
      "main_keyword": "từ khóa chính có dấu",
      "keywords": ["từ khóa phụ 1", "từ khóa phụ 2"],
      "title": "tiêu đề gợi ý 50-65 ký tự",
      "angle": "góc viết: hướng dẫn / so sánh / giải đáp / danh sách / review... và điểm khác biệt so với bài đối thủ",
      "intent": "informational|commercial|transactional",
      "type": "pillar|cluster",
      "pillar": "từ khóa chính của bài trụ cột mà bài này trỏ về (bỏ trống nếu là pillar)",
      "competitors": ["tên miền đối thủ đã viết chủ đề này"],
      "covered": null,
      "link_target": "1 URL lấy từ danh sách trang danh mục/sản phẩm, hoặc rỗng",
      "priority": 1,
      "reason": "vì sao nên viết (1 câu)"
    }
  ]
}
"priority": 3 = nên viết ngay, 2 = nên viết, 1 = có thể viết sau. "covered": null hoặc chuỗi mô tả bài đã có.`;
  const [txt] = await claude(cfg, prompt, 9000, null, "topics");
  return extractJson(txt, "AI không trả về kết quả hợp lệ, hãy thử lại.");
}

// ---------------------------------------------------------------- chấm điểm
export function scoreClusters(clusters: any[], candMap: Record<string, any>, mine: any, myRanked: any[], hasVolume: boolean) {
  const myKw = new Set([...mine.queue.map(fold), ...mine.posts.map(fold)]);
  const mySlugs = new Set(mine.titles.map(([s]: any) => fold(s)));
  const myRank = new Map(myRanked.filter((r) => r.pos).map((r) => [fold(r.keyword), r]));
  const gsc = new Map(mine.gsc.map((g: any) => [fold(g.query), g]));
  const allowedLinks = new Set(mine.link_targets);
  const out: any[] = [];
  (clusters || []).forEach((c: any, i: number) => {
    const main = String(c.main_keyword ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (!main) return;
    const kws = uniq((c.keywords || []).map((x: any) => String(x).split(/\s+/).filter(Boolean).join(" ")))
      .filter((k: string) => k && k.toLowerCase() !== main.toLowerCase()).slice(0, 10);
    const allk = [main, ...kws];
    const vol = allk.map((k) => candMap[fold(k)]?.volume).filter((v) => v).reduce((a: number, b: number) => a + b, 0);
    const kds = allk.map((k) => candMap[fold(k)]?.kd).filter((x) => x !== null && x !== undefined);
    const kd = kds.length ? pyRound(kds.reduce((a: number, b: number) => a + b, 0) / kds.length) : null;
    const intent = String(c.intent || candMap[fold(main)]?.intent || "informational").toLowerCase();
    const comps: string[] = uniq((c.competitors || []).filter(Boolean));
    for (const k of allk) for (const d of candMap[fold(k)]?.comps || []) if (!comps.includes(d)) comps.push(d);
    let covered = c.covered || null;
    const fm = fold(main);
    if (!covered) {
      if (myKw.has(fm)) covered = "Đã có trong hàng chờ hoặc bài đã viết";
      else if (mySlugs.has(fm)) covered = "Website đã có bài cùng đường dẫn";
      else if (myRank.has(fm) && (myRank.get(fm).pos || 99) <= 10) covered = `Website đang Top ${myRank.get(fm).pos} với từ này`;
    }
    const pr = Math.max(1, Math.min(3, parseInt(c.priority) || 2));
    let raw = hasVolume
      ? Math.log10(vol + 10) * (INTENT_W[intent] ?? 1.0) * (1 - (kd || 30) / 160) * (1 + 0.2 * comps.length) * (0.8 + 0.15 * pr)
      : (INTENT_W[intent] ?? 1.0) * (1 + 0.35 * comps.length) * (0.6 + 0.4 * pr);
    const g: any = gsc.get(fm);
    if (g && (g.pos || 99) > 10) raw *= 1.15; // đã có hiển thị nhưng chưa vào Top 10: viết bài riêng dễ lên
    const link = allowedLinks.has(c.link_target) ? c.link_target : "";
    out.push({
      id: i + 1, main_keyword: main, keywords: kws, title: c.title || main, angle: c.angle || "",
      intent, type: c.type === "pillar" ? "pillar" : "cluster", pillar: c.pillar || "",
      competitors: comps.slice(0, MAX_COMPETITORS), covered, link_target: link, reason: c.reason || "",
      volume: hasVolume ? vol : null, kd, priority: pr, raw,
      gsc: g ? { impr: g.impr, pos: pyRound(Number(g.pos), 1) } : null, added: false,
    });
  });
  const top = Math.max(...(out.filter((o) => !o.covered).map((o) => o.raw)), 0) || 1;
  for (const o of out) {
    o.score = Math.max(1, Math.min(100, pyRound((o.raw / top) * 100)));
    delete o.raw;
    if (o.covered) o.score = Math.min(o.score, 30);
  }
  out.sort((a, b) => Number(a.covered !== null) - Number(b.covered !== null) || b.score - a.score);
  return out;
}

// ---------------------------------------------------------------- lưu / hàng chờ
const spentTotal = async () => Number((await one("SELECT COALESCE(SUM(usd),0) s FROM seo_spend"))?.s || 0);

export async function loadRun(rid: any) {
  const r = await one("SELECT * FROM seo_tp_runs WHERE id=?", [rid]);
  if (!r) return null;
  const res = JSON.parse(r.result_json);
  return { ...res, id: r.id, created_at: r.created_at, site_id: r.site_id, cost_usd: r.cost_usd };
}

async function saveResult(rid: any, res: any) {
  const { id, created_at, site_id, cost_usd, ...keep } = res;
  await run("UPDATE seo_tp_runs SET result_json=? WHERE id=?", [JSON.stringify(keep), rid]);
}

const briefOf = (c: any, res: any) => ({
  keywords: c.keywords, title: c.title, angle: c.angle, intent: c.intent, type: c.type, pillar: c.pillar,
  link_target: c.link_target, competitors: c.competitors, seed: res.seed, run_id: res.id ?? null,
});

async function addToQueue(rid: any, ids: any[]) {
  const res = await loadRun(rid);
  if (!res) throw new SeoError("Không tìm thấy lần phân tích này.");
  const want = new Set(ids.map((i) => parseInt(i)));
  let added = 0, skipped = 0;
  const t = nowUtc();
  for (const c of res.clusters) {
    if (!want.has(c.id)) continue;
    const r = await run(
      "INSERT INTO seo_ap_keywords(site_id, keyword, status, brief_json, created_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (site_id, keyword) DO NOTHING",
      [res.site_id, c.main_keyword, "pending", JSON.stringify(briefOf(c, res)), t, t]);
    if (r.count) added++;
    else skipped++;
    c.added = true;
  }
  await saveResult(rid, res);
  return { added, skipped };
}

// ---------------------------------------------------------------- kiểm tra lệch chủ đề (miễn phí)
async function siteVocab(siteId: any): Promise<[any, Set<string>, string]> {
  const s = await one("SELECT * FROM seo_ap_sites WHERE id=?", [siteId]);
  if (!s) return [null, new Set(), ""];
  const domain = hostOf(s.url);
  const texts = [s.name || "", s.category_name || "", s.extra_prompt || ""];
  texts.push(...(await q("SELECT p.url FROM seo_audit_pages p JOIN seo_audit_sites a ON a.id=p.site_id WHERE a.domain=? LIMIT 800", [domain])).map((r: any) => slugText(r.url)));
  texts.push(...(await q("SELECT title FROM seo_ap_posts WHERE site_id=? LIMIT 200", [siteId])).map((r: any) => r.title));
  texts.push(...(await q("SELECT keyword FROM seo_ap_keywords WHERE site_id=? LIMIT 300", [siteId])).map((r: any) => r.keyword));
  const vocab = new Set<string>();
  for (const t of texts) for (const b of bigrams(t)) vocab.add(b);
  return [s, vocab, fold(domain.split(".")[0]).replace(/ /g, "")];
}

async function fitCheck(siteId: any, keywords: any[]) {
  const [s, vocab, hostFlat] = await siteVocab(siteId);
  if (!s) return { checked: false, mismatched: [], note: "" };
  const kws = keywords.map((k) => String(k).split(/\s+/).filter(Boolean).join(" ")).filter(Boolean);
  if (vocab.size < 8) return { checked: false, mismatched: [], note: "Website chưa có đủ dữ liệu để kiểm tra (hãy quét website ở tab Audit)." };
  const bad: string[] = [];
  for (const k of kws) {
    const bg = bigrams(k);
    const flat = [...bg].map((b) => b.replace(/ /g, ""));
    if (!intersects(bg, vocab) && !flat.some((f) => f && hostFlat.includes(f))) bad.push(k);
  }
  const note = bad.length
    ? `${bad.length}/${kws.length} từ khóa không khớp nội dung hiện có của website ${s.name}. Kiểm tra lại đã chọn đúng website chưa, để tránh AI viết bài lệch chủ đề.`
    : "";
  return { checked: true, mismatched: bad, note };
}

// ---------------------------------------------------------------- quy trình (từng bước)
/** Bọc ctx của bước cho bộ quét Audit: thông báo tiến độ theo kiểu "Đang đọc … (domain): N trang…". */
function crawlCtx(ctx: any, sub: any, label: string, domain: string) {
  return {
    deadline: ctx.deadline,
    extra: {},
    progress: () => ctx.progress(`Đang đọc ${label} (${domain}): ${Object.keys(sub.found || {}).length} trang…`),
  };
}
const pagesOfCrawl = (sub: any): [string, string][] => Object.entries(sub.found || {}).map(([u, src]: any) => [u, classify(u, src)]);

registerStep("topics", async (job, ctx) => {
  const st = job.state;
  const cfg = await loadConfig();
  const site = await one("SELECT * FROM seo_ap_sites WHERE id=?", [st.site_id]);
  if (!site) throw new SeoError("Không tìm thấy website.");
  const domain = hostOf(site.url);
  const full = st.mode !== "free";
  st.notes ||= [];

  // 1. Website của bạn: dữ liệu Audit, không có thì đọc sitemap (và lưu lại vào Audit)
  if (st.step === "mine") {
    const pages = await auditPagesOf(domain);
    if (pages.length) {
      st.mine = await myContent(site, domain, pages, "audit");
      st.step = "comps";
      st.ci = 0;
      ctx.progress(`Đang đọc sitemap ${st.comps.length} đối thủ…`);
      return;
    }
    st.crawl = { phase: "init", start: domain, max: 1500 };
    st.step = "mine_crawl";
    ctx.progress(`Đang đọc sitemap website của bạn (${domain})…`);
    return;
  }
  if (st.step === "mine_crawl") {
    try {
      if (!(await crawlStep(st.crawl, crawlCtx(ctx, st.crawl, "website của bạn", domain)))) return;
    } catch (e: any) {
      throw new SeoError(`Không đọc được website ${domain}: ${e?.message || e}`);
    }
    const pages = pagesOfCrawl(st.crawl);
    if (pages.length) {
      try {
        await rememberPages(domain, pages, st.crawl.method || "sitemap");
      } catch (e: any) {
        console.error("[gợi ý chủ đề] không lưu được danh sách trang:", e?.message);
      }
    }
    st.mine = await myContent(site, domain, pages, st.crawl.method || "sitemap");
    st.crawl = null;
    st.step = "comps";
    st.ci = 0;
    ctx.progress(`Đang đọc sitemap ${st.comps.length} đối thủ…`);
    return;
  }

  // 2. Đối thủ: lần lượt từng website
  if (st.step === "comps" || st.step === "comp_crawl") {
    st.comp_titles ||= {};
    while (st.ci < st.comps.length && Date.now() < ctx.deadline) {
      const d = st.comps[st.ci];
      if (st.step === "comps") {
        const pages = await auditPagesOf(d);
        if (pages.length) {
          st.comp_titles[d] = contentTitles(pages, 130);
          if (!st.comp_titles[d].length) st.notes.push(`${d}: không tìm thấy bài viết nào trong sitemap.`);
          st.ci++;
          continue;
        }
        st.crawl = { phase: "init", start: d, max: 1500 };
        st.step = "comp_crawl";
      }
      try {
        if (!(await crawlStep(st.crawl, crawlCtx(ctx, st.crawl, "đối thủ", d)))) return;
        st.comp_titles[d] = contentTitles(pagesOfCrawl(st.crawl), 130);
        if (!st.comp_titles[d].length) st.notes.push(`${d}: không tìm thấy bài viết nào trong sitemap.`);
      } catch (e: any) {
        if (!(e instanceof SeoError)) throw e;
        st.comp_titles[d] = [];
        st.notes.push(`Không đọc được website ${d}: ${e.message}`);
      }
      st.crawl = null;
      st.step = "comps";
      st.ci++;
      return; // mỗi đối thủ quét xong → lưu tiến độ
    }
    if (st.ci < st.comps.length) return;
    st.candidates = {};
    st.my_ranked = [];
    if (full) {
      st.step = "seed";
      ctx.progress("Đang lấy từ khóa liên quan đến chủ đề…");
    } else {
      st.step = "ai";
      ctx.progress("AI đang gom nhóm và chấm điểm chủ đề…");
    }
    return;
  }

  // 3. DataForSEO (chế độ đầy đủ)
  if (st.step === "seed") {
    for (const r of await seedKeywords(cfg, st.seed, st.loc, st.lang, st.notes)) {
      if (r.keyword && !st.candidates[fold(r.keyword)]) st.candidates[fold(r.keyword)] = { ...r, comps: [], src: "seed" };
    }
    st.ki = 0;
    st.step = "comp_kw";
    if (st.comps.length) ctx.progress(`Đang lấy từ khóa ${st.comps[0]} đang lên Top…`);
    return;
  }
  if (st.step === "comp_kw") {
    if (st.ki < st.comps.length) {
      const d = st.comps[st.ki];
      const seedVocab = new Set<string>(bigrams(st.seed));
      for (const c of Object.values(st.candidates) as any[]) if (c.src === "seed") for (const b of bigrams(c.keyword)) seedVocab.add(b);
      const seedWords = new Set(fold(st.seed).split(" ").filter((w) => w && !STOP.has(w)));
      const [rows] = await rankedKeywords(cfg, d, st.loc, st.lang, 300, st.notes);
      const brand = fold(d.split(".")[0]);
      for (const r of rows) {
        const fk = fold(r.keyword);
        if (!fk || (brand && fk.replace(/ /g, "").includes(brand.replace(/ /g, "")))) continue;
        const rel = intersects(bigrams(r.keyword), seedVocab) || fk.split(" ").some((w) => seedWords.has(w));
        if (!rel) continue;
        const c = (st.candidates[fk] ||= { ...r, comps: [], src: "comp" });
        if (!c.comps.includes(d)) c.comps.push(d);
        (c.comp_urls ||= {})[d] = { pos: r.pos ?? null, url: r.url ?? null };
      }
      st.ki++;
      if (st.ki < st.comps.length) ctx.progress(`Đang lấy từ khóa ${st.comps[st.ki]} đang lên Top…`);
      else ctx.progress("Đang lấy từ khóa website của bạn đang có thứ hạng…");
      return;
    }
    st.step = "my_kw";
    ctx.progress("Đang lấy từ khóa website của bạn đang có thứ hạng…");
    return;
  }
  if (st.step === "my_kw") {
    [st.my_ranked] = await rankedKeywords(cfg, domain, st.loc, st.lang, 300, st.notes);
    st.step = "ai";
    ctx.progress("AI đang gom nhóm và chấm điểm chủ đề…");
    return;
  }

  // 4. AI gom nhóm + chấm điểm + lưu
  if (st.step === "ai") {
    const cand = (Object.values(st.candidates) as any[]).sort((a, b) => b.comps.length - a.comps.length || (b.volume || 0) - (a.volume || 0));
    const ai = await aiCluster(cfg, { domain, site_name: site.name, seed: st.seed, mine: st.mine, comp_titles: st.comp_titles, candidates: cand, my_ranked: st.my_ranked });
    const clusters = scoreClusters(ai.clusters, st.candidates, st.mine, st.my_ranked, full && Object.keys(st.candidates).length > 0);
    const fit = ai.site_fit || {};
    let result: any = {
      seed: st.seed, domain, site_name: site.name, competitors: st.comps, mode: full ? "full" : "free",
      site_fit: { ok: Boolean(fit.ok ?? true), note: fit.note || "" }, summary: ai.summary || "",
      clusters, notes: st.notes,
      stats: {
        my_pages: st.mine.pages_count, my_source: st.mine.source, gsc_queries: st.mine.gsc.length,
        competitor_posts: Object.fromEntries(Object.entries(st.comp_titles).map(([d, t]: any) => [d, t.length])),
        candidates: Object.keys(st.candidates).length, my_ranked: st.my_ranked.length,
      },
    };
    const cost = Math.max(0, (await spentTotal()) - (st.t0 || 0));
    const ins = await run("INSERT INTO seo_tp_runs(created_at, site_id, seed, competitors_json, mode, location, result_json, cost_usd) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
      [nowUtc(), st.site_id, st.seed, JSON.stringify(st.comps), result.mode, String(st.loc), JSON.stringify(result), cost]);
    const rid = ins.rows[0].id;
    result.id = rid;
    result.cost_usd = cost;
    if (st.auto_add) {
      if (!result.site_fit.ok) {
        result.auto_added = 0;
        result.notes.push("Không tự thêm vào hàng chờ vì chủ đề có vẻ không hợp với website. Kiểm tra rồi tick chọn tay.");
        await saveResult(rid, result);
      } else {
        const ids = clusters.filter((c) => !c.covered && c.score >= 50).map((c) => c.id).slice(0, Math.max(1, Math.min(20, st.auto_top)));
        const n = (await addToQueue(rid, ids)).added;
        result = await loadRun(rid);
        result.auto_added = n;
        await saveResult(rid, result);
      }
    }
    // giải phóng dữ liệu tạm khỏi trạng thái tác vụ
    st.candidates = {};
    st.comp_titles = {};
    return { done: result };
  }
  throw new SeoError("Trạng thái phân tích không hợp lệ");
});

// ---------------------------------------------------------------- API
export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3); // /api/tp/<seg...>
  const qs = h.query;
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  try {
    if (method === "POST" && is("analyze")) {
      const b = await h.read_json();
      const seed = String(b.seed ?? "").split(/\s+/).filter(Boolean).join(" ");
      const sid = parseInt(b.site_id) || 0;
      const comps: string[] = [];
      for (const c of b.competitors || []) {
        const d = hostOf(c);
        if (d.includes(".") && !comps.includes(d)) comps.push(d);
      }
      if (!sid || !seed) return h.send_json({ error: "Chọn website và nhập chủ đề muốn phát triển." }, 400);
      if (comps.length > MAX_COMPETITORS) return h.send_json({ error: `Tối đa ${MAX_COMPETITORS} đối thủ mỗi lần phân tích.` }, 400);
      const s = await one("SELECT url FROM seo_ap_sites WHERE id=?", [sid]);
      if (!s) return h.send_json({ error: "Không tìm thấy website." }, 404);
      if (comps.includes(hostOf(s.url))) return h.send_json({ error: "Đối thủ trùng với website của bạn." }, 400);
      const mode = b.mode === "free" ? "free" : "full";
      const cfg = await loadConfig();
      if (!cfg.anthropic_api_key) throw new SeoError("Chưa có khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
      if (mode === "full" && !(cfg.login && cfg.password)) throw new SeoError("Chế độ đầy đủ cần tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD). Hoặc chọn Chế độ tiết kiệm.");
      const jid = await startJob("topics", {
        step: "mine", site_id: sid, seed, comps, mode, loc: parseInt(b.location_code) || 2704, lang: b.language_code || "vi",
        auto_add: Boolean(b.auto_add), auto_top: parseInt(b.auto_top) || 5, t0: await spentTotal(), notes: [],
      }, "Đang đọc website của bạn…");
      return h.send_json({ job_id: jid });
    }
    if (method === "GET" && is("job", "*")) return h.send_json(await advance(seg[1]));
    if (method === "GET" && is("runs")) {
      const sid = qs.get("site_id") || "";
      const rows = await q("SELECT id, created_at, site_id, seed, competitors_json, mode, cost_usd, result_json FROM seo_tp_runs"
        + (sid ? " WHERE site_id=?" : "") + " ORDER BY id DESC LIMIT 50", sid ? [sid] : []);
      return h.send_json({ items: rows.map((r: any) => {
        const cl = JSON.parse(r.result_json).clusters || [];
        return { id: r.id, created_at: r.created_at, site_id: r.site_id, seed: r.seed, competitors: JSON.parse(r.competitors_json || "[]"), mode: r.mode,
          cost_usd: r.cost_usd, clusters: cl.length, gaps: cl.filter((c: any) => !c.covered).length, added: cl.filter((c: any) => c.added).length };
      }) });
    }
    if (is("run", "*")) {
      if (method === "DELETE") {
        await run("DELETE FROM seo_tp_runs WHERE id=?", [seg[1]]);
        return h.send_json({ ok: true });
      }
      const res = await loadRun(parseInt(seg[1]));
      return res ? h.send_json(res) : h.send_json({ error: "Không tìm thấy lần phân tích này" }, 404);
    }
    if (method === "POST" && is("add")) {
      const b = await h.read_json();
      return h.send_json(await addToQueue(parseInt(b.run_id), b.ids || []));
    }
    if (method === "POST" && is("fit")) {
      const b = await h.read_json();
      return h.send_json(await fitCheck(parseInt(b.site_id) || 0, b.keywords || []));
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
}
