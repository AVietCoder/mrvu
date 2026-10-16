// @ts-nocheck
/**
 * Backlink: theo dõi backlink của website, so sánh với đối thủ để tìm cơ hội đặt link,
 * AI soạn tin nhắn xin link và theo dõi trạng thái liên hệ.
 * Nguồn dữ liệu: DataForSEO Backlinks API (trả phí) hoặc file xuất từ Google Search Console (miễn phí).
 * Chuyển từ mrvu-seo-studio/backlinks.py. "Cập nhật" và "Tìm cơ hội" chia thành nhiều bước
 * (mỗi lệnh gọi API / mỗi nhóm đối thủ một bước) để không vượt giới hạn thời gian của Vercel.
 */
import { SeoError, loadConfig, extractJson, now, one, q, run, uniq } from "./core";
import { claude, dfsPost } from "./apis";
import { advance, registerStep, startJob } from "./jobs";
import { PageParser, decode, fetchPage } from "./web";

const OPP_STATUS = ["new", "contacted", "waiting", "won", "rejected", "skip"];

export function clean(d: any) {
  d = String(d ?? "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0];
  return d.startsWith("www.") ? d.slice(4) : d;
}

async function needApi() {
  const cfg = await loadConfig();
  if (!(cfg.login && cfg.password)) {
    throw new SeoError("Cần tài khoản DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD). Hoặc dùng nút “Nhập file Search Console” (miễn phí).");
  }
  return cfg;
}

async function call(cfg: any, path: string, payload: any): Promise<[any, number]> {
  let task, cost;
  try {
    [task, cost] = await dfsPost(cfg, path, [payload], 120);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const low = msg.toLowerCase();
    if (msg.includes("40204") || low.includes("subscription") || low.includes("access denied") || low.includes("not activated")) {
      throw new SeoError("Tài khoản DataForSEO chưa kích hoạt Backlinks API (cần nạp tối thiểu 100 USD/tháng). " +
        "Bạn vẫn có thể nhập file backlink từ Google Search Console miễn phí.");
    }
    throw e;
  }
  return [(task.result || [{}])[0] || {}, cost];
}

// ---------------------------------------------------------------- phân loại nguồn link
const NEWS = /(vnexpress|dantri|tuoitre|thanhnien|vietnamnet|zing|znews|kenh14|cafef|cafebiz|vietnamplus|nld|laodong|tienphong|baomoi|24h|soha|genk|vtv|vov|plo|nguoiduatin|doanhnhan|bao|news|press|times)/i;
const FORUM = /(forum|dien-?dan|webtretho|otofun|tinhte|voz|reddit|quora|f319|lamchame)/i;
const SOCIAL = /(facebook|youtube|tiktok|instagram|pinterest|linkedin|twitter|x\.com|zalo|medium|tumblr|blogspot|wordpress\.com|weebly|wix|sites\.google|about\.me|behance|issuu|scribd|slideshare|flickr|vk\.com)/i;
const DIRECTORY = /(trangvang|yellowpages|danh-?ba|directory|listing|foody|diadiem|cylex|hotfrog|infobel|top10|review|place)/i;
const SHOP = /(shopee|lazada|tiki|sendo|amazon|ebay|chotot|muaban|rongbay|5giay|raovat)/i;

export function category(domain: string) {
  const d = domain.toLowerCase();
  if ([".gov.vn", ".gov", ".edu.vn", ".edu", ".ac.vn"].some((x) => d.endsWith(x))) return "Cơ quan / trường học";
  for (const [rx, name] of [[SOCIAL, "Mạng xã hội / blog miễn phí"], [SHOP, "Sàn / rao vặt"], [FORUM, "Diễn đàn"],
    [DIRECTORY, "Danh bạ / review"], [NEWS, "Báo / tin tức"]] as const) if (rx.test(d)) return name;
  return "Website / blog ngành";
}

const getSite = (sid: any) => one("SELECT * FROM seo_bl_sites WHERE id=?", [sid]);

// ---------------------------------------------------------------- cập nhật dữ liệu (4 bước, mỗi bước một lệnh gọi API)
registerStep("bl_refresh", async (job, ctx) => {
  const st = job.state;
  const cfg = await needApi();
  const site = await getSite(st.site_id);
  if (!site) throw new SeoError("Không tìm thấy website");
  const t = site.domain;
  st.cost = st.cost || 0;
  if (st.step === "summary") {
    const [summ, c] = await call(cfg, "/v3/backlinks/summary/live", { target: t, include_subdomains: true, rank_scale: "one_hundred" });
    st.cost += c;
    const attrs = summ.referring_links_attributes || {};
    const summary: any = {};
    for (const k of ["rank", "backlinks", "referring_domains", "referring_main_domains", "referring_ips",
      "referring_domains_nofollow", "broken_backlinks", "backlinks_spam_score", "crawled_pages"]) summary[k] = summ[k] ?? null;
    summary.nofollow_links = attrs.nofollow ?? null;
    summary.sponsored_links = attrs.sponsored ?? null;
    summary.ugc_links = attrs.ugc ?? null;
    summary.target_spam_score = (summ.info || {}).target_spam_score ?? null;
    st.summary = summary;
    st.step = "domains";
    ctx.progress("Đang lấy danh sách website trỏ link…");
    return;
  }
  if (st.step === "domains") {
    const [rd, c] = await call(cfg, "/v3/backlinks/referring_domains/live", { target: t, limit: 1000, order_by: ["rank,desc"],
      rank_scale: "one_hundred", backlinks_status_type: "live" });
    st.cost += c;
    st.domains = (rd.items || []).map((i: any) => ({ domain: clean(i.domain), rank: i.rank ?? null, backlinks: i.backlinks ?? null,
      first_seen: String(i.first_seen || "").slice(0, 10), spam: i.backlinks_spam_score ?? null,
      nofollow: Boolean(i.referring_pages_nofollow) && i.referring_pages_nofollow === i.referring_pages }));
    st.step = "lost";
    ctx.progress("Đang lấy link bị mất gần đây…");
    return;
  }
  if (st.step === "lost") {
    const [lost, c] = await call(cfg, "/v3/backlinks/referring_domains/live", { target: t, limit: 200, order_by: ["lost_date,desc"],
      rank_scale: "one_hundred", backlinks_status_type: "lost" });
    st.cost += c;
    st.lost = (lost.items || []).map((i: any) => ({ domain: clean(i.domain), rank: i.rank ?? null, lost_date: String(i.lost_date || "").slice(0, 10), backlinks: i.backlinks ?? null }));
    st.step = "links";
    ctx.progress("Đang lấy chi tiết link (anchor, trang đích)…");
    return;
  }
  if (st.step === "links") {
    const [bl, c] = await call(cfg, "/v3/backlinks/backlinks/live", { target: t, mode: "one_per_domain", limit: 1000,
      order_by: ["domain_from_rank,desc"], rank_scale: "one_hundred" });
    st.cost += c;
    const links: any = {};
    for (const i of bl.items || []) {
      const d = clean(i.domain_from);
      if (!(d in links)) links[d] = { url_from: i.url_from, url_to: i.url_to, anchor: i.anchor || "", dofollow: i.dofollow, title: i.page_from_title || "", is_new: i.is_new };
    }
    await run("INSERT INTO seo_bl_snapshots(site_id, at, source, summary_json, domains_json, links_json, lost_json, cost) VALUES (?,?,?,?,?,?,?,?)",
      [st.site_id, now(), "api", JSON.stringify(st.summary), JSON.stringify(st.domains), JSON.stringify(links), JSON.stringify(st.lost), st.cost]);
    return { done: { cost: st.cost, domains: st.domains.length } };
  }
  throw new SeoError("Trạng thái cập nhật backlink không hợp lệ");
});

// ---------------------------------------------------------------- nhập CSV
/** Tách CSV (có ngoặc kép) với dấu phân cách đoán từ dòng đầu, giống csv.Sniffer. */
function parseCsv(text: string): string[][] {
  const first = text.slice(0, 4000).split(/\r?\n/)[0] || "";
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length - 1] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]);
}

