"""
Bộ quét website và kiểm toán SEO on-page cho Mr.Vũ SEO Studio.
Chỉ dùng thư viện chuẩn của Python.
"""
import gzip
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urldefrag

import costs

UA = "Mozilla/5.0 (compatible; MrVuSEOStudio/1.0; +internal SEO tool)"
SKIP_EXT = re.compile(
    r"\.(jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|pdf|zip|rar|7z|gz|mp4|mp3|webm|avi|mov|"
    r"doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|txt|woff2?|ttf|eot)$", re.I)

TYPE_VI = {"home": "Trang chủ", "category": "Danh mục", "product": "Sản phẩm", "post": "Bài viết", "other": "Khác"}


# ---------------------------------------------------------------- tải trang
class _Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        self.chain = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.chain.append((code, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, timeout=20, method="GET", max_bytes=6_000_000):
    """Trả về dict: url (cuối cùng), status, headers, body (bytes), elapsed (giây), redirects."""
    red = _Redirects()
    opener = urllib.request.build_opener(red)
    req = urllib.request.Request(url, method=method, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"})
    t0 = time.time()
    try:
        with opener.open(req, timeout=timeout) as r:
            body = r.read(max_bytes) if method == "GET" else b""
            return {"url": r.geturl(), "status": r.status, "headers": dict(r.headers), "body": body,
                    "elapsed": time.time() - t0, "redirects": red.chain}
    except urllib.error.HTTPError as e:
        body = b""
        try:
            body = e.read(200_000)
        except Exception:  # noqa: BLE001
            pass
        return {"url": e.geturl() or url, "status": e.code, "headers": dict(e.headers or {}), "body": body,
                "elapsed": time.time() - t0, "redirects": red.chain}
    except Exception as e:  # noqa: BLE001
        return {"url": url, "status": 0, "headers": {}, "body": b"", "elapsed": time.time() - t0,
                "redirects": red.chain, "error": str(getattr(e, "reason", e))}


def decode(res):
    body = res["body"]
    if body[:2] == b"\x1f\x8b":
        try:
            body = gzip.decompress(body)
        except Exception:  # noqa: BLE001
            pass
    ctype = ""
    for k, v in res["headers"].items():
        if k.lower() == "content-type":
            ctype = v
    m = re.search(r"charset=([\w-]+)", ctype, re.I) or re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', body[:3000], re.I)
    enc = m.group(1) if m else "utf-8"
    if isinstance(enc, bytes):
        enc = enc.decode("ascii", "ignore")
    try:
        return body.decode(enc, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def header(res, name):
    for k, v in res["headers"].items():
        if k.lower() == name.lower():
            return v
    return ""


# ---------------------------------------------------------------- tiện ích URL
def normalize_start(u):
    u = u.strip()
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}{p.path or '/'}"


def bare_host(h):
    h = (h or "").lower().split(":")[0]
    return h[4:] if h.startswith("www.") else h


def same_site(url, host):
    return bare_host(urlparse(url).netloc) == bare_host(host)


def clean_url(u):
    u, _ = urldefrag(u.strip())
    return u


def slugify(s):
    s = s.lower().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


# ---------------------------------------------------------------- phân loại
def classify(url, source=""):
    p = urlparse(url)
    path = p.path.lower()
    src = (source or "").lower()
    if path in ("", "/", "/index.html", "/index.php", "/default.aspx", "/index.aspx", "/trang-chu", "/home") and not p.query:
        return "home"
    if re.search(r"product[_-]?cat|category|collection|danh-?muc|chuyen-?muc|tag", src):
        return "category"
    if re.search(r"product|san-?pham", src):
        return "product"
    if re.search(r"post|news|blog|article|tin-?tuc|bai-?viet", src):
        return "post"
    if re.search(r"/(product-category|danh-muc|danh-muc-san-pham|category|categories|collections|chuyen-muc|c|cat)/", path):
        return "category"
    if re.search(r"/(san-pham|product|products|sp|shop|p)/[^/]+", path) or re.search(r"-p\d+(\.\w+)?$|[?&](pid|product_id)=", url.lower()):
        return "product"
    if re.search(r"/(tin-tuc|blog|bai-viet|news|kien-thuc|tu-van|cam-nang|post|posts|huong-dan)/[^/]+", path) or re.search(r"/20\d\d/\d\d/", path):
        return "post"
    return "other"


# ---------------------------------------------------------------- quét website
def _sitemap_locs(text):
    is_index = "<sitemapindex" in text[:2000].lower()
    locs = [unescape(m.strip()) for m in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>", text, re.I | re.S)]
    return is_index, locs


def crawl(start, max_pages=1000, progress=lambda msg, n: None):
    """Trả về (url_trang_chủ, [(url, loại, nguồn)], cách_tìm)."""
    home = fetch(normalize_start(start))
    if home["status"] == 0:
        raise RuntimeError(f"Không mở được website: {home.get('error', 'lỗi kết nối')}")
    base = home["url"]
    bp = urlparse(base)
    root = f"{bp.scheme}://{bp.netloc}"
    host = bp.netloc
    found = {}  # url -> source

    def add(u, src):
        u = clean_url(u)
        if len(found) >= max_pages or not u.startswith("http") or not same_site(u, host) or SKIP_EXT.search(urlparse(u).path):
            return
        found.setdefault(u, src)

    add(base, "home")
    progress("Đang đọc robots.txt và sitemap…", len(found))
    sitemaps = []
    rob = fetch(root + "/robots.txt", timeout=10)
    if rob["status"] == 200:
        sitemaps += re.findall(r"(?im)^\s*sitemap:\s*(\S+)", decode(rob))
    sitemaps += [root + "/sitemap.xml", root + "/sitemap_index.xml", root + "/wp-sitemap.xml"]
    seen_sm, queue = set(), list(dict.fromkeys(sitemaps))
    while queue and len(seen_sm) < 60 and len(found) < max_pages:
        sm = queue.pop(0)
        if sm in seen_sm:
            continue
        seen_sm.add(sm)
        r = fetch(sm, timeout=20)
        if r["status"] != 200:
            continue
        text = decode(r)
        if "<urlset" not in text[:3000].lower() and "<sitemapindex" not in text[:3000].lower():
            continue
        is_index, locs = _sitemap_locs(text)
        name = urlparse(sm).path.rsplit("/", 1)[-1]
        if is_index:
            queue += [l for l in locs if l not in seen_sm]
        else:
            for l in locs:
                add(l, name)
            progress(f"Đã đọc {name}", len(found))
    method = "sitemap"

    if len(found) <= 1:  # không có sitemap: bò theo liên kết
        method = "crawl"
        visited, frontier = set(), [base]
        while frontier and len(visited) < min(max_pages, 300):
            batch = [u for u in frontier[:8] if u not in visited]
            frontier = frontier[8:]
            visited.update(batch)
            with ThreadPoolExecutor(max_workers=4) as ex:
                pages = list(ex.map(lambda u: fetch(u, timeout=15), batch))
            for res in pages:
                if res["status"] != 200 or "html" not in header(res, "content-type").lower():
                    continue
                for href in re.findall(r'<a\s[^>]*href=["\']([^"\'#]+)', decode(res), re.I):
                    u = clean_url(urljoin(res["url"], unescape(href)))
                    if u.startswith("http") and same_site(u, host) and not SKIP_EXT.search(urlparse(u).path):
                        if u not in found:
                            add(u, "link")
                        if u not in visited and u not in frontier:
                            frontier.append(u)
            progress(f"Đang bò liên kết… đã mở {len(visited)} trang", len(found))
            time.sleep(0.2)

    pages = [(u, classify(u, s), s) for u, s in found.items()]
    pages.sort(key=lambda x: (x[1] != "home", x[0]))
    return base, pages, method


# ---------------------------------------------------------------- đọc HTML
class PageParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None
        self.meta = {}
        self.links_rel = []
        self.lang = None
        self.headings = []
        self.images = []
        self.anchors = []
        self.jsonld = []
        self.text = []
        self.scripts = 0
        self.styles = 0
        self.iframes = 0
        self._skip = 0
        self._cap = None  # ("title"|"h"|"ld", buf)
        self._h = None
        self._a = None
        self._in_body = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "body":
            self._in_body = True
        elif tag == "title" and self.title is None:
            self._cap = ["title", []]
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or a.get("http-equiv") or "").lower()
            if key:
                self.meta.setdefault(key, a.get("content", ""))
            if "charset" in a:
                self.meta.setdefault("charset", a["charset"])
        elif tag == "link":
            self.links_rel.append(a)
            if "stylesheet" in a.get("rel", "").lower():
                self.styles += 1
        elif tag == "script":
            if "ld+json" in a.get("type", "").lower():
                self._cap = ["ld", []]
            else:
                if a.get("src"):
                    self.scripts += 1
                self._skip += 1
        elif tag in ("style", "noscript", "svg", "template"):
            self._skip += 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._h = [int(tag[1]), []]
        elif tag == "img":
            self.images.append({"src": a.get("src") or a.get("data-src", ""), "alt": a.get("alt") if "alt" in a else None,
                                "width": a.get("width"), "height": a.get("height"), "loading": a.get("loading", "")})
            if self._a is not None and a.get("alt"):
                self._a[1].append(a["alt"])
        elif tag == "a":
            self._a = [a, []]
        elif tag == "iframe":
            self.iframes += 1

    def handle_endtag(self, tag):
        if tag == "title" and self._cap and self._cap[0] == "title":
            self.title = " ".join("".join(self._cap[1]).split())
            self._cap = None
        elif tag == "script":
            if self._cap and self._cap[0] == "ld":
                self.jsonld.append("".join(self._cap[1]))
                self._cap = None
            elif self._skip:
                self._skip -= 1
        elif tag in ("style", "noscript", "svg", "template") and self._skip:
            self._skip -= 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._h:
            self.headings.append((self._h[0], " ".join("".join(self._h[1]).split())))
            self._h = None
        elif tag == "a" and self._a is not None:
            at, txt = self._a
            self.anchors.append({"href": at.get("href", ""), "rel": at.get("rel", "").lower(),
                                 "text": " ".join(" ".join(txt).split()), "title": at.get("title", "")})
            self._a = None

    def handle_data(self, data):
        if self._cap:
            self._cap[1].append(data)
            return
        if self._skip:
            return
        if self._h:
            self._h[1].append(data)
        if self._a is not None:
            self._a[1].append(data)
        self.text.append(data)


# ---------------------------------------------------------------- audit
def _chk(group, label, status, value, fix="", weight=3):
    return {"group": group, "label": label, "status": status, "value": value, "fix": fix, "weight": weight}


def _link_status(u):
    r = fetch(u, timeout=10, method="HEAD")
    if r["status"] in (405, 403, 400, 501) or r["status"] == 0:
        r = fetch(u, timeout=12, max_bytes=2048)
    return u, r["status"], r.get("error")


def schema_types(jsonld_blocks):
    types, errors, objs = set(), 0, []
    for raw in jsonld_blocks:
        try:
            data = json.loads(raw.strip())
        except Exception:  # noqa: BLE001
            errors += 1
            continue
        stack = [data]
        while stack:
            d = stack.pop()
            if isinstance(d, list):
                stack += d
            elif isinstance(d, dict):
                objs.append(d)
                t = d.get("@type")
                for x in (t if isinstance(t, list) else [t]):
                    if isinstance(x, str):
                        types.add(x)
                stack += [v for v in d.values() if isinstance(v, (dict, list))]
    return types, errors


def detect_type(guess, types, meta):
    if types & {"Product", "IndividualProduct", "ProductGroup"} or meta.get("og:type", "").startswith("product"):
        return "product"
    if types & {"Article", "BlogPosting", "NewsArticle"} or meta.get("og:type") == "article":
        return guess if guess == "home" else "post"
    if types & {"CollectionPage", "ItemList", "OfferCatalog"} and guess == "other":
        return "category"
    return guess


def audit_page(url, page_type="other", keyword="", other_titles=(), check_links=True):
    res = fetch(url)
    checks = []
    G_TECH, G_HEAD, G_CONTENT, G_IMG, G_LINK, G_SCHEMA, G_SOCIAL = (
        "Kỹ thuật", "Tiêu đề & heading", "Nội dung & từ khóa", "Hình ảnh", "Liên kết", "Dữ liệu cấu trúc", "Chia sẻ mạng xã hội")

    if res["status"] == 0:
        raise RuntimeError(f"Không tải được trang: {res.get('error', 'lỗi kết nối')}")
    html = decode(res)
    p = PageParser()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001
        pass
    meta = p.meta
    final = res["url"]
    text = " ".join(" ".join(p.text).split())
    words = text.split()
    wc = len(words)
    types, ld_err = schema_types(p.jsonld)
    page_type = detect_type(page_type, types, meta)

    # ---- Kỹ thuật
    st = res["status"]
    checks.append(_chk(G_TECH, "Mã phản hồi HTTP", "pass" if st == 200 else "fail", str(st),
                       "Trang phải trả về 200. Lỗi 4xx/5xx khiến Google bỏ trang khỏi kết quả; kiểm tra lại đường dẫn hoặc máy chủ.", 15))
    if res["redirects"]:
        chain = " → ".join(f"{c} {u}" for c, u in res["redirects"])
        checks.append(_chk(G_TECH, "Chuyển hướng", "warn" if len(res["redirects"]) > 1 else "info", chain,
                           "Sửa liên kết nội bộ trỏ thẳng tới URL cuối cùng, tránh chuyển hướng nhiều lớp.", 3))
    checks.append(_chk(G_TECH, "HTTPS", "pass" if final.startswith("https://") else "fail",
                       "Có" if final.startswith("https://") else "Không",
                       "Cài chứng chỉ SSL và chuyển hướng 301 toàn bộ http sang https.", 8))
    robots = (meta.get("robots", "") + " " + header(res, "x-robots-tag")).lower()
    noindex = "noindex" in robots
    checks.append(_chk(G_TECH, "Cho phép Google index", "fail" if noindex else "pass",
                       robots.strip() or "Không chặn",
                       "Trang đang có noindex nên sẽ không xuất hiện trên Google. Gỡ noindex trong thẻ meta robots / plugin SEO nếu trang này cần lên top.", 15))
    canon = next((l.get("href") for l in p.links_rel if l.get("rel", "").lower() == "canonical"), None)
    if not canon:
        checks.append(_chk(G_TECH, "Thẻ canonical", "warn", "Không có",
                           f'Thêm <link rel="canonical" href="{final}"> vào <head> để tránh trùng lặp nội dung do tham số URL.', 4))
    else:
        ca = urljoin(final, canon)
        same = ca.rstrip("/") == final.rstrip("/")
        checks.append(_chk(G_TECH, "Thẻ canonical", "pass" if same else "warn", ca,
                           "" if same else "Canonical đang trỏ sang URL khác, Google sẽ coi trang kia là bản chính và có thể không index trang này. Nếu trang này cần lên top, đặt canonical trỏ về chính nó.", 6))
    checks.append(_chk(G_TECH, "Thẻ viewport (hiển thị di động)", "pass" if meta.get("viewport") else "fail",
                       meta.get("viewport") or "Không có",
                       'Thêm <meta name="viewport" content="width=device-width, initial-scale=1"> để trang hiển thị đúng trên điện thoại.', 8))
    checks.append(_chk(G_TECH, "Khai báo ngôn ngữ", "pass" if p.lang else "warn", p.lang or "Không có",
                       'Thêm lang="vi" vào thẻ <html>.', 2))
    el = res["elapsed"]
    checks.append(_chk(G_TECH, "Thời gian phản hồi máy chủ", "pass" if el < 0.8 else "warn" if el < 2 else "fail",
                       f"{el:.2f} giây",
                       "Máy chủ phản hồi chậm. Bật cache trang (page cache), dùng CDN, nâng cấp hosting hoặc tối ưu truy vấn cơ sở dữ liệu.", 5))
    kb = len(res["body"]) / 1024
    checks.append(_chk(G_TECH, "Dung lượng HTML", "pass" if kb < 200 else "warn", f"{kb:.0f} KB",
                       "HTML nặng làm chậm tải trang. Bỏ CSS/JS nhúng trực tiếp, giảm mã thừa từ page builder.", 2))
    checks.append(_chk(G_TECH, "Số file JS / CSS bên ngoài", "pass" if p.scripts + p.styles <= 25 else "warn",
                       f"{p.scripts} JS, {p.styles} CSS",
                       "Quá nhiều file làm chậm trang. Gộp/nén file, tắt plugin không dùng, trì hoãn JS không quan trọng (defer).", 2))
    path = urlparse(final).path
    url_issues = []
    if len(final) > 100:
        url_issues.append("dài hơn 100 ký tự")
    if re.search(r"[A-Z]", path):
        url_issues.append("có chữ hoa")
    if "_" in path:
        url_issues.append("dùng dấu gạch dưới")
    if "%" in path:
        url_issues.append("có ký tự mã hóa/tiếng Việt có dấu")
    if urlparse(final).query:
        url_issues.append("có tham số ?")
    checks.append(_chk(G_TECH, "Cấu trúc URL", "warn" if url_issues else "pass",
                       ", ".join(url_issues) or "Gọn, dễ đọc",
                       "URL nên ngắn, chữ thường, không dấu, nối bằng gạch ngang và chứa từ khóa chính. Nếu đổi URL, nhớ đặt chuyển hướng 301 từ URL cũ.", 3))

    # ---- Tiêu đề & heading
    title = p.title or ""
    tl = len(title)
    if not title:
        checks.append(_chk(G_HEAD, "Thẻ title", "fail", "Không có", "Thêm thẻ <title> mô tả đúng nội dung trang, 50–60 ký tự, chứa từ khóa chính.", 12))
    else:
        checks.append(_chk(G_HEAD, "Độ dài title", "pass" if 30 <= tl <= 60 else "warn", f"{tl} ký tự: {title}",
                           "Title nên dài 50–60 ký tự: đủ ý, không bị Google cắt. Đưa từ khóa chính lên đầu." if tl > 60 else
                           "Title quá ngắn, bỏ phí chỗ hiển thị. Viết 50–60 ký tự gồm từ khóa chính + lợi ích/thương hiệu.", 6))
        if title in other_titles:
            checks.append(_chk(G_HEAD, "Title trùng trang khác", "fail", title,
                               "Mỗi trang cần một title riêng. Trùng title khiến Google khó chọn trang nào để xếp hạng.", 8))
    md = meta.get("description", "").strip()
    if not md:
        checks.append(_chk(G_HEAD, "Meta description", "fail", "Không có",
                           "Viết meta description 120–160 ký tự: tóm tắt trang, chứa từ khóa, có lời kêu gọi (ví dụ: Xem giá, Gọi ngay).", 7))
    else:
        checks.append(_chk(G_HEAD, "Độ dài meta description", "pass" if 110 <= len(md) <= 160 else "warn",
                           f"{len(md)} ký tự: {md}",
                           "Meta description nên dài 120–160 ký tự để hiển thị trọn trên Google và tăng tỉ lệ nhấp.", 4))
    h1s = [t for lv, t in p.headings if lv == 1]
    if not h1s:
        checks.append(_chk(G_HEAD, "Thẻ H1", "fail", "Không có",
                           "Mỗi trang cần đúng 1 thẻ H1 nêu chủ đề chính, chứa từ khóa chính. Thường là tên sản phẩm/tiêu đề bài viết.", 10))
    elif len(h1s) > 1:
        checks.append(_chk(G_HEAD, "Thẻ H1", "warn", f"{len(h1s)} thẻ H1: " + " | ".join(h1s[:4]),
                           "Chỉ giữ 1 H1. Các H1 còn lại (thường do logo, tiêu đề widget) đổi thành H2 hoặc thẻ div.", 5))
    else:
        checks.append(_chk(G_HEAD, "Thẻ H1", "pass" if h1s[0] else "fail", h1s[0] or "H1 rỗng",
                           "H1 đang rỗng; điền nội dung chính của trang.", 10))
    skips, prev = [], 0
    for lv, t in p.headings:
        if prev and lv > prev + 1:
            skips.append(f"H{prev}→H{lv}")
        prev = lv
    empty_h = sum(1 for _, t in p.headings if not t)
    h2c = sum(1 for lv, _ in p.headings if lv == 2)
    hs = "warn" if skips or empty_h or (page_type == "post" and h2c < 2) else "pass"
    hv = f"{len(p.headings)} heading, {h2c} H2" + (f"; nhảy cấp: {', '.join(skips[:5])}" if skips else "") + (f"; {empty_h} heading rỗng" if empty_h else "")
    checks.append(_chk(G_HEAD, "Cấu trúc heading", hs, hv,
                       "Heading cần theo thứ tự H1 → H2 → H3, không nhảy cấp, không để rỗng. Bài viết nên chia ý bằng nhiều H2.", 3))

    # ---- Nội dung & từ khóa
    need = {"post": 800, "product": 300, "category": 200, "home": 300}.get(page_type, 250)
    checks.append(_chk(G_CONTENT, "Độ dài nội dung", "pass" if wc >= need else "warn" if wc >= need / 2 else "fail",
                       f"{wc:,} tiếng (gợi ý ≥ {need:,} cho {TYPE_VI[page_type].lower()})".replace(",", "."),
                       f"Nội dung mỏng khó cạnh tranh. Bổ sung thông tin hữu ích: thông số, ưu nhược điểm, hướng dẫn, câu hỏi thường gặp… để đạt khoảng {need:,} tiếng.".replace(",", "."), 6))
    kw = " ".join(keyword.lower().split())
    if kw:
        low = text.lower()
        n = low.count(kw)
        density = n * len(kw.split()) / max(wc, 1) * 100
        checks.append(_chk(G_CONTENT, "Từ khóa trong title", "pass" if kw in title.lower() else "fail", "Có" if kw in title.lower() else "Không",
                           f'Đưa "{kw}" vào title, càng gần đầu càng tốt.', 8))
        h1t = " ".join(h1s).lower()
        checks.append(_chk(G_CONTENT, "Từ khóa trong H1", "pass" if kw in h1t else "fail", "Có" if kw in h1t else "Không",
                           f'Viết lại H1 có chứa "{kw}".', 6))
        checks.append(_chk(G_CONTENT, "Từ khóa trong meta description", "pass" if kw in md.lower() else "warn",
                           "Có" if kw in md.lower() else "Không", f'Thêm "{kw}" vào meta description (Google bôi đậm từ khóa khi hiển thị).', 3))
        first = " ".join(words[:120]).lower()
        checks.append(_chk(G_CONTENT, "Từ khóa trong đoạn mở đầu", "pass" if kw in first else "warn",
                           "Có" if kw in first else "Không", f'Nhắc "{kw}" trong khoảng 100 chữ đầu nội dung.', 3))
        sk = slugify(kw)
        checks.append(_chk(G_CONTENT, "Từ khóa trong URL", "pass" if sk and sk in path.lower() else "warn",
                           path, f'URL nên chứa "{sk}". Chỉ đổi URL với trang mới hoặc trang chưa có thứ hạng; nhớ đặt 301.', 3))
        h2t = " ".join(t for lv, t in p.headings if lv in (2, 3)).lower()
        checks.append(_chk(G_CONTENT, "Từ khóa trong H2/H3", "pass" if kw in h2t else "warn", "Có" if kw in h2t else "Không",
                           f'Dùng "{kw}" hoặc biến thể của nó trong ít nhất một H2.', 2))
        checks.append(_chk(G_CONTENT, "Mật độ từ khóa", "pass" if 0.5 <= density <= 2.5 else "warn",
                           f"{n} lần, {density:.2f}%",
                           "Nên ở khoảng 0,5–2,5%. Quá thấp: nhắc thêm tự nhiên trong bài. Quá cao: thay bằng từ đồng nghĩa để tránh nhồi nhét.", 3))
    else:
        checks.append(_chk(G_CONTENT, "Từ khóa chính", "info", "Chưa nhập",
                           "Nhập từ khóa chính của trang rồi audit lại để kiểm tra title, H1, URL, mật độ từ khóa.", 0))

    # ---- Hình ảnh
    imgs = [i for i in p.images if i["src"] and not i["src"].startswith("data:")]
    no_alt = [i for i in imgs if i["alt"] is None or not i["alt"].strip()]
    checks.append(_chk(G_IMG, "Ảnh thiếu alt", "pass" if not no_alt else "warn" if len(no_alt) <= 3 else "fail",
                       f"{len(no_alt)}/{len(imgs)} ảnh" + (": " + ", ".join(urlparse(i["src"]).path.rsplit("/", 1)[-1] for i in no_alt[:5]) if no_alt else ""),
                       "Thêm thuộc tính alt mô tả nội dung ảnh (có từ khóa khi phù hợp). Giúp Google hiểu ảnh và lên Google Hình ảnh.", 5))
    no_dim = [i for i in imgs if not (i["width"] and i["height"])]
    if imgs:
        checks.append(_chk(G_IMG, "Ảnh thiếu kích thước", "pass" if len(no_dim) <= len(imgs) * 0.3 else "warn",
                           f"{len(no_dim)}/{len(imgs)} ảnh",
                           "Khai báo width và height cho ảnh để trang không bị xô lệch khi tải (điểm CLS).", 2))
        modern = sum(1 for i in imgs if re.search(r"\.(webp|avif)(\?|$)", i["src"], re.I))
        checks.append(_chk(G_IMG, "Định dạng ảnh hiện đại", "pass" if modern >= len(imgs) * 0.5 else "warn",
                           f"{modern}/{len(imgs)} ảnh WebP/AVIF",
                           "Chuyển ảnh JPG/PNG sang WebP để nhẹ hơn 25–35%. WordPress có thể dùng plugin chuyển đổi tự động.", 2))
        lazy = sum(1 for i in imgs[2:] if i["loading"].lower() == "lazy")
        if len(imgs) > 4:
            checks.append(_chk(G_IMG, "Tải ảnh chậm (lazy load)", "pass" if lazy >= (len(imgs) - 2) * 0.5 else "warn",
                               f"{lazy}/{len(imgs) - 2} ảnh phía dưới",
                               'Thêm loading="lazy" cho ảnh nằm dưới màn hình đầu tiên để trang tải nhanh hơn.', 2))

    # ---- Liên kết
    host = urlparse(final).netloc
    internal, external, empty_anchor, nofollow_int = [], [], 0, 0
    for a in p.anchors:
        h = a["href"].strip()
        if not h or h.startswith(("#", "javascript:", "mailto:", "tel:", "zalo:")):
            continue
        u = clean_url(urljoin(final, h))
        if not u.startswith("http"):
            continue
        if same_site(u, host):
            internal.append(u)
            if "nofollow" in a["rel"]:
                nofollow_int += 1
        else:
            external.append(u)
        if not a["text"] and not a["title"]:
            empty_anchor += 1
    ui = sorted(set(internal))
    checks.append(_chk(G_LINK, "Liên kết nội bộ", "pass" if len(ui) >= 5 else "warn", f"{len(ui)} đường dẫn khác nhau",
                       "Thêm liên kết từ nội dung tới các trang liên quan (sản phẩm, bài viết cùng chủ đề) để dẫn Google và người đọc.", 4))
    checks.append(_chk(G_LINK, "Liên kết ra ngoài", "info", f"{len(set(external))} đường dẫn", "", 0))
    if empty_anchor:
        checks.append(_chk(G_LINK, "Liên kết không có chữ", "warn", f"{empty_anchor} liên kết",
                           "Liên kết (thường là icon, ảnh) cần chữ hiển thị, alt của ảnh, hoặc thuộc tính title/aria-label để Google hiểu trang đích.", 2))
    if nofollow_int:
        checks.append(_chk(G_LINK, "Liên kết nội bộ nofollow", "warn", f"{nofollow_int} liên kết",
                           "Không nên đặt nofollow cho liên kết trong cùng website; nó chặn dòng sức mạnh SEO giữa các trang.", 2))
    broken = []
    if check_links:
        targets = (ui + sorted(set(external)))[:40]
        with ThreadPoolExecutor(max_workers=8) as ex:
            for u, s, err in ex.map(_link_status, targets):
                if s == 404 or s == 410 or (s >= 500) or (s == 0 and same_site(u, host)):
                    broken.append({"url": u, "status": s or (err or "lỗi kết nối")})
        checks.append(_chk(G_LINK, "Liên kết hỏng", "pass" if not broken else "fail",
                           f"{len(broken)} hỏng / đã kiểm {len(targets)}" + ("".join(f"\n{b['status']} {b['url']}" for b in broken[:10])),
                           "Sửa hoặc gỡ các liên kết hỏng. Nếu trang đích đã đổi địa chỉ, đặt chuyển hướng 301 sang trang mới.", 6))

    # ---- Dữ liệu cấu trúc
    if ld_err:
        checks.append(_chk(G_SCHEMA, "Schema lỗi cú pháp", "fail", f"{ld_err} khối JSON-LD không đọc được",
                           "Kiểm tra lại JSON-LD bằng công cụ Rich Results Test của Google; thường do thiếu dấu phẩy/ngoặc.", 5))
    expected = {"home": ["Organization", "WebSite"], "product": ["Product", "BreadcrumbList"],
                "post": ["Article", "BreadcrumbList"], "category": ["BreadcrumbList"], "other": ["BreadcrumbList"]}[page_type]
    alias = {"Article": {"Article", "BlogPosting", "NewsArticle"},
             "Organization": {"Organization", "LocalBusiness", "Store", "Corporation", "OnlineStore"}}
    missing = [e for e in expected if not (alias.get(e, {e}) & types)]
    checks.append(_chk(G_SCHEMA, "Schema phù hợp loại trang", "pass" if not missing else "warn",
                       ("Đang có: " + ", ".join(sorted(types)) if types else "Chưa có schema") + (f". Thiếu: {', '.join(missing)}" if missing else ""),
                       "Dán đoạn Schema mẫu bên dưới vào trang (trong <head> hoặc qua plugin SEO) để Google hiển thị kết quả nổi bật (giá, sao đánh giá, đường dẫn…).", 5))
    if "Product" in types:
        prod = re.search(r'"offers"', " ".join(p.jsonld))
        checks.append(_chk(G_SCHEMA, "Schema Product có giá (offers)", "pass" if prod else "warn", "Có" if prod else "Thiếu offers",
                           "Bổ sung offers (price, priceCurrency, availability) để Google hiện giá trên kết quả tìm kiếm.", 3))

    # ---- Mạng xã hội
    og_miss = [k for k in ("og:title", "og:description", "og:image") if not meta.get(k)]
    checks.append(_chk(G_SOCIAL, "Thẻ Open Graph (Facebook, Zalo)", "pass" if not og_miss else "warn",
                       "Đủ" if not og_miss else "Thiếu " + ", ".join(og_miss),
                       "Thêm og:title, og:description, og:image để link chia sẻ lên Facebook/Zalo hiện đúng ảnh và tiêu đề.", 2))

    # ---- điểm
    score = 100
    for c in checks:
        if c["status"] == "fail":
            score -= c["weight"]
        elif c["status"] == "warn":
            score -= c["weight"] / 2
    score = max(0, round(score))

    extract = {"title": title, "meta_description": md, "h1": h1s,
               "headings": [f"H{lv}: {t}" for lv, t in p.headings[:50]], "text": text[:7000],
               "og_image": meta.get("og:image", ""), "first_image": imgs[0]["src"] if imgs else "",
               "published": meta.get("article:published_time", ""), "modified": meta.get("article:modified_time", ""),
               "site_name": meta.get("og:site_name", ""), "word_count": wc}
    return {
        "url": url, "final_url": final, "page_type": page_type, "keyword": kw, "score": score,
        "checks": checks, "schema": build_schema(final, page_type, extract), "extract": extract,
        "counts": {s: sum(1 for c in checks if c["status"] == s) for s in ("fail", "warn", "pass")},
        "audited_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


# ---------------------------------------------------------------- schema mẫu
def _crumb_name(seg):
    seg = re.sub(r"\.(html?|aspx|php)$", "", seg)
    return seg.replace("-", " ").replace("_", " ").strip().capitalize()


def build_schema(url, page_type, ex):
    p = urlparse(url)
    root = f"{p.scheme}://{p.netloc}/"
    site = ex.get("site_name") or bare_host(p.netloc)
    name = (ex.get("h1") or [ex.get("title") or ""])[0] or ex.get("title", "")
    image = urljoin(url, ex.get("og_image") or ex.get("first_image") or "") if (ex.get("og_image") or ex.get("first_image")) else ""
    graph = []
    if page_type == "home":
        graph.append({"@type": "Organization", "@id": root + "#organization", "name": site, "url": root,
                      "logo": "LINK_LOGO", "image": image or "LINK_ẢNH", "telephone": "SỐ_ĐIỆN_THOẠI",
                      "address": {"@type": "PostalAddress", "streetAddress": "ĐỊA_CHỈ", "addressLocality": "TỈNH/THÀNH", "addressCountry": "VN"},
                      "sameAs": ["LINK_FANPAGE_FACEBOOK", "LINK_ZALO_OA"]})
        graph.append({"@type": "WebSite", "@id": root + "#website", "url": root, "name": site, "inLanguage": "vi-VN",
                      "publisher": {"@id": root + "#organization"}})
    else:
        segs = [s for s in p.path.split("/") if s]
        items = [{"@type": "ListItem", "position": 1, "name": "Trang chủ", "item": root}]
        acc = root
        for i, s in enumerate(segs):
            acc = acc + s + ("/" if i < len(segs) - 1 else "")
            last = i == len(segs) - 1
            items.append({"@type": "ListItem", "position": i + 2, "name": name if last and name else _crumb_name(s), "item": url if last else acc})
        graph.append({"@type": "BreadcrumbList", "itemListElement": items})
        if page_type == "product":
            graph.append({"@type": "Product", "name": name, "description": ex.get("meta_description", ""),
                          "image": image or "LINK_ẢNH_SẢN_PHẨM", "brand": {"@type": "Brand", "name": "THƯƠNG_HIỆU"},
                          "sku": "MÃ_SẢN_PHẨM",
                          "offers": {"@type": "Offer", "url": url, "priceCurrency": "VND", "price": "GIÁ_BÁN",
                                     "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition"}})
        elif page_type == "post":
            graph.append({"@type": "BlogPosting", "headline": name[:110], "description": ex.get("meta_description", ""),
                          "image": image or "LINK_ẢNH_ĐẠI_DIỆN", "mainEntityOfPage": url,
                          "datePublished": ex.get("published") or "YYYY-MM-DD", "dateModified": ex.get("modified") or ex.get("published") or "YYYY-MM-DD",
                          "author": {"@type": "Person", "name": "TÊN_TÁC_GIẢ"},
                          "publisher": {"@type": "Organization", "name": site, "logo": {"@type": "ImageObject", "url": "LINK_LOGO"}}})
        elif page_type == "category":
            graph.append({"@type": "CollectionPage", "name": name, "url": url, "description": ex.get("meta_description", "")})
        else:
            graph.append({"@type": "WebPage", "name": name, "url": url, "description": ex.get("meta_description", "")})
    data = {"@context": "https://schema.org", "@graph": graph}
    return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + "\n</script>"


# ---------------------------------------------------------------- AI (Claude)
def ai_suggest(cfg, report):
    key = cfg.get("anthropic_api_key", "").strip()
    if not key:
        raise RuntimeError("Chưa có khóa Claude API trong config.json (anthropic_api_key).")
    ex = report["extract"]
    issues = "\n".join(f"- [{c['status']}] {c['label']}: {c['value'][:160]}" for c in report["checks"] if c["status"] in ("fail", "warn"))
    prompt = f"""Bạn là chuyên gia SEO tiếng Việt. Hãy tối ưu on-page cho trang sau.

URL: {report['final_url']}
Loại trang: {TYPE_VI.get(report['page_type'], report['page_type'])}
Từ khóa chính: {report['keyword'] or '(chưa có, hãy tự xác định từ khóa chính phù hợp nhất từ nội dung)'}
Title hiện tại: {ex['title']}
Meta description hiện tại: {ex['meta_description']}
Dàn heading hiện tại:
{chr(10).join(ex['headings'][:40])}

Các lỗi đã phát hiện:
{issues or '- Không có'}

Nội dung trang (rút gọn):
\"\"\"{ex['text'][:6000]}\"\"\"

Chỉ trả về một đối tượng JSON hợp lệ, không giải thích thêm, theo đúng cấu trúc:
{{
  "main_keyword": "từ khóa chính nên nhắm",
  "secondary_keywords": ["5-8 từ khóa phụ/biến thể nên dùng trong bài"],
  "titles": ["3 phương án title 50-60 ký tự, từ khóa chính ở đầu"],
  "meta_descriptions": ["2 phương án 120-160 ký tự, có lời kêu gọi hành động"],
  "h1": "H1 đề xuất",
  "outline": ["dàn ý H2/H3 đề xuất cho trang, dạng 'H2: ...' hoặc 'H3: ...'"],
  "content_gaps": ["những thông tin người tìm kiếm cần mà trang còn thiếu"],
  "faq": [{{"q": "câu hỏi", "a": "trả lời ngắn 1-2 câu"}}],
  "priority_fixes": ["3-6 việc nên làm trước, sắp theo mức ảnh hưởng"]
}}
Chỉ dựa vào nội dung trang; không bịa giá, thông số hay thông tin liên hệ."""
    body = {"model": cfg.get("anthropic_model") or "claude-sonnet-5-5", "max_tokens": 4000,
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode("utf-8"),
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            msg = ""
        if e.code == 401:
            raise RuntimeError("Khóa Claude API không đúng. Kiểm tra anthropic_api_key trong config.json.")
        raise RuntimeError(f"Claude API lỗi {e.code}: {msg}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Không kết nối được Claude API: {e.reason}")
    txt = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        raise RuntimeError("AI trả về nội dung không đúng định dạng, hãy thử lại.")
    out = json.loads(m.group(0))
    # Schema có FAQ từ AI
    if out.get("faq"):
        faq = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in out["faq"] if f.get("q")]}
        out["faq_schema"] = '<script type="application/ld+json">\n' + json.dumps(faq, ensure_ascii=False, indent=2) + "\n</script>"
    out["usage"] = data.get("usage", {})
    costs.record_claude("audit_ai", out["usage"])
    return out
