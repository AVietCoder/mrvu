"""
Quản lý chi phí: bảng giá, ước tính trước mỗi lần dùng, sổ chi tiêu thật, ngân sách tháng và cảnh báo.
"""
import json
import math
import threading
from contextlib import contextmanager
from datetime import datetime
from urllib.parse import urlparse

db = LOCK = load_config = save_config = None

# Giá mặc định (USD) — tra ngày 15/10/2026, chỉnh được trong Cài đặt chi phí
DEFAULT_PRICES = {
    "dfs_volume_task": 0.09,      # Google Ads Search Volume Live, tối đa 1.000 từ/lần
    "dfs_serp_page": 0.002,       # 1 trang 10 kết quả, Live regular
    "dfs_aio_extra": 0.002,       # thêm khi tải AI Overview
    "dfs_paa_click": 0.00015,     # mở rộng People also ask
    "dfs_bl_request": 0.02,       # Backlinks API mỗi lần gọi
    "dfs_bl_row": 0.00003,        # Backlinks API mỗi dòng
    "dfs_labs_task": 0.01,        # DataForSEO Labs mỗi lần gọi (gợi ý chủ đề)
    "dfs_labs_item": 0.0001,      # DataForSEO Labs mỗi dòng trả về
    "dfs_aiv_task": 0.01,         # AI Keyword Data (lượng tìm kiếm trên AI) mỗi lần gọi
    "dfs_aiv_item": 0.0001,       # AI Keyword Data mỗi từ
    "dfs_llmm_task": 0.1,         # LLM Mentions mỗi lần gọi
    "dfs_llmm_row": 0.001,        # LLM Mentions mỗi dòng
    "dfs_llm_scrape": 0.004,      # LLM Scraper (ChatGPT, Gemini) mỗi câu hỏi, chế độ Live
    "dfs_llm_resp": 0.0006,       # LLM Responses (Perplexity) phí nền mỗi câu
    "llm_provider_est": 0.006,    # ước tính phí hãng AI (Perplexity) mỗi câu trả lời
    "claude_in": 2.0,             # USD / 1 triệu token đầu vào (Claude Sonnet 5.5)
    "claude_out": 10.0,           # USD / 1 triệu token đầu ra
}
DEFAULT_BUDGET = {
    "budget_month_vnd": 300000,   # ngân sách tháng
    "confirm_over_vnd": 5000,     # một lần dùng từ mức này trở lên thì hỏi trước
    "warn_pct": 80,               # cảnh báo khi đã dùng % ngân sách
    "auto_stop": True,            # dừng lịch Autopost khi vượt ngân sách
    "rank_recent_days": 6,        # bỏ qua từ khóa vừa quét trong N ngày
    "geo_recent_days": 7,         # cảnh báo phân tích GEO trùng trong N ngày
    "bl_recent_days": 7,          # cảnh báo cập nhật backlink dày hơn N ngày
    "tp_recent_days": 30,
    "aiq_recent_days": 14,        # cảnh báo kiểm tra AI lặp lại trong N ngày
    "smap_recent_days": 7,        # cảnh báo phân tích toàn website lặp lại trong N ngày         # cảnh báo phân tích gợi ý chủ đề trùng trong N ngày
}
# Lượng token ước tính cho mỗi việc dùng AI (đầu vào, đầu ra) — tiếng Việt
AI_TOKENS = {
    "audit_ai": (5000, 1500), "geo": (12000, 2000), "ai_outreach": (4000, 900),
    "gsc_title": (1500, 600), "gsc_plan": (8000, 5000), "gsc_report": (12000, 3000),
    "topics": (14000, 6000),
    "aiq_discover": (16000, 9000), "aiq_advise": (7000, 2200), "aiq_plan": (14000, 6000),
    "smap_page": (6000, 1800), "smap_place": (3000, 400), "smap_report": (9000, 2500),
}
MODULE = {
    "volume": "Tra cứu Volume", "rank": "Rank Tracker", "audit_ai": "Audit On-page", "autopost_write": "Autopost",
    "geo": "AI Overview", "bl_refresh": "Backlink", "bl_gap": "Backlink", "bl_examples": "Backlink", "ai_outreach": "Backlink",
    "gsc_title": "Search Console", "gsc_plan": "Search Console", "gsc_report": "Search Console",
    "topics": "Gợi ý chủ đề",
    "aiq_discover": "Câu hỏi AI", "aiq_check": "Câu hỏi AI", "aiq_advise": "Câu hỏi AI", "aiq_plan": "Câu hỏi AI",
    "smap_cycle": "Bản đồ website", "smap_report": "Bản đồ website", "smap_page": "Bản đồ website", "smap_place": "Bản đồ website",
}
LABEL = {
    "volume": "Tra volume", "rank": "Quét thứ hạng", "audit_ai": "Gợi ý AI cho trang", "autopost_write": "AI viết bài",
    "geo": "Phân tích AI Overview", "bl_refresh": "Cập nhật backlink", "bl_gap": "Tìm cơ hội từ đối thủ",
    "bl_examples": "Xem link mẫu của đối thủ", "ai_outreach": "AI soạn tin xin link", "gsc_title": "AI viết lại title",
    "gsc_plan": "AI lập kế hoạch nội dung", "gsc_report": "AI viết báo cáo tư vấn",
    "topics": "Phân tích gợi ý chủ đề",
    "aiq_discover": "Tìm câu hỏi người dùng hỏi AI", "aiq_check": "Kiểm tra câu trả lời của AI",
    "aiq_advise": "AI tư vấn tối ưu câu hỏi", "aiq_plan": "AI lập kế hoạch GEO",
    "smap_cycle": "Phân tích toàn website", "smap_report": "AI báo cáo website", "smap_page": "AI tư vấn một trang", "smap_place": "AI tìm vị trí đặt link",
}


