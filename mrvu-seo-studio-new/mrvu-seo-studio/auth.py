"""
Đăng nhập bằng tài khoản Google (OpenID Connect) và giới hạn theo danh sách email được phép.
Bật khi config.json có google_client_id, google_client_secret, public_url và allowed_emails.
"""
import base64
import hashlib
import html
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.cookies import SimpleCookie

db = LOCK = load_config = None
COOKIE = "mvs_session"
SESSION_DAYS = 30
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
PUBLIC_PATHS = ("/auth/",)


def setup(db_func, lock, load_cfg):
    global db, LOCK, load_config
    db, LOCK, load_config = db_func, lock, load_cfg
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS auth_sessions(
            token_hash TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, created INTEGER, expires INTEGER, ua TEXT)""")
        conn.execute("DELETE FROM auth_sessions WHERE expires < ?", (int(time.time()),))


def conf():
    c = load_config()
    emails = [e.strip().lower() for e in (c.get("allowed_emails") or []) if e and e.strip()]
    return {"client_id": (c.get("google_client_id") or "").strip(), "secret": (c.get("google_client_secret") or "").strip(),
            "public_url": (c.get("public_url") or "").rstrip("/"), "emails": emails}


def enabled():
    c = conf()
    return bool(c["client_id"] and c["secret"] and c["public_url"] and c["emails"])


def _hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def _cookies(h):
    c = SimpleCookie()
    try:
        c.load(h.headers.get("Cookie", ""))
    except Exception:  # noqa: BLE001
        pass
    return {k: v.value for k, v in c.items()}


def _set_cookie(h, name, value, max_age):
    secure = "; Secure" if conf()["public_url"].startswith("https://") else ""
    h.send_header("Set-Cookie", f"{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")


def current_user(h):
    tok = _cookies(h).get(COOKIE)
    if not tok:
        return None
    with db() as conn:
        r = conn.execute("SELECT email, name, picture, expires FROM auth_sessions WHERE token_hash=?", (_hash(tok),)).fetchone()
    if not r or r["expires"] < time.time():
        return None
    if r["email"] not in conf()["emails"]:      # email bị gỡ khỏi danh sách → mất quyền ngay
        return None
    return dict(r)


def guard(h, path):
    """Trả về True nếu đã trả lời (chặn). Gọi ở đầu mỗi do_GET/do_POST/do_DELETE."""
    if not enabled() or path.startswith(PUBLIC_PATHS):
        return False
    if current_user(h):
        return False
    if path.startswith("/api/"):
        body = json.dumps({"error": "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập.", "login": True}, ensure_ascii=False).encode()
        h.send_response(401)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)
    else:
        nxt = urllib.parse.quote(h.path if h.path.startswith("/") else "/")
        h.send_response(302)
        h.send_header("Location", f"/auth/login?next={nxt}")
        h.end_headers()
    return True


# ---------------------------------------------------------------- trang đăng nhập
def login_page(msg="", err=False, nxt="/"):
    c = conf()
    btn = (f'<a class="g" href="/auth/google?next={urllib.parse.quote(nxt)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Đăng nhập bằng Google</a>'
           if enabled() else '<p class="m e">Chưa cấu hình đăng nhập Google trong config.json.</p>')
    note = f'<p class="m {"e" if err else ""}">{msg}</p>' if msg else ""
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Đăng nhập · Mr.Vũ SEO Studio</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap">
<style>
:root{{--bg:#f2f4f3;--surface:#fff;--ink:#17221f;--muted:#5b6965;--line:#dce3e0;--accent:#0d6957;--bad:#b9441a;--bad-soft:#fbe9e1}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0e1412;--surface:#151d1a;--ink:#e4ebe8;--muted:#94a39e;--line:#25302c;--accent:#4dbea6;--bad:#f0905f;--bad-soft:#3a2219;color-scheme:dark}}}}
*{{box-sizing:border-box}} body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif;padding:24px 16px}}
.c{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:32px 28px;width:min(400px,100%);display:flex;flex-direction:column;gap:16px;text-align:center}}
.b{{font-weight:700;font-size:22px;letter-spacing:-.01em}} .b span{{color:var(--accent)}}
.s{{color:var(--muted);font-size:14px;margin:0}}
.g{{display:flex;align-items:center;justify-content:center;gap:10px;padding:11px 16px;border:1px solid var(--line);border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600;background:var(--surface)}}
.g:hover{{border-color:var(--accent)}} .g:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
.m{{font-size:13px;margin:0;color:var(--muted)}} .m.e{{background:var(--bad-soft);color:var(--bad);padding:10px 12px;border-radius:8px}}
.f{{font-size:12px;color:var(--muted)}}
</style></head><body><main class="c">
<div class="b">Mr.Vũ <span>SEO Studio</span></div>
<p class="s">Đăng nhập bằng tài khoản Google đang dùng trên trình duyệt. Chỉ email đã được cấp quyền mới vào được.</p>
{note}{btn}
<p class="f">Công cụ chỉ đọc email và tên hiển thị để xác nhận bạn là ai.</p>
</main></body></html>"""


