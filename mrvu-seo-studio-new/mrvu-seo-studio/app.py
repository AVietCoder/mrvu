"""
Mr.Vũ SEO Studio — bộ công cụ SEO dùng nội bộ.

Chạy:  python app.py      (cần Python 3.8+, không cần cài thêm thư viện)
Mở:    http://127.0.0.1:8686

Tài khoản DataForSEO đặt trong file config.json cạnh file này
(hoặc biến môi trường DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).
Chưa có tài khoản thì giao diện chạy bằng dữ liệu mẫu.
"""
import base64
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

import audit
import autopost
import geo
import backlinks
import gsc
import topics
import aiq
import smap
import costs
import auth
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "kho-tu-khoa.db"
CONFIG_PATH = BASE / "config.json"
HOST, PORT = "127.0.0.1", int(os.environ.get("PORT", "8686"))
MAX_KEYWORDS = 1000
_db_lock = threading.Lock()


def load_config():
    cfg = {"login": "", "password": "", "usd_vnd": 26000, "anthropic_api_key": "", "anthropic_model": "claude-sonnet-5-5"}
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            print(f"[!] Không đọc được config.json: {e}")
    cfg["login"] = os.environ.get("DATAFORSEO_LOGIN", cfg.get("login", "")).strip()
    cfg["password"] = os.environ.get("DATAFORSEO_PASSWORD", cfg.get("password", "")).strip()
    return cfg


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _db_lock, db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sessions(
                id TEXT PRIMARY KEY, created_at TEXT, location TEXT, language TEXT,
                count INTEGER, total_volume INTEGER, cost REAL, rows_json TEXT)"""
        )


def init_rank_db():
    with _db_lock, db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS tracked(
                id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, keyword TEXT,
                location TEXT, language TEXT, created_at TEXT,
                UNIQUE(domain, keyword, location))"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS ranks(
                id INTEGER PRIMARY KEY AUTOINCREMENT, tracked_id INTEGER, engine TEXT,
                checked_at TEXT, position INTEGER, url TEXT, depth INTEGER, cost REAL)"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS ix_ranks ON ranks(tracked_id, engine, checked_at)")


def init_audit_db():
    with _db_lock, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_sites(
            id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT UNIQUE, start_url TEXT,
            crawled_at TEXT, method TEXT, count INTEGER)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_pages(
            id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, url TEXT, type TEXT, source TEXT,
            UNIQUE(site_id, url))""")
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_results(
            id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER, audited_at TEXT, score INTEGER,
            keyword TEXT, report_json TEXT, ai_json TEXT)""")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_ar ON audit_results(page_id, audited_at)")


JOBS = {}


def run_crawl_job(job_id, url, max_pages):
    job = JOBS[job_id]

    def progress(msg, n):
        job.update(message=msg, found=n)
    try:
        base, pages, method = audit.crawl(url, max_pages, progress)
        domain = audit.bare_host(urlparse(base).netloc)
        now = datetime.now(timezone.utc).isoformat()
        with _db_lock, db() as conn:
            conn.execute("INSERT OR IGNORE INTO audit_sites(domain) VALUES (?)", (domain,))
            sid = conn.execute("SELECT id FROM audit_sites WHERE domain=?", (domain,)).fetchone()[0]
            for u, t, src in pages:
                conn.execute("INSERT OR IGNORE INTO audit_pages(site_id, url, type, source) VALUES (?,?,?,?)", (sid, u, t, src))
            n = conn.execute("SELECT COUNT(*) FROM audit_pages WHERE site_id=?", (sid,)).fetchone()[0]
            conn.execute("UPDATE audit_sites SET start_url=?, crawled_at=?, method=?, count=? WHERE id=?",
                         (base, now, method, n, sid))
        how = "sitemap" if method == "sitemap" else "bò theo liên kết (website không có sitemap)"
        job.update(status="done", site_id=sid, found=len(pages),
                   message=f"Hoàn thành! Tìm thấy {len(pages)} trang qua {how}.")
    except Exception as e:  # noqa: BLE001
        job.update(status="error", message=str(e))


def audit_pages_list(conn, site_id):
    rows = conn.execute(
        """SELECT p.id, p.url, p.type, p.source,
                  (SELECT score FROM audit_results r WHERE r.page_id=p.id ORDER BY audited_at DESC LIMIT 1) AS score,
                  (SELECT audited_at FROM audit_results r WHERE r.page_id=p.id ORDER BY audited_at DESC LIMIT 1) AS audited_at
           FROM audit_pages p WHERE p.site_id=? ORDER BY p.id""", (site_id,)).fetchall()
    return [dict(r) for r in rows]


def latest_result(conn, page_id):
    r = conn.execute("SELECT * FROM audit_results WHERE page_id=? ORDER BY audited_at DESC LIMIT 1", (page_id,)).fetchone()
    if not r:
        return None
    rep = json.loads(r["report_json"])
    rep["page_id"] = page_id
    rep["result_id"] = r["id"]
    rep["ai"] = json.loads(r["ai_json"]) if r["ai_json"] else None
    return rep


def clean_domain(d):
    d = str(d or "").strip().lower()
    for p in ("https://", "http://"):
        if d.startswith(p):
            d = d[len(p):]
    d = d.split("/")[0].split("?")[0].split(":")[0]
    return d[4:] if d.startswith("www.") else d


def domain_match(item_domain, target):
    d = clean_domain(item_domain)
    return d == target or d.endswith("." + target)


def dfs_post(cfg, path, payload, timeout=180):
    """Gọi một endpoint DataForSEO, trả về (task, cost) hoặc ném RuntimeError có thông báo tiếng Việt."""
    token = base64.b64encode(f"{cfg['login']}:{cfg['password']}".encode()).decode()
    req = urllib.request.Request(
        "https://api.dataforseo.com" + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Basic " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise RuntimeError("Sai tài khoản hoặc mật khẩu API DataForSEO. Kiểm tra lại config.json.")
        raise RuntimeError(f"DataForSEO trả lỗi HTTP {e.code}.")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Không kết nối được DataForSEO: {e.reason}")
    if data.get("status_code") != 20000:
        raise RuntimeError(f"DataForSEO: {data.get('status_message', 'lỗi không xác định')}")
    task = (data.get("tasks") or [{}])[0]
    if task.get("status_code") != 20000:
        msg = task.get("status_message", "lỗi không xác định")
        if task.get("status_code") == 40200:
            msg = "Tài khoản DataForSEO đã hết tiền. Nạp thêm số dư rồi thử lại."
        raise RuntimeError(f"DataForSEO ({task.get('status_code')}): {msg}")
    cost = float(task.get("cost") or data.get("cost") or 0)
    costs.record_dfs(path, cost)
    return task, cost


def check_rank(cfg, engine, keyword, domain, location_code, language_code, depth):
    """Trả về (vị trí hoặc None nếu ngoài top, url, chi phí)."""
    path = f"/v3/serp/{engine}/organic/live/regular"
    task, cost = dfs_post(cfg, path, [{
        "keyword": keyword, "location_code": int(location_code),
        "language_code": language_code, "depth": int(depth), "device": "desktop",
    }], timeout=120)
    result = (task.get("result") or [{}])[0] or {}
    for it in result.get("items") or []:
        if str(it.get("type", "")).startswith("organic") and domain_match(it.get("domain"), domain):
            return it.get("rank_group"), it.get("url"), cost
    return None, None, cost


def rank_items(conn, where, args):
    rows = [dict(r) for r in conn.execute(
        f"SELECT * FROM tracked WHERE {where} ORDER BY id", args).fetchall()]
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    hist = conn.execute(
        f"SELECT tracked_id, engine, checked_at, position, url FROM ranks "
        f"WHERE tracked_id IN ({marks}) ORDER BY checked_at DESC", ids).fetchall()
    latest = {}
    for h in hist:
        key = (h["tracked_id"], h["engine"])
        latest.setdefault(key, [])
        if len(latest[key]) < 2:
            latest[key].append(dict(h))
    for r in rows:
        for eng in ("google",):
            last = latest.get((r["id"], eng), [])
            r[eng] = {
                "position": last[0]["position"] if last else None,
                "url": last[0]["url"] if last else None,
                "checked_at": last[0]["checked_at"] if last else None,
                "previous": last[1]["position"] if len(last) > 1 else None,
                "prev_checked": len(last) > 1,
                "checked": bool(last),
            }
    return rows


def valid_keyword(k):
    # Giới hạn của Google Ads: tối đa 80 ký tự và 10 từ mỗi từ khóa
    return 0 < len(k) <= 80 and len(k.split()) <= 10


def call_dataforseo(cfg, keywords, location_code, language_code):
    task, cost = dfs_post(cfg, "/v3/keywords_data/google_ads/search_volume/live", [{
        "keywords": keywords, "location_code": location_code, "language_code": language_code,
    }])
    return task.get("result") or [], cost


def normalize(item):
    months = sorted(
        (m for m in (item.get("monthly_searches") or []) if m),
        key=lambda m: (m.get("year", 0), m.get("month", 0)),
    )[-12:]
    return {
        "keyword": item.get("keyword", ""),
        "volume": item.get("search_volume"),
        "cpc": item.get("cpc"),
        "comp": item.get("competition"),           # LOW / MEDIUM / HIGH
        "compIndex": item.get("competition_index"),  # 0-100
        "low_bid": item.get("low_top_of_page_bid"),
        "high_bid": item.get("high_top_of_page_bid"),
        "months": [{"y": m.get("year"), "m": m.get("month"), "v": m.get("search_volume") or 0} for m in months],
    }


def save_session(location, language, rows, cost):
    sid = uuid.uuid4().hex[:12]
    created = datetime.now(timezone.utc).isoformat()
    total = sum((r["volume"] or 0) for r in rows)
    with _db_lock, db() as conn:
        conn.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
            (sid, created, str(location), language, len(rows), total, cost, json.dumps(rows, ensure_ascii=False)),
        )
    return {"id": sid, "created_at": created, "location": str(location), "count": len(rows),
            "total_volume": total, "cost": cost, "rows": rows}


class Handler(BaseHTTPRequestHandler):
    server_version = "MrVuSEOStudio/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/auth/"):
            return auth.handle(self, path)
        if auth.guard(self, path):
            return
        if path.startswith("/api/ap/"):
            return autopost.handle(self, "GET", path)
        if path.startswith("/api/geo/"):
            return geo.handle(self, "GET", path)
        if path.startswith("/api/bl/"):
            return backlinks.handle(self, "GET", path)
        if path.startswith("/api/gsc/"):
            return gsc.handle(self, "GET", path)
        if path.startswith("/api/cost/"):
            return costs.handle(self, "GET", path)
        if path.startswith("/api/tp/"):
            return topics.handle(self, "GET", path)
        if path.startswith("/api/aiq/"):
            return aiq.handle(self, "GET", path)
        if path.startswith("/api/smap/"):
            return smap.handle(self, "GET", path)
        pages = {"/costguard.js": "costguard.js", "/": "index.html", "/index.html": "index.html", "/rank.html": "rank.html", "/rank": "rank.html",
                 "/audit.html": "audit.html", "/audit": "audit.html",
                 "/autopost.html": "autopost.html", "/autopost": "autopost.html",
                 "/geo.html": "geo.html", "/geo": "geo.html",
                 "/backlinks.html": "backlinks.html", "/backlinks": "backlinks.html",
                 "/gsc.html": "gsc.html", "/gsc": "gsc.html",
                 "/aiq.html": "aiq.html", "/aiq": "aiq.html",
                 "/smap.html": "smap.html", "/smap": "smap.html"}
        if path in pages:
            body = (BASE / pages[path]).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ("application/javascript" if pages[path].endswith(".js") else "text/html") + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/health":
            cfg = load_config()
            self.send_json({"ok": True, "configured": bool(cfg["login"] and cfg["password"]),
                            "usd_vnd": cfg.get("usd_vnd", 26000),
                            "ai": bool(cfg.get("anthropic_api_key"))})
        elif path == "/api/history":
            with db() as conn:
                rows = conn.execute(
                    "SELECT id, created_at, location, count, total_volume, cost FROM sessions "
                    "ORDER BY created_at DESC LIMIT 200").fetchall()
            self.send_json({"items": [dict(r) for r in rows]})
        elif path == "/api/audit/sites":
            with db() as conn:
                rows = conn.execute("SELECT * FROM audit_sites WHERE count>0 ORDER BY crawled_at DESC").fetchall()
            self.send_json({"items": [dict(r) for r in rows]})
        elif path == "/api/audit/pages":
            sid = (parse_qs(urlparse(self.path).query).get("site_id") or ["0"])[0]
            with db() as conn:
                site = conn.execute("SELECT * FROM audit_sites WHERE id=?", (sid,)).fetchone()
                items = audit_pages_list(conn, sid)
            self.send_json({"site": dict(site) if site else None, "items": items})
        elif path.startswith("/api/audit/job/"):
            job = JOBS.get(path.rsplit("/", 1)[-1])
            self.send_json(job or {"status": "error", "message": "Không tìm thấy lượt quét"})
        elif path.startswith("/api/audit/report/"):
            pid = path.rsplit("/", 1)[-1]
            with db() as conn:
                rep = latest_result(conn, pid)
            self.send_json(rep or {"error": "Trang này chưa được audit"}, 200 if rep else 404)
        elif path == "/api/rank/sites":
            with db() as conn:
                rows = conn.execute(
                    "SELECT domain, COUNT(*) n FROM tracked GROUP BY domain ORDER BY MAX(id) DESC").fetchall()
            self.send_json({"items": [dict(r) for r in rows]})
        elif path == "/api/rank/list":
            domain = clean_domain((parse_qs(urlparse(self.path).query).get("domain") or [""])[0])
            with db() as conn:
                items = rank_items(conn, "domain=?", (domain,))
            self.send_json({"items": items})
        elif path.startswith("/api/rank/history/"):
            tid = path.rsplit("/", 1)[-1]
            with db() as conn:
                rows = conn.execute(
                    "SELECT engine, checked_at, position, url FROM ranks WHERE tracked_id=? "
                    "ORDER BY checked_at", (tid,)).fetchall()
            self.send_json({"items": [dict(r) for r in rows]})
        elif path.startswith("/api/history/"):
            sid = path.rsplit("/", 1)[-1]
            with db() as conn:
                r = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
            if not r:
                return self.send_json({"error": "Không tìm thấy phiên này"}, 404)
            d = dict(r)
            d["rows"] = json.loads(d.pop("rows_json"))
            self.send_json(d)
        else:
            self.send_json({"error": "Không có trang này"}, 404)

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if auth.guard(self, path):
            return
        if path.startswith("/api/ap/"):
            return autopost.handle(self, "DELETE", path)
        if path.startswith("/api/geo/"):
            return geo.handle(self, "DELETE", path)
        if path.startswith("/api/bl/"):
            return backlinks.handle(self, "DELETE", path)
        if path.startswith("/api/gsc/"):
            return gsc.handle(self, "DELETE", path)
        if path.startswith("/api/cost/"):
            return costs.handle(self, "DELETE", path)
        if path.startswith("/api/tp/"):
            return topics.handle(self, "DELETE", path)
        if path.startswith("/api/aiq/"):
            return aiq.handle(self, "DELETE", path)
        if path.startswith("/api/smap/"):
            return smap.handle(self, "DELETE", path)
        if path.startswith("/api/rank/tracked/"):
            tid = path.rsplit("/", 1)[-1]
            with _db_lock, db() as conn:
                conn.execute("DELETE FROM ranks WHERE tracked_id=?", (tid,))
                conn.execute("DELETE FROM tracked WHERE id=?", (tid,))
            return self.send_json({"ok": True})
        if path.startswith("/api/history/"):
            sid = path.rsplit("/", 1)[-1]
            with _db_lock, db() as conn:
                conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
            return self.send_json({"ok": True})
        self.send_json({"error": "Không có trang này"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        if auth.guard(self, path):
            return
        if path.startswith("/api/ap/"):
            return autopost.handle(self, "POST", path)
        if path.startswith("/api/geo/"):
            return geo.handle(self, "POST", path)
        if path.startswith("/api/bl/"):
            return backlinks.handle(self, "POST", path)
        if path.startswith("/api/gsc/"):
            return gsc.handle(self, "POST", path)
        if path.startswith("/api/cost/"):
            return costs.handle(self, "POST", path)
        if path.startswith("/api/tp/"):
            return topics.handle(self, "POST", path)
        if path.startswith("/api/aiq/"):
            return aiq.handle(self, "POST", path)
        if path.startswith("/api/smap/"):
            return smap.handle(self, "POST", path)
        if path == "/api/rank/add":
            return self.rank_add()
        if path == "/api/audit/crawl":
            return self.audit_crawl()
        if path == "/api/audit/run":
            return self.audit_run()
        if path == "/api/audit/ai":
            return self.audit_ai()
        if path == "/api/rank/check":
            return self.rank_check()
        if path != "/api/volume":
            return self.send_json({"error": "Không có trang này"}, 404)
        cfg = load_config()
        if not (cfg["login"] and cfg["password"]):
            return self.send_json({"error": "Chưa nhập tài khoản DataForSEO trong config.json."}, 400)
        try:
            body = self.read_json()
        except Exception:  # noqa: BLE001
            return self.send_json({"error": "Dữ liệu gửi lên không hợp lệ"}, 400)

        seen, kws, skipped = set(), [], []
        for k in body.get("keywords", []):
            k = " ".join(str(k).lower().split())
            if not k or k in seen:
                continue
            seen.add(k)
            (kws if valid_keyword(k) else skipped).append(k)
        if not kws:
            return self.send_json({"error": "Không có từ khóa hợp lệ để tra."}, 400)
        if len(kws) > MAX_KEYWORDS:
            return self.send_json({"error": f"Tối đa {MAX_KEYWORDS} từ mỗi lần tra."}, 400)

        loc = int(body.get("location_code") or 2704)
        lang = body.get("language_code") or "vi"
        try:
            result, cost = call_dataforseo(cfg, kws, loc, lang)
        except RuntimeError as e:
            return self.send_json({"error": str(e)}, 502)

        by_kw = {normalize(it)["keyword"]: normalize(it) for it in result}
        # Giữ đúng thứ tự người dùng nhập; từ không có dữ liệu vẫn hiện với volume trống
        rows = [by_kw.get(k) or {"keyword": k, "volume": None, "cpc": None, "comp": None,
                                 "compIndex": None, "months": []} for k in kws]
        session = save_session(loc, lang, rows, cost)
        session["skipped"] = skipped
        self.send_json(session)

    def audit_crawl(self):
        body = self.read_json()
        url = str(body.get("url", "")).strip()
        if not url or "." not in url:
            return self.send_json({"error": "Nhập địa chỉ website. Ví dụ: mrvu.vn"}, 400)
        max_pages = max(10, min(5000, int(body.get("max_pages") or 1000)))
        jid = uuid.uuid4().hex[:10]
        JOBS[jid] = {"status": "running", "found": 0, "message": "Đang mở website…"}
        threading.Thread(target=run_crawl_job, args=(jid, url, max_pages), daemon=True).start()
        self.send_json({"job_id": jid})

    def audit_run(self):
        body = self.read_json()
        pid = int(body.get("page_id") or 0)
        with db() as conn:
            page = conn.execute("SELECT * FROM audit_pages WHERE id=?", (pid,)).fetchone()
            if not page:
                return self.send_json({"error": "Không tìm thấy trang"}, 404)
            others = conn.execute(
                """SELECT r.report_json FROM audit_results r JOIN audit_pages p ON p.id=r.page_id
                   WHERE p.site_id=? AND p.id<>? AND r.id IN (SELECT MAX(id) FROM audit_results GROUP BY page_id)""",
                (page["site_id"], pid)).fetchall()
        other_titles = {json.loads(o[0]).get("extract", {}).get("title") for o in others} - {"", None}
        try:
            rep = audit.audit_page(page["url"], page["type"], body.get("keyword", ""), other_titles,
                                   check_links=body.get("check_links", True))
        except RuntimeError as e:
            return self.send_json({"error": str(e)}, 502)
        now = datetime.now(timezone.utc).isoformat()
        with _db_lock, db() as conn:
            if rep["page_type"] != page["type"]:
                conn.execute("UPDATE audit_pages SET type=? WHERE id=?", (rep["page_type"], pid))
            cur = conn.execute("INSERT INTO audit_results(page_id, audited_at, score, keyword, report_json) VALUES (?,?,?,?,?)",
                               (pid, now, rep["score"], rep["keyword"], json.dumps(rep, ensure_ascii=False)))
        rep.update(page_id=pid, result_id=cur.lastrowid, ai=None, audited_at=now)
        self.send_json(rep)

    def audit_ai(self):
        body = self.read_json()
        pid = int(body.get("page_id") or 0)
        cfg = load_config()
        with db() as conn:
            rep = latest_result(conn, pid)
        if not rep:
            return self.send_json({"error": "Hãy audit trang trước khi dùng AI."}, 400)
        try:
            ai = audit.ai_suggest(cfg, rep)
        except RuntimeError as e:
            return self.send_json({"error": str(e)}, 502)
        with _db_lock, db() as conn:
            conn.execute("UPDATE audit_results SET ai_json=? WHERE id=?", (json.dumps(ai, ensure_ascii=False), rep["result_id"]))
        self.send_json(ai)

    def rank_add(self):
        body = self.read_json()
        domain = clean_domain(body.get("domain"))
        if not domain or "." not in domain:
            return self.send_json({"error": "Tên miền chưa đúng. Ví dụ: mrvu.vn"}, 400)
        loc = str(int(body.get("location_code") or 2704))
        lang = body.get("language_code") or "vi"
        now = datetime.now(timezone.utc).isoformat()
        added = 0
        with _db_lock, db() as conn:
            for k in body.get("keywords", []):
                k = " ".join(str(k).lower().split())
                if not k or len(k) > 700:
                    continue
                cur = conn.execute(
                    "INSERT OR IGNORE INTO tracked(domain, keyword, location, language, created_at) "
                    "VALUES (?,?,?,?,?)", (domain, k, loc, lang, now))
                added += cur.rowcount
        with db() as conn:
            items = rank_items(conn, "domain=?", (domain,))
        self.send_json({"added": added, "domain": domain, "items": items})

    def rank_check(self):
        cfg = load_config()
        if not (cfg["login"] and cfg["password"]):
            return self.send_json({"error": "Chưa nhập tài khoản DataForSEO trong config.json."}, 400)
        body = self.read_json()
        ids = [int(i) for i in body.get("ids", [])][:50]
        engines = ["google"]   # chỉ theo dõi Google
        depth = max(10, min(100, int(body.get("depth") or 30)))
        if not ids or not engines:
            return self.send_json({"error": "Chọn ít nhất một từ khóa và một công cụ tìm kiếm."}, 400)
        with db() as conn:
            marks = ",".join("?" * len(ids))
            tracked = [dict(r) for r in conn.execute(
                f"SELECT * FROM tracked WHERE id IN ({marks})", ids).fetchall()]
        jobs = [(t, e) for t in tracked for e in engines]

        def run(job):
            t, e = job
            try:
                pos, url, cost = check_rank(cfg, e, t["keyword"], t["domain"], t["location"], t["language"], depth)
                return t["id"], e, pos, url, cost, None
            except RuntimeError as err:
                return t["id"], e, None, None, 0, str(err)

        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(run, jobs))
        now = datetime.now(timezone.utc).isoformat()
        errors, total = [], 0.0
        with _db_lock, db() as conn:
            for tid, e, pos, url, cost, err in results:
                total += cost
                if err:
                    errors.append(err)
                    continue
                conn.execute(
                    "INSERT INTO ranks(tracked_id, engine, checked_at, position, url, depth, cost) "
                    "VALUES (?,?,?,?,?,?,?)", (tid, e, now, pos, url, depth, cost))
        with db() as conn:
            items = rank_items(conn, f"id IN ({','.join('?' * len(ids))})", ids)
        self.send_json({"items": items, "cost": total, "errors": sorted(set(errors))})


def migrate_old_folder():
    """Lần chạy đầu ở thư mục mới: chép dữ liệu từ thư mục cũ 'kho-tu-khoa' nằm cạnh (nếu có)."""
    import shutil
    if DB_PATH.exists():
        return
    for old in (BASE.parent / "kho-tu-khoa", BASE.parent / "kho-tu-khoa-main"):
        if old.resolve() == BASE.resolve() or not (old / "kho-tu-khoa.db").exists():
            continue
        copied = []
        for name in ("kho-tu-khoa.db", "config.json", "google-service-account.json"):
            if (old / name).exists() and not (BASE / name).exists():
                shutil.copy2(old / name, BASE / name)
                copied.append(name)
        if (old / "anh-thu-vien").is_dir() and not (BASE / "anh-thu-vien").exists():
            shutil.copytree(old / "anh-thu-vien", BASE / "anh-thu-vien")
            copied.append("anh-thu-vien/")
        print(f" Đã chép dữ liệu cũ từ {old}: {', '.join(copied)}")
        return


def main():
    migrate_old_folder()
    init_db()
    init_rank_db()
    init_audit_db()
    costs.setup(db, _db_lock, load_config, autopost.save_config)
    auth.setup(db, _db_lock, load_config)
    autopost.setup(db, _db_lock, load_config, CONFIG_PATH, BASE)
    geo.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
    backlinks.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
    gsc.setup(db, _db_lock, load_config, autopost.claude, autopost.save_config, BASE)
    topics.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
    aiq.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
    smap.setup(db, _db_lock, load_config, dfs_post, autopost.claude, autopost.save_config)
    cfg = load_config()
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps({"login": "", "password": "", "usd_vnd": 26000,
                                           "anthropic_api_key": "", "anthropic_model": "claude-sonnet-5-5",
                                           "pexels_api_key": "", "ap_variables": []}, indent=2),
                               encoding="utf-8")
    server_mode = "--server" in sys.argv
    host = (cfg.get("bind_host") or HOST) if server_mode else HOST
    port = int(cfg.get("port") or PORT)
    if server_mode and not auth.enabled():
        print("[!] Chế độ máy chủ cần bật đăng nhập Google: điền google_client_id, google_client_secret,")
        print("    public_url và allowed_emails trong config.json (xem TRIEN_KHAI.md). Đã dừng để bảo vệ dữ liệu.")
        sys.exit(1)
    if host not in ("127.0.0.1", "localhost", "::1") and not auth.enabled():
        print("[!] Không mở công cụ ra mạng khi chưa bật đăng nhập. Đã chuyển về 127.0.0.1.")
        host = "127.0.0.1"
    url = cfg.get("public_url") if server_mode and cfg.get("public_url") else f"http://{host}:{port}"
    print("=" * 52)
    print(" Mr.Vũ SEO Studio đang chạy tại", url)
    print(" Trạng thái API:", "ĐÃ CẤU HÌNH" if cfg["login"] else "chưa có tài khoản (dùng dữ liệu mẫu)")
    print(" Đăng nhập Google:", f"BẬT ({len(auth.conf()['emails'])} email được phép)" if auth.enabled() else "tắt (chỉ dùng trên máy này)")
    print(" Tắt: bấm Ctrl+C hoặc đóng cửa sổ này")
    print("=" * 52)
    srv = ThreadingHTTPServer((host, port), Handler)
    if "--no-browser" not in sys.argv and not server_mode:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
