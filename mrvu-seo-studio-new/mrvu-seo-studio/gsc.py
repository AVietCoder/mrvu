"""
Kết nối Google Search Console + Google Analytics 4 bằng service account (không cần thư viện ngoài),
đồng bộ dữ liệu về máy, phân tích cơ hội từ khóa, chất lượng trang, index, lập kế hoạch nội dung
và báo cáo tư vấn tổng thể bằng AI.
"""
import base64
import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import audit

db = LOCK = load_config = claude = save_config = None
KEY_PATH = None
JOBS = {}
_token = {"value": None, "exp": 0}
SCOPES = "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly"
QUESTION = re.compile(r"\?|\b(là gì|như thế nào|thế nào|có nên|có tốt|có tốn|bao nhiêu|tại sao|vì sao|cách|khi nào|ở đâu|loại nào|nên mua|so sánh|có phải|bao lâu|ra sao|hướng dẫn|kinh nghiệm)\b", re.I)
# CTR tham khảo theo vị trí (ước tính trung bình ngành, dùng để so sánh tương đối)
CTR_CURVE = {1: .28, 2: .155, 3: .10, 4: .072, 5: .053, 6: .041, 7: .032, 8: .026, 9: .022, 10: .019}


def exp_ctr(pos):
    p = max(1, round(pos or 50))
    return CTR_CURVE.get(p, .012 if p <= 15 else .007 if p <= 20 else .003)


