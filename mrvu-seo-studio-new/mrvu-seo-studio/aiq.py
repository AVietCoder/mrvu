"""
Câu hỏi AI (GEO nâng cao): tìm các câu hỏi người dùng hay hỏi Google/AI trong lĩnh vực kinh doanh, kiểm tra
ChatGPT, Gemini, Perplexity và Google AI Overview có nhắc / trích dẫn website của bạn không, rồi tư vấn
tối ưu từng câu hỏi (trang nào trả lời, đoạn trả lời mẫu, FAQ + schema, nguồn cần xuất hiện) và theo dõi hằng tháng.

Nguồn câu hỏi: Search Console (miễn phí), People Also Ask + tìm kiếm liên quan của Google, gợi ý từ khóa dạng câu hỏi
(DataForSEO Labs), LLM Mentions (câu hỏi trên AI có nhắc lĩnh vực), Claude bổ sung theo từng kiểu khách.
Kiểm tra AI: DataForSEO AI Optimization (LLM Scraper cho ChatGPT/Gemini, LLM Responses cho Perplexity) và SERP Google.
Chỉ dùng thư viện chuẩn của Python.
"""
import json
import re
import threading
import time
import uuid
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import parse_qs, urlparse

import audit
import costs
import geo
import topics

db = LOCK = load_config = dfs_post = claude = None
JOBS = {}
RUNNING = set()   # project_id đang kiểm tra AI

PLATFORMS = {
    "chatgpt": {"label": "ChatGPT", "path": "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced"},
    "gemini": {"label": "Gemini", "path": "/v3/ai_optimization/gemini/llm_scraper/live/advanced"},
    "perplexity": {"label": "Perplexity", "path": "/v3/ai_optimization/perplexity/llm_responses/live"},
    "google": {"label": "Google AI Overview", "path": None},
}
QWORDS = re.compile(r"\?|\b(là gì|la gi|như thế nào|thế nào|có nên|có tốt|có tốn|có bền|có êm|có mát|bao nhiêu|tại sao|vì sao|"
                    r"cách|khi nào|ở đâu|loại nào|hãng nào|nên mua|nên chọn|so sánh|khác nhau|có phải|bao lâu|ra sao|"
                    r"kinh nghiệm|hướng dẫn|review|đánh giá|tốt nhất|top|giá|mấy|được không|hay không|hay là)\b", re.I)
AI_BOTS = [("GPTBot", "OpenAI huấn luyện mô hình"), ("OAI-SearchBot", "ChatGPT tìm kiếm"), ("ChatGPT-User", "ChatGPT mở link khi trả lời"),
           ("PerplexityBot", "Perplexity"), ("Google-Extended", "Gemini / AI của Google"), ("ClaudeBot", "Claude"),
           ("Bingbot", "Bing (ChatGPT dùng chỉ mục Bing)"), ("Googlebot", "Google Search / AI Overview")]
INTENT_VI = {"buy": "Chọn mua", "compare": "So sánh", "price": "Giá", "howto": "Hướng dẫn / lắp đặt",
             "problem": "Sự cố / sửa chữa", "info": "Tìm hiểu", "local": "Mua ở đâu"}


