"""
Bản đồ website: phân tích tổng thể từng URL của website và lặp lại theo chu kỳ.

Mỗi chu kỳ:
  1. Quét danh sách URL (sitemap / bò link) + URL có trên Google (Search Console), đọc từng trang lấy tiêu đề, H1, liên kết nội bộ.
  2. Đồng bộ Search Console + GA4 (miễn phí), lấy từ khóa đang có thứ hạng theo URL (DataForSEO Labs, tùy chọn).
  3. AI gán cho mỗi URL: từ khóa chính, từ phụ, câu hỏi GEO, ý định, nhóm chủ đề, vai trò (trụ cột / danh mục / sản phẩm / bài viết).
  4. Chấm điểm SEO on-page (bộ kiểm tra Audit), cấu trúc GEO, tốc độ (Google PageSpeed Insights API, miễn phí), trạng thái index.
  5. Dựng đồ thị liên kết nội bộ, tìm trang mồ côi, trang sâu, đề xuất liên kết theo cấu trúc cụm chủ đề.
  6. Phát hiện trùng từ khóa, so sánh với chu kỳ trước (tụt hạng, chậm đi, lỗi mới…), AI viết báo cáo và việc cần làm.
Chỉ dùng thư viện chuẩn của Python.
"""
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urljoin, urlparse

import audit
import costs
import geo
import gsc
import topics

db = LOCK = load_config = dfs_post = claude = save_config = None
JOBS = {}
RUNNING = set()
fold = topics.fold
host_of = topics.host_of

INTENT_W = {"buy": 1.6, "price": 1.5, "local": 1.5, "compare": 1.4, "howto": 1.0, "problem": 1.0, "info": 0.9, "nav": 0.4}
ROLE_W = {"product": 1.3, "category": 1.35, "pillar": 1.3, "home": 1.0, "post": 1.0, "support": 0.6, "other": 0.7}
ROLE_VI = {"home": "Trang chủ", "pillar": "Trụ cột", "category": "Danh mục", "product": "Sản phẩm", "post": "Bài viết", "support": "Trang phụ", "other": "Khác"}
PSI_VI = {
    "render-blocking-resources": "Loại bỏ CSS/JS chặn hiển thị", "unused-javascript": "Giảm JavaScript không dùng",
    "unused-css-rules": "Giảm CSS không dùng", "modern-image-formats": "Dùng ảnh WebP/AVIF",
    "uses-optimized-images": "Nén ảnh", "offscreen-images": "Tải chậm ảnh ngoài màn hình (lazy-load)",
    "uses-responsive-images": "Dùng ảnh đúng kích thước hiển thị", "server-response-time": "Giảm thời gian phản hồi máy chủ (TTFB)",
    "uses-text-compression": "Bật nén gzip/brotli", "uses-long-cache-ttl": "Đặt bộ nhớ đệm lâu cho tài nguyên tĩnh",
    "unminified-javascript": "Thu gọn (minify) JavaScript", "unminified-css": "Thu gọn (minify) CSS", "redirects": "Tránh chuyển hướng nhiều lớp",
    "efficient-animated-content": "Thay ảnh GIF động bằng video", "total-byte-weight": "Giảm tổng dung lượng trang",
    "dom-size": "Giảm số phần tử HTML (DOM)", "third-party-summary": "Giảm mã bên thứ ba (chat, quảng cáo, theo dõi)",
    "legacy-javascript": "Bỏ JavaScript cũ cho trình duyệt đời cũ", "duplicated-javascript": "Bỏ JavaScript bị trùng",
    "font-display": "Hiện chữ ngay khi font đang tải (font-display)", "lcp-lazy-loaded": "Không lazy-load ảnh chính đầu trang",
    "prioritize-lcp-image": "Ưu tiên tải ảnh chính đầu trang", "unsized-images": "Khai báo kích thước ảnh (tránh xô lệch)",
    "bootup-time": "Giảm thời gian chạy JavaScript", "mainthread-work-breakdown": "Giảm việc trên luồng chính",
}


def setup(db_func, lock, load_cfg, dfs_post_func, claude_func, save_cfg):
    global db, LOCK, load_config, dfs_post, claude, save_config
    db, LOCK, load_config, dfs_post, claude, save_config = db_func, lock, load_cfg, dfs_post_func, claude_func, save_cfg
    with LOCK, db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS smap_sites(id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT UNIQUE, max_pages INTEGER DEFAULT 800,
            psi_mode TEXT DEFAULT 'smart', use_labs INTEGER DEFAULT 1, inspect INTEGER DEFAULT 1, auto INTEGER DEFAULT 0, auto_days INTEGER DEFAULT 30,
            site_id INTEGER, created_at TEXT);
        CREATE TABLE IF NOT EXISTS smap_pages(id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, url TEXT, ukey TEXT, type TEXT, status INTEGER,
            final_url TEXT, active INTEGER DEFAULT 1, in_sitemap INTEGER DEFAULT 0, title TEXT, h1 TEXT, words INTEGER, noindex INTEGER DEFAULT 0,
            canonical TEXT, depth INTEGER, inlinks INTEGER DEFAULT 0, outlinks INTEGER DEFAULT 0, links_json TEXT, anchors_in_json TEXT, broken_json TEXT,
            primary_kw TEXT, secondary_json TEXT, geo_json TEXT, intent TEXT, cluster TEXT, role TEXT, kw_note TEXT, kw_locked INTEGER DEFAULT 0, kw_at TEXT,
            seo INTEGER, seo_fails_json TEXT, geo_score INTEGER, geo_fails_json TEXT, psi_json TEXT, index_json TEXT,
            gsc_json TEXT, ga_json TEXT, ranks_json TEXT, issues_json TEXT, value REAL DEFAULT 0, advice_json TEXT,
            first_seen TEXT, last_seen TEXT, UNIQUE(site_id, ukey));
        CREATE TABLE IF NOT EXISTS smap_cycles(id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, at TEXT, auto INTEGER DEFAULT 0,
            summary_json TEXT, diff_json TEXT, cannibal_json TEXT, report_json TEXT, notes_json TEXT, cost_usd REAL);
        CREATE TABLE IF NOT EXISTS smap_snaps(cycle_id INTEGER, page_id INTEGER, clicks INTEGER, impr INTEGER, pos REAL, seo INTEGER, geo INTEGER,
            perf INTEGER, inlinks INTEGER, status INTEGER, primary_kw TEXT, rank INTEGER, PRIMARY KEY(cycle_id, page_id));
        CREATE TABLE IF NOT EXISTS smap_links(id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, from_id INTEGER, to_id INTEGER, anchor TEXT,
            reason TEXT, kind TEXT, priority REAL, status TEXT DEFAULT 'todo', place_json TEXT, created_at TEXT, updated_at TEXT, UNIQUE(site_id, from_id, to_id));
        """)
    threading.Thread(target=scheduler_loop, daemon=True).start()


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def jl(s, d=None):
    try:
        return json.loads(s) if s else d
    except (ValueError, TypeError):
        return d


def ukey(u):
    """Khóa so khớp URL: bỏ http(s), www, dấu / cuối, #."""
    p = urlparse(u if "://" in u else "https://" + u)
    h = audit.bare_host(p.netloc)
    path = urllib.parse.unquote(p.path or "/").rstrip("/") or "/"
    return h + path + ("?" + p.query if p.query else "")


def path_key(u):
    k = ukey(u)
    return k.split("/", 1)[1].split("?")[0].rstrip("/") if "/" in k else ""


# ---------------------------------------------------------------- site
def get_site(sid):
    with db() as conn:
        r = conn.execute("SELECT * FROM smap_sites WHERE id=?", (sid,)).fetchone()
    return dict(r) if r else None


def save_site(b):
    d = host_of(b.get("domain"))
    if "." not in d:
        raise RuntimeError("Nhập tên miền, ví dụ mrvu.vn")
    vals = (d, max(50, min(3000, int(b.get("max_pages") or 800))), b.get("psi_mode") if b.get("psi_mode") in ("smart", "all", "off") else "smart",
            1 if b.get("use_labs", True) else 0, 1 if b.get("inspect", True) else 0, 1 if b.get("auto") else 0,
            max(7, min(90, int(b.get("auto_days") or 30))), int(b["site_id"]) if b.get("site_id") else None)
    with LOCK, db() as conn:
        if b.get("id"):
            conn.execute("UPDATE smap_sites SET domain=?, max_pages=?, psi_mode=?, use_labs=?, inspect=?, auto=?, auto_days=?, site_id=? WHERE id=?", vals + (int(b["id"]),))
            sid = int(b["id"])
        else:
            old = conn.execute("SELECT id FROM smap_sites WHERE domain=?", (d,)).fetchone()
            if old:
                raise RuntimeError("Website này đã có.")
            sid = conn.execute("INSERT INTO smap_sites(domain, max_pages, psi_mode, use_labs, inspect, auto, auto_days, site_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                               vals + (now(),)).lastrowid
    key = (b.get("psi_api_key") or "").strip()
    if key and "…" not in key:
        save_config({"psi_api_key": key})
    return get_site(sid)


def site_context(domain):
    """Thương hiệu, lĩnh vực từ dự án Câu hỏi AI cùng tên miền (nếu có)."""
    try:
        with db() as conn:
            r = conn.execute("SELECT id, brands_json, topics_json, competitors_json FROM aiq_projects WHERE domain=?", (domain,)).fetchone()
        if r:
            return {"aiq_id": r["id"], "brands": jl(r["brands_json"], []), "topics": jl(r["topics_json"], []), "competitors": jl(r["competitors_json"], [])}
    except Exception:  # noqa: BLE001
        pass
    return {"aiq_id": None, "brands": [domain], "topics": [], "competitors": []}


# ---------------------------------------------------------------- 1. quét
def parse_page(res, base_host):
    html = audit.decode(res)
    p = audit.PageParser()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001
        pass
    links, anchors = set(), []
    final = res["url"]
    for a in p.anchors:
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "zalo:")):
            continue
        u = urljoin(final, href).split("#")[0]
        if not u.startswith("http") or audit.bare_host(urlparse(u).netloc) != base_host:
            continue
        if audit.SKIP_EXT.search(urlparse(u).path):
            continue
        k = ukey(u)
        if k not in links:
            links.add(k)
            anchors.append((k, (a.get("text") or a.get("title") or "")[:80], "nofollow" in (a.get("rel") or "")))
    canon = next((l.get("href") for l in p.links_rel if "canonical" in (l.get("rel") or "").lower()), "") or ""
    robots = (p.meta.get("robots", "") + " " + audit.header(res, "x-robots-tag")).lower()
    text = " ".join(" ".join(p.text).split())
    return {"title": p.title or "", "h1": next((t for lv, t in p.headings if lv == 1), ""), "words": len(text.split()),
            "noindex": "noindex" in robots, "canonical": urljoin(final, canon) if canon else "", "anchors": anchors}