def setup(db_func, lock, load_cfg, claude_func, save_cfg, base_dir):
    global db, LOCK, load_config, claude, save_config, KEY_PATH
    db, LOCK, load_config, claude, save_config = db_func, lock, load_cfg, claude_func, save_cfg
    KEY_PATH = Path(base_dir) / "google-service-account.json"
    with LOCK, db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS gsc_rows(period TEXT, query TEXT, page TEXT, clicks INTEGER, impressions INTEGER, ctr REAL, position REAL);
        CREATE INDEX IF NOT EXISTS ix_gsc_rows ON gsc_rows(period, query);
        CREATE TABLE IF NOT EXISTS gsc_pages(period TEXT, page TEXT, clicks INTEGER, impressions INTEGER, ctr REAL, position REAL);
        CREATE TABLE IF NOT EXISTS gsc_daily(date TEXT PRIMARY KEY, clicks INTEGER, impressions INTEGER, ctr REAL, position REAL);
        CREATE TABLE IF NOT EXISTS ga_pages(period TEXT, path TEXT, sessions INTEGER, engaged INTEGER, engagement_rate REAL, key_events REAL, avg_duration REAL);
        CREATE TABLE IF NOT EXISTS ga_daily(date TEXT PRIMARY KEY, sessions INTEGER, key_events REAL);
        CREATE TABLE IF NOT EXISTS gsc_inspect(url TEXT PRIMARY KEY, at TEXT, verdict TEXT, coverage TEXT, indexing TEXT, robots TEXT,
            fetch TEXT, google_canonical TEXT, user_canonical TEXT, last_crawl TEXT, mobile TEXT);
        CREATE TABLE IF NOT EXISTS gsc_ai(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref TEXT, at TEXT, data_json TEXT);
        CREATE TABLE IF NOT EXISTS gsc_meta(key TEXT PRIMARY KEY, value TEXT);
        """)


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def meta(key, value=None):
    with LOCK if value is not None else _nolock(), db() as conn:
        if value is not None:
            conn.execute("INSERT OR REPLACE INTO gsc_meta(key, value) VALUES (?,?)", (key, json.dumps(value, ensure_ascii=False)))
            return value
        r = conn.execute("SELECT value FROM gsc_meta WHERE key=?", (key,)).fetchone()
        return json.loads(r["value"]) if r else None


class _nolock:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


# ================================================================ Xác thực service account (RS256 bằng Python thuần)
def _der(b, i):
    tag = b[i]
    ln = b[i + 1]
    i += 2
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(b[i:i + n], "big")
        i += n
    return tag, b[i:i + ln], i + ln


def rsa_key(pem):
    body = "".join(l for l in pem.strip().splitlines() if "-----" not in l)
    der = base64.b64decode(body)
    _, seq, _ = _der(der, 0)
    _, _, i = _der(seq, 0)                 # version
    t, v, j = _der(seq, i)
    if t == 0x30:                          # PKCS#8: AlgorithmIdentifier, rồi OCTET STRING chứa RSAPrivateKey
        _, octet, _ = _der(seq, j)
        _, rsa, _ = _der(octet, 0)
    else:                                  # PKCS#1
        rsa = seq
    ints, k = [], 0
    while k < len(rsa) and len(ints) < 9:
        t, v, k = _der(rsa, k)
        ints.append(int.from_bytes(v, "big"))
    _, n, e, d, p, q, dp, dq, qi = ints
    return {"n": n, "d": d, "p": p, "q": q, "dp": dp, "dq": dq, "qi": qi}


def rsa_sign(key, msg):
    digest_info = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(msg).digest()
    k = (key["n"].bit_length() + 7) // 8
    em = b"\x00\x01" + b"\xff" * (k - len(digest_info) - 3) + b"\x00" + digest_info
    m = int.from_bytes(em, "big")
    m1, m2 = pow(m, key["dp"], key["p"]), pow(m, key["dq"], key["q"])
    s = m2 + key["q"] * ((key["qi"] * (m1 - m2)) % key["p"])
    return s.to_bytes(k, "big")


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def load_key():
    if not KEY_PATH.exists():
        raise RuntimeError("Chưa có file khóa service account. Vào mục Kết nối để tải file JSON lên.")
    return json.loads(KEY_PATH.read_text(encoding="utf-8"))


def token():
    if _token["value"] and _token["exp"] > time.time() + 60:
        return _token["value"]
    sa = load_key()
    iat = int(time.time())
    head = b64u(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64u(json.dumps({"iss": sa["client_email"], "scope": SCOPES, "aud": sa.get("token_uri", "https://oauth2.googleapis.com/token"),
                              "iat": iat, "exp": iat + 3600}).encode())
    sig = b64u(rsa_sign(rsa_key(sa["private_key"]), f"{head}.{claims}".encode()))
    body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": f"{head}.{claims}.{sig}"}).encode()
    req = urllib.request.Request(sa.get("token_uri", "https://oauth2.googleapis.com/token"), data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Google từ chối file khóa ({e.code}): {e.read().decode('utf-8', 'replace')[:200]}. Kiểm tra file JSON có đúng và chưa bị xóa trong Google Cloud.")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Không kết nối được Google: {e.reason}")
    _token.update(value=data["access_token"], exp=time.time() + int(data.get("expires_in", 3600)))
    return _token["value"]


def gcall(url, body=None, method=None, service="GSC"):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method or ("POST" if body is not None else "GET"),
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(txt).get("error", {})
            msg = err.get("message", txt)
        except Exception:  # noqa: BLE001
            msg = txt
        email = ""
        try:
            email = load_key().get("client_email", "")
        except Exception:  # noqa: BLE001
            pass
        if "has not been used" in msg or "is disabled" in msg or "SERVICE_DISABLED" in txt:
            api = "Google Analytics Data API" if service == "GA4" else "Google Search Console API"
            raise RuntimeError(f"Chưa bật {api} trong Google Cloud. Vào APIs & Services → Library, tìm “{api}” và bấm Enable, đợi 2–3 phút rồi thử lại.")
        if e.code == 403:
            where = "GA4 (Quản trị → Quản lý quyền truy cập thuộc tính → thêm vai trò Người xem)" if service == "GA4" else \
                "Search Console (Cài đặt → Người dùng và quyền → Thêm người dùng, quyền Hạn chế)"
            raise RuntimeError(f"Tài khoản {email} chưa được cấp quyền trong {where}.")
        if e.code == 404 and service == "GA4":
            raise RuntimeError("Không tìm thấy GA4 Property ID. Kiểm tra lại dãy số trong Quản trị → Cài đặt thuộc tính.")
        raise RuntimeError(f"{service} lỗi {e.code}: {msg[:200]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Không kết nối được Google: {e.reason}")


# ================================================================ Đọc dữ liệu
def list_sites():
    data = gcall("https://www.googleapis.com/webmasters/v3/sites")
    return [{"site": s["siteUrl"], "permission": s.get("permissionLevel")} for s in data.get("siteEntry", [])
            if s.get("permissionLevel") != "siteUnverifiedUser"]


def gsc_query(site, start, end, dims, limit=25000, max_rows=50000):
    url = f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(site, safe='')}/searchAnalytics/query"
    out, start_row = [], 0
    while start_row < max_rows:
        data = gcall(url, {"startDate": str(start), "endDate": str(end), "dimensions": dims, "rowLimit": limit, "startRow": start_row, "dataState": "final"})
        rows = data.get("rows") or []
        out += rows
        if len(rows) < limit:
            break
        start_row += limit
    return out


def ga_report(prop, start, end, dims, metrics, organic=True, limit=10000):
    body = {"dateRanges": [{"startDate": str(start), "endDate": str(end)}], "dimensions": [{"name": d} for d in dims],
            "metrics": [{"name": m} for m in metrics], "limit": limit}
    if organic:
        body["dimensionFilter"] = {"filter": {"fieldName": "sessionDefaultChannelGroup", "stringFilter": {"value": "Organic Search"}}}
    data = gcall(f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", body, service="GA4")
    rows = []
    for r in data.get("rows") or []:
        rows.append([d["value"] for d in r["dimensionValues"]] + [float(m["value"] or 0) for m in r["metricValues"]])
    return rows


def periods():
    end = date.today() - timedelta(days=3)
    return {"cur": (end - timedelta(days=27), end), "prev": (end - timedelta(days=55), end - timedelta(days=28)),
            "old": (end - timedelta(days=118), end - timedelta(days=91)), "daily": (end - timedelta(days=119), end)}


def cfg_site():
    cfg = load_config()
    site = cfg.get("gsc_site")
    if not site:
        raise RuntimeError("Chưa chọn website Search Console ở mục Kết nối.")
    return site, (cfg.get("ga_property") or "").strip()


def site_domain(site):
    s = site.replace("sc-domain:", "")
    return audit.bare_host(urlparse(s if "://" in s else "https://" + s).netloc)


def sync(progress=lambda m: None):
    site, prop = cfg_site()
    P = periods()
    data = {}
    progress("Đang lấy từ khóa × trang 28 ngày gần nhất…")
    data["rows_cur"] = gsc_query(site, *P["cur"], ["query", "page"])
    progress("Đang lấy từ khóa × trang 28 ngày trước đó…")
    data["rows_prev"] = gsc_query(site, *P["prev"], ["query", "page"])
    progress("Đang lấy số liệu theo trang…")
    pages = {k: gsc_query(site, *P[k], ["page"]) for k in ("cur", "prev", "old")}
    progress("Đang lấy số liệu theo ngày…")
    daily = gsc_query(site, *P["daily"], ["date"])
    ga = {}
    ga_err = None
    if prop:
        progress("Đang lấy dữ liệu Google Analytics 4…")
        try:
            mets = ["sessions", "engagedSessions", "engagementRate", "keyEvents", "averageSessionDuration"]
            for k in ("cur", "prev"):
                ga[k] = ga_report(prop, *P[k], ["landingPagePlusQueryString"], mets)
            ga["daily"] = ga_report(prop, *P["daily"], ["date"], ["sessions", "keyEvents"])
        except RuntimeError as e:
            ga_err = str(e)
            ga = {}
    with LOCK, db() as conn:
        for t in ("gsc_rows", "gsc_pages", "gsc_daily"):
            conn.execute(f"DELETE FROM {t}")
        for per, rows in (("cur", data["rows_cur"]), ("prev", data["rows_prev"])):
            conn.executemany("INSERT INTO gsc_rows VALUES (?,?,?,?,?,?,?)",
                             [(per, r["keys"][0], r["keys"][1], r["clicks"], r["impressions"], r["ctr"], r["position"]) for r in rows])
        for per, rows in pages.items():
            conn.executemany("INSERT INTO gsc_pages VALUES (?,?,?,?,?,?)",
                             [(per, r["keys"][0], r["clicks"], r["impressions"], r["ctr"], r["position"]) for r in rows])
        conn.executemany("INSERT OR REPLACE INTO gsc_daily VALUES (?,?,?,?,?)",
                         [(r["keys"][0], r["clicks"], r["impressions"], r["ctr"], r["position"]) for r in daily])
        if ga:
            conn.execute("DELETE FROM ga_pages")
            conn.execute("DELETE FROM ga_daily")
            for per in ("cur", "prev"):
                conn.executemany("INSERT INTO ga_pages VALUES (?,?,?,?,?,?,?)", [(per, *r) for r in ga[per]])
            conn.executemany("INSERT OR REPLACE INTO ga_daily VALUES (?,?,?)",
                             [(f"{r[0][:4]}-{r[0][4:6]}-{r[0][6:]}", int(r[1]), r[2]) for r in ga["daily"]])
    info = {"at": now(), "site": site, "ga_property": prop, "ga_error": ga_err, "periods": {k: [str(a), str(b)] for k, (a, b) in P.items()},
            "rows": len(data["rows_cur"]), "pages": len(pages["cur"])}
    meta("last_sync", info)
    return info


# ================================================================ Phân tích
def agg_queries(period="cur"):
    with db() as conn:
        rows = conn.execute("SELECT query, page, clicks, impressions, position FROM gsc_rows WHERE period=?", (period,)).fetchall()
    q = {}
    for r in rows:
        a = q.setdefault(r["query"], {"query": r["query"], "clicks": 0, "impressions": 0, "_pw": 0.0, "pages": []})
        a["clicks"] += r["clicks"]
        a["impressions"] += r["impressions"]
        a["_pw"] += r["position"] * r["impressions"]
        a["pages"].append({"page": r["page"], "clicks": r["clicks"], "impressions": r["impressions"], "position": round(r["position"], 1)})
    for a in q.values():
        a["position"] = round(a.pop("_pw") / a["impressions"], 1) if a["impressions"] else None
        a["ctr"] = a["clicks"] / a["impressions"] if a["impressions"] else 0
        a["pages"].sort(key=lambda p: -p["impressions"])
        a["page"] = a["pages"][0]["page"] if a["pages"] else ""
    return q


def page_map(period):
    with db() as conn:
        return {r["page"]: dict(r) for r in conn.execute("SELECT * FROM gsc_pages WHERE period=?", (period,)).fetchall()}


def volumes():
    out = {}
    with db() as conn:
        try:
            for r in conn.execute("SELECT rows_json FROM sessions ORDER BY created_at").fetchall():
                for row in json.loads(r["rows_json"]):
                    if row.get("volume") is not None:
                        out[row["keyword"]] = row["volume"]
        except Exception:  # noqa: BLE001
            pass
    return out


def tracked_set():
    with db() as conn:
        try:
            return {r["keyword"] for r in conn.execute("SELECT keyword FROM tracked").fetchall()}
        except Exception:  # noqa: BLE001
            return set()


def overview():
    info = meta("last_sync")
    if not info:
        return {"synced": False}
    P = info["periods"]
    with db() as conn:
        daily = [dict(r) for r in conn.execute("SELECT * FROM gsc_daily ORDER BY date").fetchall()]
        gad = {r["date"]: dict(r) for r in conn.execute("SELECT * FROM ga_daily").fetchall()}
        ga_cur = conn.execute("SELECT SUM(sessions) s, SUM(key_events) k, SUM(engaged) e FROM ga_pages WHERE period='cur'").fetchone()
        ga_prev = conn.execute("SELECT SUM(sessions) s, SUM(key_events) k, SUM(engaged) e FROM ga_pages WHERE period='prev'").fetchone()

    def tot(a, b):
        rows = [d for d in daily if a <= d["date"] <= b]
        c, i = sum(d["clicks"] for d in rows), sum(d["impressions"] for d in rows)
        pos = sum(d["position"] * d["impressions"] for d in rows) / i if i else None
        return {"clicks": c, "impressions": i, "ctr": c / i if i else 0, "position": round(pos, 1) if pos else None}
    cur, prev = tot(*P["cur"]), tot(*P["prev"])
    pc, pp = page_map("cur"), page_map("prev")
    movers = []
    for u in set(pc) | set(pp):
        a, b = pc.get(u, {}).get("clicks", 0), pp.get(u, {}).get("clicks", 0)
        if a or b:
            movers.append({"page": u, "clicks": a, "prev": b, "delta": a - b})
    movers.sort(key=lambda x: x["delta"])
    q = agg_queries("cur")
    top_q = sorted(q.values(), key=lambda x: -x["clicks"])[:15]
    for x in top_q:
        x.pop("pages", None)
    series = [{"date": d["date"], "clicks": d["clicks"], "impressions": d["impressions"],
               "sessions": gad.get(d["date"], {}).get("sessions"), "key_events": gad.get(d["date"], {}).get("key_events")} for d in daily]
    ga = None
    if ga_cur and ga_cur["s"]:
        ga = {"sessions": int(ga_cur["s"]), "sessions_prev": int(ga_prev["s"] or 0), "key_events": ga_cur["k"] or 0,
              "key_events_prev": ga_prev["k"] or 0, "engagement_rate": (ga_cur["e"] or 0) / ga_cur["s"]}
    return {"synced": True, "sync": info, "cur": cur, "prev": prev, "ga": ga, "series": series,
            "gainers": [m for m in reversed(movers) if m["delta"] > 0][:8], "losers": [m for m in movers if m["delta"] < 0][:8],
            "top_queries": top_q, "query_count": len(q)}


def opportunities(kind, min_impr=None):
    q = agg_queries("cur")
    qp = agg_queries("prev")
    vols, tracked = volumes(), tracked_set()
    info = meta("last_sync") or {}
    brand = site_domain(info.get("site", "")).split(".")[0] if info.get("site") else "#"
    out = []
    if kind == "striking":
        mi = min_impr or 30
        for a in q.values():
            if a["position"] and 4 <= a["position"] <= 20 and a["impressions"] >= mi:
                gain = a["impressions"] * max(0, exp_ctr(3) - a["ctr"])
                prev = qp.get(a["query"])
                out.append({**{k: a[k] for k in ("query", "clicks", "impressions", "ctr", "position", "page")},
                            "prev_position": prev["position"] if prev else None, "gain": round(gain),
                            "volume": vols.get(a["query"]), "tracked": a["query"] in tracked})
        out.sort(key=lambda x: -x["gain"])
    elif kind == "lowctr":
        mi = min_impr or 100
        qs = {}
        for a in q.values():
            for p in a["pages"]:
                qs.setdefault(p["page"], []).append((a["query"], p["impressions"], p["clicks"], p["position"]))
        for u, p in page_map("cur").items():
            if p["position"] <= 10 and p["impressions"] >= mi and p["ctr"] < .6 * exp_ctr(p["position"]):
                top = sorted(qs.get(u, []), key=lambda x: -x[1])[:5]
                out.append({"page": u, "clicks": p["clicks"], "impressions": p["impressions"], "ctr": p["ctr"], "position": round(p["position"], 1),
                            "expected_ctr": exp_ctr(p["position"]), "missed": round(p["impressions"] * (exp_ctr(p["position"]) - p["ctr"])),
                            "queries": [t[0] for t in top]})
        out.sort(key=lambda x: -x["missed"])
    elif kind == "cannibal":
        for a in q.values():
            if a["impressions"] < (min_impr or 30) or brand in a["query"].replace(" ", ""):
                continue
            ps = [p for p in a["pages"] if p["impressions"] >= max(5, .1 * a["impressions"]) and p["position"] <= 40]
            if len(ps) >= 2:
                out.append({"query": a["query"], "impressions": a["impressions"], "clicks": a["clicks"], "position": a["position"], "pages": ps[:4]})
        out.sort(key=lambda x: -x["impressions"])
    elif kind == "decay":
        old, cur, prev = page_map("old"), page_map("cur"), page_map("prev")
        for u, o in old.items():
            c = cur.get(u, {"clicks": 0, "position": None, "impressions": 0})
            if o["clicks"] >= 20 and c["clicks"] <= .7 * o["clicks"]:
                out.append({"page": u, "clicks_old": o["clicks"], "clicks": c["clicks"], "clicks_prev": prev.get(u, {}).get("clicks", 0),
                            "drop": round((o["clicks"] - c["clicks"]) / o["clicks"] * 100), "position_old": round(o["position"], 1),
                            "position": round(c["position"], 1) if c.get("position") else None})
        out.sort(key=lambda x: -(x["clicks_old"] - x["clicks"]))
    elif kind == "gaps":
        mi = min_impr or 20
        for a in q.values():
            if brand in a["query"].replace(" ", ""):
                continue
            is_q = bool(QUESTION.search(a["query"]))
            if a["impressions"] >= mi and (a["position"] > 20 or (is_q and a["position"] > 10)):
                out.append({**{k: a[k] for k in ("query", "clicks", "impressions", "position", "page")}, "question": is_q,
                            "volume": vols.get(a["query"])})
        out.sort(key=lambda x: -(x["volume"] or 0) * 10 - x["impressions"])
    return out[:300]


def ranks_merge():
    info = meta("last_sync")
    if not info:
        return {"items": [], "suggest": []}
    dom = site_domain(info["site"])
    q = agg_queries("cur")
    items = []
    with db() as conn:
        try:
            tr = conn.execute("SELECT * FROM tracked WHERE domain=?", (dom,)).fetchall()
            for t in tr:
                g = conn.execute("SELECT position, checked_at FROM ranks WHERE tracked_id=? AND engine='google' ORDER BY checked_at DESC LIMIT 1", (t["id"],)).fetchone()
                a = q.get(t["keyword"])
                items.append({"keyword": t["keyword"], "rank": g["position"] if g else None, "rank_at": g["checked_at"] if g else None, "checked": bool(g),
                              "gsc_position": a["position"] if a else None, "clicks": a["clicks"] if a else 0, "impressions": a["impressions"] if a else 0,
                              "page": a["page"] if a else None})
        except Exception:  # noqa: BLE001
            pass
    have = {i["keyword"] for i in items}
    suggest = [{"query": a["query"], "clicks": a["clicks"], "impressions": a["impressions"], "position": a["position"]}
               for a in sorted(q.values(), key=lambda x: -(x["clicks"] * 5 + x["impressions"] / 10)) if a["query"] not in have][:30]
    return {"domain": dom, "items": items, "suggest": suggest}


def norm_path(u):
    p = urlparse(u)
    return (p.path or "/") + (("?" + p.query) if p.query else "")


def quality():
    with db() as conn:
        ga = [dict(r) for r in conn.execute("SELECT * FROM ga_pages WHERE period='cur'").fetchall()]
    if not ga:
        return {"has_ga": False}
    gsc = {}
    for u, p in page_map("cur").items():
        gsc[norm_path(u)] = p
    tot_s = sum(r["sessions"] for r in ga) or 1
    avg_er = sum(r["engaged"] for r in ga) / tot_s
    tot_k = sum(r["key_events"] for r in ga)
    rows = []
    for r in ga:
        g = gsc.get(r["path"], {})
        flags = []
        if r["sessions"] >= 30 and r["engagement_rate"] < avg_er * .7:
            flags.append("low_engagement")
        if r["sessions"] >= 50 and r["key_events"] == 0 and tot_k > 0:
            flags.append("no_conversion")
        if r["key_events"] > 0 and r["sessions"] and r["key_events"] / r["sessions"] >= 2 * (tot_k / tot_s):
            flags.append("top_converting")
        rows.append({**r, "conv_rate": r["key_events"] / r["sessions"] if r["sessions"] else 0, "gsc_clicks": g.get("clicks"),
                     "gsc_position": round(g["position"], 1) if g.get("position") else None, "flags": flags})
    rows.sort(key=lambda x: -x["sessions"])
    return {"has_ga": True, "avg_engagement": avg_er, "conv_rate": tot_k / tot_s, "sessions": tot_s, "key_events": tot_k, "items": rows[:300]}


# ---------------------------------------------------------------- Index
def inspect_urls(urls, progress=lambda m: None):
    site, _ = cfg_site()
    done = 0
    for u in urls:
        progress(f"Đang kiểm tra index {done + 1}/{len(urls)}…")
        try:
            r = gcall("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
                      {"inspectionUrl": u, "siteUrl": site, "languageCode": "vi"})
        except RuntimeError as e:
            if "429" in str(e) or "quota" in str(e).lower():
                raise RuntimeError(f"Đã hết hạn mức kiểm tra index hôm nay (khoảng 2.000 URL/ngày). Đã kiểm {done} URL.")
            raise
        ir = (r.get("inspectionResult") or {})
        s = ir.get("indexStatusResult") or {}
        mob = (ir.get("mobileUsabilityResult") or {}).get("verdict", "")
        with LOCK, db() as conn:
            conn.execute("INSERT OR REPLACE INTO gsc_inspect VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (u, now(), s.get("verdict"), s.get("coverageState"), s.get("indexingState"), s.get("robotsTxtState"),
                          s.get("pageFetchState"), s.get("googleCanonical"), s.get("userCanonical"), s.get("lastCrawlTime"), mob))
        done += 1
        time.sleep(0.15)
    return {"checked": done}


def index_candidates(limit=50):
    pc = page_map("cur")
    urls = [u for u, _ in sorted(pc.items(), key=lambda x: -x[1]["impressions"])][:limit]
    info = meta("last_sync") or {}
    dom = site_domain(info.get("site", ""))
    zero = []
    with db() as conn:
        try:
            for r in conn.execute("""SELECT p.url FROM audit_pages p JOIN audit_sites s ON s.id=p.site_id WHERE s.domain=?""", (dom,)).fetchall():
                if r["url"] not in pc:
                    zero.append(r["url"])
        except Exception:  # noqa: BLE001
            pass
    return urls, zero


def index_list():
    with db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM gsc_inspect ORDER BY at DESC").fetchall()]
    for r in rows:
        issues = []
        if r["verdict"] and r["verdict"] != "PASS":
            issues.append("not_indexed")
        if r["google_canonical"] and r["user_canonical"] and r["google_canonical"].rstrip("/") != r["user_canonical"].rstrip("/"):
            issues.append("canonical")
        if r["robots"] and r["robots"] != "ALLOWED":
            issues.append("robots")
        if r["fetch"] and r["fetch"] != "SUCCESSFUL":
            issues.append("fetch")
        r["issues"] = issues
    return rows


# ---------------------------------------------------------------- AI
def ai_json(prompt, max_tokens=4000, tag=None):
    cfg = load_config()
    if not cfg.get("anthropic_api_key"):
        raise RuntimeError("Cần khóa Claude API (nhập ở tab Autopost → Cài đặt).")
    txt, usage, _ = claude(cfg, prompt, max_tokens, tag=tag)
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        raise RuntimeError("AI trả về nội dung không đúng định dạng, hãy thử lại.")
    out = json.loads(m.group(0))
    out["usage"] = usage
    return out


def save_ai(kind, ref, data):
    with LOCK, db() as conn:
        cur = conn.execute("INSERT INTO gsc_ai(kind, ref, at, data_json) VALUES (?,?,?,?)", (kind, ref, now(), json.dumps(data, ensure_ascii=False)))
        return cur.lastrowid


def get_ai(kind, ref=None):
    with db() as conn:
        if ref is None:
            r = conn.execute("SELECT * FROM gsc_ai WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)).fetchone()
        else:
            r = conn.execute("SELECT * FROM gsc_ai WHERE kind=? AND ref=? ORDER BY id DESC LIMIT 1", (kind, ref)).fetchone()
    return {**json.loads(r["data_json"]), "id": r["id"], "at": r["at"]} if r else None


def ai_title(page):
    q = agg_queries("cur")
    qs = sorted([(a["query"], p["impressions"], p["clicks"], p["position"]) for a in q.values() for p in a["pages"] if p["page"] == page],
                key=lambda x: -x[1])[:15]
    res = audit.fetch(page, timeout=20)
    title = desc = h1 = ""
    if res["status"] == 200:
        p = audit.PageParser()
        try:
            p.feed(audit.decode(res))
        except Exception:  # noqa: BLE001
            pass
        title, desc = p.title or "", p.meta.get("description", "")
        h1 = next((t for lv, t in p.headings if lv == 1), "")
    cfg = load_config()
    vars_txt = "\n".join(f"- {v['name']}: {v['value']}" for v in cfg.get("ap_variables") or [] if v.get("value"))
    prompt = f"""Bạn là chuyên gia SEO tiếng Việt. Trang dưới đây có thứ hạng tốt nhưng tỷ lệ click (CTR) thấp trên Google. Hãy viết lại title và meta description để tăng click.