/** Nhận file xuất từ Search Console (Liên kết → Trang web liên kết hàng đầu / Liên kết mới nhất) hoặc bất kỳ CSV có cột URL/tên miền. */
async function importCsv(siteId: number, text: string) {
  const site = await getSite(siteId);
  if (!site) throw new SeoError("Không tìm thấy website");
  text = text.replace(/^﻿/, "");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new SeoError("File không có dữ liệu.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  let domCol: number | null = null, numCol: number | null = null;
  head.forEach((h, i) => {
    if (domCol === null && /site|trang web|domain|tên miền|linking page|trang liên kết|url|source|nguồn/.test(h)) domCol = i;
    else if (numCol === null && /link|liên kết|count|số|pages|trang/.test(h)) numCol = i;
  });
  if (domCol === null) domCol = 0;
  const own = clean(site.domain);
  const agg = new Map<string, number>();
  let ownRows = 0;
  for (const r of rows.slice(1)) {
    if (r.length <= domCol) continue;
    const d = clean(r[domCol]);
    if (!d.includes(".")) continue;
    // Sửa lỗi bản gốc: file "Trang được liên kết hàng đầu" chứa trang CỦA MÌNH, không phải website trỏ link.
    if (d === own || d.endsWith("." + own)) {
      ownRows++;
      continue;
    }
    let n = 1;
    if (numCol !== null && numCol < r.length) n = parseInt(String(r[numCol]).replace(/[^\d]/g, "")) || 1;
    agg.set(d, (agg.get(d) || 0) + n);
  }
  if (!agg.size) {
    if (ownRows) throw new SeoError("File này liệt kê các trang của chính website bạn (Trang được liên kết hàng đầu). Hãy xuất Search Console → Liên kết → “Trang web liên kết hàng đầu” → Xuất → CSV.");
    throw new SeoError("Không tìm thấy cột tên miền/URL trong file. Hãy xuất từ Search Console → Liên kết → Trang web liên kết hàng đầu → Xuất → CSV.");
  }
  const domains = [...agg.entries()].sort((a, b) => b[1] - a[1])
    .map(([d, n]) => ({ domain: d, rank: null, backlinks: n, first_seen: "", spam: null, nofollow: false }));
  const total = [...agg.values()].reduce((a, b) => a + b, 0);
  const summary = { rank: null, backlinks: total, referring_domains: agg.size, referring_main_domains: agg.size };
  await run("INSERT INTO seo_bl_snapshots(site_id, at, source, summary_json, domains_json, links_json, lost_json, cost) VALUES (?,?,?,?,?,?,?,0)",
    [siteId, now(), "gsc", JSON.stringify(summary), JSON.stringify(domains), "{}", "[]"]);
  return { domains: domains.length };
}

async function overview(siteId: number) {
  const site = await getSite(siteId);
  if (!site) throw new SeoError("Không tìm thấy website");
  const snaps = await q("SELECT * FROM seo_bl_snapshots WHERE site_id=? ORDER BY id", [siteId]);
  const hist = snaps.map((s: any) => ({ at: s.at, source: s.source, ...JSON.parse(s.summary_json) }));
  if (!snaps.length) return { site, latest: null, history: [] };
  const last = snaps[snaps.length - 1];
  const prev = [...snaps.slice(0, -1)].reverse().find((s: any) => s.source === last.source) || null;
  const curDomains = JSON.parse(last.domains_json);
  const links = JSON.parse(last.links_json || "{}");
  const prevSet = prev ? new Set(JSON.parse(prev.domains_json).map((d: any) => d.domain)) : null;
  const curSet = new Set(curDomains.map((d: any) => d.domain));
  for (const d of curDomains) {
    d.category = category(d.domain);
    d.link = links[d.domain] ?? null;
    d.is_new = (prevSet !== null && !prevSet.has(d.domain)) || Boolean(d.link && d.link.is_new);
  }
  let lost = JSON.parse(last.lost_json || "[]");
  if (prev) {
    const gone = JSON.parse(prev.domains_json).filter((d: any) => !curSet.has(d.domain))
      .map((d: any) => ({ domain: d.domain, rank: d.rank ?? null, lost_date: String(last.at).slice(0, 10), backlinks: d.backlinks ?? null }));
    const goneSet = new Set(gone.map((g: any) => g.domain));
    lost = [...gone, ...lost.filter((x: any) => !goneSet.has(x.domain))];
  }
  const cats: Record<string, number> = {};
  for (const d of curDomains) cats[d.category] = (cats[d.category] || 0) + 1;
  return {
    site: { ...site, competitors: JSON.parse(site.competitors_json || "[]") },
    latest: { at: last.at, source: last.source, summary: JSON.parse(last.summary_json), cost: last.cost,
      compared_with: prev ? prev.at : null, new_count: curDomains.filter((d: any) => d.is_new).length, lost_count: lost.length },
    domains: curDomains, lost: lost.slice(0, 200), categories: cats, history: hist,
  };
}

// ---------------------------------------------------------------- tìm cơ hội (gap): mỗi bước tối đa 4 đối thủ song song
registerStep("bl_gap", async (job, ctx) => {
  const st = job.state;
  const cfg = await needApi();
  const site = await getSite(st.site_id);
  if (!site) throw new SeoError("Không tìm thấy website");
  const comps: string[] = JSON.parse(site.competitors_json || "[]");
  st.cost = st.cost || 0;
  if (st.step === "mine") {
    if (!comps.length) throw new SeoError("Thêm ít nhất một website đối thủ trước.");
    const snap = await one("SELECT domains_json FROM seo_bl_snapshots WHERE site_id=? ORDER BY id DESC LIMIT 1", [st.site_id]);
    if (snap) st.mine = JSON.parse(snap.domains_json).map((d: any) => d.domain);
    else {
      ctx.progress("Đang lấy website trỏ về bạn…");
      const [r, c] = await call(cfg, "/v3/backlinks/referring_domains/live", { target: site.domain, limit: 1000, rank_scale: "one_hundred" });
      st.cost += c;
      st.mine = (r.items || []).map((i: any) => clean(i.domain));
    }
    st.comps = comps;
    st.idx = 0;
    st.agg = {};
    st.step = "comps";
    ctx.progress(`Đang lấy backlink của ${comps.length} đối thủ…`);
    return;
  }
  if (st.step === "comps") {
    const mine = new Set(st.mine);
    const batch = st.comps.slice(st.idx, st.idx + 4);
    const results = await Promise.all(batch.map((comp: string) => call(cfg, "/v3/backlinks/referring_domains/live",
      { target: comp, limit: 1000, order_by: ["rank,desc"], rank_scale: "one_hundred", backlinks_status_type: "live" })));
    batch.forEach((comp: string, k: number) => {
      const [r, c] = results[k];
      st.cost += c;
      for (const i of r.items || []) {
        const d = clean(i.domain);
        if (!d || mine.has(d) || d === site.domain || st.comps.some((x: string) => d === clean(x) || d.endsWith("." + clean(x)))) continue;
        const a = (st.agg[d] ||= { domain: d, rank: i.rank || 0, spam: i.backlinks_spam_score ?? null, competitors: [], backlinks: 0 });
        a.competitors.push(comp);
        a.backlinks += i.backlinks || 0;
        a.rank = Math.max(a.rank, i.rank || 0);
      }
    });
    st.idx += batch.length;
    if (st.idx < st.comps.length) {
      ctx.progress(`Đang lấy backlink của ${st.comps.length} đối thủ… (${st.idx}/${st.comps.length})`);
      return;
    }
    const items = Object.values(st.agg).sort((x: any, y: any) => y.competitors.length - x.competitors.length || (y.rank || 0) - (x.rank || 0));
    for (const x of items as any[]) x.category = category(x.domain);
    await run("UPDATE seo_bl_sites SET gap_json=?, gap_at=? WHERE id=?", [JSON.stringify(items.slice(0, 2000)), now(), st.site_id]);
    const out = { count: items.length, cost: st.cost };
    st.agg = {};
    return { done: out };
  }
  throw new SeoError("Trạng thái tìm cơ hội không hợp lệ");
});

async function examples(siteId: number, domain: string) {
  const site = await getSite(siteId);
  if (!site) throw new SeoError("Không tìm thấy website");
  const o = await one("SELECT examples_json FROM seo_bl_opps WHERE site_id=? AND domain=?", [siteId, domain]);
  if (o?.examples_json) return JSON.parse(o.examples_json);
  const cfg = await needApi();
  const gapl = JSON.parse(site.gap_json || "[]");
  const comps = gapl.find((g: any) => g.domain === domain)?.competitors || JSON.parse(site.competitors_json || "[]");
  const out: any[] = [];
  const results = await Promise.all(comps.slice(0, 3).map((comp: string) => call(cfg, "/v3/backlinks/backlinks/live",
    { target: comp, limit: 5, mode: "as_is", filters: ["domain_from", "like", `%${domain}`], order_by: ["rank,desc"] })));
  comps.slice(0, 3).forEach((comp: string, k: number) => {
    for (const i of results[k][0].items || []) {
      out.push({ competitor: comp, url_from: i.url_from, url_to: i.url_to, anchor: i.anchor || "", title: i.page_from_title || "",
        dofollow: i.dofollow, first_seen: String(i.first_seen || "").slice(0, 10) });
    }
  });
  await saveOpp(siteId, domain, { examples_json: JSON.stringify(out) });
  return out;
}

async function saveOpp(siteId: number, domain: string, kw: Record<string, any>) {
  await run("INSERT INTO seo_bl_opps(site_id, domain, updated_at) VALUES (?,?,?) ON CONFLICT (site_id, domain) DO NOTHING", [siteId, domain, now()]);
  for (const [k, v] of Object.entries(kw)) {
    if (!["status", "note", "examples_json", "draft_json"].includes(k)) continue;
    await run(`UPDATE seo_bl_opps SET ${k}=?, updated_at=? WHERE site_id=? AND domain=?`, [v, now(), siteId, domain]);
  }
}

async function outreach(siteId: number, domain: string) {
  const cfg = await loadConfig();
  if (!cfg.anthropic_api_key) throw new SeoError("Cần khóa Claude API (ANTHROPIC_API_KEY trong biến môi trường).");
  const site = await getSite(siteId);
  if (!site) throw new SeoError("Không tìm thấy website");
  const o = await one("SELECT examples_json FROM seo_bl_opps WHERE site_id=? AND domain=?", [siteId, domain]);
  let pages: string[] = [];
  try {
    pages = (await q(`SELECT p.url FROM seo_audit_pages p JOIN seo_audit_sites s ON s.id=p.site_id WHERE s.domain=?
        AND p.type IN ('post','product','category','home') LIMIT 150`, [site.domain])).map((r: any) => r.url);
  } catch {}
  const ex = o?.examples_json ? JSON.parse(o.examples_json) : [];
  let pageTxt = "";
  if (ex.length) {
    const r = await fetchPage(ex[0].url_from, 20);
    if (r.status === 200) {
      const p = new PageParser();
      try {
        p.feed(decode(r));
      } catch {}
      pageTxt = `Tiêu đề: ${p.title}\n` + p.text.join(" ").split(/\s+/).filter(Boolean).join(" ").slice(0, 3500);
    }
  }
  const varsTxt = (cfg.ap_variables || []).filter((v: any) => v.value).map((v: any) => `- ${v.name}: ${v.value}`).join("\n");
  const prompt = `Bạn là chuyên viên SEO/PR người Việt, giúp website ${site.domain} xin đặt backlink một cách chính đáng.

Website mục tiêu cần liên hệ: ${domain} (loại: ${category(domain)})
Website này đang đặt link cho đối thủ:
${ex.length ? JSON.stringify(ex.slice(0, 5), null, 1) : "(chưa có ví dụ cụ thể)"}

Nội dung trang đang đặt link cho đối thủ (rút gọn):
${pageTxt || "(không đọc được)"}

Thông tin doanh nghiệp của mình (chỉ dùng thông tin này, không bịa):
${varsTxt || "- (chưa nhập; dùng chỗ trống [TÊN], [SĐT])"}

Các trang trên website mình (chọn trang phù hợp nhất để xin link tới):
${pages.slice(0, 120).join("\n") || `https://${site.domain}/`}

Hãy đề xuất cách tiếp cận phù hợp nhất (ví dụ: góp nội dung/bài khách, bổ sung vào bài tổng hợp, cập nhật link hỏng, đăng ký danh bạ, hợp tác, PR) và soạn tin nhắn.
Tin nhắn phải: lịch sự, ngắn (dưới 150 chữ), nêu giá trị cụ thể cho họ, không hứa trao đổi link qua lại, không đề nghị trả tiền để mua link dofollow. Nếu cần trả phí (bài PR), nói rõ link sẽ được gắn nhãn sponsored theo hướng dẫn của Google.
Chỉ trả về JSON hợp lệ:
{
  "approach": "tên cách tiếp cận",
  "why": "vì sao phù hợp với website này",
  "target_page": "URL trang của mình nên được link tới",
  "anchor_ideas": ["2-3 anchor tự nhiên, đa dạng, không nhồi từ khóa"],
  "contact_hint": "nên tìm liên hệ ở đâu trên website đó (trang Liên hệ, email biên tập, fanpage…)",
  "email_subject": "tiêu đề email",
  "email_body": "nội dung email",
  "zalo_message": "bản rút gọn cho Zalo/Messenger, dưới 60 chữ",
  "content_idea": "nếu là bài khách/bổ sung nội dung: đề xuất tiêu đề + 3 ý chính, ngược lại để rỗng"
}`;
  const [txt, usage] = await claude(cfg, prompt, 4000, null, "ai_outreach");
  const out = extractJson(txt);
  out.usage = usage;
  await saveOpp(siteId, domain, { draft_json: JSON.stringify(out) });
  return out;
}

// ---------------------------------------------------------------- API
export async function handle(h: any, method: string, path: string) {
  const seg = path.split("/").slice(3);
  const qs = h.query;
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  try {
    if (method === "GET" && is("sites")) {
      const rows = await q(`SELECT s.id, s.domain, s.competitors_json, s.gap_at,
          (SELECT at FROM seo_bl_snapshots WHERE site_id=s.id ORDER BY id DESC LIMIT 1) last_at
          FROM seo_bl_sites s ORDER BY s.id DESC`);
      return h.send_json({ items: rows.map((r: any) => ({ ...r, competitors: JSON.parse(r.competitors_json || "[]") })) });
    }
    if (method === "POST" && is("sites")) {
      const b = await h.read_json();
      const d = clean(b.domain);
      if (!d.includes(".")) return h.send_json({ error: "Tên miền chưa đúng. Ví dụ: mrvu.vn" }, 400);
      const comps = uniq((b.competitors || []).map(clean)).filter((c: string) => c.includes(".") && c !== d).slice(0, 10);
      let sid;
      if (b.id) {
        await run("UPDATE seo_bl_sites SET competitors_json=? WHERE id=?", [JSON.stringify(comps), b.id]);
        sid = b.id;
      } else {
        await run("INSERT INTO seo_bl_sites(domain, competitors_json, created_at) VALUES (?,?,?) ON CONFLICT (domain) DO NOTHING", [d, JSON.stringify(comps), now()]);
        await run("UPDATE seo_bl_sites SET competitors_json=? WHERE domain=?", [JSON.stringify(comps), d]);
        sid = (await one("SELECT id FROM seo_bl_sites WHERE domain=?", [d])).id;
      }
      return h.send_json({ id: sid, domain: d, competitors: comps });
    }
    if (method === "DELETE" && is("sites", "*")) {
      await run("DELETE FROM seo_bl_snapshots WHERE site_id=?", [seg[1]]);
      await run("DELETE FROM seo_bl_opps WHERE site_id=?", [seg[1]]);
      await run("DELETE FROM seo_bl_sites WHERE id=?", [seg[1]]);
      return h.send_json({ ok: true });
    }
    if (method === "GET" && is("overview")) return h.send_json(await overview(parseInt(qs.get("site_id") || "0")));
    if (method === "POST" && is("refresh")) {
      const sid = parseInt((await h.read_json()).site_id);
      await needApi();
      return h.send_json({ job_id: await startJob("bl_refresh", { step: "summary", site_id: sid }, "Đang lấy chỉ số tổng quan…") });
    }
    if (method === "POST" && is("gap")) {
      const sid = parseInt((await h.read_json()).site_id);
      await needApi();
      return h.send_json({ job_id: await startJob("bl_gap", { step: "mine", site_id: sid }, "Đang bắt đầu…") });
    }
    if (method === "GET" && is("job", "*")) return h.send_json(await advance(seg[1]));
    if (method === "POST" && is("import")) {
      const b = await h.read_json();
      return h.send_json(await importCsv(parseInt(b.site_id), b.text || ""));
    }
    if (method === "GET" && is("gap")) {
      const sid = parseInt(qs.get("site_id") || "0");
      const s = await one("SELECT gap_json, gap_at, competitors_json FROM seo_bl_sites WHERE id=?", [sid]);
      const opps = new Map((await q(`SELECT domain, status, note, updated_at, examples_json IS NOT NULL has_ex, draft_json IS NOT NULL has_draft
          FROM seo_bl_opps WHERE site_id=?`, [sid])).map((r: any) => [r.domain, r]));
      const items = s ? JSON.parse(s.gap_json || "[]") : [];
      for (const i of items) {
        const o: any = opps.get(i.domain) || {};
        Object.assign(i, { status: o.status ?? "new", note: o.note ?? "", updated_at: o.updated_at ?? null, has_ex: Boolean(o.has_ex), has_draft: Boolean(o.has_draft) });
      }
      return h.send_json({ items, at: s ? s.gap_at : null, competitors: s ? JSON.parse(s.competitors_json || "[]") : [] });
    }
    if (method === "POST" && is("examples")) {
      const b = await h.read_json();
      return h.send_json({ items: await examples(parseInt(b.site_id), clean(b.domain)) });
    }
    if (method === "POST" && is("outreach")) {
      const b = await h.read_json();
      return h.send_json(await outreach(parseInt(b.site_id), clean(b.domain)));
    }
    if (method === "GET" && is("opp")) {
      const sid = parseInt(qs.get("site_id") || "0"), d = clean(qs.get("domain") || "");
      const r = (await one("SELECT * FROM seo_bl_opps WHERE site_id=? AND domain=?", [sid, d])) || { status: "new", note: "" };
      return h.send_json({ status: r.status, note: r.note, examples: r.examples_json ? JSON.parse(r.examples_json) : null, draft: r.draft_json ? JSON.parse(r.draft_json) : null });
    }
    if (method === "POST" && is("opp")) {
      const b = await h.read_json();
      const kw: any = { note: b.note ?? "" };
      if (OPP_STATUS.includes(b.status)) kw.status = b.status;
      await saveOpp(parseInt(b.site_id), clean(b.domain), kw);
      return h.send_json({ ok: true });
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
}