def crawl_site(site, notes, progress):
    d = site["domain"]
    progress(f"Đang đọc sitemap {d}…")
    try:
        base, pages, method = audit.crawl(d, site["max_pages"], lambda m, n: progress(f"Đang tìm trang của {d}: {n} trang…"))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Không quét được {d}: {e}")
    urls = {ukey(u): (u, t, True) for u, t, _ in pages}
    # thêm URL có trên Google nhưng không có trong sitemap
    try:
        with db() as conn:
            for r in conn.execute("SELECT page FROM gsc_pages WHERE period='cur' ORDER BY impressions DESC LIMIT 400"):
                k = ukey(r["page"])
                if k.split("/")[0] == d and k not in urls and len(urls) < site["max_pages"] + 200:
                    urls[k] = (r["page"], audit.classify(r["page"]), False)
    except Exception:  # noqa: BLE001
        pass
    home = ukey(base)
    if home not in urls:
        urls[home] = (base, "home", True)
    out, done, notes_missing = {}, [0], []

    def one(item):
        k, (u, t, sm) = item
        res = audit.fetch(u, timeout=25)
        info = {"url": u, "type": t, "in_sitemap": sm, "status": res["status"], "final_url": res["url"], "elapsed": round(res["elapsed"], 2)}
        ct = audit.header(res, "content-type").lower()
        if res["status"] == 200 and ("html" in ct or not ct):
            info.update(parse_page(res, d))
        done[0] += 1
        if done[0] % 10 == 0:
            progress(f"Đã đọc {done[0]}/{len(urls)} trang (liên kết nội bộ, tiêu đề)…")
        return k, info
    with ThreadPoolExecutor(max_workers=6) as ex:
        for k, info in ex.map(one, list(urls.items())):
            out[k] = info
    # liên kết nội bộ trỏ tới URL chưa có trong sitemap: kiểm tra (phát hiện link hỏng, trang thiếu trong sitemap)
    extra = {}
    for v in list(out.values()):
        for t, _, _ in v.get("anchors", []):
            if t not in out and t not in extra and len(extra) < 400:
                extra[t] = ("https://" + t, audit.classify("https://" + t), False)
    if extra:
        progress(f"Đang kiểm tra {len(extra)} liên kết nội bộ không có trong sitemap…")
        with ThreadPoolExecutor(max_workers=6) as ex:
            for k, info in ex.map(one, list(extra.items())):
                if info["status"] == 200 and info.get("title") is not None:
                    out[k] = info
                    notes_missing.append(info["url"])
                else:
                    out[k] = {**info, "stub": True}
    # trang chuyển hướng: gộp về URL đích
    for k, v in list(out.items()):
        fk = ukey(v["final_url"])
        if fk != k and fk in out:
            v["redirect_to"] = fk
    if notes_missing:
        notes.append(f"{len(notes_missing)} trang có liên kết nội bộ nhưng không có trong sitemap (nên bổ sung vào sitemap), ví dụ: {notes_missing[0]}")
    return home, out, method


def link_graph(home, pages):
    inl, anchors_in, broken = {}, {}, {}
    for k, v in pages.items():
        for t, txt, nf in v.get("anchors", []):
            t2 = pages.get(t, {}).get("redirect_to") or t
            if t2 == k:
                continue
            inl.setdefault(t2, set()).add(k)
            if txt:
                anchors_in.setdefault(t2, []).append([k, txt])
            st = pages.get(t, {}).get("status")
            if st is not None and st >= 400:
                broken.setdefault(k, []).append([t, st])
    depth, q = {home: 0}, [home]
    while q:
        cur = q.pop(0)
        for t, _, _ in pages.get(cur, {}).get("anchors", []):
            t = pages.get(t, {}).get("redirect_to") or t
            if t in pages and t not in depth:
                depth[t] = depth[cur] + 1
                q.append(t)
    return inl, anchors_in, broken, depth


# ---------------------------------------------------------------- 2. dữ liệu Google
def gsc_maps(domain, notes, progress, sync_ok):
    cfg = load_config()
    site = str(cfg.get("gsc_site") or "")
    if host_of(site.replace("sc-domain:", "")) != domain:
        notes.append("Search Console chưa kết nối đúng website này: bỏ qua dữ liệu từ khóa thật theo URL.")
        return {}, {}, {}
    info = gsc.meta("last_sync") or {}
    stale = not info.get("at") or datetime.fromisoformat(info["at"]) < datetime.now().astimezone() - timedelta(days=3)
    if stale and sync_ok:
        progress("Đang đồng bộ Search Console và GA4…")
        try:
            gsc.sync(progress)
        except Exception as e:  # noqa: BLE001
            notes.append(f"Không đồng bộ được Search Console: {e}")
    pg, q, ga = {}, {}, {}
    with db() as conn:
        for r in conn.execute("SELECT period, page, clicks, impressions, ctr, position FROM gsc_pages"):
            pg.setdefault(ukey(r["page"]), {})[r["period"]] = {"clicks": r["clicks"], "impr": r["impressions"], "ctr": r["ctr"], "pos": r["position"]}
        for r in conn.execute("SELECT query, page, clicks, impressions, position FROM gsc_rows WHERE period='cur' ORDER BY impressions DESC"):
            lst = q.setdefault(ukey(r["page"]), [])
            if len(lst) < 15:
                lst.append([r["query"], r["impressions"], r["clicks"], round(r["position"], 1)])
        try:
            for r in conn.execute("SELECT period, path, sessions, engaged, key_events FROM ga_pages"):
                k = r["path"].split("?")[0].rstrip("/").lstrip("/")
                e = ga.setdefault(k, {}).setdefault(r["period"], {"sessions": 0, "key_events": 0})
                e["sessions"] += r["sessions"] or 0
                e["key_events"] += r["key_events"] or 0
        except Exception:  # noqa: BLE001
            pass
    return pg, q, ga


def cannibal_groups(domain, pages_by_key, kw_pages):
    """Truy vấn có nhiều URL cùng nhận hiển thị đáng kể, hoặc nhiều URL được gán cùng từ khóa chính."""
    groups = {}
    try:
        with db() as conn:
            rows = conn.execute("SELECT query, page, impressions, clicks, position FROM gsc_rows WHERE period='cur'").fetchall()
    except Exception:  # noqa: BLE001
        rows = []
    byq = {}
    for r in rows:
        k = ukey(r["page"])
        if k in pages_by_key:
            byq.setdefault(r["query"], []).append([k, r["impressions"], r["clicks"], round(r["position"], 1)])
    for qq, lst in byq.items():
        tot = sum(x[1] for x in lst)
        big = [x for x in lst if x[1] >= max(20, 0.15 * tot)]
        if len(big) >= 2 and tot >= 50:
            groups[fold(qq)] = {"keyword": qq, "source": "gsc", "impr": tot, "pages": [{"id": pages_by_key[x[0]], "impr": x[1], "clicks": x[2], "pos": x[3]} for x in sorted(big, key=lambda x: -x[1])]}
    for fk, ids in kw_pages.items():
        if len(ids) >= 2 and fk not in groups:
            groups[fk] = {"keyword": ids[0][1], "source": "assigned", "impr": 0, "pages": [{"id": i} for i, _ in ids]}
    return sorted(groups.values(), key=lambda g: -g["impr"])[:60]


# ---------------------------------------------------------------- 3. AI gán từ khóa
def assign_keywords(site, ctx, rows, cfg, progress):
    clusters = []
    out = {}
    batches = [rows[i:i + 30] for i in range(0, len(rows), 30)]
    for bi, batch in enumerate(batches):
        progress(f"AI đang gán từ khóa cho trang {bi * 30 + 1}–{bi * 30 + len(batch)}/{len(rows)}…")
        lines = []
        for r in batch:
            gq = "; ".join(f"{x[0]} ({x[1]} hiển thị, vị trí {x[3]})" for x in (r["queries"] or [])[:8]) or "-"
            rk = "; ".join(f"{x['keyword']} (vol {x.get('volume') or '?'}, top {x.get('pos')})" for x in (r["ranks"] or [])[:6]) or "-"
            aq = "; ".join(r["aiq"][:4]) or "-"
            lines.append(f"[{r['id']}] {r['url']} | loại: {r['type']} | title: {r['title'][:90]} | H1: {r['h1'][:80]} | {r['words']} chữ\n"
                         f"    Google: {gq}\n    Thứ hạng: {rk}\n    Câu hỏi AI đã giao: {aq}")
        prompt = f"""Bạn là chuyên gia SEO và GEO cho website bán hàng {site['domain']} (thương hiệu: {', '.join(ctx['brands'])}; lĩnh vực: {', '.join(ctx['topics']) or 'xem nội dung trang'}).
Mục tiêu: mỗi URL nhắm ĐÚNG MỘT nhóm ý định tìm kiếm, mang về nhiều khách hàng tiềm năng nhất từ Google và AI (ChatGPT, Gemini, AI Overview).

Danh sách trang (kèm từ khóa Google thật đang hiển thị trang đó, thứ hạng, câu hỏi AI):
{chr(10).join(lines)}

Nhóm chủ đề đã đặt tên ở các lượt trước (dùng lại đúng tên nếu cùng chủ đề): {', '.join(clusters) or '(chưa có)'}

Với mỗi trang:
- "primary": từ khóa chính tiếng Việt có dấu, ưu tiên từ khóa Google thật có nhiều hiển thị và đúng nội dung trang; trang sản phẩm dùng tên sản phẩm + loại; danh mục dùng tên danh mục người hay tìm.
- "secondary": 2-5 từ phụ cùng ý định (không trùng từ chính của trang khác cùng lượt).
- "geo": 1-3 câu hỏi người dùng hay hỏi AI mà trang này nên trả lời (để trống với trang chủ/liên hệ/chính sách).
- "intent": buy|price|local|compare|howto|problem|info|nav. "role": home|pillar|category|product|post|support|other.
- "cluster": nhóm chủ đề ngắn (tối đa ~15 nhóm cho cả website). "note": 1 câu nếu title/H1 lệch từ khóa hoặc trang nên gộp/bỏ.
Chỉ trả về JSON hợp lệ: {{"pages": [{{"id": 1, "primary": "...", "secondary": ["..."], "geo": ["..."], "intent": "buy", "role": "category", "cluster": "...", "note": ""}}]}}"""
        txt, _, _ = claude(cfg, prompt, 7000, tag="smap_cycle")
        m = re.search(r"\{.*\}", txt, re.S)
        data = jl(m.group(0), {}) if m else {}
        for x in data.get("pages") or []:
            try:
                out[int(x["id"])] = x
            except (KeyError, ValueError, TypeError):
                continue
            c = (x.get("cluster") or "").strip()
            if c and c not in clusters:
                clusters.append(c)
    return out


