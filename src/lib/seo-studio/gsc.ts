// @ts-nocheck
/**
 * Kết nối Google Search Console + Google Analytics 4 bằng service account, đồng bộ dữ liệu,
 * phân tích cơ hội từ khóa, chất lượng trang, index, lập kế hoạch nội dung và báo cáo tư vấn bằng AI.
 * Chuyển từ mrvu-seo-studio/gsc.py. Khác bản gốc:
 *   - Ký JWT bằng node:crypto (bản gốc tự viết RSA).
 *   - Khóa service account lấy từ biến môi trường GOOGLE_SERVICE_ACCOUNT_JSON; nếu không có thì dùng
 *     file tải lên ở mục Kết nối, lưu MÃ HÓA trong seo_gsc_meta (bản gốc lưu file thô trên đĩa).
 *   - Đồng bộ chia nhiều bước, dữ liệu ghi vào seo_gsc_stage rồi thay bản cũ ở bước cuối.
 *   - Kiểm tra index chạy theo lô (~40 giây mỗi lần giao diện hỏi tiến độ).
 */
import { createPrivateKey, sign as rsaSign } from "node:crypto";
import { SeoError, decrypt, encrypt, extractJson, hex, loadConfig, now, one, pyRound, q, run, saveConfig, todayVN, tx, uniq, vnNum } from "./core";
import { claude } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { PageParser, bareHost, decode, fetchPage, netloc, urlParts } from "./web";

const SCOPES = "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
const QUESTION = /\?|(?<![\p{L}\p{N}_])(là gì|như thế nào|thế nào|có nên|có tốt|có tốn|bao nhiêu|tại sao|vì sao|cách|khi nào|ở đâu|loại nào|nên mua|so sánh|có phải|bao lâu|ra sao|hướng dẫn|kinh nghiệm)(?![\p{L}\p{N}_])/iu;
// CTR tham khảo theo vị trí (ước tính trung bình ngành, dùng để so sánh tương đối)
const CTR_CURVE: Record<number, number> = { 1: 0.28, 2: 0.155, 3: 0.1, 4: 0.072, 5: 0.053, 6: 0.041, 7: 0.032, 8: 0.026, 9: 0.022, 10: 0.019 };

function expCtr(pos: any) {
  const p = Math.max(1, pyRound(pos || 50));
  return CTR_CURVE[p] ?? (p <= 15 ? 0.012 : p <= 20 ? 0.007 : 0.003);
}

async function meta(key: string, value?: any) {
  if (value !== undefined) {
    await run("INSERT INTO seo_gsc_meta(key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]);
    return value;
  }
  const r = await one("SELECT value FROM seo_gsc_meta WHERE key=?", [key]);
  return r ? JSON.parse(r.value) : null;
}

// ================================================================ Xác thực service account
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Biến môi trường nhận JSON thô hoặc JSON đã mã hóa base64. */
function envKeyText(): string {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{")) return raw;
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function loadKey(): Promise<any> {
  const envTxt = envKeyText();
  if (envTxt) {
    try {
      return JSON.parse(envTxt);
    } catch {
      throw new SeoError("GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ (dán nguyên nội dung file, hoặc mã hóa base64).");
    }
  }
  const stored = await meta("sa_key");
  if (!stored) throw new SeoError("Chưa có file khóa service account. Vào mục Kết nối để tải file JSON lên (hoặc đặt GOOGLE_SERVICE_ACCOUNT_JSON).");
  return JSON.parse(decrypt(stored));
}

const tokenCache = { value: null as string | null, exp: 0, email: "" };

async function token() {
  const sa = await loadKey();
  if (tokenCache.value && tokenCache.email === sa.client_email && tokenCache.exp > Date.now() / 1000 + 60) return tokenCache.value;
  const iat = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud, iat, exp: iat + 3600 }));
  let sig;
  try {
    sig = b64u(rsaSign("RSA-SHA256", Buffer.from(`${head}.${claims}`), sa.private_key));
  } catch {
    throw new SeoError("Khóa riêng trong file service account không đọc được. Hãy tải lại file JSON trong Google Cloud → Service Accounts → Keys.");
  }
  let res: Response;
  try {
    res = await fetch(aud, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    throw new SeoError(`Không kết nối được Google: ${e?.cause?.code || e?.message}`);
  }
  const txt = await res.text();
  if (!res.ok) throw new SeoError(`Google từ chối file khóa (${res.status}): ${txt.slice(0, 200)}. Kiểm tra file JSON có đúng và chưa bị xóa trong Google Cloud.`);
  const data = JSON.parse(txt);
  Object.assign(tokenCache, { value: data.access_token, exp: Date.now() / 1000 + parseInt(data.expires_in || 3600), email: sa.client_email });
  return tokenCache.value;
}

async function gcall(url: string, body: any = undefined, method?: string, service = "GSC") {
  const tok = await token();
  let res: Response;
  try {
    res = await fetch(url, {
      method: method || (body !== undefined ? "POST" : "GET"),
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e: any) {
    throw new SeoError(`Không kết nối được Google: ${e?.name === "TimeoutError" ? "hết thời gian chờ" : e?.cause?.code || e?.message}`);
  }
  const txt = await res.text();
  if (res.ok) return JSON.parse(txt || "{}");
  let msg = txt;
  try {
    msg = JSON.parse(txt).error?.message || txt;
  } catch {}
  let email = "";
  try {
    email = (await loadKey()).client_email || "";
  } catch {}
  if (msg.includes("has not been used") || msg.includes("is disabled") || txt.includes("SERVICE_DISABLED")) {
    const api = service === "GA4" ? "Google Analytics Data API" : "Google Search Console API";
    throw new SeoError(`Chưa bật ${api} trong Google Cloud. Vào APIs & Services → Library, tìm “${api}” và bấm Enable, đợi 2–3 phút rồi thử lại.`);
  }
  if (res.status === 403) {
    const where = service === "GA4" ? "GA4 (Quản trị → Quản lý quyền truy cập thuộc tính → thêm vai trò Người xem)"
      : "Search Console (Cài đặt → Người dùng và quyền → Thêm người dùng, quyền Hạn chế)";
    throw new SeoError(`Tài khoản ${email} chưa được cấp quyền trong ${where}.`);
  }
  if (res.status === 404 && service === "GA4") throw new SeoError("Không tìm thấy GA4 Property ID. Kiểm tra lại dãy số trong Quản trị → Cài đặt thuộc tính.");
  throw new SeoError(`${service} lỗi ${res.status}: ${String(msg).slice(0, 200)}`);
}

// ================================================================ Đọc dữ liệu
async function listSites() {
  const data = await gcall("https://www.googleapis.com/webmasters/v3/sites");
  return (data.siteEntry || []).filter((s: any) => s.permissionLevel !== "siteUnverifiedUser").map((s: any) => ({ site: s.siteUrl, permission: s.permissionLevel ?? null }));
}

async function gscQuery(site: string, start: string, end: string, dims: string[], limit = 25000, maxRows = 50000) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const out: any[] = [];
  let startRow = 0;
  while (startRow < maxRows) {
    const data = await gcall(url, { startDate: start, endDate: end, dimensions: dims, rowLimit: limit, startRow, dataState: "final" });
    const rows = data.rows || [];
    out.push(...rows);
    if (rows.length < limit) break;
    startRow += limit;
  }
  return out;
}

async function gaReport(prop: string, start: string, end: string, dims: string[], metrics: string[], organic = true, limit = 10000) {
  const body: any = { dateRanges: [{ startDate: start, endDate: end }], dimensions: dims.map((name) => ({ name })), metrics: metrics.map((name) => ({ name })), limit };
  if (organic) body.dimensionFilter = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } };
  const data = await gcall(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, body, undefined, "GA4");
  return (data.rows || []).map((r: any) => [...r.dimensionValues.map((d: any) => d.value), ...r.metricValues.map((m: any) => parseFloat(m.value || 0) || 0)]);
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function periods(): Record<string, [string, string]> {
  const end = addDays(todayVN(), -3);
  return { cur: [addDays(end, -27), end], prev: [addDays(end, -55), addDays(end, -28)], old: [addDays(end, -118), addDays(end, -91)], daily: [addDays(end, -119), end] };
}

async function cfgSite(): Promise<[string, string]> {
  const cfg = await loadConfig();
  if (!cfg.gsc_site) throw new SeoError("Chưa chọn website Search Console ở mục Kết nối.");
  return [cfg.gsc_site, String(cfg.ga_property || "").trim()];
}

export function siteDomain(site: string) {
  const s = String(site || "").replace("sc-domain:", "");
  return bareHost(netloc(s.includes("://") ? s : "https://" + s));
}

// ---------------------------------------------------------------- đồng bộ (từng bước)
const SYNC_STEPS = ["rows_cur", "rows_prev", "pages", "daily", "ga", "commit"];
const SYNC_MSG: Record<string, string> = {
  rows_cur: "Đang lấy từ khóa × trang 28 ngày gần nhất…",
  rows_prev: "Đang lấy từ khóa × trang 28 ngày trước đó…",
  pages: "Đang lấy số liệu theo trang…",
  daily: "Đang lấy số liệu theo ngày…",
  ga: "Đang lấy dữ liệu Google Analytics 4…",
  commit: "Đang lưu dữ liệu…",
};

async function stage(syncId: string, kind: string, period: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 5000) {
    await run("INSERT INTO seo_gsc_stage(sync_id, kind, period, data_json) VALUES (?,?,?,?)", [syncId, kind, period, JSON.stringify(rows.slice(i, i + 5000))]);
  }
}
const slimRows = (rows: any[]) => rows.map((r) => ({ k: r.keys, c: r.clicks, i: r.impressions, r: r.ctr, p: r.position }));