def send_html(h, html, code=200, cookies=()):
    body = html.encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", "text/html; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    for name, val, age in cookies:
        _set_cookie(h, name, val, age)
    h.end_headers()
    h.wfile.write(body)


def redirect(h, url, cookies=()):
    h.send_response(302)
    h.send_header("Location", url)
    h.send_header("Cache-Control", "no-store")
    for name, val, age in cookies:
        _set_cookie(h, name, val, age)
    h.end_headers()


def safe_next(n):
    n = urllib.parse.unquote(n or "/")
    return n if n.startswith("/") and not n.startswith("//") and not n.startswith("/auth/") else "/"


# ---------------------------------------------------------------- xử lý /auth/*
def handle(h, path):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
    c = conf()
    nxt = safe_next((q.get("next") or ["/"])[0])
    if path == "/auth/login":
        if current_user(h):
            return redirect(h, nxt)
        msgs = {"denied": ("Email này chưa được cấp quyền vào công cụ.", True), "expired": ("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.", False),
                "error": ("Đăng nhập không thành công, vui lòng thử lại.", True), "out": ("Đã đăng xuất.", False)}
        m, e = msgs.get((q.get("m") or [""])[0], ("", False))
        if (q.get("m") or [""])[0] == "denied" and q.get("email"):
            m = f"Email {html.escape(q['email'][0][:120])} chưa được cấp quyền vào công cụ. Hãy đăng nhập bằng email khác."
        return send_html(h, login_page(m, e, nxt))
    if path == "/auth/google":
        if not enabled():
            return send_html(h, login_page("Chưa cấu hình đăng nhập Google.", True), 500)
        state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        params = {"client_id": c["client_id"], "redirect_uri": c["public_url"] + "/auth/callback", "response_type": "code",
                  "scope": "openid email profile", "state": state, "nonce": nonce, "prompt": "select_account"}
        if len(c["emails"]) == 1:
            params["login_hint"] = c["emails"][0]
        val = base64.urlsafe_b64encode(json.dumps({"s": state, "n": nonce, "next": nxt}).encode()).decode().rstrip("=")
        return redirect(h, AUTH_URL + "?" + urllib.parse.urlencode(params), [("mvs_oauth", val, 600)])
    if path == "/auth/callback":
        try:
            st = json.loads(base64.urlsafe_b64decode(_cookies(h).get("mvs_oauth", "") + "==="))
        except Exception:  # noqa: BLE001
            st = {}
        if not st or (q.get("state") or [""])[0] != st.get("s") or not q.get("code"):
            return redirect(h, "/auth/login?m=error", [("mvs_oauth", "", 0)])
        try:
            data = urllib.parse.urlencode({"code": q["code"][0], "client_id": c["client_id"], "client_secret": c["secret"],
                                           "redirect_uri": c["public_url"] + "/auth/callback", "grant_type": "authorization_code"}).encode()
            req = urllib.request.Request(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
            with urllib.request.urlopen(req, timeout=20) as r:
                tok = json.load(r)
            # id_token nhận trực tiếp từ Google qua HTTPS → kiểm tra các trường theo OpenID Connect (mục 3.1.3.7)
            payload = tok["id_token"].split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            assert claims.get("iss") in ("https://accounts.google.com", "accounts.google.com")
            assert claims.get("aud") == c["client_id"]
            assert int(claims.get("exp", 0)) > time.time()
            assert claims.get("nonce") == st.get("n")
            assert claims.get("email_verified") in (True, "true")
        except Exception as e:  # noqa: BLE001
            print("[đăng nhập] lỗi:", e)
            return redirect(h, "/auth/login?m=error", [("mvs_oauth", "", 0)])
        email = claims.get("email", "").lower()
        if email not in c["emails"]:
            print(f"[đăng nhập] từ chối {email}")
            return redirect(h, "/auth/login?m=denied&email=" + urllib.parse.quote(email), [("mvs_oauth", "", 0)])
        raw = secrets.token_urlsafe(32)
        now = int(time.time())
        with LOCK, db() as conn:
            conn.execute("INSERT INTO auth_sessions VALUES (?,?,?,?,?,?,?)",
                         (_hash(raw), email, claims.get("name", ""), claims.get("picture", ""), now, now + SESSION_DAYS * 86400,
                          (h.headers.get("User-Agent") or "")[:200]))
        print(f"[đăng nhập] {email} lúc {datetime.now():%H:%M %d/%m/%Y}")
        return redirect(h, safe_next(st.get("next")), [(COOKIE, raw, SESSION_DAYS * 86400), ("mvs_oauth", "", 0)])
    if path == "/auth/logout":
        tok = _cookies(h).get(COOKIE)
        if tok:
            with LOCK, db() as conn:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash=?", (_hash(tok),))
        return redirect(h, "/auth/login?m=out", [(COOKIE, "", 0)])
    if path == "/auth/me":
        u = current_user(h) if enabled() else None
        body = json.dumps({"enabled": enabled(), "user": u}, ensure_ascii=False).encode()
        h.send_response(200)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)
        return
    h.send_response(404)
    h.end_headers()
