// @ts-nocheck
/**
 * Bộ quét website và kiểm toán SEO on-page — chuyển từ mrvu-seo-studio/audit.py
 * (+ phần Audit trong app.py). Khác bản gốc vì chạy trên Vercel:
 *   - Quét website (crawl) là tác vụ nhiều bước: mỗi lần giao diện hỏi tiến độ thì
 *     quét thêm ~40 giây rồi lưu trạng thái (seo_jobs). Số trang tối đa còn bị giới
 *     hạn bởi "crawl_max_pages" trong Cài đặt chi phí (admin đặt).
 *   - Audit một trang có hạn thời gian; link chưa kịp kiểm thì ghi rõ trong kết quả.
 *   - Crawl tôn trọng Disallow trong robots.txt (User-agent: *).
 */
import { SeoError, extractJson, loadConfig, now, nowUtc, one, pyRound, q, run, slugify, squash, tx, vnNum } from "./core";
import { claude } from "./apis";
import { registerStep, startJob, STEP_BUDGET_MS } from "./jobs";
import { settings } from "./costs";
import { PageParser, bareHost, cleanUrl, decode, fetchPage, header, netloc, sameSite, schemaTypes, unescapeHtml, urlParts, urljoin } from "./web";

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|pdf|zip|rar|7z|gz|mp4|mp3|webm|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|txt|woff2?|ttf|eot)$/i;
export const TYPE_VI: Record<string, string> = { home: "Trang chủ", category: "Danh mục", product: "Sản phẩm", post: "Bài viết", other: "Khác" };

// ---------------------------------------------------------------- tiện ích URL
export function normalizeStart(u: string) {
  u = String(u || "").trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const p = urlParts(u);
  return `${p.scheme}://${p.netloc}${p.path || "/"}`;
}

// ---------------------------------------------------------------- phân loại
export function classify(url: string, source = "") {
  const p = urlParts(url);
  const path = p.path.toLowerCase();
  const src = (source || "").toLowerCase();
  if (["", "/", "/index.html", "/index.php", "/default.aspx", "/index.aspx", "/trang-chu", "/home"].includes(path) && !p.query) return "home";
  if (/product[_-]?cat|category|collection|danh-?muc|chuyen-?muc|tag/.test(src)) return "category";
  if (/product|san-?pham/.test(src)) return "product";
  if (/post|news|blog|article|tin-?tuc|bai-?viet/.test(src)) return "post";
  if (/\/(product-category|danh-muc|danh-muc-san-pham|category|categories|collections|chuyen-muc|c|cat)\//.test(path)) return "category";
  if (/\/(san-pham|product|products|sp|shop|p)\/[^/]+/.test(path) || /-p\d+(\.\w+)?$|[?&](pid|product_id)=/.test(url.toLowerCase())) return "product";
  if (/\/(tin-tuc|blog|bai-viet|news|kien-thuc|tu-van|cam-nang|post|posts|huong-dan)\/[^/]+/.test(path) || /\/20\d\d\/\d\d\//.test(path)) return "post";
  return "other";
}

// ---------------------------------------------------------------- robots.txt (Disallow cho User-agent: *)
function robotsRules(txt: string): string[] {
  const rules: string[] = [];
  let applies = false, inGroup = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, "").trim();
    const m = /^([a-zA-Z-]+)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!inGroup) applies = false;
      inGroup = true;
      if (v === "*" || /mrvuseostudio/i.test(v)) applies = true;
    } else {
      inGroup = false;
      if (k === "disallow" && applies && v) rules.push(v);
    }
  }
  return rules;
}
function disallowed(url: string, rules: string[]) {
  if (!rules?.length) return false;
  const p = urlParts(url);
  const path = (p.path || "/") + (p.query ? "?" + p.query : "");
  return rules.some((r) => {
    const re = new RegExp("^" + r.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path);
  });
}

// ---------------------------------------------------------------- quét website (từng bước)
function sitemapLocs(text: string): [boolean, string[]] {
  const isIndex = text.slice(0, 2000).toLowerCase().includes("<sitemapindex");
  const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => unescapeHtml(m[1].trim()));
  return [isIndex, locs];
}

function addFound(st: any, u: string, src: string) {
  u = cleanUrl(u);
  if (Object.keys(st.found).length >= st.max || !u.startsWith("http") || !sameSite(u, st.host) || SKIP_EXT.test(urlParts(u).path)) return;
  if (disallowed(u, st.robots)) return;
  if (!(u in st.found)) st.found[u] = src;
}