# ---------------------------------------------------------------- 4. tốc độ
def psi(url, key, strategy="mobile"):
    q = {"url": url, "strategy": strategy, "category": "performance"}
    if key:
        q["key"] = key
    api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(api, headers={"User-Agent": "MrVuSEOStudio/1.0"}), timeout=120) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            last = f"PageSpeed lỗi {e.code}"
            if e.code == 429:
                time.sleep(8 * (attempt + 1))
                continue
            if e.code in (400, 500):
                try:
                    last += ": " + json.load(e).get("error", {}).get("message", "")[:150]
                except Exception:  # noqa: BLE001
                    pass
            raise RuntimeError(last)
        except Exception as e:  # noqa: BLE001
            last = f"PageSpeed không phản hồi: {e}"
            time.sleep(3)
    else:
        raise RuntimeError(last or "PageSpeed lỗi")
    lh = data.get("lighthouseResult") or {}
    au = lh.get("audits") or {}
    nv = lambda k: (au.get(k) or {}).get("numericValue")  # noqa: E731
    perf = ((lh.get("categories") or {}).get("performance") or {}).get("score")
    opps = []
    for k, a in au.items():
        det = a.get("details") or {}
        sav = det.get("overallSavingsMs") or (a.get("metricSavings") or {}).get("LCP") or 0
        if (det.get("type") == "opportunity" or a.get("metricSavings")) and sav and sav >= 150 and (a.get("score") is None or a.get("score") < 0.9):
            opps.append({"id": k, "title": PSI_VI.get(k, a.get("title") or k), "ms": round(sav)})
    opps.sort(key=lambda o: -o["ms"])
    fld = (data.get("loadingExperience") or {})
    fm = fld.get("metrics") or {}
    pv = lambda k: (fm.get(k) or {}).get("percentile")  # noqa: E731
    field = None
    if fm:
        field = {"category": fld.get("overall_category"), "lcp": pv("LARGEST_CONTENTFUL_PAINT_MS"), "inp": pv("INTERACTION_TO_NEXT_PAINT"),
                 "cls": (pv("CUMULATIVE_LAYOUT_SHIFT_SCORE") or 0) / 100 if pv("CUMULATIVE_LAYOUT_SHIFT_SCORE") is not None else None,
                 "origin": fld.get("origin_fallback", False)}
    return {"at": now(), "strategy": strategy, "perf": round(perf * 100) if perf is not None else None,
            "lcp": nv("largest-contentful-paint"), "tbt": nv("total-blocking-time"), "cls": nv("cumulative-layout-shift"),
            "fcp": nv("first-contentful-paint"), "si": nv("speed-index"), "ttfb": nv("server-response-time"),
            "weight_kb": round((nv("total-byte-weight") or 0) / 1024), "field": field, "opps": opps[:6]}


# ---------------------------------------------------------------- 5. liên kết nội bộ
def link_suggestions(site_id, pages):
    """pages: dict id -> page (đã có primary, cluster, role, links). Trả về list gợi ý."""
    ok = {i: p for i, p in pages.items() if p["status"] == 200 and not p["noindex"] and p.get("primary_kw")}
    by_key = {p["ukey"]: i for i, p in ok.items()}
    has = {i: {by_key[k] for k in p["links"] if k in by_key} for i, p in ok.items()}
    clusters = {}
    for i, p in ok.items():
        if p.get("cluster"):
            clusters.setdefault(p["cluster"], []).append(i)
    sugg = {}

    def add(f, t, kind, reason, pr):
        if f == t or t in has.get(f, set()) or f not in ok or t not in ok:
            return
        k = (f, t)
        if k not in sugg or sugg[k]["priority"] < pr:
            sugg[k] = {"from_id": f, "to_id": t, "anchor": ok[t]["primary_kw"], "kind": kind, "reason": reason, "priority": round(pr, 1)}

    def opp(i):
        p = ok[i]
        g = p.get("gsc") or {}
        pos, impr = g.get("pos") or 0, g.get("impr") or 0
        boost = 1.8 if 4 <= pos <= 20 else 1.0
        return (1 + math.log10(1 + impr)) * boost * INTENT_W.get(p.get("intent") or "info", 1) * ROLE_W.get(p.get("role") or "other", 1)

    hubs = {}
    for c, ids in clusters.items():
        cand = sorted(ids, key=lambda i: (ok[i].get("role") not in ("pillar", "category"), -((ok[i].get("gsc") or {}).get("impr") or 0), ok[i].get("depth") or 9))
        hubs[c] = cand[0]
        hub = cand[0]
        members = [i for i in ids if i != hub]
        for i in members:
            add(i, hub, "lên trụ cột", f"Trang thuộc nhóm \"{c}\" nên trỏ về trang trung tâm của nhóm", 10 * opp(hub) / 2 + 5)
        posts = sorted([i for i in members if ok[i].get("role") in ("post", "pillar", "category")], key=lambda i: -opp(i))[:15]
        for i in posts:
            add(hub, i, "xuống bài con", f"Trang trung tâm nhóm \"{c}\" nên liên kết tới các bài con quan trọng", 6 * opp(i))
        prods = [i for i in members if ok[i].get("role") == "product"]
        for i in posts:
            for pr in sorted(prods, key=lambda x: -opp(x))[:2]:
                add(i, pr, "bài → sản phẩm", "Bài hướng dẫn dẫn khách sang sản phẩm phù hợp (tăng chuyển đổi)", 7 * opp(pr))
        sib = [i for i in members if ok[i].get("role") == "post"]
        for i in sib:
            for j in sorted([x for x in sib if x != i], key=lambda x: -opp(x))[:2]:
                add(i, j, "bài liên quan", f"Hai bài cùng nhóm \"{c}\" nên liên kết qua lại", 4 * opp(j))
    strong = sorted(ok, key=lambda i: -(ok[i].get("inlinks") or 0))[:30]
    for i, p in ok.items():
        if p.get("role") != "home" and (p.get("inlinks") or 0) == 0:
            src = [h for h in strong if ok[h].get("cluster") == p.get("cluster")][:2] or strong[:2]
            for f in src:
                add(f, i, "cứu trang mồ côi", "Trang chưa có liên kết nội bộ nào trỏ tới (Google và AI khó tìm thấy)", 12 * opp(i))
        elif (p.get("depth") or 0) > 3 and opp(i) > 3:
            for f in strong[:1]:
                add(f, i, "rút ngắn độ sâu", f"Trang quan trọng nằm sâu {p['depth']} lần bấm từ trang chủ", 6 * opp(i))
    return sorted(sugg.values(), key=lambda s: -s["priority"])[:500], hubs


# ---------------------------------------------------------------- 6. vấn đề + giá trị
def page_issues(p, cannibal_ids):
    I = []

    def add(kind, sev, text):
        I.append({"kind": kind, "sev": sev, "text": text})
    st = p["status"]
    if st and st >= 400:
        add("tech", 3, f"Trang lỗi HTTP {st}")
    if p.get("noindex"):
        add("tech", 3, "Trang đang chặn index (noindex)")
    ix = p.get("index") or {}
    if ix.get("verdict") and ix["verdict"] != "PASS":
        add("index", 3, f"Google chưa index: {ix.get('coverage') or ix['verdict']}")
    g = p.get("gsc") or {}
    if p.get("primary_kw"):
        fk = fold(p["primary_kw"])
        words = [w for w in fk.split() if w not in topics.STOP]
        t = fold(p.get("title") or "")
        if words and sum(w in t.split() for w in words) / len(words) < 0.6:
            add("seo", 2, f"Title chưa chứa từ khóa chính \"{p['primary_kw']}\"")
    if p.get("seo") is not None and p["seo"] < 70:
        add("seo", 2, f"Điểm SEO on-page {p['seo']}/100: " + "; ".join(x["label"] for x in (p.get("seo_fails") or [])[:3]))
    ps = p.get("psi") or {}
    if ps.get("perf") is not None and ps["perf"] < 50:
        add("speed", 2, f"Tốc độ di động kém ({ps['perf']}/100, LCP {round((ps.get('lcp') or 0) / 1000, 1)}s)")
    elif ps.get("perf") is not None and ps["perf"] < 80:
        add("speed", 1, f"Tốc độ di động trung bình ({ps['perf']}/100)")
    if (ps.get("field") or {}).get("category") == "SLOW":
        add("speed", 3, "Người dùng thật đánh giá chậm (Core Web Vitals không đạt)")
    if p.get("geo_score") is not None and p["geo_score"] < 60 and p.get("geo"):
        add("geo", 2, f"Cấu trúc GEO {p['geo_score']}/100: " + "; ".join(x["label"] for x in (p.get("geo_fails") or [])[:2]))
    if p.get("role") not in ("home", None) and (p.get("inlinks") or 0) == 0 and st == 200:
        add("link", 3, "Trang mồ côi: không có liên kết nội bộ trỏ tới")
    elif st == 200 and (p.get("inlinks") or 0) < 3 and p.get("role") in ("category", "pillar", "product"):
        add("link", 1, f"Ít liên kết nội bộ trỏ tới ({p.get('inlinks') or 0})")
    if (p.get("depth") or 0) > 3:
        add("link", 1, f"Nằm sâu {p['depth']} lần bấm từ trang chủ")
    if p.get("broken"):
        add("link", 2, f"Có {len(p['broken'])} liên kết nội bộ hỏng")
    if p["id"] in cannibal_ids:
        add("kw", 2, "Trùng từ khóa với trang khác (tự cạnh tranh trên Google)")
    cur = g.get("cur") or {}
    if cur.get("impr", 0) >= 100 and 4 <= (cur.get("pos") or 0) <= 20:
        add("opp", 2, f"Cơ hội lên top: vị trí {cur['pos']:.1f}, {cur['impr']} hiển thị/28 ngày")
    if cur.get("impr", 0) >= 300 and (cur.get("pos") or 99) <= 5 and (cur.get("ctr") or 0) < 0.03:
        add("opp", 1, f"Tỷ lệ click thấp ({(cur.get('ctr') or 0) * 100:.1f}%) dù đứng top: viết lại title/meta")
    if p.get("words") is not None and st == 200 and p.get("role") in ("post", "pillar") and p["words"] < 500:
        add("content", 2, f"Nội dung mỏng ({p['words']} chữ)")
    return sorted(I, key=lambda x: -x["sev"])


