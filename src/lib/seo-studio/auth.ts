// @ts-nocheck
/**
 * Đăng nhập bằng tài khoản Google (OpenID Connect) và giới hạn theo danh sách email được phép.
 * Chuyển từ mrvu-seo-studio/auth.py. Khác bản gốc:
 *   - Cấu hình lấy từ biến môi trường (GOOGLE_OAUTH_CLIENT_ID/SECRET, SEO_PUBLIC_URL, SEO_ALLOWED_EMAILS).
 *   - Công cụ nằm dưới đường dẫn /seo-studio của POS.
 *   - CHƯA cấu hình đăng nhập thì CHẶN HẾT (bản gốc cho chạy tự do trên máy cá nhân) —
 *     trừ khi chạy thử trên localhost với SEO_DEV_NO_AUTH=1.
 *   - Khi trang nằm trong khung (iframe) của POS, nút Google mở ở cửa sổ chính rồi quay về /seo.
 */
import { createHash, randomBytes } from "node:crypto";
import { loadConfig, one, run } from "./core";

export const BASE = "/seo-studio";
const COOKIE = "mvs_session";
const SESSION_DAYS = 30;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function conf() {
  const c = await loadConfig();
  return {
    client_id: c.google_client_id,
    secret: c.google_client_secret,
    public_url: c.public_url,
    emails: (c.allowed_emails || []).map((e: string) => e.trim().toLowerCase()).filter(Boolean),
  };
}
export async function enabled(c?: any) {
  c = c || (await conf());
  return Boolean(c.client_id && c.secret && c.public_url && c.emails.length);
}
const hashTok = (t: string) => createHash("sha256").update(t).digest("hex");

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${value}; Path=${BASE}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function devBypass(req: Request) {
  if (process.env.SEO_DEV_NO_AUTH !== "1") return false;
  const host = (new URL(req.url).hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

export async function currentUser(req: Request, c?: any) {
  const tok = cookies(req)[COOKIE];
  if (!tok) return null;
  c = c || (await conf());
  const r = await one("SELECT email, name, picture, expires FROM seo_auth_sessions WHERE token_hash=?", [hashTok(tok)]);
  if (!r || Number(r.expires) < Date.now() / 1000) return null;
  if (!c.emails.includes(r.email)) return null; // email bị gỡ khỏi danh sách → mất quyền ngay
  return r;
}

function json(obj: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function redirect(url: string, setCookies: string[] = []) {
  const h = new Headers({ Location: url, "Cache-Control": "no-store" });
  for (const c of setCookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}
function html(body: string, status = 200, setCookies: string[] = []) {
  const h = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  for (const c of setCookies) h.append("Set-Cookie", c);
  return new Response(body, { status, headers: h });
}

/** Trả về Response nếu phải chặn (chưa đăng nhập), null nếu được qua. Giống auth.guard(). */
export async function guard(req: Request, path: string): Promise<Response | null> {
  if (path.startsWith("/auth/") || devBypass(req)) return null;
  const c = await conf();
  if (await enabled(c)) {
    if (await currentUser(req, c)) return null;
  }
  const msg = (await enabled(c))
    ? "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập."
    : "Chưa cấu hình đăng nhập Google cho SEO Studio (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, SEO_PUBLIC_URL, SEO_ALLOWED_EMAILS).";
  if (path.startsWith("/api/")) return json({ error: msg, login: true }, 401);
  const u = new URL(req.url);
  return redirect(`${BASE}/auth/login?next=${encodeURIComponent(u.pathname + u.search)}`);
}

function safeNext(n: string | null) {
  try {
    n = decodeURIComponent(n || "");
  } catch {
    n = "";
  }
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith(BASE + "/auth/") ? n : BASE + "/";
}

function loginPage(isEnabled: boolean, msg = "", err = false, nxt = BASE + "/") {
  const btn = isEnabled
    ? `<a class="g" id="gbtn" href="${BASE}/auth/google?next=${encodeURIComponent(nxt)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Đăng nhập bằng Google</a>`
    : '<p class="m e">Chưa cấu hình đăng nhập Google (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, SEO_PUBLIC_URL, SEO_ALLOWED_EMAILS).</p>';
  const note = msg ? `<p class="m ${err ? "e" : ""}">${msg}</p>` : "";
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Đăng nhập · Mr.Vũ SEO Studio</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap">
<style>
:root{--bg:#f2f4f3;--surface:#fff;--ink:#17221f;--muted:#5b6965;--line:#dce3e0;--accent:#0d6957;--bad:#b9441a;--bad-soft:#fbe9e1}
@media (prefers-color-scheme:dark){:root{--bg:#0e1412;--surface:#151d1a;--ink:#e4ebe8;--muted:#94a39e;--line:#25302c;--accent:#4dbea6;--bad:#f0905f;--bad-soft:#3a2219;color-scheme:dark}}
*{box-sizing:border-box} body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif;padding:24px 16px}
.c{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:32px 28px;width:min(400px,100%);display:flex;flex-direction:column;gap:16px;text-align:center}
.b{font-weight:700;font-size:22px;letter-spacing:-.01em} .b span{color:var(--accent)}
.s{color:var(--muted);font-size:14px;margin:0}
.g{display:flex;align-items:center;justify-content:center;gap:10px;padding:11px 16px;border:1px solid var(--line);border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600;background:var(--surface)}
.g:hover{border-color:var(--accent)} .g:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.m{font-size:13px;margin:0;color:var(--muted)} .m.e{background:var(--bad-soft);color:var(--bad);padding:10px 12px;border-radius:8px}
.f{font-size:12px;color:var(--muted)}
</style></head><body><main class="c">
<div class="b">Mr.Vũ <span>SEO Studio</span></div>
<p class="s">Đăng nhập bằng tài khoản Google đang dùng trên trình duyệt. Chỉ email đã được cấp quyền mới vào được.</p>
${note}${btn}
<p class="f">Công cụ chỉ đọc email và tên hiển thị để xác nhận bạn là ai.</p>
</main>
<script>
// Trang Google không mở được trong khung: khi nằm trong POS (/seo), mở đăng nhập ở cửa sổ chính
// rồi quay về đúng trang SEO trong POS.
(function(){try{if(window.top===window)return;var a=document.getElementById('gbtn');if(!a)return;
a.target='_top';var nx=${JSON.stringify(nxt)};a.href=${JSON.stringify(BASE + "/auth/google?next=")}+encodeURIComponent('/seo?p='+encodeURIComponent(nx));}catch(e){}})();
</script></body></html>`;
}

/** Xử lý /auth/* (path đã bỏ tiền tố /seo-studio). */
export async function handle(req: Request, path: string): Promise<Response> {
  const u = new URL(req.url);
  const q = u.searchParams;
  const c = await conf();
  const on = await enabled(c);
  const secure = String(c.public_url || "").startsWith("https://");
  const nxt = safeNext(q.get("next"));
  if (path === "/auth/login") {
    if (on && (await currentUser(req, c))) return redirect(nxt);
    const msgs: Record<string, [string, boolean]> = {
      denied: ["Email này chưa được cấp quyền vào công cụ.", true],
      expired: ["Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.", false],
      error: ["Đăng nhập không thành công, vui lòng thử lại.", true],
      out: ["Đã đăng xuất.", false],
    };
    let [m, e] = msgs[q.get("m") || ""] || ["", false];
    if (q.get("m") === "denied" && q.get("email")) m = `Email ${esc(String(q.get("email")).slice(0, 120))} chưa được cấp quyền vào công cụ. Hãy đăng nhập bằng email khác.`;
    return html(loginPage(on, m, e, nxt));
  }
  if (path === "/auth/google") {
    if (!on) return html(loginPage(false, "Chưa cấu hình đăng nhập Google.", true), 500);
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const params = new URLSearchParams({
      client_id: c.client_id, redirect_uri: c.public_url + BASE + "/auth/callback", response_type: "code",
      scope: "openid email profile", state, nonce, prompt: "select_account",
    });
    if (c.emails.length === 1) params.set("login_hint", c.emails[0]);
    const val = Buffer.from(JSON.stringify({ s: state, n: nonce, next: nxt })).toString("base64url");
    return redirect(AUTH_URL + "?" + params.toString(), [setCookie("mvs_oauth", val, 600, secure)]);
  }
  if (path === "/auth/callback") {
    let st: any = {};
    try {
      st = JSON.parse(Buffer.from(cookies(req).mvs_oauth || "", "base64url").toString("utf8"));
    } catch {
      st = {};
    }
    const clear = setCookie("mvs_oauth", "", 0, secure);
    if (!st.s || q.get("state") !== st.s || !q.get("code")) return redirect(`${BASE}/auth/login?m=error`, [clear]);
    let claims: any;
    try {
      const r = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: q.get("code"), client_id: c.client_id, client_secret: c.secret, redirect_uri: c.public_url + BASE + "/auth/callback", grant_type: "authorization_code" }),
        signal: AbortSignal.timeout(20_000),
      });
      const tok: any = await r.json();
      if (!r.ok || !tok.id_token) throw new Error("token " + r.status);
      // id_token nhận trực tiếp từ Google qua HTTPS → kiểm tra các trường theo OpenID Connect (mục 3.1.3.7)
      claims = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString("utf8"));
      if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) throw new Error("iss");
      if (claims.aud !== c.client_id) throw new Error("aud");
      if (!(Number(claims.exp || 0) > Date.now() / 1000)) throw new Error("exp");
      if (claims.nonce !== st.n) throw new Error("nonce");
      if (!(claims.email_verified === true || claims.email_verified === "true")) throw new Error("email_verified");
    } catch (e: any) {
      console.error("[đăng nhập SEO] lỗi:", e?.message);
      return redirect(`${BASE}/auth/login?m=error`, [clear]);
    }
    const email = String(claims.email || "").toLowerCase();
    if (!c.emails.includes(email)) {
      console.warn(`[đăng nhập SEO] từ chối ${email}`);
      return redirect(`${BASE}/auth/login?m=denied&email=${encodeURIComponent(email)}`, [clear]);
    }
    const raw = randomBytes(32).toString("base64url");
    const t = Math.floor(Date.now() / 1000);
    await run("DELETE FROM seo_auth_sessions WHERE expires < ?", [t]);
    await run("INSERT INTO seo_auth_sessions VALUES (?,?,?,?,?,?,?)",
      [hashTok(raw), email, claims.name || "", claims.picture || "", t, t + SESSION_DAYS * 86400, (req.headers.get("user-agent") || "").slice(0, 200)]);
    return redirect(safeNext(st.next), [setCookie(COOKIE, raw, SESSION_DAYS * 86400, secure), clear]);
  }
  if (path === "/auth/logout") {
    const tok = cookies(req)[COOKIE];
    if (tok) await run("DELETE FROM seo_auth_sessions WHERE token_hash=?", [hashTok(tok)]);
    return redirect(`${BASE}/auth/login?m=out`, [setCookie(COOKIE, "", 0, secure)]);
  }
  if (path === "/auth/me") {
    const user = on ? await currentUser(req, c) : null;
    return json({ enabled: on, user: user ? { email: user.email, name: user.name, picture: user.picture } : null });
  }
  return new Response("Not found", { status: 404 });
}