registerStep("audit_crawl", async (job, ctx) => {
  const st = job.state;
  const left = () => (ctx.deadline - Date.now()) / 1000;
  if (st.phase === "init") {
    const home = await fetchPage(normalizeStart(st.start));
    if (home.status === 0) throw new SeoError(`Không mở được website: ${home.error || "lỗi kết nối"}`);
    st.base = home.url;
    const bp = urlParts(st.base);
    st.root = `${bp.scheme}://${bp.netloc}`;
    st.host = bp.netloc;
    st.found = {};
    st.robots = [];
    addFound(st, st.base, "home");
    ctx.progress("Đang đọc robots.txt và sitemap…");
    let sitemaps: string[] = [];
    const rob = await fetchPage(st.root + "/robots.txt", 10);
    if (rob.status === 200) {
      const txt = decode(rob);
      sitemaps = [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      st.robots = robotsRules(txt);
    }
    sitemaps.push(st.root + "/sitemap.xml", st.root + "/sitemap_index.xml", st.root + "/wp-sitemap.xml");
    st.queue = [...new Set(sitemaps)];
    st.seen_sm = [];
    st.phase = "sitemaps";
    ctx.extra.found = Object.keys(st.found).length;
    return;
  }
  if (st.phase === "sitemaps") {
    while (st.queue.length && st.seen_sm.length < 60 && Object.keys(st.found).length < st.max && left() > 5) {
      const sm = st.queue.shift();
      if (st.seen_sm.includes(sm)) continue;
      st.seen_sm.push(sm);
      const r = await fetchPage(sm, Math.min(20, Math.max(5, left() - 2)));
      if (r.status !== 200) continue;
      const text = decode(r);
      const head = text.slice(0, 3000).toLowerCase();
      if (!head.includes("<urlset") && !head.includes("<sitemapindex")) continue;
      const [isIndex, locs] = sitemapLocs(text);
      const name = urlParts(sm).path.split("/").pop();
      if (isIndex) st.queue.push(...locs.filter((l) => !st.seen_sm.includes(l)));
      else {
        for (const l of locs) addFound(st, l, name);
        ctx.progress(`Đã đọc ${name}`);
      }
    }
    ctx.extra.found = Object.keys(st.found).length;
    const finished = !st.queue.length || st.seen_sm.length >= 60 || Object.keys(st.found).length >= st.max;
    if (!finished) return;
    st.method = "sitemap";
    if (Object.keys(st.found).length <= 1) {
      // không có sitemap: bò theo liên kết
      st.method = "crawl";
      st.visited = [];
      st.frontier = [st.base];
      st.phase = "crawl";
    } else st.phase = "save";
    return;
  }
  if (st.phase === "crawl") {
    const cap = Math.min(st.max, 300);
    while (st.frontier.length && st.visited.length < cap && left() > 16) {
      const batch = st.frontier.slice(0, 8).filter((u: string) => !st.visited.includes(u));
      st.frontier = st.frontier.slice(8);
      st.visited.push(...batch);
      const pages: any[] = [];
      for (let i = 0; i < batch.length; i += 4) pages.push(...(await Promise.all(batch.slice(i, i + 4).map((u: string) => fetchPage(u, 15)))));
      for (const res of pages) {
        if (res.status !== 200 || !header(res, "content-type").toLowerCase().includes("html")) continue;
        for (const m of decode(res).matchAll(/<a\s[^>]*href=["']([^"'#]+)/gi)) {
          const u = cleanUrl(urljoin(res.url, unescapeHtml(m[1])));
          if (u.startsWith("http") && sameSite(u, st.host) && !SKIP_EXT.test(urlParts(u).path) && !disallowed(u, st.robots)) {
            if (!(u in st.found)) addFound(st, u, "link");
            if (!st.visited.includes(u) && !st.frontier.includes(u)) st.frontier.push(u);
          }
        }
      }
      ctx.progress(`Đang bò liên kết… đã mở ${st.visited.length} trang`);
      await new Promise((r) => setTimeout(r, 200));
    }
    ctx.extra.found = Object.keys(st.found).length;
    if (st.frontier.length && st.visited.length < cap) return;
    st.phase = "save";
    return;
  }
  if (st.phase === "save") {
    const pages = Object.entries(st.found).map(([u, s]: any) => [u, classify(u, s), s]);
    pages.sort((a, b) => (a[1] !== "home") - (b[1] !== "home") || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const domain = bareHost(netloc(st.base));
    const at = nowUtc();
    const sid = await tx(async (t: any) => {
      await run("INSERT INTO seo_audit_sites(domain) VALUES (?) ON CONFLICT (domain) DO NOTHING", [domain], t);
      const id = (await one("SELECT id FROM seo_audit_sites WHERE domain=?", [domain], t)).id;
      for (let i = 0; i < pages.length; i += 400) {
        const part = pages.slice(i, i + 400);
        const ph = part.map(() => "(?,?,?,?)").join(",");
        await run(`INSERT INTO seo_audit_pages(site_id, url, type, source) VALUES ${ph} ON CONFLICT (site_id, url) DO NOTHING`, part.flatMap((p) => [id, ...p]), t);
      }
      const n = (await one("SELECT COUNT(*) n FROM seo_audit_pages WHERE site_id=?", [id], t)).n;
      await run("UPDATE seo_audit_sites SET start_url=?, crawled_at=?, method=?, count=? WHERE id=?", [st.base, at, st.method, n, id], t);
      return id;
    });
    const how = st.method === "sitemap" ? "sitemap" : "bò theo liên kết (website không có sitemap)";
    ctx.extra.site_id = sid;
    ctx.extra.found = pages.length;
    ctx.progress(`Hoàn thành! Tìm thấy ${pages.length} trang qua ${how}.`);
    return { done: null };
  }
  throw new SeoError("Trạng thái quét không hợp lệ");
});

// ---------------------------------------------------------------- audit
const chk = (group: string, label: string, status: string, value: string, fix = "", weight = 3) => ({ group, label, status, value, fix, weight });

async function linkStatus(u: string, budget: number): Promise<[string, number, string | undefined]> {
  let r = await fetchPage(u, Math.max(2, Math.min(10, budget)), "HEAD");
  if ([405, 403, 400, 501].includes(r.status) || r.status === 0) r = await fetchPage(u, Math.max(2, Math.min(12, budget)), "GET", 2048);
  return [u, r.status, r.error];
}

function detectType(guess: string, types: Set<string>, meta: any) {
  const has = (xs: string[]) => xs.some((x) => types.has(x));
  if (has(["Product", "IndividualProduct", "ProductGroup"]) || String(meta["og:type"] || "").startsWith("product")) return "product";
  if (has(["Article", "BlogPosting", "NewsArticle"]) || meta["og:type"] === "article") return guess === "home" ? guess : "post";
  if (has(["CollectionPage", "ItemList", "OfferCatalog"]) && guess === "other") return "category";
  return guess;
}

export async function auditPage(url: string, pageType = "other", keyword = "", otherTitles: Set<string> = new Set(), checkLinks = true) {
  const t0 = Date.now();
  const deadline = t0 + 45_000;
  const res = await fetchPage(url);
  const checks: any[] = [];
  const [G_TECH, G_HEAD, G_CONTENT, G_IMG, G_LINK, G_SCHEMA, G_SOCIAL] = ["Kỹ thuật", "Tiêu đề & heading", "Nội dung & từ khóa", "Hình ảnh", "Liên kết", "Dữ liệu cấu trúc", "Chia sẻ mạng xã hội"];
  if (res.status === 0) throw new SeoError(`Không tải được trang: ${res.error || "lỗi kết nối"}`);
  const html = decode(res);
  const p = new PageParser();
  try {
    p.feed(html);
  } catch {}
  const meta = p.meta;
  const final = res.url;
  const text = p.text.join(" ").split(/\s+/).filter(Boolean).join(" ");
  const words = text.split(/\s+/).filter(Boolean);
  const wc = words.length;
  const [types, ldErr] = schemaTypes(p.jsonld);
  pageType = detectType(pageType, types, meta);

  // ---- Kỹ thuật
  const st = res.status;
  checks.push(chk(G_TECH, "Mã phản hồi HTTP", st === 200 ? "pass" : "fail", String(st), "Trang phải trả về 200. Lỗi 4xx/5xx khiến Google bỏ trang khỏi kết quả; kiểm tra lại đường dẫn hoặc máy chủ.", 15));
  if (res.redirects.length) {
    const chain = res.redirects.map(([c, u]: any) => `${c} ${u}`).join(" → ");
    checks.push(chk(G_TECH, "Chuyển hướng", res.redirects.length > 1 ? "warn" : "info", chain, "Sửa liên kết nội bộ trỏ thẳng tới URL cuối cùng, tránh chuyển hướng nhiều lớp.", 3));
  }
  checks.push(chk(G_TECH, "HTTPS", final.startsWith("https://") ? "pass" : "fail", final.startsWith("https://") ? "Có" : "Không", "Cài chứng chỉ SSL và chuyển hướng 301 toàn bộ http sang https.", 8));
  const robots = ((meta.robots || "") + " " + header(res, "x-robots-tag")).toLowerCase();
  const noindex = robots.includes("noindex");
  checks.push(chk(G_TECH, "Cho phép Google index", noindex ? "fail" : "pass", robots.trim() || "Không chặn",
    "Trang đang có noindex nên sẽ không xuất hiện trên Google. Gỡ noindex trong thẻ meta robots / plugin SEO nếu trang này cần lên top.", 15));
  const canonLink = p.links_rel.find((l) => (l.rel || "").toLowerCase() === "canonical");
  const canon = canonLink ? canonLink.href : null;
  if (!canon) {
    checks.push(chk(G_TECH, "Thẻ canonical", "warn", "Không có", `Thêm <link rel="canonical" href="${final}"> vào <head> để tránh trùng lặp nội dung do tham số URL.`, 4));
  } else {
    const ca = urljoin(final, canon);
    const same = ca.replace(/\/+$/, "") === final.replace(/\/+$/, "");
    checks.push(chk(G_TECH, "Thẻ canonical", same ? "pass" : "warn", ca,
      same ? "" : "Canonical đang trỏ sang URL khác, Google sẽ coi trang kia là bản chính và có thể không index trang này. Nếu trang này cần lên top, đặt canonical trỏ về chính nó.", 6));
  }
  checks.push(chk(G_TECH, "Thẻ viewport (hiển thị di động)", meta.viewport ? "pass" : "fail", meta.viewport || "Không có",
    'Thêm <meta name="viewport" content="width=device-width, initial-scale=1"> để trang hiển thị đúng trên điện thoại.', 8));
  checks.push(chk(G_TECH, "Khai báo ngôn ngữ", p.lang ? "pass" : "warn", p.lang || "Không có", 'Thêm lang="vi" vào thẻ <html>.', 2));
  const el = res.elapsed;
  checks.push(chk(G_TECH, "Thời gian phản hồi máy chủ", el < 0.8 ? "pass" : el < 2 ? "warn" : "fail", `${el.toFixed(2)} giây`,
    "Máy chủ phản hồi chậm. Bật cache trang (page cache), dùng CDN, nâng cấp hosting hoặc tối ưu truy vấn cơ sở dữ liệu.", 5));
  const kb = res.body.length / 1024;
  checks.push(chk(G_TECH, "Dung lượng HTML", kb < 200 ? "pass" : "warn", `${pyRound(kb)} KB`, "HTML nặng làm chậm tải trang. Bỏ CSS/JS nhúng trực tiếp, giảm mã thừa từ page builder.", 2));
  checks.push(chk(G_TECH, "Số file JS / CSS bên ngoài", p.scripts + p.styles <= 25 ? "pass" : "warn", `${p.scripts} JS, ${p.styles} CSS`,
    "Quá nhiều file làm chậm trang. Gộp/nén file, tắt plugin không dùng, trì hoãn JS không quan trọng (defer).", 2));
  const fp = urlParts(final);
  const path = fp.path;
  const urlIssues: string[] = [];
  if (final.length > 100) urlIssues.push("dài hơn 100 ký tự");
  if (/[A-Z]/.test(path)) urlIssues.push("có chữ hoa");
  if (path.includes("_")) urlIssues.push("dùng dấu gạch dưới");
  if (path.includes("%")) urlIssues.push("có ký tự mã hóa/tiếng Việt có dấu");
  if (fp.query) urlIssues.push("có tham số ?");
  checks.push(chk(G_TECH, "Cấu trúc URL", urlIssues.length ? "warn" : "pass", urlIssues.join(", ") || "Gọn, dễ đọc",
    "URL nên ngắn, chữ thường, không dấu, nối bằng gạch ngang và chứa từ khóa chính. Nếu đổi URL, nhớ đặt chuyển hướng 301 từ URL cũ.", 3));

  // ---- Tiêu đề & heading
  const title = p.title || "";
  const tl = [...title].length;
  if (!title) checks.push(chk(G_HEAD, "Thẻ title", "fail", "Không có", "Thêm thẻ <title> mô tả đúng nội dung trang, 50–60 ký tự, chứa từ khóa chính.", 12));
  else {
    checks.push(chk(G_HEAD, "Độ dài title", tl >= 30 && tl <= 60 ? "pass" : "warn", `${tl} ký tự: ${title}`,
      tl > 60 ? "Title nên dài 50–60 ký tự: đủ ý, không bị Google cắt. Đưa từ khóa chính lên đầu." : "Title quá ngắn, bỏ phí chỗ hiển thị. Viết 50–60 ký tự gồm từ khóa chính + lợi ích/thương hiệu.", 6));
    if (otherTitles.has(title)) checks.push(chk(G_HEAD, "Title trùng trang khác", "fail", title, "Mỗi trang cần một title riêng. Trùng title khiến Google khó chọn trang nào để xếp hạng.", 8));
  }
  const md = String(meta.description || "").trim();
  if (!md) checks.push(chk(G_HEAD, "Meta description", "fail", "Không có", "Viết meta description 120–160 ký tự: tóm tắt trang, chứa từ khóa, có lời kêu gọi (ví dụ: Xem giá, Gọi ngay).", 7));
  else {
    const ml = [...md].length;
    checks.push(chk(G_HEAD, "Độ dài meta description", ml >= 110 && ml <= 160 ? "pass" : "warn", `${ml} ký tự: ${md}`, "Meta description nên dài 120–160 ký tự để hiển thị trọn trên Google và tăng tỉ lệ nhấp.", 4));
  }
  const h1s = p.headings.filter(([lv]) => lv === 1).map(([, t]) => t);
  if (!h1s.length) checks.push(chk(G_HEAD, "Thẻ H1", "fail", "Không có", "Mỗi trang cần đúng 1 thẻ H1 nêu chủ đề chính, chứa từ khóa chính. Thường là tên sản phẩm/tiêu đề bài viết.", 10));
  else if (h1s.length > 1) checks.push(chk(G_HEAD, "Thẻ H1", "warn", `${h1s.length} thẻ H1: ` + h1s.slice(0, 4).join(" | "), "Chỉ giữ 1 H1. Các H1 còn lại (thường do logo, tiêu đề widget) đổi thành H2 hoặc thẻ div.", 5));
  else checks.push(chk(G_HEAD, "Thẻ H1", h1s[0] ? "pass" : "fail", h1s[0] || "H1 rỗng", "H1 đang rỗng; điền nội dung chính của trang.", 10));
  const skips: string[] = [];
  let prev = 0;
  for (const [lv] of p.headings) {
    if (prev && lv > prev + 1) skips.push(`H${prev}→H${lv}`);
    prev = lv;
  }
  const emptyH = p.headings.filter(([, t]) => !t).length;
  const h2c = p.headings.filter(([lv]) => lv === 2).length;
  const hs = skips.length || emptyH || (pageType === "post" && h2c < 2) ? "warn" : "pass";
  const hv = `${p.headings.length} heading, ${h2c} H2` + (skips.length ? `; nhảy cấp: ${skips.slice(0, 5).join(", ")}` : "") + (emptyH ? `; ${emptyH} heading rỗng` : "");
  checks.push(chk(G_HEAD, "Cấu trúc heading", hs, hv, "Heading cần theo thứ tự H1 → H2 → H3, không nhảy cấp, không để rỗng. Bài viết nên chia ý bằng nhiều H2.", 3));

  // ---- Nội dung & từ khóa
  const need = ({ post: 800, product: 300, category: 200, home: 300 } as any)[pageType] ?? 250;
  checks.push(chk(G_CONTENT, "Độ dài nội dung", wc >= need ? "pass" : wc >= need / 2 ? "warn" : "fail",
    `${vnNum(wc)} tiếng (gợi ý ≥ ${vnNum(need)} cho ${TYPE_VI[pageType].toLowerCase()})`,
    `Nội dung mỏng khó cạnh tranh. Bổ sung thông tin hữu ích: thông số, ưu nhược điểm, hướng dẫn, câu hỏi thường gặp… để đạt khoảng ${vnNum(need)} tiếng.`, 6));
  const kw = squash(keyword.toLowerCase());
  if (kw) {
    const low = text.toLowerCase();
    const n = low.split(kw).length - 1;
    const density = ((n * kw.split(" ").length) / Math.max(wc, 1)) * 100;
    const inT = title.toLowerCase().includes(kw);
    checks.push(chk(G_CONTENT, "Từ khóa trong title", inT ? "pass" : "fail", inT ? "Có" : "Không", `Đưa "${kw}" vào title, càng gần đầu càng tốt.`, 8));
    const h1t = h1s.join(" ").toLowerCase();
    checks.push(chk(G_CONTENT, "Từ khóa trong H1", h1t.includes(kw) ? "pass" : "fail", h1t.includes(kw) ? "Có" : "Không", `Viết lại H1 có chứa "${kw}".`, 6));
    const inMd = md.toLowerCase().includes(kw);
    checks.push(chk(G_CONTENT, "Từ khóa trong meta description", inMd ? "pass" : "warn", inMd ? "Có" : "Không", `Thêm "${kw}" vào meta description (Google bôi đậm từ khóa khi hiển thị).`, 3));
    const first = words.slice(0, 120).join(" ").toLowerCase();
    checks.push(chk(G_CONTENT, "Từ khóa trong đoạn mở đầu", first.includes(kw) ? "pass" : "warn", first.includes(kw) ? "Có" : "Không", `Nhắc "${kw}" trong khoảng 100 chữ đầu nội dung.`, 3));
    const sk = slugify(kw);
    checks.push(chk(G_CONTENT, "Từ khóa trong URL", sk && path.toLowerCase().includes(sk) ? "pass" : "warn", path, `URL nên chứa "${sk}". Chỉ đổi URL với trang mới hoặc trang chưa có thứ hạng; nhớ đặt 301.`, 3));
    const h2t = p.headings.filter(([lv]) => lv === 2 || lv === 3).map(([, t]) => t).join(" ").toLowerCase();
    checks.push(chk(G_CONTENT, "Từ khóa trong H2/H3", h2t.includes(kw) ? "pass" : "warn", h2t.includes(kw) ? "Có" : "Không", `Dùng "${kw}" hoặc biến thể của nó trong ít nhất một H2.`, 2));
    checks.push(chk(G_CONTENT, "Mật độ từ khóa", density >= 0.5 && density <= 2.5 ? "pass" : "warn", `${n} lần, ${density.toFixed(2)}%`,
      "Nên ở khoảng 0,5–2,5%. Quá thấp: nhắc thêm tự nhiên trong bài. Quá cao: thay bằng từ đồng nghĩa để tránh nhồi nhét.", 3));
  } else {
    checks.push(chk(G_CONTENT, "Từ khóa chính", "info", "Chưa nhập", "Nhập từ khóa chính của trang rồi audit lại để kiểm tra title, H1, URL, mật độ từ khóa.", 0));
  }

  // ---- Hình ảnh
  const imgs = p.images.filter((i) => i.src && !i.src.startsWith("data:"));
  const noAlt = imgs.filter((i) => i.alt === null || !String(i.alt).trim());
  checks.push(chk(G_IMG, "Ảnh thiếu alt", !noAlt.length ? "pass" : noAlt.length <= 3 ? "warn" : "fail",
    `${noAlt.length}/${imgs.length} ảnh` + (noAlt.length ? ": " + noAlt.slice(0, 5).map((i) => urlParts(i.src).path.split("/").pop() || i.src.split("/").pop()).join(", ") : ""),
    "Thêm thuộc tính alt mô tả nội dung ảnh (có từ khóa khi phù hợp). Giúp Google hiểu ảnh và lên Google Hình ảnh.", 5));
  const noDim = imgs.filter((i) => !(i.width && i.height));
  if (imgs.length) {
    checks.push(chk(G_IMG, "Ảnh thiếu kích thước", noDim.length <= imgs.length * 0.3 ? "pass" : "warn", `${noDim.length}/${imgs.length} ảnh`, "Khai báo width và height cho ảnh để trang không bị xô lệch khi tải (điểm CLS).", 2));
    const modern = imgs.filter((i) => /\.(webp|avif)(\?|$)/i.test(i.src)).length;
    checks.push(chk(G_IMG, "Định dạng ảnh hiện đại", modern >= imgs.length * 0.5 ? "pass" : "warn", `${modern}/${imgs.length} ảnh WebP/AVIF`,
      "Chuyển ảnh JPG/PNG sang WebP để nhẹ hơn 25–35%. WordPress có thể dùng plugin chuyển đổi tự động.", 2));
    const lazy = imgs.slice(2).filter((i) => String(i.loading).toLowerCase() === "lazy").length;
    if (imgs.length > 4) {
      checks.push(chk(G_IMG, "Tải ảnh chậm (lazy load)", lazy >= (imgs.length - 2) * 0.5 ? "pass" : "warn", `${lazy}/${imgs.length - 2} ảnh phía dưới`,
        'Thêm loading="lazy" cho ảnh nằm dưới màn hình đầu tiên để trang tải nhanh hơn.', 2));
    }
  }

  // ---- Liên kết
  const host = netloc(final);
  const internal: string[] = [], external: string[] = [];
  let emptyAnchor = 0, nofollowInt = 0;
  for (const a of p.anchors) {
    const hh = String(a.href).trim();
    if (!hh || ["#", "javascript:", "mailto:", "tel:", "zalo:"].some((x) => hh.startsWith(x))) continue;
    const u = cleanUrl(urljoin(final, hh));
    if (!u.startsWith("http")) continue;
    if (sameSite(u, host)) {
      internal.push(u);
      if (a.rel.includes("nofollow")) nofollowInt++;
    } else external.push(u);
    if (!a.text && !a.title) emptyAnchor++;
  }
  const ui = [...new Set(internal)].sort();
  checks.push(chk(G_LINK, "Liên kết nội bộ", ui.length >= 5 ? "pass" : "warn", `${ui.length} đường dẫn khác nhau`,
    "Thêm liên kết từ nội dung tới các trang liên quan (sản phẩm, bài viết cùng chủ đề) để dẫn Google và người đọc.", 4));
  checks.push(chk(G_LINK, "Liên kết ra ngoài", "info", `${new Set(external).size} đường dẫn`, "", 0));
  if (emptyAnchor) checks.push(chk(G_LINK, "Liên kết không có chữ", "warn", `${emptyAnchor} liên kết`,
    "Liên kết (thường là icon, ảnh) cần chữ hiển thị, alt của ảnh, hoặc thuộc tính title/aria-label để Google hiểu trang đích.", 2));
  if (nofollowInt) checks.push(chk(G_LINK, "Liên kết nội bộ nofollow", "warn", `${nofollowInt} liên kết`,
    "Không nên đặt nofollow cho liên kết trong cùng website; nó chặn dòng sức mạnh SEO giữa các trang.", 2));
  if (checkLinks) {
    const targets = [...ui, ...[...new Set(external)].sort()].slice(0, 40);
    const broken: any[] = [];
    let checked = 0;
    // 8 link song song như bản gốc; dừng khi hết thời gian cho phép của một lần gọi
    for (let i = 0; i < targets.length; i += 8) {
      const budget = (deadline - Date.now()) / 1000;
      if (budget < 3) break;
      const rs = await Promise.all(targets.slice(i, i + 8).map((u) => linkStatus(u, budget - 1)));
      for (const [u, s, err] of rs) {
        checked++;
        if (s === 404 || s === 410 || s >= 500 || (s === 0 && sameSite(u, host))) broken.push({ url: u, status: s || err || "lỗi kết nối" });
      }
    }
    const note = checked < targets.length ? ` (hết thời gian, chưa kiểm ${targets.length - checked} link)` : "";
    checks.push(chk(G_LINK, "Liên kết hỏng", !broken.length ? "pass" : "fail",
      `${broken.length} hỏng / đã kiểm ${checked}${note}` + broken.slice(0, 10).map((b) => `\n${b.status} ${b.url}`).join(""),
      "Sửa hoặc gỡ các liên kết hỏng. Nếu trang đích đã đổi địa chỉ, đặt chuyển hướng 301 sang trang mới.", 6));
  }

  // ---- Dữ liệu cấu trúc
  if (ldErr) checks.push(chk(G_SCHEMA, "Schema lỗi cú pháp", "fail", `${ldErr} khối JSON-LD không đọc được`, "Kiểm tra lại JSON-LD bằng công cụ Rich Results Test của Google; thường do thiếu dấu phẩy/ngoặc.", 5));
  const expected = ({ home: ["Organization", "WebSite"], product: ["Product", "BreadcrumbList"], post: ["Article", "BreadcrumbList"], category: ["BreadcrumbList"], other: ["BreadcrumbList"] } as any)[pageType];
  const alias: any = { Article: ["Article", "BlogPosting", "NewsArticle"], Organization: ["Organization", "LocalBusiness", "Store", "Corporation", "OnlineStore"] };
  const missing = expected.filter((e: string) => !(alias[e] || [e]).some((x: string) => types.has(x)));
  checks.push(chk(G_SCHEMA, "Schema phù hợp loại trang", !missing.length ? "pass" : "warn",
    (types.size ? "Đang có: " + [...types].sort().join(", ") : "Chưa có schema") + (missing.length ? `. Thiếu: ${missing.join(", ")}` : ""),
    "Dán đoạn Schema mẫu bên dưới vào trang (trong <head> hoặc qua plugin SEO) để Google hiển thị kết quả nổi bật (giá, sao đánh giá, đường dẫn…).", 5));
  if (types.has("Product")) {
    const prod = /"offers"/.test(p.jsonld.join(" "));
    checks.push(chk(G_SCHEMA, "Schema Product có giá (offers)", prod ? "pass" : "warn", prod ? "Có" : "Thiếu offers",
      "Bổ sung offers (price, priceCurrency, availability) để Google hiện giá trên kết quả tìm kiếm.", 3));
  }

  // ---- Mạng xã hội
  const ogMiss = ["og:title", "og:description", "og:image"].filter((k) => !meta[k]);
  checks.push(chk(G_SOCIAL, "Thẻ Open Graph (Facebook, Zalo)", !ogMiss.length ? "pass" : "warn", !ogMiss.length ? "Đủ" : "Thiếu " + ogMiss.join(", "),
    "Thêm og:title, og:description, og:image để link chia sẻ lên Facebook/Zalo hiện đúng ảnh và tiêu đề.", 2));

  // ---- điểm
  let score = 100;
  for (const c of checks) {
    if (c.status === "fail") score -= c.weight;
    else if (c.status === "warn") score -= c.weight / 2;
  }
  score = Math.max(0, pyRound(score));

  const extract = {
    title, meta_description: md, h1: h1s, headings: p.headings.slice(0, 50).map(([lv, t]) => `H${lv}: ${t}`), text: text.slice(0, 7000),
    og_image: meta["og:image"] || "", first_image: imgs.length ? imgs[0].src : "", published: meta["article:published_time"] || "",
    modified: meta["article:modified_time"] || "", site_name: meta["og:site_name"] || "", word_count: wc,
  };
  return {
    url, final_url: final, page_type: pageType, keyword: kw, score, checks, schema: buildSchema(final, pageType, extract), extract,
    counts: Object.fromEntries(["fail", "warn", "pass"].map((s) => [s, checks.filter((c) => c.status === s).length])),
    audited_at: now(),
  };
}

// ---------------------------------------------------------------- schema mẫu
function crumbName(seg: string) {
  seg = seg.replace(/\.(html?|aspx|php)$/, "").replace(/[-_]/g, " ").trim();
  try {
    seg = decodeURIComponent(seg);
  } catch {}
  return seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg;
}

export function buildSchema(url: string, pageType: string, ex: any) {
  const p = urlParts(url);
  const root = `${p.scheme}://${p.netloc}/`;
  const site = ex.site_name || bareHost(p.netloc);
  const name = (ex.h1?.length ? ex.h1 : [ex.title || ""])[0] || ex.title || "";
  const image = ex.og_image || ex.first_image ? urljoin(url, ex.og_image || ex.first_image || "") : "";
  const graph: any[] = [];
  if (pageType === "home") {
    graph.push({ "@type": "Organization", "@id": root + "#organization", name: site, url: root, logo: "LINK_LOGO", image: image || "LINK_ẢNH", telephone: "SỐ_ĐIỆN_THOẠI",
      address: { "@type": "PostalAddress", streetAddress: "ĐỊA_CHỈ", addressLocality: "TỈNH/THÀNH", addressCountry: "VN" }, sameAs: ["LINK_FANPAGE_FACEBOOK", "LINK_ZALO_OA"] });
    graph.push({ "@type": "WebSite", "@id": root + "#website", url: root, name: site, inLanguage: "vi-VN", publisher: { "@id": root + "#organization" } });
  } else {
    const segs = p.path.split("/").filter(Boolean);
    const items: any[] = [{ "@type": "ListItem", position: 1, name: "Trang chủ", item: root }];
    let acc = root;
    segs.forEach((s, i) => {
      acc = acc + s + (i < segs.length - 1 ? "/" : "");
      const last = i === segs.length - 1;
      items.push({ "@type": "ListItem", position: i + 2, name: last && name ? name : crumbName(s), item: last ? url : acc });
    });
    graph.push({ "@type": "BreadcrumbList", itemListElement: items });
    if (pageType === "product") {
      graph.push({ "@type": "Product", name, description: ex.meta_description || "", image: image || "LINK_ẢNH_SẢN_PHẨM", brand: { "@type": "Brand", name: "THƯƠNG_HIỆU" }, sku: "MÃ_SẢN_PHẨM",
        offers: { "@type": "Offer", url, priceCurrency: "VND", price: "GIÁ_BÁN", availability: "https://schema.org/InStock", itemCondition: "https://schema.org/NewCondition" } });
    } else if (pageType === "post") {
      graph.push({ "@type": "BlogPosting", headline: [...name].slice(0, 110).join(""), description: ex.meta_description || "", image: image || "LINK_ẢNH_ĐẠI_DIỆN", mainEntityOfPage: url,
        datePublished: ex.published || "YYYY-MM-DD", dateModified: ex.modified || ex.published || "YYYY-MM-DD", author: { "@type": "Person", name: "TÊN_TÁC_GIẢ" },
        publisher: { "@type": "Organization", name: site, logo: { "@type": "ImageObject", url: "LINK_LOGO" } } });
    } else if (pageType === "category") {
      graph.push({ "@type": "CollectionPage", name, url, description: ex.meta_description || "" });
    } else {
      graph.push({ "@type": "WebPage", name, url, description: ex.meta_description || "" });
    }
  }
  const data = { "@context": "https://schema.org", "@graph": graph };
  return '<script type="application/ld+json">\n' + JSON.stringify(data, null, 2) + "\n</script>";
}

// ---------------------------------------------------------------- AI (Claude)
export function faqSchema(faq: any[]) {
  const data = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.filter((f) => f.q).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return '<script type="application/ld+json">\n' + JSON.stringify(data, null, 2) + "\n</script>";
}

export async function aiSuggest(cfg: any, report: any) {
  const ex = report.extract;
  const issues = report.checks.filter((c: any) => c.status === "fail" || c.status === "warn").map((c: any) => `- [${c.status}] ${c.label}: ${String(c.value).slice(0, 160)}`).join("\n");
  const prompt = `Bạn là chuyên gia SEO tiếng Việt. Hãy tối ưu on-page cho trang sau.

URL: ${report.final_url}
Loại trang: ${TYPE_VI[report.page_type] || report.page_type}
Từ khóa chính: ${report.keyword || "(chưa có, hãy tự xác định từ khóa chính phù hợp nhất từ nội dung)"}
Title hiện tại: ${ex.title}
Meta description hiện tại: ${ex.meta_description}
Dàn heading hiện tại:
${ex.headings.slice(0, 40).join("\n")}

Các lỗi đã phát hiện:
${issues || "- Không có"}

Nội dung trang (rút gọn):
"""${ex.text.slice(0, 6000)}"""

Chỉ trả về một đối tượng JSON hợp lệ, không giải thích thêm, theo đúng cấu trúc:
{
  "main_keyword": "từ khóa chính nên nhắm",
  "secondary_keywords": ["5-8 từ khóa phụ/biến thể nên dùng trong bài"],
  "titles": ["3 phương án title 50-60 ký tự, từ khóa chính ở đầu"],
  "meta_descriptions": ["2 phương án 120-160 ký tự, có lời kêu gọi hành động"],
  "h1": "H1 đề xuất",
  "outline": ["dàn ý H2/H3 đề xuất cho trang, dạng 'H2: ...' hoặc 'H3: ...'"],
  "content_gaps": ["những thông tin người tìm kiếm cần mà trang còn thiếu"],
  "faq": [{"q": "câu hỏi", "a": "trả lời ngắn 1-2 câu"}],
  "priority_fixes": ["3-6 việc nên làm trước, sắp theo mức ảnh hưởng"]
}
Chỉ dựa vào nội dung trang; không bịa giá, thông số hay thông tin liên hệ.`;
  const [txt, usage] = await claude(cfg, prompt, 4000, null, "audit_ai");
  const out = extractJson(txt);
  if (out.faq?.length) out.faq_schema = faqSchema(out.faq);
  out.usage = usage;
  return out;
}

// ---------------------------------------------------------------- API (phần Audit của app.py)
export async function auditPagesList(siteId: any) {
  return await q(
    `SELECT p.id, p.url, p.type, p.source,
            (SELECT score FROM seo_audit_results r WHERE r.page_id=p.id ORDER BY audited_at DESC LIMIT 1) AS score,
            (SELECT audited_at FROM seo_audit_results r WHERE r.page_id=p.id ORDER BY audited_at DESC LIMIT 1) AS audited_at
     FROM seo_audit_pages p WHERE p.site_id=? ORDER BY p.id`, [siteId]);
}

export async function latestResult(pageId: any) {
  const r = await one("SELECT * FROM seo_audit_results WHERE page_id=? ORDER BY audited_at DESC LIMIT 1", [pageId]);
  if (!r) return null;
  const rep = JSON.parse(r.report_json);
  rep.page_id = Number(pageId);
  rep.result_id = r.id;
  rep.ai = r.ai_json ? JSON.parse(r.ai_json) : null;
  return rep;
}

export async function auditCrawl(h: any) {
  const body = await h.read_json();
  const url = String(body.url || "").trim();
  if (!url || !url.includes(".")) return h.send_json({ error: "Nhập địa chỉ website. Ví dụ: mrvu.vn" }, 400);
  const [s] = await settings();
  const cap = Math.max(10, Math.min(5000, parseInt(s.crawl_max_pages) || 2000));
  const maxPages = Math.max(10, Math.min(cap, parseInt(body.max_pages) || 1000));
  const jid = await startJob("audit_crawl", { phase: "init", start: url, max: maxPages }, "Đang mở website…", { found: 0 });
  return h.send_json({ job_id: jid });
}

export async function auditRun(h: any) {
  const body = await h.read_json();
  const pid = parseInt(body.page_id) || 0;
  const page = await one("SELECT * FROM seo_audit_pages WHERE id=?", [pid]);
  if (!page) return h.send_json({ error: "Không tìm thấy trang" }, 404);
  const others = await q(
    `SELECT r.report_json FROM seo_audit_results r JOIN seo_audit_pages p ON p.id=r.page_id
     WHERE p.site_id=? AND p.id<>? AND r.id IN (SELECT MAX(id) FROM seo_audit_results GROUP BY page_id)`, [page.site_id, pid]);
  const otherTitles = new Set<string>();
  for (const o of others) {
    const t = JSON.parse(o.report_json)?.extract?.title;
    if (t) otherTitles.add(t);
  }
  let rep: any;
  try {
    rep = await auditPage(page.url, page.type, body.keyword || "", otherTitles, body.check_links === undefined ? true : Boolean(body.check_links));
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
  const at = nowUtc();
  if (rep.page_type !== page.type) await run("UPDATE seo_audit_pages SET type=? WHERE id=?", [rep.page_type, pid]);
  const ins = await run("INSERT INTO seo_audit_results(page_id, audited_at, score, keyword, report_json) VALUES (?,?,?,?,?) RETURNING id",
    [pid, at, rep.score, rep.keyword, JSON.stringify(rep)]);
  Object.assign(rep, { page_id: pid, result_id: ins.rows[0].id, ai: null, audited_at: at });
  return h.send_json(rep);
}

export async function auditAi(h: any) {
  const body = await h.read_json();
  const pid = parseInt(body.page_id) || 0;
  const cfg = await loadConfig();
  const rep = await latestResult(pid);
  if (!rep) return h.send_json({ error: "Hãy audit trang trước khi dùng AI." }, 400);
  let ai: any;
  try {
    ai = await aiSuggest(cfg, rep);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
  await run("UPDATE seo_audit_results SET ai_json=? WHERE id=?", [JSON.stringify(ai), rep.result_id]);
  return h.send_json(ai);
}
