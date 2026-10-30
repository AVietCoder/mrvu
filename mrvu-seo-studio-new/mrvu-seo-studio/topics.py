"""
Gợi ý chủ đề cho Autopost: từ chủ đề + website của bạn + tối đa 3 đối thủ, tìm khoảng trống nội dung,
gom nhóm từ khóa thành bài viết, chấm điểm ưu tiên, rồi đưa vào hàng chờ viết bài (kèm "brief" cho AI viết).

Nguồn dữ liệu:
- Miễn phí: sitemap đối thủ và website của bạn (bộ quét của Audit), bài đã viết, hàng chờ, Search Console.
- Trả phí (chế độ đầy đủ): DataForSEO Labs (từ khóa liên quan, từ khóa đối thủ đang lên Top, từ khóa của bạn).
  Nếu Labs không hỗ trợ khu vực/ngôn ngữ, tự chuyển sang Google Ads (keywords_for_keywords / keywords_for_site).
Chỉ dùng thư viện chuẩn của Python.
"""
import json
import math
import re
import threading
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse, unquote

import audit

db = LOCK = load_config = dfs_post = claude = None
JOBS = {}
MAX_COMPETITORS = 3
INTENT_W = {"informational": 1.0, "commercial": 1.25, "transactional": 0.8, "navigational": 0.3}
STOP = set("""cach chon co khong nao tot gia bao nhieu loai cua cho va la nhu the gi tai sao voi mot cac nhung nen mua o dau hay
hoac nha tren duoi trong ngoai den tu ra vao duoc bi rat qua nhat hon kieu mau moi cu re dep top review danh gia so sanh
huong dan kinh nghiem meo khi thi se da dang dung lam ve sau truoc nay kia day do ay ban toi minh chung ta hien nay nam""".split())