URL: {page}
Title hiện tại: {title}
Meta description hiện tại: {desc}
H1: {h1}
Từ khóa đang mang hiển thị (từ khóa | lượt hiển thị | click | vị trí):
{chr(10).join(f'- {a} | {b} | {c} | {d}' for a, b, c, d in qs)}
Thông tin doanh nghiệp (chỉ dùng thông tin có ở đây):
{vars_txt or '- (không có)'}

Yêu cầu: title 50-60 ký tự, từ khóa chính ở đầu, có yếu tố khiến người tìm muốn bấm (con số, lợi ích, năm, giải đáp trực tiếp); meta 120-155 ký tự, trả lời đúng ý định tìm kiếm, có lời kêu gọi. Không bịa giá, khuyến mãi.
Chỉ trả về JSON: {{"diagnosis": "vì sao CTR thấp (1-2 câu)", "titles": ["3 phương án"], "metas": ["2 phương án"]}}"""
    out = ai_json(prompt, 1500, "gsc_title")
    out["current"] = {"title": title, "meta": desc}
    save_ai("title", page, out)
    return out


def ai_plan(progress=lambda m: None):
    progress("Đang gom dữ liệu từ khóa…")
    st = opportunities("striking")[:40]
    gp = opportunities("gaps")[:100]
    dc = opportunities("decay")[:15]
    cn = opportunities("cannibal")[:10]
    info = meta("last_sync") or {}
    pc = page_map("cur")
    pages = [u for u, _ in sorted(pc.items(), key=lambda x: -x[1]["impressions"])][:80]
    prompt = f"""Bạn là trưởng nhóm nội dung SEO cho website {site_domain(info.get('site', ''))} (tiếng Việt). Dựa trên dữ liệu Google Search Console THẬT của 28 ngày qua, lập kế hoạch nội dung 6 tuần.