def page_value(p):
    cur = (p.get("gsc") or {}).get("cur") or {}
    ga = (p.get("ga") or {}).get("cur") or {}
    base = 1 + math.log10(1 + (cur.get("impr") or 0) + 10 * (cur.get("clicks") or 0)) + 2 * math.log10(1 + (ga.get("key_events") or 0))
    return round(base * INTENT_W.get(p.get("intent") or "info", 1) * ROLE_W.get(p.get("role") or "other", 1), 2)


# ---------------------------------------------------------------- chu kỳ
def load_pages(sid, active_only=True):
    with db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM smap_pages WHERE site_id=?" + (" AND active=1" if active_only else ""), (sid,))]
    for r in rows:
        for k in ("links", "anchors_in", "broken", "secondary", "geo", "seo_fails", "geo_fails", "psi", "index", "gsc", "ga", "ranks", "issues", "advice"):
            r[k] = jl(r.pop(k + "_json"), None)
        r["links"] = r["links"] or []
    return rows


def run_cycle(sid, opts, auto=False, progress=lambda m: None):
    site = get_site(sid)
    if not site:
        raise RuntimeError("Không tìm thấy website.")
    if sid in RUNNING:
        raise RuntimeError("Website này đang được phân tích.")
    cfg = load_config()
    RUNNING.add(sid)
    notes, t0 = [], topics.costs_spent()
    try:
        with costs.module_as("smap_cycle"):
            return _cycle(site, cfg, opts, auto, notes, t0, progress)
    finally:
        RUNNING.discard(sid)