registerStep("gsc_sync", async (job, ctx) => {
  const st = job.state;
  const [site, prop] = [st.site, st.prop];
  const P = st.periods;
  const next = () => {
    let i = SYNC_STEPS.indexOf(st.step) + 1;
    if (SYNC_STEPS[i] === "ga" && !prop) i++;
    st.step = SYNC_STEPS[i];
    ctx.progress(SYNC_MSG[st.step]);
  };
  if (st.step === "rows_cur" || st.step === "rows_prev") {
    const per = st.step === "rows_cur" ? "cur" : "prev";
    const rows = await gscQuery(site, P[per][0], P[per][1], ["query", "page"], 25000, st.max_rows);
    await stage(st.sync_id, "rows", per, slimRows(rows));
    st.counts = { ...(st.counts || {}), [per]: rows.length };
    return next();
  }
  if (st.step === "pages") {
    for (const per of ["cur", "prev", "old"]) await stage(st.sync_id, "pages", per, slimRows(await gscQuery(site, P[per][0], P[per][1], ["page"], 25000, st.max_rows)));
    st.pages = (await one("SELECT COALESCE(SUM(jsonb_array_length(data_json::jsonb)),0) n FROM seo_gsc_stage WHERE sync_id=? AND kind='pages' AND period='cur'", [st.sync_id])).n;
    return next();
  }
  if (st.step === "daily") {
    await stage(st.sync_id, "daily", "", slimRows(await gscQuery(site, P.daily[0], P.daily[1], ["date"])));
    return next();
  }
  if (st.step === "ga") {
    try {
      const mets = ["sessions", "engagedSessions", "engagementRate", "keyEvents", "averageSessionDuration"];
      const ga: any = {};
      for (const per of ["cur", "prev"]) ga[per] = await gaReport(prop, P[per][0], P[per][1], ["landingPagePlusQueryString"], mets);
      ga.daily = (await gaReport(prop, P.daily[0], P.daily[1], ["date"], ["sessions", "keyEvents"]))
        .map((r: any) => [`${r[0].slice(0, 4)}-${r[0].slice(4, 6)}-${r[0].slice(6)}`, Math.trunc(r[1]), r[2]]);
      for (const per of ["cur", "prev"]) await stage(st.sync_id, "ga_pages", per, ga[per]);
      await stage(st.sync_id, "ga_daily", "", ga.daily);
      st.ga_ok = true;
    } catch (e: any) {
      if (!(e instanceof SeoError)) throw e;
      st.ga_error = e.message;
    }
    return next();
  }
  if (st.step === "commit") {
    const sid = st.sync_id;
    await tx(async (t: any) => {
      for (const tb of ["seo_gsc_rows", "seo_gsc_pages", "seo_gsc_daily"]) await run(`DELETE FROM ${tb}`, [], t);
      await run(`INSERT INTO seo_gsc_rows(period, query, page, clicks, impressions, ctr, position)
        SELECT s.period, e->'k'->>0, e->'k'->>1, (e->>'c')::float8::int, (e->>'i')::float8::int, (e->>'r')::float8, (e->>'p')::float8
        FROM seo_gsc_stage s, jsonb_array_elements(s.data_json::jsonb) e WHERE s.sync_id=? AND s.kind='rows'`, [sid], t);
      await run(`INSERT INTO seo_gsc_pages(period, page, clicks, impressions, ctr, position)
        SELECT s.period, e->'k'->>0, (e->>'c')::float8::int, (e->>'i')::float8::int, (e->>'r')::float8, (e->>'p')::float8
        FROM seo_gsc_stage s, jsonb_array_elements(s.data_json::jsonb) e WHERE s.sync_id=? AND s.kind='pages'`, [sid], t);
      await run(`INSERT INTO seo_gsc_daily(date, clicks, impressions, ctr, position)
        SELECT e->'k'->>0, (e->>'c')::float8::int, (e->>'i')::float8::int, (e->>'r')::float8, (e->>'p')::float8
        FROM seo_gsc_stage s, jsonb_array_elements(s.data_json::jsonb) e WHERE s.sync_id=? AND s.kind='daily'
        ON CONFLICT (date) DO UPDATE SET clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions, ctr=EXCLUDED.ctr, position=EXCLUDED.position`, [sid], t);
      if (st.ga_ok) {
        await run("DELETE FROM seo_ga_pages", [], t);
        await run("DELETE FROM seo_ga_daily", [], t);
        await run(`INSERT INTO seo_ga_pages(period, path, sessions, engaged, engagement_rate, key_events, avg_duration)
          SELECT s.period, e->>0, (e->>1)::float8::int, (e->>2)::float8::int, (e->>3)::float8, (e->>4)::float8, (e->>5)::float8
          FROM seo_gsc_stage s, jsonb_array_elements(s.data_json::jsonb) e WHERE s.sync_id=? AND s.kind='ga_pages'`, [sid], t);
        await run(`INSERT INTO seo_ga_daily(date, sessions, key_events)
          SELECT e->>0, (e->>1)::float8::int, (e->>2)::float8
          FROM seo_gsc_stage s, jsonb_array_elements(s.data_json::jsonb) e WHERE s.sync_id=? AND s.kind='ga_daily'
          ON CONFLICT (date) DO UPDATE SET sessions=EXCLUDED.sessions, key_events=EXCLUDED.key_events`, [sid], t);
      }
      await run("DELETE FROM seo_gsc_stage WHERE sync_id=?", [sid], t);
    });
    const info = { at: now(), site, ga_property: prop, ga_error: st.ga_error || null, periods: P, rows: st.counts?.cur || 0, pages: st.pages || 0 };
    await meta("last_sync", info);
    return { done: info };
  }
  throw new SeoError("Trạng thái đồng bộ không hợp lệ");
});