def setup(db_func, lock, load_cfg, dfs_post_func, claude_func):
    global db, LOCK, load_config, dfs_post, claude
    db, LOCK, load_config, dfs_post, claude = db_func, lock, load_cfg, dfs_post_func, claude_func
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS tp_runs(
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, site_id INTEGER, seed TEXT, competitors_json TEXT,
            mode TEXT, location TEXT, result_json TEXT, cost_usd REAL)""")


def now():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- tiện ích chữ
def fold(s):
    """Bỏ dấu, viết thường: 'Quạt trần' → 'quat tran'."""
    s = unicodedata.normalize("NFD", str(s or "").lower().replace("đ", "d"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def host_of(u):
    u = str(u or "").strip().lower()
    if "://" not in u:
        u = "https://" + u
    h = urlparse(u).netloc.split(":")[0]
    return h[4:] if h.startswith("www.") else h


def slug_text(url):
    """Đường dẫn bài → cụm chữ đọc được: /tin-tuc/cach-chon-quat-tran.html → 'cach chon quat tran'."""
    path = unquote(urlparse(url).path).rstrip("/")
    seg = path.split("/")[-1] if path else ""
    seg = re.sub(r"\.(html?|aspx?|php)$", "", seg, flags=re.I)
    seg = re.sub(r"(^|[-_])(p|id|n)?\d{3,}($|[-_])", " ", seg)
    words = [w for w in re.split(r"[-_+\s]+", seg) if w and not w.isdigit()]
    return " ".join(words) if len(words) >= 3 else ""


def bigrams(text):
    w = [x for x in fold(text).split() if x not in STOP and len(x) > 1]
    return {a + " " + b for a, b in zip(w, w[1:])} | ({w[0]} if len(w) == 1 else set())


# ---------------------------------------------------------------- nội dung website
def site_pages(domain, progress, label):
    """Danh sách (url, loại) của một website: ưu tiên dữ liệu đã quét ở tab Audit, không có thì đọc sitemap."""
    with db() as conn:
        rows = conn.execute("""SELECT p.url, p.type FROM audit_pages p JOIN audit_sites s ON s.id=p.site_id
                               WHERE s.domain=?""", (domain,)).fetchall()
    if rows:
        return [(r["url"], r["type"]) for r in rows], "audit"
    progress(f"Đang đọc sitemap {label} ({domain})…")
    try:
        _, pages, method = audit.crawl(domain, 1500, lambda m, n: progress(f"Đang đọc {label} ({domain}): {n} trang…"))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Không đọc được website {domain}: {e}")
    return [(u, t) for u, t, _ in pages], method


def content_titles(pages, limit):
    """Lấy cụm chữ từ đường dẫn, ưu tiên bài viết rồi tới trang khác (bỏ trang chủ, danh mục)."""
    out = []
    for kind in ("post", "other", "product"):
        for u, t in pages:
            if t == kind:
                s = slug_text(u)
                if s:
                    out.append((s, u))
    seen, res = set(), []
    for s, u in out:
        if s not in seen:
            seen.add(s)
            res.append((s, u))
    return res[:limit]


def remember_pages(domain, pages, method):
    """Lưu danh sách trang website của bạn vào dữ liệu Audit, để lần sau và AI viết bài dùng làm link nội bộ."""
    with LOCK, db() as conn:
        conn.execute("INSERT OR IGNORE INTO audit_sites(domain) VALUES (?)", (domain,))
        sid = conn.execute("SELECT id FROM audit_sites WHERE domain=?", (domain,)).fetchone()[0]
        for u, t in pages:
            conn.execute("INSERT OR IGNORE INTO audit_pages(site_id, url, type, source) VALUES (?,?,?,?)", (sid, u, t, "topics"))
        n = conn.execute("SELECT COUNT(*) FROM audit_pages WHERE site_id=?", (sid,)).fetchone()[0]
        conn.execute("UPDATE audit_sites SET start_url=COALESCE(start_url, ?), crawled_at=?, method=?, count=? WHERE id=?",
                     (f"https://{domain}/", now(), method, n, sid))


def my_content(site, domain, progress):
    pages, src = site_pages(domain, progress, "website của bạn")
    if src != "audit" and pages:
        try:
            remember_pages(domain, pages, src)
        except Exception as e:  # noqa: BLE001
            print("[gợi ý chủ đề] không lưu được danh sách trang:", e)
    with db() as conn:
        posts = [r["title"] for r in conn.execute("SELECT title FROM ap_posts WHERE site_id=? ORDER BY id DESC LIMIT 150", (site["id"],))]
        queue = [r["keyword"] for r in conn.execute("SELECT keyword FROM ap_keywords WHERE site_id=?", (site["id"],))]
    gsc = []
    cfg = load_config()
    if host_of(str(cfg.get("gsc_site") or "").replace("sc-domain:", "")) == domain:
        try:
            with db() as conn:
                gsc = [dict(r) for r in conn.execute(
                    """SELECT query, SUM(impressions) impr, SUM(clicks) clicks, MIN(position) pos FROM gsc_rows
                       WHERE period='cur' GROUP BY query ORDER BY impr DESC LIMIT 150""")]
        except Exception:  # noqa: BLE001
            gsc = []
    links = [u for u, t in pages if t in ("category", "product")][:80]
    return {"pages": pages, "source": src, "titles": content_titles(pages, 200), "posts": posts, "queue": queue,
            "gsc": gsc, "link_targets": links}


# ---------------------------------------------------------------- DataForSEO
def _labs_items(task):
    res = (task.get("result") or [{}])[0] or {}
    return res.get("items") or []


def _kw_row(kd, extra=None):
    """Chuẩn hóa một dòng từ khóa của Labs (keyword_data hoặc dòng phẳng)."""
    info = kd.get("keyword_info") or {}
    props = kd.get("keyword_properties") or {}
    intent = (kd.get("search_intent_info") or {}).get("main_intent")
    row = {"keyword": " ".join(str(kd.get("keyword") or "").lower().split()), "volume": info.get("search_volume"),
           "kd": props.get("keyword_difficulty"), "intent": intent, "cpc": info.get("cpc")}
    row.update(extra or {})
    return row


def seed_keywords(cfg, seed, loc, lang, notes):
    rows = []
    try:
        t, _ = dfs_post(cfg, "/v3/dataforseo_labs/google/keyword_suggestions/live",
                        [{"keyword": seed, "location_code": loc, "language_code": lang, "limit": 150,
                          "include_seed_keyword": True, "order_by": ["keyword_info.search_volume,desc"]}])
        rows += [_kw_row(i) for i in _labs_items(t)]
        t, _ = dfs_post(cfg, "/v3/dataforseo_labs/google/related_keywords/live",
                        [{"keyword": seed, "location_code": loc, "language_code": lang, "depth": 1, "limit": 150}])
        rows += [_kw_row(i.get("keyword_data") or {}) for i in _labs_items(t)]
    except RuntimeError as e:
        if "hết tiền" in str(e) or "Sai tài khoản" in str(e):
            raise
        notes.append(f"DataForSEO Labs chưa hỗ trợ khu vực này ({e}); chuyển sang dữ liệu Google Ads.")
        t, _ = dfs_post(cfg, "/v3/keywords_data/google_ads/keywords_for_keywords/live",
                        [{"keywords": [seed], "location_code": loc, "language_code": lang, "sort_by": "search_volume"}])
        rows += [{"keyword": " ".join(str(i.get("keyword") or "").lower().split()), "volume": i.get("search_volume"),
                  "kd": i.get("competition_index"), "intent": None, "cpc": i.get("cpc")}
                 for i in (t.get("result") or [])[:300]]
    return rows


def ranked_keywords(cfg, domain, loc, lang, limit, notes):
    """Từ khóa một tên miền đang có thứ hạng Top 20 (Labs), hoặc từ khóa Google Ads gợi ý cho website đó."""
    try:
        t, _ = dfs_post(cfg, "/v3/dataforseo_labs/google/ranked_keywords/live",
                        [{"target": domain, "location_code": loc, "language_code": lang, "limit": limit,
                          "filters": ["ranked_serp_element.serp_item.rank_group", "<=", 20],
                          "order_by": ["keyword_data.keyword_info.search_volume,desc"]}])
        out = []
        for i in _labs_items(t):
            it = (i.get("ranked_serp_element") or {}).get("serp_item") or {}
            out.append(_kw_row(i.get("keyword_data") or {}, {"pos": it.get("rank_group"), "url": it.get("url")}))
        return out, "ranked"
    except RuntimeError as e:
        if "hết tiền" in str(e) or "Sai tài khoản" in str(e):
            raise
        notes.append(f"Không lấy được từ khóa đang lên Top của {domain} ({e}); dùng từ khóa Google Ads gợi ý cho website.")
        try:
            t, _ = dfs_post(cfg, "/v3/keywords_data/google_ads/keywords_for_site/live",
                            [{"target": domain, "target_type": "site", "location_code": loc, "language_code": lang,
                              "sort_by": "search_volume"}])
        except RuntimeError as e2:
            notes.append(f"{domain}: {e2}")
            return [], "none"
        return [{"keyword": " ".join(str(i.get("keyword") or "").lower().split()), "volume": i.get("search_volume"),
                 "kd": i.get("competition_index"), "intent": None, "pos": None, "url": None}
                for i in (t.get("result") or [])[:limit]], "site"


# ---------------------------------------------------------------- AI
def ai_cluster(cfg, ctx):
    comp_txt = "\n".join(f"### {d}\n" + "\n".join(f"- {s}" for s, _ in titles[:130]) for d, titles in ctx["comp_titles"].items()) or "(không có)"
    cand = ctx["candidates"][:260]
    cand_txt = "\n".join(f"- {c['keyword']} | vol {c.get('volume') if c.get('volume') is not None else '?'} | đối thủ: {', '.join(c.get('comps') or []) or '-'}"
                         for c in cand) or "(không có dữ liệu volume — chế độ tiết kiệm)"
    mine_txt = "\n".join(f"- {s}" for s, _ in ctx["mine"]["titles"][:160])
    mine_txt += "".join(f"\n- (bài đã viết) {t}" for t in ctx["mine"]["posts"][:80])
    mine_txt += "".join(f"\n- (hàng chờ) {k}" for k in ctx["mine"]["queue"][:120])
    gsc_txt = "\n".join(f"- {g['query']} | hiển thị {g['impr']} | vị trí {g['pos']:.0f}" for g in ctx["mine"]["gsc"][:100] if g.get("pos"))
    rank_txt = "\n".join(f"- {r['keyword']} | Top {r['pos']}" for r in ctx["my_ranked"][:120] if r.get("pos"))
    links = "\n".join(ctx["mine"]["link_targets"][:80]) or "(không có)"
    prompt = f"""Bạn là chuyên gia SEO nội dung tiếng Việt. Lập danh sách CHỦ ĐỀ BÀI VIẾT NÊN VIẾT cho website {ctx['domain']} (website: {ctx['site_name']}).