def _cycle(site, cfg, opts, auto, notes, t0, progress):
    sid, d = site["id"], site["domain"]
    ctx = site_context(d)
    # 1. quét
    home, crawl, method = crawl_site(site, notes, progress)
    inl, anchors_in, broken, depth = link_graph(home, crawl)
    # 2. Google
    gpg, gq, ga = gsc_maps(d, notes, progress, opts.get("sync", True))
    ranks = {}
    if opts.get("labs", bool(site["use_labs"])) and cfg.get("login") and cfg.get("password"):
        progress("Đang lấy từ khóa website đang có thứ hạng (DataForSEO)…")
        try:
            rows, _ = topics.ranked_keywords(cfg, d, 2704, "vi", 1000, notes)
            for r in rows:
                if r.get("url"):
                    ranks.setdefault(ukey(r["url"]), []).append({"keyword": r["keyword"], "volume": r.get("volume"), "pos": r.get("pos")})
        except RuntimeError as e:
            notes.append(f"Không lấy được thứ hạng: {e}")
    aiq_t = {}
    if ctx["aiq_id"]:
        with db() as conn:
            for r in conn.execute("SELECT question, target_url FROM aiq_questions WHERE project_id=? AND status<>'ignored' AND target_url<>''", (ctx["aiq_id"],)):
                aiq_t.setdefault(ukey(r["target_url"]), []).append(r["question"])
    # ghi trang
    ts = now()
    with LOCK, db() as conn:
        conn.execute("UPDATE smap_pages SET active=0 WHERE site_id=?", (sid,))
        for k, v in crawl.items():
            if v.get("redirect_to") or v.get("stub"):
                continue
            g = gpg.get(k, {})
            gdata = {"cur": g.get("cur"), "prev": g.get("prev"), "old": g.get("old"), "queries": gq.get(k, [])}
            gav = ga.get(path_key(v["url"]), {})
            old = conn.execute("SELECT id FROM smap_pages WHERE site_id=? AND ukey=?", (sid, k)).fetchone()
            vals = (v["url"], v["type"], v["status"], v["final_url"], 1 if v["in_sitemap"] else 0, v.get("title", ""), v.get("h1", ""),
                    v.get("words"), 1 if v.get("noindex") else 0, v.get("canonical", ""), depth.get(k), len(inl.get(k, ())),
                    len(v.get("anchors", [])), json.dumps([a[0] for a in v.get("anchors", [])]), json.dumps(anchors_in.get(k, [])[:60], ensure_ascii=False),
                    json.dumps(broken.get(k, [])), json.dumps(gdata, ensure_ascii=False), json.dumps(gav), json.dumps(ranks.get(k, [])[:10], ensure_ascii=False), ts)
            if old:
                conn.execute("""UPDATE smap_pages SET url=?, type=?, status=?, final_url=?, in_sitemap=?, title=?, h1=?, words=?, noindex=?, canonical=?, depth=?,
                                inlinks=?, outlinks=?, links_json=?, anchors_in_json=?, broken_json=?, gsc_json=?, ga_json=?, ranks_json=?, last_seen=?, active=1 WHERE id=?""",
                             vals + (old["id"],))
            else:
                conn.execute("""INSERT INTO smap_pages(url, type, status, final_url, in_sitemap, title, h1, words, noindex, canonical, depth, inlinks, outlinks,
                                links_json, anchors_in_json, broken_json, gsc_json, ga_json, ranks_json, last_seen, site_id, ukey, first_seen, active)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""", vals + (sid, k, ts))
    pages = load_pages(sid)
    # 3. AI gán từ khóa
    need = [p for p in pages if p["status"] == 200 and not p["noindex"] and not p["kw_locked"]
            and (opts.get("full_ai") or not p["primary_kw"] or not p["kw_at"])]
    if need and cfg.get("anthropic_api_key") and opts.get("ai", True):
        rows = [{"id": p["id"], "url": p["url"], "type": p["type"], "title": p["title"] or "", "h1": p["h1"] or "", "words": p["words"] or 0,
                 "queries": (p["gsc"] or {}).get("queries"), "ranks": p["ranks"], "aiq": aiq_t.get(p["ukey"], [])} for p in need]
        rows.sort(key=lambda r: (r["url"].count("/"), r["url"]))
        res = assign_keywords(site, ctx, rows, cfg, progress)
        with LOCK, db() as conn:
            for pid, x in res.items():
                conn.execute("""UPDATE smap_pages SET primary_kw=?, secondary_json=?, geo_json=?, intent=?, role=?, cluster=?, kw_note=?, kw_at=? WHERE id=? AND kw_locked=0""",
                             (" ".join(str(x.get("primary") or "").split()), json.dumps(x.get("secondary") or [], ensure_ascii=False),
                              json.dumps(x.get("geo") or [], ensure_ascii=False), x.get("intent") or "info", x.get("role") or "other",
                              (x.get("cluster") or "")[:60], x.get("note") or "", ts, pid))
        notes.append(f"AI đã gán từ khóa cho {len(res)}/{len(need)} trang.")
    elif need and not cfg.get("anthropic_api_key"):
        notes.append("Chưa có khóa Claude: bỏ qua bước gán từ khóa bằng AI.")
    pages = load_pages(sid)
    # 4a. điểm SEO + GEO (đọc lại trang)
    ok_pages = [p for p in pages if p["status"] == 200]
    done = [0]
    titles = [p["title"] for p in ok_pages if p["title"]]

    def score(p):
        try:
            res = audit.fetch(p["url"], timeout=25)
            rep = audit.audit_page(p["url"], p["type"], p["primary_kw"] or "", set(t for t in titles if t != p["title"]), check_links=False, res=res)
            fails = [{"label": c["label"], "fix": c["fix"], "status": c["status"]} for c in rep["checks"] if c["status"] in ("fail", "warn")]
            fails.sort(key=lambda c: c["status"] != "fail")
            gp = geo.read_page(p["url"], 4000, res=res)
            gs, gf = None, []
            if not gp.get("error"):
                ch = geo.structure_checks(gp, p["primary_kw"] or p["title"] or "")
                mx = sum(c["weight"] for c in ch if c["weight"] < 30)
                got = sum(c["weight"] * (1 if c["status"] == "pass" else 0.5 if c["status"] == "warn" else 0) for c in ch if c["weight"] < 30)
                gs = round(got / mx * 100) if mx else None
                if gp.get("noindex") or gp.get("nosnippet"):
                    gs = min(gs or 0, 10)
                gf = [{"label": c["label"], "fix": c["fix"]} for c in ch if c["status"] != "pass"]
            out = (p["id"], rep["score"], fails[:12], gs, gf, rep)
        except Exception:  # noqa: BLE001
            out = (p["id"], None, [], None, [], None)
        done[0] += 1
        if done[0] % 10 == 0:
            progress(f"Đang chấm điểm SEO và GEO {done[0]}/{len(ok_pages)} trang…")
        return out
    with ThreadPoolExecutor(max_workers=5) as ex:
        scored = list(ex.map(score, ok_pages))
    with LOCK, db() as conn:
        conn.execute("INSERT OR IGNORE INTO audit_sites(domain) VALUES (?)", (d,))
        asid = conn.execute("SELECT id FROM audit_sites WHERE domain=?", (d,)).fetchone()[0]
        pmap = {p["id"]: p for p in ok_pages}
        for pid, sc, sf, gs, gf, rep in scored:
            conn.execute("UPDATE smap_pages SET seo=?, seo_fails_json=?, geo_score=?, geo_fails_json=? WHERE id=?",
                         (sc, json.dumps(sf, ensure_ascii=False), gs, json.dumps(gf, ensure_ascii=False), pid))
            if rep:
                conn.execute("INSERT OR IGNORE INTO audit_pages(site_id, url, type, source) VALUES (?,?,?,?)", (asid, pmap[pid]["url"], pmap[pid]["type"], "smap"))
                apid = conn.execute("SELECT id FROM audit_pages WHERE site_id=? AND url=?", (asid, pmap[pid]["url"])).fetchone()[0]
                conn.execute("INSERT INTO audit_results(page_id, audited_at, score, keyword, report_json) VALUES (?,?,?,?,?)",
                             (apid, ts, rep["score"], rep["keyword"], json.dumps(rep, ensure_ascii=False)))
        n = conn.execute("SELECT COUNT(*) FROM audit_pages WHERE site_id=?", (asid,)).fetchone()[0]
        conn.execute("UPDATE audit_sites SET start_url=COALESCE(start_url, ?), crawled_at=?, method=?, count=? WHERE id=?", (f"https://{d}/", ts, method, n, asid))
    pages = load_pages(sid)
    # 4b. tốc độ
    mode = opts.get("psi_mode") or site["psi_mode"]
    if mode != "off":
        key = cfg.get("psi_api_key") or ""
        cand = [p for p in pages if p["status"] == 200 and not p["noindex"]]
        if mode == "smart":
            top = sorted(cand, key=lambda p: -page_value({**p, "gsc": p["gsc"], "ga": p["ga"]}))[:40]
            per = {}
            for p in cand:
                per.setdefault(p["role"] or p["type"], []).append(p)
            pick = {p["id"]: p for p in top}
            for lst in per.values():
                for p in lst[:3]:
                    pick.setdefault(p["id"], p)
            cand = list(pick.values())
        if not key:
            notes.append("Chưa có khóa PageSpeed Insights API: đo chậm hơn và dễ bị Google giới hạn.")
        progress(f"Đang đo tốc độ di động {len(cand)} trang (PageSpeed Insights)…")
        done[0], errs = 0, []

        def sp(p):
            try:
                r = psi(p["url"], key)
            except RuntimeError as e:
                errs.append(str(e))
                r = None
            done[0] += 1
            progress(f"Đang đo tốc độ {done[0]}/{len(cand)} trang…")
            return p["id"], r
        with ThreadPoolExecutor(max_workers=4 if key else 1) as ex:
            for pid, r in ex.map(sp, cand):
                if r:
                    with LOCK, db() as conn:
                        conn.execute("UPDATE smap_pages SET psi_json=? WHERE id=?", (json.dumps(r, ensure_ascii=False), pid))
        if errs:
            notes.append(f"PageSpeed: {len(errs)} trang chưa đo được ({errs[0]}).")
    # 4c. index (Search Console URL Inspection, miễn phí, hạn mức)
    pages = load_pages(sid)
    if opts.get("inspect", bool(site["inspect"])):
        imp = sorted([p for p in pages if p["status"] == 200 and not p["noindex"]], key=lambda p: -page_value(p))[:60]
        try:
            progress("Đang kiểm tra trạng thái index các trang quan trọng…")
            gsc.inspect_urls([p["url"] for p in imp], progress)
        except Exception as e:  # noqa: BLE001
            notes.append(f"Kiểm tra index: {e}")
    try:
        with db() as conn:
            ix = {ukey(r["url"]): {"verdict": r["verdict"], "coverage": r["coverage"], "at": r["at"], "google_canonical": r["google_canonical"]}
                  for r in conn.execute("SELECT * FROM gsc_inspect")}
    except Exception:  # noqa: BLE001
        ix = {}
    # 5. trùng từ khóa, liên kết, vấn đề
    progress("Đang dựng cấu trúc liên kết nội bộ và danh sách việc cần làm…")
    by_key = {p["ukey"]: p["id"] for p in pages}
    kw_pages = {}
    for p in pages:
        if p["primary_kw"] and p["status"] == 200:
            kw_pages.setdefault(fold(p["primary_kw"]), []).append((p["id"], p["primary_kw"]))
    groups = cannibal_groups(d, by_key, kw_pages)
    cids = {x["id"] for g in groups for x in g["pages"]}
    pmap = {}
    for p in pages:
        p["index"] = ix.get(p["ukey"])
        p["gsc_cur"] = ((p["gsc"] or {}).get("cur")) or {}
        pmap[p["id"]] = {**p, "gsc": {"impr": p["gsc_cur"].get("impr"), "pos": p["gsc_cur"].get("pos")}}
    sugg, hubs = link_suggestions(sid, pmap)
    with LOCK, db() as conn:
        for p in pages:
            p2 = {**p, "seo_fails": p["seo_fails"], "geo_fails": p["geo_fails"]}
            iss = page_issues(p2, cids)
            conn.execute("UPDATE smap_pages SET index_json=?, issues_json=?, value=? WHERE id=?",
                         (json.dumps(p["index"]) if p["index"] else None, json.dumps(iss, ensure_ascii=False), page_value(p), p["id"]))
        old = {(r["from_id"], r["to_id"]): r["status"] for r in conn.execute("SELECT from_id, to_id, status FROM smap_links WHERE site_id=?", (sid,))}
        linked = {(p["id"], by_key[k]) for p in pages for k in p["links"] if k in by_key}
        for (f, t), stt in old.items():
            if (f, t) in linked and stt != "done":
                conn.execute("UPDATE smap_links SET status='done', updated_at=? WHERE site_id=? AND from_id=? AND to_id=?", (ts, sid, f, t))
        conn.execute("DELETE FROM smap_links WHERE site_id=? AND status='todo'", (sid,))
        for s in sugg:
            if old.get((s["from_id"], s["to_id"])) in ("skip", "done"):
                continue
            conn.execute("""INSERT OR REPLACE INTO smap_links(site_id, from_id, to_id, anchor, reason, kind, priority, status, created_at, updated_at)
                            VALUES (?,?,?,?,?,?,?,'todo',?,?)""", (sid, s["from_id"], s["to_id"], s["anchor"], s["reason"], s["kind"], s["priority"], ts, ts))
    pages = load_pages(sid)
    # 6. ảnh chụp, so sánh, báo cáo
    with LOCK, db() as conn:
        prev = conn.execute("SELECT id FROM smap_cycles WHERE site_id=? ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
        cid = conn.execute("INSERT INTO smap_cycles(site_id, at, auto) VALUES (?,?,?)", (sid, ts, 1 if auto else 0)).lastrowid
        for p in pages:
            c = ((p["gsc"] or {}).get("cur")) or {}
            rk = min([r["pos"] for r in (p["ranks"] or []) if r.get("pos") and fold(r["keyword"]) == fold(p["primary_kw"] or "")] or [None], key=lambda x: x or 999)
            conn.execute("INSERT OR REPLACE INTO smap_snaps VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         (cid, p["id"], c.get("clicks"), c.get("impr"), c.get("pos"), p["seo"], p["geo_score"], (p["psi"] or {}).get("perf"),
                          p["inlinks"], p["status"], p["primary_kw"], rk))
    diff = compare(prev["id"] if prev else None, cid, pages)
    summ = summary(sid, pages, groups, hubs)
    report = None
    if opts.get("report", True) and cfg.get("anthropic_api_key"):
        progress("AI đang viết báo cáo và việc cần làm…")
        try:
            report = ai_report(site, ctx, summ, diff, pages, groups, cfg)
        except Exception as e:  # noqa: BLE001
            notes.append(f"Chưa viết được báo cáo AI: {e}")
    cost = max(0.0, topics.costs_spent() - t0)
    with LOCK, db() as conn:
        conn.execute("UPDATE smap_cycles SET summary_json=?, diff_json=?, cannibal_json=?, report_json=?, notes_json=?, cost_usd=? WHERE id=?",
                     (json.dumps(summ, ensure_ascii=False), json.dumps(diff, ensure_ascii=False), json.dumps(groups, ensure_ascii=False),
                      json.dumps(report, ensure_ascii=False) if report else None, json.dumps(notes, ensure_ascii=False), cost, cid))
    return {"cycle_id": cid, "summary": summ, "alerts": len(diff.get("alerts", [])), "notes": notes, "cost_usd": cost}


def summary(sid, pages, groups, hubs):
    act = [p for p in pages if p["status"] == 200 and not p["noindex"]]
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else None  # noqa: E731
    clicks = sum((((p["gsc"] or {}).get("cur")) or {}).get("clicks") or 0 for p in pages)
    impr = sum((((p["gsc"] or {}).get("cur")) or {}).get("impr") or 0 for p in pages)
    pclicks = sum((((p["gsc"] or {}).get("prev")) or {}).get("clicks") or 0 for p in pages)
    ke = sum((((p["ga"] or {}).get("cur")) or {}).get("key_events") or 0 for p in pages)
    with db() as conn:
        lk = {r["status"]: r["n"] for r in conn.execute("SELECT status, COUNT(*) n FROM smap_links WHERE site_id=? GROUP BY status", (sid,))}
    perf = [(p["psi"] or {}).get("perf") for p in act if (p["psi"] or {}).get("perf") is not None]
    clus = {}
    for p in act:
        c = p["cluster"] or "Chưa phân nhóm"
        e = clus.setdefault(c, {"cluster": c, "pages": 0, "clicks": 0, "impr": 0, "hub": None})
        e["pages"] += 1
        cur = ((p["gsc"] or {}).get("cur")) or {}
        e["clicks"] += cur.get("clicks") or 0
        e["impr"] += cur.get("impr") or 0
    for c, h in hubs.items():
        if c in clus:
            clus[c]["hub"] = h
    return {"pages": len(pages), "ok": len(act), "errors": sum(1 for p in pages if p["status"] and p["status"] >= 400),
            "noindex": sum(1 for p in pages if p["noindex"]), "with_kw": sum(1 for p in act if p["primary_kw"]),
            "avg_seo": avg([p["seo"] for p in act if p["seo"] is not None]), "avg_geo": avg([p["geo_score"] for p in act if p["geo_score"] is not None]),
            "avg_perf": avg(perf), "perf_measured": len(perf), "slow": sum(1 for x in perf if x < 50),
            "orphans": sum(1 for p in act if (p["inlinks"] or 0) == 0 and p["role"] != "home"), "deep": sum(1 for p in act if (p["depth"] or 0) > 3),
            "not_indexed": sum(1 for p in act if (p["index"] or {}).get("verdict") not in (None, "PASS")),
            "cannibal": len(groups), "clicks": clicks, "clicks_prev": pclicks, "impr": impr, "key_events": ke,
            "links_todo": lk.get("todo", 0), "links_done": lk.get("done", 0),
            "issues": sum(len(p["issues"] or []) for p in act), "clusters": sorted(clus.values(), key=lambda x: -x["impr"])[:20]}