// ================================================================ Phân tích
async function aggQueries(period = "cur") {
  const rows = await q("SELECT query, page, clicks, impressions, position FROM seo_gsc_rows WHERE period=?", [period]);
  const out = new Map<string, any>();
  for (const r of rows) {
    let a = out.get(r.query);
    if (!a) out.set(r.query, (a = { query: r.query, clicks: 0, impressions: 0, _pw: 0, pages: [] }));
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a._pw += r.position * r.impressions;
    a.pages.push({ page: r.page, clicks: r.clicks, impressions: r.impressions, position: pyRound(r.position, 1) });
  }
  for (const a of out.values()) {
    a.position = a.impressions ? pyRound(a._pw / a.impressions, 1) : null;
    delete a._pw;
    a.ctr = a.impressions ? a.clicks / a.impressions : 0;
    a.pages.sort((x: any, y: any) => y.impressions - x.impressions);
    a.page = a.pages.length ? a.pages[0].page : "";
  }
  return out;
}

async function pageMap(period: string) {
  const rows = await q("SELECT * FROM seo_gsc_pages WHERE period=?", [period]);
  return new Map(rows.map((r: any) => [r.page, r]));
}

async function volumes() {
  const out = new Map<string, any>();
  try {
    for (const r of await q("SELECT rows_json FROM seo_sessions ORDER BY created_at")) {
      for (const row of JSON.parse(r.rows_json)) if (row.volume !== null && row.volume !== undefined) out.set(row.keyword, row.volume);
    }
  } catch {}
  return out;
}

async function trackedSet() {
  try {
    return new Set((await q("SELECT keyword FROM seo_tracked")).map((r: any) => r.keyword));
  } catch {
    return new Set();
  }
}

async function overview() {
  const info = await meta("last_sync");
  if (!info) return { synced: false };
  const P = info.periods;
  const daily = await q("SELECT * FROM seo_gsc_daily ORDER BY date");
  const gad = new Map((await q("SELECT * FROM seo_ga_daily")).map((r: any) => [r.date, r]));
  const gaCur = await one("SELECT SUM(sessions) s, SUM(key_events) k, SUM(engaged) e FROM seo_ga_pages WHERE period='cur'");
  const gaPrev = await one("SELECT SUM(sessions) s, SUM(key_events) k, SUM(engaged) e FROM seo_ga_pages WHERE period='prev'");
  const tot = (a: string, b: string) => {
    const rows = daily.filter((d: any) => a <= d.date && d.date <= b);
    const c = rows.reduce((s: number, d: any) => s + d.clicks, 0), i = rows.reduce((s: number, d: any) => s + d.impressions, 0);
    const pos = i ? rows.reduce((s: number, d: any) => s + d.position * d.impressions, 0) / i : null;
    return { clicks: c, impressions: i, ctr: i ? c / i : 0, position: pos ? pyRound(pos, 1) : null };
  };
  const cur = tot(P.cur[0], P.cur[1]), prev = tot(P.prev[0], P.prev[1]);
  const pc = await pageMap("cur"), pp = await pageMap("prev");
  const movers: any[] = [];
  for (const u of new Set([...pc.keys(), ...pp.keys()])) {
    const a = pc.get(u)?.clicks || 0, b = pp.get(u)?.clicks || 0;
    if (a || b) movers.push({ page: u, clicks: a, prev: b, delta: a - b });
  }
  movers.sort((x, y) => x.delta - y.delta);
  const qq = await aggQueries("cur");
  const topQ = [...qq.values()].sort((x, y) => y.clicks - x.clicks).slice(0, 15).map(({ pages, ...x }) => x);
  const series = daily.map((d: any) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions, sessions: gad.get(d.date)?.sessions ?? null, key_events: gad.get(d.date)?.key_events ?? null }));
  let ga = null;
  if (gaCur && gaCur.s) {
    ga = { sessions: Math.trunc(gaCur.s), sessions_prev: Math.trunc(gaPrev?.s || 0), key_events: gaCur.k || 0, key_events_prev: gaPrev?.k || 0, engagement_rate: (gaCur.e || 0) / gaCur.s };
  }
  return {
    synced: true, sync: info, cur, prev, ga, series,
    gainers: [...movers].reverse().filter((m) => m.delta > 0).slice(0, 8), losers: movers.filter((m) => m.delta < 0).slice(0, 8),
    top_queries: topQ, query_count: qq.size,
  };
}

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));

