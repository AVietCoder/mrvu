// @ts-nocheck
/**
 * Bộ định tuyến của SEO Studio — chuyển từ mrvu-seo-studio/app.py (Handler.do_GET/do_POST/do_DELETE).
 * Mọi request /seo-studio/* đi qua dispatch(): bỏ tiền tố, kiểm đăng nhập Google, rồi chia cho từng module
 * với cùng đường dẫn API như bản gốc, nên các trang HTML gốc (pages/) chạy gần như nguyên vẹn.
 * Phần Tra cứu volume và Rank Tracker nằm ngay trong file này như bản gốc.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { SeoError, hex, loadConfig, nowUtc, one, q, run } from "./core";
import { dfsPost } from "./apis";
import { advance, cleanupJobs } from "./jobs";
import * as auth from "./auth";
import * as audit from "./audit";
import * as autopost from "./autopost";
import * as backlinks from "./backlinks";
import * as costs from "./costs";
import * as geo from "./geo";
import * as gsc from "./gsc";
import * as topics from "./topics";

import indexHtml from "./pages/index.html?raw";
import rankHtml from "./pages/rank.html?raw";
import auditHtml from "./pages/audit.html?raw";
import autopostHtml from "./pages/autopost.html?raw";
import geoHtml from "./pages/geo.html?raw";
import backlinksHtml from "./pages/backlinks.html?raw";
import gscHtml from "./pages/gsc.html?raw";
import costguardJs from "./pages/costguard.js?raw";

const BASE = auth.BASE;
const MAX_KEYWORDS = 1000;

const PAGES: Record<string, [string, string]> = {
  "/costguard.js": [costguardJs, "application/javascript"],
  "/": [indexHtml, "text/html"], "/index.html": [indexHtml, "text/html"],
  "/rank.html": [rankHtml, "text/html"], "/rank": [rankHtml, "text/html"],
  "/audit.html": [auditHtml, "text/html"], "/audit": [auditHtml, "text/html"],
  "/autopost.html": [autopostHtml, "text/html"], "/autopost": [autopostHtml, "text/html"],
  "/geo.html": [geoHtml, "text/html"], "/geo": [geoHtml, "text/html"],
  "/backlinks.html": [backlinksHtml, "text/html"], "/backlinks": [backlinksHtml, "text/html"],
  "/gsc.html": [gscHtml, "text/html"], "/gsc": [gscHtml, "text/html"],
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Đối tượng giống BaseHTTPRequestHandler mà các module dùng: h.query, h.read_json(), h.send_json(). */
function makeH(req: Request, url: URL) {
  let body: any;
  return {
    query: url.searchParams,
    path: url.pathname + url.search,
    async read_json() {
      if (body === undefined) {
        const t = await req.text();
        try {
          body = t ? JSON.parse(t) : {};
        } catch {
          throw new BadRequest("Dữ liệu gửi lên không hợp lệ");
        }
      }
      return body;
    },
    send_json: (obj: any, code = 200) => json(obj, code),
  };
}
class BadRequest extends Error {}

// ---------------------------------------------------------------- Rank Tracker
function cleanDomain(d: any) {
  d = String(d ?? "").trim().toLowerCase();
  for (const p of ["https://", "http://"]) if (d.startsWith(p)) d = d.slice(p.length);
  d = d.split("/")[0].split("?")[0].split(":")[0];
  return d.startsWith("www.") ? d.slice(4) : d;
}
function domainMatch(itemDomain: any, target: string) {
  const d = cleanDomain(itemDomain);
  return d === target || d.endsWith("." + target);
}

/** Trả về [vị trí hoặc null nếu ngoài top, url, chi phí]. */
async function checkRank(cfg: any, engine: string, keyword: string, domain: string, location: any, language: string, depth: number) {
  const [task, cost] = await dfsPost(cfg, `/v3/serp/${engine}/organic/live/regular`, [{
    keyword, location_code: parseInt(location), language_code: language, depth: Number(depth), device: "desktop" }], 120);
  const result = (task.result || [{}])[0] || {};
  for (const it of result.items || []) {
    if (String(it.type || "").startsWith("organic") && domainMatch(it.domain, domain)) return [it.rank_group, it.url, cost];
  }
  return [null, null, cost];
}

