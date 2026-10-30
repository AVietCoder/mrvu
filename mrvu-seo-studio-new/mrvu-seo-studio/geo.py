"""
Tối ưu AI Overview (GEO): lấy AI Overview thật của Google qua DataForSEO, so sánh với trang của bạn
và các trang đang được trích dẫn, rồi dùng Claude đề xuất cách sửa kèm đoạn nội dung viết sẵn.
"""
import json
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlparse

import audit

db = LOCK = load_config = dfs_post = claude = None
JOBS = {}

QUESTION_WORDS = re.compile(r"\?|\b(là gì|như thế nào|thế nào|có nên|có tốt|có tốn|bao nhiêu|tại sao|vì sao|cách|khi nào|ở đâu|loại nào|nên mua|so sánh|có phải|bao lâu|ra sao)\b", re.I)


def setup(db_func, lock, load_cfg, dfs_post_func, claude_func):
    global db, LOCK, load_config, dfs_post, claude
    db, LOCK, load_config, dfs_post, claude = db_func, lock, load_cfg, dfs_post_func, claude_func
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS geo_checks(
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, url TEXT, keyword TEXT, location TEXT,
            score INTEGER, has_aio INTEGER, cited INTEGER, report_json TEXT)""")


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def host(u):
    return audit.bare_host(urlparse(u if "://" in u else "https://" + u).netloc)


def same_site(u, target):
    h, t = host(u), host(target)
    return bool(h) and (h == t or h.endswith("." + t))


# ---------------------------------------------------------------- 1. SERP + AI Overview
def _walk(obj, fn):
    if isinstance(obj, dict):
        fn(obj)
        for v in obj.values():
            _walk(v, fn)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, fn)


def fetch_serp(cfg, keyword, loc, lang, paa_depth=1, limit=8):
    task, cost = dfs_post(cfg, "/v3/serp/google/organic/live/advanced", [{
        "keyword": keyword, "location_code": int(loc), "language_code": lang, "device": "desktop",
        "depth": 10, "load_async_ai_overview": True, "people_also_ask_click_depth": int(paa_depth)}], timeout=150)
    res = (task.get("result") or [{}])[0] or {}
    items = res.get("items") or []
    aio_item = next((i for i in items if i.get("type") == "ai_overview"), None)

    aio = None
    if aio_item:
        refs, seen = [], set()

        def grab(d, loose=False):
            is_ref = d.get("type") == "ai_overview_reference" or (loose and d.get("url") and d.get("domain") and "source" in d)
            u = d.get("url")
            if is_ref and u and u not in seen:
                seen.add(u)
                refs.append({"url": u, "domain": d.get("domain") or host(u), "title": d.get("title") or "",
                             "source": d.get("source") or "", "text": (d.get("text") or "")[:600]})
        for r in aio_item.get("references") or []:
            if isinstance(r, dict):
                grab(r, loose=True)
        _walk(aio_item.get("items") or [], grab)
        md = aio_item.get("markdown") or ""
        if not md:
            parts = []
            for el in aio_item.get("items") or []:
                parts.append(el.get("markdown") or el.get("text") or "")
            md = "\n\n".join(p for p in parts if p)
        aio = {"markdown": md.strip(), "references": refs[:20], "async": aio_item.get("asynchronous_ai_overview")}

    organic = [{"pos": i.get("rank_group"), "url": i.get("url"), "domain": i.get("domain"), "title": i.get("title"),
                "description": i.get("description") or ""} for i in items if i.get("type") == "organic"][:10]
    paa = []
    for i in items:
        if i.get("type") == "people_also_ask":
            for el in i.get("items") or []:
                if el.get("title"):
                    paa.append(el["title"])
    related = []
    for i in items:
        if i.get("type") == "related_searches":
            for el in i.get("items") or []:
                related.append(el if isinstance(el, str) else (el.get("title") or el.get("query") or ""))
    return {"aio": aio, "organic": organic, "paa": list(dict.fromkeys(paa))[:limit],
            "related": [r for r in dict.fromkeys(related) if r][:limit], "item_types": res.get("item_types") or [],
            "cost": cost}


# ---------------------------------------------------------------- 2. Đọc trang
def read_page(url, limit=9000, res=None):
    res = res or audit.fetch(url, timeout=25)
    if res["status"] != 200:
        return {"url": url, "error": f"HTTP {res['status'] or res.get('error', 'lỗi kết nối')}"}
    html = audit.decode(res)
    p = audit.PageParser()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001
        pass
    text = " ".join(" ".join(p.text).split())
    types, _ = audit.schema_types(p.jsonld)
    h1 = [t for lv, t in p.headings if lv == 1]
    # đoạn đầu tiên sau H1: lấy phần text ngay sau tiêu đề H1 trong text đã gộp
    first = text
    if h1 and h1[0] and h1[0] in text:
        first = text.split(h1[0], 1)[1]
    first_words = first.split()[:80]
    return {
        "url": res["url"], "title": p.title or "", "meta_description": p.meta.get("description", ""),
        "h1": h1, "headings": [(lv, t) for lv, t in p.headings if t][:60], "text": text[:limit], "word_count": len(text.split()),
        "first_words": " ".join(first_words), "schema": sorted(types),
        "lists": len(re.findall(r"<(ul|ol)\b", html, re.I)), "tables": len(re.findall(r"<table\b", html, re.I)),
        "author": p.meta.get("author") or ("author" in " ".join(p.jsonld).lower() and "Có trong schema") or "",
        "published": p.meta.get("article:published_time", ""), "modified": p.meta.get("article:modified_time", ""),
        "noindex": "noindex" in (p.meta.get("robots", "") + audit.header(res, "x-robots-tag")).lower(),
        "nosnippet": "nosnippet" in p.meta.get("robots", "").lower() or "max-snippet:0" in p.meta.get("robots", "").lower(),
    }


# ---------------------------------------------------------------- 3. Kiểm tra cấu trúc (không cần AI)
def structure_checks(page, keyword):
    C = []

    def add(label, status, value, fix, w):
        C.append({"label": label, "status": status, "value": value, "fix": fix, "weight": w})

    if page.get("noindex") or page.get("nosnippet"):
        add("Cho phép Google dùng nội dung", "fail", "Trang có noindex/nosnippet",
            "Google không thể trích dẫn trang đang chặn index hoặc chặn đoạn trích. Gỡ noindex, nosnippet, max-snippet:0 trong thẻ meta robots.", 30)
    kw = keyword.lower()
    fw = " ".join(page["first_words"].lower().split()[:60])
    toks = [w for w in kw.split() if len(w) > 1]
    hit = sum(1 for w in toks if w in fw.split()) / max(1, len(toks))
    direct = kw in fw or hit >= 0.7
    add("Trả lời ngay đầu bài", "pass" if direct and len(page["first_words"].split()) >= 30 else "warn",
        (page["first_words"][:220] + "…") if page["first_words"] else "Không đọc được đoạn mở đầu",
        "Ngay dưới H1, viết 1 đoạn 40–60 chữ trả lời thẳng câu hỏi của từ khóa (định nghĩa, con số, kết luận). AI Overview thường lấy đúng kiểu đoạn này.", 15)
    qh = [t for lv, t in page["headings"] if lv in (2, 3) and QUESTION_WORDS.search(t)]
    add("Heading dạng câu hỏi", "pass" if len(qh) >= 2 else "warn", f"{len(qh)} heading: " + " | ".join(qh[:4]) if qh else "Không có",
        "Đặt H2/H3 theo đúng câu người dùng hỏi (ví dụ: “Quạt trần có tốn điện không?”, “Nên chọn sải cánh bao nhiêu?”), mỗi heading trả lời ngắn gọn ngay câu đầu.", 10)
    add("Danh sách / bảng", "pass" if page["lists"] + page["tables"] >= 2 else "warn",
        f"{page['lists']} danh sách, {page['tables']} bảng",
        "Trình bày các bước, tiêu chí, so sánh bằng danh sách gạch đầu dòng hoặc bảng. AI Overview hay trích nguyên dạng danh sách/bảng.", 8)
    faq = "FAQPage" in page["schema"]
    add("Schema hỗ trợ", "pass" if faq or ({"Article", "BlogPosting", "NewsArticle", "HowTo", "Product"} & set(page["schema"])) else "warn",
        ", ".join(page["schema"]) or "Chưa có",
        "Thêm schema Article/BlogPosting (có tác giả, ngày cập nhật) và FAQPage cho mục câu hỏi thường gặp để Google hiểu rõ nội dung.", 7)
    trust = bool(page["author"]) + bool(page["modified"] or page["published"])
    add("Tín hiệu tin cậy (tác giả, ngày cập nhật)", "pass" if trust == 2 else "warn",
        f"Tác giả: {page['author'] or 'không thấy'} · Ngày: {(page['modified'] or page['published'] or 'không thấy')[:10]}",
        "Ghi rõ tác giả có chuyên môn (kèm giới thiệu ngắn) và ngày cập nhật gần nhất. Google ưu tiên nguồn thể hiện kinh nghiệm, chuyên môn, độ tin cậy (E-E-A-T).", 8)
    wc = page["word_count"]
    add("Độ sâu nội dung", "pass" if wc >= 700 else "warn" if wc >= 300 else "fail", f"{wc:,} chữ".replace(",", "."),
        "Bổ sung nội dung trả lời đủ các ý con của chủ đề (xem bảng độ phủ). Trang quá mỏng hiếm khi được AI Overview chọn.", 7)
    return C


# ---------------------------------------------------------------- 4. Claude phân tích
def ai_analyze(cfg, keyword, page, serp, competitors, checks):
    aio = serp["aio"]
    comp_txt = "\n\n".join(
        f"[Nguồn {i + 1}] {c['url']}\nĐoạn Google trích: {c.get('cited_text', '')[:500]}\nNội dung trang (rút gọn): {c.get('text', '')[:2500]}"
        for i, c in enumerate(competitors) if not c.get("error"))
    issues = "\n".join(f"- {c['label']}: {c['status']} ({c['value'][:120]})" for c in checks)
    heads = "\n".join(f"H{lv}: {t}" for lv, t in page["headings"][:40])
    prompt = f"""Bạn là chuyên gia GEO (tối ưu để được Google AI Overview trích dẫn) cho website tiếng Việt.

