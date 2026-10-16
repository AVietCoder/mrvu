// @ts-nocheck
/**
 * Lõi dùng chung của SEO Studio (bản chuyển từ thư mục mrvu-seo-studio/ — Python).
 *
 *  - SeoError       : tương đương RuntimeError của bản Python (thông báo tiếng Việt,
 *                     các module trả 502 / 400 giống bản gốc).
 *  - q / one / run  : chạy SQL viết gần NGUYÊN VĂN câu SQLite của bản gốc. Dấu ? được
 *                     đổi sang $1, $2…; tham số là mảng thì tự nở thành danh sách (IN).
 *                     Kết nối Postgres trực tiếp qua SEO_DATABASE_URL (Supabase pooler).
 *  - loadConfig / saveConfig : thay config.json. Khóa bí mật lấy từ biến môi trường,
 *                     phần còn lại (biến dùng chung, ngân sách, site Search Console…)
 *                     lưu ở bảng seo_config.
 */
import postgres from "postgres";
import { jsonrepair } from "jsonrepair";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class SeoError extends Error {}

// ---------------------------------------------------------------- thời gian
/** Giờ Việt Nam dạng ISO có múi giờ, giống datetime.now().astimezone().isoformat(timespec="seconds"). */
export function now(): string {
  const d = new Date(Date.now() + 7 * 3600_000);
  return d.toISOString().slice(0, 19) + "+07:00";
}
/** Giống datetime.now(timezone.utc).isoformat() (dùng ở Volume, Rank, Audit của bản gốc). */
export function nowUtc(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}
/** Ngày "YYYY-MM-DD" theo giờ Việt Nam. */
export function todayVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
export function hex(n: number): string {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

// ---------------------------------------------------------------- chuỗi
export function slugify(s: string): string {
  s = String(s ?? "").toLowerCase().replace(/đ/g, "d");
  s = s.normalize("NFD").replace(/\p{Mn}/gu, "");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/** " ".join(s.split()) của Python. */
export function squash(s: any): string {
  return String(s ?? "").split(/\s+/).filter(Boolean).join(" ");
}
/** Định dạng số kiểu f"{n:,}".replace(",", "."). */
export function vnNum(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, ".");
}
/**
 * Lấy đối tượng JSON trong văn bản AI trả về (bản gốc: re.search(r"\{.*\}", txt, re.S)).
 * Đọc thẳng không được thì sửa tự động (jsonrepair): bỏ ```json, dấu phẩy thừa, xuống dòng /
 * dấu nháy chưa thoát trong chuỗi, và JSON bị cắt giữa chừng (đóng ngoặc còn thiếu).
 */
export function extractJson(txt: string, msg = "AI trả về nội dung không đúng định dạng, hãy thử lại.") {
  const a = String(txt || "").indexOf("{");
  if (a < 0) throw new SeoError(msg);
  const b = txt.lastIndexOf("}");
  if (b > a) {
    try {
      return JSON.parse(txt.slice(a, b + 1));
    } catch {}
  }
  for (const part of [b > a ? txt.slice(a, b + 1) : null, txt.slice(a).replace(/```\s*$/, "")]) {
    if (!part) continue;
    try {
      const out = JSON.parse(jsonrepair(part));
      if (out && typeof out === "object" && !Array.isArray(out)) return out;
    } catch {}
  }
  console.error("[seo ai] JSON không đọc được:", txt.length, "ký tự, đuôi:", JSON.stringify(txt.slice(-200)));
  throw new SeoError(msg);
}
/** list(dict.fromkeys(xs)) */
export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
export function mask(v: any): string {
  v = String(v || "");
  return v.length > 12 ? v.slice(0, 6) + "…" + v.slice(-4) : v ? "đã nhập" : "";
}
/** Làm tròn kiểu Python (round half to even) để điểm số khớp bản gốc. */
export function pyRound(x: number, nd = 0): number {
  const m = 10 ** nd;
  const v = x * m;
  const f = Math.floor(v);
  const diff = v - f;
  let r: number;
  if (Math.abs(diff - 0.5) < 1e-9) r = f % 2 === 0 ? f : f + 1;
  else r = Math.round(v);
  return r / m;
}

// ---------------------------------------------------------------- CSDL
let _sql: any = null;
export function sql() {
  if (_sql) return _sql;
  const url = process.env.SEO_DATABASE_URL;
  if (!url) throw new SeoError("Chưa cấu hình SEO_DATABASE_URL (chuỗi kết nối Postgres của Supabase, xem .env.example).");
  _sql = postgres(url, {
    prepare: false, // Supabase pooler chế độ transaction không hỗ trợ prepared statement
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    // bigint / numeric trả về dạng số như SQLite (mặc định postgres.js trả chuỗi)
    types: {
      bigint: { to: 20, from: [20], serialize: (x: any) => String(x), parse: (x: any) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: any) => String(x), parse: (x: any) => Number(x) },
    },
  });
  return _sql;
}

function bind(text: string, args: any[] = []) {
  const out: any[] = [];
  let i = 0;
  const query = text.replace(/\?/g, () => {
    const v = args[i++];
    if (Array.isArray(v)) {
      if (!v.length) return "NULL";
      return v.map((x) => (out.push(x === undefined ? null : x), "$" + out.length)).join(",");
    }
    out.push(v === undefined ? null : v);
    return "$" + out.length;
  });
  return { query, params: out };
}
export async function q(text: string, args: any[] = [], tx?: any): Promise<any[]> {
  const { query, params } = bind(text, args);
  return await (tx || sql()).unsafe(query, params);
}
export async function one(text: string, args: any[] = [], tx?: any): Promise<any | null> {
  const rows = await q(text, args, tx);
  return rows[0] ?? null;
}
/** Chạy lệnh ghi; trả về số dòng bị ảnh hưởng (cur.rowcount) và dòng RETURNING nếu có. */
export async function run(text: string, args: any[] = [], tx?: any): Promise<{ count: number; rows: any[] }> {
  const { query, params } = bind(text, args);
  const res = await (tx || sql()).unsafe(query, params);
  return { count: res.count ?? 0, rows: [...res] };
}
export async function tx<T>(fn: (t: any) => Promise<T>): Promise<T> {
  return await sql().begin(fn);
}

// ---------------------------------------------------------------- mã hóa (khóa service account tải lên)
function aesKey() {
  const k = process.env.SEO_SECRET_KEY;
  if (!k) throw new SeoError("Chưa cấu hình SEO_SECRET_KEY (chuỗi ngẫu nhiên dài, xem .env.example).");
  return createHash("sha256").update(k).digest();
}
export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(blob: string): string {
  const raw = Buffer.from(String(blob).replace(/^v1:/, ""), "base64");
  const d = createDecipheriv("aes-256-gcm", aesKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- cấu hình (thay config.json)
const SECRET_KEYS = new Set(["login", "password", "anthropic_api_key", "pexels_api_key", "google_client_id", "google_client_secret"]);
const env = (k: string) => (process.env[k] || "").trim();

/**
 * Giống load_config() của bản Python: trả về một dict cấu hình. Khóa bí mật luôn lấy
 * từ biến môi trường; cấu hình còn lại đọc ở bảng seo_config.
 */
export async function loadConfig(): Promise<any> {
  let stored: any = {};
  try {
    const r = await one("SELECT value FROM seo_config WHERE key='config'");
    stored = r?.value || {};
  } catch (e: any) {
    if (e instanceof SeoError) throw e;
    if (/seo_config/.test(String(e?.message)) && /does not exist/.test(String(e?.message))) {
      throw new SeoError("Chưa chạy sql_migration_v25_seo_studio.sql trong Supabase.");
    }
    throw e;
  }
  const cfg: any = { usd_vnd: 26000, anthropic_model: "claude-sonnet-5-5", ...stored };
  cfg.login = env("DATAFORSEO_LOGIN");
  cfg.password = env("DATAFORSEO_PASSWORD");
  cfg.anthropic_api_key = env("ANTHROPIC_API_KEY");
  cfg.pexels_api_key = env("PEXELS_API_KEY");
  if (env("SEO_ANTHROPIC_MODEL")) cfg.anthropic_model = env("SEO_ANTHROPIC_MODEL");
  cfg.google_client_id = env("GOOGLE_OAUTH_CLIENT_ID");
  cfg.google_client_secret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  cfg.public_url = env("SEO_PUBLIC_URL").replace(/\/+$/, "");
  cfg.allowed_emails = env("SEO_ALLOWED_EMAILS").split(/[,;\s]+/).filter(Boolean);
  if (!cfg.gsc_site && env("SEO_GSC_SITE")) cfg.gsc_site = env("SEO_GSC_SITE");
  if (!cfg.ga_property && env("SEO_GA_PROPERTY")) cfg.ga_property = env("SEO_GA_PROPERTY");
  return cfg;
}

/** Giống autopost.save_config(updates): gộp vào cấu hình đã lưu. Không bao giờ lưu khóa bí mật. */
export async function saveConfig(updates: Record<string, any>) {
  const clean: any = {};
  for (const [k, v] of Object.entries(updates || {})) if (!SECRET_KEYS.has(k)) clean[k] = v;
  await run(
    "INSERT INTO seo_config(key, value, updated_at) VALUES ('config', ?::text::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = seo_config.value || EXCLUDED.value, updated_at = now()",
    [JSON.stringify(clean)],
  );
}

// ---------------------------------------------------------------- HTTP ra ngoài (http_json của autopost.py)
export async function httpJson(
  url: string,
  method = "GET",
  body: any = undefined,
  headers: Record<string, string> = {},
  timeout = 60,
  raw: any = undefined,
): Promise<[number, any]> {
  const h: Record<string, string> = { "User-Agent": "MrVuSEOStudio-Autopost/1.0", Accept: "application/json", ...headers };
  let data: any = raw;
  if (body !== undefined && body !== null) {
    data = JSON.stringify(body);
    h["Content-Type"] = "application/json; charset=utf-8";
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers: h, body: data, signal: AbortSignal.timeout(timeout * 1000) });
  } catch (e: any) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {}
    const reason = e?.name === "TimeoutError" ? "hết thời gian chờ" : e?.cause?.code || e?.message || "lỗi kết nối";
    throw new SeoError(`Không kết nối được ${host}: ${reason}`);
  }
  const txt = await res.text();
  if (res.ok) {
    const t = txt.trim();
    if (t[0] === "[" || t[0] === "{") {
      try {
        return [res.status, JSON.parse(t)];
      } catch {
        return [res.status, txt];
      }
    }
    return [res.status, txt];
  }
  try {
    return [res.status, JSON.parse(txt)];
  } catch {
    return [res.status, txt.slice(0, 500)];
  }
}
export function errText(data: any): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data.message || data.error || JSON.stringify(data).slice(0, 300);
  }
  return String(data).slice(0, 300);
}
