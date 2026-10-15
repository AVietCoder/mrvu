"""
Autopost: AI viết bài chuẩn SEO từ từ khóa, gắn ảnh, đăng lên WordPress hoặc website riêng (Custom API).
Chỉ dùng thư viện chuẩn của Python.
"""
import base64
import json
import mimetypes
import random
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid

import costs
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Được gán bởi setup() từ app.py
db = None
LOCK = None
load_config = None
CONFIG_PATH = None
BASE = None
LIB_DIR = None
JOBS = {}
WRITING = set()   # keyword_id đang viết

STATUS_VI = {"pending": "Chờ viết", "writing": "Đang viết", "written": "Đã viết (chưa đăng)",
             "published": "Đã đăng", "error": "Lỗi"}


def setup(db_func, lock, load_cfg, config_path, base_dir):
    global db, LOCK, load_config, CONFIG_PATH, BASE, LIB_DIR
    db, LOCK, load_config, CONFIG_PATH, BASE = db_func, lock, load_cfg, config_path, base_dir
    LIB_DIR = Path(base_dir) / "anh-thu-vien"
    LIB_DIR.mkdir(exist_ok=True)
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS ap_sites(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kind TEXT, url TEXT, username TEXT, secret TEXT,
            category_id INTEGER, category_name TEXT, post_status TEXT DEFAULT 'draft', seo_plugin TEXT DEFAULT 'none',
            image_mode TEXT DEFAULT 'none', images_per_post INTEGER DEFAULT 2, word_target INTEGER DEFAULT 1200,
            extra_prompt TEXT DEFAULT '', auto_enabled INTEGER DEFAULT 0, per_day INTEGER DEFAULT 2,
            hour_from INTEGER DEFAULT 8, hour_to INTEGER DEFAULT 21, created_at TEXT)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS ap_keywords(
            id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, keyword TEXT, status TEXT DEFAULT 'pending',
            post_id INTEGER, error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(site_id, keyword))""")
        conn.execute("""CREATE TABLE IF NOT EXISTS ap_posts(
            id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, keyword_id INTEGER, keyword TEXT, title TEXT,
            slug TEXT, meta_title TEXT, meta_description TEXT, excerpt TEXT, tags_json TEXT, html TEXT,
            images_json TEXT, status TEXT, remote_id TEXT, remote_url TEXT, remote_status TEXT, usage_json TEXT,
            created_at TEXT, published_at TEXT)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS ap_logs(
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, site_id INTEGER, level TEXT, message TEXT)""")
    threading.Thread(target=scheduler_loop, daemon=True).start()


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def log(site_id, level, msg):
    with LOCK, db() as conn:
        conn.execute("INSERT INTO ap_logs(at, site_id, level, message) VALUES (?,?,?,?)", (now(), site_id, level, msg))
        conn.execute("DELETE FROM ap_logs WHERE id < (SELECT MAX(id) - 2000 FROM ap_logs)")


def slugify(s):
    s = s.lower().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:90]


def save_config(updates):
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            cfg = {}
    cfg.update(updates)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def mask(v):
    v = v or ""
    return (v[:6] + "…" + v[-4:]) if len(v) > 12 else ("đã nhập" if v else "")


# ================================================================ HTTP tiện ích
def http_json(url, method="GET", body=None, headers=None, timeout=60, raw=None):
    h = {"User-Agent": "MrVuSEOStudio-Autopost/1.0", "Accept": "application/json"}
    h.update(headers or {})
    data = raw
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        h["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(txt) if txt.strip()[:1] in "[{" else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except Exception:  # noqa: BLE001
            return e.code, txt[:500]
    except urllib.error.URLError as e:
        raise RuntimeError(f"Không kết nối được {urlparse(url).netloc}: {e.reason}")


def err_text(data):
    if isinstance(data, dict):
        return data.get("message") or data.get("error") or json.dumps(data, ensure_ascii=False)[:300]
    return str(data)[:300]


# ================================================================ Claude
def claude(cfg, prompt, max_tokens=4000, system=None, tag=None):
    key = (cfg.get("anthropic_api_key") or "").strip()
    if not key:
        raise RuntimeError("Chưa có khóa Claude API. Vào tab Cài đặt để nhập.")
    body = {"model": cfg.get("anthropic_model") or "claude-sonnet-5-5", "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    st, data = http_json("https://api.anthropic.com/v1/messages", "POST", body,
                         {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=360)
    if st == 401:
        raise RuntimeError("Khóa Claude API không đúng.")
    if st != 200:
        raise RuntimeError(f"Claude API lỗi {st}: {err_text(data.get('error', data) if isinstance(data, dict) else data)}")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    costs.record_claude(tag, data.get("usage", {}))
    return text, data.get("usage", {}), data.get("stop_reason")


def parse_json(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError("AI trả về dàn ý không đúng định dạng, hãy thử lại.")
    return json.loads(m.group(0))


ALLOWED = {"p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "a", "table", "thead", "tbody",
           "tr", "th", "td", "blockquote", "br", "figure", "figcaption", "img"}


def sanitize(html):
    html = re.sub(r"(?is)<(script|style|iframe|object|embed|form)[^>]*>.*?</\1>", "", html)
    html = re.sub(r"(?is)<h1[^>]*>(.*?)</h1>", r"<h2>\1</h2>", html)

    def fix_tag(m):
        closing, name, attrs = m.group(1), m.group(2).lower(), m.group(3) or ""
        if name not in ALLOWED:
            return ""
        if closing:
            return f"</{name}>"
        keep = []
        for an, av in re.findall(r'([a-zA-Z-]+)\s*=\s*"([^"]*)"', attrs):
            an = an.lower()
            if name == "a" and an in ("href", "title") and (an != "href" or av.startswith(("http://", "https://", "/"))):
                keep.append(f'{an}="{av}"')
            elif name == "img" and an in ("src", "alt", "width", "height", "loading"):
                keep.append(f'{an}="{av}"')
        return f"<{name}{(' ' + ' '.join(keep)) if keep else ''}>"
    html = re.sub(r"<(/?)([a-zA-Z0-9]+)([^>]*)>", fix_tag, html)
    return html.strip()


def variables_text(cfg):
    vs = cfg.get("ap_variables") or []
    return "\n".join(f"- {v['name']}: {v['value']}" for v in vs if v.get("name") and v.get("value"))


def apply_vars(text, cfg):
    for v in cfg.get("ap_variables") or []:
        if v.get("name"):
            text = text.replace("{" + v["name"] + "}", v.get("value", ""))
    return text


def link_candidates(site):
    host = urlparse(site["url"]).netloc.lower().split(":")[0]
    host = host[4:] if host.startswith("www.") else host
    out = []
    with db() as conn:
        try:
            rows = conn.execute(
                """SELECT p.url, p.type FROM audit_pages p JOIN audit_sites s ON s.id=p.site_id
                   WHERE s.domain=? AND p.type IN ('post','product','category') ORDER BY p.id DESC LIMIT 120""",
                (host,)).fetchall()
            out += [r["url"] for r in rows]
        except Exception:  # noqa: BLE001
            pass
        rows = conn.execute("SELECT remote_url, title FROM ap_posts WHERE site_id=? AND remote_url LIKE 'http%' "
                            "ORDER BY id DESC LIMIT 60", (site["id"],)).fetchall()
        out += [r["remote_url"] for r in rows]
    return list(dict.fromkeys(out))[:150]


def write_article(site, keyword, cfg, progress=lambda m: None):
    """Trả về dict bài viết (chưa đăng)."""
    vars_txt = variables_text(cfg)
    extra = apply_vars(site.get("extra_prompt") or "", cfg)
    links = link_candidates(site)
    words = int(site.get("word_target") or 1200)
    progress("AI đang lập dàn ý…")
    plan_prompt = f"""Bạn là biên tập viên SEO tiếng Việt. Lập kế hoạch một bài viết chuẩn SEO cho website {site['url']}.

