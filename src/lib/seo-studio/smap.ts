// @ts-nocheck
/**
 * Bản đồ website: phân tích tổng thể từng URL của website và lặp lại theo chu kỳ.
 * Chuyển từ mrvu-seo-studio/smap.py (bản 30/10/2026). Khác bản gốc vì chạy trên Vercel:
 *   - Một chu kỳ là tác vụ nhiều bước (seo_jobs), mỗi lần giao diện hỏi tiến độ chạy một bước ~40 giây:
 *     init → crawl → fetch → extra → gsync → ranks → write → ai → score → psi → inspect → links → report.
 *     Dữ liệu từng trang đọc được lưu tạm ở seo_smap_stage (không nhét vào trạng thái tác vụ).
 *   - Số trang tối đa còn bị giới hạn bởi "crawl_max_pages" trong Cài đặt chi phí (admin đặt), như tab Audit.
 *   - Khóa PageSpeed: biến môi trường GOOGLE_PSI_API_KEY, hoặc nhập ở tab Cài đặt (lưu MÃ HÓA trong seo_config).
 *   - "Đang phân tích" (RUNNING) đọc từ seo_jobs; lịch định kỳ chạy qua pg_cron (app.ts periodicTick).
 *
 * Mỗi chu kỳ:
 *   1. Quét danh sách URL (sitemap / bò link) + URL có trên Google (Search Console), đọc từng trang lấy tiêu đề, H1, liên kết nội bộ.
 *   2. Đồng bộ Search Console + GA4 (miễn phí), lấy từ khóa đang có thứ hạng theo URL (DataForSEO Labs, tùy chọn).
 *   3. AI gán cho mỗi URL: từ khóa chính, từ phụ, câu hỏi GEO, ý định, nhóm chủ đề, vai trò (trụ cột / danh mục / sản phẩm / bài viết).
 *   4. Chấm điểm SEO on-page (bộ kiểm tra Audit), cấu trúc GEO, tốc độ (Google PageSpeed Insights API, miễn phí), trạng thái index.
 *   5. Dựng đồ thị liên kết nội bộ, tìm trang mồ côi, trang sâu, đề xuất liên kết theo cấu trúc cụm chủ đề.
 *   6. Phát hiện trùng từ khóa, so sánh với chu kỳ trước (tụt hạng, chậm đi, lỗi mới…), AI viết báo cáo và việc cần làm.
 */
import { SeoError, decrypt, encrypt, extractJson, jl, loadConfig, now, nowUtc, one, pool, pyRound, q, run, saveConfig, sleep, squash, tx } from "./core";
import { claude } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { moduleAs, overBudget, settings } from "./costs";
import { SKIP_EXT, auditPage, classify, crawlStep } from "./audit";
import { readPage, structureChecks } from "./geo";
import { cfgSite, inspectStep, meta as gscMeta, newSyncState, syncStep } from "./gsc";
import { STOP, fold, hostOf, rankedKeywords, spentTotal } from "./topics";
import { PageParser, bareHost, cleanUrl, decode, fetchPage, header, netloc, urlParts, urljoin } from "./web";

const INTENT_W: Record<string, number> = { buy: 1.6, price: 1.5, local: 1.5, compare: 1.4, howto: 1.0, problem: 1.0, info: 0.9, nav: 0.4 };
const ROLE_W: Record<string, number> = { product: 1.3, category: 1.35, pillar: 1.3, home: 1.0, post: 1.0, support: 0.6, other: 0.7 };
const ROLE_VI: Record<string, string> = { home: "Trang chủ", pillar: "Trụ cột", category: "Danh mục", product: "Sản phẩm", post: "Bài viết", support: "Trang phụ", other: "Khác" };
const PSI_VI: Record<string, string> = {
  "render-blocking-resources": "Loại bỏ CSS/JS chặn hiển thị", "unused-javascript": "Giảm JavaScript không dùng",
  "unused-css-rules": "Giảm CSS không dùng", "modern-image-formats": "Dùng ảnh WebP/AVIF",
  "uses-optimized-images": "Nén ảnh", "offscreen-images": "Tải chậm ảnh ngoài màn hình (lazy-load)",
  "uses-responsive-images": "Dùng ảnh đúng kích thước hiển thị", "server-response-time": "Giảm thời gian phản hồi máy chủ (TTFB)",
  "uses-text-compression": "Bật nén gzip/brotli", "uses-long-cache-ttl": "Đặt bộ nhớ đệm lâu cho tài nguyên tĩnh",
  "unminified-javascript": "Thu gọn (minify) JavaScript", "unminified-css": "Thu gọn (minify) CSS", redirects: "Tránh chuyển hướng nhiều lớp",
  "efficient-animated-content": "Thay ảnh GIF động bằng video", "total-byte-weight": "Giảm tổng dung lượng trang",
  "dom-size": "Giảm số phần tử HTML (DOM)", "third-party-summary": "Giảm mã bên thứ ba (chat, quảng cáo, theo dõi)",
  "legacy-javascript": "Bỏ JavaScript cũ cho trình duyệt đời cũ", "duplicated-javascript": "Bỏ JavaScript bị trùng",
  "font-display": "Hiện chữ ngay khi font đang tải (font-display)", "lcp-lazy-loaded": "Không lazy-load ảnh chính đầu trang",
  "prioritize-lcp-image": "Ưu tiên tải ảnh chính đầu trang", "unsized-images": "Khai báo kích thước ảnh (tránh xô lệch)",
  "bootup-time": "Giảm thời gian chạy JavaScript", "mainthread-work-breakdown": "Giảm việc trên luồng chính",
};
const JSON_COLS = ["links", "anchors_in", "broken", "secondary", "geo", "seo_fails", "geo_fails", "psi", "index", "gsc", "ga", "ranks", "issues", "advice"];
const byNum = (f: (x: any) => number) => (a: any, b: any) => f(a) - f(b);

/** Khóa so khớp URL: bỏ http(s), www, dấu / cuối, #. */
export function ukey(u: string) {
  u = String(u || "");
  const p = urlParts(u.includes("://") ? u : "https://" + u);
  let path = p.path || "/";
  try {
    path = decodeURIComponent(path);
  } catch {}
  path = path.replace(/\/+$/, "") || "/";
  return bareHost(p.netloc) + path + (p.query ? "?" + p.query : "");
}
function pathKey(u: string) {
  const k = ukey(u);
  return k.includes("/") ? k.slice(k.indexOf("/") + 1).split("?")[0].replace(/\/+$/, "") : "";
}

// ---------------------------------------------------------------- site
async function getSite(sid: any) {
  return await one("SELECT * FROM seo_smap_sites WHERE id=?", [sid]);
}

/** Khóa PageSpeed: biến môi trường, không có thì khóa đã nhập ở Cài đặt (lưu mã hóa). */
async function psiKey(cfg?: any) {
  const envKey = (process.env.GOOGLE_PSI_API_KEY || "").trim();
  if (envKey) return envKey;
  cfg = cfg || (await loadConfig());
  if (!cfg.psi_api_key_enc) return "";
  try {
    return decrypt(cfg.psi_api_key_enc);
  } catch {
    return "";
  }
}
const maskKey = (k: string) => (k ? k.slice(0, 4) + "…" + k.slice(-4) : "");

async function saveSite(b: any) {
  const d = hostOf(b.domain);
  if (!d.includes(".")) throw new SeoError("Nhập tên miền, ví dụ mrvu.vn");
  const vals = [d, Math.max(50, Math.min(3000, parseInt(b.max_pages) || 800)), ["smart", "all", "off"].includes(b.psi_mode) ? b.psi_mode : "smart",
    (b.use_labs ?? true) ? 1 : 0, (b.inspect ?? true) ? 1 : 0, b.auto ? 1 : 0, Math.max(7, Math.min(90, parseInt(b.auto_days) || 30)),
    b.site_id ? parseInt(b.site_id) : null];
  let sid: number;
  if (b.id) {
    sid = parseInt(b.id);
    await run("UPDATE seo_smap_sites SET domain=?, max_pages=?, psi_mode=?, use_labs=?, inspect=?, auto=?, auto_days=?, site_id=? WHERE id=?", [...vals, sid]);
  } else {
    if (await one("SELECT id FROM seo_smap_sites WHERE domain=?", [d])) throw new SeoError("Website này đã có.");
    sid = (await run("INSERT INTO seo_smap_sites(domain, max_pages, psi_mode, use_labs, inspect, auto, auto_days, site_id, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
      [...vals, now()])).rows[0].id;
  }
  const key = String(b.psi_api_key || "").trim();
  if (key && !key.includes("…")) await saveConfig({ psi_api_key_enc: encrypt(key) });
  return await getSite(sid);
}

/** Thương hiệu, lĩnh vực từ dự án Câu hỏi AI cùng tên miền (nếu có). */
async function siteContext(domain: string) {
  try {
    const r = await one("SELECT id, brands_json, topics_json, competitors_json FROM seo_aiq_projects WHERE domain=? ORDER BY id LIMIT 1", [domain]);
    if (r) return { aiq_id: r.id, brands: jl(r.brands_json, []), topics: jl(r.topics_json, []), competitors: jl(r.competitors_json, []) };
  } catch {}
  return { aiq_id: null, brands: [domain], topics: [], competitors: [] };
}

async function runningCycle(sid: any) {
  return Boolean(await one(`SELECT 1 FROM seo_jobs WHERE kind='smap_cycle' AND status='running' AND (state->>'sid')::bigint=?
                            AND updated_at > now() - interval '10 minutes' LIMIT 1`, [sid]));
}