async function rankItems(where: string, args: any[]) {
  const rows = await q(`SELECT * FROM seo_tracked WHERE ${where} ORDER BY id`, args);
  if (!rows.length) return [];
  const ids = rows.map((r: any) => r.id);
  const hist = await q("SELECT tracked_id, engine, checked_at, position, url FROM seo_ranks WHERE tracked_id IN (?) ORDER BY checked_at DESC", [ids]);
  const latest = new Map<string, any[]>();
  for (const h of hist) {
    const key = `${h.tracked_id}|${h.engine}`;
    if (!latest.has(key)) latest.set(key, []);
    if (latest.get(key).length < 2) latest.get(key).push(h);
  }
  for (const r of rows) {
    for (const eng of ["google"]) {
      const last = latest.get(`${r.id}|${eng}`) || [];
      r[eng] = {
        position: last.length ? last[0].position : null, url: last.length ? last[0].url : null, checked_at: last.length ? last[0].checked_at : null,
        previous: last.length > 1 ? last[1].position : null, prev_checked: last.length > 1, checked: Boolean(last.length),
      };
    }
  }
  return rows;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

async function rankAdd(h: any) {
  const body = await h.read_json();
  const domain = cleanDomain(body.domain);
  if (!domain || !domain.includes(".")) return h.send_json({ error: "Tên miền chưa đúng. Ví dụ: mrvu.vn" }, 400);
  const loc = String(parseInt(body.location_code) || 2704);
  const lang = body.language_code || "vi";
  const at = nowUtc();
  let added = 0;
  for (const k0 of body.keywords || []) {
    const k = String(k0).toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    if (!k || k.length > 700) continue;
    added += (await run("INSERT INTO seo_tracked(domain, keyword, location, language, created_at) VALUES (?,?,?,?,?) ON CONFLICT (domain, keyword, location) DO NOTHING",
      [domain, k, loc, lang, at])).count;
  }
  return h.send_json({ added, domain, items: await rankItems("domain=?", [domain]) });
}

async function rankCheck(h: any) {
  const cfg = await loadConfig();
  if (!(cfg.login && cfg.password)) return h.send_json({ error: "Chưa có tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)." }, 400);
  const body = await h.read_json();
  const ids = (body.ids || []).map((i: any) => parseInt(i)).filter((i: number) => !Number.isNaN(i)).slice(0, 50);
  const engines = ["google"]; // chỉ theo dõi Google
  const depth = Math.max(10, Math.min(100, parseInt(body.depth) || 30));
  if (!ids.length) return h.send_json({ error: "Chọn ít nhất một từ khóa và một công cụ tìm kiếm." }, 400);
  const tracked = await q("SELECT * FROM seo_tracked WHERE id IN (?)", [ids]);
  const jobs = tracked.flatMap((t: any) => engines.map((e) => [t, e]));
  const results = await pool(jobs, 6, async ([t, e]: any) => {
    try {
      const [pos, url, cost] = await checkRank(cfg, e, t.keyword, t.domain, t.location, t.language, depth);
      return [t.id, e, pos, url, cost, null];
    } catch (err: any) {
      if (!(err instanceof SeoError)) throw err;
      return [t.id, e, null, null, 0, err.message];
    }
  });
  const at = nowUtc();
  const errors = new Set<string>();
  let total = 0;
  for (const [tid, e, pos, url, cost, err] of results) {
    total += cost;
    if (err) {
      errors.add(err);
      continue;
    }
    await run("INSERT INTO seo_ranks(tracked_id, engine, checked_at, position, url, depth, cost) VALUES (?,?,?,?,?,?,?)", [tid, e, at, pos, url, depth, cost]);
  }
  return h.send_json({ items: await rankItems("id IN (?)", [ids]), cost: total, errors: [...errors].sort() });
}

// ---------------------------------------------------------------- Tra cứu volume
const validKeyword = (k: string) => k.length > 0 && k.length <= 80 && k.split(/\s+/).filter(Boolean).length <= 10;

function normalize(item: any) {
  const months = (item.monthly_searches || []).filter(Boolean)
    .sort((a: any, b: any) => (a.year || 0) - (b.year || 0) || (a.month || 0) - (b.month || 0)).slice(-12);
  return {
    keyword: item.keyword || "", volume: item.search_volume ?? null, cpc: item.cpc ?? null,
    comp: item.competition ?? null, compIndex: item.competition_index ?? null,
    low_bid: item.low_top_of_page_bid ?? null, high_bid: item.high_top_of_page_bid ?? null,
    months: months.map((m: any) => ({ y: m.year ?? null, m: m.month ?? null, v: m.search_volume || 0 })),
  };
}

async function volume(h: any) {
  const cfg = await loadConfig();
  if (!(cfg.login && cfg.password)) return h.send_json({ error: "Chưa có tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)." }, 400);
  const body = await h.read_json();
  const seen = new Set<string>(), kws: string[] = [], skipped: string[] = [];
  for (const k0 of body.keywords || []) {
    const k = String(k0).toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    (validKeyword(k) ? kws : skipped).push(k);
  }
  if (!kws.length) return h.send_json({ error: "Không có từ khóa hợp lệ để tra." }, 400);
  if (kws.length > MAX_KEYWORDS) return h.send_json({ error: `Tối đa ${MAX_KEYWORDS} từ mỗi lần tra.` }, 400);
  const loc = parseInt(body.location_code) || 2704;
  const lang = body.language_code || "vi";
  let task, cost;
  try {
    [task, cost] = await dfsPost(cfg, "/v3/keywords_data/google_ads/search_volume/live", [{ keywords: kws, location_code: loc, language_code: lang }]);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
  const byKw = new Map((task.result || []).map((it: any) => [normalize(it).keyword, normalize(it)]));
  // Giữ đúng thứ tự người dùng nhập; từ không có dữ liệu vẫn hiện với volume trống
  const rows = kws.map((k) => byKw.get(k) || { keyword: k, volume: null, cpc: null, comp: null, compIndex: null, months: [] });
  const sid = hex(12);
  const created = nowUtc();
  const total = rows.reduce((s: number, r: any) => s + (r.volume || 0), 0);
  await run("INSERT INTO seo_sessions(id, created_at, location, language, count, total_volume, cost, rows_json) VALUES (?,?,?,?,?,?,?,?)",
    [sid, created, String(loc), lang, rows.length, total, cost, JSON.stringify(rows)]);
  return h.send_json({ id: sid, created_at: created, location: String(loc), count: rows.length, total_volume: total, cost, rows, skipped });
}

// ---------------------------------------------------------------- định tuyến
async function doGET(h: any, path: string) {
  if (path.startsWith("/api/ap/")) return autopost.handle(h, "GET", path);
  if (path.startsWith("/api/geo/")) return geo.handle(h, "GET", path);
  if (path.startsWith("/api/bl/")) return backlinks.handle(h, "GET", path);
  if (path.startsWith("/api/gsc/")) return gsc.handle(h, "GET", path);
  if (path.startsWith("/api/tp/")) return topics.handle(h, "GET", path);
  if (path.startsWith("/api/cost/")) return costs.handle(h, "GET", path);
  if (path in PAGES) {
    let [body, type] = PAGES[path];
    // Ẩn thanh cuộn (vẫn cuộn được) cho đồng bộ với giao diện POS
    if (type === "text/html") {
      const css = "<style>*{scrollbar-width:none}*::-webkit-scrollbar{display:none}</style>";
      body = body.includes("</head>") ? body.replace("</head>", css + "</head>") : body.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + css);
    }
    return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "SAMEORIGIN" } });
  }
  if (path === "/api/health") {
    const cfg = await loadConfig();
    return h.send_json({ ok: true, configured: Boolean(cfg.login && cfg.password), usd_vnd: cfg.usd_vnd ?? 26000, ai: Boolean(cfg.anthropic_api_key) });
  }
  if (path === "/api/history") {
    return h.send_json({ items: await q("SELECT id, created_at, location, count, total_volume, cost FROM seo_sessions ORDER BY created_at DESC LIMIT 200") });
  }
  if (path === "/api/audit/sites") return h.send_json({ items: await q("SELECT * FROM seo_audit_sites WHERE count>0 ORDER BY crawled_at DESC") });
  if (path === "/api/audit/pages") {
    const sid = h.query.get("site_id") || "0";
    const site = await one("SELECT * FROM seo_audit_sites WHERE id=?", [sid]);
    return h.send_json({ site: site || null, items: await audit.auditPagesList(sid) });
  }
  if (path.startsWith("/api/audit/job/")) return h.send_json(await advance(path.split("/").pop()));
  if (path.startsWith("/api/audit/report/")) {
    const rep = await audit.latestResult(path.split("/").pop());
    return h.send_json(rep || { error: "Trang này chưa được audit" }, rep ? 200 : 404);
  }
  if (path === "/api/rank/sites") return h.send_json({ items: await q("SELECT domain, COUNT(*) n FROM seo_tracked GROUP BY domain ORDER BY MAX(id) DESC") });
  if (path === "/api/rank/list") return h.send_json({ items: await rankItems("domain=?", [cleanDomain(h.query.get("domain") || "")]) });
  if (path.startsWith("/api/rank/history/")) {
    return h.send_json({ items: await q("SELECT engine, checked_at, position, url FROM seo_ranks WHERE tracked_id=? ORDER BY checked_at", [path.split("/").pop()]) });
  }
  if (path.startsWith("/api/history/")) {
    const r = await one("SELECT * FROM seo_sessions WHERE id=?", [path.split("/").pop()]);
    if (!r) return h.send_json({ error: "Không tìm thấy phiên này" }, 404);
    const { rows_json, ...d } = r;
    return h.send_json({ ...d, rows: JSON.parse(rows_json) });
  }
  return h.send_json({ error: "Không có trang này" }, 404);
}