Từ khóa chính: "{keyword}"
Độ dài mục tiêu: khoảng {words} chữ.
Thông tin doanh nghiệp (dùng khi phù hợp, không bịa thêm):
{vars_txt or '- (không có)'}
{('Yêu cầu riêng của website: ' + extra) if extra else ''}

Danh sách URL có sẵn trên website (chỉ được chọn link nội bộ từ danh sách này, đoán chủ đề qua đường dẫn):
{chr(10).join(links[:120]) or '(không có)'}

Xác định đúng ý định tìm kiếm của người dùng khi gõ từ khóa này. Chỉ trả về JSON hợp lệ:
{{
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
  "internal_links": [{{"url": "URL lấy từ danh sách", "anchor": "chữ neo tự nhiên"}}]
}}
Chọn 2-4 link nội bộ thật sự liên quan; nếu danh sách trống thì để mảng rỗng."""
    plan_txt, u1, _ = claude(cfg, plan_prompt, 2500, tag="autopost_write")
    plan = parse_json(plan_txt)
    allowed = set(links)
    plan["internal_links"] = [l for l in plan.get("internal_links") or [] if l.get("url") in allowed][:4]

    progress("AI đang viết bài…")
    link_txt = "\n".join(f'- <a href="{l["url"]}">{l["anchor"]}</a>' for l in plan["internal_links"])
    article_prompt = f"""Viết bài chuẩn SEO tiếng Việt theo kế hoạch sau.