def setup(db_func, lock, load_cfg, dfs_post_func, claude_func):
    global db, LOCK, load_config, dfs_post, claude
    db, LOCK, load_config, dfs_post, claude = db_func, lock, load_cfg, dfs_post_func, claude_func
    with LOCK, db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS aiq_projects(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, domain TEXT, brands_json TEXT,
            competitors_json TEXT, topics_json TEXT, location INTEGER DEFAULT 2704, language TEXT DEFAULT 'vi',
            platforms_json TEXT, auto_check INTEGER DEFAULT 0, auto_days INTEGER DEFAULT 30, auto_top INTEGER DEFAULT 30,
            site_id INTEGER, tech_json TEXT, plan_json TEXT, insights_json TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS aiq_questions(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, question TEXT, norm TEXT,
            cluster TEXT, intent TEXT, sources_json TEXT, ai_volume INTEGER, gsc_impr INTEGER, gsc_pos REAL, priority INTEGER DEFAULT 2,
            status TEXT DEFAULT 'new', target_url TEXT, note TEXT, created_at TEXT, UNIQUE(project_id, norm));
        CREATE TABLE IF NOT EXISTS aiq_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, at TEXT, platforms_json TEXT,
            n_questions INTEGER, summary_json TEXT, cost_usd REAL, auto INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS aiq_checks(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, project_id INTEGER, question_id INTEGER,
            platform TEXT, at TEXT, ok INTEGER, answer TEXT, mentioned INTEGER, cited INTEGER, mention_pos REAL,
            sources_json TEXT, brands_json TEXT, competitors_json TEXT, note TEXT);
        CREATE INDEX IF NOT EXISTS ix_aiq_checks ON aiq_checks(question_id, platform, id);
        CREATE TABLE IF NOT EXISTS aiq_advice(question_id INTEGER PRIMARY KEY, at TEXT, data_json TEXT);
        """)
    threading.Thread(target=scheduler_loop, daemon=True).start()


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


fold = topics.fold
host_of = topics.host_of


def jl(s, default=None):
    try:
        return json.loads(s) if s else default
    except (ValueError, TypeError):
        return default


# ---------------------------------------------------------------- dự án
def get_project(pid):
    with db() as conn:
        r = conn.execute("SELECT * FROM aiq_projects WHERE id=?", (pid,)).fetchone()
    if not r:
        return None
    p = dict(r)
    for k in ("brands", "competitors", "topics", "platforms"):
        p[k] = jl(p.pop(k + "_json"), [])
    for k in ("tech", "plan", "insights"):
        p[k] = jl(p.pop(k + "_json"), None)
    return p


def save_project(b):
    domain = host_of(b.get("domain"))
    if "." not in domain:
        raise RuntimeError("Nhập tên miền website, ví dụ mrvu.vn")
    tps = [" ".join(str(t).split()) for t in b.get("topics") or [] if str(t).strip()][:10]
    if not tps:
        raise RuntimeError("Nhập ít nhất một lĩnh vực, ví dụ: quạt trần")
    brands = [" ".join(str(t).split()) for t in b.get("brands") or [] if str(t).strip()][:10] or [domain]
    comps = []
    for c in (b.get("competitors") or [])[:10]:
        if isinstance(c, str):
            c = {"name": c}
        name = " ".join(str(c.get("name") or "").split())
        dom = host_of(c.get("domain")) if c.get("domain") else ""
        if not name and dom:
            name = dom
        if name:
            comps.append({"name": name, "domain": dom if "." in dom else ""})
    pls = [x for x in (b.get("platforms") or list(PLATFORMS)) if x in PLATFORMS] or list(PLATFORMS)
    vals = (b.get("name") or domain, domain, json.dumps(brands, ensure_ascii=False), json.dumps(comps, ensure_ascii=False),
            json.dumps(tps, ensure_ascii=False), int(b.get("location") or 2704), b.get("language") or "vi", json.dumps(pls),
            1 if b.get("auto_check") else 0, max(7, int(b.get("auto_days") or 30)), max(5, min(100, int(b.get("auto_top") or 30))),
            int(b["site_id"]) if b.get("site_id") else None)
    with LOCK, db() as conn:
        if b.get("id"):
            conn.execute("""UPDATE aiq_projects SET name=?, domain=?, brands_json=?, competitors_json=?, topics_json=?, location=?, language=?,
                            platforms_json=?, auto_check=?, auto_days=?, auto_top=?, site_id=? WHERE id=?""", vals + (int(b["id"]),))
            pid = int(b["id"])
        else:
            pid = conn.execute("""INSERT INTO aiq_projects(name, domain, brands_json, competitors_json, topics_json, location, language,
                platforms_json, auto_check, auto_days, auto_top, site_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""", vals + (now(),)).lastrowid
    return get_project(pid)


def set_project(pid, **kw):
    with LOCK, db() as conn:
        for k, v in kw.items():
            conn.execute(f"UPDATE aiq_projects SET {k}=? WHERE id=?", (json.dumps(v, ensure_ascii=False) if k.endswith("_json") else v, pid))


# ---------------------------------------------------------------- trang của website
def my_pages(domain):
    with db() as conn:
        rows = conn.execute("""SELECT p.url, p.type FROM audit_pages p JOIN audit_sites s ON s.id=p.site_id WHERE s.domain=?""", (domain,)).fetchall()
        posts = conn.execute("SELECT remote_url url, title FROM ap_posts WHERE remote_url LIKE ?", (f"%{domain}%",)).fetchall()
    out = [{"url": r["url"], "type": r["type"], "text": topics.slug_text(r["url"]) or r["url"]} for r in rows]
    out += [{"url": r["url"], "type": "post", "text": r["title"]} for r in posts]
    return out


def match_pages(question, pages, n=5, ignore=()):
    """Trang khớp câu hỏi nhất; bỏ qua các cặp âm tiết của lĩnh vực chung (vd. 'quat tran') vì trang nào cũng có."""
    ig_b = set().union(*[topics.bigrams(t) for t in ignore]) if ignore else set()
    ig_w = {w for t in ignore for w in fold(t).split()}
    qb = topics.bigrams(question) - ig_b
    qw = {w for w in fold(question).split() if w not in topics.STOP and len(w) > 1}
    scored = []
    for p in pages:
        t = fold(p["text"])
        s = 2 * len(qb & (topics.bigrams(p["text"]) - ig_b)) + sum(0.5 if w in ig_w else 1 for w in qw & set(t.split()))
        if s >= 2:
            scored.append((s + (0.5 if p["type"] == "post" else 0), p))
    scored.sort(key=lambda x: -x[0])
    return [p for _, p in scored[:n]]


# ---------------------------------------------------------------- 1. tìm câu hỏi
def is_question(q):
    q = q.strip()
    return bool(QWORDS.search(q)) or len(q.split()) >= 6


def related_to(q, tps):
    fq = fold(q)
    for t in tps:
        ft = fold(t)
        if ft in fq or topics.bigrams(t) & topics.bigrams(q):
            return True
        words = [w for w in ft.split() if w not in topics.STOP]
        if words and all(w in fq.split() for w in words):
            return True
    return False


def llm_mentions(cfg, topic, loc, lang, notes):
    body = [{"target": [{"keyword": topic, "search_scope": "question"}], "platform": "google", "location_code": loc,
             "language_code": lang, "limit": 100, "order_by": ["ai_search_volume,desc"]}]
    task = None
    for path in ("/v3/ai_optimization/llm_mentions/search_mentions/live", "/v3/ai_optimization/llm_mentions/search/live"):
        try:
            task, _ = dfs_post(cfg, path, body, timeout=120)
            break
        except RuntimeError as e:
            if "hết tiền" in str(e) or "Sai tài khoản" in str(e):
                raise
            err = str(e)
    if task is None:
        notes.append(f"LLM Mentions chưa có dữ liệu cho \"{topic}\" ở khu vực này ({err[:120]}).")
        return [], []
    res = (task.get("result") or [{}])[0] or {}
    items = res.get("items") or []
    qs, src = [], []
    for it in items:
        if it.get("question"):
            qs.append({"q": it["question"], "vol": it.get("ai_search_volume")})
        for s in it.get("sources") or []:
            if s.get("domain"):
                src.append(s["domain"])
    if not items:
        notes.append(f"LLM Mentions: không có câu hỏi nào cho \"{topic}\" ở khu vực này.")
    return qs, src


def ai_volume(cfg, questions, loc, lang, notes):
    kws = [q[:250].lower() for q in questions][:1000]
    if not kws:
        return {}
    try:
        task, _ = dfs_post(cfg, "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
                           [{"keywords": kws, "location_code": loc, "language_code": lang}], timeout=120)
    except RuntimeError as e:
        if "hết tiền" in str(e) or "Sai tài khoản" in str(e):
            raise
        notes.append(f"Chưa lấy được lượng tìm kiếm trên AI cho khu vực này ({str(e)[:120]}).")
        return {}
    items = ((task.get("result") or [{}])[0] or {}).get("items") or []
    return {fold(i.get("keyword")): i.get("ai_search_volume") for i in items if i.get("keyword")}


def gsc_questions(domain, tps):
    cfg = load_config()
    if host_of(str(cfg.get("gsc_site") or "").replace("sc-domain:", "")) != domain:
        return []
    try:
        with db() as conn:
            rows = conn.execute("""SELECT query, SUM(impressions) impr, SUM(clicks) clicks, MIN(position) pos FROM gsc_rows
                                   WHERE period='cur' GROUP BY query ORDER BY impr DESC LIMIT 3000""").fetchall()
    except Exception:  # noqa: BLE001
        return []
    return [dict(r) for r in rows if is_question(r["query"]) and related_to(r["query"], tps)][:200]


def discover(pid, opts, progress=lambda m: None):
    p = get_project(pid)
    cfg = load_config()
    if not cfg.get("anthropic_api_key"):
        raise RuntimeError("Chưa có khóa Claude API (Autopost → Cài đặt AI & biến).")
    has_dfs = bool(cfg.get("login") and cfg.get("password"))
    loc, lang, tps = p["location"], p["language"], p["topics"]
    notes, pool, cited_domains = [], {}, []

    def add(q, src, vol=None, extra=None):
        q = " ".join(str(q).split()).strip(" .")
        if not q or len(q) > 240:
            return
        k = fold(q)
        e = pool.setdefault(k, {"q": q, "src": set(), "vol": None, "gsc": None})
        e["src"].add(src)
        if vol is not None:
            e["vol"] = max(e["vol"] or 0, vol)
        if extra:
            e.update(extra)

    with costs.module_as("aiq_discover"):
        progress("Đang lấy câu hỏi từ Search Console…")
        for g in gsc_questions(p["domain"], tps):
            add(g["query"], "gsc", extra={"gsc": {"impr": g["impr"], "pos": round(g["pos"] or 0, 1)}})
        if has_dfs:
            mods = ["{t}", "{t} loại nào tốt", "cách chọn {t}", "{t} giá bao nhiêu", "{t} có tốt không", "lắp đặt {t}"][:max(1, int(opts.get("serp_per_topic") or 4))]
            jobs = [(t, m.format(t=t)) for t in tps for m in mods]
            progress(f"Đang lấy câu hỏi Google (People Also Ask) cho {len(jobs)} lượt tìm…")

            def serp(j):
                try:
                    with costs.module_as("aiq_discover"):
                        return j, geo.fetch_serp(cfg, j[1], loc, lang, paa_depth=2, limit=40), None
                except RuntimeError as e:
                    return j, None, str(e)
            with ThreadPoolExecutor(max_workers=4) as ex:
                for (t, kw), r, err in ex.map(serp, jobs):
                    if err:
                        notes.append(f"Google \"{kw}\": {err}")
                        continue
                    for q in r["paa"]:
                        add(q, "paa")
                    for q in r["related"]:
                        if is_question(q):
                            add(q, "related")
                    if r.get("aio"):
                        cited_domains += [x["domain"] for x in r["aio"]["references"] if x.get("domain")]
            if opts.get("labs", True):
                for t in tps:
                    progress(f"Đang lấy gợi ý tìm kiếm dạng câu hỏi cho \"{t}\"…")
                    try:
                        for r in topics.seed_keywords(cfg, t, loc, lang, notes):
                            if r.get("keyword") and is_question(r["keyword"]):
                                add(r["keyword"], "google_suggest")
                    except RuntimeError as e:
                        notes.append(str(e))
            if opts.get("mentions", True):
                for t in tps:
                    progress(f"Đang lấy câu hỏi trên AI có nhắc \"{t}\" (LLM Mentions)…")
                    qs, src = llm_mentions(cfg, t, loc, lang, notes)
                    for x in qs:
                        add(x["q"], "llm_mentions", x.get("vol"))
                    cited_domains += src
        else:
            notes.append("Chưa có tài khoản DataForSEO: chỉ dùng Search Console và AI gợi ý câu hỏi.")

        progress(f"AI đang bổ sung câu hỏi và gom nhóm ({len(pool)} câu đã thu thập)…")
        collected = sorted(pool.values(), key=lambda e: (-len(e["src"]), -(e["vol"] or 0)))[:320]
        with db() as conn:
            existing = [r["question"] for r in conn.execute("SELECT question FROM aiq_questions WHERE project_id=? LIMIT 400", (pid,))]
        lst = "\n".join(f"{i + 1}. {e['q']}" for i, e in enumerate(collected)) or "(chưa có)"
        prompt = f"""Bạn là chuyên gia GEO (tối ưu cho công cụ tìm kiếm AI) tại Việt Nam. Website: {p['domain']} (thương hiệu: {', '.join(p['brands'])}).
Lĩnh vực kinh doanh: {', '.join(tps)}.

Câu hỏi thật thu thập từ Google, Search Console và dữ liệu AI:
{lst}

Câu hỏi đã có trong bộ (không lặp lại):
{chr(10).join('- ' + q for q in existing[:200]) or '(chưa có)'}

Nhiệm vụ:
1. Giữ các câu hỏi thật sự liên quan tới lĩnh vực, viết lại cho chuẩn chính tả tiếng Việt có dấu, giữ nguyên ý. Gộp các câu trùng ý (ghi tất cả số thứ tự đã gộp vào "from").
2. BỔ SUNG khoảng 40-60 câu hỏi người Việt hay HỎI CHATGPT/GEMINI (dạng hội thoại, dài, có ngữ cảnh) theo từng kiểu khách:
   hộ gia đình (phòng khách, phòng ngủ, trần thấp, nhà phố), chủ nhà xưởng/kho/nhà hàng (quạt công nghiệp, quạt trần công nghiệp, diện tích lớn),
   kiến trúc sư/nhà thầu, người đang so sánh hãng/giá, người gặp sự cố. Câu bổ sung để "from": [].
3. Gán "cluster" (tên nhóm chủ đề ngắn, tối đa 12 nhóm), "intent" thuộc: buy, compare, price, howto, problem, info, local.
4. "priority": 3 = khách sắp mua hoặc câu rất phổ biến, 2 = quan trọng, 1 = phụ.
5. Tối đa 160 câu. Không lấy câu chứa tên thương hiệu đối thủ cụ thể trừ khi là câu so sánh phổ biến.

Chỉ trả về JSON hợp lệ: {{"questions": [{{"q": "câu hỏi", "from": [1, 5], "cluster": "…", "intent": "buy", "priority": 3}}]}}"""
        txt, _, _ = claude(cfg, prompt, 16000, tag="aiq_discover")
        m = re.search(r"\{.*\}", txt, re.S)
        data = jl(m.group(0), {}) if m else {}
        out = data.get("questions") or []
        if not out:
            raise RuntimeError("AI không trả về danh sách câu hỏi hợp lệ, hãy thử lại.")
        final = []
        for x in out:
            q = " ".join(str(x.get("q") or "").split())
            if not q:
                continue
            src, vol, gsc = set(), None, None
            for i in x.get("from") or []:
                try:
                    e = collected[int(i) - 1]
                except (ValueError, IndexError, TypeError):
                    continue
                src |= e["src"]
                vol = max(vol or 0, e["vol"] or 0) if e["vol"] is not None else vol
                gsc = gsc or e.get("gsc")
            if not src:
                src = {"ai"}
            final.append({"q": q, "src": sorted(src), "vol": vol, "gsc": gsc, "cluster": (x.get("cluster") or "Khác")[:60],
                          "intent": x.get("intent") if x.get("intent") in INTENT_VI else "info",
                          "priority": max(1, min(3, int(x.get("priority") or 2)))})
        if has_dfs and opts.get("ai_volume", True):
            progress("Đang lấy lượng tìm kiếm trên AI…")
            av = ai_volume(cfg, [f["q"] for f in final], loc, lang, notes)
            for f in final:
                v = av.get(fold(f["q"]))
                if v is not None:
                    f["vol"] = max(f["vol"] or 0, v)

    pages = my_pages(p["domain"])
    added = 0
    with LOCK, db() as conn:
        n_track = conn.execute("SELECT COUNT(*) FROM aiq_questions WHERE project_id=? AND status='track'", (pid,)).fetchone()[0]
        for f in sorted(final, key=lambda f: (-f["priority"], -len(f["src"]), -(f["vol"] or 0))):
            norm = fold(f["q"])
            old = conn.execute("SELECT id, sources_json FROM aiq_questions WHERE project_id=? AND norm=?", (pid, norm)).fetchone()
            if old:
                src = sorted(set(jl(old["sources_json"], [])) | set(f["src"]))
                conn.execute("UPDATE aiq_questions SET sources_json=?, ai_volume=COALESCE(?, ai_volume), gsc_impr=COALESCE(?, gsc_impr), gsc_pos=COALESCE(?, gsc_pos) WHERE id=?",
                             (json.dumps(src), f["vol"], (f["gsc"] or {}).get("impr"), (f["gsc"] or {}).get("pos"), old["id"]))
                continue
            status = "track" if f["priority"] == 3 and n_track < 30 else "new"
            n_track += status == "track"
            tgt = match_pages(f["q"], pages, 1, tps)
            conn.execute("""INSERT INTO aiq_questions(project_id, question, norm, cluster, intent, sources_json, ai_volume, gsc_impr, gsc_pos,
                            priority, status, target_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                         (pid, f["q"], norm, f["cluster"], f["intent"], json.dumps(f["src"]), f["vol"], (f["gsc"] or {}).get("impr"),
                          (f["gsc"] or {}).get("pos"), f["priority"], status, tgt[0]["url"] if tgt else "", now()))
            added += 1
    ins = p.get("insights") or {}
    if cited_domains:
        cnt = {}
        for d in cited_domains:
            d = host_of(d)
            cnt[d] = cnt.get(d, 0) + 1
        ins["discover_sources"] = sorted(([d, n] for d, n in cnt.items()), key=lambda x: -x[1])[:30]
    ins["discover_at"], ins["discover_notes"] = now(), notes
    set_project(pid, insights_json=ins)
    return {"added": added, "total": len(final), "collected": len(pool), "notes": notes}


# ---------------------------------------------------------------- 2. hỏi AI
def _retry_loc(cfg, path, body, notes, label):
    try:
        return dfs_post(cfg, path, body, timeout=150)[0]
    except RuntimeError as e:
        msg = str(e)
        if "hết tiền" in msg or "Sai tài khoản" in msg:
            raise
        if re.search(r"location|language|40501|40502|Invalid Field", msg, re.I):
            note = f"{label} chưa hỗ trợ khu vực Việt Nam; hỏi bằng tiếng Việt với khu vực mặc định (Mỹ)."
            if note not in notes:
                notes.append(note)
            b = dict(body[0])
            b.update(location_code=2840, language_code="en")
            return dfs_post(cfg, path, [b], timeout=150)[0]
        raise


def ask(cfg, platform, q, loc, lang, notes):
    """Trả về {text, sources:[{url,domain,title}], brands:[..], fan_out:[..], note}."""
    if platform in ("chatgpt", "gemini"):
        task = _retry_loc(cfg, PLATFORMS[platform]["path"], [{"keyword": q, "location_code": loc, "language_code": lang,
                                                               "force_web_search": True}], notes, PLATFORMS[platform]["label"])
        r = (task.get("result") or [{}])[0] or {}
        text = r.get("markdown") or "\n\n".join(i.get("markdown") or i.get("text") or "" for i in r.get("items") or [])
        srcs = [{"url": s.get("url"), "domain": host_of(s.get("domain") or s.get("url")), "title": s.get("title") or ""} for s in r.get("sources") or [] if s.get("url")]
        brands = [b.get("title") for b in r.get("brand_entities") or [] if b.get("title")]
        return {"text": text, "sources": srcs, "brands": brands, "fan_out": r.get("fan_out_queries") or []}
    if platform == "perplexity":
        model = load_config().get("aiq_perplexity_model") or "sonar"
        task, _ = dfs_post(cfg, PLATFORMS["perplexity"]["path"], [{
            "user_prompt": q[:500], "model_name": model, "max_output_tokens": 1500, "web_search_country_iso_code": "VN",
            "system_message": "Bạn trả lời người dùng tại Việt Nam, bằng tiếng Việt."}], timeout=150)
        r = (task.get("result") or [{}])[0] or {}
        text, srcs = [], []
        for it in r.get("items") or []:
            for s in it.get("sections") or []:
                text.append(s.get("text") or "")
                for a in s.get("annotations") or []:
                    if a.get("url"):
                        srcs.append({"url": a["url"], "domain": host_of(a["url"]), "title": a.get("title") or ""})
        return {"text": "\n\n".join(text), "sources": srcs, "brands": [], "fan_out": r.get("fan_out_queries") or []}
    if platform == "google":
        r = geo.fetch_serp(cfg, q, loc, lang)
        if not r.get("aio"):
            return {"text": "", "sources": [], "brands": [], "fan_out": [], "note": "Google không hiện AI Overview cho câu này",
                    "organic": [o["domain"] for o in r["organic"]]}
        return {"text": r["aio"]["markdown"], "sources": [{"url": x["url"], "domain": host_of(x["domain"]), "title": x["title"]} for x in r["aio"]["references"]],
                "brands": [], "fan_out": [], "organic": [o["domain"] for o in r["organic"]]}
    raise RuntimeError("Nền tảng không hỗ trợ")


def _terms(names):
    out = []
    for n in names:
        f = fold(n)
        if len(f.replace(" ", "")) >= 3:
            out.append(f)
    return out


def detect(ans, project):
    """Có nhắc thương hiệu / trích link website không; đối thủ nào được nhắc."""
    text = fold(ans.get("text") or "")
    flat = text.replace(" ", "")
    dom = project["domain"]

    def find(terms):
        pos = None
        for t in terms:
            i = text.find(t)
            if i < 0:
                j = flat.find(t.replace(" ", ""))
                i = int(j * len(text) / max(1, len(flat))) if j >= 0 else -1
            if i >= 0:
                pos = i if pos is None else min(pos, i)
        return pos
    my_terms = _terms(project["brands"] + [dom, dom.split(".")[0]])
    pos = find(my_terms)
    brands_f = [fold(b) for b in ans.get("brands") or []]
    mentioned = pos is not None or any(any(t.replace(" ", "") in b.replace(" ", "") for t in my_terms) for b in brands_f)
    cited = any(s["domain"] == dom or s["domain"].endswith("." + dom) for s in ans.get("sources") or [])
    comps = []
    for c in project["competitors"]:
        terms = _terms([c["name"]] + ([c["domain"], c["domain"].split(".")[0]] if c.get("domain") else []))
        hit = find(terms) is not None or any(any(t.replace(" ", "") in b.replace(" ", "") for t in terms) for b in brands_f)
        hit = hit or bool(c.get("domain") and any(s["domain"] == c["domain"] or s["domain"].endswith("." + c["domain"]) for s in ans.get("sources") or []))
        if hit:
            comps.append(c["name"])
    return {"mentioned": bool(mentioned or cited), "cited": cited,
            "mention_pos": round(pos / max(1, len(text)), 2) if pos is not None else None, "competitors": comps}


def check(pid, qids, platforms, auto=False, progress=lambda m: None):
    p = get_project(pid)
    cfg = load_config()
    if not (cfg.get("login") and cfg.get("password")):
        raise RuntimeError("Kiểm tra câu trả lời của AI cần tài khoản DataForSEO (config.json).")
    if pid in RUNNING:
        raise RuntimeError("Dự án này đang được kiểm tra, đợi lượt trước xong.")
    with db() as conn:
        if qids:
            marks = ",".join("?" * len(qids))
            qs = [dict(r) for r in conn.execute(f"SELECT id, question FROM aiq_questions WHERE project_id=? AND id IN ({marks})", [pid] + list(qids))]
        else:
            qs = [dict(r) for r in conn.execute("SELECT id, question FROM aiq_questions WHERE project_id=? AND status='track' ORDER BY priority DESC, id LIMIT ?",
                                                (pid, p["auto_top"]))]
    if not qs:
        raise RuntimeError("Chưa có câu hỏi nào đang theo dõi. Bấm Tìm câu hỏi hoặc chọn câu hỏi ở Bộ câu hỏi.")
    platforms = [x for x in platforms if x in PLATFORMS] or p["platforms"]
    RUNNING.add(pid)
    notes, t0 = [], topics.costs_spent()
    try:
        with LOCK, db() as conn:
            rid = conn.execute("INSERT INTO aiq_runs(project_id, at, platforms_json, n_questions, auto) VALUES (?,?,?,?,?)",
                               (pid, now(), json.dumps(platforms), len(qs), 1 if auto else 0)).lastrowid
        jobs = [(q, pl) for q in qs for pl in platforms]
        done = [0]

        def one(j):
            q, pl = j
            with costs.module_as("aiq_check"):
                try:
                    ans = ask(cfg, pl, q["question"], p["location"], p["language"], notes)
                    d = detect(ans, p) if ans["text"] else {"mentioned": False, "cited": False, "mention_pos": None, "competitors": []}
                    ok, err = (1 if ans["text"] else 0), ans.get("note") or ""
                except RuntimeError as e:
                    if "hết tiền" in str(e):
                        raise
                    ans, d, ok, err = {"text": "", "sources": [], "brands": []}, {"mentioned": False, "cited": False, "mention_pos": None, "competitors": []}, 0, str(e)[:300]
            with LOCK, db() as conn:
                conn.execute("""INSERT INTO aiq_checks(run_id, project_id, question_id, platform, at, ok, answer, mentioned, cited, mention_pos,
                                sources_json, brands_json, competitors_json, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                             (rid, pid, q["id"], pl, now(), ok, (ans.get("text") or "")[:8000], int(d["mentioned"]), int(d["cited"]), d["mention_pos"],
                              json.dumps(ans.get("sources") or [], ensure_ascii=False), json.dumps(ans.get("brands") or [], ensure_ascii=False),
                              json.dumps(d["competitors"], ensure_ascii=False), err))
            done[0] += 1
            progress(f"Đã hỏi {done[0]}/{len(jobs)} lượt ({PLATFORMS[pl]['label']}: {q['question'][:60]})")
        with ThreadPoolExecutor(max_workers=6) as ex:
            list(ex.map(one, jobs))
        summ = run_summary(rid, p)
        summ["notes"] = notes
        cost = max(0.0, topics.costs_spent() - t0)
        with LOCK, db() as conn:
            conn.execute("UPDATE aiq_runs SET summary_json=?, cost_usd=? WHERE id=?", (json.dumps(summ, ensure_ascii=False), cost, rid))
        return {"run_id": rid, "summary": summ, "cost_usd": cost}
    finally:
        RUNNING.discard(pid)


def run_summary(rid, p):
    with db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM aiq_checks WHERE run_id=?", (rid,))]
    per, comp, dom, qset, qvis = {}, {}, {}, set(), set()
    for r in rows:
        s = per.setdefault(r["platform"], {"asked": 0, "answered": 0, "mentioned": 0, "cited": 0, "errors": 0})
        s["asked"] += 1
        s["answered"] += r["ok"]
        s["mentioned"] += r["mentioned"]
        s["cited"] += r["cited"]
        s["errors"] += 1 if (not r["ok"] and r["note"] and "AI Overview" not in r["note"]) else 0
        qset.add(r["question_id"])
        if r["mentioned"]:
            qvis.add(r["question_id"])
        for c in jl(r["competitors_json"], []):
            comp[c] = comp.get(c, 0) + 1
        for s2 in {x["domain"] for x in jl(r["sources_json"], []) if x.get("domain")}:
            dom[s2] = dom.get(s2, 0) + 1
    answered = sum(s["answered"] for s in per.values())
    mentioned = sum(s["mentioned"] for s in per.values())
    for s in per.values():
        s["visibility"] = round(s["mentioned"] / s["answered"] * 100) if s["answered"] else None
    sov = [{"name": p["brands"][0] if p["brands"] else p["domain"], "mine": True, "count": mentioned}] + \
          [{"name": c, "mine": False, "count": n} for c, n in sorted(comp.items(), key=lambda x: -x[1])]
    return {"platforms": per, "visibility": round(mentioned / answered * 100) if answered else 0, "answered": answered, "mentioned": mentioned,
            "cited": sum(s["cited"] for s in per.values()), "questions": len(qset), "questions_visible": len(qvis), "share_of_voice": sov,
            "top_domains": sorted(([d, n] for d, n in dom.items()), key=lambda x: -x[1])[:25]}


# ---------------------------------------------------------------- 3. tư vấn
def latest_checks(conn, qid):
    rows = conn.execute("""SELECT c.* FROM aiq_checks c JOIN (SELECT platform, MAX(id) mid FROM aiq_checks WHERE question_id=? GROUP BY platform) t
                           ON c.id=t.mid""", (qid,)).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        d["sources"] = jl(d.pop("sources_json"), [])
        d["brands"] = jl(d.pop("brands_json"), [])
        d["competitors"] = jl(d.pop("competitors_json"), [])
        out[d["platform"]] = d
    return out


def faq_jsonld(items):
    return {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in items if q and a]}


def advise_one(qid, cfg):
    with db() as conn:
        q = dict(conn.execute("SELECT * FROM aiq_questions WHERE id=?", (qid,)).fetchone())
        checks = latest_checks(conn, qid)
    p = get_project(q["project_id"])
    pages = my_pages(p["domain"])
    cands = match_pages(q["question"], pages, 6, p["topics"])
    target = q.get("target_url") or (cands[0]["url"] if cands else "")
    page = geo.read_page(target, 5000) if target else None
    ans_txt = []
    for pl, c in checks.items():
        st = "CÓ trích link website" if c["cited"] else ("CÓ nhắc thương hiệu" if c["mentioned"] else "KHÔNG nhắc website")
        ans_txt.append(f"### {PLATFORMS[pl]['label']} ({st}; đối thủ được nhắc: {', '.join(c['competitors']) or 'không'})\n"
                       f"Nguồn được trích: {', '.join(dict.fromkeys(s['domain'] for s in c['sources']))[:400] or 'không'}\n"
                       f"{(c['answer'] or c['note'] or '')[:1400]}")
    page_txt = ""
    if page and not page.get("error"):
        page_txt = (f"URL: {page['url']}\nTitle: {page['title']}\nH1: {', '.join(page['h1'])}\nHeadings: "
                    + " | ".join(t for _, t in page["headings"][:25]) + f"\nSchema: {', '.join(page['schema'])}\nSố chữ: {page['word_count']}\n"
                    f"Nội dung (trích): {page['text'][:3500]}")
    elif target:
        page_txt = f"Không đọc được trang {target}: {(page or {}).get('error', '')}"
    cfg_vars = "\n".join(f"- {v['name']}: {v['value']}" for v in cfg.get("ap_variables") or [] if v.get("name") and v.get("value"))
    prompt = f"""Bạn là chuyên gia GEO (Generative Engine Optimization) tại Việt Nam. Mục tiêu: khi người dùng hỏi AI (ChatGPT, Gemini, Perplexity, Google AI Overview)
câu hỏi dưới đây, câu trả lời phải NHẮC và TRÍCH DẪN website {p['domain']} (thương hiệu: {', '.join(p['brands'])}).

Câu hỏi: "{q['question']}"  (nhóm: {q['cluster']}, ý định: {INTENT_VI.get(q['intent'], q['intent'])})

## AI đang trả lời thế nào
{chr(10).join(ans_txt) or '(chưa kiểm tra câu trả lời của AI)'}

## Trang của website đang phù hợp nhất
{page_txt or '(chưa có trang phù hợp)'}

## Các trang khác có thể liên quan
{chr(10).join(c['url'] for c in cands[1:]) or '(không có)'}

## Thông tin doanh nghiệp (chỉ dùng thông tin có thật ở đây, không bịa)
{cfg_vars or '(không có)'}

Đưa ra tư vấn cụ thể, làm được ngay. Chỉ trả về JSON hợp lệ:
{{
  "verdict": "1-2 câu: hiện trạng và vì sao AI chưa/đã chọn website",
  "priority": "cao|trung bình|thấp",
  "target": {{"type": "existing|new", "url": "URL trang có sẵn nên sửa (nếu existing)", "title": "tiêu đề bài mới (nếu new)", "reason": "vì sao"}},
  "answer_block": {{"heading": "H2 đúng dạng câu hỏi", "paragraph": "đoạn 40-60 chữ trả lời thẳng, có con số/tiêu chí cụ thể, nhắc thương hiệu tự nhiên nếu hợp", "bullets": ["3-6 ý chi tiết dạng gạch đầu dòng"]}},
  "facts_needed": ["thông số, số liệu, bảng so sánh, ảnh/video thực tế cần bổ sung để AI tin và trích dẫn"],
  "faq": [{{"q": "câu hỏi liên quan", "a": "trả lời 30-50 chữ"}}],
  "on_page": ["việc sửa cụ thể trên trang: vị trí, nội dung, schema, tiêu đề..."],
  "entity": ["tín hiệu thương hiệu/độ tin cậy cần có: tác giả, kinh nghiệm, địa chỉ, chính sách, đánh giá..."],
  "off_site": [{{"domain": "website AI hay trích (lấy từ nguồn ở trên)", "action": "cách xuất hiện ở đó một cách chính đáng (bài chuyên gia, review, PR có gắn rel sponsored...)"}}],
  "competitor_gap": "đối thủ được AI nhắc có điểm gì website chưa có (nếu có)"
}}"""
    txt, _, _ = claude(cfg, prompt, 3500, tag="aiq_advise")
    m = re.search(r"\{.*\}", txt, re.S)
    data = jl(m.group(0), None) if m else None
    if not data:
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, hãy thử lại.")
    ab = data.get("answer_block") or {}
    faq = [(ab.get("heading") or q["question"], ab.get("paragraph") or "")] + [(f.get("q"), f.get("a")) for f in data.get("faq") or []]
    data["jsonld"] = faq_jsonld(faq)
    data["question"], data["target_page"], data["candidates"] = q["question"], target, [c["url"] for c in cands]
    with LOCK, db() as conn:
        conn.execute("INSERT OR REPLACE INTO aiq_advice(question_id, at, data_json) VALUES (?,?,?)", (qid, now(), json.dumps(data, ensure_ascii=False)))
        if not q.get("target_url") and data.get("target", {}).get("type") == "existing" and data["target"].get("url"):
            conn.execute("UPDATE aiq_questions SET target_url=? WHERE id=?", (data["target"]["url"], qid))
    return data


def advise(qids, progress=lambda m: None):
    cfg = load_config()
    if not cfg.get("anthropic_api_key"):
        raise RuntimeError("Chưa có khóa Claude API (Autopost → Cài đặt AI & biến).")
    out, errs, done = {}, [], [0]

    def one(qid):
        try:
            with costs.module_as("aiq_advise"):
                out[qid] = advise_one(qid, cfg)
        except Exception as e:  # noqa: BLE001
            errs.append(str(e))
        done[0] += 1
        progress(f"AI đã tư vấn {done[0]}/{len(qids)} câu hỏi…")
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(one, qids))
    if not out and errs:
        raise RuntimeError(errs[0])
    return {"done": len(out), "errors": errs[:5], "ids": list(out)}


def plan(pid, progress=lambda m: None):
    p = get_project(pid)
    cfg = load_config()
    progress("AI đang lập kế hoạch GEO…")
    ov = overview(pid)
    with db() as conn:
        qs = [dict(r) for r in conn.execute("SELECT id, question, cluster, intent, priority, status, target_url FROM aiq_questions WHERE project_id=? AND status<>'ignored' ORDER BY priority DESC LIMIT 160", (pid,))]
    vis = ov.get("by_question") or {}
    lines = [f"- [{q['cluster']}] {q['question']} | ưu tiên {q['priority']} | trang: {q['target_url'] or 'chưa có'} | AI nhắc: {vis.get(str(q['id']), {}).get('mentioned', '?')}/{vis.get(str(q['id']), {}).get('answered', '?')}"
             for q in qs]
    tech = p.get("tech") or {}
    prompt = f"""Bạn là chuyên gia GEO tại Việt Nam. Lập KẾ HOẠCH 90 NGÀY để website {p['domain']} (thương hiệu {', '.join(p['brands'])}) được ChatGPT, Gemini, Perplexity
và Google AI Overview nhắc và trích dẫn khi người dùng hỏi về: {', '.join(p['topics'])}.

Mức hiện diện hiện tại: {ov.get('last_run', {}).get('visibility', 'chưa kiểm tra')}% câu trả lời có nhắc website.
Đối thủ được AI nhắc nhiều: {', '.join(f"{x['name']} ({x['count']})" for x in (ov.get('last_run') or {}).get('share_of_voice', [])[1:6]) or 'chưa có dữ liệu'}.
Website AI hay trích dẫn: {', '.join(d for d, _ in (ov.get('last_run') or {}).get('top_domains', [])[:15]) or 'chưa có dữ liệu'}.
Kỹ thuật: {json.dumps(tech.get('summary') or {}, ensure_ascii=False)}

Bộ câu hỏi:
{chr(10).join(lines)}

Chỉ trả về JSON hợp lệ:
{{
  "headline": "1 câu tóm tắt chiến lược",
  "hubs": [{{"title": "trang trung tâm (hub) cho 1 nhóm câu hỏi", "url_suggest": "đường dẫn gợi ý hoặc URL có sẵn", "clusters": ["nhóm"], "why": "..."}}],
  "phases": [{{"name": "Tuần 1-2", "tasks": ["việc cụ thể"]}}, {{"name": "Tuần 3-6", "tasks": []}}, {{"name": "Tuần 7-12", "tasks": []}}],
  "entity": ["việc củng cố thương hiệu/độ tin cậy"],
  "off_site": ["kênh/website nên xuất hiện và cách làm chính đáng"],
  "kpi": ["chỉ số theo dõi và mục tiêu"]
}}"""
    with costs.module_as("aiq_plan"):
        txt, _, _ = claude(cfg, prompt, 6000, tag="aiq_plan")
    m = re.search(r"\{.*\}", txt, re.S)
    data = jl(m.group(0), None) if m else None
    if not data:
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, hãy thử lại.")
    data["at"] = now()
    set_project(pid, plan_json=data)
    return data


# ---------------------------------------------------------------- 4. kỹ thuật (miễn phí)
def tech_check(pid, progress=lambda m: None):
    p = get_project(pid)
    d = p["domain"]
    base = f"https://{d}"
    progress("Đang đọc robots.txt…")
    rb = audit.fetch(base + "/robots.txt", timeout=15)
    if rb["status"] == 0:
        rb = audit.fetch(f"https://www.{d}/robots.txt", timeout=15)
    txt = audit.decode(rb) if rb["status"] == 200 else ""
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(txt.splitlines())
    bots = [{"bot": b, "what": w, "allowed": rp.can_fetch(b, base + "/") if txt else True} for b, w in AI_BOTS]
    progress("Đang kiểm tra llms.txt và trang chủ…")
    llms = audit.fetch(base + "/llms.txt", timeout=15)
    home = geo.read_page(base + "/", 3000)
    checks = []

    def add(label, ok, value, fix):
        checks.append({"label": label, "status": "pass" if ok is True else ("warn" if ok is None else "fail"), "value": value, "fix": fix})
    blocked = [b["bot"] for b in bots if not b["allowed"]]
    search_blocked = [b for b in blocked if b not in ("GPTBot", "Google-Extended", "ClaudeBot")]
    add("Cho phép bot AI đọc website", (not blocked) or (None if not search_blocked else False),
        "Bị chặn: " + ", ".join(blocked) if blocked else "Tất cả bot AI chính đều được phép",
        "Trong robots.txt, không chặn OAI-SearchBot, ChatGPT-User, PerplexityBot, Bingbot, Googlebot. Bot bị chặn thì AI đó không thể đọc và trích dẫn website. (GPTBot/Google-Extended chỉ ảnh hưởng việc huấn luyện; nên cho phép nếu muốn AI biết thương hiệu.)")
    add("Có robots.txt", rb["status"] == 200, f"HTTP {rb['status']}", "Tạo robots.txt ở thư mục gốc, khai báo Sitemap.")
    add("Có sitemap trong robots.txt", "sitemap:" in txt.lower() or None, "Có" if "sitemap:" in txt.lower() else "Không khai báo",
        "Thêm dòng Sitemap: https://" + d + "/sitemap.xml vào robots.txt để bot AI tìm hết trang.")
    llms_ok = llms["status"] == 200 and len(llms["body"]) > 50 and b"<html" not in llms["body"][:300].lower()
    add("Tệp llms.txt", llms_ok or None, "Có" if llms_ok else "Chưa có",
        "Tùy chọn (chưa phải chuẩn chính thức): tạo /llms.txt tóm tắt doanh nghiệp, danh mục sản phẩm và các trang hướng dẫn quan trọng bằng Markdown.")
    if home and not home.get("error"):
        sch = set(home.get("schema") or [])
        add("Schema thương hiệu ở trang chủ", bool(sch & {"Organization", "LocalBusiness", "Store", "HomeAndConstructionBusiness"}) or None,
            ", ".join(sorted(sch)) or "Không có", "Thêm JSON-LD Organization/LocalBusiness: tên, logo, địa chỉ, hotline, sameAs (Facebook, YouTube, Zalo OA, Google Maps). AI dùng để nhận diện thương hiệu.")
        add("Trang chủ không chặn index/đoạn trích", not (home.get("noindex") or home.get("nosnippet")), "OK" if not (home.get("noindex") or home.get("nosnippet")) else "Có noindex/nosnippet",
            "Gỡ noindex/nosnippet/max-snippet:0.")
    else:
        add("Đọc được trang chủ", False, (home or {}).get("error", "lỗi"), "Kiểm tra website có mở được không.")
    res = {"at": now(), "bots": bots, "checks": checks, "robots_status": rb["status"],
           "summary": {c["label"]: c["status"] for c in checks}}
    set_project(pid, tech_json=res)
    return res


# ---------------------------------------------------------------- tổng quan
def overview(pid):
    p = get_project(pid)
    with db() as conn:
        runs = [dict(r) for r in conn.execute("SELECT id, at, platforms_json, n_questions, summary_json, cost_usd, auto FROM aiq_runs WHERE project_id=? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 24", (pid,))]
        qn = conn.execute("SELECT status, COUNT(*) n FROM aiq_questions WHERE project_id=? GROUP BY status", (pid,)).fetchall()
        clusters = [dict(r) for r in conn.execute("SELECT cluster, COUNT(*) n, SUM(status='track') track FROM aiq_questions WHERE project_id=? AND status<>'ignored' GROUP BY cluster ORDER BY n DESC", (pid,))]
        byq = {}
        for r in conn.execute("""SELECT c.question_id, q.cluster, c.platform, c.ok, c.mentioned, c.cited FROM aiq_checks c
                                 JOIN (SELECT question_id, platform, MAX(id) mid FROM aiq_checks WHERE project_id=? GROUP BY question_id, platform) t ON c.id=t.mid
                                 JOIN aiq_questions q ON q.id=c.question_id""", (pid,)):
            b = byq.setdefault(str(r["question_id"]), {"answered": 0, "mentioned": 0, "cited": 0, "cluster": r["cluster"]})
            b["answered"] += r["ok"]
            b["mentioned"] += r["mentioned"]
            b["cited"] += r["cited"]
        n_adv = conn.execute("SELECT COUNT(*) FROM aiq_advice a JOIN aiq_questions q ON q.id=a.question_id WHERE q.project_id=?", (pid,)).fetchone()[0]
    for c in clusters:
        qs = [v for v in byq.values() if v["cluster"] == c["cluster"]]
        ans = sum(v["answered"] for v in qs)
        c["visibility"] = round(sum(v["mentioned"] for v in qs) / ans * 100) if ans else None
    trend = [{"at": r["at"], "visibility": jl(r["summary_json"], {}).get("visibility"),
              "platforms": {k: v.get("visibility") for k, v in (jl(r["summary_json"], {}).get("platforms") or {}).items()}} for r in reversed(runs)]
    last = jl(runs[0]["summary_json"], {}) if runs else None
    if last:
        last.update(id=runs[0]["id"], at=runs[0]["at"], cost_usd=runs[0]["cost_usd"])
    return {"project": p, "questions": {r["status"]: r["n"] for r in qn}, "clusters": clusters, "last_run": last, "trend": trend,
            "runs": [{"id": r["id"], "at": r["at"], "n": r["n_questions"], "visibility": jl(r["summary_json"], {}).get("visibility"),
                      "cost_usd": r["cost_usd"], "auto": r["auto"], "platforms": jl(r["platforms_json"], [])} for r in runs],
            "by_question": byq, "advised": n_adv, "running": pid in RUNNING}


def questions(pid):
    with db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM aiq_questions WHERE project_id=? ORDER BY priority DESC, id", (pid,))]
        last = {}
        for r in conn.execute("""SELECT c.question_id, c.platform, c.ok, c.mentioned, c.cited, c.competitors_json, c.note FROM aiq_checks c
                                 JOIN (SELECT question_id, platform, MAX(id) mid FROM aiq_checks WHERE project_id=? GROUP BY question_id, platform) t ON c.id=t.mid""", (pid,)):
            last.setdefault(r["question_id"], {})[r["platform"]] = {"ok": r["ok"], "m": r["mentioned"], "c": r["cited"],
                                                                   "comp": jl(r["competitors_json"], []), "note": r["note"] or ""}
        adv = {r["question_id"]: r["at"] for r in conn.execute("SELECT a.question_id, a.at FROM aiq_advice a JOIN aiq_questions q ON q.id=a.question_id WHERE q.project_id=?", (pid,))}
    for r in rows:
        r["sources"] = jl(r.pop("sources_json"), [])
        r["checks"] = last.get(r["id"], {})
        r["advised_at"] = adv.get(r["id"])
    return rows


def question_detail(qid):
    with db() as conn:
        q = conn.execute("SELECT * FROM aiq_questions WHERE id=?", (qid,)).fetchone()
        if not q:
            return None
        q = dict(q)
        q["sources"] = jl(q.pop("sources_json"), [])
        q["latest"] = latest_checks(conn, qid)
        q["history"] = [dict(r) for r in conn.execute("SELECT platform, at, ok, mentioned, cited FROM aiq_checks WHERE question_id=? ORDER BY id", (qid,))]
        a = conn.execute("SELECT at, data_json FROM aiq_advice WHERE question_id=?", (qid,)).fetchone()
    q["advice"] = {**jl(a["data_json"], {}), "at": a["at"]} if a else None
    return q


def run_detail(rid):
    with db() as conn:
        r = conn.execute("SELECT * FROM aiq_runs WHERE id=?", (rid,)).fetchone()
        if not r:
            return None
        rows = [dict(x) for x in conn.execute("""SELECT c.question_id, q.question, q.cluster, c.platform, c.ok, c.mentioned, c.cited, c.competitors_json, c.note
                                                  FROM aiq_checks c JOIN aiq_questions q ON q.id=c.question_id WHERE c.run_id=?""", (rid,))]
    mat = {}
    for x in rows:
        e = mat.setdefault(x["question_id"], {"id": x["question_id"], "question": x["question"], "cluster": x["cluster"], "cells": {}})
        e["cells"][x["platform"]] = {"ok": x["ok"], "m": x["mentioned"], "c": x["cited"], "comp": jl(x["competitors_json"], []), "note": x["note"] or ""}
    return {"id": r["id"], "at": r["at"], "platforms": jl(r["platforms_json"], []), "summary": jl(r["summary_json"], {}), "cost_usd": r["cost_usd"],
            "rows": sorted(mat.values(), key=lambda e: (-sum(c["m"] for c in e["cells"].values()), e["cluster"] or ""))}


# ---------------------------------------------------------------- chuyển sang công cụ khác
def send_autopost(qids, site_id):
    added, skipped = 0, 0
    with db() as conn:
        site = conn.execute("SELECT id FROM ap_sites WHERE id=?", (site_id,)).fetchone()
    if not site:
        raise RuntimeError("Chọn website Autopost để gửi.")
    for qid in qids:
        d = question_detail(qid)
        if not d:
            continue
        a = d.get("advice") or {}
        ab = a.get("answer_block") or {}
        brief = {"keywords": [f["q"] for f in a.get("faq") or []][:6], "title": (a.get("target") or {}).get("title") or "",
                 "angle": ("Bài trả lời câu hỏi người dùng hay hỏi AI. Mở bài bằng đoạn trả lời thẳng: " + ab.get("paragraph", "")
                           + (" | Cần có: " + "; ".join(a.get("facts_needed") or [])[:400] if a.get("facts_needed") else "")),
                 "intent": d["intent"], "type": "cluster", "pillar": "", "link_target": "", "competitors": [], "seed": d["question"], "source": "aiq"}
        with LOCK, db() as conn:
            cur = conn.execute("INSERT OR IGNORE INTO ap_keywords(site_id, keyword, status, brief_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                               (site_id, d["question"], "pending", json.dumps(brief, ensure_ascii=False), now(), now()))
        added += cur.rowcount
        skipped += 1 - cur.rowcount
    return {"added": added, "skipped": skipped}


def faq_export(qids):
    items = []
    for qid in qids:
        d = question_detail(qid)
        a = (d or {}).get("advice") or {}
        ab = a.get("answer_block") or {}
        if ab.get("paragraph"):
            items.append((d["question"].rstrip("?") + "?", ab["paragraph"], ab.get("bullets") or []))
    if not items:
        raise RuntimeError("Các câu đã chọn chưa có tư vấn AI. Bấm Tư vấn tối ưu trước.")
    html = "<section class=\"faq\">\n<h2>Câu hỏi thường gặp</h2>\n" + "\n".join(
        f"<h3>{escape(q)}</h3>\n<p>{escape(a)}</p>" + ("\n<ul>" + "".join(f"<li>{escape(b)}</li>" for b in bl) + "</ul>" if bl else "")
        for q, a, bl in items) + "\n</section>"
    ld = faq_jsonld([(q, a) for q, a, _ in items])
    return {"html": html, "jsonld": json.dumps(ld, ensure_ascii=False, indent=2), "count": len(items)}


# ---------------------------------------------------------------- lịch kiểm tra định kỳ
def scheduler_loop():
    time.sleep(60)
    while True:
        try:
            with db() as conn:
                ps = [dict(r) for r in conn.execute("SELECT id, auto_days FROM aiq_projects WHERE auto_check=1")]
            for p in ps:
                with db() as conn:
                    last = conn.execute("SELECT MAX(at) FROM aiq_runs WHERE project_id=?", (p["id"],)).fetchone()[0]
                due = not last or datetime.fromisoformat(last) < datetime.now().astimezone() - timedelta(days=int(p["auto_days"]))
                if due and not costs.over_budget() and p["id"] not in RUNNING:
                    pr = get_project(p["id"])
                    print(f"[câu hỏi AI] kiểm tra định kỳ dự án {pr['domain']}")
                    try:
                        check(p["id"], [], pr["platforms"], auto=True)
                    except Exception as e:  # noqa: BLE001
                        print("[câu hỏi AI] lỗi kiểm tra định kỳ:", e)
        except Exception as e:  # noqa: BLE001
            print("[câu hỏi AI] lỗi lịch:", e)
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
    seg = path.split("/")[3:]   # /api/aiq/<seg...>
    q = parse_qs(urlparse(h.path).query)
    pid = int((q.get("project_id") or ["0"])[0] or 0)
    try:
        if method == "GET" and seg == ["projects"]:
            with db() as conn:
                ids = [r["id"] for r in conn.execute("SELECT id FROM aiq_projects ORDER BY id")]
            return h.send_json({"items": [get_project(i) for i in ids], "platforms": {k: v["label"] for k, v in PLATFORMS.items()}})
        if method == "POST" and seg == ["projects"]:
            return h.send_json(save_project(h.read_json()))
        if method == "DELETE" and len(seg) == 2 and seg[0] == "projects":
            with LOCK, db() as conn:
                for t in ("aiq_checks", "aiq_runs"):
                    conn.execute(f"DELETE FROM {t} WHERE project_id=?", (seg[1],))
                conn.execute("DELETE FROM aiq_advice WHERE question_id IN (SELECT id FROM aiq_questions WHERE project_id=?)", (seg[1],))
                conn.execute("DELETE FROM aiq_questions WHERE project_id=?", (seg[1],))
                conn.execute("DELETE FROM aiq_projects WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})
        if method == "GET" and seg == ["overview"]:
            return h.send_json(overview(pid))
        if method == "GET" and seg == ["questions"]:
            return h.send_json({"items": questions(pid)})
        if method == "POST" and seg == ["questions"]:
            b = h.read_json()
            pr = get_project(int(b["project_id"]))
            pages = my_pages(pr["domain"])
            n = 0
            with LOCK, db() as conn:
                for x in b.get("questions") or []:
                    x = " ".join(str(x).split())
                    if x:
                        t = match_pages(x, pages, 1, pr["topics"])
                        n += conn.execute("""INSERT OR IGNORE INTO aiq_questions(project_id, question, norm, cluster, intent, sources_json, priority, status, target_url, created_at)
                                             VALUES (?,?,?,?,?,?,?,?,?,?)""", (pr["id"], x, fold(x), b.get("cluster") or "Tự thêm", "info", '["manual"]', 2, "track",
                                                                               t[0]["url"] if t else "", now())).rowcount
            return h.send_json({"added": n})
        if method == "POST" and seg == ["questions", "bulk"]:
            b = h.read_json()
            ids = [int(i) for i in b.get("ids") or []]
            if ids and b.get("status") in ("new", "track", "ignored"):
                with LOCK, db() as conn:
                    conn.execute(f"UPDATE aiq_questions SET status=? WHERE id IN ({','.join('?' * len(ids))})", [b["status"]] + ids)
            return h.send_json({"ok": True})
        if len(seg) == 2 and seg[0] == "questions":
            if method == "DELETE":
                with LOCK, db() as conn:
                    conn.execute("DELETE FROM aiq_questions WHERE id=?", (seg[1],))
                    conn.execute("DELETE FROM aiq_checks WHERE question_id=?", (seg[1],))
                    conn.execute("DELETE FROM aiq_advice WHERE question_id=?", (seg[1],))
                return h.send_json({"ok": True})
            if method == "POST":
                b = h.read_json()
                with LOCK, db() as conn:
                    for k in ("status", "target_url", "cluster", "priority", "note"):
                        if k in b:
                            conn.execute(f"UPDATE aiq_questions SET {k}=? WHERE id=?", (b[k], seg[1]))
                return h.send_json({"ok": True})
            d = question_detail(int(seg[1]))
            return h.send_json(d) if d else h.send_json({"error": "Không tìm thấy câu hỏi"}, 404)
        if method == "POST" and seg == ["discover"]:
            b = h.read_json()
            if not get_project(int(b.get("project_id") or 0)):
                return h.send_json({"error": "Chưa có dự án"}, 400)
            return h.send_json({"job_id": start(discover, int(b["project_id"]), b.get("options") or {})})
        if method == "POST" and seg == ["check"]:
            b = h.read_json()
            p2 = int(b.get("project_id") or 0)
            if p2 in RUNNING:
                return h.send_json({"error": "Dự án này đang được kiểm tra."}, 409)
            return h.send_json({"job_id": start(check, p2, [int(i) for i in b.get("question_ids") or []][:200], b.get("platforms") or [], False)})
        if method == "POST" and seg == ["advise"]:
            b = h.read_json()
            ids = [int(i) for i in b.get("question_ids") or []][:30]
            if not ids:
                return h.send_json({"error": "Chọn ít nhất một câu hỏi"}, 400)
            return h.send_json({"job_id": start(advise, ids)})
        if method == "POST" and seg == ["plan"]:
            return h.send_json({"job_id": start(plan, int(h.read_json()["project_id"]))})
        if method == "POST" and seg == ["tech"]:
            return h.send_json({"job_id": start(tech_check, int(h.read_json()["project_id"]))})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if method == "GET" and len(seg) == 2 and seg[0] == "run":
            d = run_detail(int(seg[1]))
            return h.send_json(d) if d else h.send_json({"error": "Không tìm thấy lần kiểm tra"}, 404)
        if method == "POST" and seg == ["send-autopost"]:
            b = h.read_json()
            return h.send_json(send_autopost([int(i) for i in b.get("question_ids") or []], int(b.get("site_id") or 0)))
        if method == "POST" and seg == ["faq"]:
            return h.send_json(faq_export([int(i) for i in h.read_json().get("question_ids") or []]))
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502 if "DataForSEO" in str(e) or "Claude" in str(e) else 400)
    return True