async function doDELETE(h: any, path: string) {
  if (path.startsWith("/api/ap/")) return autopost.handle(h, "DELETE", path);
  if (path.startsWith("/api/geo/")) return geo.handle(h, "DELETE", path);
  if (path.startsWith("/api/bl/")) return backlinks.handle(h, "DELETE", path);
  if (path.startsWith("/api/gsc/")) return gsc.handle(h, "DELETE", path);
  if (path.startsWith("/api/tp/")) return topics.handle(h, "DELETE", path);
  if (path.startsWith("/api/cost/")) return costs.handle(h, "DELETE", path);
  if (path.startsWith("/api/rank/tracked/")) {
    const tid = path.split("/").pop();
    await run("DELETE FROM seo_ranks WHERE tracked_id=?", [tid]);
    await run("DELETE FROM seo_tracked WHERE id=?", [tid]);
    return h.send_json({ ok: true });
  }
  if (path.startsWith("/api/history/")) {
    await run("DELETE FROM seo_sessions WHERE id=?", [path.split("/").pop()]);
    return h.send_json({ ok: true });
  }
  return h.send_json({ error: "Không có trang này" }, 404);
}

async function doPOST(h: any, path: string) {
  if (path.startsWith("/api/ap/")) return autopost.handle(h, "POST", path);
  if (path.startsWith("/api/geo/")) return geo.handle(h, "POST", path);
  if (path.startsWith("/api/bl/")) return backlinks.handle(h, "POST", path);
  if (path.startsWith("/api/gsc/")) return gsc.handle(h, "POST", path);
  if (path.startsWith("/api/tp/")) return topics.handle(h, "POST", path);
  if (path.startsWith("/api/cost/")) return costs.handle(h, "POST", path);
  if (path === "/api/rank/add") return rankAdd(h);
  if (path === "/api/audit/crawl") return audit.auditCrawl(h);
  if (path === "/api/audit/run") return audit.auditRun(h);
  if (path === "/api/audit/ai") return audit.auditAi(h);
  if (path === "/api/rank/check") return rankCheck(h);
  if (path === "/api/volume") return volume(h);
  return h.send_json({ error: "Không có trang này" }, 404);
}

