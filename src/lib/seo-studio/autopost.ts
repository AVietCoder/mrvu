// @ts-nocheck
/**
 * Autopost: AI viết bài chuẩn SEO từ từ khóa, gắn ảnh, đăng lên WordPress hoặc website riêng (Custom API).
 * Chuyển từ mrvu-seo-studio/autopost.py. Khác bản gốc vì chạy trên Vercel:
 *   - Viết bài là tác vụ nhiều bước (dàn ý → viết bài → đăng), mỗi bước một lần gọi;
 *     giao diện hỏi tiến độ như cũ (api/ap/job/<id>).
 *   - Lịch tự động không còn là luồng nền: pg_cron gọi /seo-studio/cron mỗi phút,
 *     mỗi lần chạy MỘT bước (schedulerTick). Có thêm trần "autopost_daily_max".
 *   - Thư viện ảnh nằm ở Supabase Storage (bucket seo-images) thay thư mục anh-thu-vien/.
 *   - Khóa Claude / Pexels lấy từ biến môi trường (không nhập trên giao diện nữa).
 */
import { SeoError, decrypt, encrypt, errText, extractJson, httpJson, loadConfig, mask, now, one, q, run, saveConfig, todayVN, vnNum } from "./core";
import { claude } from "./apis";
import { overBudget, settings } from "./costs";
import { advance, registerStep, startJob } from "./jobs";
import { unescapeHtml, urlParts } from "./web";
import { getSupabaseAdmin } from "@/lib/zalo/admin-client";

const BUCKET = "seo-images";
export const STATUS_VI: Record<string, string> = { pending: "Chờ viết", writing: "Đang viết", written: "Đã viết (chưa đăng)", published: "Đã đăng", error: "Lỗi" };

export async function log(siteId: any, level: string, msg: string) {
  await run("INSERT INTO seo_ap_logs(at, site_id, level, message) VALUES (?,?,?,?)", [now(), siteId, level, msg]);
  await run("DELETE FROM seo_ap_logs WHERE id < (SELECT MAX(id) - 2000 FROM seo_ap_logs)");
}