TỪ KHÓA SẮP LÊN TOP (vị trí 4-20) — query | hiển thị | vị trí | trang đang xếp hạng | volume:
{chr(10).join(f"- {x['query']} | {x['impressions']} | {x['position']} | {x['page']} | {x['volume'] or ''}" for x in st)}

TỪ KHÓA CHƯA CÓ BÀI TỐT (Google hiển thị nhưng vị trí kém, hoặc câu hỏi) — query | hiển thị | vị trí | volume:
{chr(10).join(f"- {x['query']} | {x['impressions']} | {x['position']} | {x['volume'] or ''}" for x in gp)}

BÀI ĐANG TỤT — trang | click 3 tháng trước → nay:
{chr(10).join(f"- {x['page']} | {x['clicks_old']} → {x['clicks']}" for x in dc) or '- không có'}

TỪ KHÓA BỊ NHIỀU TRANG TRANH NHAU:
{chr(10).join(f"- {x['query']}: " + ', '.join(p['page'] for p in x['pages']) for x in cn) or '- không có'}

CÁC TRANG HIỆN CÓ:
{chr(10).join(pages)}

Quy tắc: gom từ khóa cùng ý định vào một bài (cụm chủ đề), không tạo bài mới trùng chủ đề với trang đã có (khi đó là "update"); ưu tiên việc có tác động nhanh (cập nhật bài sắp lên top, bài đang tụt) ở tuần đầu; 2-4 việc mỗi tuần.
Chỉ trả về JSON:
{{"summary": "2-3 câu nhận định chiến lược",
  "items": [{{"week": 1, "type": "new|update|merge", "title": "tiêu đề bài đề xuất", "main_keyword": "...", "supporting_keywords": ["..."],
             "target_url": "URL cần cập nhật/gộp (rỗng nếu bài mới)", "reason": "lý do dựa trên số liệu", "outline": ["H2: ..."], "impact": "cao|trung bình|thấp"}}]}}"""
    progress("AI đang lập kế hoạch…")
    out = ai_json(prompt, 7000, "gsc_plan")
    save_ai("plan", "", out)
    return {"items": len(out.get("items", []))}


def collect_context():
    ctx = {}
    ov = overview()
    if ov.get("synced"):
        ctx["gsc_28d"] = {"now": ov["cur"], "previous": ov["prev"], "ga": ov["ga"],
                          "top_gainers": ov["gainers"][:5], "top_losers": ov["losers"][:5], "top_queries": ov["top_queries"][:10]}
        ctx["striking"] = [{k: x[k] for k in ("query", "impressions", "position", "page", "gain")} for x in opportunities("striking")[:15]]
        ctx["low_ctr"] = [{k: x[k] for k in ("page", "impressions", "ctr", "position", "missed")} for x in opportunities("lowctr")[:8]]
        ctx["cannibal"] = [{"query": x["query"], "pages": [p["page"] for p in x["pages"]]} for x in opportunities("cannibal")[:6]]
        ctx["decay"] = [{k: x[k] for k in ("page", "clicks_old", "clicks", "drop")} for x in opportunities("decay")[:8]]
        ctx["gaps"] = [x["query"] for x in opportunities("gaps")[:20]]
        ql = quality()
        if ql.get("has_ga"):
            ctx["ga_quality"] = {"avg_engagement": round(ql["avg_engagement"], 3), "conv_rate": round(ql["conv_rate"], 4),
                                 "flagged": [{k: r[k] for k in ("path", "sessions", "engagement_rate", "key_events", "flags")} for r in ql["items"] if r["flags"]][:12]}
        ix = index_list()
        if ix:
            ctx["index"] = {"checked": len(ix), "issues": [{"url": r["url"], "issues": r["issues"], "coverage": r["coverage"]} for r in ix if r["issues"]][:12]}
        dom = site_domain(ov["sync"]["site"])
    else:
        dom = ""
    with db() as conn:
        try:
            rk = ranks_merge()
            ctx["rank_tracker"] = [{k: i[k] for k in ("keyword", "rank", "gsc_position", "clicks")} for i in rk["items"]][:30]
        except Exception:  # noqa: BLE001
            pass
        try:
            r = conn.execute("""SELECT AVG(score) avg, COUNT(*) n FROM audit_results WHERE id IN (SELECT MAX(id) FROM audit_results GROUP BY page_id)""").fetchone()
            worst = conn.execute("""SELECT p.url, r.score FROM audit_results r JOIN audit_pages p ON p.id=r.page_id
                WHERE r.id IN (SELECT MAX(id) FROM audit_results GROUP BY page_id) ORDER BY r.score LIMIT 8""").fetchall()
            if r["n"]:
                ctx["audit"] = {"pages_audited": r["n"], "avg_score": round(r["avg"]), "worst": [dict(w) for w in worst]}
        except Exception:  # noqa: BLE001
            pass
        try:
            g = conn.execute("SELECT keyword, url, score, has_aio, cited FROM geo_checks ORDER BY id DESC LIMIT 10").fetchall()
            if g:
                ctx["geo"] = [dict(x) for x in g]
        except Exception:  # noqa: BLE001
            pass
        try:
            s = conn.execute("""SELECT b.summary_json, b.at, b.source FROM bl_snapshots b JOIN bl_sites s ON s.id=b.site_id WHERE s.domain=? ORDER BY b.id DESC LIMIT 2""", (dom,)).fetchall()
            if s:
                ctx["backlinks"] = {"now": json.loads(s[0]["summary_json"]), "at": s[0]["at"], "source": s[0]["source"],
                                    "previous": json.loads(s[1]["summary_json"]) if len(s) > 1 else None}
            o = conn.execute("""SELECT status, COUNT(*) n FROM bl_opps o JOIN bl_sites s ON s.id=o.site_id WHERE s.domain=? GROUP BY status""", (dom,)).fetchall()
            if o:
                ctx["outreach"] = {r["status"]: r["n"] for r in o}
        except Exception:  # noqa: BLE001
            pass
        try:
            ap = conn.execute("SELECT status, COUNT(*) n FROM ap_posts GROUP BY status").fetchall()
            if ap:
                ctx["autopost"] = {r["status"]: r["n"] for r in ap}
        except Exception:  # noqa: BLE001
            pass
    plan = get_ai("plan")
    if plan:
        ctx["content_plan_summary"] = plan.get("summary")
    return dom, ctx


def ai_report(progress=lambda m: None):
    progress("Đang gom dữ liệu từ mọi tab…")
    dom, ctx = collect_context()
    if not ctx:
        raise RuntimeError("Chưa có dữ liệu để phân tích. Hãy đồng bộ Search Console trước.")
    prompt = f"""Bạn là chuyên gia tư vấn SEO cấp cao, viết báo cáo tháng cho chủ doanh nghiệp website {dom or '(chưa rõ)'} (tiếng Việt, dễ hiểu, không thuật ngữ khó).