def compare(prev_id, cid, pages):
    alerts = []
    if not prev_id:
        return {"first": True, "alerts": []}
    with db() as conn:
        old = {r["page_id"]: dict(r) for r in conn.execute("SELECT * FROM smap_snaps WHERE cycle_id=?", (prev_id,))}
    cur_ids = {p["id"] for p in pages}
    for p in pages:
        o = old.get(p["id"])
        name = p["primary_kw"] or p["url"]
        cur = ((p["gsc"] or {}).get("cur")) or {}
        if not o:
            if p["status"] == 200:
                alerts.append({"page_id": p["id"], "sev": 1, "kind": "new", "text": f"Trang mới: {p['url']}"})
            continue
        if o["status"] == 200 and p["status"] and p["status"] >= 400:
            alerts.append({"page_id": p["id"], "sev": 3, "kind": "error", "text": f"Trang bị lỗi HTTP {p['status']} (trước đây bình thường)"})
        c0, c1 = o["clicks"] or 0, cur.get("clicks") or 0
        if c0 >= 10 and c1 <= c0 * 0.7:
            alerts.append({"page_id": p["id"], "sev": 3 if c0 >= 50 else 2, "kind": "drop", "text": f"Click giảm {c0} → {c1} ({name})"})
        elif c1 >= 10 and c1 >= c0 * 1.3 and c1 - c0 >= 5:
            alerts.append({"page_id": p["id"], "sev": 0, "kind": "up", "text": f"Click tăng {c0} → {c1} ({name})"})
        p0, p1 = o["pos"], cur.get("pos")
        if p0 and p1 and (cur.get("impr") or 0) >= 50 and p1 - p0 >= 3:
            alerts.append({"page_id": p["id"], "sev": 2, "kind": "rank", "text": f"Vị trí trung bình tụt {p0:.1f} → {p1:.1f} ({name})"})
        elif p0 and p1 and (cur.get("impr") or 0) >= 50 and p0 - p1 >= 3:
            alerts.append({"page_id": p["id"], "sev": 0, "kind": "up", "text": f"Vị trí trung bình tăng {p0:.1f} → {p1:.1f} ({name})"})
        f0, f1 = o["perf"], (p["psi"] or {}).get("perf")
        if f0 is not None and f1 is not None and f0 - f1 >= 15:
            alerts.append({"page_id": p["id"], "sev": 2, "kind": "speed", "text": f"Tốc độ di động giảm {f0} → {f1} ({p['url']})"})
        s0, s1 = o["seo"], p["seo"]
        if s0 is not None and s1 is not None and s0 - s1 >= 10:
            alerts.append({"page_id": p["id"], "sev": 2, "kind": "seo", "text": f"Điểm SEO giảm {s0} → {s1} ({p['url']})"})
        if (o["inlinks"] or 0) >= 2 and (p["inlinks"] or 0) == 0:
            alerts.append({"page_id": p["id"], "sev": 2, "kind": "link", "text": f"Mất hết liên kết nội bộ trỏ tới ({p['url']})"})
        if o["rank"] and o["primary_kw"] == p["primary_kw"]:
            r1 = min([r["pos"] for r in (p["ranks"] or []) if r.get("pos") and fold(r["keyword"]) == fold(p["primary_kw"] or "")] or [None], key=lambda x: x or 999)
            if r1 and r1 - o["rank"] >= 3:
                alerts.append({"page_id": p["id"], "sev": 2, "kind": "rank", "text": f"\"{p['primary_kw']}\" tụt top {o['rank']} → {r1}"})
            elif r1 and o["rank"] - r1 >= 3:
                alerts.append({"page_id": p["id"], "sev": 0, "kind": "up", "text": f"\"{p['primary_kw']}\" lên top {o['rank']} → {r1}"})
    for pid in set(old) - cur_ids:
        alerts.append({"page_id": pid, "sev": 2, "kind": "gone", "text": "Trang không còn tìm thấy khi quét (đã xóa hoặc đổi đường dẫn?)"})
    alerts.sort(key=lambda a: -a["sev"])
    return {"first": False, "prev_cycle": prev_id, "alerts": alerts[:200]}


def ai_report(site, ctx, summ, diff, pages, groups, cfg):
    top = sorted([p for p in pages if p["status"] == 200], key=lambda p: -(p["value"] or 0))[:40]
    lines = [f"- {p['url']} | {ROLE_VI.get(p['role'] or 'other')} | từ khóa: {p['primary_kw'] or '-'} | SEO {p['seo']} | GEO {p['geo_score']} | tốc độ {(p['psi'] or {}).get('perf')} | "
             f"click {((p['gsc'] or {}).get('cur') or {}).get('clicks', 0)} | vị trí {round((((p['gsc'] or {}).get('cur') or {}).get('pos') or 0), 1)} | link vào {p['inlinks']} | "
             f"vấn đề: {'; '.join(i['text'] for i in (p['issues'] or [])[:3]) or 'không'}" for p in top]
    al = "\n".join(f"- {a['text']}" for a in diff.get("alerts", [])[:30]) or "(lần phân tích đầu tiên hoặc không có thay đổi lớn)"
    cg = "\n".join(f"- \"{g['keyword']}\": {len(g['pages'])} trang" for g in groups[:10]) or "(không có)"
    s2 = {k: v for k, v in summ.items() if k != "clusters"}
    prompt = f"""Bạn là trưởng nhóm SEO + GEO cho website bán hàng {site['domain']} (thương hiệu {', '.join(ctx['brands'])}; lĩnh vực {', '.join(ctx['topics']) or 'theo nội dung website'}).
Mục tiêu duy nhất: tăng KHÁCH HÀNG TIỀM NĂNG từ Google và AI (ChatGPT, Gemini, AI Overview), ưu tiên trang danh mục/sản phẩm và câu hỏi sắp mua.

Số liệu tổng: {json.dumps(s2, ensure_ascii=False)}
Nhóm chủ đề: {json.dumps([{k: c[k] for k in ('cluster', 'pages', 'clicks', 'impr')} for c in summ['clusters']], ensure_ascii=False)}
Thay đổi so với lần trước:
{al}
Trùng từ khóa:
{cg}
40 trang giá trị nhất:
{chr(10).join(lines)}

Viết báo cáo ngắn gọn, cụ thể, làm được ngay. Chỉ trả về JSON hợp lệ:
{{
  "headline": "1 câu kết luận tình hình",
  "health": "tốt|trung bình|cần xử lý",
  "wins": ["điều đang tốt lên"],
  "problems": ["vấn đề lớn nhất, có số liệu"],
  "actions": [{{"title": "việc cần làm", "why": "vì sao ảnh hưởng tới khách hàng tiềm năng", "pages": ["URL liên quan"], "impact": "cao|vừa|thấp", "effort": "ít|vừa|nhiều", "owner": "nội dung|kỹ thuật|liên kết"}}],
  "next_focus": "trọng tâm cho chu kỳ tới"
}}
Tối đa 12 việc, sắp theo tác động tới khách hàng tiềm năng."""
    with costs.module_as("smap_report"):
        txt, _, _ = claude(cfg, prompt, 4000, tag="smap_report")
    m = re.search(r"\{.*\}", txt, re.S)
    rep = jl(m.group(0), None) if m else None
    if not rep:
        raise RuntimeError("AI trả về dữ liệu không hợp lệ")
    rep["at"] = now()
    return rep