export function slugify(s: string): string {
  s = String(s ?? "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/\p{Mn}/gu, "");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

const ALLOWED = new Set(["p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "a", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "br", "figure", "figcaption", "img"]);

export function sanitize(html: string): string {
  html = String(html || "").replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "<h2>$1</h2>");
  html = html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_m, closing, nameRaw, attrs) => {
    const name = nameRaw.toLowerCase();
    if (!ALLOWED.has(name)) return "";
    if (closing) return `</${name}>`;
    const keep: string[] = [];
    for (const [, anRaw, av] of String(attrs || "").matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      const an = anRaw.toLowerCase();
      if (name === "a" && (an === "href" || an === "title") && (an !== "href" || /^(https?:\/\/|\/)/.test(av))) keep.push(`${an}="${av}"`);
      else if (name === "img" && ["src", "alt", "width", "height", "loading"].includes(an)) keep.push(`${an}="${av}"`);
    }
    return `<${name}${keep.length ? " " + keep.join(" ") : ""}>`;
  });
  return html.trim();
}

function variablesText(cfg: any) {
  return (cfg.ap_variables || []).filter((v: any) => v.name && v.value).map((v: any) => `- ${v.name}: ${v.value}`).join("\n");
}
function applyVars(text: string, cfg: any) {
  for (const v of cfg.ap_variables || []) if (v.name) text = text.split("{" + v.name + "}").join(v.value || "");
  return text;
}

async function linkCandidates(site: any) {
  let host = urlParts(site.url).netloc.toLowerCase().split(":")[0];
  if (host.startsWith("www.")) host = host.slice(4);
  const out: string[] = [];
  const rows = await q(
    `SELECT p.url, p.type FROM seo_audit_pages p JOIN seo_audit_sites s ON s.id=p.site_id
     WHERE s.domain=? AND p.type IN ('post','product','category') ORDER BY p.id DESC LIMIT 120`, [host]);
  out.push(...rows.map((r: any) => r.url));
  const rows2 = await q("SELECT remote_url, title FROM seo_ap_posts WHERE site_id=? AND remote_url LIKE 'http%' ORDER BY id DESC LIMIT 60", [site.id]);
  out.push(...rows2.map((r: any) => r.remote_url));
  return [...new Set(out)].slice(0, 150);
}

/** Định hướng từ mục Gợi ý chủ đề (topics.ts): từ khóa phụ, góc viết, bài trụ cột, trang cần gắn link. */
export function briefText(brief: any) {
  if (!brief) return "";
  const lines = ["Định hướng bài viết (từ phân tích chủ đề và đối thủ, hãy bám theo):"];
  if (brief.keywords?.length) lines.push("- Từ khóa phụ cần phủ tự nhiên trong bài (H2/H3, đoạn văn): " + brief.keywords.join("; "));
  if (brief.title) lines.push(`- Tiêu đề tham khảo: ${brief.title}`);
  if (brief.angle) lines.push(`- Góc viết: ${brief.angle}`);
  if (brief.type === "pillar") lines.push("- Đây là BÀI TRỤ CỘT: bao quát toàn bộ chủ đề, mỗi khía cạnh một H2, độ sâu cao hơn bình thường.");
  else if (brief.pillar) lines.push(`- Đây là bài vệ tinh của chủ đề trụ cột "${brief.pillar}": tập trung sâu một khía cạnh, không lan man.`);
  if (brief.competitors?.length) lines.push("- Đối thủ đã viết chủ đề này: " + brief.competitors.join(", ") + ". Bài phải đầy đủ, cụ thể và hữu ích hơn.");
  if (brief.link_target) lines.push(`- Bắt buộc có 1 link nội bộ tới trang: ${brief.link_target}`);
  return lines.join("\n");
}
const briefOf = (kw: any) => {
  try {
    return JSON.parse(kw?.brief_json || "null");
  } catch {
    return null;
  }
};

async function writePlan(site: any, keyword: string, cfg: any, brief: any = null) {
  const varsTxt = variablesText(cfg);
  const extra = applyVars(site.extra_prompt || "", cfg);
  const links = await linkCandidates(site);
  if (brief?.link_target && !links.includes(brief.link_target)) links.unshift(brief.link_target);
  const btxt = briefText(brief);
  const words = parseInt(site.word_target) || 1200;
  const planPrompt = `Bạn là biên tập viên SEO tiếng Việt. Lập kế hoạch một bài viết chuẩn SEO cho website ${site.url}.

Từ khóa chính: "${keyword}"
Độ dài mục tiêu: khoảng ${words} chữ.
Thông tin doanh nghiệp (dùng khi phù hợp, không bịa thêm):
${varsTxt || "- (không có)"}
${extra ? "Yêu cầu riêng của website: " + extra : ""}
${btxt}

Danh sách URL có sẵn trên website (chỉ được chọn link nội bộ từ danh sách này, đoán chủ đề qua đường dẫn):
${links.slice(0, 120).join("\n") || "(không có)"}

Xác định đúng ý định tìm kiếm của người dùng khi gõ từ khóa này. Chỉ trả về JSON hợp lệ:
{
  "title": "tiêu đề bài (H1), 50-65 ký tự, chứa từ khóa chính ở đầu, hấp dẫn",
  "meta_title": "title SEO 50-60 ký tự",
  "meta_description": "120-155 ký tự, chứa từ khóa, có lời kêu gọi",
  "slug": "duong-dan-khong-dau-ngan-gon-chua-tu-khoa",
  "excerpt": "tóm tắt 1-2 câu",
  "search_intent": "người tìm cần gì",
  "outline": ["H2: ...", "H3: ...", "H2: Câu hỏi thường gặp"],
  "tags": ["3-6 thẻ"],
  "image_queries": ["2-3 cụm từ TIẾNG ANH để tìm ảnh minh họa phù hợp"],
  "image_alts": ["alt tiếng Việt tương ứng cho từng ảnh, có từ khóa khi tự nhiên"],
  "internal_links": [{"url": "URL lấy từ danh sách", "anchor": "chữ neo tự nhiên"}]
}
Chọn 2-4 link nội bộ thật sự liên quan; nếu danh sách trống thì để mảng rỗng.`;
  const [planTxt, u1] = await claude(cfg, planPrompt, 5000, null, "autopost_write");
  const plan = extractJson(planTxt, "AI trả về dàn ý không đúng định dạng, hãy thử lại.");
  const allowed = new Set(links);
  plan.internal_links = (plan.internal_links || []).filter((l: any) => allowed.has(l?.url)).slice(0, 4);
  return { plan, u1 };
}

async function writeBody(site: any, keyword: string, cfg: any, plan: any, u1: any, brief: any = null) {
  const btxt = briefText(brief);
  const varsTxt = variablesText(cfg);
  const extra = applyVars(site.extra_prompt || "", cfg);
  const words = parseInt(site.word_target) || 1200;
  const linkTxt = plan.internal_links.map((l: any) => `- <a href="${l.url}">${l.anchor}</a>`).join("\n");
  const articlePrompt = `Viết bài chuẩn SEO tiếng Việt theo kế hoạch sau.

Từ khóa chính: "${keyword}"
Tiêu đề (H1, KHÔNG viết lại trong bài): ${plan.title}
Ý định tìm kiếm: ${plan.search_intent || ""}
Dàn ý:
${(plan.outline || []).join("\n")}
Độ dài: khoảng ${words} chữ.
Thông tin doanh nghiệp (chỉ dùng thông tin có ở đây, không bịa giá, thông số, số điện thoại):
${varsTxt || "- (không có)"}
${extra ? "Yêu cầu riêng: " + extra : ""}
${btxt}
Chèn tự nhiên các liên kết nội bộ sau vào thân bài (giữ nguyên href):
${linkTxt || "(không có)"}

Quy tắc:
- Mở bài 2-3 câu, nhắc từ khóa chính trong 100 chữ đầu, trả lời ngay điều người đọc cần.
- Dùng <h2>, <h3> theo dàn ý; đoạn văn ngắn 2-4 câu; dùng <ul>/<ol> hoặc <table> khi so sánh, liệt kê.
- Từ khóa chính xuất hiện tự nhiên (mật độ 0,8-1,5%), dùng thêm biến thể và từ đồng nghĩa.
- Viết như chuyên gia có kinh nghiệm thực tế, cụ thể, hữu ích; tránh câu sáo rỗng, tránh nhồi từ khóa.
- Có mục "Câu hỏi thường gặp" với 3-5 câu hỏi dạng <h3>.
- Kết bài có lời kêu gọi hành động dùng thông tin doanh nghiệp nếu có.
- Chỉ dùng các thẻ: p, h2, h3, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td, blockquote. Không có H1, không CSS, không markdown.
Chỉ trả về HTML của thân bài, đặt giữa <article> và </article>.`;
  const [htmlTxt, u2, stop] = await claude(cfg, articlePrompt, 12000, null, "autopost_write");
  const m = /<article[^>]*>([\s\S]*)<\/article>/i.exec(htmlTxt);
  let body = m ? m[1] : htmlTxt;
  body = body.trim().replace(/^```html|```$/gi, "");
  if (stop === "max_tokens") body += "\n<p></p>";
  const html = sanitize(body);
  if (html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length < 150) throw new SeoError("AI trả về bài quá ngắn, hãy thử lại.");
  const usage = { input_tokens: (u1.input_tokens || 0) + (u2.input_tokens || 0), output_tokens: (u1.output_tokens || 0) + (u2.output_tokens || 0) };
  return {
    keyword, title: plan.title || keyword, slug: slugify(plan.slug || keyword), meta_title: plan.meta_title || plan.title,
    meta_description: plan.meta_description || "", excerpt: plan.excerpt || "", tags: plan.tags || [], html,
    image_queries: plan.image_queries?.length ? plan.image_queries : [keyword], image_alts: plan.image_alts || [],
    internal_links: plan.internal_links, usage,
  };
}

// ================================================================ Ảnh
async function libraryImages(keyword: string, n: number) {
  const files = await q("SELECT * FROM seo_ap_library ORDER BY id");
  if (!files.length) throw new SeoError("Thư viện ảnh đang trống. Vào Autopost → Cài đặt AI & biến để tải ảnh lên (đặt tên file không dấu theo nội dung ảnh).");
  const kw = new Set(slugify(keyword).split("-"));
  const stem = (f: any) => f.name.replace(/\.[^.]+$/, "");
  const scored = files.map((f: any) => ({ f, s: -slugify(stem(f)).split("-").filter((t: string) => kw.has(t)).length, r: Math.random() }));
  scored.sort((a: any, b: any) => a.s - b.s || a.r - b.r);
  const sb = getSupabaseAdmin();
  const out: any[] = [];
  for (const { f } of scored.slice(0, n)) {
    const { data, error } = await sb.storage.from(BUCKET).download(f.path);
    if (error) throw new SeoError(`Không đọc được ảnh ${f.name} trong thư viện: ${error.message}`);
    const ext = (f.name.match(/\.[^.]+$/) || [".jpg"])[0].toLowerCase();
    out.push({ bytes: Buffer.from(await data.arrayBuffer()), filename: slugify(keyword) + "-" + slugify(stem(f)).slice(0, 30) + ext, mime: f.mime || "image/jpeg", credit: "" });
  }
  return out;
}

async function pexelsImages(cfg: any, queries: string[], n: number) {
  const key = String(cfg.pexels_api_key || "").trim();
  if (!key) throw new SeoError("Chưa có khóa Pexels API. Đặt PEXELS_API_KEY trong biến môi trường (miễn phí tại pexels.com/api).");
  const out: any[] = [];
  const seen = new Set();
  const qs = (queries || []).slice(0, 3);
  for (const qq of [...qs, ...qs]) {
    if (out.length >= n) break;
    const [st, data] = await httpJson("https://api.pexels.com/v1/search?" + new URLSearchParams({ query: qq, per_page: "8", orientation: "landscape" }), "GET", undefined, { Authorization: key }, 30);
    if (st !== 200) throw new SeoError(`Pexels lỗi ${st}: ${errText(data)}`);
    for (const ph of data.photos || []) {
      if (seen.has(ph.id)) continue;
      seen.add(ph.id);
      const r = await fetch(ph.src.large, { headers: { "User-Agent": "MrVuSEOStudio-Autopost/1.0" }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new SeoError(`Tải ảnh Pexels lỗi ${r.status}`);
      out.push({ bytes: Buffer.from(await r.arrayBuffer()), filename: `${slugify(qq)}-${ph.id}.jpg`, mime: "image/jpeg", credit: `Ảnh: ${ph.photographer || ""} / Pexels` });
      break;
    }
  }
  return out.slice(0, n);
}

async function getImages(site: any, art: any, cfg: any) {
  const n = parseInt(site.images_per_post) || 0;
  const mode = site.image_mode || "none";
  if (mode === "none" || n <= 0) return [];
  const imgs = mode === "library" ? await libraryImages(art.keyword, n) : await pexelsImages(cfg, art.image_queries, n);
  const alts = art.image_alts || [];
  imgs.forEach((im: any, i: number) => (im.alt = i < alts.length ? alts[i] : `${art.keyword} - ảnh ${i + 1}`));
  return imgs;
}

/** Chèn ảnh (đã có url) sau H2 thứ 1, 3, 5…; ảnh đầu dùng làm ảnh đại diện nên bỏ qua. */
function insertImages(html: string, imgs: any[]) {
  const bodyImgs = imgs.length > 1 ? imgs.slice(1) : [];
  const parts = html.split(/(<\/h2>)/i);
  const out: string[] = [];
  let h2 = 0;
  for (const part of parts) {
    out.push(part);
    if (part.toLowerCase() === "</h2>") {
      h2++;
      if (bodyImgs.length && h2 % 2 === 1) {
        const im = bodyImgs.shift();
        out.push(`<figure><img src="${im.url}" alt="${im.alt}" loading="lazy"><figcaption>${im.alt}</figcaption></figure>`);
      }
    }
  }
  return out.join("");
}

// ================================================================ Đăng bài
const wpBase = (site: any) => site.url.replace(/\/+$/, "") + "/wp-json/wp/v2";
const wpAuth = (site: any) => ({ Authorization: "Basic " + Buffer.from(`${site.username}:${site.secret}`).toString("base64") });

async function wpTest(site: any) {
  let [st, me] = await httpJson(wpBase(site) + "/users/me?context=edit", "GET", undefined, wpAuth(site), 30);
  if (st === 404) throw new SeoError("Không tìm thấy WordPress REST API (/wp-json). Kiểm tra lại địa chỉ, hoặc website đang tắt REST API.");
  if (st === 401 || st === 403) throw new SeoError("Sai tên đăng nhập hoặc Application Password, hoặc tài khoản không có quyền viết bài.");
  if (st !== 200) throw new SeoError(`WordPress trả lỗi ${st}: ${errText(me)}`);
  const [, cats] = await httpJson(wpBase(site) + "/categories?per_page=100&_fields=id,name,count", "GET", undefined, wpAuth(site), 30);
  return { user: me.name, roles: me.roles, categories: (Array.isArray(cats) ? cats : []).map((c: any) => ({ id: c.id, name: unescapeHtml(c.name || "") })) };
}

async function wpTagIds(site: any, tags: string[]) {
  const ids: number[] = [];
  for (const t of (tags || []).slice(0, 6)) {
    const [, found] = await httpJson(wpBase(site) + "/tags?" + new URLSearchParams({ search: t, _fields: "id,name" }), "GET", undefined, wpAuth(site));
    const hit = (Array.isArray(found) ? found : []).find((x: any) => String(x.name).toLowerCase() === t.toLowerCase());
    if (hit) {
      ids.push(hit.id);
      continue;
    }
    const [st, nw] = await httpJson(wpBase(site) + "/tags", "POST", { name: t }, wpAuth(site));
    if (st === 200 || st === 201) ids.push(nw.id);
    else if (nw && typeof nw === "object" && nw.data?.term_id) ids.push(nw.data.term_id);
  }
  return ids;
}

async function wpUpload(site: any, im: any) {
  const h = { ...wpAuth(site), "Content-Type": im.mime, "Content-Disposition": `attachment; filename="${im.filename}"` };
  const [st, media] = await httpJson(wpBase(site) + "/media", "POST", undefined, h, 120, im.bytes);
  if (st !== 200 && st !== 201) throw new SeoError(`Tải ảnh lên WordPress lỗi ${st}: ${errText(media)}`);
  await httpJson(wpBase(site) + `/media/${media.id}`, "POST", { alt_text: im.alt, caption: im.credit || "" }, wpAuth(site));
  return [media.id, media.source_url];
}

async function publishWordpress(site: any, post: any, imgs: any[]) {
  let featured = null;
  for (const im of imgs) {
    const [mid, url] = await wpUpload(site, im);
    im.url = url;
    im.media_id = mid;
    featured = featured || mid;
  }
  const html = insertImages(post.html, imgs);
  const data: any = { title: post.title, content: html, status: site.post_status || "draft", slug: post.slug, excerpt: post.excerpt };
  if (site.category_id) data.categories = [parseInt(site.category_id)];
  if (featured) data.featured_media = featured;
  try {
    const tagIds = await wpTagIds(site, post.tags);
    if (tagIds.length) data.tags = tagIds;
  } catch {}
  const sp = site.seo_plugin || "none";
  if (sp === "yoast") data.meta = { _yoast_wpseo_title: post.meta_title, _yoast_wpseo_metadesc: post.meta_description, _yoast_wpseo_focuskw: post.keyword };
  else if (sp === "rankmath") data.meta = { rank_math_title: post.meta_title, rank_math_description: post.meta_description, rank_math_focus_keyword: post.keyword };
  let [st, res] = await httpJson(wpBase(site) + "/posts", "POST", data, wpAuth(site), 120);
  if (st !== 200 && st !== 201 && "meta" in data) {
    delete data.meta;
    [st, res] = await httpJson(wpBase(site) + "/posts", "POST", data, wpAuth(site), 120);
    await log(site.id, "warn", "WordPress không nhận meta SEO; hãy cài file mrvu-seo-studio-seo-meta.php (xem hướng dẫn).");
  }
  if (st !== 200 && st !== 201) throw new SeoError(`Đăng bài lên WordPress lỗi ${st}: ${errText(res)}`);
  return [String(res.id), res.link, res.status, html];
}

async function publishCustom(site: any, post: any, imgs: any[]) {
  const html = post.html;
  const payload = {
    title: post.title, slug: post.slug, content_html: html, excerpt: post.excerpt, meta_title: post.meta_title, meta_description: post.meta_description,
    keyword: post.keyword, tags: post.tags, status: site.post_status || "draft", category: site.category_name || "",
    images: imgs.map((im) => ({ filename: im.filename, mime: im.mime, alt: im.alt, credit: im.credit || "", base64: Buffer.from(im.bytes).toString("base64") })),
  };
  const headers = site.secret ? { Authorization: "Bearer " + site.secret } : {};
  const [st, res0] = await httpJson(site.url, "POST", payload, headers, 180);
  if (st !== 200 && st !== 201) throw new SeoError(`Website trả lỗi ${st}: ${errText(res0)}`);
  const res = res0 && typeof res0 === "object" ? res0 : {};
  return [String(res.id ?? ""), res.url || res.link, res.status ?? payload.status, html];
}

// ================================================================ Quy trình
// Mật khẩu WordPress / token Custom API lưu MÃ HÓA (bản gốc lưu thô trong SQLite).
// Không giải mã được (SEO_SECRET_KEY đã đổi) → coi như chưa có mật khẩu, không làm hỏng cả danh sách.
const SECRET_LOST = "⚠ khoá mã hoá đã đổi, cần nhập lại…";
const openSecret = (v: any) => {
  if (!(v && String(v).startsWith("v1:"))) return v;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
};
const sealSecret = (v: any) => (v ? encrypt(String(v)) : v);
async function getSite(sid: any) {
  const s = await one("SELECT * FROM seo_ap_sites WHERE id=?", [sid]);
  if (s) s.secret = openSecret(s.secret);
  return s;
}
async function setKw(kid: any, status: string, postId: any = null, error: any = null) {
  await run("UPDATE seo_ap_keywords SET status=?, post_id=COALESCE(?, post_id), error=?, updated_at=? WHERE id=?", [status, postId, error, now(), kid]);
}

async function doPublish(site: any, postId: any, cfg: any, progress = (m: string) => {}) {
  const post = await one("SELECT * FROM seo_ap_posts WHERE id=?", [postId]);
  post.tags = JSON.parse(post.tags_json || "[]");
  const meta = JSON.parse(post.images_json || "{}");
  const art = { keyword: post.keyword, image_queries: meta.queries?.length ? meta.queries : [post.keyword], image_alts: meta.alts || [] };
  progress("Đang lấy ảnh…");
  const imgs = await getImages(site, art, cfg);
  progress("Đang đăng lên website…");
  const fn = site.kind === "wordpress" ? publishWordpress : publishCustom;
  const [rid, url, rstatus, html] = await fn(site, post, imgs);
  await run("UPDATE seo_ap_posts SET status='published', remote_id=?, remote_url=?, remote_status=?, html=?, published_at=? WHERE id=?", [rid, url, rstatus, html, now(), postId]);
  if (post.keyword_id) await setKw(post.keyword_id, "published", postId);
  await log(site.id, "ok", `Đã đăng "${post.title}" (${rstatus === "draft" ? "nháp" : rstatus}) ${url || ""}`);
  return url;
}

// Viết bài = 3 bước (mỗi lần giao diện hỏi tiến độ / mỗi phút cron chạy một bước)
registerStep("ap_write", async (job, ctx) => {
  const st = job.state;
  const cfg = await loadConfig();
  const kw = await one("SELECT * FROM seo_ap_keywords WHERE id=?", [st.kid]);
  if (!kw) throw new SeoError("Từ khóa đã bị xóa.");
  const site = await getSite(kw.site_id);
  if (!site) throw new SeoError("Website đã bị xóa.");
  try {
    if (st.step === "plan") {
      await setKw(st.kid, "writing");
      const { plan, u1 } = await writePlan(site, kw.keyword, cfg, briefOf(kw));
      st.plan = plan;
      st.u1 = u1;
      st.step = "article";
      ctx.progress("AI đang viết bài…");
      return;
    }
    if (st.step === "article") {
      const art = await writeBody(site, kw.keyword, cfg, st.plan, st.u1, briefOf(kw));
      const ins = await run(
        `INSERT INTO seo_ap_posts(site_id, keyword_id, keyword, title, slug, meta_title, meta_description, excerpt,
         tags_json, html, images_json, status, usage_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        [site.id, st.kid, kw.keyword, art.title, art.slug, art.meta_title, art.meta_description, art.excerpt, JSON.stringify(art.tags), art.html,
          JSON.stringify({ queries: art.image_queries, alts: art.image_alts, links: art.internal_links }), "local", JSON.stringify(art.usage), now()]);
      const pid = ins.rows[0].id;
      await setKw(st.kid, "written", pid);
      await log(site.id, "ok", `AI đã viết "${art.title}" (${vnNum(art.usage.input_tokens)} + ${vnNum(art.usage.output_tokens)} token)`);
      st.pid = pid;
      delete st.plan;
      if (!st.publish) return { done: pid };
      st.step = "publish";
      ctx.progress("Đang lấy ảnh…");
      return;
    }
    if (st.step === "publish") {
      await doPublish(site, st.pid, cfg, ctx.progress);
      return { done: st.pid };
    }
    throw new SeoError("Trạng thái viết bài không hợp lệ");
  } catch (e: any) {
    await setKw(st.kid, "error", null, String(e?.message || e));
    await log(site.id, "error", `Từ khóa "${kw.keyword}": ${e?.message || e}`);
    throw e;
  }
});

registerStep("ap_publish", async (job, ctx) => {
  const st = job.state;
  const site = await getSite(st.site_id);
  try {
    return { done: await doPublish(site, st.pid, await loadConfig(), ctx.progress) };
  } catch (e: any) {
    await log(site?.id, "error", `Đăng bài #${st.pid} lỗi: ${e?.message || e}`);
    throw e;
  }
});

async function writingJob(kid: any) {
  return await one(
    "SELECT id FROM seo_jobs WHERE kind='ap_write' AND status='running' AND (state->>'kid')::bigint=? AND updated_at > now() - interval '30 minutes' LIMIT 1", [kid]);
}

/**
 * Một lần chạy của lịch tự động (bản gốc là một vòng lặp của scheduler_loop, mỗi phút).
 * Mỗi lần chỉ chạy MỘT bước để không vượt thời gian của Vercel:
 *   1. Có bài đang viết dở (của lịch, hoặc người dùng đã đóng trang) → chạy tiếp một bước.
 *   2. Không có → chọn website đến lượt và bắt đầu bài mới.
 */
export async function schedulerTick() {
  // Từ khóa kẹt ở "Đang viết" quá 30 phút mà không còn tác vụ nào → báo lỗi để viết lại.
  await run(`UPDATE seo_ap_keywords k SET status='error', error='Bị gián đoạn khi đang viết, hãy bấm viết lại.', updated_at=?
             WHERE status='writing' AND NOT EXISTS (SELECT 1 FROM seo_jobs j WHERE j.kind='ap_write' AND j.status='running'
               AND (j.state->>'kid')::bigint=k.id AND j.updated_at > now() - interval '30 minutes')`, [now()]);

  const pending = await one(
    `SELECT id FROM seo_jobs WHERE kind IN ('ap_write','ap_publish') AND status='running'
       AND (locked_until IS NULL OR locked_until < now()) AND (auto OR updated_at < now() - interval '2 minutes')
     ORDER BY created_at LIMIT 1`);
  if (pending) {
    const r = await advance(pending.id);
    return { advanced: pending.id, status: r.status, message: r.message };
  }
  if (await one("SELECT 1 FROM seo_jobs WHERE kind='ap_write' AND status='running' AND updated_at > now() - interval '30 minutes' LIMIT 1")) {
    return { skipped: "đang có bài khác được viết" };
  }

  let sites = await q("SELECT * FROM seo_ap_sites WHERE auto_enabled=1");
  if (!sites.length) return { skipped: "không có website bật lịch" };
  const [s] = await settings();
  const day = todayVN();
  if ((await overBudget()) && s.auto_stop !== false) {
    const cfg = await loadConfig();
    if (cfg.ap_budget_warned !== day) {
      await saveConfig({ ap_budget_warned: day });
      for (const x of sites) await log(x.id, "warn", "Đã vượt ngân sách tháng: lịch tự động tạm dừng. Tăng ngân sách hoặc tắt “tự dừng” trong Cài đặt chi phí để chạy tiếp.");
    }
    return { skipped: "vượt ngân sách" };
  }
  const autoToday = (await one("SELECT COUNT(*) n FROM seo_jobs WHERE kind='ap_write' AND auto AND created_at >= (?::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')", [day])).n;
  if (autoToday >= (parseInt(s.autopost_daily_max) || 10)) return { skipped: `đã đủ ${autoToday} bài tự động hôm nay (giới hạn trong Cài đặt chi phí)` };

  const hour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  for (const x of sites) {
    if (!(parseInt(x.hour_from) <= hour && hour < parseInt(x.hour_to))) continue;
    const done = (await one("SELECT COUNT(*) n FROM seo_ap_posts WHERE site_id=? AND substr(created_at,1,10)=?", [x.id, day])).n;
    const last = (await one("SELECT MAX(created_at) m FROM seo_ap_posts WHERE site_id=?", [x.id])).m;
    const nxt = await one("SELECT id FROM seo_ap_keywords WHERE site_id=? AND status='pending' ORDER BY id LIMIT 1", [x.id]);
    if (done >= parseInt(x.per_day) || !nxt) continue;
    const windowMin = (parseInt(x.hour_to) - parseInt(x.hour_from)) * 60;
    const gap = Math.max(20, Math.floor(windowMin / Math.max(1, parseInt(x.per_day))));
    if (last && Date.parse(last) > Date.now() - gap * 60_000) continue;
    await log(x.id, "info", "Lịch tự động: bắt đầu viết bài tiếp theo");
    const jid = await startJob("ap_write", { kid: nxt.id, publish: true, step: "plan" }, "AI đang lập dàn ý…", {}, true);
    const r = await advance(jid);
    return { started: jid, site_id: x.id, status: r.status, message: r.message };
  }
  return { skipped: "chưa đến lượt website nào" };
}

// ================================================================ Thư viện ảnh (Supabase Storage)
async function libraryList() {
  const rows = await q("SELECT * FROM seo_ap_library ORDER BY id DESC");
  if (!rows.length) return [];
  const sb = getSupabaseAdmin();
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r: any) => r.path), 3600);
  const urls = new Map((data || []).map((d: any) => [d.path, d.signedUrl]));
  return rows.map((r: any) => ({ id: r.id, name: r.name, size: r.size, url: urls.get(r.path) || null }));
}

// ================================================================ API cho giao diện
const SITE_FIELDS = ["name", "kind", "url", "username", "secret", "category_id", "category_name", "post_status", "seo_plugin",
  "image_mode", "images_per_post", "word_target", "extra_prompt", "auto_enabled", "per_day", "hour_from", "hour_to"];
const INT_FIELDS = new Set(["category_id", "images_per_post", "word_target", "auto_enabled", "per_day", "hour_from", "hour_to"]);
const fieldVal = (b: any, f: string) => {
  const v = b[f];
  if (INT_FIELDS.has(f)) {
    if (v === "" || v === null || v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = parseInt(v);
    return Number.isNaN(n) ? null : n;
  }
  return v === undefined ? null : v;
};
const sitePublic = (s: any) => {
  const plain = openSecret(s.secret);
  return { ...s, secret: s.secret && plain === null ? SECRET_LOST : mask(plain) };
};

export async function handle(h: any, method: string, path: string) {
  const qs = h.query;
  const seg = path.split("/").slice(3); // /api/ap/<seg...>
  const is = (...xs: string[]) => seg.length === xs.length && xs.every((x, i) => x === "*" || seg[i] === x);
  try {
    if (method === "GET" && is("sites")) {
      const rows = await q(`SELECT s.*, (SELECT COUNT(*) FROM seo_ap_keywords k WHERE k.site_id=s.id AND k.status='pending') pending,
        (SELECT COUNT(*) FROM seo_ap_posts p WHERE p.site_id=s.id AND p.status='published') published
        FROM seo_ap_sites s ORDER BY s.id DESC`);
      return h.send_json({ items: rows.map(sitePublic) });
    }
    if (method === "POST" && is("sites")) {
      const b = await h.read_json();
      const url = String(b.url || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//.test(url)) return h.send_json({ error: "Địa chỉ phải bắt đầu bằng https:// (với Custom API là địa chỉ nhận bài đầy đủ)." }, 400);
      b.url = url;
      if (!b.name) b.name = urlParts(url).netloc;
      let sid;
      if (b.id) {
        const old = await one("SELECT secret FROM seo_ap_sites WHERE id=?", [b.id]);
        if (!b.secret || String(b.secret).includes("…") || b.secret === "đã nhập") b.secret = old?.secret;
        else b.secret = sealSecret(b.secret);
        await run(`UPDATE seo_ap_sites SET ${SITE_FIELDS.map((f) => `${f}=?`).join(", ")} WHERE id=?`, [...SITE_FIELDS.map((f) => fieldVal(b, f)), b.id]);
        sid = b.id;
      } else {
        b.secret = sealSecret(b.secret);
        const ins = await run(`INSERT INTO seo_ap_sites(${SITE_FIELDS.join(", ")}, created_at) VALUES (${SITE_FIELDS.map(() => "?").join(", ")}, ?) RETURNING id`,
          [...SITE_FIELDS.map((f) => fieldVal(b, f)), now()]);
        sid = ins.rows[0].id;
      }
      await log(sid, "info", `Đã lưu cấu hình website ${b.name}`);
      return h.send_json(sitePublic(await getSite(sid)));
    }
    if (method === "POST" && is("sites", "*", "test")) {
      const b = await h.read_json();
      const site: any = { ...((seg[1] !== "new" ? await getSite(parseInt(seg[1])) : null) || {}) };
      for (const k of ["kind", "url", "username"]) if (b[k]) site[k] = k === "url" ? String(b[k]).replace(/\/+$/, "") : b[k];
      if (b.secret && !String(b.secret).includes("…") && b.secret !== "đã nhập") site.secret = b.secret;
      if (site.kind === "custom") {
        const headers = site.secret ? { Authorization: "Bearer " + site.secret } : {};
        const [st, res] = await httpJson(site.url, "POST", { test: true }, headers, 30);
        if (st !== 200 && st !== 201) throw new SeoError(`Địa chỉ nhận bài trả lỗi ${st}: ${errText(res)}`);
        return h.send_json({ user: "Custom API", categories: [] });
      }
      return h.send_json(await wpTest(site));
    }
    if (method === "DELETE" && is("sites", "*")) {
      await run("DELETE FROM seo_ap_keywords WHERE site_id=?", [seg[1]]);
      await run("DELETE FROM seo_ap_sites WHERE id=?", [seg[1]]);
      return h.send_json({ ok: true });
    }

    if (method === "GET" && is("keywords")) {
      const sid = qs.get("site_id") || "0";
      const rows = await q(`SELECT k.*, p.title post_title, p.remote_url FROM seo_ap_keywords k
        LEFT JOIN seo_ap_posts p ON p.id=k.post_id WHERE k.site_id=? ORDER BY k.id`, [sid]);
      return h.send_json({ items: rows });
    }
    if (method === "POST" && is("keywords")) {
      const b = await h.read_json();
      let added = 0;
      for (const k0 of b.keywords || []) {
        const k = String(k0).split(/\s+/).filter(Boolean).join(" ").trim();
        if (k) added += (await run("INSERT INTO seo_ap_keywords(site_id, keyword, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT (site_id, keyword) DO NOTHING", [b.site_id, k, now(), now()])).count;
      }
      return h.send_json({ added });
    }
    if (method === "POST" && is("keywords", "*", "reset")) {
      await setKw(parseInt(seg[1]), "pending");
      return h.send_json({ ok: true });
    }
    if (method === "DELETE" && is("keywords", "*")) {
      await run("DELETE FROM seo_ap_keywords WHERE id=?", [seg[1]]);
      return h.send_json({ ok: true });
    }

    if (method === "POST" && is("write")) {
      const b = await h.read_json();
      const kid = parseInt(b.keyword_id);
      if (await writingJob(kid)) return h.send_json({ error: "Từ khóa này đang được viết." }, 409);
      const jid = await startJob("ap_write", { kid, publish: Boolean(b.publish), step: "plan" }, "AI đang lập dàn ý…");
      return h.send_json({ job_id: jid });
    }
    if (method === "GET" && is("job", "*")) return h.send_json(await advance(seg[1]));

    if (method === "GET" && is("posts")) {
      const sid = qs.get("site_id") || "";
      const sql = `SELECT p.id, p.site_id, p.keyword, p.title, p.status, p.remote_url, p.remote_status, p.created_at,
                   p.published_at, s.name site_name FROM seo_ap_posts p LEFT JOIN seo_ap_sites s ON s.id=p.site_id`;
      const rows = await q(sql + (sid ? " WHERE p.site_id=?" : "") + " ORDER BY p.id DESC LIMIT 300", sid ? [sid] : []);
      return h.send_json({ items: rows });
    }
    if (method === "GET" && is("posts", "*")) {
      const r = await one("SELECT * FROM seo_ap_posts WHERE id=?", [seg[1]]);
      if (!r) return h.send_json({ error: "Không tìm thấy bài" }, 404);
      const d: any = { ...r };
      d.tags = JSON.parse(d.tags_json || "[]");
      delete d.tags_json;
      d.extra = JSON.parse(d.images_json || "{}");
      delete d.images_json;
      d.usage = JSON.parse(d.usage_json || "{}");
      delete d.usage_json;
      return h.send_json(d);
    }
    if (method === "POST" && is("posts", "*", "publish")) {
      const r = await one("SELECT site_id FROM seo_ap_posts WHERE id=?", [seg[1]]);
      const site = r ? await getSite(r.site_id) : null;
      if (!site) return h.send_json({ error: "Không tìm thấy bài hoặc website" }, 404);
      const jid = await startJob("ap_publish", { pid: parseInt(seg[1]), site_id: site.id }, "Đang lấy ảnh…");
      return h.send_json({ job_id: jid });
    }
    if (method === "POST" && is("posts", "*")) {
      const b = await h.read_json();
      await run("UPDATE seo_ap_posts SET title=?, meta_title=?, meta_description=?, slug=?, html=? WHERE id=?",
        [b.title, b.meta_title, b.meta_description, slugify(b.slug), sanitize(b.html), seg[1]]);
      return h.send_json({ ok: true });
    }
    if (method === "DELETE" && is("posts", "*")) {
      await run("UPDATE seo_ap_keywords SET status='pending', post_id=NULL WHERE post_id=? AND status='written'", [seg[1]]);
      await run("DELETE FROM seo_ap_posts WHERE id=?", [seg[1]]);
      return h.send_json({ ok: true });
    }

    if (method === "GET" && is("settings")) {
      const cfg = await loadConfig();
      const nlib = (await one("SELECT COUNT(*) n FROM seo_ap_library")).n;
      return h.send_json({
        anthropic_api_key: mask(cfg.anthropic_api_key), anthropic_model: cfg.anthropic_model, pexels_api_key: mask(cfg.pexels_api_key),
        ap_variables: cfg.ap_variables || [], library_count: nlib, library_path: "Kho ảnh SEO Studio (Supabase Storage)",
        keys_from_env: true, model_from_env: Boolean(process.env.SEO_ANTHROPIC_MODEL),
      });
    }
    if (method === "POST" && is("settings")) {
      const b = await h.read_json();
      const up: any = { ap_variables: (b.ap_variables || []).filter((v: any) => v.name) };
      if (b.anthropic_model) up.anthropic_model = String(b.anthropic_model).trim();
      // Khóa Claude / Pexels đặt trong biến môi trường, không lưu từ giao diện.
      await saveConfig(up);
      return h.send_json({ ok: true });
    }
    if (method === "GET" && is("library")) return h.send_json({ items: await libraryList() });
    if (method === "POST" && is("library")) {
      const b = await h.read_json();
      const name = String(b.name || "").trim();
      const ext = (name.match(/\.(jpe?g|png|webp)$/i) || [])[0];
      if (!ext) return h.send_json({ error: "Chỉ nhận ảnh .jpg, .jpeg, .png, .webp" }, 400);
      const bytes = Buffer.from(String(b.base64 || ""), "base64");
      if (!bytes.length) return h.send_json({ error: "File rỗng" }, 400);
      if (bytes.length > 3_500_000) return h.send_json({ error: "Ảnh tối đa 3,5 MB (hãy nén ảnh trước khi tải lên)." }, 400);
      const mime = ext.toLowerCase() === ".png" ? "image/png" : ext.toLowerCase() === ".webp" ? "image/webp" : "image/jpeg";
      const path2 = `library/${Date.now()}-${slugify(name.replace(/\.[^.]+$/, "")).slice(0, 60) || "anh"}${ext.toLowerCase()}`;
      const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(path2, bytes, { contentType: mime, upsert: false });
      if (error) throw new SeoError(`Không lưu được ảnh: ${error.message}`);
      await run("INSERT INTO seo_ap_library(name, path, mime, size, created_at) VALUES (?,?,?,?,?)", [name, path2, mime, bytes.length, now()]);
      return h.send_json({ ok: true });
    }
    if (method === "DELETE" && is("library", "*")) {
      const r = await one("SELECT * FROM seo_ap_library WHERE id=?", [seg[1]]);
      if (r) {
        await getSupabaseAdmin().storage.from(BUCKET).remove([r.path]);
        await run("DELETE FROM seo_ap_library WHERE id=?", [seg[1]]);
      }
      return h.send_json({ ok: true });
    }
    if (method === "GET" && is("logs")) {
      const rows = await q(`SELECT l.*, s.name site_name FROM seo_ap_logs l LEFT JOIN seo_ap_sites s ON s.id=l.site_id ORDER BY l.id DESC LIMIT 300`);
      return h.send_json({ items: rows });
    }
    return h.send_json({ error: "Không có trang này" }, 404);
  } catch (e: any) {
    if (e instanceof SeoError) return h.send_json({ error: e.message }, 502);
    throw e;
  }
}