def setup(db_func, lock, load_cfg, save_cfg):
    global db, LOCK, load_config, save_config
    db, LOCK, load_config, save_config = db_func, lock, load_cfg, save_cfg
    with LOCK, db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS spend(
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, month TEXT, module TEXT, action TEXT, usd REAL, detail TEXT)""")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_spend ON spend(month)")


def settings():
    cfg = load_config()
    s = {**DEFAULT_BUDGET, **(cfg.get("cost_budget") or {})}
    p = {**DEFAULT_PRICES, **(cfg.get("cost_prices") or {})}
    rate = float(cfg.get("usd_vnd") or 26000)
    return s, p, rate


def month_key(dt=None):
    return (dt or datetime.now()).strftime("%Y-%m")


def record(module, action, usd, detail=""):
    """Ghi chi phí thật. An toàn khi bảng chưa tạo hoặc lỗi — không làm hỏng việc chính."""
    if db is None or not usd:
        return
    try:
        with LOCK, db() as conn:
            conn.execute("INSERT INTO spend(at, month, module, action, usd, detail) VALUES (?,?,?,?,?,?)",
                         (datetime.now().astimezone().isoformat(timespec="seconds"), month_key(), module, action, float(usd), str(detail)[:200]))
    except Exception as e:  # noqa: BLE001
        print("[chi phí] không ghi được:", e)


_ctx = threading.local()


@contextmanager
def module_as(action):
    """Ghi mọi chi phí phát sinh trong khối này vào một thao tác/module cụ thể (dùng trong luồng job)."""
    old = getattr(_ctx, "action", None)
    _ctx.action = action
    try:
        yield
    finally:
        _ctx.action = old


def record_dfs(path, cost):
    ov = getattr(_ctx, "action", None)
    if ov:
        m, a = MODULE.get(ov, "DataForSEO"), ov
    elif "/ai_optimization/" in path:
        m, a = "Câu hỏi AI", "aiq_check"
    elif "dataforseo_labs" in path or "keywords_for_" in path:
        m, a = "Gợi ý chủ đề", "topics"
    elif "keywords_data" in path:
        m, a = "Tra cứu Volume", "volume"
    elif "/serp/" in path and "advanced" in path:
        m, a = "AI Overview", "geo"
    elif "/serp/" in path:
        m, a = "Rank Tracker", "rank"
    elif "/backlinks/" in path:
        m, a = "Backlink", "backlinks"
    else:
        m, a = "DataForSEO", "khác"
    record(m, a, cost, path.split("/v3/")[-1])


def claude_usd(usage, prices=None):
    p = prices or settings()[1]
    return (usage.get("input_tokens", 0) * p["claude_in"] + usage.get("output_tokens", 0) * p["claude_out"]) / 1e6


def record_claude(tag, usage):
    tag = getattr(_ctx, "action", None) if tag in (None, "") else tag
    record(MODULE.get(tag, "AI"), tag or "ai", claude_usd(usage), f"{usage.get('input_tokens', 0)}+{usage.get('output_tokens', 0)} token")


def month_spent(month=None):
    with db() as conn:
        r = conn.execute("SELECT COALESCE(SUM(usd),0) s FROM spend WHERE month=?", (month or month_key(),)).fetchone()
    return r["s"]


def over_budget():
    s, _, rate = settings()
    return month_spent() * rate >= s["budget_month_vnd"]


# ---------------------------------------------------------------- ước tính
def ai_cost(i, o, p):
    return (i * p["claude_in"] + o * p["claude_out"]) / 1e6


def estimate(action, prm):
    s, p, rate = settings()
    parts, warns, tips, options = [], [], [], []
    usd = 0.0

    def add(label, v):
        nonlocal usd
        usd += v
        parts.append({"label": label, "usd": v})

    if action == "volume":
        n = int(prm.get("count") or 0)
        tasks = max(1, math.ceil(n / 1000))
        add(f"{tasks} lần tra × {p['dfs_volume_task']} USD (tính theo lần, tối đa 1.000 từ/lần)", tasks * p["dfs_volume_task"])
        if n and n < 200:
            tips.append(f"Giá tính theo lần tra chứ không theo số từ: tra {n} từ hay 1.000 từ đều tốn như nhau. Nên gom thêm từ khóa rồi tra một lần.")
        if prm.get("dupes"):
            warns.append({"level": "warn", "text": f"{prm['dupes']}/{n} từ đã tra trong 30 ngày qua, có sẵn trong Lịch sử kiểm tra."})
    elif action == "rank":
        n, eng, depth = int(prm.get("count") or 0), int(prm.get("engines") or 1), int(prm.get("depth") or 10)
        pages = math.ceil(depth / 10)
        per = pages * p["dfs_serp_page"]
        eng = 1
        add(f"{n} từ × {pages} trang kết quả Google × {p['dfs_serp_page']} USD", n * per)
        recent = int(prm.get("recent") or 0)
        if recent:
            options.append({"id": "skipRecent", "checked": True, "saving_usd": recent * eng * per,
                            "label": f"Bỏ qua {recent} từ đã quét trong {s['rank_recent_days']} ngày gần đây"})
        if depth > 10:
            tips.append(f"Quét Top {depth} tốn gấp {pages} lần Top 10. Chỉ nên quét sâu với từ còn xa top; từ đã ở top 10 thì quét Top 10.")

    elif action == "geo":
        add("Kết quả Google + AI Overview (DataForSEO)", p["dfs_serp_page"] + p["dfs_aio_extra"] + p["dfs_paa_click"])
        if prm.get("ai", True):
            add("Claude so sánh và viết đề xuất (ước tính)", ai_cost(*AI_TOKENS["geo"], p))
        if prm.get("recent_days") is not None and prm["recent_days"] < s["geo_recent_days"]:
            warns.append({"level": "warn", "text": f"URL và từ khóa này vừa phân tích {str(prm['recent_days']) + ' ngày trước' if prm['recent_days'] else 'hôm nay'}. AI Overview ít thay đổi trong vài ngày, nên mở lại báo cáo cũ trong Lịch sử."})
        tips.append("Từ khóa mua hàng (giá, mua, tên sản phẩm) hiếm khi có AI Overview; khi đó công cụ không gọi AI nên chỉ tốn phần dữ liệu Google.")
    elif action == "autopost_write":
        w = int(prm.get("words") or 1200)
        out = int(w * 3.2) + 900
        add(f"Claude lập dàn ý + viết bài ~{w:,} chữ (ước tính)".replace(",", "."), ai_cost(3500 + 2000, out, p))
        if prm.get("images") == "pexels":
            parts.append({"label": "Ảnh Pexels", "usd": 0})
        if w >= 2500:
            tips.append("Bài 2.500 chữ tốn gấp đôi bài 1.200 chữ. Chỉ viết dài cho chủ đề thật sự cần.")
    elif action == "bl_refresh":
        add("4 lần gọi Backlinks API", 4 * p["dfs_bl_request"])
        add("Khoảng 2.000 dòng dữ liệu", 2200 * p["dfs_bl_row"])
        if prm.get("days_since") is not None and prm["days_since"] < s["bl_recent_days"]:
            warns.append({"level": "warn", "text": f"Lần cập nhật trước {'mới cách ' + str(prm['days_since']) + ' ngày' if prm['days_since'] else 'là hôm nay'}. Backlink thay đổi chậm; cập nhật mỗi tuần hoặc mỗi tháng là đủ."})
        tips.append("Muốn miễn phí: nhập file CSV từ Google Search Console thay vì cập nhật qua API.")
    elif action == "bl_gap":
        c = int(prm.get("competitors") or 1)
        add(f"{c} đối thủ × (1 lần gọi + tối đa 1.000 dòng)", c * (p["dfs_bl_request"] + 1000 * p["dfs_bl_row"]))
        if prm.get("no_snapshot"):
            add("Lấy danh sách link của bạn", p["dfs_bl_request"] + 1000 * p["dfs_bl_row"])
    elif action == "bl_examples":
        c = min(3, int(prm.get("competitors") or 1))
        add(f"{c} lần tìm link mẫu", c * (p["dfs_bl_request"] + 5 * p["dfs_bl_row"]))
    elif action == "topics":
        c = max(0, min(3, int(prm.get("competitors") or 0)))
        data = 0.0
        if prm.get("mode", "full") != "free":
            seed = 2 * (p["dfs_labs_task"] + 150 * p["dfs_labs_item"])
            comp = c * (p["dfs_labs_task"] + 300 * p["dfs_labs_item"])
            mine = p["dfs_labs_task"] + 300 * p["dfs_labs_item"]
            add("Từ khóa liên quan đến chủ đề (2 lần gọi DataForSEO)", seed)
            if c:
                add(f"Từ khóa đối thủ đang lên Top: {c} đối thủ × tối đa 300 từ", comp)
            add("Từ khóa website của bạn đang có thứ hạng", mine)
            data = seed + comp + mine
        parts.append({"label": f"Đọc sitemap {c} đối thủ + website của bạn + Search Console", "usd": 0})
        add("Claude gom nhóm, chấm điểm, gợi ý góc viết (ước tính)", ai_cost(*AI_TOKENS["topics"], p))
        if data:
            options.append({"id": "free_mode", "checked": False, "saving_usd": data,
                            "label": "Chế độ tiết kiệm: bỏ dữ liệu volume, chỉ đọc sitemap đối thủ và Search Console"})
        if prm.get("recent_days") is not None and prm["recent_days"] < s.get("tp_recent_days", 30):
            warns.append({"level": "warn", "text": f"Đã phân tích chủ đề này với cùng đối thủ {str(prm['recent_days']) + ' ngày trước' if prm['recent_days'] else 'hôm nay'}. Đối thủ ít thay đổi trong vài tuần, nên mở lại kết quả cũ ở mục Lần phân tích trước."})
        tips.append("Kết quả được lưu lại: mở lại lần phân tích cũ không tốn thêm tiền. Mỗi chủ đề phân tích 1 lần/tháng là đủ.")
    elif action == "aiq_discover":
        n = max(1, int(prm.get("topics") or 1))
        q = int(prm.get("serp_per_topic") or 4)
        add(f"Câu hỏi Google (People Also Ask, tìm kiếm liên quan): {n} lĩnh vực × {q} lần tìm", n * q * (p["dfs_serp_page"] + p["dfs_aio_extra"] + 4 * p["dfs_paa_click"]))
        if prm.get("labs", True):
            add(f"Gợi ý từ khóa dạng câu hỏi: {n} lĩnh vực", n * (p["dfs_labs_task"] + 300 * p["dfs_labs_item"]))
        if prm.get("mentions", True):
            add(f"Câu hỏi trên AI có nhắc lĩnh vực (LLM Mentions): {n} lần × tối đa 100 dòng", n * (p["dfs_llmm_task"] + 100 * p["dfs_llmm_row"]))
        if prm.get("ai_volume", True):
            add("Lượng tìm kiếm trên AI cho tối đa 300 câu", p["dfs_aiv_task"] + 300 * p["dfs_aiv_item"])
        parts.append({"label": "Câu hỏi từ Search Console của bạn", "usd": 0})
        add("Claude bổ sung câu hỏi theo từng kiểu khách, gom nhóm, chấm ưu tiên (ước tính)", ai_cost(*AI_TOKENS["aiq_discover"], p))
        if prm.get("mentions", True):
            options.append({"id": "no_mentions", "checked": False, "saving_usd": n * (p["dfs_llmm_task"] + 100 * p["dfs_llmm_row"]),
                            "label": "Bỏ nguồn LLM Mentions (dữ liệu Việt Nam có thể ít)"})
    elif action == "aiq_check":
        n = int(prm.get("questions") or 0)
        pls = prm.get("platforms") or ["chatgpt", "gemini", "perplexity", "google"]
        per = {"chatgpt": ("ChatGPT", p["dfs_llm_scrape"]), "gemini": ("Gemini", p["dfs_llm_scrape"]),
               "perplexity": ("Perplexity", p["dfs_llm_resp"] + p["llm_provider_est"]),
               "google": ("Google AI Overview", p["dfs_serp_page"] + p["dfs_aio_extra"])}
        for k in pls:
            if k in per:
                add(f"{per[k][0]}: {n} câu hỏi", n * per[k][1])
        parts.append({"label": "Dò thương hiệu, nguồn trích dẫn trong câu trả lời (tại máy)", "usd": 0})
        if prm.get("recent_days") is not None and prm["recent_days"] < s.get("aiq_recent_days", 14):
            warns.append({"level": "warn", "text": f"Lần kiểm tra trước {'mới cách ' + str(prm['recent_days']) + ' ngày' if prm['recent_days'] else 'là hôm nay'}. Câu trả lời của AI thay đổi theo tuần; kiểm tra 2–4 tuần một lần là đủ để thấy xu hướng."})
        tips.append("Mỗi lần kiểm tra chỉ chọn các câu hỏi đang theo dõi (ưu tiên cao). Kết quả lưu lại để so sánh theo thời gian.")
    elif action == "aiq_advise":
        n = max(1, int(prm.get("questions") or 1))
        add(f"Claude tư vấn tối ưu {n} câu hỏi (ước tính)", n * ai_cost(*AI_TOKENS["aiq_advise"], p))
    elif action == "smap_cycle":
        n = int(prm.get("pages") or 300)
        ai_n = int(prm.get("ai_pages") if prm.get("ai_pages") is not None else n)
        parts.append({"label": f"Quét {n} trang, liên kết nội bộ, chấm điểm SEO/GEO (tại máy)", "usd": 0})
        parts.append({"label": "Search Console, GA4, kiểm tra index, tốc độ PageSpeed (Google, miễn phí)", "usd": 0})
        if prm.get("labs", True):
            add("Từ khóa website đang có thứ hạng (DataForSEO Labs, tối đa 1.000 từ)", p["dfs_labs_task"] + 1000 * p["dfs_labs_item"])
        if ai_n:
            add(f"Claude gán từ khóa, nhóm chủ đề cho {ai_n} trang (ước tính)", ai_n * ai_cost(180, 115, p))
        add("Claude viết báo cáo và việc cần làm (ước tính)", ai_cost(*AI_TOKENS["smap_report"], p))
        if prm.get("recent_days") is not None and prm["recent_days"] < s.get("smap_recent_days", 7):
            warns.append({"level": "warn", "text": f"Lần phân tích trước {'mới cách ' + str(prm['recent_days']) + ' ngày' if prm['recent_days'] else 'là hôm nay'}. Số liệu Search Console thay đổi chậm; phân tích mỗi 2–4 tuần là hợp lý."})
        tips.append("Lần phân tích sau chỉ gán lại từ khóa cho trang mới, nên rẻ hơn nhiều. Chọn \"Gán lại toàn bộ\" khi đổi chiến lược từ khóa.")
    elif action in AI_TOKENS:
        add(LABEL[action] + " (ước tính)", ai_cost(*AI_TOKENS[action], p))
    else:
        raise RuntimeError("Không rõ thao tác cần ước tính.")

    spent = month_spent()
    budget_usd = s["budget_month_vnd"] / rate
    after = spent + usd
    pct_after = after / budget_usd * 100 if budget_usd else 0
    vnd = usd * rate
    if after > budget_usd:
        warns.insert(0, {"level": "bad", "text": f"Lần này sẽ làm vượt ngân sách tháng ({round(spent * rate):,} đ đã dùng / {s['budget_month_vnd']:,} đ).".replace(",", ".")})
    elif pct_after >= s["warn_pct"]:
        warns.insert(0, {"level": "warn", "text": f"Sau lần này đã dùng {pct_after:.0f}% ngân sách tháng."})
    if vnd >= s["confirm_over_vnd"] * 4:
        warns.insert(0, {"level": "bad", "text": f"Chi phí lần này lớn: gấp {vnd / s['confirm_over_vnd']:.0f} lần ngưỡng hỏi trước bạn đặt."})
    need = vnd >= s["confirm_over_vnd"] or any(w["level"] in ("bad", "warn") for w in warns) or bool(options)
    return {"action": action, "label": LABEL.get(action, action), "usd": usd, "vnd": vnd, "parts": parts, "warnings": warns, "tips": tips,
            "options": options, "need_confirm": need, "rate": rate,
            "month": {"spent_vnd": spent * rate, "budget_vnd": s["budget_month_vnd"], "after_vnd": after * rate, "pct_after": pct_after}}


def summary():
    s, p, rate = settings()
    mk = month_key()
    with db() as conn:
        by = [dict(r) for r in conn.execute("SELECT module, COUNT(*) n, SUM(usd) usd FROM spend WHERE month=? GROUP BY module ORDER BY usd DESC", (mk,)).fetchall()]
        recent = [dict(r) for r in conn.execute("SELECT at, module, action, usd, detail FROM spend ORDER BY id DESC LIMIT 30").fetchall()]
        months = [dict(r) for r in conn.execute("SELECT month, SUM(usd) usd FROM spend GROUP BY month ORDER BY month DESC LIMIT 6").fetchall()]
    spent = sum(x["usd"] for x in by)
    day = datetime.now().day
    import calendar
    dim = calendar.monthrange(datetime.now().year, datetime.now().month)[1]
    return {"month": mk, "spent_usd": spent, "spent_vnd": spent * rate, "budget_vnd": s["budget_month_vnd"],
            "pct": spent * rate / s["budget_month_vnd"] * 100 if s["budget_month_vnd"] else 0,
            "forecast_vnd": spent * rate / max(day, 1) * dim, "by_module": [{**x, "vnd": x["usd"] * rate} for x in by],
            "recent": [{**x, "vnd": x["usd"] * rate, "label": LABEL.get(x["action"], x["action"])} for x in recent],
            "months": [{**x, "vnd": x["usd"] * rate} for x in months], "settings": s, "prices": p, "rate": rate,
            "over": spent * rate >= s["budget_month_vnd"]}


def save_settings(b):
    s, p, rate = settings()
    for k in DEFAULT_BUDGET:
        if k in b and b[k] is not None and b[k] != "":
            s[k] = bool(b[k]) if isinstance(DEFAULT_BUDGET[k], bool) else type(DEFAULT_BUDGET[k])(float(b[k]))
    for k in DEFAULT_PRICES:
        if k in (b.get("prices") or {}) and b["prices"][k] not in (None, ""):
            p[k] = float(b["prices"][k])
    up = {"cost_budget": s, "cost_prices": p}
    if b.get("usd_vnd"):
        up["usd_vnd"] = float(b["usd_vnd"])
    save_config(up)
    return summary()


def handle(h, method, path):
    seg = path.split("/")[3:]
    try:
        if seg == ["summary"]:
            return h.send_json(summary())
        if method == "POST" and seg == ["estimate"]:
            b = h.read_json()
            return h.send_json(estimate(b.get("action"), b.get("params") or {}))
        if method == "POST" and seg == ["settings"]:
            return h.send_json(save_settings(h.read_json()))
        h.send_json({"error": "Không có trang này"}, 404)
    except (RuntimeError, ValueError) as e:
        h.send_json({"error": str(e)}, 400)
    return True