# ---------------------------------------------------------------- tư vấn từng trang, vị trí đặt link
def advise_page(pid, progress=lambda m: None):
    cfg = load_config()
    with db() as conn:
        r = conn.execute("SELECT site_id FROM smap_pages WHERE id=?", (pid,)).fetchone()
    if not r:
        raise RuntimeError("Không tìm thấy trang")
    p = page_detail(pid)
    site = get_site(r["site_id"])
    ctx = site_context(site["domain"])
    progress("Đang đọc trang…")
    gp = geo.read_page(p["url"], 5000)
    cfg_vars = "\n".join(f"- {v['name']}: {v['value']}" for v in cfg.get("ap_variables") or [] if v.get("name") and v.get("value"))
    links_in = ", ".join(f"{x['url']} (\"{x['anchor']}\")" for x in p["links_in"][:10]) or "không có"
    sug = "; ".join(f"từ {x['from_url']} chữ neo \"{x['anchor']}\"" for x in p["sugg_to"][:5]) or "-"
    prompt = f"""Bạn là chuyên gia SEO + GEO. Tư vấn tối ưu MỘT trang của {site['domain']} để mang về nhiều khách hàng tiềm năng nhất từ Google và AI.

URL: {p['url']} ({ROLE_VI.get(p['role'] or 'other')}, nhóm "{p['cluster']}", ý định {p['intent']})
Từ khóa chính: {p['primary_kw']} | phụ: {', '.join(p['secondary'] or [])}
Câu hỏi AI trang cần trả lời: {', '.join(p['geo'] or []) or '-'}
Search Console 28 ngày: {json.dumps((p['gsc'] or {}).get('cur'), ensure_ascii=False)}; trước đó: {json.dumps((p['gsc'] or {}).get('prev'), ensure_ascii=False)}
Từ khóa Google thật: {'; '.join(f"{q[0]} ({q[1]} hiển thị, vị trí {q[3]})" for q in ((p['gsc'] or {}).get('queries') or [])[:12])}
Lỗi SEO: {'; '.join(x['label'] for x in (p['seo_fails'] or [])[:8]) or 'không'}
Cấu trúc GEO thiếu: {'; '.join(x['label'] for x in (p['geo_fails'] or [])) or 'không'}
Tốc độ di động: {json.dumps({k: (p['psi'] or {}).get(k) for k in ('perf', 'lcp', 'tbt', 'cls')}, ensure_ascii=False)}; gợi ý: {'; '.join(o['title'] for o in ((p['psi'] or {}).get('opps') or [])[:4])}
Liên kết vào: {p['inlinks']} ({links_in}); gợi ý thêm: {sug}
Vấn đề: {'; '.join(i['text'] for i in (p['issues'] or []))}
Nội dung hiện tại: Title "{gp.get('title', '')}" | H1 {gp.get('h1')} | {gp.get('word_count')} chữ | Headings: {' | '.join(t for _, t in (gp.get('headings') or [])[:20])}
Trích nội dung: {(gp.get('text') or '')[:2500]}
Thông tin doanh nghiệp (không bịa thêm): {cfg_vars or '-'}

Chỉ trả về JSON hợp lệ:
{{
  "verdict": "1-2 câu tình trạng",
  "title": "title đề xuất 50-60 ký tự", "meta_description": "120-155 ký tự", "h1": "H1 đề xuất",
  "outline_add": ["H2/H3 nên thêm để phủ từ phụ và câu hỏi AI"],
  "answer_paragraph": "đoạn 40-60 chữ đặt ngay dưới H1, trả lời thẳng ý định chính",
  "conversion": ["việc tăng chuyển đổi: nút gọi, bảng giá, so sánh, chính sách, đánh giá..."],
  "tech": ["việc kỹ thuật/tốc độ cụ thể"],
  "priority_actions": ["3-6 việc theo thứ tự làm"]
}}"""
    progress("AI đang tư vấn trang…")
    with costs.module_as("smap_page"):
        txt, _, _ = claude(cfg, prompt, 3000, tag="smap_page")
    m = re.search(r"\{.*\}", txt, re.S)
    adv = jl(m.group(0), None) if m else None
    if not adv:
        raise RuntimeError("AI trả về dữ liệu không hợp lệ")
    adv["at"] = now()
    with LOCK, db() as conn:
        conn.execute("UPDATE smap_pages SET advice_json=? WHERE id=?", (json.dumps(adv, ensure_ascii=False), pid))
    return adv


def place_link(lid, progress=lambda m: None):
    cfg = load_config()
    with db() as conn:
        l = conn.execute("""SELECT l.*, a.url from_url, b.url to_url, b.title to_title FROM smap_links l JOIN smap_pages a ON a.id=l.from_id
                            JOIN smap_pages b ON b.id=l.to_id WHERE l.id=?""", (lid,)).fetchone()
    if not l:
        raise RuntimeError("Không tìm thấy gợi ý")
    progress("Đang đọc trang nguồn…")
    gp = geo.read_page(l["from_url"], 6000)
    if gp.get("error"):
        raise RuntimeError(f"Không đọc được trang nguồn: {gp['error']}")
    prompt = f"""Trang nguồn: {l['from_url']} (title: {gp.get('title')}).
Cần chèn 1 liên kết nội bộ tới {l['to_url']} (trang "{l['to_title']}") với chữ neo gần với: "{l['anchor']}". Lý do: {l['reason']}.
Nội dung trang nguồn:
{(gp.get('text') or '')[:5000]}

Tìm câu phù hợp NHẤT có sẵn trong nội dung để gắn link (chữ neo tự nhiên, 2-6 từ, đúng ngữ cảnh). Nếu không có câu phù hợp, viết 1 câu mới ngắn để chèn và nói chèn sau đoạn nào.
Chỉ trả về JSON hợp lệ: {{"found": true, "original": "câu gốc nguyên văn", "new_html": "câu đã gắn <a href=\\"{l['to_url']}\\">chữ neo</a>", "where": "vị trí (sau heading/đoạn nào)", "anchor": "chữ neo dùng"}}"""
    with costs.module_as("smap_place"):
        txt, _, _ = claude(cfg, prompt, 900, tag="smap_place")
    m = re.search(r"\{.*\}", txt, re.S)
    res = jl(m.group(0), None) if m else None
    if not res:
        raise RuntimeError("AI trả về dữ liệu không hợp lệ")
    with LOCK, db() as conn:
        conn.execute("UPDATE smap_links SET place_json=?, updated_at=? WHERE id=?", (json.dumps(res, ensure_ascii=False), now(), lid))
    return res


def psi_one(pid, progress=lambda m: None):
    with db() as conn:
        r = conn.execute("SELECT url FROM smap_pages WHERE id=?", (pid,)).fetchone()
    progress("Đang đo tốc độ (PageSpeed Insights)…")
    res = psi(r["url"], load_config().get("psi_api_key") or "")
    with LOCK, db() as conn:
        conn.execute("UPDATE smap_pages SET psi_json=? WHERE id=?", (json.dumps(res, ensure_ascii=False), pid))
    return res


# ---------------------------------------------------------------- đọc dữ liệu cho giao diện
def overview(sid):
    site = get_site(sid)
    with db() as conn:
        cyc = [dict(r) for r in conn.execute("SELECT id, at, auto, summary_json, diff_json, report_json, notes_json, cost_usd FROM smap_cycles WHERE site_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 24", (sid,))]
    last = cyc[0] if cyc else None
    trend = [{"at": c["at"], **{k: (jl(c["summary_json"], {}) or {}).get(k) for k in ("clicks", "impr", "avg_seo", "avg_geo", "avg_perf", "orphans", "issues", "key_events")}} for c in reversed(cyc)]
    aiq_vis = None
    ctx = site_context(site["domain"])
    if ctx["aiq_id"]:
        try:
            with db() as conn:
                r = conn.execute("SELECT summary_json, at FROM aiq_runs WHERE project_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1", (ctx["aiq_id"],)).fetchone()
            if r:
                aiq_vis = {"visibility": jl(r["summary_json"], {}).get("visibility"), "at": r["at"]}
        except Exception:  # noqa: BLE001
            pass
    key = load_config().get("psi_api_key") or ""
    return {"site": {**site, "psi_key": (key[:4] + "…" + key[-4:]) if key else ""}, "running": sid in RUNNING,
            "last": {"id": last["id"], "at": last["at"], "summary": jl(last["summary_json"], {}), "diff": jl(last["diff_json"], {}),
                     "report": jl(last["report_json"], None), "notes": jl(last["notes_json"], []), "cost_usd": last["cost_usd"]} if last else None,
            "cycles": [{"id": c["id"], "at": c["at"], "auto": c["auto"], "cost_usd": c["cost_usd"], "alerts": len((jl(c["diff_json"], {}) or {}).get("alerts", []))} for c in cyc],
            "trend": trend, "aiq": aiq_vis, "aiq_id": ctx["aiq_id"]}


def pages_list(sid):
    out = []
    for p in load_pages(sid):
        cur = ((p["gsc"] or {}).get("cur")) or {}
        prev = ((p["gsc"] or {}).get("prev")) or {}
        out.append({"id": p["id"], "url": p["url"], "title": p["title"], "type": p["type"], "role": p["role"], "cluster": p["cluster"], "intent": p["intent"],
                    "status": p["status"], "noindex": p["noindex"], "primary_kw": p["primary_kw"], "secondary": p["secondary"] or [], "geo": p["geo"] or [],
                    "locked": p["kw_locked"], "clicks": cur.get("clicks"), "clicks_prev": prev.get("clicks"), "impr": cur.get("impr"), "pos": cur.get("pos"),
                    "pos_prev": prev.get("pos"), "seo": p["seo"], "geo_score": p["geo_score"], "perf": (p["psi"] or {}).get("perf"),
                    "lcp": (p["psi"] or {}).get("lcp"), "inlinks": p["inlinks"], "depth": p["depth"], "index": (p["index"] or {}).get("verdict"),
                    "issues": p["issues"] or [], "value": p["value"], "key_events": (((p["ga"] or {}).get("cur")) or {}).get("key_events"),
                    "advised": bool(p["advice"])})
    return out


def page_detail(pid):
    with db() as conn:
        r = conn.execute("SELECT site_id FROM smap_pages WHERE id=?", (pid,)).fetchone()
        if not r:
            return None
        sid = r["site_id"]
        names = {x["id"]: (x["url"], x["primary_kw"], x["ukey"]) for x in conn.execute("SELECT id, url, primary_kw, ukey FROM smap_pages WHERE site_id=?", (sid,))}
        hist = [dict(x) for x in conn.execute("""SELECT c.at, s.clicks, s.impr, s.pos, s.seo, s.geo, s.perf, s.inlinks, s.rank, s.primary_kw FROM smap_snaps s
                                                 JOIN smap_cycles c ON c.id=s.cycle_id WHERE s.page_id=? ORDER BY c.id""", (pid,))]
        sto = [dict(x) for x in conn.execute("SELECT * FROM smap_links WHERE to_id=? AND status='todo' ORDER BY priority DESC LIMIT 20", (pid,))]
        sfrom = [dict(x) for x in conn.execute("SELECT * FROM smap_links WHERE from_id=? AND status='todo' ORDER BY priority DESC LIMIT 20", (pid,))]
    p = next(x for x in load_pages(sid, False) if x["id"] == pid)
    bykey = {v[2]: k for k, v in names.items()}
    p["links_in"] = [{"id": bykey.get(k), "url": names.get(bykey.get(k), (k,))[0], "anchor": a} for k, a in (p["anchors_in"] or [])]
    p["links_out"] = [{"id": bykey.get(k), "url": names[bykey[k]][0] if k in bykey else "https://" + k, "kw": names[bykey[k]][1] if k in bykey else ""} for k in p["links"][:80]]
    for s in sto:
        s["from_url"] = names.get(s["from_id"], ("",))[0]
        s["place"] = jl(s.pop("place_json"), None)
    for s in sfrom:
        s["to_url"] = names.get(s["to_id"], ("",))[0]
        s["place"] = jl(s.pop("place_json"), None)
    p["sugg_to"], p["sugg_from"], p["history"] = sto, sfrom, hist
    return p