async function opportunities(kind: string, minImpr: number | null = null) {
  const qq = await aggQueries("cur");
  const qp = await aggQueries("prev");
  const vols = await volumes(), tracked = await trackedSet();
  const info = (await meta("last_sync")) || {};
  const brand = info.site ? siteDomain(info.site).split(".")[0] : "#";
  let out: any[] = [];
  if (kind === "striking") {
    const mi = minImpr || 30;
    for (const a of qq.values()) {
      if (a.position && a.position >= 4 && a.position <= 20 && a.impressions >= mi) {
        const gain = a.impressions * Math.max(0, expCtr(3) - a.ctr);
        const prev = qp.get(a.query);
        out.push({ ...pick(a, ["query", "clicks", "impressions", "ctr", "position", "page"]), prev_position: prev ? prev.position : null,
          gain: pyRound(gain), volume: vols.get(a.query) ?? null, tracked: tracked.has(a.query) });
      }
    }
    out.sort((x, y) => y.gain - x.gain);
  } else if (kind === "lowctr") {
    const mi = minImpr || 100;
    const qs = new Map<string, any[]>();
    for (const a of qq.values()) for (const p of a.pages) {
      if (!qs.has(p.page)) qs.set(p.page, []);
      qs.get(p.page).push([a.query, p.impressions, p.clicks, p.position]);
    }
    for (const [u, p] of await pageMap("cur")) {
      if (p.position <= 10 && p.impressions >= mi && p.ctr < 0.6 * expCtr(p.position)) {
        const top = [...(qs.get(u) || [])].sort((x, y) => y[1] - x[1]).slice(0, 5);
        out.push({ page: u, clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: pyRound(p.position, 1),
          expected_ctr: expCtr(p.position), missed: pyRound(p.impressions * (expCtr(p.position) - p.ctr)), queries: top.map((t) => t[0]) });
      }
    }
    out.sort((x, y) => y.missed - x.missed);
  } else if (kind === "cannibal") {
    for (const a of qq.values()) {
      if (a.impressions < (minImpr || 30) || a.query.replace(/ /g, "").includes(brand)) continue;
      const ps = a.pages.filter((p: any) => p.impressions >= Math.max(5, 0.1 * a.impressions) && p.position <= 40);
      if (ps.length >= 2) out.push({ query: a.query, impressions: a.impressions, clicks: a.clicks, position: a.position, pages: ps.slice(0, 4) });
    }
    out.sort((x, y) => y.impressions - x.impressions);
  } else if (kind === "decay") {
    const old = await pageMap("old"), cur = await pageMap("cur"), prev = await pageMap("prev");
    for (const [u, o] of old) {
      const c = cur.get(u) || { clicks: 0, position: null, impressions: 0 };
      if (o.clicks >= 20 && c.clicks <= 0.7 * o.clicks) {
        out.push({ page: u, clicks_old: o.clicks, clicks: c.clicks, clicks_prev: prev.get(u)?.clicks || 0,
          drop: pyRound(((o.clicks - c.clicks) / o.clicks) * 100), position_old: pyRound(o.position, 1), position: c.position ? pyRound(c.position, 1) : null });
      }
    }
    out.sort((x, y) => (y.clicks_old - y.clicks) - (x.clicks_old - x.clicks));
  } else if (kind === "gaps") {
    const mi = minImpr || 20;
    for (const a of qq.values()) {
      if (a.query.replace(/ /g, "").includes(brand)) continue;
      const isQ = QUESTION.test(a.query);
      if (a.impressions >= mi && (a.position > 20 || (isQ && a.position > 10))) {
        out.push({ ...pick(a, ["query", "clicks", "impressions", "position", "page"]), question: isQ, volume: vols.get(a.query) ?? null });
      }
    }
    const key = (x: any) => -(x.volume || 0) * 10 - x.impressions;
    out.sort((x, y) => key(x) - key(y));
  }
  return out.slice(0, 300);
}

async function ranksMerge() {
  const info = await meta("last_sync");
  if (!info) return { items: [], suggest: [] };
  const dom = siteDomain(info.site);
  const qq = await aggQueries("cur");
  const items: any[] = [];
  try {
    for (const t of await q("SELECT * FROM seo_tracked WHERE domain=?", [dom])) {
      const g = await one("SELECT position, checked_at FROM seo_ranks WHERE tracked_id=? AND engine='google' ORDER BY checked_at DESC LIMIT 1", [t.id]);
      const a = qq.get(t.keyword);
      items.push({ keyword: t.keyword, rank: g ? g.position : null, rank_at: g ? g.checked_at : null, checked: Boolean(g),
        gsc_position: a ? a.position : null, clicks: a ? a.clicks : 0, impressions: a ? a.impressions : 0, page: a ? a.page : null });
    }
  } catch {}
  const have = new Set(items.map((i) => i.keyword));
  const score = (x: any) => -(x.clicks * 5 + x.impressions / 10);
  const suggest = [...qq.values()].sort((x, y) => score(x) - score(y)).filter((a) => !have.has(a.query)).slice(0, 30)
    .map((a) => ({ query: a.query, clicks: a.clicks, impressions: a.impressions, position: a.position }));
  return { domain: dom, items, suggest };
}

function normPath(u: string) {
  const p = urlParts(u);
  return (p.path || "/") + (p.query ? "?" + p.query : "");
}