Dữ liệu dưới đây lấy từ công cụ nội bộ (Search Console, GA4, Rank Tracker, Audit, AI Overview, Backlink, Autopost). Chỉ kết luận dựa trên số liệu có ở đây; phần nào thiếu dữ liệu thì nói rõ cần thu thập thêm.

DỮ LIỆU:
{json.dumps(ctx, ensure_ascii=False)[:24000]}

Viết báo cáo, trích số liệu cụ thể trong mỗi nhận định. Ưu tiên việc có tác động lớn, làm nhanh. Mỗi việc gắn với một tab của công cụ:
gsc-opps (cơ hội từ khóa GSC), gsc-plan (kế hoạch nội dung), gsc-quality (chất lượng trang GA4), gsc-index (index), rank (Rank Tracker), audit (Audit On-page), geo (AI Overview), autopost (viết bài), backlinks (Backlink).
Chỉ trả về JSON:
{{"headline": "1 câu tóm tắt tình hình",
  "health": 0-100,
  "summary": "đoạn 3-5 câu",
  "wins": ["điểm tích cực, có số liệu"],
  "problems": ["vấn đề chính, có số liệu"],
  "priorities": [{{"title": "việc cần làm", "why": "lý do + số liệu", "action": "các bước cụ thể", "tab": "một mã tab ở trên", "impact": "cao|trung bình|thấp", "effort": "ít|vừa|nhiều"}}],
  "kpis": [{{"metric": "chỉ số", "now": "giá trị hiện tại", "target": "mục tiêu tháng tới"}}],
  "data_gaps": ["dữ liệu còn thiếu nên bổ sung"]}}