def keywords_view(sid):
    pages = {p["id"]: p for p in load_pages(sid)}
    with db() as conn:
        c = conn.execute("SELECT cannibal_json FROM smap_cycles WHERE site_id=? AND cannibal_json IS NOT NULL ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    groups = jl(c["cannibal_json"], []) if c else []
    for g in groups:
        for x in g["pages"]:
            p = pages.get(x["id"]) or {}
            x.update(url=p.get("url"), primary_kw=p.get("primary_kw"), role=p.get("role"))
    gaps = []
    site = get_site(sid)
    ctx = site_context(site["domain"])
    if ctx["aiq_id"]:
        with db() as conn:
            gaps = [dict(r) for r in conn.execute("SELECT id, question, cluster, priority FROM aiq_questions WHERE project_id=? AND status='track' AND (target_url IS NULL OR target_url='') ORDER BY priority DESC LIMIT 60", (ctx["aiq_id"],))]
    kwmap = sorted([{"id": p["id"], "kw": p["primary_kw"], "url": p["url"], "role": p["role"], "cluster": p["cluster"], "intent": p["intent"],
                     "secondary": p["secondary"] or [], "pos": (((p["gsc"] or {}).get("cur")) or {}).get("pos"),
                     "rank": min([r["pos"] for r in (p["ranks"] or []) if r.get("pos") and fold(r["keyword"]) == fold(p["primary_kw"] or "")] or [None], key=lambda x: x or 999)}
                    for p in pages.values() if p["primary_kw"]], key=lambda x: (x["cluster"] or "", x["role"] != "pillar", x["kw"]))
    return {"cannibal": groups, "gaps": gaps, "map": kwmap, "aiq_id": ctx["aiq_id"]}


def links_view(sid):
    pages = {p["id"]: p for p in load_pages(sid)}
    with db() as conn:
        sug = [dict(r) for r in conn.execute("SELECT * FROM smap_links WHERE site_id=? ORDER BY status='todo' DESC, priority DESC LIMIT 600", (sid,))]
        c = conn.execute("SELECT summary_json FROM smap_cycles WHERE site_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    for s in sug:
        a, b = pages.get(s["from_id"]) or {}, pages.get(s["to_id"]) or {}
        s.update(from_url=a.get("url"), from_kw=a.get("primary_kw"), to_url=b.get("url"), to_kw=b.get("primary_kw"), place=jl(s.pop("place_json"), None))
    clus = (jl(c["summary_json"], {}) if c else {}).get("clusters", [])
    tree = []
    for cl in clus:
        mem = [p for p in pages.values() if (p["cluster"] or "Chưa phân nhóm") == cl["cluster"] and p["status"] == 200]
        hub = pages.get(cl.get("hub")) if cl.get("hub") else None
        tree.append({"cluster": cl["cluster"], "hub": {"id": hub["id"], "url": hub["url"], "kw": hub["primary_kw"]} if hub else None,
                     "pages": sorted([{"id": p["id"], "url": p["url"], "kw": p["primary_kw"], "role": p["role"], "inlinks": p["inlinks"], "depth": p["depth"],
                                       "to_hub": bool(hub and hub["ukey"] in p["links"]) if hub and p["id"] != hub["id"] else None} for p in mem],
                                     key=lambda x: (x["role"] != "pillar", x["role"] != "category", -(x["inlinks"] or 0)))[:60],
                     "missing": sum(1 for s in sug if s["status"] == "todo" and (pages.get(s["to_id"]) or {}).get("cluster") == cl["cluster"])})
    orph = [{"id": p["id"], "url": p["url"], "kw": p["primary_kw"]} for p in pages.values() if p["status"] == 200 and not p["noindex"] and (p["inlinks"] or 0) == 0 and p["role"] != "home"]
    brk = [{"from": p["url"], "to": "https://" + b[0], "status": b[1]} for p in pages.values() for b in (p["broken"] or [])]
    return {"suggestions": sug, "tree": tree, "orphans": orph, "broken": brk[:200]}


# ---------------------------------------------------------------- lịch
def scheduler_loop():
    time.sleep(90)
    while True:
        try:
            with db() as conn:
                ss = [dict(r) for r in conn.execute("SELECT id, auto_days FROM smap_sites WHERE auto=1")]
            for s in ss:
                with db() as conn:
                    last = conn.execute("SELECT MAX(at) FROM smap_cycles WHERE site_id=?", (s["id"],)).fetchone()[0]
                due = not last or datetime.fromisoformat(last) < datetime.now().astimezone() - timedelta(days=int(s["auto_days"]))
                if due and not costs.over_budget() and s["id"] not in RUNNING:
                    print(f"[bản đồ website] phân tích định kỳ website #{s['id']}")
                    try:
                        run_cycle(s["id"], {"full_ai": False}, auto=True)
                    except Exception as e:  # noqa: BLE001
                        print("[bản đồ website] lỗi:", e)
        except Exception as e:  # noqa: BLE001
            print("[bản đồ website] lỗi lịch:", e)
        time.sleep(3600)


# ---------------------------------------------------------------- API
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


def handle(h, method, path):
    seg = path.split("/")[3:]   # /api/smap/<seg...>
    q = parse_qs(urlparse(h.path).query)
    sid = int((q.get("site_id") or ["0"])[0] or 0)
    try:
        if method == "GET" and seg == ["sites"]:
            with db() as conn:
                ss = [dict(r) for r in conn.execute("SELECT s.*, (SELECT COUNT(*) FROM smap_pages p WHERE p.site_id=s.id AND p.active=1) pages FROM smap_sites s ORDER BY id")]
            key = load_config().get("psi_api_key") or ""
            return h.send_json({"items": ss, "psi_key": (key[:4] + "…" + key[-4:]) if key else ""})
        if method == "POST" and seg == ["sites"]:
            return h.send_json(save_site(h.read_json()))
        if method == "DELETE" and len(seg) == 2 and seg[0] == "sites":
            with LOCK, db() as conn:
                conn.execute("DELETE FROM smap_snaps WHERE cycle_id IN (SELECT id FROM smap_cycles WHERE site_id=?)", (seg[1],))
                for t in ("smap_links", "smap_cycles", "smap_pages"):
                    conn.execute(f"DELETE FROM {t} WHERE site_id=?", (seg[1],))
                conn.execute("DELETE FROM smap_sites WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})
        if method == "POST" and seg == ["cycle"]:
            b = h.read_json()
            s2 = int(b.get("site_id") or 0)
            if s2 in RUNNING:
                return h.send_json({"error": "Website này đang được phân tích."}, 409)
            return h.send_json({"job_id": start(run_cycle, s2, b.get("options") or {}, False)})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if method == "GET" and seg == ["overview"]:
            return h.send_json(overview(sid))
        if method == "GET" and seg == ["pages"]:
            return h.send_json({"items": pages_list(sid)})
        if len(seg) == 2 and seg[0] == "page":
            if method == "POST":
                b = h.read_json()
                sets, vals = [], []
                if "primary_kw" in b:
                    sets += ["primary_kw=?", "kw_locked=1"]
                    vals.append(" ".join(str(b["primary_kw"]).split()))
                if "secondary" in b:
                    sets.append("secondary_json=?")
                    vals.append(json.dumps([x for x in b["secondary"] if x], ensure_ascii=False))
                for k in ("role", "cluster", "intent"):
                    if k in b:
                        sets.append(f"{k}=?")
                        vals.append(b[k])
                if "locked" in b:
                    sets.append("kw_locked=?")
                    vals.append(1 if b["locked"] else 0)
                if sets:
                    with LOCK, db() as conn:
                        conn.execute(f"UPDATE smap_pages SET {', '.join(sets)} WHERE id=?", vals + [int(seg[1])])
                return h.send_json({"ok": True})
            d = page_detail(int(seg[1]))
            return h.send_json(d) if d else h.send_json({"error": "Không tìm thấy trang"}, 404)
        if method == "POST" and len(seg) == 3 and seg[0] == "page" and seg[2] == "advise":
            return h.send_json({"job_id": start(advise_page, int(seg[1]))})
        if method == "POST" and len(seg) == 3 and seg[0] == "page" and seg[2] == "psi":
            return h.send_json({"job_id": start(psi_one, int(seg[1]))})
        if method == "GET" and seg == ["keywords"]:
            return h.send_json(keywords_view(sid))
        if method == "GET" and seg == ["links"]:
            return h.send_json(links_view(sid))
        if method == "POST" and len(seg) == 2 and seg[0] == "links":
            b = h.read_json()
            if b.get("status") in ("todo", "done", "skip"):
                with LOCK, db() as conn:
                    conn.execute("UPDATE smap_links SET status=?, updated_at=? WHERE id=?", (b["status"], now(), int(seg[1])))
            return h.send_json({"ok": True})
        if method == "POST" and len(seg) == 3 and seg[0] == "links" and seg[2] == "place":
            return h.send_json({"job_id": start(place_link, int(seg[1]))})
        if method == "POST" and seg == ["send-rank"]:
            b = h.read_json()
            ids = [int(i) for i in b.get("page_ids") or []]
            site = get_site(int(b["site_id"]))
            added = 0
            with LOCK, db() as conn:
                for pid in ids:
                    r = conn.execute("SELECT primary_kw FROM smap_pages WHERE id=?", (pid,)).fetchone()
                    if r and r["primary_kw"]:
                        added += conn.execute("INSERT OR IGNORE INTO tracked(domain, keyword, location, language, created_at) VALUES (?,?,?,?,?)",
                                              (site["domain"], r["primary_kw"].lower(), "2704", "vi", now())).rowcount
            return h.send_json({"added": added})
        if method == "POST" and seg == ["send-autopost"]:
            b = h.read_json()
            n = 0
            with LOCK, db() as conn:
                for k in b.get("keywords") or []:
                    k = " ".join(str(k).split())
                    if k:
                        n += conn.execute("INSERT OR IGNORE INTO ap_keywords(site_id, keyword, status, created_at, updated_at) VALUES (?,?,?,?,?)",
                                          (int(b["ap_site_id"]), k, "pending", now(), now())).rowcount
            return h.send_json({"added": n})
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 400)
    return True