async function quality() {
  const ga = await q("SELECT * FROM seo_ga_pages WHERE period='cur'");
  if (!ga.length) return { has_ga: false };
  const gsc = new Map<string, any>();
  for (const [u, p] of await pageMap("cur")) gsc.set(normPath(u), p);
  const totS = ga.reduce((s: number, r: any) => s + r.sessions, 0) || 1;
  const avgEr = ga.reduce((s: number, r: any) => s + r.engaged, 0) / totS;
  const totK = ga.reduce((s: number, r: any) => s + r.key_events, 0);
  const rows = ga.map((r: any) => {
    const g = gsc.get(r.path) || {};
    const flags: string[] = [];
    if (r.sessions >= 30 && r.engagement_rate < avgEr * 0.7) flags.push("low_engagement");
    if (r.sessions >= 50 && r.key_events === 0 && totK > 0) flags.push("no_conversion");
    if (r.key_events > 0 && r.sessions && r.key_events / r.sessions >= 2 * (totK / totS)) flags.push("top_converting");
    return { ...r, conv_rate: r.sessions ? r.key_events / r.sessions : 0, gsc_clicks: g.clicks ?? null, gsc_position: g.position ? pyRound(g.position, 1) : null, flags };
  });
  rows.sort((x: any, y: any) => y.sessions - x.sessions);
  return { has_ga: true, avg_engagement: avgEr, conv_rate: totK / totS, sessions: totS, key_events: totK, items: rows.slice(0, 300) };
}