Từ khóa chính: "{keyword}"
Tiêu đề (H1, KHÔNG viết lại trong bài): {plan.get('title')}
Ý định tìm kiếm: {plan.get('search_intent', '')}
Dàn ý:
{chr(10).join(plan.get('outline') or [])}
Độ dài: khoảng {words} chữ.
Thông tin doanh nghiệp (chỉ dùng thông tin có ở đây, không bịa giá, thông số, số điện thoại):
{vars_txt or '- (không có)'}
{('Yêu cầu riêng: ' + extra) if extra else ''}
Chèn tự nhiên các liên kết nội bộ sau vào thân bài (giữ nguyên href):
{link_txt or '(không có)'}

Quy tắc:
- Mở bài 2-3 câu, nhắc từ khóa chính trong 100 chữ đầu, trả lời ngay điều người đọc cần.
- Dùng <h2>, <h3> theo dàn ý; đoạn văn ngắn 2-4 câu; dùng <ul>/<ol> hoặc <table> khi so sánh, liệt kê.
- Từ khóa chính xuất hiện tự nhiên (mật độ 0,8-1,5%), dùng thêm biến thể và từ đồng nghĩa.
- Viết như chuyên gia có kinh nghiệm thực tế, cụ thể, hữu ích; tránh câu sáo rỗng, tránh nhồi từ khóa.
- Có mục "Câu hỏi thường gặp" với 3-5 câu hỏi dạng <h3>.
- Kết bài có lời kêu gọi hành động dùng thông tin doanh nghiệp nếu có.
- Chỉ dùng các thẻ: p, h2, h3, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td, blockquote. Không có H1, không CSS, không markdown.
Chỉ trả về HTML của thân bài, đặt giữa <article> và </article>."""
    html_txt, u2, stop = claude(cfg, article_prompt, 12000, tag="autopost_write")
    m = re.search(r"(?is)<article[^>]*>(.*)</article>", html_txt)
    body = m.group(1) if m else html_txt
    body = re.sub(r"(?is)^```html|```$", "", body.strip())
    if stop == "max_tokens":
        body += "\n<p></p>"
    html = sanitize(body)
    if len(re.sub(r"<[^>]+>", " ", html).split()) < 150:
        raise RuntimeError("AI trả về bài quá ngắn, hãy thử lại.")
    usage = {"input_tokens": u1.get("input_tokens", 0) + u2.get("input_tokens", 0),
             "output_tokens": u1.get("output_tokens", 0) + u2.get("output_tokens", 0)}
    return {"keyword": keyword, "title": plan.get("title") or keyword, "slug": slugify(plan.get("slug") or keyword),
            "meta_title": plan.get("meta_title") or plan.get("title"), "meta_description": plan.get("meta_description", ""),
            "excerpt": plan.get("excerpt", ""), "tags": plan.get("tags") or [], "html": html,
            "image_queries": plan.get("image_queries") or [keyword], "image_alts": plan.get("image_alts") or [],
            "internal_links": plan["internal_links"], "usage": usage}


# ================================================================ Ảnh
def library_images(keyword, n):
    files = [p for p in LIB_DIR.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    if not files:
        raise RuntimeError("Thư mục anh-thu-vien đang trống. Chép ảnh của bạn vào đó (đặt tên file không dấu theo nội dung ảnh).")
    kw = set(slugify(keyword).split("-"))
    files.sort(key=lambda p: (-len(kw & set(slugify(p.stem).split("-"))), random.random()))
    out = []
    for p in files[:n]:
        out.append({"bytes": p.read_bytes(), "filename": slugify(keyword) + "-" + slugify(p.stem)[:30] + p.suffix.lower(),
                    "mime": mimetypes.guess_type(p.name)[0] or "image/jpeg", "credit": ""})
    return out


def pexels_images(cfg, queries, n):
    key = (cfg.get("pexels_api_key") or "").strip()
    if not key:
        raise RuntimeError("Chưa có khóa Pexels API. Vào tab Cài đặt để nhập (miễn phí tại pexels.com/api).")
    out, seen = [], set()
    for q in (queries or [])[:3] * 2:
        if len(out) >= n:
            break
        st, data = http_json("https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": q, "per_page": 8, "orientation": "landscape"}),
                             headers={"Authorization": key}, timeout=30)
        if st != 200:
            raise RuntimeError(f"Pexels lỗi {st}: {err_text(data)}")
        for ph in data.get("photos", []):
            if ph["id"] in seen:
                continue
            seen.add(ph["id"])
            req = urllib.request.Request(ph["src"]["large"], headers={"User-Agent": "MrVuSEOStudio-Autopost/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                out.append({"bytes": r.read(), "filename": f"{slugify(q)}-{ph['id']}.jpg", "mime": "image/jpeg",
                            "credit": f"Ảnh: {ph.get('photographer', '')} / Pexels"})
            break
    return out[:n]


def get_images(site, art, cfg):
    n = int(site.get("images_per_post") or 0)
    mode = site.get("image_mode") or "none"
    if mode == "none" or n <= 0:
        return []
    imgs = library_images(art["keyword"], n) if mode == "library" else pexels_images(cfg, art["image_queries"], n)
    alts = art.get("image_alts") or []
    for i, im in enumerate(imgs):
        im["alt"] = alts[i] if i < len(alts) else f"{art['keyword']} - ảnh {i + 1}"
    return imgs


def insert_images(html, imgs):
    """Chèn ảnh (đã có url) sau H2 thứ 1, 3, 5…; ảnh đầu dùng làm ảnh đại diện nên bỏ qua."""
    body_imgs = imgs[1:] if len(imgs) > 1 else []
    parts = re.split(r"(?i)(</h2>)", html)
    out, h2 = [], 0
    for part in parts:
        out.append(part)
        if part.lower() == "</h2>":
            h2 += 1
            if body_imgs and h2 % 2 == 1:
                im = body_imgs.pop(0)
                cap = f"<figcaption>{im['alt']}</figcaption>"
                out.append(f'<figure><img src="{im["url"]}" alt="{im["alt"]}" loading="lazy">{cap}</figure>')
    return "".join(out)


# ================================================================ Đăng bài
def wp_base(site):
    return site["url"].rstrip("/") + "/wp-json/wp/v2"


def wp_auth(site):
    tok = base64.b64encode(f"{site['username']}:{site['secret']}".encode()).decode()
    return {"Authorization": "Basic " + tok}


def wp_test(site):
    st, me = http_json(wp_base(site) + "/users/me?context=edit", headers=wp_auth(site), timeout=30)
    if st == 404:
        raise RuntimeError("Không tìm thấy WordPress REST API (/wp-json). Kiểm tra lại địa chỉ, hoặc website đang tắt REST API.")
    if st in (401, 403):
        raise RuntimeError("Sai tên đăng nhập hoặc Application Password, hoặc tài khoản không có quyền viết bài.")
    if st != 200:
        raise RuntimeError(f"WordPress trả lỗi {st}: {err_text(me)}")
    st, cats = http_json(wp_base(site) + "/categories?per_page=100&_fields=id,name,count", headers=wp_auth(site), timeout=30)
    return {"user": me.get("name"), "roles": me.get("roles"),
            "categories": [{"id": c["id"], "name": unescape_html(c["name"])} for c in (cats if isinstance(cats, list) else [])]}


def unescape_html(s):
    from html import unescape
    return unescape(s or "")


def wp_tag_ids(site, tags):
    ids = []
    for t in tags[:6]:
        st, found = http_json(wp_base(site) + "/tags?" + urllib.parse.urlencode({"search": t, "_fields": "id,name"}), headers=wp_auth(site))
        hit = next((x for x in (found if isinstance(found, list) else []) if x["name"].lower() == t.lower()), None)
        if hit:
            ids.append(hit["id"])
            continue
        st, new = http_json(wp_base(site) + "/tags", "POST", {"name": t}, wp_auth(site))
        if st in (200, 201):
            ids.append(new["id"])
        elif isinstance(new, dict) and new.get("data", {}).get("term_id"):
            ids.append(new["data"]["term_id"])
    return ids


def wp_upload(site, im):
    h = wp_auth(site)
    h.update({"Content-Type": im["mime"], "Content-Disposition": f'attachment; filename="{im["filename"]}"'})
    st, media = http_json(wp_base(site) + "/media", "POST", headers=h, raw=im["bytes"], timeout=120)
    if st not in (200, 201):
        raise RuntimeError(f"Tải ảnh lên WordPress lỗi {st}: {err_text(media)}")
    http_json(wp_base(site) + f"/media/{media['id']}", "POST", {"alt_text": im["alt"], "caption": im.get("credit", "")}, wp_auth(site))
    return media["id"], media.get("source_url")


def publish_wordpress(site, post, imgs):
    featured = None
    for im in imgs:
        mid, url = wp_upload(site, im)
        im["url"], im["media_id"] = url, mid
        featured = featured or mid
    html = insert_images(post["html"], imgs)
    data = {"title": post["title"], "content": html, "status": site.get("post_status") or "draft",
            "slug": post["slug"], "excerpt": post["excerpt"]}
    if site.get("category_id"):
        data["categories"] = [int(site["category_id"])]
    if featured:
        data["featured_media"] = featured
    try:
        tag_ids = wp_tag_ids(site, post["tags"])
        if tag_ids:
            data["tags"] = tag_ids
    except Exception:  # noqa: BLE001
        pass
    sp = site.get("seo_plugin") or "none"
    if sp == "yoast":
        data["meta"] = {"_yoast_wpseo_title": post["meta_title"], "_yoast_wpseo_metadesc": post["meta_description"],
                        "_yoast_wpseo_focuskw": post["keyword"]}
    elif sp == "rankmath":
        data["meta"] = {"rank_math_title": post["meta_title"], "rank_math_description": post["meta_description"],
                        "rank_math_focus_keyword": post["keyword"]}
    st, res = http_json(wp_base(site) + "/posts", "POST", data, wp_auth(site), timeout=120)
    if st not in (200, 201) and "meta" in data:
        data.pop("meta")
        st, res = http_json(wp_base(site) + "/posts", "POST", data, wp_auth(site), timeout=120)
        log(site["id"], "warn", "WordPress không nhận meta SEO; hãy cài file mrvu-seo-studio-seo-meta.php (xem hướng dẫn).")
    if st not in (200, 201):
        raise RuntimeError(f"Đăng bài lên WordPress lỗi {st}: {err_text(res)}")
    return str(res["id"]), res.get("link"), res.get("status"), html


def publish_custom(site, post, imgs):
    html = post["html"]
    payload = {"title": post["title"], "slug": post["slug"], "content_html": html, "excerpt": post["excerpt"],
               "meta_title": post["meta_title"], "meta_description": post["meta_description"], "keyword": post["keyword"],
               "tags": post["tags"], "status": site.get("post_status") or "draft", "category": site.get("category_name") or "",
               "images": [{"filename": im["filename"], "mime": im["mime"], "alt": im["alt"], "credit": im.get("credit", ""),
                           "base64": base64.b64encode(im["bytes"]).decode()} for im in imgs]}
    headers = {"Authorization": "Bearer " + site["secret"]} if site.get("secret") else {}
    st, res = http_json(site["url"], "POST", payload, headers, timeout=180)
    if st not in (200, 201):
        raise RuntimeError(f"Website trả lỗi {st}: {err_text(res)}")
    res = res if isinstance(res, dict) else {}
    return str(res.get("id", "")), res.get("url") or res.get("link"), res.get("status", payload["status"]), html


# ================================================================ Quy trình
def get_site(conn, sid):
    r = conn.execute("SELECT * FROM ap_sites WHERE id=?", (sid,)).fetchone()
    return dict(r) if r else None


def set_kw(kid, status, post_id=None, error=None):
    with LOCK, db() as conn:
        conn.execute("UPDATE ap_keywords SET status=?, post_id=COALESCE(?, post_id), error=?, updated_at=? WHERE id=?",
                     (status, post_id, error, now(), kid))


def do_publish(site, post_id, cfg, progress=lambda m: None):
    with db() as conn:
        post = dict(conn.execute("SELECT * FROM ap_posts WHERE id=?", (post_id,)).fetchone())
    post["tags"] = json.loads(post["tags_json"] or "[]")
    meta = json.loads(post["images_json"] or "{}")
    art = {"keyword": post["keyword"], "image_queries": meta.get("queries") or [post["keyword"]], "image_alts": meta.get("alts") or []}
    progress("Đang lấy ảnh…")
    imgs = get_images(site, art, cfg)
    progress("Đang đăng lên website…")
    fn = publish_wordpress if site["kind"] == "wordpress" else publish_custom
    rid, url, rstatus, html = fn(site, post, imgs)
    with LOCK, db() as conn:
        conn.execute("UPDATE ap_posts SET status='published', remote_id=?, remote_url=?, remote_status=?, html=?, published_at=? WHERE id=?",
                     (rid, url, rstatus, html, now(), post_id))
    if post["keyword_id"]:
        set_kw(post["keyword_id"], "published", post_id)
    log(site["id"], "ok", f'Đã đăng "{post["title"]}" ({"nháp" if rstatus == "draft" else rstatus}) {url or ""}')
    return url


def process_keyword(kid, publish, progress=lambda m: None):
    cfg = load_config()
    with db() as conn:
        kw = dict(conn.execute("SELECT * FROM ap_keywords WHERE id=?", (kid,)).fetchone())
        site = get_site(conn, kw["site_id"])
    WRITING.add(kid)
    set_kw(kid, "writing")
    try:
        art = write_article(site, kw["keyword"], cfg, progress)
        with LOCK, db() as conn:
            cur = conn.execute(
                """INSERT INTO ap_posts(site_id, keyword_id, keyword, title, slug, meta_title, meta_description, excerpt,
                   tags_json, html, images_json, status, usage_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (site["id"], kid, kw["keyword"], art["title"], art["slug"], art["meta_title"], art["meta_description"],
                 art["excerpt"], json.dumps(art["tags"], ensure_ascii=False), art["html"],
                 json.dumps({"queries": art["image_queries"], "alts": art["image_alts"], "links": art["internal_links"]}, ensure_ascii=False),
                 "local", json.dumps(art["usage"]), now()))
            pid = cur.lastrowid
        set_kw(kid, "written", pid)
        u = art["usage"]
        log(site["id"], "ok", f'AI đã viết "{art["title"]}" ({u["input_tokens"]:,} + {u["output_tokens"]:,} token)')
        if publish:
            do_publish(site, pid, cfg, progress)
        return pid
    except Exception as e:  # noqa: BLE001
        set_kw(kid, "error", error=str(e))
        log(site["id"], "error", f'Từ khóa "{kw["keyword"]}": {e}')
        raise
    finally:
        WRITING.discard(kid)