priorities: 6-10 việc, sắp theo thứ tự nên làm."""
    progress("AI đang viết báo cáo tư vấn…")
    out = ai_json(prompt, 6000, "gsc_report")
    out["domain"] = dom
    rid = save_ai("report", "", out)
    return {"id": rid}


# ================================================================ Gửi sang tab khác
def send_rank(keywords):
    info = meta("last_sync")
    dom = site_domain(info["site"]) if info else ""
    if not dom:
        raise RuntimeError("Chưa đồng bộ Search Console.")
    added = 0
    with LOCK, db() as conn:
        for k in keywords:
            cur = conn.execute("INSERT OR IGNORE INTO tracked(domain, keyword, location, language, created_at) VALUES (?,?,?,?,?)",
                               (dom, " ".join(k.lower().split()), "2704", "vi", now()))
            added += cur.rowcount
    return {"added": added, "domain": dom}


def send_autopost(site_id, keywords):
    added = 0
    with LOCK, db() as conn:
        for k in keywords:
            cur = conn.execute("INSERT OR IGNORE INTO ap_keywords(site_id, keyword, created_at, updated_at) VALUES (?,?,?,?)",
                               (site_id, " ".join(k.split()), now(), now()))
            added += cur.rowcount
    return {"added": added}


# ================================================================ API
def start(fn, *args):
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {"status": "running", "message": "Đang bắt đầu…"}

    def run():
        try:
            res = fn(*args, progress=lambda m: JOBS[jid].update(message=m))
            JOBS[jid].update(status="done", message="Xong", result=res)
        except Exception as e:  # noqa: BLE001
            JOBS[jid].update(status="error", message=str(e))
    threading.Thread(target=run, daemon=True).start()
    return jid


def status():
    cfg = load_config()
    email = None
    if KEY_PATH.exists():
        try:
            email = load_key().get("client_email")
        except Exception:  # noqa: BLE001
            email = None
    return {"key": bool(email), "client_email": email, "site": cfg.get("gsc_site"), "ga_property": cfg.get("ga_property"),
            "last_sync": meta("last_sync"), "ai": bool(cfg.get("anthropic_api_key"))}


def handle(h, method, path):
    seg = path.split("/")[3:]
    q = parse_qs(urlparse(h.path).query)
    try:
        if seg == ["status"]:
            return h.send_json(status())
        if method == "POST" and seg == ["key"]:
            txt = h.read_json().get("text", "")
            try:
                sa = json.loads(txt)
                assert sa.get("type") == "service_account" and sa.get("private_key") and sa.get("client_email")
                rsa_key(sa["private_key"])
            except Exception:  # noqa: BLE001
                return h.send_json({"error": "File không phải khóa service account hợp lệ. Hãy tải lại file JSON trong Google Cloud → Service Accounts → Keys."}, 400)
            KEY_PATH.write_text(txt, encoding="utf-8")
            _token.update(value=None, exp=0)
            return h.send_json({"client_email": sa["client_email"]})
        if seg == ["sites"]:
            return h.send_json({"items": list_sites()})
        if method == "POST" and seg == ["config"]:
            b = h.read_json()
            prop = re.sub(r"\D", "", str(b.get("ga_property") or ""))
            save_config({"gsc_site": b.get("site") or "", "ga_property": prop})
            return h.send_json({"ok": True})
        if method == "POST" and seg == ["test"]:
            site, prop = cfg_site()
            res = {}
            end = date.today() - timedelta(days=3)
            try:
                rows = gsc_query(site, end - timedelta(days=6), end, ["date"], limit=10, max_rows=10)
                res["gsc"] = {"ok": True, "message": f"Đọc được Search Console: {sum(r['clicks'] for r in rows):,} click trong 7 ngày".replace(",", ".")}
            except RuntimeError as e:
                res["gsc"] = {"ok": False, "message": str(e)}
            if prop:
                try:
                    rows = ga_report(prop, end - timedelta(days=6), end, ["date"], ["sessions"])
                    res["ga"] = {"ok": True, "message": f"Đọc được GA4: {int(sum(r[1] for r in rows)):,} phiên từ Google trong 7 ngày".replace(",", ".")}
                except RuntimeError as e:
                    res["ga"] = {"ok": False, "message": str(e)}
            return h.send_json(res)
        if method == "POST" and seg == ["sync"]:
            cfg_site()
            return h.send_json({"job_id": start(sync)})
        if len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if seg == ["overview"]:
            return h.send_json(overview())
        if seg == ["opps"]:
            kind = q.get("kind", ["striking"])[0]
            mi = q.get("min", [None])[0]
            return h.send_json({"items": opportunities(kind, int(mi) if mi else None)})
        if method == "POST" and seg == ["ai-title"]:
            return h.send_json(ai_title(h.read_json()["page"]))
        if seg == ["ai-title"]:
            return h.send_json(get_ai("title", q.get("page", [""])[0]) or {})
        if method == "POST" and seg == ["plan"]:
            return h.send_json({"job_id": start(ai_plan)})
        if seg == ["plan"]:
            return h.send_json(get_ai("plan") or {})
        if seg == ["ranks"]:
            return h.send_json(ranks_merge())
        if seg == ["quality"]:
            return h.send_json(quality())
        if method == "POST" and seg == ["inspect"]:
            b = h.read_json()
            urls = b.get("urls")
            if not urls:
                top, zero = index_candidates(int(b.get("limit") or 30))
                urls = (zero[:20] if b.get("mode") == "zero" else top)
            urls = [u for u in dict.fromkeys(urls) if u.startswith("http")][:200]
            if not urls:
                return h.send_json({"error": "Không có URL nào để kiểm tra. Đồng bộ dữ liệu hoặc quét website ở tab Audit trước."}, 400)
            return h.send_json({"job_id": start(inspect_urls, urls)})
        if seg == ["inspect"]:
            top, zero = index_candidates(30)
            return h.send_json({"items": index_list(), "zero_count": len(zero)})
        if method == "POST" and seg == ["report"]:
            return h.send_json({"job_id": start(ai_report)})
        if seg == ["reports"]:
            with db() as conn:
                rows = conn.execute("SELECT id, at, data_json FROM gsc_ai WHERE kind='report' ORDER BY id DESC LIMIT 24").fetchall()
            return h.send_json({"items": [{"id": r["id"], "at": r["at"], "headline": json.loads(r["data_json"]).get("headline"),
                                           "health": json.loads(r["data_json"]).get("health")} for r in rows]})
        if len(seg) == 2 and seg[0] == "report":
            with db() as conn:
                r = conn.execute("SELECT * FROM gsc_ai WHERE id=? AND kind='report'", (seg[1],)).fetchone()
            if not r:
                return h.send_json({"error": "Không tìm thấy báo cáo"}, 404)
            return h.send_json({**json.loads(r["data_json"]), "id": r["id"], "at": r["at"]})
        if method == "POST" and seg == ["send-rank"]:
            return h.send_json(send_rank(h.read_json().get("keywords", [])))
        if method == "POST" and seg == ["send-autopost"]:
            b = h.read_json()
            return h.send_json(send_autopost(int(b["site_id"]), b.get("keywords", [])))
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502)
    return True
