"""
Backlink: theo dõi backlink của website, so sánh với đối thủ để tìm cơ hội đặt link,
AI soạn tin nhắn xin link và theo dõi trạng thái liên hệ.
Nguồn dữ liệu: DataForSEO Backlinks API (trả phí) hoặc file xuất từ Google Search Console (miễn phí).
"""
import csv
import io
import json
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import audit

db = LOCK = load_config = dfs_post = claude = None
JOBS = {}
OPP_STATUS = ["new", "contacted", "waiting", "won", "rejected", "skip"]


def setup(db_func, lock, load_cfg, dfs_post_func, claude_func):
    global db, LOCK, load_config, dfs_post, claude
    db, LOCK, load_config, dfs_post, claude = db_func, lock, load_cfg, dfs_post_func, claude_func
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS bl_sites(
            id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT UNIQUE, competitors_json TEXT, gap_json TEXT,
            gap_at TEXT, created_at TEXT)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS bl_snapshots(
            id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, at TEXT, source TEXT,
            summary_json TEXT, domains_json TEXT, links_json TEXT, lost_json TEXT, cost REAL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS bl_opps(
            site_id INTEGER, domain TEXT, status TEXT DEFAULT 'new', note TEXT DEFAULT '',
            examples_json TEXT, draft_json TEXT, updated_at TEXT, PRIMARY KEY(site_id, domain))""")


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def clean(d):
    d = str(d or "").strip().lower()
    d = re.sub(r"^https?://", "", d).split("/")[0].split("?")[0].split(":")[0]
    return d[4:] if d.startswith("www.") else d


def need_api():
    cfg = load_config()
    if not (cfg.get("login") and cfg.get("password")):
        raise RuntimeError("Cần tài khoản DataForSEO trong config.json. Hoặc dùng nút “Nhập file Search Console” (miễn phí).")
    return cfg


def call(cfg, path, payload):
    try:
        task, cost = dfs_post(cfg, path, [payload], timeout=120)
    except RuntimeError as e:
        msg = str(e)
        if "40204" in msg or "subscription" in msg.lower() or "access denied" in msg.lower() or "not activated" in msg.lower():
            raise RuntimeError("Tài khoản DataForSEO chưa kích hoạt Backlinks API (cần nạp tối thiểu 100 USD/tháng). "
                               "Bạn vẫn có thể nhập file backlink từ Google Search Console miễn phí.")
        raise
    return (task.get("result") or [{}])[0] or {}, cost


# ---------------------------------------------------------------- phân loại nguồn link
NEWS = re.compile(r"(vnexpress|dantri|tuoitre|thanhnien|vietnamnet|zing|znews|kenh14|cafef|cafebiz|vietnamplus|nld|laodong|tienphong|baomoi|24h|soha|genk|vtv|vov|plo|nguoiduatin|doanhnhan|bao|news|press|times)", re.I)
FORUM = re.compile(r"(forum|dien-?dan|webtretho|otofun|tinhte|voz|reddit|quora|f319|lamchame)", re.I)
SOCIAL = re.compile(r"(facebook|youtube|tiktok|instagram|pinterest|linkedin|twitter|x\.com|zalo|medium|tumblr|blogspot|wordpress\.com|weebly|wix|sites\.google|about\.me|behance|issuu|scribd|slideshare|flickr|vk\.com)", re.I)
DIRECTORY = re.compile(r"(trangvang|yellowpages|danh-?ba|directory|listing|foody|diadiem|cylex|hotfrog|infobel|top10|review|place)", re.I)
SHOP = re.compile(r"(shopee|lazada|tiki|sendo|amazon|ebay|chotot|muaban|rongbay|5giay|raovat)", re.I)


def category(domain):
    d = domain.lower()
    if d.endswith((".gov.vn", ".gov", ".edu.vn", ".edu", ".ac.vn")):
        return "Cơ quan / trường học"
    for rx, name in ((SOCIAL, "Mạng xã hội / blog miễn phí"), (SHOP, "Sàn / rao vặt"), (FORUM, "Diễn đàn"),
                     (DIRECTORY, "Danh bạ / review"), (NEWS, "Báo / tin tức")):
        if rx.search(d):
            return name
    return "Website / blog ngành"


# ---------------------------------------------------------------- cập nhật dữ liệu
def refresh(site_id, progress=lambda m: None):
    cfg = need_api()
    with db() as conn:
        site = dict(conn.execute("SELECT * FROM bl_sites WHERE id=?", (site_id,)).fetchone())
    t = site["domain"]
    cost = 0.0
    progress("Đang lấy chỉ số tổng quan…")
    summ, c = call(cfg, "/v3/backlinks/summary/live", {"target": t, "include_subdomains": True, "rank_scale": "one_hundred"})
    cost += c
    progress("Đang lấy danh sách website trỏ link…")
    rd, c = call(cfg, "/v3/backlinks/referring_domains/live", {"target": t, "limit": 1000, "order_by": ["rank,desc"],
                                                               "rank_scale": "one_hundred", "backlinks_status_type": "live"})
    cost += c
    progress("Đang lấy link bị mất gần đây…")
    lost, c = call(cfg, "/v3/backlinks/referring_domains/live", {"target": t, "limit": 200, "order_by": ["lost_date,desc"],
                                                                 "rank_scale": "one_hundred", "backlinks_status_type": "lost"})
    cost += c
    progress("Đang lấy chi tiết link (anchor, trang đích)…")
    bl, c = call(cfg, "/v3/backlinks/backlinks/live", {"target": t, "mode": "one_per_domain", "limit": 1000,
                                                       "order_by": ["domain_from_rank,desc"], "rank_scale": "one_hundred"})
    cost += c
    attrs = summ.get("referring_links_attributes") or {}
    summary = {k: summ.get(k) for k in ("rank", "backlinks", "referring_domains", "referring_main_domains", "referring_ips",
                                        "referring_domains_nofollow", "broken_backlinks", "backlinks_spam_score", "crawled_pages")}
    summary["nofollow_links"] = attrs.get("nofollow")
    summary["sponsored_links"] = attrs.get("sponsored")
    summary["ugc_links"] = attrs.get("ugc")
    summary["target_spam_score"] = (summ.get("info") or {}).get("target_spam_score")
    domains = [{"domain": clean(i.get("domain")), "rank": i.get("rank"), "backlinks": i.get("backlinks"),
                "first_seen": (i.get("first_seen") or "")[:10], "spam": i.get("backlinks_spam_score"),
                "nofollow": bool(i.get("referring_pages_nofollow")) and i.get("referring_pages_nofollow") == i.get("referring_pages")}
               for i in rd.get("items") or []]
    links = {}
    for i in bl.get("items") or []:
        d = clean(i.get("domain_from"))
        links.setdefault(d, {"url_from": i.get("url_from"), "url_to": i.get("url_to"), "anchor": i.get("anchor") or "",
                             "dofollow": i.get("dofollow"), "title": i.get("page_from_title") or "", "is_new": i.get("is_new")})
    lost_list = [{"domain": clean(i.get("domain")), "rank": i.get("rank"), "lost_date": (i.get("lost_date") or "")[:10],
                  "backlinks": i.get("backlinks")} for i in lost.get("items") or []]
    with LOCK, db() as conn:
        conn.execute("INSERT INTO bl_snapshots(site_id, at, source, summary_json, domains_json, links_json, lost_json, cost) VALUES (?,?,?,?,?,?,?,?)",
                     (site_id, now(), "api", json.dumps(summary), json.dumps(domains, ensure_ascii=False),
                      json.dumps(links, ensure_ascii=False), json.dumps(lost_list, ensure_ascii=False), cost))
    return {"cost": cost, "domains": len(domains)}


def import_csv(site_id, text):
    """Nhận file xuất từ Search Console (Liên kết → Trang web liên kết hàng đầu / Liên kết mới nhất) hoặc bất kỳ CSV có cột URL/tên miền."""
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if len(rows) < 2:
        raise RuntimeError("File không có dữ liệu.")
    head = [h.strip().lower() for h in rows[0]]
    dom_col = num_col = None
    for i, h in enumerate(head):
        if dom_col is None and re.search(r"site|trang web|domain|tên miền|linking page|trang liên kết|url|source|nguồn", h):
            dom_col = i
        elif num_col is None and re.search(r"link|liên kết|count|số|pages|trang", h):
            num_col = i
    if dom_col is None:
        dom_col = 0
    agg = {}
    for r in rows[1:]:
        if len(r) <= dom_col:
            continue
        d = clean(r[dom_col])
        if "." not in d:
            continue
        n = 1
        if num_col is not None and num_col < len(r):
            try:
                n = int(re.sub(r"[^\d]", "", r[num_col]) or 1)
            except ValueError:
                n = 1
        agg[d] = agg.get(d, 0) + n
    if not agg:
        raise RuntimeError("Không tìm thấy cột tên miền/URL trong file. Hãy xuất từ Search Console → Liên kết → Trang web liên kết hàng đầu → Xuất → CSV.")
    domains = [{"domain": d, "rank": None, "backlinks": n, "first_seen": "", "spam": None, "nofollow": False}
               for d, n in sorted(agg.items(), key=lambda x: -x[1])]
    summary = {"rank": None, "backlinks": sum(agg.values()), "referring_domains": len(agg), "referring_main_domains": len(agg)}
    with LOCK, db() as conn:
        conn.execute("INSERT INTO bl_snapshots(site_id, at, source, summary_json, domains_json, links_json, lost_json, cost) VALUES (?,?,?,?,?,?,?,0)",
                     (site_id, now(), "gsc", json.dumps(summary), json.dumps(domains, ensure_ascii=False), "{}", "[]"))
    return {"domains": len(domains)}


def overview(site_id):
    with db() as conn:
        site = conn.execute("SELECT * FROM bl_sites WHERE id=?", (site_id,)).fetchone()
        snaps = conn.execute("SELECT * FROM bl_snapshots WHERE site_id=? ORDER BY id", (site_id,)).fetchall()
    if not site:
        raise RuntimeError("Không tìm thấy website")
    hist = [{"at": s["at"], "source": s["source"], **json.loads(s["summary_json"])} for s in snaps]
    if not snaps:
        return {"site": dict(site), "latest": None, "history": []}
    last = snaps[-1]
    prev = next((s for s in reversed(snaps[:-1]) if s["source"] == last["source"]), None)
    cur_domains = json.loads(last["domains_json"])
    links = json.loads(last["links_json"] or "{}")
    prev_set = {d["domain"] for d in json.loads(prev["domains_json"])} if prev else None
    cur_set = {d["domain"] for d in cur_domains}
    for d in cur_domains:
        d["category"] = category(d["domain"])
        d["link"] = links.get(d["domain"])
        d["is_new"] = (prev_set is not None and d["domain"] not in prev_set) or bool(d["link"] and d["link"].get("is_new"))
    lost = json.loads(last["lost_json"] or "[]")
    if prev:
        gone = [{"domain": d["domain"], "rank": d.get("rank"), "lost_date": last["at"][:10], "backlinks": d.get("backlinks")}
                for d in json.loads(prev["domains_json"]) if d["domain"] not in cur_set]
        known = {x["domain"] for x in lost}
        lost = gone + [x for x in lost if x["domain"] not in {g["domain"] for g in gone}]
    cats = {}
    for d in cur_domains:
        cats[d["category"]] = cats.get(d["category"], 0) + 1
    return {"site": {**dict(site), "competitors": json.loads(site["competitors_json"] or "[]")},
            "latest": {"at": last["at"], "source": last["source"], "summary": json.loads(last["summary_json"]), "cost": last["cost"],
                       "compared_with": prev["at"] if prev else None,
                       "new_count": sum(1 for d in cur_domains if d["is_new"]), "lost_count": len(lost)},
            "domains": cur_domains, "lost": lost[:200], "categories": cats, "history": hist}


def gap(site_id, progress=lambda m: None):
    cfg = need_api()
    with db() as conn:
        site = dict(conn.execute("SELECT * FROM bl_sites WHERE id=?", (site_id,)).fetchone())
        snap = conn.execute("SELECT domains_json FROM bl_snapshots WHERE site_id=? ORDER BY id DESC LIMIT 1", (site_id,)).fetchone()
    comps = json.loads(site["competitors_json"] or "[]")
    if not comps:
        raise RuntimeError("Thêm ít nhất một website đối thủ trước.")
    mine = {d["domain"] for d in json.loads(snap["domains_json"])} if snap else set()
    cost = 0.0
    if not snap:
        progress("Đang lấy website trỏ về bạn…")
        r, c = call(cfg, "/v3/backlinks/referring_domains/live", {"target": site["domain"], "limit": 1000, "rank_scale": "one_hundred"})
        cost += c
        mine = {clean(i.get("domain")) for i in r.get("items") or []}
    agg = {}

    def fetch(comp):
        r, c = call(cfg, "/v3/backlinks/referring_domains/live", {"target": comp, "limit": 1000, "order_by": ["rank,desc"],
                                                                  "rank_scale": "one_hundred", "backlinks_status_type": "live"})
        return comp, r, c
    progress(f"Đang lấy backlink của {len(comps)} đối thủ…")
    with ThreadPoolExecutor(max_workers=4) as ex:
        for comp, r, c in ex.map(fetch, comps):
            cost += c
            for i in r.get("items") or []:
                d = clean(i.get("domain"))
                if not d or d in mine or d == site["domain"] or any(d == clean(x) or d.endswith("." + clean(x)) for x in comps):
                    continue
                a = agg.setdefault(d, {"domain": d, "rank": i.get("rank") or 0, "spam": i.get("backlinks_spam_score"),
                                       "competitors": [], "backlinks": 0})
                a["competitors"].append(comp)
                a["backlinks"] += i.get("backlinks") or 0
                a["rank"] = max(a["rank"], i.get("rank") or 0)
    items = sorted(agg.values(), key=lambda x: (-len(x["competitors"]), -(x["rank"] or 0)))
    for x in items:
        x["category"] = category(x["domain"])
    with LOCK, db() as conn:
        conn.execute("UPDATE bl_sites SET gap_json=?, gap_at=? WHERE id=?", (json.dumps(items[:2000], ensure_ascii=False), now(), site_id))
    return {"count": len(items), "cost": cost}


def examples(site_id, domain):
    with db() as conn:
        site = dict(conn.execute("SELECT * FROM bl_sites WHERE id=?", (site_id,)).fetchone())
        o = conn.execute("SELECT examples_json FROM bl_opps WHERE site_id=? AND domain=?", (site_id, domain)).fetchone()
    if o and o["examples_json"]:
        return json.loads(o["examples_json"])
    cfg = need_api()
    gapl = json.loads(site["gap_json"] or "[]")
    comps = next((g["competitors"] for g in gapl if g["domain"] == domain), json.loads(site["competitors_json"] or "[]"))
    out = []
    for comp in comps[:3]:
        r, _ = call(cfg, "/v3/backlinks/backlinks/live", {"target": comp, "limit": 5, "mode": "as_is",
                                                          "filters": ["domain_from", "like", f"%{domain}"], "order_by": ["rank,desc"]})
        for i in r.get("items") or []:
            out.append({"competitor": comp, "url_from": i.get("url_from"), "url_to": i.get("url_to"), "anchor": i.get("anchor") or "",
                        "title": i.get("page_from_title") or "", "dofollow": i.get("dofollow"), "first_seen": (i.get("first_seen") or "")[:10]})
    save_opp(site_id, domain, examples_json=json.dumps(out, ensure_ascii=False))
    return out


def save_opp(site_id, domain, **kw):
    with LOCK, db() as conn:
        conn.execute("INSERT OR IGNORE INTO bl_opps(site_id, domain, updated_at) VALUES (?,?,?)", (site_id, domain, now()))
        for k, v in kw.items():
            conn.execute(f"UPDATE bl_opps SET {k}=?, updated_at=? WHERE site_id=? AND domain=?", (v, now(), site_id, domain))


def outreach(site_id, domain):
    cfg = load_config()
    if not cfg.get("anthropic_api_key"):
        raise RuntimeError("Cần khóa Claude API (nhập ở tab Autopost → Cài đặt).")
    with db() as conn:
        site = dict(conn.execute("SELECT * FROM bl_sites WHERE id=?", (site_id,)).fetchone())
        o = conn.execute("SELECT examples_json FROM bl_opps WHERE site_id=? AND domain=?", (site_id, domain)).fetchone()
        try:
            pages = [r["url"] for r in conn.execute(
                """SELECT p.url FROM audit_pages p JOIN audit_sites s ON s.id=p.site_id WHERE s.domain=?
                   AND p.type IN ('post','product','category','home') LIMIT 150""", (site["domain"],)).fetchall()]
        except Exception:  # noqa: BLE001
            pages = []
    ex = json.loads(o["examples_json"]) if o and o["examples_json"] else []
    page_txt = ""
    if ex:
        r = audit.fetch(ex[0]["url_from"], timeout=20)
        if r["status"] == 200:
            p = audit.PageParser()
            try:
                p.feed(audit.decode(r))
            except Exception:  # noqa: BLE001
                pass
            page_txt = f"Tiêu đề: {p.title}\n" + " ".join(" ".join(p.text).split())[:3500]
    vars_txt = "\n".join(f"- {v['name']}: {v['value']}" for v in cfg.get("ap_variables") or [] if v.get("value"))
    prompt = f"""Bạn là chuyên viên SEO/PR người Việt, giúp website {site['domain']} xin đặt backlink một cách chính đáng.

Website mục tiêu cần liên hệ: {domain} (loại: {category(domain)})
Website này đang đặt link cho đối thủ:
{json.dumps(ex[:5], ensure_ascii=False, indent=1) if ex else '(chưa có ví dụ cụ thể)'}

Nội dung trang đang đặt link cho đối thủ (rút gọn):
{page_txt or '(không đọc được)'}

Thông tin doanh nghiệp của mình (chỉ dùng thông tin này, không bịa):
{vars_txt or '- (chưa nhập; dùng chỗ trống [TÊN], [SĐT])'}

Các trang trên website mình (chọn trang phù hợp nhất để xin link tới):
{chr(10).join(pages[:120]) or f'https://{site["domain"]}/'}

Hãy đề xuất cách tiếp cận phù hợp nhất (ví dụ: góp nội dung/bài khách, bổ sung vào bài tổng hợp, cập nhật link hỏng, đăng ký danh bạ, hợp tác, PR) và soạn tin nhắn.
Tin nhắn phải: lịch sự, ngắn (dưới 150 chữ), nêu giá trị cụ thể cho họ, không hứa trao đổi link qua lại, không đề nghị trả tiền để mua link dofollow. Nếu cần trả phí (bài PR), nói rõ link sẽ được gắn nhãn sponsored theo hướng dẫn của Google.
Chỉ trả về JSON hợp lệ:
{{
  "approach": "tên cách tiếp cận",
  "why": "vì sao phù hợp với website này",
  "target_page": "URL trang của mình nên được link tới",
  "anchor_ideas": ["2-3 anchor tự nhiên, đa dạng, không nhồi từ khóa"],
  "contact_hint": "nên tìm liên hệ ở đâu trên website đó (trang Liên hệ, email biên tập, fanpage…)",
  "email_subject": "tiêu đề email",
  "email_body": "nội dung email",
  "zalo_message": "bản rút gọn cho Zalo/Messenger, dưới 60 chữ",
  "content_idea": "nếu là bài khách/bổ sung nội dung: đề xuất tiêu đề + 3 ý chính, ngược lại để rỗng"
}}"""
    txt, usage, _ = claude(cfg, prompt, 2500, tag="ai_outreach")
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        raise RuntimeError("AI trả về nội dung không đúng định dạng, hãy thử lại.")
    out = json.loads(m.group(0))
    out["usage"] = usage
    save_opp(site_id, domain, draft_json=json.dumps(out, ensure_ascii=False))
    return out


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
    seg = path.split("/")[3:]
    q = parse_qs(urlparse(h.path).query)
    try:
        if method == "GET" and seg == ["sites"]:
            with db() as conn:
                rows = conn.execute("""SELECT s.id, s.domain, s.competitors_json, s.gap_at,
                    (SELECT at FROM bl_snapshots WHERE site_id=s.id ORDER BY id DESC LIMIT 1) last_at
                    FROM bl_sites s ORDER BY s.id DESC""").fetchall()
            return h.send_json({"items": [{**dict(r), "competitors": json.loads(r["competitors_json"] or "[]")} for r in rows]})
        if method == "POST" and seg == ["sites"]:
            b = h.read_json()
            d = clean(b.get("domain"))
            if "." not in d:
                return h.send_json({"error": "Tên miền chưa đúng. Ví dụ: mrvu.vn"}, 400)
            comps = [c for c in dict.fromkeys(clean(x) for x in b.get("competitors", [])) if "." in c and c != d][:10]
            with LOCK, db() as conn:
                if b.get("id"):
                    conn.execute("UPDATE bl_sites SET competitors_json=? WHERE id=?", (json.dumps(comps), b["id"]))
                    sid = b["id"]
                else:
                    conn.execute("INSERT OR IGNORE INTO bl_sites(domain, competitors_json, created_at) VALUES (?,?,?)", (d, json.dumps(comps), now()))
                    conn.execute("UPDATE bl_sites SET competitors_json=? WHERE domain=?", (json.dumps(comps), d))
                    sid = conn.execute("SELECT id FROM bl_sites WHERE domain=?", (d,)).fetchone()[0]
            return h.send_json({"id": sid, "domain": d, "competitors": comps})
        if method == "DELETE" and len(seg) == 2 and seg[0] == "sites":
            with LOCK, db() as conn:
                for t in ("bl_snapshots", "bl_opps"):
                    conn.execute(f"DELETE FROM {t} WHERE site_id=?", (seg[1],))
                conn.execute("DELETE FROM bl_sites WHERE id=?", (seg[1],))
            return h.send_json({"ok": True})
        if method == "GET" and seg == ["overview"]:
            return h.send_json(overview(int(q.get("site_id", ["0"])[0])))
        if method == "POST" and seg == ["refresh"]:
            return h.send_json({"job_id": start(refresh, int(h.read_json()["site_id"]))})
        if method == "POST" and seg == ["gap"]:
            return h.send_json({"job_id": start(gap, int(h.read_json()["site_id"]))})
        if method == "GET" and len(seg) == 2 and seg[0] == "job":
            return h.send_json(JOBS.get(seg[1]) or {"status": "error", "message": "Không tìm thấy tác vụ"})
        if method == "POST" and seg == ["import"]:
            b = h.read_json()
            return h.send_json(import_csv(int(b["site_id"]), b.get("text") or ""))
        if method == "GET" and seg == ["gap"]:
            sid = int(q.get("site_id", ["0"])[0])
            with db() as conn:
                s = conn.execute("SELECT gap_json, gap_at, competitors_json FROM bl_sites WHERE id=?", (sid,)).fetchone()
                opps = {r["domain"]: dict(r) for r in conn.execute("SELECT domain, status, note, updated_at, examples_json IS NOT NULL has_ex, draft_json IS NOT NULL has_draft FROM bl_opps WHERE site_id=?", (sid,)).fetchall()}
            items = json.loads(s["gap_json"] or "[]") if s else []
            for i in items:
                o = opps.get(i["domain"]) or {}
                i.update(status=o.get("status", "new"), note=o.get("note", ""), updated_at=o.get("updated_at"), has_ex=bool(o.get("has_ex")), has_draft=bool(o.get("has_draft")))
            return h.send_json({"items": items, "at": s["gap_at"] if s else None, "competitors": json.loads(s["competitors_json"] or "[]") if s else []})
        if method == "POST" and seg == ["examples"]:
            b = h.read_json()
            return h.send_json({"items": examples(int(b["site_id"]), clean(b["domain"]))})
        if method == "POST" and seg == ["outreach"]:
            b = h.read_json()
            return h.send_json(outreach(int(b["site_id"]), clean(b["domain"])))
        if method == "GET" and seg == ["opp"]:
            sid, d = int(q.get("site_id", ["0"])[0]), clean(q.get("domain", [""])[0])
            with db() as conn:
                r = conn.execute("SELECT * FROM bl_opps WHERE site_id=? AND domain=?", (sid, d)).fetchone()
            r = dict(r) if r else {"status": "new", "note": ""}
            return h.send_json({"status": r.get("status"), "note": r.get("note"),
                                "examples": json.loads(r["examples_json"]) if r.get("examples_json") else None,
                                "draft": json.loads(r["draft_json"]) if r.get("draft_json") else None})
        if method == "POST" and seg == ["opp"]:
            b = h.read_json()
            st = b.get("status") if b.get("status") in OPP_STATUS else None
            kw = {"note": b.get("note", "")}
            if st:
                kw["status"] = st
            save_opp(int(b["site_id"]), clean(b["domain"]), **kw)
            return h.send_json({"ok": True})
        h.send_json({"error": "Không có trang này"}, 404)
    except RuntimeError as e:
        h.send_json({"error": str(e)}, 502)
    return True