def start_job(fn, *args):
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


def scheduler_loop():
    """Tự động viết & đăng theo lịch của từng website, kiểm tra mỗi phút khi công cụ đang mở."""
    time.sleep(20)
    while True:
        try:
            n = datetime.now()
            with db() as conn:
                sites = [dict(r) for r in conn.execute("SELECT * FROM ap_sites WHERE auto_enabled=1").fetchall()]
            if sites and costs.over_budget() and costs.settings()[0].get("auto_stop", True):
                day = n.strftime("%Y-%m-%d")
                if getattr(scheduler_loop, "_warned", None) != day:
                    scheduler_loop._warned = day
                    for s in sites:
                        log(s["id"], "warn", "Đã vượt ngân sách tháng: lịch tự động tạm dừng. Tăng ngân sách hoặc tắt “tự dừng” trong Cài đặt chi phí để chạy tiếp.")
                sites = []
            for s in sites:
                if not (int(s["hour_from"]) <= n.hour < int(s["hour_to"])):
                    continue
                day = n.strftime("%Y-%m-%d")
                with db() as conn:
                    done = conn.execute("SELECT COUNT(*) FROM ap_posts WHERE site_id=? AND substr(created_at,1,10)=?", (s["id"], day)).fetchone()[0]
                    last = conn.execute("SELECT MAX(created_at) FROM ap_posts WHERE site_id=?", (s["id"],)).fetchone()[0]
                    nxt = conn.execute("SELECT id FROM ap_keywords WHERE site_id=? AND status='pending' ORDER BY id LIMIT 1", (s["id"],)).fetchone()
                if done >= int(s["per_day"]) or not nxt or WRITING:
                    continue
                window = (int(s["hour_to"]) - int(s["hour_from"])) * 60
                gap = max(20, window // max(1, int(s["per_day"])))
                if last and datetime.fromisoformat(last) > (datetime.now().astimezone() - timedelta(minutes=gap)):
                    continue
                log(s["id"], "info", "Lịch tự động: bắt đầu viết bài tiếp theo")
                try:
                    process_keyword(nxt["id"], True)
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            print("[autopost] lỗi lịch:", e)
        time.sleep(60)


# ================================================================ API cho giao diện
SITE_FIELDS = ["name", "kind", "url", "username", "secret", "category_id", "category_name", "post_status", "seo_plugin",
               "image_mode", "images_per_post", "word_target", "extra_prompt", "auto_enabled", "per_day", "hour_from", "hour_to"]


def site_public(s):
    s = dict(s)
    s["secret"] = mask(s.get("secret"))
    return s


def handle(h, method, path):
    """h là BaseHTTPRequestHandler của app.py. Trả về True nếu đã xử lý."""
    q = parse_qs(urlparse(h.path).query)
    seg = path.split("/")[3:]  # /api/ap/<seg...>
    try:
        if method == "GET" and seg == ["sites"]:
            with db() as conn:
                rows = conn.execute("""SELECT s.*, (SELECT COUNT(*) FROM ap_keywords k WHERE k.site_id=s.id AND k.status='pending') pending,
                    (SELECT COUNT(*) FROM ap_posts p WHERE p.site_id=s.id AND p.status='published') published
                    FROM ap_sites s ORDER BY s.id DESC""").fetchall()
            return h.send_json({"items": [site_public(r) for r in rows]})
        if method == "POST" and seg == ["sites"]:
            b = h.read_json()
            url = (b.get("url") or "").strip().rstrip("/")
            if not re.match(r"^https?://", url):
                return h.send_json({"error": "Địa chỉ phải bắt đầu bằng https:// (với Custom API là địa chỉ nhận bài đầy đủ)."}, 400)
            b["url"] = url
            b.setdefault("name", urlparse(url).netloc)
            with LOCK, db() as conn:
                if b.get("id"):
                    old = get_site(conn, b["id"])
                    if not b.get("secret") or "…" in str(b.get("secret")) or b.get("secret") == "đã nhập":
                        b["secret"] = old["secret"]
                    sets = ", ".join(f"{f}=?" for f in SITE_FIELDS)
                    conn.execute(f"UPDATE ap_sites SET {sets} WHERE id=?", [b.get(f) for f in SITE_FIELDS] + [b["id"]])
                    sid = b["id"]
                else:
                    cols = ", ".join(SITE_FIELDS)
                    cur = conn.execute(f"INSERT INTO ap_sites({cols}, created_at) VALUES ({', '.join('?' * len(SITE_FIELDS))}, ?)",
                                       [b.get(f) for f in SITE_FIELDS] + [now()])
                    sid = cur.lastrowid
            log(sid, "info", f"Đã lưu cấu hình website {b['name']}")
            with db() as conn:
                return h.send_json(site_public(get_site(conn, sid)))
        if method == "POST" and len(seg) == 3 and seg[0] == "sites" and seg[2] == "test":
            b = h.read_json()
            with db() as conn:
                site = get_site(conn, int(seg[1])) if seg[1] != "new" else None
            site = dict(site or {})
            for k in ("kind", "url", "username"):
                if b.get(k):
                    site[k] = b[k].rstrip("/") if k == "url" else b[k]
            if b.get("secret") and "…" not in b["secret"] and b["secret"] != "đã nhập":
                site["secret"] = b["secret"]
            if site.get("kind") == "custom":
                headers = {"Authorization": "Bearer " + site["secret"]} if site.get("secret") else {}
                st, res = http_json(site["url"], "POST", {"test": True}, headers, timeout=30)
                if st not in (200, 201):
                    raise RuntimeError(f"Địa chỉ nhận bài trả lỗi {st}: {err_text(res)}")
                return h.send_json({"user": "Custom API", "categories": []})
            return h.send_json(wp_test(site))
        if method == "DELETE" and len(seg) == 2 and seg[0] == "sites":
            with LOCK, db() as conn:
                conn.execute("DELETE FROM ap_keywords WHERE site_id=?", (seg[1],))
                conn.execute("DELETE FROM ap_sites WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})

        if method == "GET" and seg == ["keywords"]:
            sid = (q.get("site_id") or ["0"])[0]
            with db() as conn:
                rows = conn.execute("""SELECT k.*, p.title post_title, p.remote_url FROM ap_keywords k
                    LEFT JOIN ap_posts p ON p.id=k.post_id WHERE k.site_id=? ORDER BY k.id""", (sid,)).fetchall()
            return h.send_json({"items": [dict(r) for r in rows]})
        if method == "POST" and seg == ["keywords"]:
            b = h.read_json()
            added = 0
            with LOCK, db() as conn:
                for k in b.get("keywords", []):
                    k = " ".join(str(k).split()).strip()
                    if k:
                        cur = conn.execute("INSERT OR IGNORE INTO ap_keywords(site_id, keyword, created_at, updated_at) VALUES (?,?,?,?)",
                                           (b["site_id"], k, now(), now()))
                        added += cur.rowcount
            return h.send_json({"added": added})
        if method == "POST" and len(seg) == 3 and seg[0] == "keywords" and seg[2] == "reset":
            set_kw(int(seg[1]), "pending")
            return h.send_json({"ok": True})
        if method == "DELETE" and len(seg) == 2 and seg[0] == "keywords":
            with LOCK, db() as conn:
                conn.execute("DELETE FROM ap_keywords WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})

        if method == "POST" and seg == ["write"]:
            b = h.read_json()
            kid = int(b["keyword_id"])
            if kid in WRITING:
                return h.send_json({"error": "Từ khóa này đang được viết."}, 409)
            return h.send_json({"job_id": start_job(process_keyword, kid, bool(b.get("publish")))})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})

        if method == "GET" and seg == ["posts"]:
            sid = (q.get("site_id") or [""])[0]
            sql = """SELECT p.id, p.site_id, p.keyword, p.title, p.status, p.remote_url, p.remote_status, p.created_at,
                     p.published_at, s.name site_name FROM ap_posts p LEFT JOIN ap_sites s ON s.id=p.site_id"""
            with db() as conn:
                rows = conn.execute(sql + (" WHERE p.site_id=?" if sid else "") + " ORDER BY p.id DESC LIMIT 300",
                                    ((sid,) if sid else ())).fetchall()
            return h.send_json({"items": [dict(r) for r in rows]})
        if method == "GET" and len(seg) == 2 and seg[0] == "posts":
            with db() as conn:
                r = conn.execute("SELECT * FROM ap_posts WHERE id=?", (seg[1],)).fetchone()
            if not r:
                return h.send_json({"error": "Không tìm thấy bài"}, 404)
            d = dict(r)
            d["tags"] = json.loads(d.pop("tags_json") or "[]")
            d["extra"] = json.loads(d.pop("images_json") or "{}")
            d["usage"] = json.loads(d.pop("usage_json") or "{}")
            return h.send_json(d)
        if method == "POST" and len(seg) == 3 and seg[0] == "posts" and seg[2] == "publish":
            with db() as conn:
                r = conn.execute("SELECT site_id FROM ap_posts WHERE id=?", (seg[1],)).fetchone()
                site = get_site(conn, r["site_id"]) if r else None
            if not site:
                return h.send_json({"error": "Không tìm thấy bài hoặc website"}, 404)
            pid = int(seg[1])

            def pub(progress):
                try:
                    return do_publish(site, pid, load_config(), progress)
                except Exception as e:
                    log(site["id"], "error", f"Đăng bài #{pid} lỗi: {e}")
                    raise
            return h.send_json({"job_id": start_job(lambda progress: pub(progress))})
        if method == "POST" and len(seg) == 2 and seg[0] == "posts":
            b = h.read_json()
            with LOCK, db() as conn:
                conn.execute("UPDATE ap_posts SET title=?, meta_title=?, meta_description=?, slug=?, html=? WHERE id=?",
                             (b["title"], b["meta_title"], b["meta_description"], slugify(b["slug"]), sanitize(b["html"]), seg[1]))
            return h.send_json({"ok": True})
        if method == "DELETE" and len(seg) == 2 and seg[0] == "posts":
            with LOCK, db() as conn:
                conn.execute("UPDATE ap_keywords SET status='pending', post_id=NULL WHERE post_id=? AND status='written'", (seg[1],))
                conn.execute("DELETE FROM ap_posts WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})

        if method == "GET" and seg == ["settings"]:
            cfg = load_config()
            nlib = len([p for p in LIB_DIR.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
            return h.send_json({"anthropic_api_key": mask(cfg.get("anthropic_api_key")), "anthropic_model": cfg.get("anthropic_model"),
                                "pexels_api_key": mask(cfg.get("pexels_api_key")), "ap_variables": cfg.get("ap_variables") or [],
                                "library_count": nlib, "library_path": str(LIB_DIR)})
        if method == "POST" and seg == ["settings"]:
            b = h.read_json()
            up = {"ap_variables": [v for v in b.get("ap_variables", []) if v.get("name")]}
            if b.get("anthropic_model"):
                up["anthropic_model"] = b["anthropic_model"].strip()
            for k in ("anthropic_api_key", "pexels_api_key"):
                v = (b.get(k) or "").strip()
                if v and "…" not in v and v != "đã nhập":
                    up[k] = v
            save_config(up)
            return h.send_json({"ok": True})
        if method == "GET" and seg == ["logs"]:
            with db() as conn:
                rows = conn.execute("""SELECT l.*, s.name site_name FROM ap_logs l LEFT JOIN ap_sites s ON s.id=l.site_id
                                       ORDER BY l.id DESC LIMIT 300""").fetchall()
            return h.send_json({"items": [dict(r) for r in rows]})
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502)
    return True