Từ khóa: "{keyword}"
Trang cần tối ưu: {page['url']}
Trang này {"ĐANG được AI Overview trích dẫn" if serp.get("cited") else "CHƯA được AI Overview trích dẫn"}.

=== AI OVERVIEW HIỆN TẠI CỦA GOOGLE ===
{(aio or {}).get('markdown', '')[:5000]}

=== CÁC NGUỒN ĐANG ĐƯỢC TRÍCH DẪN ===
{comp_txt or '(không đọc được)'}

=== CÂU HỎI LIÊN QUAN (People also ask) ===
{chr(10).join(serp.get('paa') or []) or '(không có)'}

=== TRANG CỦA BẠN ===
Title: {page['title']}
Meta description: {page['meta_description']}
Heading:
{heads}
Nội dung (rút gọn):
\"\"\"{page['text'][:7000]}\"\"\"

=== KIỂM TRA CẤU TRÚC TỰ ĐỘNG ===
{issues}

Nhiệm vụ: so sánh trang của bạn với AI Overview và các nguồn được trích, chỉ ra vì sao trang chưa/được chọn, và đưa đoạn nội dung viết sẵn để chèn.
Chỉ dựa vào thông tin ở trên; không bịa số liệu, giá, thông số. Nếu cần con số mà trang chưa có, ghi rõ [CẦN ĐIỀN: ...].
Chỉ trả về JSON hợp lệ:
{{
  "summary": "2-3 câu nhận định tổng quan",
  "coverage_score": 0-100,
  "aio_points": [{{"point": "một ý AI Overview đang nêu", "covered": "yes|partial|no", "note": "trang bạn nói ở đâu / thiếu gì"}}],
  "why_sources_win": ["lý do cụ thể các nguồn kia được chọn"],
  "answer_box": "đoạn 40-60 chữ trả lời thẳng câu hỏi, đặt ngay dưới H1",
  "fixes": [{{"priority": 1, "action": "việc cần làm", "why": "vì sao", "placement": "chèn ở đâu", "snippet": "nội dung viết sẵn (văn bản hoặc HTML đơn giản), có thể rỗng"}}],
  "faq": [{{"q": "câu hỏi", "a": "trả lời 1-3 câu"}}],
  "missing_entities": ["khái niệm, thông số, thương hiệu mà AI Overview/nguồn nhắc nhưng trang bạn chưa có"],
  "better_title": "đề xuất title mới nếu cần, hoặc rỗng"
}}
fixes: 4-8 việc, sắp theo mức ảnh hưởng. faq: 3-5 câu, ưu tiên câu trong People also ask."""
    txt, usage, _ = claude(cfg, prompt, 6000, tag="geo")
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        raise RuntimeError("AI trả về nội dung không đúng định dạng, hãy thử lại.")
    out = json.loads(m.group(0))
    out["usage"] = usage
    return out


def faq_schema(faq):
    data = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq if f.get("q")]}
    return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + "\n</script>"


# ---------------------------------------------------------------- 5. Quy trình
def analyze(url, keyword, loc, lang, progress=lambda m: None):
    cfg = load_config()
    if not (cfg.get("login") and cfg.get("password")):
        raise RuntimeError("Cần tài khoản DataForSEO trong config.json để lấy AI Overview thật của Google.")
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    progress("Đang lấy kết quả Google và AI Overview…")
    serp = fetch_serp(cfg, keyword, loc, lang)
    aio = serp["aio"]
    serp["cited"] = bool(aio and any(same_site(r["url"], url) for r in aio["references"]))
    serp["cited_exact"] = bool(aio and any(r["url"].rstrip("/") == url.rstrip("/") for r in aio["references"]))
    my_org = next((o for o in serp["organic"] if same_site(o["url"] or "", url)), None)
    progress("Đang đọc trang của bạn…")
    page = read_page(url)
    if page.get("error"):
        raise RuntimeError(f"Không đọc được trang {url}: {page['error']}")
    checks = structure_checks(page, keyword)

    competitors = []
    if aio:
        progress("Đang đọc các trang được AI Overview trích dẫn…")
        others = [r for r in aio["references"] if not same_site(r["url"], url)][:4]
        with ThreadPoolExecutor(max_workers=4) as ex:
            pages = list(ex.map(lambda r: read_page(r["url"], 4000), others))
        for r, p in zip(others, pages):
            p["cited_text"] = r.get("text", "")
            p["domain"] = r["domain"]
            competitors.append(p)

    ai, ai_error = None, None
    if aio and cfg.get("anthropic_api_key"):
        progress("AI đang so sánh và viết đề xuất sửa…")
        try:
            ai = ai_analyze(cfg, keyword, page, serp, competitors, checks)
            if ai.get("faq"):
                ai["faq_schema"] = faq_schema(ai["faq"])
        except Exception as e:  # noqa: BLE001
            ai_error = str(e)
    elif aio:
        ai_error = "Chưa có khóa Claude API nên chưa có phần phân tích độ phủ và đoạn viết sẵn. Nhập khóa ở tab Autopost → Cài đặt."

    # Điểm GEO /100
    struct_max = sum(c["weight"] for c in checks if c["weight"] < 30)
    struct_got = sum(c["weight"] * (1 if c["status"] == "pass" else 0.5 if c["status"] == "warn" else 0) for c in checks if c["weight"] < 30)
    struct_pct = struct_got / struct_max if struct_max else 0
    blocked = any(c["weight"] >= 30 for c in checks)
    score = None
    if aio:
        cite_pts = 30 if serp["cited"] else (12 if my_org and my_org["pos"] <= 5 else 6 if my_org else 0)
        cov = (ai or {}).get("coverage_score")
        if cov is not None:
            score = round(cite_pts + 40 * min(100, max(0, float(cov))) / 100 + 30 * struct_pct)
        else:
            score = round((cite_pts + 30 * struct_pct) / 60 * 100)
        if blocked:
            score = min(score, 10)

    report = {
        "url": page["url"], "keyword": keyword, "location": str(loc), "created_at": now(),
        "has_aio": bool(aio), "cited": serp["cited"], "cited_exact": serp["cited_exact"],
        "organic_position": my_org["pos"] if my_org else None, "score": score, "structure_score": round(struct_pct * 100),
        "aio": aio, "organic": serp["organic"], "paa": serp["paa"], "related": serp["related"],
        "checks": checks, "ai": ai, "ai_error": ai_error,
        "competitors": [{"url": c.get("url"), "domain": c.get("domain"), "word_count": c.get("word_count"),
                         "schema": c.get("schema"), "lists": c.get("lists"), "tables": c.get("tables"),
                         "error": c.get("error")} for c in competitors],
        "page": {k: page[k] for k in ("title", "meta_description", "word_count", "schema", "lists", "tables")},
        "cost": serp["cost"],
    }
    with LOCK, db() as conn:
        cur = conn.execute("INSERT INTO geo_checks(created_at, url, keyword, location, score, has_aio, cited, report_json) VALUES (?,?,?,?,?,?,?,?)",
                           (report["created_at"], report["url"], keyword, str(loc), score, int(bool(aio)), int(serp["cited"]),
                            json.dumps(report, ensure_ascii=False)))
        report["id"] = cur.lastrowid
    return report["id"]


def start(url, keyword, loc, lang):
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {"status": "running", "message": "Đang bắt đầu…"}

    def run():
        try:
            rid = analyze(url, keyword, loc, lang, lambda m: JOBS[jid].update(message=m))
            JOBS[jid].update(status="done", message="Xong", result=rid)
        except Exception as e:  # noqa: BLE001
            JOBS[jid].update(status="error", message=str(e))
    threading.Thread(target=run, daemon=True).start()
    return jid


def handle(h, method, path):
    seg = path.split("/")[3:]
    try:
        if method == "POST" and seg == ["analyze"]:
            b = h.read_json()
            url, kw = (b.get("url") or "").strip(), " ".join((b.get("keyword") or "").split())
            if "." not in url or not kw:
                return h.send_json({"error": "Nhập URL trang và từ khóa mục tiêu."}, 400)
            return h.send_json({"job_id": start(url, kw, int(b.get("location_code") or 2704), b.get("language_code") or "vi")})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if method == "GET" and seg == ["history"]:
            with db() as conn:
                rows = conn.execute("SELECT id, created_at, url, keyword, score, has_aio, cited FROM geo_checks ORDER BY id DESC LIMIT 200").fetchall()
            return h.send_json({"items": [dict(r) for r in rows]})
        if len(seg) == 2 and seg[0] == "report":
            if method == "DELETE":
                with LOCK, db() as conn:
                    conn.execute("DELETE FROM geo_checks WHERE id=?", (seg[1],))
                return h.send_json({"ok": True})
            with db() as conn:
                r = conn.execute("SELECT id, report_json FROM geo_checks WHERE id=?", (seg[1],)).fetchone()
            if not r:
                return h.send_json({"error": "Không tìm thấy lần kiểm tra này"}, 404)
            rep = json.loads(r["report_json"])
            rep["id"] = r["id"]
            return h.send_json(rep)
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502)
    return True