// ---------------------------------------------------------------- lịch tự động (pg_cron gọi)
function secretMatches(got: string, expected: string) {
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function cron(req: Request) {
  if (req.method !== "POST") return json({ ok: false, error: "Chỉ nhận POST" }, 405);
  const expected = process.env.SEO_JOB_SECRET;
  if (!expected) return json({ ok: false, error: "Chưa cấu hình SEO_JOB_SECRET" }, 500);
  if (!secretMatches(req.headers.get("x-job-secret") ?? "", expected)) return json({ ok: false, error: "Sai secret" }, 401);
  try {
    if (new Date().getUTCMinutes() === 0) await cleanupJobs();
    return json({ ok: true, ...(await autopost.schedulerTick()) });
  } catch (e: any) {
    if (!(e instanceof SeoError)) console.error("[seo cron]", e);
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

/** Điểm vào duy nhất cho mọi request /seo-studio/*. */
export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === BASE) return Response.redirect(new URL(BASE + "/" + url.search, url), 302);
  const path = url.pathname.slice(BASE.length) || "/";
  try {
    if (path === "/cron") return await cron(req);
    if (path.startsWith("/auth/")) return await auth.handle(req, path);
    const blocked = await auth.guard(req, path);
    if (blocked) return blocked;
    const h = makeH(req, url);
    if (req.method === "GET" || req.method === "HEAD") return await doGET(h, path);
    if (req.method === "POST") return await doPOST(h, path);
    if (req.method === "DELETE") return await doDELETE(h, path);
    return json({ error: "Phương thức không hỗ trợ" }, 405);
  } catch (e: any) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400);
    if (e instanceof SeoError) return json({ error: e.message }, 502);
    console.error("[seo-studio]", req.method, path, e);
    return json({ error: "Lỗi máy chủ: " + String(e?.message ?? e).slice(0, 300) }, 500);
  }
}