// ---------------------------------------------------------------- 1. quét
function parsePage(res: any, baseHost: string) {
  const p = new PageParser();
  try {
    p.feed(decode(res));
  } catch {}
  const links = new Set<string>();
  const anchors: [string, string, boolean][] = [];
  const final = res.url;
  for (const a of p.anchors) {
    const href = String(a.href || "").trim();
    if (!href || /^(#|mailto:|tel:|javascript:|zalo:)/.test(href)) continue;
    const u = cleanUrl(urljoin(final, href));
    if (!u.startsWith("http") || bareHost(netloc(u)) !== baseHost) continue;
    if (SKIP_EXT.test(urlParts(u).path)) continue;
    const k = ukey(u);
    if (!links.has(k)) {
      links.add(k);
      anchors.push([k, String(a.text || a.title || "").slice(0, 80), String(a.rel || "").includes("nofollow")]);
    }
  }
  const canon = (p.links_rel.find((l) => String(l.rel || "").toLowerCase().includes("canonical")) || {}).href || "";
  const robots = ((p.meta.robots || "") + " " + header(res, "x-robots-tag")).toLowerCase();
  const text = squash(p.text.join(" "));
  return {
    title: p.title || "", h1: (p.headings.find(([lv]) => lv === 1) || [0, ""])[1], words: text ? text.split(" ").length : 0,
    noindex: robots.includes("noindex"), canonical: canon ? urljoin(final, canon) : "", anchors,
  };
}

async function fetchInfo([k, [u, t, sm]]: any, d: string) {
  const res = await fetchPage(u, 25);
  const info: any = { url: u, type: t, in_sitemap: sm, status: res.status, final_url: res.url, elapsed: pyRound(res.elapsed, 2) };
  const ct = header(res, "content-type").toLowerCase();
  if (res.status === 200 && (ct.includes("html") || !ct)) Object.assign(info, parsePage(res, d));
  return [k, info];
}

async function saveStage(jobId: string, start: number, infos: any[]) {
  if (!infos.length) return;
  await run(`INSERT INTO seo_smap_stage(job_id, n, ukey, data_json) VALUES ${infos.map(() => "(?,?,?,?)").join(",")}
             ON CONFLICT (job_id, ukey) DO UPDATE SET data_json=EXCLUDED.data_json`,
    infos.flatMap(([k, info], i) => [jobId, start + i, k, JSON.stringify(info)]));
}
async function loadStage(jobId: string): Promise<Map<string, any>> {
  const rows = await q("SELECT ukey, data_json FROM seo_smap_stage WHERE job_id=? ORDER BY n", [jobId]);
  return new Map(rows.map((r: any) => [r.ukey, JSON.parse(r.data_json)]));
}
/**
 * Ghi nhiều dòng bằng một lệnh (tối đa 300 dòng/lệnh). Ghi từng dòng qua pooler Supabase tốn một vòng mạng
 * mỗi lệnh: website ~1.000 trang vượt giới hạn 300 giây của Vercel, bước bị cắt ngang và chạy lại mãi.
 * tpl: mẫu một dòng, ví dụ "(?,?,1)"; với UPDATE … FROM (VALUES …) phải ép kiểu từng ô (?::bigint).
 * pre/post: giá trị cho các dấu ? trong head/tail.
 */
async function bulk(head: string, tpl: string, rows: any[][], tail = "", t?: any, pre: any[] = [], post: any[] = []) {
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    await run(`${head} VALUES ${chunk.map(() => tpl).join(",")} ${tail}`, [...pre, ...chunk.flat(), ...post], t);
  }
}

function linkGraph(home: string, pages: Map<string, any>) {
  const inl = new Map<string, Set<string>>(), anchorsIn = new Map<string, any[]>(), broken = new Map<string, any[]>();
  for (const [k, v] of pages) {
    for (const [t, txt] of v.anchors || []) {
      const t2 = pages.get(t)?.redirect_to || t;
      if (t2 === k) continue;
      if (!inl.has(t2)) inl.set(t2, new Set());
      inl.get(t2).add(k);
      if (txt) {
        if (!anchorsIn.has(t2)) anchorsIn.set(t2, []);
        anchorsIn.get(t2).push([k, txt]);
      }
      const st = pages.get(t)?.status;
      if (st !== null && st !== undefined && st >= 400) {
        if (!broken.has(k)) broken.set(k, []);
        broken.get(k).push([t, st]);
      }
    }
  }
  const depth = new Map<string, number>([[home, 0]]);
  const queue = [home];
  while (queue.length) {
    const cur = queue.shift();
    for (const [t0] of pages.get(cur)?.anchors || []) {
      const t = pages.get(t0)?.redirect_to || t0;
      if (pages.has(t) && !depth.has(t)) {
        depth.set(t, depth.get(cur) + 1);
        queue.push(t);
      }
    }
  }
  return { inl, anchorsIn, broken, depth };
}

// ---------------------------------------------------------------- 2. dữ liệu Google
async function gscMaps() {
  const pg = new Map<string, any>(), qm = new Map<string, any[]>(), ga = new Map<string, any>();
  for (const r of await q("SELECT period, page, clicks, impressions, ctr, position FROM seo_gsc_pages")) {
    const k = ukey(r.page);
    if (!pg.has(k)) pg.set(k, {});
    pg.get(k)[r.period] = { clicks: r.clicks, impr: r.impressions, ctr: r.ctr, pos: r.position };
  }
  for (const r of await q("SELECT query, page, clicks, impressions, position FROM seo_gsc_rows WHERE period='cur' ORDER BY impressions DESC")) {
    const k = ukey(r.page);
    if (!qm.has(k)) qm.set(k, []);
    const lst = qm.get(k);
    if (lst.length < 15) lst.push([r.query, r.impressions, r.clicks, pyRound(r.position, 1)]);
  }
  try {
    for (const r of await q("SELECT period, path, sessions, engaged, key_events FROM seo_ga_pages")) {
      const k = String(r.path || "").split("?")[0].replace(/\/+$/, "").replace(/^\/+/, "");
      if (!ga.has(k)) ga.set(k, {});
      const e = (ga.get(k)[r.period] ||= { sessions: 0, key_events: 0 });
      e.sessions += r.sessions || 0;
      e.key_events += r.key_events || 0;
    }
  } catch {}
  return { pg, qm, ga };
}

/** Truy vấn có nhiều URL cùng nhận hiển thị đáng kể, hoặc nhiều URL được gán cùng từ khóa chính. */
async function cannibalGroups(pagesByKey: Map<string, number>, kwPages: Map<string, [number, string][]>) {
  const groups = new Map<string, any>();
  let rows: any[] = [];
  try {
    rows = await q("SELECT query, page, impressions, clicks, position FROM seo_gsc_rows WHERE period='cur'");
  } catch {}
  const byq = new Map<string, any[]>();
  for (const r of rows) {
    const k = ukey(r.page);
    if (!pagesByKey.has(k)) continue;
    if (!byq.has(r.query)) byq.set(r.query, []);
    byq.get(r.query).push([k, r.impressions, r.clicks, pyRound(r.position, 1)]);
  }
  for (const [qq, lst] of byq) {
    const tot = lst.reduce((a, x) => a + x[1], 0);
    const big = lst.filter((x) => x[1] >= Math.max(20, 0.15 * tot));
    if (big.length >= 2 && tot >= 50) {
      groups.set(fold(qq), { keyword: qq, source: "gsc", impr: tot,
        pages: [...big].sort((a, b) => b[1] - a[1]).map((x) => ({ id: pagesByKey.get(x[0]), impr: x[1], clicks: x[2], pos: x[3] })) });
    }
  }
  for (const [fk, ids] of kwPages) {
    if (ids.length >= 2 && !groups.has(fk)) groups.set(fk, { keyword: ids[0][1], source: "assigned", impr: 0, pages: ids.map(([i]) => ({ id: i })) });
  }
  return [...groups.values()].sort((a, b) => b.impr - a.impr).slice(0, 60);
}

// ---------------------------------------------------------------- 3. AI gán từ khóa
async function assignBatch(site: any, ctx: any, rows: any[], clusters: string[], cfg: any) {
  const lines = rows.map((r) => {
    const gq = (r.queries || []).slice(0, 8).map((x: any) => `${x[0]} (${x[1]} hiển thị, vị trí ${x[3]})`).join("; ") || "-";
    const rk = (r.ranks || []).slice(0, 6).map((x: any) => `${x.keyword} (vol ${x.volume || "?"}, top ${x.pos ?? "?"})`).join("; ") || "-";
    const aq = r.aiq.slice(0, 4).join("; ") || "-";
    return `[${r.id}] ${r.url} | loại: ${r.type} | title: ${r.title.slice(0, 90)} | H1: ${r.h1.slice(0, 80)} | ${r.words} chữ\n`
      + `    Google: ${gq}\n    Thứ hạng: ${rk}\n    Câu hỏi AI đã giao: ${aq}`;
  });
  const prompt = `Bạn là chuyên gia SEO và GEO cho website bán hàng ${site.domain} (thương hiệu: ${ctx.brands.join(", ")}; lĩnh vực: ${ctx.topics.join(", ") || "xem nội dung trang"}).
Mục tiêu: mỗi URL nhắm ĐÚNG MỘT nhóm ý định tìm kiếm, mang về nhiều khách hàng tiềm năng nhất từ Google và AI (ChatGPT, Gemini, AI Overview).

Danh sách trang (kèm từ khóa Google thật đang hiển thị trang đó, thứ hạng, câu hỏi AI):
${lines.join("\n")}

Nhóm chủ đề đã đặt tên ở các lượt trước (dùng lại đúng tên nếu cùng chủ đề): ${clusters.join(", ") || "(chưa có)"}

Với mỗi trang:
- "primary": từ khóa chính tiếng Việt có dấu, ưu tiên từ khóa Google thật có nhiều hiển thị và đúng nội dung trang; trang sản phẩm dùng tên sản phẩm + loại; danh mục dùng tên danh mục người hay tìm.
- "secondary": 2-5 từ phụ cùng ý định (không trùng từ chính của trang khác cùng lượt).
- "geo": 1-3 câu hỏi người dùng hay hỏi AI mà trang này nên trả lời (để trống với trang chủ/liên hệ/chính sách).
- "intent": buy|price|local|compare|howto|problem|info|nav. "role": home|pillar|category|product|post|support|other.
- "cluster": nhóm chủ đề ngắn (tối đa ~15 nhóm cho cả website). "note": 1 câu nếu title/H1 lệch từ khóa hoặc trang nên gộp/bỏ.
Chỉ trả về JSON hợp lệ: {"pages": [{"id": 1, "primary": "...", "secondary": ["..."], "geo": ["..."], "intent": "buy", "role": "category", "cluster": "...", "note": ""}]}`;
  const [txt] = await claude(cfg, prompt, 7000, null, "smap_cycle");
  let data: any = {};
  try {
    data = extractJson(txt);
  } catch {} // bản gốc: lượt AI trả sai định dạng thì bỏ qua lượt đó
  const out = new Map<number, any>();
  for (const x of data.pages || []) {
    const id = parseInt(x?.id);
    if (Number.isNaN(id)) continue;
    out.set(id, x);
    const c = String(x.cluster || "").trim();
    if (c && !clusters.includes(c)) clusters.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- 4. tốc độ
async function psi(url: string, key: string, strategy = "mobile") {
  const qs = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) qs.set("key", key);
  const api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + qs.toString();
  let last: string | null = null, data: any = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    let r: Response;
    try {
      // 60 giây/lần (bản gốc 120) để cả bước không vượt giới hạn thời gian của Vercel
      r = await fetch(api, { headers: { "User-Agent": "MrVuSEOStudio/1.0" }, signal: AbortSignal.timeout(60_000) });
    } catch (e: any) {
      last = `PageSpeed không phản hồi: ${e?.name === "TimeoutError" ? "hết thời gian chờ" : e?.cause?.code || e?.message}`;
      await sleep(3000);
      continue;
    }
    if (r.ok) {
      try {
        data = await r.json();
      } catch (e: any) {
        last = `PageSpeed không phản hồi: ${e?.message}`;
        await sleep(3000);
      }
      continue;
    }
    last = `PageSpeed lỗi ${r.status}`;
    if (r.status === 429) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    if (r.status === 400 || r.status === 500) {
      try {
        last += ": " + String((await r.json())?.error?.message || "").slice(0, 150);
      } catch {}
    }
    throw new SeoError(last);
  }
  if (!data) throw new SeoError(last || "PageSpeed lỗi");
  const lh = data.lighthouseResult || {};
  const au = lh.audits || {};
  const nv = (k: string) => au[k]?.numericValue ?? null;
  const perf = lh.categories?.performance?.score;
  const opps: any[] = [];
  for (const [k, a] of Object.entries(au) as any) {
    const det = a.details || {};
    const sav = det.overallSavingsMs || a.metricSavings?.LCP || 0;
    if ((det.type === "opportunity" || a.metricSavings) && sav && sav >= 150 && (a.score === null || a.score === undefined || a.score < 0.9)) {
      opps.push({ id: k, title: PSI_VI[k] || a.title || k, ms: pyRound(sav) });
    }
  }
  opps.sort((a, b) => b.ms - a.ms);
  const fld = data.loadingExperience || {};
  const fm = fld.metrics || {};
  const pv = (k: string) => fm[k]?.percentile ?? null;
  let field = null;
  if (Object.keys(fm).length) {
    field = { category: fld.overall_category ?? null, lcp: pv("LARGEST_CONTENTFUL_PAINT_MS"), inp: pv("INTERACTION_TO_NEXT_PAINT"),
      cls: pv("CUMULATIVE_LAYOUT_SHIFT_SCORE") !== null ? (pv("CUMULATIVE_LAYOUT_SHIFT_SCORE") || 0) / 100 : null, origin: fld.origin_fallback || false };
  }
  return {
    at: now(), strategy, perf: perf !== null && perf !== undefined ? pyRound(perf * 100) : null,
    lcp: nv("largest-contentful-paint"), tbt: nv("total-blocking-time"), cls: nv("cumulative-layout-shift"),
    fcp: nv("first-contentful-paint"), si: nv("speed-index"), ttfb: nv("server-response-time"),
    weight_kb: pyRound((nv("total-byte-weight") || 0) / 1024), field, opps: opps.slice(0, 6),
  };
}

// ---------------------------------------------------------------- 5. liên kết nội bộ
/** pages: Map id -> page (đã có primary, cluster, role, links). Trả về [gợi ý, nhóm → trang trung tâm]. */
function linkSuggestions(pages: Map<number, any>): [any[], Map<string, number>] {
  const ok = new Map([...pages].filter(([, p]) => p.status === 200 && !p.noindex && p.primary_kw));
  const byKey = new Map([...ok].map(([i, p]) => [p.ukey, i]));
  const has = new Map([...ok].map(([i, p]) => [i, new Set(p.links.filter((k: string) => byKey.has(k)).map((k: string) => byKey.get(k)))]));
  const clusters = new Map<string, number[]>();
  for (const [i, p] of ok) {
    if (!p.cluster) continue;
    if (!clusters.has(p.cluster)) clusters.set(p.cluster, []);
    clusters.get(p.cluster).push(i);
  }
  const sugg = new Map<string, any>();
  const add = (f: number, t: number, kind: string, reason: string, pr: number) => {
    if (f === t || has.get(f)?.has(t) || !ok.has(f) || !ok.has(t)) return;
    const k = f + ":" + t;
    if (!sugg.has(k) || sugg.get(k).priority < pr) sugg.set(k, { from_id: f, to_id: t, anchor: ok.get(t).primary_kw, kind, reason, priority: pyRound(pr, 1) });
  };
  const opp = (i: number) => {
    const p = ok.get(i);
    const g = p.gsc || {};
    const pos = g.pos || 0, impr = g.impr || 0;
    const boost = pos >= 4 && pos <= 20 ? 1.8 : 1.0;
    return (1 + Math.log10(1 + impr)) * boost * (INTENT_W[p.intent || "info"] ?? 1) * (ROLE_W[p.role || "other"] ?? 1);
  };
  const role = (i: number) => ok.get(i).role;
  const hubs = new Map<string, number>();
  for (const [c, ids] of clusters) {
    const cand = [...ids].sort((a, b) =>
      Number(!["pillar", "category"].includes(role(a))) - Number(!["pillar", "category"].includes(role(b)))
      || -(ok.get(a).gsc?.impr || 0) + (ok.get(b).gsc?.impr || 0)
      || (ok.get(a).depth || 9) - (ok.get(b).depth || 9));
    const hub = cand[0];
    hubs.set(c, hub);
    const members = ids.filter((i) => i !== hub);
    for (const i of members) add(i, hub, "lên trụ cột", `Trang thuộc nhóm "${c}" nên trỏ về trang trung tâm của nhóm`, (10 * opp(hub)) / 2 + 5);
    const posts = members.filter((i) => ["post", "pillar", "category"].includes(role(i))).sort(byNum((i) => -opp(i))).slice(0, 15);
    for (const i of posts) add(hub, i, "xuống bài con", `Trang trung tâm nhóm "${c}" nên liên kết tới các bài con quan trọng`, 6 * opp(i));
    const prods = members.filter((i) => role(i) === "product");
    for (const i of posts) {
      for (const pr of [...prods].sort(byNum((x) => -opp(x))).slice(0, 2)) add(i, pr, "bài → sản phẩm", "Bài hướng dẫn dẫn khách sang sản phẩm phù hợp (tăng chuyển đổi)", 7 * opp(pr));
    }
    const sib = members.filter((i) => role(i) === "post");
    for (const i of sib) {
      for (const j of sib.filter((x) => x !== i).sort(byNum((x) => -opp(x))).slice(0, 2)) add(i, j, "bài liên quan", `Hai bài cùng nhóm "${c}" nên liên kết qua lại`, 4 * opp(j));
    }
  }
  const strong = [...ok.keys()].sort(byNum((i) => -(ok.get(i).inlinks || 0))).slice(0, 30);
  for (const [i, p] of ok) {
    if (p.role !== "home" && (p.inlinks || 0) === 0) {
      let src = strong.filter((hh) => ok.get(hh).cluster === p.cluster).slice(0, 2);
      if (!src.length) src = strong.slice(0, 2);
      for (const f of src) add(f, i, "cứu trang mồ côi", "Trang chưa có liên kết nội bộ nào trỏ tới (Google và AI khó tìm thấy)", 12 * opp(i));
    } else if ((p.depth || 0) > 3 && opp(i) > 3) {
      for (const f of strong.slice(0, 1)) add(f, i, "rút ngắn độ sâu", `Trang quan trọng nằm sâu ${p.depth} lần bấm từ trang chủ`, 6 * opp(i));
    }
  }
  return [[...sugg.values()].sort((a, b) => b.priority - a.priority).slice(0, 500), hubs];
}

// ---------------------------------------------------------------- 6. vấn đề + giá trị
function pageIssues(p: any, cannibalIds: Set<number>) {
  const I: any[] = [];
  const add = (kind: string, sev: number, text: string) => I.push({ kind, sev, text });
  const st = p.status;
  if (st && st >= 400) add("tech", 3, `Trang lỗi HTTP ${st}`);
  if (p.noindex) add("tech", 3, "Trang đang chặn index (noindex)");
  const ix = p.index || {};
  if (ix.verdict && ix.verdict !== "PASS") add("index", 3, `Google chưa index: ${ix.coverage || ix.verdict}`);
  const g = p.gsc || {};
  if (p.primary_kw) {
    const words = fold(p.primary_kw).split(" ").filter((w) => w && !STOP.has(w));
    const t = fold(p.title || "").split(" ");
    if (words.length && words.filter((w) => t.includes(w)).length / words.length < 0.6) add("seo", 2, `Title chưa chứa từ khóa chính "${p.primary_kw}"`);
  }
  if (p.seo !== null && p.seo !== undefined && p.seo < 70) add("seo", 2, `Điểm SEO on-page ${p.seo}/100: ` + (p.seo_fails || []).slice(0, 3).map((x: any) => x.label).join("; "));
  const ps = p.psi || {};
  if (ps.perf !== null && ps.perf !== undefined && ps.perf < 50) add("speed", 2, `Tốc độ di động kém (${ps.perf}/100, LCP ${((ps.lcp || 0) / 1000).toFixed(1)}s)`);
  else if (ps.perf !== null && ps.perf !== undefined && ps.perf < 80) add("speed", 1, `Tốc độ di động trung bình (${ps.perf}/100)`);
  if (ps.field?.category === "SLOW") add("speed", 3, "Người dùng thật đánh giá chậm (Core Web Vitals không đạt)");
  if (p.geo_score !== null && p.geo_score !== undefined && p.geo_score < 60 && p.geo?.length) {
    add("geo", 2, `Cấu trúc GEO ${p.geo_score}/100: ` + (p.geo_fails || []).slice(0, 2).map((x: any) => x.label).join("; "));
  }
  if (p.role !== "home" && p.role !== null && p.role !== undefined && (p.inlinks || 0) === 0 && st === 200) add("link", 3, "Trang mồ côi: không có liên kết nội bộ trỏ tới");
  else if (st === 200 && (p.inlinks || 0) < 3 && ["category", "pillar", "product"].includes(p.role)) add("link", 1, `Ít liên kết nội bộ trỏ tới (${p.inlinks || 0})`);
  if ((p.depth || 0) > 3) add("link", 1, `Nằm sâu ${p.depth} lần bấm từ trang chủ`);
  if (p.broken?.length) add("link", 2, `Có ${p.broken.length} liên kết nội bộ hỏng`);
  if (cannibalIds.has(p.id)) add("kw", 2, "Trùng từ khóa với trang khác (tự cạnh tranh trên Google)");
  const cur = g.cur || {};
  if ((cur.impr || 0) >= 100 && (cur.pos || 0) >= 4 && (cur.pos || 0) <= 20) add("opp", 2, `Cơ hội lên top: vị trí ${Number(cur.pos).toFixed(1)}, ${cur.impr} hiển thị/28 ngày`);
  if ((cur.impr || 0) >= 300 && (cur.pos || 99) <= 5 && (cur.ctr || 0) < 0.03) add("opp", 1, `Tỷ lệ click thấp (${((cur.ctr || 0) * 100).toFixed(1)}%) dù đứng top: viết lại title/meta`);
  if (p.words !== null && p.words !== undefined && st === 200 && ["post", "pillar"].includes(p.role) && p.words < 500) add("content", 2, `Nội dung mỏng (${p.words} chữ)`);
  return I.sort((a, b) => b.sev - a.sev);
}

function pageValue(p: any) {
  const cur = p.gsc?.cur || {};
  const ga = p.ga?.cur || {};
  const base = 1 + Math.log10(1 + (cur.impr || 0) + 10 * (cur.clicks || 0)) + 2 * Math.log10(1 + (ga.key_events || 0));
  return pyRound(base * (INTENT_W[p.intent || "info"] ?? 1) * (ROLE_W[p.role || "other"] ?? 1), 2);
}

const rankOf = (p: any) => {
  const xs = (p.ranks || []).filter((r: any) => r.pos && fold(r.keyword) === fold(p.primary_kw || "")).map((r: any) => r.pos);
  return xs.length ? Math.min(...xs) : null;
};

// ---------------------------------------------------------------- chu kỳ
async function loadPages(sid: any, activeOnly = true, ids: number[] | null = null) {
  let sqlText = "SELECT * FROM seo_smap_pages WHERE site_id=?" + (activeOnly ? " AND active=1" : "");
  const args: any[] = [sid];
  if (ids) {
    if (!ids.length) return [];
    sqlText += " AND id IN (?)";
    args.push(ids);
  }
  const rows = await q(sqlText + " ORDER BY id", args);
  for (const r of rows) {
    for (const k of JSON_COLS) {
      r[k] = jl(r[k + "_json"], null);
      delete r[k + "_json"];
    }
    r.links = r.links || [];
  }
  return rows;
}

function newCycleState(sid: any, opts: any, auto: boolean) {
  return { step: "init", sid, opts: opts || {}, auto: Boolean(auto) };
}

registerStep("smap_cycle", (job, ctx) => moduleAs("smap_cycle", async () => {
  const st = job.state;
  const site = await getSite(st.sid);
  if (!site) throw new SeoError("Không tìm thấy website.");
  const cfg = await loadConfig();
  const d = site.domain, sid = site.id, opts = st.opts || {};
  st.notes ||= [];
  const notes: string[] = st.notes;

  // 1. quét
  if (st.step === "init") {
    await run(`DELETE FROM seo_smap_stage WHERE job_id NOT IN (SELECT id FROM seo_jobs WHERE kind='smap_cycle' AND status='running'
               AND updated_at > now() - interval '1 day')`);
    const [s] = await settings();
    st.t0 = await spentTotal();
    st.crawl = { phase: "init", start: d, max: Math.min(site.max_pages || 800, Math.max(10, parseInt(s.crawl_max_pages) || 2000)) };
    st.step = "crawl";
    ctx.progress(`Đang đọc sitemap ${d}…`);
    return;
  }
  if (st.step === "crawl") {
    const cctx = { deadline: ctx.deadline, extra: {}, progress: () => ctx.progress(`Đang tìm trang của ${d}: ${Object.keys(st.crawl.found || {}).length} trang…`) };
    try {
      if (!(await crawlStep(st.crawl, cctx))) return;
    } catch (e: any) {
      throw new SeoError(`Không quét được ${d}: ${e?.message || e}`);
    }
    const urls = new Map<string, any>();
    for (const [u, src] of Object.entries(st.crawl.found)) urls.set(ukey(u), [u, classify(u, src as string), true]);
    // thêm URL có trên Google nhưng không có trong sitemap
    try {
      for (const r of await q("SELECT page FROM seo_gsc_pages WHERE period='cur' ORDER BY impressions DESC LIMIT 400")) {
        const k = ukey(r.page);
        if (k.split("/")[0] === d && !urls.has(k) && urls.size < st.crawl.max + 200) urls.set(k, [r.page, classify(r.page), false]);
      }
    } catch {}
    st.home = ukey(st.crawl.base);
    if (!urls.has(st.home)) urls.set(st.home, [st.crawl.base, "home", true]);
    st.method = st.crawl.method;
    st.urls = [...urls.entries()];
    st.ui = 0;
    st.crawl = null;
    st.step = "fetch";
    ctx.progress(`Đã đọc 0/${st.urls.length} trang (liên kết nội bộ, tiêu đề)…`);
    return;
  }
  if (st.step === "fetch") {
    while (st.ui < st.urls.length && Date.now() < ctx.deadline) {
      const batch = st.urls.slice(st.ui, st.ui + 12);
      await saveStage(job.id, st.ui, await pool(batch, 6, (it) => fetchInfo(it, d)));
      st.ui += batch.length;
      ctx.progress(`Đã đọc ${st.ui}/${st.urls.length} trang (liên kết nội bộ, tiêu đề)…`);
    }
    if (st.ui < st.urls.length) return;
    // liên kết nội bộ trỏ tới URL chưa có trong sitemap: kiểm tra (phát hiện link hỏng, trang thiếu trong sitemap)
    const out = await loadStage(job.id);
    const extra = new Map<string, any>();
    for (const v of out.values()) {
      for (const [t] of v.anchors || []) if (!out.has(t) && !extra.has(t) && extra.size < 400) extra.set(t, ["https://" + t, classify("https://" + t), false]);
    }
    st.base_n = st.urls.length;
    st.urls = [...extra.entries()];
    st.ui = 0;
    st.missing = [];
    st.step = "extra";
    if (st.urls.length) ctx.progress(`Đang kiểm tra ${st.urls.length} liên kết nội bộ không có trong sitemap…`);
    return;
  }
  if (st.step === "extra") {
    while (st.ui < st.urls.length && Date.now() < ctx.deadline) {
      const batch = st.urls.slice(st.ui, st.ui + 12);
      const infos = (await pool(batch, 6, (it) => fetchInfo(it, d))).map(([k, info]: any) => {
        if (info.status === 200 && info.title !== undefined) {
          st.missing.push(info.url);
          return [k, info];
        }
        return [k, { ...info, stub: true }];
      });
      await saveStage(job.id, st.base_n + st.ui, infos);
      st.ui += batch.length;
      ctx.progress(`Đang kiểm tra liên kết nội bộ không có trong sitemap ${st.ui}/${st.urls.length}…`);
    }
    if (st.ui < st.urls.length) return;
    if (st.missing.length) notes.push(`${st.missing.length} trang có liên kết nội bộ nhưng không có trong sitemap (nên bổ sung vào sitemap), ví dụ: ${st.missing[0]}`);
    st.urls = [];
    st.missing = [];
    // 2. Google
    st.gsc_ok = hostOf(String(cfg.gsc_site || "").replace("sc-domain:", "")) === d;
    if (!st.gsc_ok) {
      notes.push("Search Console chưa kết nối đúng website này: bỏ qua dữ liệu từ khóa thật theo URL.");
      st.step = "ranks";
      return;
    }
    const info = (await gscMeta("last_sync")) || {};
    const stale = !info.at || Date.parse(info.at) < Date.now() - 3 * 864e5;
    if (stale && (opts.sync ?? true)) {
      try {
        st.gsync = await newSyncState();
        st.step = "gsync";
        ctx.progress("Đang đồng bộ Search Console và GA4…");
        return;
      } catch (e: any) {
        if (!(e instanceof SeoError)) throw e;
        notes.push(`Không đồng bộ được Search Console: ${e.message}`);
      }
    }
    st.step = "ranks";
    return;
  }
  if (st.step === "gsync") {
    try {
      const r = await syncStep({ state: st.gsync }, { deadline: ctx.deadline, extra: {}, progress: (m: string) => ctx.progress("Search Console: " + m) });
      if (!(r && "done" in r)) return;
    } catch (e: any) {
      if (!(e instanceof SeoError)) throw e;
      notes.push(`Không đồng bộ được Search Console: ${e.message}`);
    }
    st.gsync = null;
    st.step = "ranks";
    return;
  }
  if (st.step === "ranks") {
    const ranks: Record<string, any[]> = {};
    if ((opts.labs ?? Boolean(site.use_labs)) && cfg.login && cfg.password) {
      ctx.progress("Đang lấy từ khóa website đang có thứ hạng (DataForSEO)…");
      try {
        const [rows] = await rankedKeywords(cfg, d, 2704, "vi", 1000, notes);
        for (const r of rows) if (r.url) (ranks[ukey(r.url)] ||= []).push({ keyword: r.keyword, volume: r.volume ?? null, pos: r.pos ?? null });
      } catch (e: any) {
        if (!(e instanceof SeoError)) throw e;
        notes.push(`Không lấy được thứ hạng: ${e.message}`);
      }
    }
    st.ranks = ranks;
    st.step = "write";
    ctx.progress("Đang dựng liên kết nội bộ và lưu danh sách trang…");
    return;
  }
  if (st.step === "write") {
    const crawl = await loadStage(job.id);
    for (const [k, v] of crawl) {
      const fk = ukey(v.final_url);
      if (fk !== k && crawl.has(fk)) v.redirect_to = fk;
    }
    const { inl, anchorsIn, broken, depth } = linkGraph(st.home, crawl);
    const g = st.gsc_ok ? await gscMaps() : { pg: new Map(), qm: new Map(), ga: new Map() };
    const ts = now();
    st.ts = ts;
    const rows: any[][] = [];
    for (const [k, v] of crawl) {
      if (v.redirect_to || v.stub) continue;
      const gp = g.pg.get(k) || {};
      const gdata = { cur: gp.cur ?? null, prev: gp.prev ?? null, old: gp.old ?? null, queries: g.qm.get(k) || [] };
      const gav = g.ga.get(pathKey(v.url)) || {};
      rows.push([sid, k, v.url, v.type, v.status, v.final_url, v.in_sitemap ? 1 : 0, v.title ?? "", v.h1 ?? "", v.words ?? null, v.noindex ? 1 : 0,
        v.canonical ?? "", depth.get(k) ?? null, inl.get(k)?.size || 0, (v.anchors || []).length, JSON.stringify((v.anchors || []).map((a: any) => a[0])),
        JSON.stringify((anchorsIn.get(k) || []).slice(0, 60)), JSON.stringify(broken.get(k) || []), JSON.stringify(gdata), JSON.stringify(gav),
        JSON.stringify((st.ranks[k] || []).slice(0, 10)), ts, ts]);
    }
    await tx(async (t: any) => {
      await run("UPDATE seo_smap_pages SET active=0 WHERE site_id=?", [sid], t);
      await bulk(`INSERT INTO seo_smap_pages(site_id, ukey, url, type, status, final_url, in_sitemap, title, h1, words, noindex, canonical, depth,
                  inlinks, outlinks, links_json, anchors_in_json, broken_json, gsc_json, ga_json, ranks_json, last_seen, first_seen, active)`,
        "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)", rows,
        `ON CONFLICT (site_id, ukey) DO UPDATE SET url=EXCLUDED.url, type=EXCLUDED.type, status=EXCLUDED.status, final_url=EXCLUDED.final_url,
         in_sitemap=EXCLUDED.in_sitemap, title=EXCLUDED.title, h1=EXCLUDED.h1, words=EXCLUDED.words, noindex=EXCLUDED.noindex,
         canonical=EXCLUDED.canonical, depth=EXCLUDED.depth, inlinks=EXCLUDED.inlinks, outlinks=EXCLUDED.outlinks, links_json=EXCLUDED.links_json,
         anchors_in_json=EXCLUDED.anchors_in_json, broken_json=EXCLUDED.broken_json, gsc_json=EXCLUDED.gsc_json, ga_json=EXCLUDED.ga_json,
         ranks_json=EXCLUDED.ranks_json, last_seen=EXCLUDED.last_seen, active=1`, t);
    });
    await run("DELETE FROM seo_smap_stage WHERE job_id=?", [job.id]);
    st.ranks = {};
    // 3. chuẩn bị AI gán từ khóa
    const pages = await loadPages(sid);
    const need = pages.filter((p: any) => p.status === 200 && !p.noindex && !p.kw_locked && (opts.full_ai || !p.primary_kw || !p.kw_at));
    st.ai_need = need.length;
    st.ai_ids = [];
    if (need.length && cfg.anthropic_api_key && (opts.ai ?? true)) {
      st.ai_ids = [...need].sort((a: any, b: any) => (a.url.split("/").length - b.url.split("/").length) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)).map((p: any) => p.id);
      // câu hỏi AI đã giao cho từng URL (tab Câu hỏi AI)
      const c = await siteContext(d);
      st.aiq_t = {};
      if (c.aiq_id) {
        for (const r of await q("SELECT question, target_url FROM seo_aiq_questions WHERE project_id=? AND status<>'ignored' AND target_url<>''", [c.aiq_id])) {
          (st.aiq_t[ukey(r.target_url)] ||= []).push(r.question);
        }
      }
      st.ai_i = 0;
      st.ai_done = 0;
      st.clusters = [];
      st.step = "ai";
      ctx.progress(`AI đang gán từ khóa cho trang 1–${Math.min(30, st.ai_ids.length)}/${st.ai_ids.length}…`);
      return;
    }
    if (need.length && !cfg.anthropic_api_key) notes.push("Chưa có khóa Claude: bỏ qua bước gán từ khóa bằng AI.");
    st.step = "score_init";
    return;
  }
  if (st.step === "ai") {
    const ids = st.ai_ids.slice(st.ai_i, st.ai_i + 30);
    const pages = await loadPages(sid, true, ids);
    const byId = new Map(pages.map((p: any) => [p.id, p]));
    const rows = ids.filter((i: number) => byId.has(i)).map((i: number) => {
      const p = byId.get(i);
      return { id: p.id, url: p.url, type: p.type, title: p.title || "", h1: p.h1 || "", words: p.words || 0,
        queries: p.gsc?.queries || null, ranks: p.ranks, aiq: st.aiq_t[p.ukey] || [] };
    });
    if (rows.length) {
      const ctxp = await siteContext(d);
      const res = await assignBatch(site, ctxp, rows, st.clusters, cfg);
      for (const [pid, x] of res) {
        await run("UPDATE seo_smap_pages SET primary_kw=?, secondary_json=?, geo_json=?, intent=?, role=?, cluster=?, kw_note=?, kw_at=? WHERE id=? AND site_id=? AND kw_locked=0",
          [squash(x.primary || ""), JSON.stringify(x.secondary || []), JSON.stringify(x.geo || []), x.intent || "info", x.role || "other",
            String(x.cluster || "").slice(0, 60), x.note || "", st.ts, pid, sid]);
      }
      st.ai_done += res.size;
    }
    st.ai_i += ids.length;
    if (st.ai_i < st.ai_ids.length) {
      ctx.progress(`AI đang gán từ khóa cho trang ${st.ai_i + 1}–${Math.min(st.ai_i + 30, st.ai_ids.length)}/${st.ai_ids.length}…`);
      return;
    }
    notes.push(`AI đã gán từ khóa cho ${st.ai_done}/${st.ai_need} trang.`);
    st.ai_ids = [];
    st.aiq_t = {};
    st.step = "score_init";
    return;
  }

  // 4a. điểm SEO + GEO (đọc lại trang)
  if (st.step === "score_init") {
    const ok = (await loadPages(sid)).filter((p: any) => p.status === 200);
    st.score_ids = ok.map((p: any) => p.id);
    st.titles = ok.map((p: any) => p.title).filter(Boolean);
    await run("INSERT INTO seo_audit_sites(domain) VALUES (?) ON CONFLICT (domain) DO NOTHING", [d]);
    st.asid = (await one("SELECT id FROM seo_audit_sites WHERE domain=?", [d])).id;
    st.si = 0;
    st.step = "score";
    ctx.progress(`Đang chấm điểm SEO và GEO 0/${st.score_ids.length} trang…`);
    return;
  }
  if (st.step === "score") {
    while (st.si < st.score_ids.length && Date.now() < ctx.deadline) {
      const ids = st.score_ids.slice(st.si, st.si + 10);
      const pages = await loadPages(sid, true, ids);
      await pool(pages, 5, async (p: any) => {
        let sc = null, sf: any[] = [], gs = null, gf: any[] = [], rep: any = null;
        try {
          const res = await fetchPage(p.url, 25);
          rep = await auditPage(p.url, p.type, p.primary_kw || "", new Set(st.titles.filter((t: string) => t !== p.title)), false, res);
          const fails = rep.checks.filter((c: any) => c.status === "fail" || c.status === "warn").map((c: any) => ({ label: c.label, fix: c.fix, status: c.status }));
          fails.sort((a: any, b: any) => Number(a.status !== "fail") - Number(b.status !== "fail"));
          sc = rep.score;
          sf = fails.slice(0, 12);
          const gp: any = await readPage(p.url, 4000, res);
          if (!gp.error) {
            const ch = structureChecks(gp, p.primary_kw || p.title || "");
            const mx = ch.filter((c) => c.weight < 30).reduce((a, c) => a + c.weight, 0);
            const got = ch.filter((c) => c.weight < 30).reduce((a, c) => a + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
            gs = mx ? pyRound((got / mx) * 100) : null;
            if (gp.noindex || gp.nosnippet) gs = Math.min(gs || 0, 10);
            gf = ch.filter((c) => c.status !== "pass").map((c) => ({ label: c.label, fix: c.fix }));
          }
        } catch {
          // bản gốc: trang lỗi khi chấm thì để trống điểm
          [sc, sf, gs, gf, rep] = [null, [], null, [], null];
        }
        await run("UPDATE seo_smap_pages SET seo=?, seo_fails_json=?, geo_score=?, geo_fails_json=? WHERE id=?",
          [sc, JSON.stringify(sf), gs, JSON.stringify(gf), p.id]);
        if (rep) {
          await run("INSERT INTO seo_audit_pages(site_id, url, type, source) VALUES (?,?,?,?) ON CONFLICT (site_id, url) DO NOTHING", [st.asid, p.url, p.type, "smap"]);
          const apid = (await one("SELECT id FROM seo_audit_pages WHERE site_id=? AND url=?", [st.asid, p.url])).id;
          await run("INSERT INTO seo_audit_results(page_id, audited_at, score, keyword, report_json) VALUES (?,?,?,?,?)", [apid, st.ts, rep.score, rep.keyword, JSON.stringify(rep)]);
        }
      });
      st.si += ids.length;
      ctx.progress(`Đang chấm điểm SEO và GEO ${st.si}/${st.score_ids.length} trang…`);
    }
    if (st.si < st.score_ids.length) return;
    const n = (await one("SELECT COUNT(*) n FROM seo_audit_pages WHERE site_id=?", [st.asid])).n;
    await run("UPDATE seo_audit_sites SET start_url=COALESCE(start_url, ?), crawled_at=?, method=?, count=? WHERE id=?", [`https://${d}/`, st.ts, st.method, n, st.asid]);
    st.score_ids = [];
    st.titles = [];
    st.step = "psi_init";
    return;
  }

  // 4b. tốc độ
  if (st.step === "psi_init") {
    const mode = opts.psi_mode || site.psi_mode;
    st.step = "inspect_init";
    if (mode === "off") return;
    const all = (await loadPages(sid)).filter((p: any) => p.status === 200 && !p.noindex);
    let cand = all;
    if (mode === "smart") {
      const top = [...all].sort(byNum((p) => -pageValue(p))).slice(0, 40);
      const pick = new Map(top.map((p: any) => [p.id, p]));
      const per = new Map<string, any[]>();
      for (const p of all) {
        const k = p.role || p.type;
        if (!per.has(k)) per.set(k, []);
        per.get(k).push(p);
      }
      for (const lst of per.values()) for (const p of lst.slice(0, 3)) if (!pick.has(p.id)) pick.set(p.id, p);
      cand = [...pick.values()];
    }
    st.psi = cand.map((p: any) => [p.id, p.url]);
    st.pi = 0;
    st.psi_errs = [];
    if (!(await psiKey(cfg))) notes.push("Chưa có khóa PageSpeed Insights API: đo chậm hơn và dễ bị Google giới hạn.");
    st.step = "psi";
    ctx.progress(`Đang đo tốc độ di động ${st.psi.length} trang (PageSpeed Insights)…`);
    return;
  }
  if (st.step === "psi") {
    const key = await psiKey(cfg);
    while (st.pi < st.psi.length && Date.now() < ctx.deadline) {
      const batch = st.psi.slice(st.pi, st.pi + (key ? 4 : 1));
      await Promise.all(batch.map(async ([pid, url]: any) => {
        try {
          const r = await psi(url, key);
          await run("UPDATE seo_smap_pages SET psi_json=? WHERE id=?", [JSON.stringify(r), pid]);
        } catch (e: any) {
          if (!(e instanceof SeoError)) throw e;
          st.psi_errs.push(e.message);
        }
      }));
      st.pi += batch.length;
      ctx.progress(`Đang đo tốc độ ${st.pi}/${st.psi.length} trang…`);
    }
    if (st.pi < st.psi.length) return;
    if (st.psi_errs.length) notes.push(`PageSpeed: ${st.psi_errs.length} trang chưa đo được (${st.psi_errs[0]}).`);
    st.psi = [];
    st.psi_errs = [];
    st.step = "inspect_init";
    return;
  }

  // 4c. index (Search Console URL Inspection, miễn phí, hạn mức)
  if (st.step === "inspect_init") {
    st.step = "links";
    if (!(opts.inspect ?? Boolean(site.inspect))) return;
    const imp = (await loadPages(sid)).filter((p: any) => p.status === 200 && !p.noindex).sort(byNum((p) => -pageValue(p))).slice(0, 60);
    if (!imp.length) return;
    try {
      await cfgSite();
    } catch (e: any) {
      if (!(e instanceof SeoError)) throw e;
      notes.push(`Kiểm tra index: ${e.message}`);
      return;
    }
    st.insp = { urls: imp.map((p: any) => p.url), done: 0 };
    st.step = "inspect";
    ctx.progress("Đang kiểm tra trạng thái index các trang quan trọng…");
    return;
  }
  if (st.step === "inspect") {
    try {
      const r = await inspectStep({ state: st.insp }, { deadline: ctx.deadline, extra: {}, progress: (m: string) => ctx.progress(m) });
      if (!(r && "done" in r)) return;
    } catch (e: any) {
      if (!(e instanceof SeoError)) throw e;
      notes.push(`Kiểm tra index: ${e.message}`);
    }
    st.insp = null;
    st.step = "links";
    return;
  }

  // 5. trùng từ khóa, liên kết, vấn đề + 6. ảnh chụp, so sánh
  if (st.step === "links") {
    ctx.progress("Đang dựng cấu trúc liên kết nội bộ và danh sách việc cần làm…");
    const ts = st.ts;
    const ix = new Map<string, any>();
    try {
      for (const r of await q("SELECT * FROM seo_gsc_inspect")) ix.set(ukey(r.url), { verdict: r.verdict, coverage: r.coverage, at: r.at, google_canonical: r.google_canonical });
    } catch {}
    let pages = await loadPages(sid);
    const byKey = new Map<string, number>(pages.map((p: any) => [p.ukey, p.id]));
    const kwPages = new Map<string, [number, string][]>();
    for (const p of pages) {
      if (!p.primary_kw || p.status !== 200) continue;
      const fk = fold(p.primary_kw);
      if (!kwPages.has(fk)) kwPages.set(fk, []);
      kwPages.get(fk).push([p.id, p.primary_kw]);
    }
    const groups = await cannibalGroups(byKey, kwPages);
    const cids = new Set<number>(groups.flatMap((gr: any) => gr.pages.map((x: any) => x.id)));
    const pmap = new Map<number, any>();
    for (const p of pages) {
      p.index = ix.get(p.ukey) ?? null;
      const cur = p.gsc?.cur || {};
      pmap.set(p.id, { ...p, gsc: { impr: cur.impr ?? null, pos: cur.pos ?? null } });
    }
    const [sugg, hubs] = linkSuggestions(pmap);
    await tx(async (t: any) => {
      await bulk("UPDATE seo_smap_pages p SET index_json=v.ix, issues_json=v.iss, value=v.val FROM (", "(?::bigint,?::text,?::text,?::double precision)",
        pages.map((p: any) => [p.id, p.index ? JSON.stringify(p.index) : null, JSON.stringify(pageIssues(p, cids)), pageValue(p)]),
        ") v(id, ix, iss, val) WHERE p.id=v.id", t);
      const old = new Map((await q("SELECT from_id, to_id, status FROM seo_smap_links WHERE site_id=?", [sid], t)).map((r: any) => [r.from_id + ":" + r.to_id, r.status]));
      const linked = new Set<string>();
      for (const p of pages) for (const k of p.links) if (byKey.has(k)) linked.add(p.id + ":" + byKey.get(k));
      const done = [...old].filter(([k, s]) => linked.has(k) && s !== "done").map(([k]) => k.split(":"));
      await bulk("UPDATE seo_smap_links l SET status='done', updated_at=? FROM (", "(?::bigint,?::bigint)", done,
        ") v(f, t) WHERE l.site_id=? AND l.from_id=v.f AND l.to_id=v.t", t, [ts], [sid]);
      await run("DELETE FROM seo_smap_links WHERE site_id=? AND status='todo'", [sid], t);
      await bulk("INSERT INTO seo_smap_links(site_id, from_id, to_id, anchor, reason, kind, priority, status, created_at, updated_at)", "(?,?,?,?,?,?,?,'todo',?,?)",
        sugg.filter((s) => !["skip", "done"].includes(old.get(s.from_id + ":" + s.to_id)))
          .map((s) => [sid, s.from_id, s.to_id, s.anchor, s.reason, s.kind, s.priority, ts, ts]),
        `ON CONFLICT (site_id, from_id, to_id) DO UPDATE SET anchor=EXCLUDED.anchor, reason=EXCLUDED.reason, kind=EXCLUDED.kind,
         priority=EXCLUDED.priority, status='todo', place_json=NULL, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`, t);
    });
    pages = await loadPages(sid);
    const prev = await one("SELECT id FROM seo_smap_cycles WHERE site_id=? ORDER BY id DESC LIMIT 1", [sid]);
    const cid = (await run("INSERT INTO seo_smap_cycles(site_id, at, auto) VALUES (?,?,?) RETURNING id", [sid, ts, st.auto ? 1 : 0])).rows[0].id;
    await tx((t: any) => bulk("INSERT INTO seo_smap_snaps(cycle_id, page_id, clicks, impr, pos, seo, geo, perf, inlinks, status, primary_kw, rank)", "(?,?,?,?,?,?,?,?,?,?,?,?)",
      pages.map((p: any) => {
        const c = p.gsc?.cur || {};
        return [cid, p.id, c.clicks ?? null, c.impr ?? null, c.pos ?? null, p.seo, p.geo_score, p.psi?.perf ?? null, p.inlinks, p.status, p.primary_kw, rankOf(p)];
      }),
      `ON CONFLICT (cycle_id, page_id) DO UPDATE SET clicks=EXCLUDED.clicks, impr=EXCLUDED.impr, pos=EXCLUDED.pos, seo=EXCLUDED.seo, geo=EXCLUDED.geo,
       perf=EXCLUDED.perf, inlinks=EXCLUDED.inlinks, status=EXCLUDED.status, primary_kw=EXCLUDED.primary_kw, rank=EXCLUDED.rank`, t));
    st.cid = cid;
    st.diff = await compare(prev ? prev.id : null, pages);
    st.summ = await summary(sid, pages, groups, hubs);
    st.groups = groups;
    st.step = "report";
    if ((opts.report ?? true) && cfg.anthropic_api_key) ctx.progress("AI đang viết báo cáo và việc cần làm…");
    return;
  }
  if (st.step === "report") {
    let report = null;
    if ((opts.report ?? true) && cfg.anthropic_api_key) {
      try {
        report = await aiReport(site, await siteContext(d), st.summ, st.diff, await loadPages(sid), st.groups, cfg);
      } catch (e: any) {
        if (!(e instanceof SeoError)) console.error("[bản đồ website] báo cáo AI lỗi:", e);
        notes.push(`Chưa viết được báo cáo AI: ${e?.message || e}`);
      }
    }
    const cost = Math.max(0, (await spentTotal()) - (st.t0 || 0));
    await run("UPDATE seo_smap_cycles SET summary_json=?, diff_json=?, cannibal_json=?, report_json=?, notes_json=?, cost_usd=? WHERE id=?",
      [JSON.stringify(st.summ), JSON.stringify(st.diff), JSON.stringify(st.groups), report ? JSON.stringify(report) : null, JSON.stringify(notes), cost, st.cid]);
    const res = { cycle_id: st.cid, summary: st.summ, alerts: (st.diff.alerts || []).length, notes, cost_usd: cost };
    st.diff = st.groups = null;
    return { done: res };
  }
  throw new SeoError("Trạng thái phân tích không hợp lệ");
}));

async function summary(sid: any, pages: any[], groups: any[], hubs: Map<string, number>) {
  const act = pages.filter((p) => p.status === 200 && !p.noindex);
  const avg = (xs: number[]) => (xs.length ? pyRound(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const sumOf = (f: (p: any) => number) => pages.reduce((a, p) => a + (f(p) || 0), 0);
  const lk = Object.fromEntries((await q("SELECT status, COUNT(*) n FROM seo_smap_links WHERE site_id=? GROUP BY status", [sid])).map((r: any) => [r.status, r.n]));
  const perf = act.map((p) => p.psi?.perf).filter((x) => x !== null && x !== undefined);
  const clus = new Map<string, any>();
  for (const p of act) {
    const c = p.cluster || "Chưa phân nhóm";
    const e = clus.get(c) || { cluster: c, pages: 0, clicks: 0, impr: 0, hub: null };
    clus.set(c, e);
    e.pages++;
    const cur = p.gsc?.cur || {};
    e.clicks += cur.clicks || 0;
    e.impr += cur.impr || 0;
  }
  for (const [c, h] of hubs) if (clus.has(c)) clus.get(c).hub = h;
  return {
    pages: pages.length, ok: act.length, errors: pages.filter((p) => p.status && p.status >= 400).length,
    noindex: pages.filter((p) => p.noindex).length, with_kw: act.filter((p) => p.primary_kw).length,
    avg_seo: avg(act.map((p) => p.seo).filter((x) => x !== null && x !== undefined)), avg_geo: avg(act.map((p) => p.geo_score).filter((x) => x !== null && x !== undefined)),
    avg_perf: avg(perf), perf_measured: perf.length, slow: perf.filter((x) => x < 50).length,
    orphans: act.filter((p) => (p.inlinks || 0) === 0 && p.role !== "home").length, deep: act.filter((p) => (p.depth || 0) > 3).length,
    not_indexed: act.filter((p) => ![null, undefined, "PASS"].includes(p.index?.verdict)).length,
    cannibal: groups.length, clicks: sumOf((p) => p.gsc?.cur?.clicks), clicks_prev: sumOf((p) => p.gsc?.prev?.clicks), impr: sumOf((p) => p.gsc?.cur?.impr),
    key_events: sumOf((p) => p.ga?.cur?.key_events), links_todo: lk.todo || 0, links_done: lk.done || 0,
    issues: act.reduce((a, p) => a + (p.issues || []).length, 0), clusters: [...clus.values()].sort((a, b) => b.impr - a.impr).slice(0, 20),
  };
}

async function compare(prevId: any, pages: any[]) {
  const alerts: any[] = [];
  if (!prevId) return { first: true, alerts: [] };
  const old = new Map((await q("SELECT * FROM seo_smap_snaps WHERE cycle_id=?", [prevId])).map((r: any) => [r.page_id, r]));
  const curIds = new Set(pages.map((p) => p.id));
  const A = (page_id: number, sev: number, kind: string, text: string) => alerts.push({ page_id, sev, kind, text });
  for (const p of pages) {
    const o = old.get(p.id);
    const name = p.primary_kw || p.url;
    const cur = p.gsc?.cur || {};
    if (!o) {
      if (p.status === 200) A(p.id, 1, "new", `Trang mới: ${p.url}`);
      continue;
    }
    if (o.status === 200 && p.status && p.status >= 400) A(p.id, 3, "error", `Trang bị lỗi HTTP ${p.status} (trước đây bình thường)`);
    const c0 = o.clicks || 0, c1 = cur.clicks || 0;
    if (c0 >= 10 && c1 <= c0 * 0.7) A(p.id, c0 >= 50 ? 3 : 2, "drop", `Click giảm ${c0} → ${c1} (${name})`);
    else if (c1 >= 10 && c1 >= c0 * 1.3 && c1 - c0 >= 5) A(p.id, 0, "up", `Click tăng ${c0} → ${c1} (${name})`);
    const p0 = o.pos, p1 = cur.pos;
    if (p0 && p1 && (cur.impr || 0) >= 50 && p1 - p0 >= 3) A(p.id, 2, "rank", `Vị trí trung bình tụt ${p0.toFixed(1)} → ${p1.toFixed(1)} (${name})`);
    else if (p0 && p1 && (cur.impr || 0) >= 50 && p0 - p1 >= 3) A(p.id, 0, "up", `Vị trí trung bình tăng ${p0.toFixed(1)} → ${p1.toFixed(1)} (${name})`);
    const f0 = o.perf, f1 = p.psi?.perf ?? null;
    if (f0 !== null && f1 !== null && f0 - f1 >= 15) A(p.id, 2, "speed", `Tốc độ di động giảm ${f0} → ${f1} (${p.url})`);
    const s0 = o.seo, s1 = p.seo;
    if (s0 !== null && s1 !== null && s0 - s1 >= 10) A(p.id, 2, "seo", `Điểm SEO giảm ${s0} → ${s1} (${p.url})`);
    if ((o.inlinks || 0) >= 2 && (p.inlinks || 0) === 0) A(p.id, 2, "link", `Mất hết liên kết nội bộ trỏ tới (${p.url})`);
    if (o.rank && o.primary_kw === p.primary_kw) {
      const r1 = rankOf(p);
      if (r1 && r1 - o.rank >= 3) A(p.id, 2, "rank", `"${p.primary_kw}" tụt top ${o.rank} → ${r1}`);
      else if (r1 && o.rank - r1 >= 3) A(p.id, 0, "up", `"${p.primary_kw}" lên top ${o.rank} → ${r1}`);
    }
  }
  for (const pid of old.keys()) if (!curIds.has(pid)) A(pid, 2, "gone", "Trang không còn tìm thấy khi quét (đã xóa hoặc đổi đường dẫn?)");
  alerts.sort((a, b) => b.sev - a.sev);
  return { first: false, prev_cycle: prevId, alerts: alerts.slice(0, 200) };
}

async function aiReport(site: any, ctx: any, summ: any, diff: any, pages: any[], groups: any[], cfg: any) {
  const top = pages.filter((p) => p.status === 200).sort(byNum((p) => -(p.value || 0))).slice(0, 40);
  const lines = top.map((p) => `- ${p.url} | ${ROLE_VI[p.role || "other"] || "Khác"} | từ khóa: ${p.primary_kw || "-"} | SEO ${p.seo} | GEO ${p.geo_score} | tốc độ ${p.psi?.perf ?? null} | `
    + `click ${p.gsc?.cur?.clicks ?? 0} | vị trí ${pyRound(p.gsc?.cur?.pos || 0, 1)} | link vào ${p.inlinks} | `
    + `vấn đề: ${(p.issues || []).slice(0, 3).map((i: any) => i.text).join("; ") || "không"}`);
  const al = (diff.alerts || []).slice(0, 30).map((a: any) => `- ${a.text}`).join("\n") || "(lần phân tích đầu tiên hoặc không có thay đổi lớn)";
  const cg = groups.slice(0, 10).map((g: any) => `- "${g.keyword}": ${g.pages.length} trang`).join("\n") || "(không có)";
  const { clusters, ...s2 } = summ;
  const prompt = `Bạn là trưởng nhóm SEO + GEO cho website bán hàng ${site.domain} (thương hiệu ${ctx.brands.join(", ")}; lĩnh vực ${ctx.topics.join(", ") || "theo nội dung website"}).
Mục tiêu duy nhất: tăng KHÁCH HÀNG TIỀM NĂNG từ Google và AI (ChatGPT, Gemini, AI Overview), ưu tiên trang danh mục/sản phẩm và câu hỏi sắp mua.

Số liệu tổng: ${JSON.stringify(s2)}
Nhóm chủ đề: ${JSON.stringify(clusters.map((c: any) => ({ cluster: c.cluster, pages: c.pages, clicks: c.clicks, impr: c.impr })))}
Thay đổi so với lần trước:
${al}
Trùng từ khóa:
${cg}
40 trang giá trị nhất:
${lines.join("\n")}

Viết báo cáo ngắn gọn, cụ thể, làm được ngay. Chỉ trả về JSON hợp lệ:
{
  "headline": "1 câu kết luận tình hình",
  "health": "tốt|trung bình|cần xử lý",
  "wins": ["điều đang tốt lên"],
  "problems": ["vấn đề lớn nhất, có số liệu"],
  "actions": [{"title": "việc cần làm", "why": "vì sao ảnh hưởng tới khách hàng tiềm năng", "pages": ["URL liên quan"], "impact": "cao|vừa|thấp", "effort": "ít|vừa|nhiều", "owner": "nội dung|kỹ thuật|liên kết"}],
  "next_focus": "trọng tâm cho chu kỳ tới"
}
Tối đa 12 việc, sắp theo tác động tới khách hàng tiềm năng.`;
  const [txt] = await moduleAs("smap_report", () => claude(cfg, prompt, 4000, null, "smap_report"));
  const rep = extractJson(txt, "AI trả về dữ liệu không hợp lệ");
  rep.at = now();
  return rep;
}

// ---------------------------------------------------------------- tư vấn từng trang, vị trí đặt link, đo lại tốc độ
registerStep("smap_page", (job, ctx) => moduleAs("smap_page", async () => {
  const pid = job.state.pid;
  const cfg = await loadConfig();
  const p = await pageDetail(pid);
  if (!p) throw new SeoError("Không tìm thấy trang");
  const site = await getSite(p.site_id);
  ctx.progress("Đang đọc trang…");
  const gp: any = await readPage(p.url, 5000);
  const cfgVars = (cfg.ap_variables || []).filter((v: any) => v.name && v.value).map((v: any) => `- ${v.name}: ${v.value}`).join("\n");
  const linksIn = p.links_in.slice(0, 10).map((x: any) => `${x.url} ("${x.anchor}")`).join(", ") || "không có";
  const sug = p.sugg_to.slice(0, 5).map((x: any) => `từ ${x.from_url} chữ neo "${x.anchor}"`).join("; ") || "-";
  const ps = p.psi || {};
  const prompt = `Bạn là chuyên gia SEO + GEO. Tư vấn tối ưu MỘT trang của ${site.domain} để mang về nhiều khách hàng tiềm năng nhất từ Google và AI.

URL: ${p.url} (${ROLE_VI[p.role || "other"] || "Khác"}, nhóm "${p.cluster}", ý định ${p.intent})
Từ khóa chính: ${p.primary_kw} | phụ: ${(p.secondary || []).join(", ")}
Câu hỏi AI trang cần trả lời: ${(p.geo || []).join(", ") || "-"}
Search Console 28 ngày: ${JSON.stringify(p.gsc?.cur ?? null)}; trước đó: ${JSON.stringify(p.gsc?.prev ?? null)}
Từ khóa Google thật: ${(p.gsc?.queries || []).slice(0, 12).map((x: any) => `${x[0]} (${x[1]} hiển thị, vị trí ${x[3]})`).join("; ")}
Lỗi SEO: ${(p.seo_fails || []).slice(0, 8).map((x: any) => x.label).join("; ") || "không"}
Cấu trúc GEO thiếu: ${(p.geo_fails || []).map((x: any) => x.label).join("; ") || "không"}
Tốc độ di động: ${JSON.stringify({ perf: ps.perf ?? null, lcp: ps.lcp ?? null, tbt: ps.tbt ?? null, cls: ps.cls ?? null })}; gợi ý: ${(ps.opps || []).slice(0, 4).map((o: any) => o.title).join("; ")}
Liên kết vào: ${p.inlinks} (${linksIn}); gợi ý thêm: ${sug}
Vấn đề: ${(p.issues || []).map((i: any) => i.text).join("; ")}
Nội dung hiện tại: Title "${gp.title || ""}" | H1 ${(gp.h1 || []).join(", ")} | ${gp.word_count ?? ""} chữ | Headings: ${(gp.headings || []).slice(0, 20).map(([, t]: any) => t).join(" | ")}
Trích nội dung: ${String(gp.text || "").slice(0, 2500)}
Thông tin doanh nghiệp (không bịa thêm): ${cfgVars || "-"}

Chỉ trả về JSON hợp lệ:
{
  "verdict": "1-2 câu tình trạng",
  "title": "title đề xuất 50-60 ký tự", "meta_description": "120-155 ký tự", "h1": "H1 đề xuất",
  "outline_add": ["H2/H3 nên thêm để phủ từ phụ và câu hỏi AI"],
  "answer_paragraph": "đoạn 40-60 chữ đặt ngay dưới H1, trả lời thẳng ý định chính",
  "conversion": ["việc tăng chuyển đổi: nút gọi, bảng giá, so sánh, chính sách, đánh giá..."],
  "tech": ["việc kỹ thuật/tốc độ cụ thể"],
  "priority_actions": ["3-6 việc theo thứ tự làm"]
}`;
  ctx.progress("AI đang tư vấn trang…");
  const [txt] = await claude(cfg, prompt, 3000, null, "smap_page");
  const adv = extractJson(txt, "AI trả về dữ liệu không hợp lệ");
  adv.at = now();
  await run("UPDATE seo_smap_pages SET advice_json=? WHERE id=?", [JSON.stringify(adv), pid]);
  return { done: adv };
}));

registerStep("smap_place", (job, ctx) => moduleAs("smap_place", async () => {
  const lid = job.state.lid;
  const cfg = await loadConfig();
  const l = await one(`SELECT l.*, a.url from_url, b.url to_url, b.title to_title FROM seo_smap_links l JOIN seo_smap_pages a ON a.id=l.from_id
                       JOIN seo_smap_pages b ON b.id=l.to_id WHERE l.id=?`, [lid]);
  if (!l) throw new SeoError("Không tìm thấy gợi ý");
  ctx.progress("Đang đọc trang nguồn…");
  const gp: any = await readPage(l.from_url, 6000);
  if (gp.error) throw new SeoError(`Không đọc được trang nguồn: ${gp.error}`);
  const prompt = `Trang nguồn: ${l.from_url} (title: ${gp.title}).
Cần chèn 1 liên kết nội bộ tới ${l.to_url} (trang "${l.to_title}") với chữ neo gần với: "${l.anchor}". Lý do: ${l.reason}.
Nội dung trang nguồn:
${String(gp.text || "").slice(0, 5000)}

Tìm câu phù hợp NHẤT có sẵn trong nội dung để gắn link (chữ neo tự nhiên, 2-6 từ, đúng ngữ cảnh). Nếu không có câu phù hợp, viết 1 câu mới ngắn để chèn và nói chèn sau đoạn nào.
Chỉ trả về JSON hợp lệ: {"found": true, "original": "câu gốc nguyên văn", "new_html": "câu đã gắn <a href=\\"${l.to_url}\\">chữ neo</a>", "where": "vị trí (sau heading/đoạn nào)", "anchor": "chữ neo dùng"}`;
  const [txt] = await claude(cfg, prompt, 900, null, "smap_place");
  const res = extractJson(txt, "AI trả về dữ liệu không hợp lệ");
  await run("UPDATE seo_smap_links SET place_json=?, updated_at=? WHERE id=?", [JSON.stringify(res), now(), lid]);
  return { done: res };
}));

registerStep("smap_psi", async (job, ctx) => {
  const r = await one("SELECT url FROM seo_smap_pages WHERE id=?", [job.state.pid]);
  if (!r) throw new SeoError("Không tìm thấy trang");
  ctx.progress("Đang đo tốc độ (PageSpeed Insights)…");
  const res = await psi(r.url, await psiKey());
  await run("UPDATE seo_smap_pages SET psi_json=? WHERE id=?", [JSON.stringify(res), job.state.pid]);
  return { done: res };
});

// ---------------------------------------------------------------- đọc dữ liệu cho giao diện
async function overview(sid: any) {
  const site = await getSite(sid);
  if (!site) throw new SeoError("Không tìm thấy website.");
  const cyc = await q("SELECT id, at, auto, summary_json, diff_json, report_json, notes_json, cost_usd FROM seo_smap_cycles WHERE site_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 24", [sid]);
  const last = cyc[0] || null;
  const trend = [...cyc].reverse().map((c: any) => {
    const s = jl(c.summary_json, {}) || {};
    return { at: c.at, ...Object.fromEntries(["clicks", "impr", "avg_seo", "avg_geo", "avg_perf", "orphans", "issues", "key_events"].map((k) => [k, s[k] ?? null])) };
  });
  let aiqVis = null;
  const sctx = await siteContext(site.domain);
  if (sctx.aiq_id) {
    try {
      const r = await one("SELECT summary_json, at FROM seo_aiq_runs WHERE project_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1", [sctx.aiq_id]);
      if (r) aiqVis = { visibility: jl(r.summary_json, {}).visibility, at: r.at };
    } catch {}
  }
  return {
    site: { ...site, psi_key: maskKey(await psiKey()) }, running: await runningCycle(sid),
    last: last ? { id: last.id, at: last.at, summary: jl(last.summary_json, {}), diff: jl(last.diff_json, {}), report: jl(last.report_json, null),
      notes: jl(last.notes_json, []), cost_usd: last.cost_usd } : null,
    cycles: cyc.map((c: any) => ({ id: c.id, at: c.at, auto: c.auto, cost_usd: c.cost_usd, alerts: ((jl(c.diff_json, {}) || {}).alerts || []).length })),
    trend, aiq: aiqVis, aiq_id: sctx.aiq_id,
  };
}

async function pagesList(sid: any) {
  return (await loadPages(sid)).map((p: any) => {
    const cur = p.gsc?.cur || {}, prev = p.gsc?.prev || {};
    return {
      id: p.id, url: p.url, title: p.title, type: p.type, role: p.role, cluster: p.cluster, intent: p.intent,
      status: p.status, noindex: p.noindex, primary_kw: p.primary_kw, secondary: p.secondary || [], geo: p.geo || [],
      locked: p.kw_locked, clicks: cur.clicks ?? null, clicks_prev: prev.clicks ?? null, impr: cur.impr ?? null, pos: cur.pos ?? null,
      pos_prev: prev.pos ?? null, seo: p.seo, geo_score: p.geo_score, perf: p.psi?.perf ?? null,
      lcp: p.psi?.lcp ?? null, inlinks: p.inlinks, depth: p.depth, index: p.index?.verdict ?? null,
      issues: p.issues || [], value: p.value, key_events: p.ga?.cur?.key_events ?? null, advised: Boolean(p.advice),
    };
  });
}

async function pageDetail(pid: any) {
  const r = await one("SELECT site_id FROM seo_smap_pages WHERE id=?", [pid]);
  if (!r) return null;
  const sid = r.site_id;
  const names = new Map((await q("SELECT id, url, primary_kw, ukey FROM seo_smap_pages WHERE site_id=?", [sid])).map((x: any) => [x.id, [x.url, x.primary_kw, x.ukey]]));
  const hist = await q(`SELECT c.at, s.clicks, s.impr, s.pos, s.seo, s.geo, s.perf, s.inlinks, s.rank, s.primary_kw FROM seo_smap_snaps s
                        JOIN seo_smap_cycles c ON c.id=s.cycle_id WHERE s.page_id=? ORDER BY c.id`, [pid]);
  const sto = await q("SELECT * FROM seo_smap_links WHERE to_id=? AND status='todo' ORDER BY priority DESC LIMIT 20", [pid]);
  const sfrom = await q("SELECT * FROM seo_smap_links WHERE from_id=? AND status='todo' ORDER BY priority DESC LIMIT 20", [pid]);
  const p = (await loadPages(sid, false, [Number(pid)]))[0];
  if (!p) return null;
  const bykey = new Map([...names].map(([id, v]) => [v[2], id]));
  p.links_in = (p.anchors_in || []).map(([k, a]: any) => {
    const id = bykey.get(k) ?? null;
    return { id, url: id !== null ? names.get(id)[0] : k, anchor: a };
  });
  p.links_out = p.links.slice(0, 80).map((k: string) => {
    const id = bykey.get(k);
    return { id: id ?? null, url: id !== undefined ? names.get(id)[0] : "https://" + k, kw: id !== undefined ? names.get(id)[1] : "" };
  });
  for (const s of sto) {
    s.from_url = names.get(s.from_id)?.[0] || "";
    s.place = jl(s.place_json, null);
    delete s.place_json;
  }
  for (const s of sfrom) {
    s.to_url = names.get(s.to_id)?.[0] || "";
    s.place = jl(s.place_json, null);
    delete s.place_json;
  }
  p.sugg_to = sto;
  p.sugg_from = sfrom;
  p.history = hist;
  return p;
}

async function keywordsView(sid: any) {
  const pages = new Map((await loadPages(sid)).map((p: any) => [p.id, p]));
  const c = await one("SELECT cannibal_json FROM seo_smap_cycles WHERE site_id=? AND cannibal_json IS NOT NULL ORDER BY id DESC LIMIT 1", [sid]);
  const groups = c ? jl(c.cannibal_json, []) : [];
  for (const g of groups) {
    for (const x of g.pages) {
      const p = pages.get(x.id) || {};
      Object.assign(x, { url: p.url ?? null, primary_kw: p.primary_kw ?? null, role: p.role ?? null });
    }
  }
  let gaps: any[] = [];
  const site = await getSite(sid);
  const sctx = await siteContext(site.domain);
  if (sctx.aiq_id) {
    gaps = await q("SELECT id, question, cluster, priority FROM seo_aiq_questions WHERE project_id=? AND status='track' AND (target_url IS NULL OR target_url='') ORDER BY priority DESC LIMIT 60", [sctx.aiq_id]);
  }
  const kwmap = [...pages.values()].filter((p: any) => p.primary_kw).map((p: any) => ({
    id: p.id, kw: p.primary_kw, url: p.url, role: p.role, cluster: p.cluster, intent: p.intent,
    secondary: p.secondary || [], pos: p.gsc?.cur?.pos ?? null, rank: rankOf(p),
  })).sort((a, b) => {
    const ca = a.cluster || "", cb = b.cluster || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    const pa = Number(a.role !== "pillar"), pb = Number(b.role !== "pillar");
    if (pa !== pb) return pa - pb;
    return a.kw < b.kw ? -1 : a.kw > b.kw ? 1 : 0;
  });
  return { cannibal: groups, gaps, map: kwmap, aiq_id: sctx.aiq_id };
}

async function linksView(sid: any) {
  const pages = new Map((await loadPages(sid)).map((p: any) => [p.id, p]));
  const sug = await q("SELECT * FROM seo_smap_links WHERE site_id=? ORDER BY (status='todo') DESC, priority DESC LIMIT 600", [sid]);
  const c = await one("SELECT summary_json FROM seo_smap_cycles WHERE site_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1", [sid]);
  for (const s of sug) {
    const a = pages.get(s.from_id) || {}, b = pages.get(s.to_id) || {};
    Object.assign(s, { from_url: a.url ?? null, from_kw: a.primary_kw ?? null, to_url: b.url ?? null, to_kw: b.primary_kw ?? null, place: jl(s.place_json, null) });
    delete s.place_json;
  }
  const clus = (c ? jl(c.summary_json, {}) : {}).clusters || [];
  const tree = clus.map((cl: any) => {
    const mem = [...pages.values()].filter((p: any) => (p.cluster || "Chưa phân nhóm") === cl.cluster && p.status === 200);
    const hub = cl.hub ? pages.get(cl.hub) : null;
    const items = mem.map((p: any) => ({
      id: p.id, url: p.url, kw: p.primary_kw, role: p.role, inlinks: p.inlinks, depth: p.depth,
      to_hub: hub && p.id !== hub.id ? Boolean(p.links.includes(hub.ukey)) : null,
    })).sort((a, b) => Number(a.role !== "pillar") - Number(b.role !== "pillar") || Number(a.role !== "category") - Number(b.role !== "category") || (b.inlinks || 0) - (a.inlinks || 0));
    return {
      cluster: cl.cluster, hub: hub ? { id: hub.id, url: hub.url, kw: hub.primary_kw } : null, pages: items.slice(0, 60),
      missing: sug.filter((s: any) => s.status === "todo" && pages.get(s.to_id)?.cluster === cl.cluster).length,
    };
  });
  const orph = [...pages.values()].filter((p: any) => p.status === 200 && !p.noindex && (p.inlinks || 0) === 0 && p.role !== "home").map((p: any) => ({ id: p.id, url: p.url, kw: p.primary_kw }));
  const brk = [...pages.values()].flatMap((p: any) => (p.broken || []).map((b: any) => ({ from: p.url, to: "https://" + b[0], status: b[1] })));
  return { suggestions: sug, tree, orphans: orph, broken: brk.slice(0, 200) };
}

// ---------------------------------------------------------------- lịch (pg_cron → app.ts)
/** Bắt đầu phân tích định kỳ cho MỘT website đến hạn (nếu có). Trả về id tác vụ hoặc null. */
export async function startDueCycle(): Promise<string | null> {
  for (const s of await q("SELECT id, auto_days FROM seo_smap_sites WHERE auto=1 ORDER BY id")) {
    const last = (await one("SELECT MAX(at) m FROM seo_smap_cycles WHERE site_id=?", [s.id])).m;
    const due = !last || Date.parse(last) < Date.now() - parseInt(s.auto_days) * 864e5;
    if (!due || (await runningCycle(s.id)) || (await overBudget())) continue;
    console.log(`[bản đồ website] phân tích định kỳ website #${s.id}`);
    return await startJob("smap_cycle", newCycleState(s.id, { full_ai: false }, true), "Đang bắt đầu…", {}, true);
  }
  return null;
}

// ---------------------------------------------------------------- API
const MIGRATION = "Chưa chạy sql_migration_v27_seo_ban_do_website.sql trong Supabase (bảng của Bản đồ website / Câu hỏi AI).";

export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3); // /api/smap/<seg...>
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  const sid = parseInt(h.query.get("site_id") || "0") || 0;
  try {
    if (method === "GET" && is("sites")) {
      const ss = await q("SELECT s.*, (SELECT COUNT(*) FROM seo_smap_pages p WHERE p.site_id=s.id AND p.active=1) pages FROM seo_smap_sites s ORDER BY id");
      return h.send_json({ items: ss, psi_key: maskKey(await psiKey()) });
    }
    if (method === "POST" && is("sites")) return h.send_json(await saveSite(await h.read_json()));
    if (method === "DELETE" && is("sites", "*")) {
      await tx(async (t: any) => {
        await run("DELETE FROM seo_smap_snaps WHERE cycle_id IN (SELECT id FROM seo_smap_cycles WHERE site_id=?)", [seg[1]], t);
        for (const tb of ["seo_smap_links", "seo_smap_cycles", "seo_smap_pages"]) await run(`DELETE FROM ${tb} WHERE site_id=?`, [seg[1]], t);
        await run("DELETE FROM seo_smap_sites WHERE id=?", [seg[1]], t);
      });
      return h.send_json({ ok: true });
    }
    if (method === "POST" && is("cycle")) {
      const b = await h.read_json();
      const s2 = parseInt(b.site_id) || 0;
      if (!(await getSite(s2))) return h.send_json({ error: "Không tìm thấy website." }, 400);
      if (await runningCycle(s2)) return h.send_json({ error: "Website này đang được phân tích." }, 409);
      // chu kỳ cũ bị gián đoạn (đóng trang, lỗi giữa chừng) → đánh dấu lỗi để bước init xóa dữ liệu tạm của nó
      await run(`UPDATE seo_jobs SET status='error', message='Bị gián đoạn, đã chạy lại chu kỳ mới.', locked_until=NULL, updated_at=now()
                 WHERE kind='smap_cycle' AND status='running' AND (state->>'sid')::bigint=?`, [s2]);
      return h.send_json({ job_id: await startJob("smap_cycle", newCycleState(s2, b.options || {}, false), "Đang bắt đầu…") });
    }
    if (method === "GET" && is("job", "*")) return h.send_json(await advance(seg[1]));
    if (method === "GET" && is("overview")) return h.send_json(await overview(sid));
    if (method === "GET" && is("pages")) return h.send_json({ items: await pagesList(sid) });
    if (is("page", "*")) {
      if (method === "POST") {
        const b = await h.read_json();
        const sets: string[] = [], vals: any[] = [];
        if ("primary_kw" in b) {
          sets.push("primary_kw=?", "kw_locked=1");
          vals.push(squash(b.primary_kw));
        }
        if ("secondary" in b) {
          sets.push("secondary_json=?");
          vals.push(JSON.stringify((b.secondary || []).filter(Boolean)));
        }
        for (const k of ["role", "cluster", "intent"]) {
          if (k in b) {
            sets.push(`${k}=?`);
            vals.push(b[k]);
          }
        }
        if ("locked" in b) {
          sets.push("kw_locked=?");
          vals.push(b.locked ? 1 : 0);
        }
        if (sets.length) await run(`UPDATE seo_smap_pages SET ${sets.join(", ")} WHERE id=?`, [...vals, parseInt(seg[1])]);
        return h.send_json({ ok: true });
      }
      const d = await pageDetail(parseInt(seg[1]));
      return d ? h.send_json(d) : h.send_json({ error: "Không tìm thấy trang" }, 404);
    }
    if (method === "POST" && is("page", "*", "advise")) {
      if (!(await loadConfig()).anthropic_api_key) throw new SeoError("Chưa có khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
      return h.send_json({ job_id: await startJob("smap_page", { pid: parseInt(seg[1]) }, "Đang đọc trang…") });
    }
    if (method === "POST" && is("page", "*", "psi")) return h.send_json({ job_id: await startJob("smap_psi", { pid: parseInt(seg[1]) }, "Đang đo tốc độ (PageSpeed Insights)…") });
    if (method === "GET" && is("keywords")) return h.send_json(await keywordsView(sid));
    if (method === "GET" && is("links")) return h.send_json(await linksView(sid));
    if (method === "POST" && is("links", "*")) {
      const b = await h.read_json();
      if (["todo", "done", "skip"].includes(b.status)) await run("UPDATE seo_smap_links SET status=?, updated_at=? WHERE id=?", [b.status, now(), parseInt(seg[1])]);
      return h.send_json({ ok: true });
    }
    if (method === "POST" && is("links", "*", "place")) {
      if (!(await loadConfig()).anthropic_api_key) throw new SeoError("Chưa có khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
      return h.send_json({ job_id: await startJob("smap_place", { lid: parseInt(seg[1]) }, "Đang đọc trang nguồn…") });
    }
    if (method === "POST" && is("send-rank")) {
      const b = await h.read_json();
      const site = await getSite(parseInt(b.site_id));
      if (!site) return h.send_json({ error: "Không tìm thấy website." }, 400);
      let added = 0;
      for (const pid of (b.page_ids || []).map((i: any) => parseInt(i))) {
        const r = await one("SELECT primary_kw FROM seo_smap_pages WHERE id=?", [pid]);
        if (r?.primary_kw) {
          added += (await run("INSERT INTO seo_tracked(domain, keyword, location, language, created_at) VALUES (?,?,?,?,?) ON CONFLICT (domain, keyword, location) DO NOTHING",
            [site.domain, r.primary_kw.toLowerCase(), "2704", "vi", nowUtc()])).count;
        }
      }
      return h.send_json({ added });
    }
    if (method === "POST" && is("send-autopost")) {
      const b = await h.read_json();
      let n = 0;
      for (const k0 of b.keywords || []) {
        const k = squash(k0);
        if (!k) continue;
        n += (await run("INSERT INTO seo_ap_keywords(site_id, keyword, status, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (site_id, keyword) DO NOTHING",
          [parseInt(b.ap_site_id), k, "pending", now(), now()])).count;
      }
      return h.send_json({ added: n });
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 400);
    if (e?.code === "42P01") return h.send_json({ error: MIGRATION }, 400);
    throw e;
  }
}