// ---------------------------------------------------------------- Index (theo lô, mỗi bước ~40 giây)
registerStep("gsc_inspect", async (job, ctx) => {
  const st = job.state;
  const [site] = await cfgSite();
  while (st.done < st.urls.length && Date.now() < ctx.deadline) {
    const u = st.urls[st.done];
    ctx.progress(`Đang kiểm tra index ${st.done + 1}/${st.urls.length}…`);
    let r;
    try {
      r = await gcall("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: u, siteUrl: site, languageCode: "vi" });
    } catch (e: any) {
      const m = String(e?.message || e);
      if (m.includes("429") || m.toLowerCase().includes("quota")) throw new SeoError(`Đã hết hạn mức kiểm tra index hôm nay (khoảng 2.000 URL/ngày). Đã kiểm ${st.done} URL.`);
      throw e;
    }
    const ir = r.inspectionResult || {};
    const s = ir.indexStatusResult || {};
    const mob = (ir.mobileUsabilityResult || {}).verdict || "";
    await run(`INSERT INTO seo_gsc_inspect(url, at, verdict, coverage, indexing, robots, "fetch", google_canonical, user_canonical, last_crawl, mobile)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (url) DO UPDATE SET at=EXCLUDED.at, verdict=EXCLUDED.verdict, coverage=EXCLUDED.coverage,
      indexing=EXCLUDED.indexing, robots=EXCLUDED.robots, "fetch"=EXCLUDED."fetch", google_canonical=EXCLUDED.google_canonical,
      user_canonical=EXCLUDED.user_canonical, last_crawl=EXCLUDED.last_crawl, mobile=EXCLUDED.mobile`,
      [u, now(), s.verdict ?? null, s.coverageState ?? null, s.indexingState ?? null, s.robotsTxtState ?? null, s.pageFetchState ?? null,
        s.googleCanonical ?? null, s.userCanonical ?? null, s.lastCrawlTime ?? null, mob]);
    st.done++;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (st.done >= st.urls.length) return { done: { checked: st.done } };
  ctx.progress(`Đang kiểm tra index ${st.done + 1}/${st.urls.length}…`);
});

async function indexCandidates(limit = 50): Promise<[string[], string[]]> {
  const pc = await pageMap("cur");
  const urls = [...pc.entries()].sort((a: any, b: any) => b[1].impressions - a[1].impressions).slice(0, limit).map(([u]) => u);
  const info = (await meta("last_sync")) || {};
  const dom = siteDomain(info.site || "");
  const zero: string[] = [];
  try {
    for (const r of await q("SELECT p.url FROM seo_audit_pages p JOIN seo_audit_sites s ON s.id=p.site_id WHERE s.domain=?", [dom])) if (!pc.has(r.url)) zero.push(r.url);
  } catch {}
  return [urls, zero];
}

async function indexList() {
  const rows = await q("SELECT * FROM seo_gsc_inspect ORDER BY at DESC");
  for (const r of rows) {
    const issues: string[] = [];
    if (r.verdict && r.verdict !== "PASS") issues.push("not_indexed");
    if (r.google_canonical && r.user_canonical && r.google_canonical.replace(/\/+$/, "") !== r.user_canonical.replace(/\/+$/, "")) issues.push("canonical");
    if (r.robots && r.robots !== "ALLOWED") issues.push("robots");
    if (r.fetch && r.fetch !== "SUCCESSFUL") issues.push("fetch");
    r.issues = issues;
  }
  return rows;
}

// ---------------------------------------------------------------- AI
async function aiJson(prompt: string, maxTokens = 4000, tag: string | null = null) {
  const cfg = await loadConfig();
  if (!cfg.anthropic_api_key) throw new SeoError("Cần khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
  const [txt, usage] = await claude(cfg, prompt, maxTokens, null, tag);
  const out = extractJson(txt);
  out.usage = usage;
  return out;
}

async function saveAi(kind: string, ref: string, data: any) {
  const r = await run("INSERT INTO seo_gsc_ai(kind, ref, at, data_json) VALUES (?,?,?,?) RETURNING id", [kind, ref, now(), JSON.stringify(data)]);
  return r.rows[0].id;
}

async function getAi(kind: string, ref: string | null = null) {
  const r = ref === null
    ? await one("SELECT * FROM seo_gsc_ai WHERE kind=? ORDER BY id DESC LIMIT 1", [kind])
    : await one("SELECT * FROM seo_gsc_ai WHERE kind=? AND ref=? ORDER BY id DESC LIMIT 1", [kind, ref]);
  return r ? { ...JSON.parse(r.data_json), id: r.id, at: r.at } : null;
}

async function aiTitle(page: string) {
  const qq = await aggQueries("cur");
  const qs: any[] = [];
  for (const a of qq.values()) for (const p of a.pages) if (p.page === page) qs.push([a.query, p.impressions, p.clicks, p.position]);
  qs.sort((x, y) => y[1] - x[1]);
  const top = qs.slice(0, 15);
  const res = await fetchPage(page, 20);
  let title = "", desc = "", h1 = "";
  if (res.status === 200) {
    const p = new PageParser();
    try {
      p.feed(decode(res));
    } catch {}
    title = p.title || "";
    desc = p.meta.description || "";
    h1 = p.headings.find(([lv]) => lv === 1)?.[1] || "";
  }
  const cfg = await loadConfig();
  const varsTxt = (cfg.ap_variables || []).filter((v: any) => v.value).map((v: any) => `- ${v.name}: ${v.value}`).join("\n");
  const prompt = `Bạn là chuyên gia SEO tiếng Việt. Trang dưới đây có thứ hạng tốt nhưng tỷ lệ click (CTR) thấp trên Google. Hãy viết lại title và meta description để tăng click.

URL: ${page}
Title hiện tại: ${title}
Meta description hiện tại: ${desc}
H1: ${h1}
Từ khóa đang mang hiển thị (từ khóa | lượt hiển thị | click | vị trí):
${top.map(([a, b, c, d]) => `- ${a} | ${b} | ${c} | ${d}`).join("\n")}
Thông tin doanh nghiệp (chỉ dùng thông tin có ở đây):
${varsTxt || "- (không có)"}

Yêu cầu: title 50-60 ký tự, từ khóa chính ở đầu, có yếu tố khiến người tìm muốn bấm (con số, lợi ích, năm, giải đáp trực tiếp); meta 120-155 ký tự, trả lời đúng ý định tìm kiếm, có lời kêu gọi. Không bịa giá, khuyến mãi.
Chỉ trả về JSON: {"diagnosis": "vì sao CTR thấp (1-2 câu)", "titles": ["3 phương án"], "metas": ["2 phương án"]}`;
  const out = await aiJson(prompt, 3000, "gsc_title");
  out.current = { title, meta: desc };
  await saveAi("title", page, out);
  return out;
}

registerStep("gsc_plan", async (job, ctx) => {
  ctx.progress("Đang gom dữ liệu từ khóa…");
  const st = (await opportunities("striking")).slice(0, 40);
  const gp = (await opportunities("gaps")).slice(0, 100);
  const dc = (await opportunities("decay")).slice(0, 15);
  const cn = (await opportunities("cannibal")).slice(0, 10);
  const info = (await meta("last_sync")) || {};
  const pc = await pageMap("cur");
  const pages = [...pc.entries()].sort((a: any, b: any) => b[1].impressions - a[1].impressions).slice(0, 80).map(([u]) => u);
  const prompt = `Bạn là trưởng nhóm nội dung SEO cho website ${siteDomain(info.site || "")} (tiếng Việt). Dựa trên dữ liệu Google Search Console THẬT của 28 ngày qua, lập kế hoạch nội dung 6 tuần.

TỪ KHÓA SẮP LÊN TOP (vị trí 4-20) — query | hiển thị | vị trí | trang đang xếp hạng | volume:
${st.map((x) => `- ${x.query} | ${x.impressions} | ${x.position} | ${x.page} | ${x.volume || ""}`).join("\n")}

TỪ KHÓA CHƯA CÓ BÀI TỐT (Google hiển thị nhưng vị trí kém, hoặc câu hỏi) — query | hiển thị | vị trí | volume:
${gp.map((x) => `- ${x.query} | ${x.impressions} | ${x.position} | ${x.volume || ""}`).join("\n")}

BÀI ĐANG TỤT — trang | click 3 tháng trước → nay:
${dc.map((x) => `- ${x.page} | ${x.clicks_old} → ${x.clicks}`).join("\n") || "- không có"}

TỪ KHÓA BỊ NHIỀU TRANG TRANH NHAU:
${cn.map((x) => `- ${x.query}: ` + x.pages.map((p: any) => p.page).join(", ")).join("\n") || "- không có"}

CÁC TRANG HIỆN CÓ:
${pages.join("\n")}

Quy tắc: gom từ khóa cùng ý định vào một bài (cụm chủ đề), không tạo bài mới trùng chủ đề với trang đã có (khi đó là "update"); ưu tiên việc có tác động nhanh (cập nhật bài sắp lên top, bài đang tụt) ở tuần đầu; 2-4 việc mỗi tuần.
Chỉ trả về JSON:
{"summary": "2-3 câu nhận định chiến lược",
  "items": [{"week": 1, "type": "new|update|merge", "title": "tiêu đề bài đề xuất", "main_keyword": "...", "supporting_keywords": ["..."],
             "target_url": "URL cần cập nhật/gộp (rỗng nếu bài mới)", "reason": "lý do dựa trên số liệu", "outline": ["H2: ..."], "impact": "cao|trung bình|thấp"}]}`;
  ctx.progress("AI đang lập kế hoạch…");
  const out = await aiJson(prompt, 14000, "gsc_plan");
  await saveAi("plan", "", out);
  return { done: { items: (out.items || []).length } };
});

async function collectContext(): Promise<[string, any]> {
  const ctx: any = {};
  const ov: any = await overview();
  let dom = "";
  if (ov.synced) {
    ctx.gsc_28d = { now: ov.cur, previous: ov.prev, ga: ov.ga, top_gainers: ov.gainers.slice(0, 5), top_losers: ov.losers.slice(0, 5), top_queries: ov.top_queries.slice(0, 10) };
    ctx.striking = (await opportunities("striking")).slice(0, 15).map((x) => pick(x, ["query", "impressions", "position", "page", "gain"]));
    ctx.low_ctr = (await opportunities("lowctr")).slice(0, 8).map((x) => pick(x, ["page", "impressions", "ctr", "position", "missed"]));
    ctx.cannibal = (await opportunities("cannibal")).slice(0, 6).map((x) => ({ query: x.query, pages: x.pages.map((p: any) => p.page) }));
    ctx.decay = (await opportunities("decay")).slice(0, 8).map((x) => pick(x, ["page", "clicks_old", "clicks", "drop"]));
    ctx.gaps = (await opportunities("gaps")).slice(0, 20).map((x) => x.query);
    const ql: any = await quality();
    if (ql.has_ga) {
      ctx.ga_quality = { avg_engagement: pyRound(ql.avg_engagement, 3), conv_rate: pyRound(ql.conv_rate, 4),
        flagged: ql.items.filter((r: any) => r.flags.length).slice(0, 12).map((r: any) => pick(r, ["path", "sessions", "engagement_rate", "key_events", "flags"])) };
    }
    const ix = await indexList();
    if (ix.length) ctx.index = { checked: ix.length, issues: ix.filter((r: any) => r.issues.length).slice(0, 12).map((r: any) => ({ url: r.url, issues: r.issues, coverage: r.coverage })) };
    dom = siteDomain(ov.sync.site);
  }
  try {
    const rk: any = await ranksMerge();
    ctx.rank_tracker = rk.items.map((i: any) => pick(i, ["keyword", "rank", "gsc_position", "clicks"])).slice(0, 30);
  } catch {}
  try {
    const r = await one("SELECT AVG(score) avg, COUNT(*) n FROM seo_audit_results WHERE id IN (SELECT MAX(id) FROM seo_audit_results GROUP BY page_id)");
    const worst = await q(`SELECT p.url, r.score FROM seo_audit_results r JOIN seo_audit_pages p ON p.id=r.page_id
      WHERE r.id IN (SELECT MAX(id) FROM seo_audit_results GROUP BY page_id) ORDER BY r.score LIMIT 8`);
    if (r?.n) ctx.audit = { pages_audited: r.n, avg_score: pyRound(r.avg), worst };
  } catch {}
  try {
    const g = await q("SELECT keyword, url, score, has_aio, cited FROM seo_geo_checks ORDER BY id DESC LIMIT 10");
    if (g.length) ctx.geo = g;
  } catch {}
  try {
    const s = await q("SELECT b.summary_json, b.at, b.source FROM seo_bl_snapshots b JOIN seo_bl_sites s ON s.id=b.site_id WHERE s.domain=? ORDER BY b.id DESC LIMIT 2", [dom]);
    if (s.length) ctx.backlinks = { now: JSON.parse(s[0].summary_json), at: s[0].at, source: s[0].source, previous: s.length > 1 ? JSON.parse(s[1].summary_json) : null };
    const o = await q("SELECT status, COUNT(*) n FROM seo_bl_opps o JOIN seo_bl_sites s ON s.id=o.site_id WHERE s.domain=? GROUP BY status", [dom]);
    if (o.length) ctx.outreach = Object.fromEntries(o.map((r: any) => [r.status, r.n]));
  } catch {}
  try {
    const ap = await q("SELECT status, COUNT(*) n FROM seo_ap_posts GROUP BY status");
    if (ap.length) ctx.autopost = Object.fromEntries(ap.map((r: any) => [r.status, r.n]));
  } catch {}
  const plan = await getAi("plan");
  if (plan) ctx.content_plan_summary = plan.summary ?? null;
  return [dom, ctx];
}

registerStep("gsc_report", async (job, ctx) => {
  ctx.progress("Đang gom dữ liệu từ mọi tab…");
  const [dom, data] = await collectContext();
  if (!Object.keys(data).length) throw new SeoError("Chưa có dữ liệu để phân tích. Hãy đồng bộ Search Console trước.");
  const prompt = `Bạn là chuyên gia tư vấn SEO cấp cao, viết báo cáo tháng cho chủ doanh nghiệp website ${dom || "(chưa rõ)"} (tiếng Việt, dễ hiểu, không thuật ngữ khó).
Dữ liệu dưới đây lấy từ công cụ nội bộ (Search Console, GA4, Rank Tracker, Audit, AI Overview, Backlink, Autopost). Chỉ kết luận dựa trên số liệu có ở đây; phần nào thiếu dữ liệu thì nói rõ cần thu thập thêm.

DỮ LIỆU:
${JSON.stringify(data).slice(0, 24000)}

Viết báo cáo, trích số liệu cụ thể trong mỗi nhận định. Ưu tiên việc có tác động lớn, làm nhanh. Mỗi việc gắn với một tab của công cụ:
gsc-opps (cơ hội từ khóa GSC), gsc-plan (kế hoạch nội dung), gsc-quality (chất lượng trang GA4), gsc-index (index), rank (Rank Tracker), audit (Audit On-page), geo (AI Overview), autopost (viết bài), backlinks (Backlink).
Chỉ trả về JSON:
{"headline": "1 câu tóm tắt tình hình",
  "health": 0-100,
  "summary": "đoạn 3-5 câu",
  "wins": ["điểm tích cực, có số liệu"],
  "problems": ["vấn đề chính, có số liệu"],
  "priorities": [{"title": "việc cần làm", "why": "lý do + số liệu", "action": "các bước cụ thể", "tab": "một mã tab ở trên", "impact": "cao|trung bình|thấp", "effort": "ít|vừa|nhiều"}],
  "kpis": [{"metric": "chỉ số", "now": "giá trị hiện tại", "target": "mục tiêu tháng tới"}],
  "data_gaps": ["dữ liệu còn thiếu nên bổ sung"]}
priorities: 6-10 việc, sắp theo thứ tự nên làm.`;
  ctx.progress("AI đang viết báo cáo tư vấn…");
  const out = await aiJson(prompt, 10000, "gsc_report");
  out.domain = dom;
  return { done: { id: await saveAi("report", "", out) } };
});

// ================================================================ Gửi sang tab khác
async function sendRank(keywords: string[]) {
  const info = await meta("last_sync");
  const dom = info ? siteDomain(info.site) : "";
  if (!dom) throw new SeoError("Chưa đồng bộ Search Console.");
  let added = 0;
  for (const k of keywords) {
    const kw = String(k).toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    added += (await run("INSERT INTO seo_tracked(domain, keyword, location, language, created_at) VALUES (?,?,?,?,?) ON CONFLICT (domain, keyword, location) DO NOTHING",
      [dom, kw, "2704", "vi", now()])).count;
  }
  return { added, domain: dom };
}

async function sendAutopost(siteId: number, keywords: string[]) {
  let added = 0;
  for (const k of keywords) {
    const kw = String(k).split(/\s+/).filter(Boolean).join(" ");
    added += (await run("INSERT INTO seo_ap_keywords(site_id, keyword, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT (site_id, keyword) DO NOTHING",
      [siteId, kw, now(), now()])).count;
  }
  return { added };
}

// ================================================================ API
async function status() {
  const cfg = await loadConfig();
  let email = null;
  try {
    email = (await loadKey()).client_email || null;
  } catch {}
  return { key: Boolean(email), client_email: email, key_from_env: Boolean(envKeyText()), site: cfg.gsc_site ?? null, ga_property: cfg.ga_property ?? null,
    last_sync: await meta("last_sync"), ai: Boolean(cfg.anthropic_api_key) };
}

export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3);
  const qs = h.query;
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  try {
    if (is("status")) return h.send_json(await status());
    if (method === "POST" && is("key")) {
      if (envKeyText()) return h.send_json({ error: "Đang dùng khóa trong biến môi trường GOOGLE_SERVICE_ACCOUNT_JSON. Đổi khóa ở Vercel (Settings → Environment Variables)." }, 400);
      const txt = (await h.read_json()).text || "";
      let sa;
      try {
        sa = JSON.parse(txt);
        if (!(sa.type === "service_account" && sa.private_key && sa.client_email)) throw 0;
        createPrivateKey(sa.private_key);
      } catch {
        return h.send_json({ error: "File không phải khóa service account hợp lệ. Hãy tải lại file JSON trong Google Cloud → Service Accounts → Keys." }, 400);
      }
      await meta("sa_key", encrypt(txt));
      tokenCache.value = null;
      tokenCache.exp = 0;
      return h.send_json({ client_email: sa.client_email });
    }
    if (is("sites")) return h.send_json({ items: await listSites() });
    if (method === "POST" && is("config")) {
      const b = await h.read_json();
      const prop = String(b.ga_property || "").replace(/\D/g, "");
      await saveConfig({ gsc_site: b.site || "", ga_property: prop });
      return h.send_json({ ok: true });
    }
    if (method === "POST" && is("test")) {
      const [site, prop] = await cfgSite();
      const res: any = {};
      const end = addDays(todayVN(), -3);
      try {
        const rows = await gscQuery(site, addDays(end, -6), end, ["date"], 10, 10);
        res.gsc = { ok: true, message: `Đọc được Search Console: ${vnNum(rows.reduce((s: number, r: any) => s + r.clicks, 0))} click trong 7 ngày` };
      } catch (e: any) {
        if (!(e instanceof SeoError)) throw e;
        res.gsc = { ok: false, message: e.message };
      }
      if (prop) {
        try {
          const rows = await gaReport(prop, addDays(end, -6), end, ["date"], ["sessions"]);
          res.ga = { ok: true, message: `Đọc được GA4: ${vnNum(Math.trunc(rows.reduce((s: number, r: any) => s + r[1], 0)))} phiên từ Google trong 7 ngày` };
        } catch (e: any) {
          if (!(e instanceof SeoError)) throw e;
          res.ga = { ok: false, message: e.message };
        }
      }
      return h.send_json(res);
    }
    if (method === "POST" && is("sync")) {
      const [site, prop] = await cfgSite();
      // Dọn dữ liệu tạm của các lần đồng bộ cũ (bị dừng giữa chừng)
      await run(`DELETE FROM seo_gsc_stage WHERE sync_id NOT IN (SELECT state->>'sync_id' FROM seo_jobs
        WHERE kind='gsc_sync' AND status='running' AND state->>'sync_id' IS NOT NULL AND updated_at > now() - interval '1 hour')`);
      const jid = await startJob("gsc_sync", { step: "rows_cur", site, prop, periods: periods(), sync_id: hex(8), max_rows: 50000 }, SYNC_MSG.rows_cur);
      return h.send_json({ job_id: jid });
    }
    if (is("job", "*")) return h.send_json(await advance(seg[1]));
    if (is("overview")) return h.send_json(await overview());
    if (is("opps")) {
      const mi = qs.get("min");
      return h.send_json({ items: await opportunities(qs.get("kind") || "striking", mi ? parseInt(mi) : null) });
    }
    if (method === "POST" && is("ai-title")) return h.send_json(await aiTitle((await h.read_json()).page));
    if (is("ai-title")) return h.send_json((await getAi("title", qs.get("page") || "")) || {});
    if (method === "POST" && is("plan")) return h.send_json({ job_id: await startJob("gsc_plan", {}, "Đang gom dữ liệu từ khóa…") });
    if (is("plan")) return h.send_json((await getAi("plan")) || {});
    if (is("ranks")) return h.send_json(await ranksMerge());
    if (is("quality")) return h.send_json(await quality());
    if (method === "POST" && is("inspect")) {
      const b = await h.read_json();
      let urls = b.urls;
      if (!urls?.length) {
        const [top, zero] = await indexCandidates(parseInt(b.limit) || 30);
        urls = b.mode === "zero" ? zero.slice(0, 20) : top;
      }
      urls = uniq(urls.map(String)).filter((u: string) => u.startsWith("http")).slice(0, 200);
      if (!urls.length) return h.send_json({ error: "Không có URL nào để kiểm tra. Đồng bộ dữ liệu hoặc quét website ở tab Audit trước." }, 400);
      await cfgSite();
      return h.send_json({ job_id: await startJob("gsc_inspect", { urls, done: 0 }, `Đang kiểm tra index 1/${urls.length}…`) });
    }
    if (is("inspect")) {
      const [, zero] = await indexCandidates(30);
      return h.send_json({ items: await indexList(), zero_count: zero.length });
    }
    if (method === "POST" && is("report")) return h.send_json({ job_id: await startJob("gsc_report", {}, "Đang gom dữ liệu từ mọi tab…") });
    if (is("reports")) {
      const rows = await q("SELECT id, at, data_json FROM seo_gsc_ai WHERE kind='report' ORDER BY id DESC LIMIT 24");
      return h.send_json({ items: rows.map((r: any) => {
        const d = JSON.parse(r.data_json);
        return { id: r.id, at: r.at, headline: d.headline ?? null, health: d.health ?? null };
      }) });
    }
    if (is("report", "*")) {
      const r = await one("SELECT * FROM seo_gsc_ai WHERE id=? AND kind='report'", [seg[1]]);
      if (!r) return h.send_json({ error: "Không tìm thấy báo cáo" }, 404);
      return h.send_json({ ...JSON.parse(r.data_json), id: r.id, at: r.at });
    }
    if (method === "POST" && is("send-rank")) return h.send_json(await sendRank((await h.read_json()).keywords || []));
    if (method === "POST" && is("send-autopost")) {
      const b = await h.read_json();
      return h.send_json(await sendAutopost(parseInt(b.site_id), b.keywords || []));
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
}