Chủ đề người dùng muốn phát triển: "{ctx['seed']}"

## Website của bạn đã có (đường dẫn bài, bài đã viết, hàng chờ)
{mine_txt or '(chưa có)'}

## Từ khóa website của bạn đang có hiển thị trên Google (Search Console)
{gsc_txt or '(không có)'}

## Từ khóa website của bạn đang có thứ hạng
{rank_txt or '(không có)'}

## Bài viết của đối thủ (lấy từ đường dẫn trong sitemap, chữ không dấu)
{comp_txt}

## Từ khóa ứng viên (từ chủ đề và từ đối thủ đang lên Top)
{cand_txt}

## Trang danh mục/sản phẩm trên website của bạn (để gắn link từ bài viết)
{links}

Nhiệm vụ:
1. Chỉ giữ chủ đề LIÊN QUAN tới "{ctx['seed']}" và phù hợp lĩnh vực của website. Bỏ từ khóa thương hiệu đối thủ, từ khóa điều hướng.
2. Gom các từ khóa CÙNG Ý ĐỊNH TÌM KIẾM thành MỘT bài (không tách bài cho từng biến thể). Mỗi bài 1 từ khóa chính + 2-8 từ khóa phụ.
3. Đánh dấu "covered" nếu website của bạn ĐÃ có bài/hàng chờ cùng ý định (ghi rõ bài nào); vẫn liệt kê nhưng để covered.
4. Ưu tiên chủ đề đối thủ đã viết hoặc đang lên Top mà website của bạn chưa có (khoảng trống).
5. Xác định 1-3 bài TRỤ CỘT (pillar, bao quát) và các bài VỆ TINH (cluster) trỏ về bài trụ cột.
6. Nhận xét chủ đề "{ctx['seed']}" có hợp với website không (ví dụ website làm mát công nghiệp mà chủ đề là đồ gia dụng).
7. Tối đa 30 bài. Từ khóa chính viết có dấu, tự nhiên như người Việt tìm trên Google.

Chỉ trả về JSON hợp lệ:
{{
  "site_fit": {{"ok": true, "note": "nhận xét ngắn về mức phù hợp của chủ đề với website"}},
  "summary": "2-3 câu tóm tắt cơ hội nội dung",
  "clusters": [
    {{
      "main_keyword": "từ khóa chính có dấu",
      "keywords": ["từ khóa phụ 1", "từ khóa phụ 2"],
      "title": "tiêu đề gợi ý 50-65 ký tự",
      "angle": "góc viết: hướng dẫn / so sánh / giải đáp / danh sách / review... và điểm khác biệt so với bài đối thủ",
      "intent": "informational|commercial|transactional",
      "type": "pillar|cluster",
      "pillar": "từ khóa chính của bài trụ cột mà bài này trỏ về (bỏ trống nếu là pillar)",
      "competitors": ["tên miền đối thủ đã viết chủ đề này"],
      "covered": null,
      "link_target": "1 URL lấy từ danh sách trang danh mục/sản phẩm, hoặc rỗng",
      "priority": 1,
      "reason": "vì sao nên viết (1 câu)"
    }}
  ]
}}
"priority": 3 = nên viết ngay, 2 = nên viết, 1 = có thể viết sau. "covered": null hoặc chuỗi mô tả bài đã có."""
    txt, _, _ = claude(cfg, prompt, 9000, tag="topics")
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        raise RuntimeError("AI không trả về kết quả hợp lệ, hãy thử lại.")
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        raise RuntimeError("AI trả về dữ liệu bị lỗi định dạng, hãy thử lại.")


# ---------------------------------------------------------------- chấm điểm
def score_clusters(clusters, cand_map, mine, my_ranked, has_volume):
    my_kw = {fold(k) for k in mine["queue"]} | {fold(t) for t in mine["posts"]}
    my_slugs = {fold(s) for s, _ in mine["titles"]}
    my_rank = {fold(r["keyword"]): r for r in my_ranked if r.get("pos")}
    gsc = {fold(g["query"]): g for g in mine["gsc"]}
    allowed_links = set(mine["link_targets"])
    out = []
    for i, c in enumerate(clusters or []):
        main = " ".join(str(c.get("main_keyword") or "").split())
        if not main:
            continue
        kws = [k for k in dict.fromkeys(" ".join(str(x).split()) for x in (c.get("keywords") or [])) if k and k.lower() != main.lower()][:10]
        allk = [main] + kws
        vols = [cand_map.get(fold(k), {}).get("volume") for k in allk]
        vol = sum(v for v in vols if v)
        kds = [cand_map.get(fold(k), {}).get("kd") for k in allk]
        kds = [x for x in kds if x is not None]
        kd = round(sum(kds) / len(kds)) if kds else None
        intent = (c.get("intent") or cand_map.get(fold(main), {}).get("intent") or "informational").lower()
        comps = [d for d in dict.fromkeys(c.get("competitors") or []) if d]
        for k in allk:
            comps += [d for d in cand_map.get(fold(k), {}).get("comps", []) if d not in comps]
        covered = c.get("covered") or None
        fm = fold(main)
        if not covered:
            if fm in my_kw:
                covered = "Đã có trong hàng chờ hoặc bài đã viết"
            elif fm in my_slugs:
                covered = "Website đã có bài cùng đường dẫn"
            elif fm in my_rank and (my_rank[fm].get("pos") or 99) <= 10:
                covered = f"Website đang Top {my_rank[fm]['pos']} với từ này"
        pr = max(1, min(3, int(c.get("priority") or 2)))
        if has_volume:
            raw = math.log10(vol + 10) * INTENT_W.get(intent, 1.0) * (1 - (kd or 30) / 160) * (1 + 0.2 * len(comps)) * (0.8 + 0.15 * pr)
        else:
            raw = INTENT_W.get(intent, 1.0) * (1 + 0.35 * len(comps)) * (0.6 + 0.4 * pr)
        g = gsc.get(fm)
        if g and (g.get("pos") or 99) > 10:
            raw *= 1.15   # đã có hiển thị nhưng chưa vào Top 10: viết bài riêng dễ lên
        link = c.get("link_target") if c.get("link_target") in allowed_links else ""
        out.append({"id": i + 1, "main_keyword": main, "keywords": kws, "title": c.get("title") or main, "angle": c.get("angle") or "",
                    "intent": intent, "type": "pillar" if c.get("type") == "pillar" else "cluster", "pillar": c.get("pillar") or "",
                    "competitors": comps[:MAX_COMPETITORS], "covered": covered, "link_target": link, "reason": c.get("reason") or "",
                    "volume": vol if has_volume else None, "kd": kd, "priority": pr, "raw": raw,
                    "gsc": {"impr": g["impr"], "pos": round(g["pos"], 1)} if g else None, "added": False})
    top = max([o["raw"] for o in out if not o["covered"]] or [1])
    for o in out:
        o["score"] = max(1, min(100, round(o.pop("raw") / top * 100)))
        if o["covered"]:
            o["score"] = min(o["score"], 30)
    out.sort(key=lambda o: (o["covered"] is not None, -o["score"]))
    return out


# ---------------------------------------------------------------- quy trình
def analyze(site_id, seed, competitors, mode, loc, lang, auto_add, auto_top, progress=lambda m: None):
    cfg = load_config()
    if not cfg.get("anthropic_api_key"):
        raise RuntimeError("Chưa có khóa Claude API (Autopost → Cài đặt AI & biến).")
    full = mode != "free"
    if full and not (cfg.get("login") and cfg.get("password")):
        raise RuntimeError("Chế độ đầy đủ cần tài khoản DataForSEO. Điền vào config.json hoặc chọn Chế độ tiết kiệm.")
    with db() as conn:
        site = conn.execute("SELECT * FROM ap_sites WHERE id=?", (site_id,)).fetchone()
    if not site:
        raise RuntimeError("Không tìm thấy website.")
    site = dict(site)
    domain = host_of(site["url"])
    notes = []
    t0 = costs_spent()

    mine = my_content(site, domain, progress)
    comp_titles, comp_src = {}, {}

    def read_comp(d):
        try:
            pages, src = site_pages(d, progress, "đối thủ")
            return d, content_titles(pages, 130), src, None
        except RuntimeError as e:
            return d, [], "none", str(e)
    progress(f"Đang đọc sitemap {len(competitors)} đối thủ…")
    with ThreadPoolExecutor(max_workers=3) as ex:
        for d, titles, src, err in ex.map(read_comp, competitors):
            comp_titles[d], comp_src[d] = titles, src
            if err:
                notes.append(err)
            elif not titles:
                notes.append(f"{d}: không tìm thấy bài viết nào trong sitemap.")

    candidates, my_ranked = {}, []
    if full:
        progress("Đang lấy từ khóa liên quan đến chủ đề…")
        for r in seed_keywords(cfg, seed, loc, lang, notes):
            if r["keyword"]:
                candidates.setdefault(fold(r["keyword"]), {**r, "comps": [], "src": "seed"})
        seed_vocab = set().union(*[bigrams(c["keyword"]) for c in candidates.values()] or [set()]) | bigrams(seed)
        seed_words = {w for w in fold(seed).split() if w not in STOP}
        for d in competitors:
            progress(f"Đang lấy từ khóa {d} đang lên Top…")
            rows, _ = ranked_keywords(cfg, d, loc, lang, 300, notes)
            brand = fold(d.split(".")[0])
            for r in rows:
                fk = fold(r["keyword"])
                if not fk or (brand and brand.replace(" ", "") in fk.replace(" ", "")):
                    continue
                rel = bool(bigrams(r["keyword"]) & seed_vocab) or bool(seed_words & set(fk.split()))
                if not rel:
                    continue
                c = candidates.setdefault(fk, {**r, "comps": [], "src": "comp"})
                if d not in c["comps"]:
                    c["comps"].append(d)
                c.setdefault("comp_urls", {})[d] = {"pos": r.get("pos"), "url": r.get("url")}
        progress("Đang lấy từ khóa website của bạn đang có thứ hạng…")
        my_ranked, _ = ranked_keywords(cfg, domain, loc, lang, 300, notes)
    cand = sorted(candidates.values(), key=lambda c: (-(len(c["comps"])), -(c.get("volume") or 0)))

    progress("AI đang gom nhóm và chấm điểm chủ đề…")
    ai = ai_cluster(cfg, {"domain": domain, "site_name": site["name"], "seed": seed, "mine": mine, "comp_titles": comp_titles,
                          "candidates": cand, "my_ranked": my_ranked})
    clusters = score_clusters(ai.get("clusters"), candidates, mine, my_ranked, full and bool(candidates))
    fit = ai.get("site_fit") or {}
    result = {"seed": seed, "domain": domain, "site_name": site["name"], "competitors": competitors, "mode": "full" if full else "free",
              "site_fit": {"ok": bool(fit.get("ok", True)), "note": fit.get("note") or ""}, "summary": ai.get("summary") or "",
              "clusters": clusters, "notes": notes,
              "stats": {"my_pages": len(mine["pages"]), "my_source": mine["source"], "gsc_queries": len(mine["gsc"]),
                        "competitor_posts": {d: len(t) for d, t in comp_titles.items()}, "candidates": len(candidates),
                        "my_ranked": len(my_ranked)}}
    cost = max(0.0, costs_spent() - t0)
    with LOCK, db() as conn:
        cur = conn.execute("INSERT INTO tp_runs(created_at, site_id, seed, competitors_json, mode, location, result_json, cost_usd) VALUES (?,?,?,?,?,?,?,?)",
                           (now(), site_id, seed, json.dumps(competitors), result["mode"], str(loc), json.dumps(result, ensure_ascii=False), cost))
        rid = cur.lastrowid
    result["id"], result["cost_usd"] = rid, cost
    if auto_add:
        if not result["site_fit"]["ok"]:
            result["auto_added"] = 0
            notes.append("Không tự thêm vào hàng chờ vì chủ đề có vẻ không hợp với website. Kiểm tra rồi tick chọn tay.")
            save_result(rid, result)
        else:
            ids = [c["id"] for c in clusters if not c["covered"] and c["score"] >= 50][:max(1, min(20, auto_top))]
            n = add_to_queue(rid, ids)["added"]
            result = load_run(rid)
            result["auto_added"] = n
            save_result(rid, result)
    return result


def costs_spent():
    try:
        with db() as conn:
            return conn.execute("SELECT COALESCE(SUM(usd),0) FROM spend").fetchone()[0]
    except Exception:  # noqa: BLE001
        return 0.0


def load_run(rid):
    with db() as conn:
        r = conn.execute("SELECT * FROM tp_runs WHERE id=?", (rid,)).fetchone()
    if not r:
        return None
    res = json.loads(r["result_json"])
    res.update(id=r["id"], created_at=r["created_at"], site_id=r["site_id"], cost_usd=r["cost_usd"])
    return res


def save_result(rid, res):
    keep = {k: v for k, v in res.items() if k not in ("id", "created_at", "site_id", "cost_usd")}
    with LOCK, db() as conn:
        conn.execute("UPDATE tp_runs SET result_json=? WHERE id=?", (json.dumps(keep, ensure_ascii=False), rid))


def brief_of(c, res):
    return {"keywords": c["keywords"], "title": c["title"], "angle": c["angle"], "intent": c["intent"], "type": c["type"],
            "pillar": c["pillar"], "link_target": c["link_target"], "competitors": c["competitors"], "seed": res["seed"], "run_id": res.get("id")}


def add_to_queue(rid, ids):
    res = load_run(rid)
    if not res:
        raise RuntimeError("Không tìm thấy lần phân tích này.")
    want = set(int(i) for i in ids)
    added, skipped = 0, 0
    with LOCK, db() as conn:
        for c in res["clusters"]:
            if c["id"] not in want:
                continue
            cur = conn.execute("INSERT OR IGNORE INTO ap_keywords(site_id, keyword, status, brief_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                               (res["site_id"], c["main_keyword"], "pending", json.dumps(brief_of(c, res), ensure_ascii=False), now(), now()))
            if cur.rowcount:
                added += 1
            else:
                skipped += 1
            c["added"] = True
    save_result(rid, res)
    return {"added": added, "skipped": skipped}


# ---------------------------------------------------------------- kiểm tra lệch chủ đề (miễn phí)
def site_vocab(site_id):
    with db() as conn:
        s = conn.execute("SELECT * FROM ap_sites WHERE id=?", (site_id,)).fetchone()
        if not s:
            return None, set(), ""
        s = dict(s)
        domain = host_of(s["url"])
        texts = [s["name"] or "", s.get("category_name") or "", s.get("extra_prompt") or ""]
        texts += [slug_text(r["url"]) for r in conn.execute(
            "SELECT p.url FROM audit_pages p JOIN audit_sites a ON a.id=p.site_id WHERE a.domain=? LIMIT 800", (domain,))]
        texts += [r["title"] for r in conn.execute("SELECT title FROM ap_posts WHERE site_id=? LIMIT 200", (site_id,))]
        texts += [r["keyword"] for r in conn.execute("SELECT keyword FROM ap_keywords WHERE site_id=? LIMIT 300", (site_id,))]
    vocab = set()
    for t in texts:
        vocab |= bigrams(t)
    host_flat = fold(domain.split(".")[0]).replace(" ", "")
    return s, vocab, host_flat


def fit_check(site_id, keywords):
    s, vocab, host_flat = site_vocab(site_id)
    if not s:
        return {"checked": False, "mismatched": [], "note": ""}
    kws = [" ".join(str(k).split()) for k in keywords if str(k).strip()]
    if len(vocab) < 8:
        return {"checked": False, "mismatched": [], "note": "Website chưa có đủ dữ liệu để kiểm tra (hãy quét website ở tab Audit)."}
    bad = []
    for k in kws:
        bg = bigrams(k)
        flat = {b.replace(" ", "") for b in bg}
        if not (bg & vocab) and not any(f and f in host_flat for f in flat):
            bad.append(k)
    note = ""
    if bad:
        note = (f"{len(bad)}/{len(kws)} từ khóa không khớp nội dung hiện có của website {s['name']}. "
                "Kiểm tra lại đã chọn đúng website chưa, để tránh AI viết bài lệch chủ đề.")
    return {"checked": True, "mismatched": bad, "note": note}


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
    seg = path.split("/")[3:]   # /api/tp/<seg...>
    q = parse_qs(urlparse(h.path).query)
    try:
        if method == "POST" and seg == ["analyze"]:
            b = h.read_json()
            seed = " ".join(str(b.get("seed") or "").split())
            sid = int(b.get("site_id") or 0)
            comps = []
            for c in b.get("competitors") or []:
                d = host_of(c)
                if "." in d and d not in comps:
                    comps.append(d)
            if not sid or not seed:
                return h.send_json({"error": "Chọn website và nhập chủ đề muốn phát triển."}, 400)
            if len(comps) > MAX_COMPETITORS:
                return h.send_json({"error": f"Tối đa {MAX_COMPETITORS} đối thủ mỗi lần phân tích."}, 400)
            with db() as conn:
                s = conn.execute("SELECT url FROM ap_sites WHERE id=?", (sid,)).fetchone()
            if s and host_of(s["url"]) in comps:
                return h.send_json({"error": "Đối thủ trùng với website của bạn."}, 400)
            jid = start(analyze, sid, seed, comps, b.get("mode") or "full", int(b.get("location_code") or 2704),
                        b.get("language_code") or "vi", bool(b.get("auto_add")), int(b.get("auto_top") or 5))
            return h.send_json({"job_id": jid})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if method == "GET" and seg == ["runs"]:
            sid = (q.get("site_id") or [""])[0]
            with db() as conn:
                rows = conn.execute("SELECT id, created_at, site_id, seed, competitors_json, mode, cost_usd, result_json FROM tp_runs"
                                    + (" WHERE site_id=?" if sid else "") + " ORDER BY id DESC LIMIT 50", ((sid,) if sid else ())).fetchall()
            items = []
            for r in rows:
                res = json.loads(r["result_json"])
                cl = res.get("clusters") or []
                items.append({"id": r["id"], "created_at": r["created_at"], "site_id": r["site_id"], "seed": r["seed"],
                              "competitors": json.loads(r["competitors_json"] or "[]"), "mode": r["mode"], "cost_usd": r["cost_usd"],
                              "clusters": len(cl), "gaps": sum(1 for c in cl if not c.get("covered")), "added": sum(1 for c in cl if c.get("added"))})
            return h.send_json({"items": items})
        if len(seg) == 2 and seg[0] == "run":
            if method == "DELETE":
                with LOCK, db() as conn:
                    conn.execute("DELETE FROM tp_runs WHERE id=?", (seg[1],))
                return h.send_json({"ok": True})
            res = load_run(int(seg[1]))
            return h.send_json(res) if res else h.send_json({"error": "Không tìm thấy lần phân tích này"}, 404)
        if method == "POST" and seg == ["add"]:
            b = h.read_json()
            return h.send_json(add_to_queue(int(b["run_id"]), b.get("ids") or []))
        if method == "POST" and seg == ["fit"]:
            b = h.read_json()
            return h.send_json(fit_check(int(b.get("site_id") or 0), b.get("keywords") or []))
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502)
    return True
