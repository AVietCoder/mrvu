/* Mr.Vũ SEO Studio — báo giá trước khi dùng, sổ chi tiêu và ngân sách tháng (dùng chung cho mọi trang) */
(function () {
  const CG = { live: false, sum: null, ready: null };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vnd = v => { if (v == null) return '—'; if (v > 0 && v < 1) return '< 1 đ'; const r = v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v); return r.toLocaleString('vi-VN') + ' đ'; };
  const usd = v => (v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(v < 1 ? 3 : 2)).replace('.', ',') + ' USD';
  CG.vnd = vnd;

  /* ---------- CSS dùng token của từng trang ---------- */
  const css = `
  .cg-pill{margin-left:auto;align-self:center;font:inherit;font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
  .cg-pill i{width:8px;height:8px;border-radius:50%;background:var(--ok,var(--low,#2c7a4b))}
  .cg-pill.warn i{background:var(--warn,var(--mid,#9a6a12))} .cg-pill.bad i{background:var(--bad,var(--hi,#b9441a))}
  .cg-shade{position:fixed;inset:0;background:rgba(10,18,16,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px}
  .cg-card{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;width:min(560px,100%);max-height:calc(100% - 32px);overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.25)}
  .cg-card.wide{width:min(820px,100%)}
  .cg-h{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
  .cg-h h2{font-size:16px;margin:0}
  .cg-b{padding:16px 18px;display:flex;flex-direction:column;gap:14px}
  .cg-big{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
  .cg-sub{font-size:12px;color:var(--muted)}
  .cg-parts{margin:0;padding:0;list-style:none;font-size:13px;display:flex;flex-direction:column;gap:4px}
  .cg-parts li{display:flex;justify-content:space-between;gap:12px;color:var(--muted)} .cg-parts b{color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
  .cg-bar{height:8px;border-radius:4px;background:var(--sunk);overflow:hidden;position:relative;border:1px solid var(--line)}
  .cg-bar i{position:absolute;left:0;top:0;bottom:0;background:var(--accent)} .cg-bar u{position:absolute;top:0;bottom:0;background:var(--warn,var(--mid,#9a6a12));opacity:.7}
  .cg-w{border-radius:8px;padding:9px 12px;font-size:13px}
  .cg-w.bad{background:var(--bad-soft,var(--hi-soft,#fbe9e1));color:var(--bad,var(--hi,#b9441a))} .cg-w.warn{background:var(--warn-soft,var(--mid-soft,#f8efd9));color:var(--warn,var(--mid,#9a6a12))}
  .cg-tip{font-size:13px;color:var(--muted);border-left:3px solid var(--accent);padding:2px 0 2px 10px}
  .cg-opt{display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer} .cg-opt input{margin-top:2px;accent-color:var(--accent)}
  .cg-f{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line);flex-wrap:wrap}
  .cg-btn{font:inherit;font-weight:600;border-radius:8px;padding:8px 14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
  .cg-btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)} .cg-btn.danger{background:var(--bad,var(--hi,#b9441a));color:#fff;border-color:transparent}
  .cg-btn:focus-visible,.cg-pill:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .cg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px}
  .cg-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);font-weight:600}
  .cg-grid input[type=number],.cg-grid input[type=text]{font:inherit;font-size:14px;color:var(--ink);background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%;font-weight:400}
  .cg-t{width:100%;min-width:0!important;border-collapse:collapse;font-size:13px} .cg-t th,.cg-t td{position:static;background:none;vertical-align:middle} .cg-t td,.cg-t th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left} .cg-t th{font-size:12px;color:var(--muted)} .cg-t .n{text-align:right;font-variant-numeric:tabular-nums}
  .cg-tips{margin:0;padding-left:18px;font-size:13px;display:flex;flex-direction:column;gap:6px} .cg-tips b{color:var(--ink)}
  .cg-sec{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
  .cg-toast{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:8px;font-size:13px;z-index:61;max-width:calc(100% - 32px)}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- Dữ liệu mẫu cho bản xem trước ---------- */
  const P = { dfs_volume_task: .09, dfs_serp_page: .002, dfs_aio_extra: .002, dfs_paa_click: .00015, dfs_bl_request: .02, dfs_bl_row: .00003, dfs_labs_task: .01, dfs_labs_item: .0001, dfs_aiv_task: .01, dfs_aiv_item: .0001, dfs_llmm_task: .1, dfs_llmm_row: .001, dfs_llm_scrape: .004, dfs_llm_resp: .0006, llm_provider_est: .006, claude_in: 2, claude_out: 10 };
  const SET = { budget_month_vnd: 300000, confirm_over_vnd: 5000, warn_pct: 80, auto_stop: true, rank_recent_days: 6, geo_recent_days: 7, bl_recent_days: 7, tp_recent_days: 30, aiq_recent_days: 14, smap_recent_days: 7 };
  const AIT = { audit_ai: [5000, 1500], geo: [12000, 2000], ai_outreach: [4000, 900], gsc_title: [1500, 600], gsc_plan: [8000, 5000], gsc_report: [12000, 3000], topics: [14000, 6000], aiq_discover: [16000, 9000], aiq_advise: [7000, 2200], aiq_plan: [14000, 6000], smap_page: [6000, 1800], smap_place: [3000, 400], smap_report: [9000, 2500] };
  const LABEL = { volume: 'Tra volume', rank: 'Quét thứ hạng', audit_ai: 'Gợi ý AI cho trang', autopost_write: 'AI viết bài', geo: 'Phân tích AI Overview', bl_refresh: 'Cập nhật backlink', bl_gap: 'Tìm cơ hội từ đối thủ', bl_examples: 'Xem link mẫu của đối thủ', ai_outreach: 'AI soạn tin xin link', gsc_title: 'AI viết lại title', gsc_plan: 'AI lập kế hoạch nội dung', gsc_report: 'AI viết báo cáo tư vấn', topics: 'Phân tích gợi ý chủ đề', aiq_discover: 'Tìm câu hỏi người dùng hỏi AI', aiq_check: 'Kiểm tra câu trả lời của AI', aiq_advise: 'AI tư vấn tối ưu câu hỏi', aiq_plan: 'AI lập kế hoạch GEO', smap_cycle: 'Phân tích toàn website', smap_report: 'AI báo cáo website', smap_page: 'AI tư vấn một trang', smap_place: 'AI tìm vị trí đặt link' };
  const RATE = 26000;
  let demoSpent = 1.84; // USD đã dùng trong tháng (mẫu)
  function demoSummary() {
    const by = [['Autopost', 18, .97], ['Rank Tracker', 4, .41], ['AI Overview', 6, .29], ['Search Console', 5, .1], ['Tra cứu Volume', 3, .27], ['Audit On-page', 4, .08]].map(([module, n, u]) => ({ module, n, usd: u, vnd: u * RATE }));
    const s = by.reduce((a, b) => a + b.usd, 0) + (demoSpent - 2.12);
    const d = new Date(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { month: d.toISOString().slice(0, 7), spent_usd: s, spent_vnd: s * RATE, budget_vnd: SET.budget_month_vnd, pct: s * RATE / SET.budget_month_vnd * 100, forecast_vnd: s * RATE / d.getDate() * dim,
      by_module: by, recent: [['Autopost', 'autopost_write', .061], ['AI Overview', 'geo', .047], ['Rank Tracker', 'rank', .06], ['Tra cứu Volume', 'volume', .09], ['Search Console', 'gsc_report', .052]].map(([module, action, u], i) => ({ at: new Date(Date.now() - i * 5e6).toISOString(), module, action, label: LABEL[action], usd: u, vnd: u * RATE, detail: '' })),
      months: [], settings: SET, prices: P, rate: RATE, over: false, demo: true };
  }
  function ai(i, o) { return (i * P.claude_in + o * P.claude_out) / 1e6 }
  function demoEstimate(action, prm) {
    const parts = [], warnings = [], tips = [], options = []; let u = 0; const add = (l, v) => { u += v; parts.push({ label: l, usd: v }) };
    if (action === 'volume') { const n = prm.count || 0, t = Math.max(1, Math.ceil(n / 1000)); add(`${t} lần tra × 0,09 USD (tính theo lần, tối đa 1.000 từ/lần)`, t * P.dfs_volume_task); if (n && n < 200) tips.push(`Giá tính theo lần tra chứ không theo số từ: tra ${n} từ hay 1.000 từ đều tốn như nhau. Nên gom thêm từ khóa rồi tra một lần.`) }
    else if (action === 'rank') { const n = prm.count || 0, e = 1, pg = Math.ceil((prm.depth || 10) / 10), per = pg * P.dfs_serp_page; add(`${n} từ × ${pg} trang kết quả Google × 0,002 USD`, n * per);
      if (prm.recent) options.push({ id: 'skipRecent', checked: true, saving_usd: prm.recent * e * per, label: `Bỏ qua ${prm.recent} từ đã quét trong ${SET.rank_recent_days} ngày gần đây` });
      if (pg > 1) tips.push(`Quét Top ${prm.depth} tốn gấp ${pg} lần Top 10. Chỉ nên quét sâu với từ còn xa top; từ đã ở top 10 thì quét Top 10.`); }
    else if (action === 'geo') { add('Kết quả Google + AI Overview (DataForSEO)', P.dfs_serp_page + P.dfs_aio_extra + P.dfs_paa_click); add('Claude so sánh và viết đề xuất (ước tính)', ai(...AIT.geo));
      if (prm.recent_days != null && prm.recent_days < SET.geo_recent_days) warnings.push({ level: 'warn', text: `URL và từ khóa này vừa phân tích ${prm.recent_days ? prm.recent_days + ' ngày trước' : 'hôm nay'}. AI Overview ít thay đổi trong vài ngày, nên mở lại báo cáo cũ trong Lịch sử.` });
      tips.push('Từ khóa mua hàng (giá, mua, tên sản phẩm) hiếm khi có AI Overview; khi đó công cụ không gọi AI nên chỉ tốn phần dữ liệu Google.') }
    else if (action === 'autopost_write') { const w = prm.words || 1200; add(`Claude lập dàn ý + viết bài ~${w.toLocaleString('vi-VN')} chữ (ước tính)`, ai(5500, Math.round(w * 3.2) + 900)); if (w >= 2500) tips.push('Bài 2.500 chữ tốn gấp đôi bài 1.200 chữ. Chỉ viết dài cho chủ đề thật sự cần.') }
    else if (action === 'bl_refresh') { add('4 lần gọi Backlinks API', 4 * P.dfs_bl_request); add('Khoảng 2.000 dòng dữ liệu', 2200 * P.dfs_bl_row); if (prm.days_since != null && prm.days_since < SET.bl_recent_days) warnings.push({ level: 'warn', text: `Lần cập nhật trước ${prm.days_since ? 'mới cách ' + prm.days_since + ' ngày' : 'là hôm nay'}. Backlink thay đổi chậm; cập nhật mỗi tuần hoặc mỗi tháng là đủ.` }); tips.push('Muốn miễn phí: nhập file CSV từ Google Search Console thay vì cập nhật qua API.') }
    else if (action === 'bl_gap') { const c = prm.competitors || 1; add(`${c} đối thủ × (1 lần gọi + tối đa 1.000 dòng)`, c * (P.dfs_bl_request + 1000 * P.dfs_bl_row)) }
    else if (action === 'bl_examples') { const c = Math.min(3, prm.competitors || 1); add(`${c} lần tìm link mẫu`, c * (P.dfs_bl_request + 5 * P.dfs_bl_row)) }
    else if (action === 'topics') { const c = Math.max(0, Math.min(3, prm.competitors || 0)); let data = 0;
      if ((prm.mode || 'full') !== 'free') { const sd = 2 * (P.dfs_labs_task + 150 * P.dfs_labs_item), cp = c * (P.dfs_labs_task + 300 * P.dfs_labs_item), mi = P.dfs_labs_task + 300 * P.dfs_labs_item;
        add('Từ khóa liên quan đến chủ đề (2 lần gọi DataForSEO)', sd); if (c) add(`Từ khóa đối thủ đang lên Top: ${c} đối thủ × tối đa 300 từ`, cp); add('Từ khóa website của bạn đang có thứ hạng', mi); data = sd + cp + mi }
      parts.push({ label: `Đọc sitemap ${c} đối thủ + website của bạn + Search Console`, usd: 0 }); add('Claude gom nhóm, chấm điểm, gợi ý góc viết (ước tính)', ai(...AIT.topics));
      if (data) options.push({ id: 'free_mode', checked: false, saving_usd: data, label: 'Chế độ tiết kiệm: bỏ dữ liệu volume, chỉ đọc sitemap đối thủ và Search Console' });
      if (prm.recent_days != null && prm.recent_days < SET.tp_recent_days) warnings.push({ level: 'warn', text: `Đã phân tích chủ đề này với cùng đối thủ ${prm.recent_days ? prm.recent_days + ' ngày trước' : 'hôm nay'}. Đối thủ ít thay đổi trong vài tuần, nên mở lại kết quả cũ ở mục Lần phân tích trước.` });
      tips.push('Kết quả được lưu lại: mở lại lần phân tích cũ không tốn thêm tiền. Mỗi chủ đề phân tích 1 lần/tháng là đủ.') }
    else if (action === 'aiq_discover') { const n = Math.max(1, prm.topics || 1), q = prm.serp_per_topic || 4;
      add(`Câu hỏi Google (People Also Ask, tìm kiếm liên quan): ${n} lĩnh vực × ${q} lần tìm`, n * q * (P.dfs_serp_page + P.dfs_aio_extra + 4 * P.dfs_paa_click));
      if (prm.labs !== false) add(`Gợi ý từ khóa dạng câu hỏi: ${n} lĩnh vực`, n * (P.dfs_labs_task + 300 * P.dfs_labs_item));
      const mm = n * (P.dfs_llmm_task + 100 * P.dfs_llmm_row); if (prm.mentions !== false) add(`Câu hỏi trên AI có nhắc lĩnh vực (LLM Mentions): ${n} lần × tối đa 100 dòng`, mm);
      if (prm.ai_volume !== false) add('Lượng tìm kiếm trên AI cho tối đa 300 câu', P.dfs_aiv_task + 300 * P.dfs_aiv_item);
      parts.push({ label: 'Câu hỏi từ Search Console của bạn', usd: 0 }); add('Claude bổ sung câu hỏi theo từng kiểu khách, gom nhóm, chấm ưu tiên (ước tính)', ai(...AIT.aiq_discover));
      if (prm.mentions !== false) options.push({ id: 'no_mentions', checked: false, saving_usd: mm, label: 'Bỏ nguồn LLM Mentions (dữ liệu Việt Nam có thể ít)' }) }
    else if (action === 'aiq_check') { const n = prm.questions || 0, pls = prm.platforms || ['chatgpt', 'gemini', 'perplexity', 'google'];
      const per = { chatgpt: ['ChatGPT', P.dfs_llm_scrape], gemini: ['Gemini', P.dfs_llm_scrape], perplexity: ['Perplexity', P.dfs_llm_resp + P.llm_provider_est], google: ['Google AI Overview', P.dfs_serp_page + P.dfs_aio_extra] };
      pls.forEach(k => { if (per[k]) add(`${per[k][0]}: ${n} câu hỏi`, n * per[k][1]) }); parts.push({ label: 'Dò thương hiệu, nguồn trích dẫn trong câu trả lời (tại máy)', usd: 0 });
      if (prm.recent_days != null && prm.recent_days < SET.aiq_recent_days) warnings.push({ level: 'warn', text: `Lần kiểm tra trước ${prm.recent_days ? 'mới cách ' + prm.recent_days + ' ngày' : 'là hôm nay'}. Câu trả lời của AI thay đổi theo tuần; kiểm tra 2–4 tuần một lần là đủ để thấy xu hướng.` });
      tips.push('Mỗi lần kiểm tra chỉ chọn các câu hỏi đang theo dõi (ưu tiên cao). Kết quả lưu lại để so sánh theo thời gian.') }
    else if (action === 'aiq_advise') { const n = Math.max(1, prm.questions || 1); add(`Claude tư vấn tối ưu ${n} câu hỏi (ước tính)`, n * ai(...AIT.aiq_advise)) }
    else if (action === 'smap_cycle') { const n = prm.pages || 300, an = prm.ai_pages != null ? prm.ai_pages : n;
      parts.push({ label: `Quét ${n} trang, liên kết nội bộ, chấm điểm SEO/GEO (tại máy)`, usd: 0 }); parts.push({ label: 'Search Console, GA4, kiểm tra index, tốc độ PageSpeed (Google, miễn phí)', usd: 0 });
      if (prm.labs !== false) add('Từ khóa website đang có thứ hạng (DataForSEO Labs, tối đa 1.000 từ)', P.dfs_labs_task + 1000 * P.dfs_labs_item);
      if (an) add(`Claude gán từ khóa, nhóm chủ đề cho ${an} trang (ước tính)`, an * ai(180, 115)); add('Claude viết báo cáo và việc cần làm (ước tính)', ai(...AIT.smap_report));
      if (prm.recent_days != null && prm.recent_days < SET.smap_recent_days) warnings.push({ level: 'warn', text: `Lần phân tích trước ${prm.recent_days ? 'mới cách ' + prm.recent_days + ' ngày' : 'là hôm nay'}. Số liệu Search Console thay đổi chậm; phân tích mỗi 2–4 tuần là hợp lý.` });
      tips.push('Lần phân tích sau chỉ gán lại từ khóa cho trang mới, nên rẻ hơn nhiều. Chọn "Gán lại toàn bộ" khi đổi chiến lược từ khóa.') }
    else add(LABEL[action] + ' (ước tính)', ai(...AIT[action]));
    const spent = demoSummary().spent_usd, bu = SET.budget_month_vnd / RATE, after = spent + u, pct = after / bu * 100, v = u * RATE;
    if (after > bu) warnings.unshift({ level: 'bad', text: 'Lần này sẽ làm vượt ngân sách tháng.' }); else if (pct >= SET.warn_pct) warnings.unshift({ level: 'warn', text: `Sau lần này đã dùng ${pct.toFixed(0)}% ngân sách tháng.` });
    if (v >= SET.confirm_over_vnd * 4) warnings.unshift({ level: 'bad', text: `Chi phí lần này lớn: gấp ${(v / SET.confirm_over_vnd).toFixed(0)} lần ngưỡng hỏi trước bạn đặt.` });
    return { action, label: LABEL[action], usd: u, vnd: v, parts, warnings, tips, options, rate: RATE, need_confirm: v >= SET.confirm_over_vnd || warnings.length > 0 || options.length > 0,
      month: { spent_vnd: spent * RATE, budget_vnd: SET.budget_month_vnd, after_vnd: after * RATE, pct_after: pct } };
  }

  /* ---------- Gọi máy chủ ---------- */
  async function http(path, opts) { const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {})); const j = await r.json().catch(() => ({ error: 'Phản hồi không hợp lệ' })); if (!r.ok || j.error) throw new Error(j.error || ('Lỗi ' + r.status)); return j }
  CG.ready = (async () => { try { const c = new AbortController(); setTimeout(() => c.abort(), 20000); const j = await (await fetch('api/health', { signal: c.signal })).json(); CG.live = !!(j && j.ok) } catch (e) { CG.live = false } })();
  CG.quote = async (action, params) => { await CG.ready; return CG.live ? http('api/cost/estimate', { method: 'POST', body: JSON.stringify({ action, params: params || {} }) }) : demoEstimate(action, params || {}) };
  CG.summary = async () => { await CG.ready; CG.sum = CG.live ? await http('api/cost/summary') : demoSummary(); return CG.sum };

  function toast(m) { let t = $('.cg-toast'); if (!t) { t = document.createElement('div'); t.className = 'cg-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t) } t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600) }

  function modal(html, wide) {
    const sh = document.createElement('div'); sh.className = 'cg-shade';
    sh.innerHTML = `<div class="cg-card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(sh); const prev = document.activeElement;
    const close = () => { sh.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus() };
    const onKey = e => { if (e.key === 'Escape') { sh.dispatchEvent(new CustomEvent('cg-cancel')); close() } };
    document.addEventListener('keydown', onKey);
    return { el: sh, close };
  }

  /* ---------- Hộp xác nhận trước khi dùng ---------- */
  CG.check = async (action, params, opts) => {
    opts = opts || {};
    let est;
    try { est = await CG.quote(action, params) } catch (e) { toast('Không ước tính được chi phí: ' + e.message); return { ok: true, options: {} } }
    if (!est.need_confirm && !opts.always) { toast(`${est.label}: chi phí ước tính ${vnd(est.vnd)}`); return { ok: true, options: {}, est } }
    return new Promise(resolve => {
      const m = est.month, bad = est.warnings.some(w => w.level === 'bad');
      const html = `<div class="cg-h"><h2>Chi phí ước tính · ${esc(est.label)}</h2></div>
        <div class="cg-b">
          <div><div class="cg-big" id="cgTotal">${vnd(est.vnd)}</div><div class="cg-sub" id="cgUsd">≈ ${usd(est.usd)} · tỷ giá ${est.rate.toLocaleString('vi-VN')} đ</div></div>
          <ul class="cg-parts">${est.parts.map(p => `<li><span>${esc(p.label)}</span><b>${vnd(p.usd * est.rate)}</b></li>`).join('')}</ul>
          ${est.options.map(o => `<label class="cg-opt"><input type="checkbox" data-opt="${esc(o.id)}" data-save="${o.saving_usd}" ${o.checked ? 'checked' : ''}><span>${esc(o.label)} <b>(tiết kiệm ${vnd(o.saving_usd * est.rate)})</b></span></label>`).join('')}
          <div><div class="cg-sub" style="display:flex;justify-content:space-between;margin-bottom:5px"><span>Đã dùng tháng này ${vnd(m.spent_vnd)}</span><span>Ngân sách ${vnd(m.budget_vnd)}</span></div>
            <div class="cg-bar"><i style="width:${Math.min(100, m.spent_vnd / m.budget_vnd * 100)}%"></i><u id="cgAdd" style="left:${Math.min(100, m.spent_vnd / m.budget_vnd * 100)}%;width:${Math.max(0, Math.min(100 - m.spent_vnd / m.budget_vnd * 100, est.vnd / m.budget_vnd * 100))}%"></u></div>
            <div class="cg-sub" id="cgAfter" style="margin-top:5px">Sau lần này: ${vnd(m.after_vnd)} (${m.pct_after.toFixed(0)}% ngân sách)</div></div>
          ${est.warnings.map(w => `<div class="cg-w ${w.level}">${esc(w.text)}</div>`).join('')}
          ${est.tips.map(t => `<div class="cg-tip">${esc(t)}</div>`).join('')}
        </div>
        <div class="cg-f"><button class="cg-btn" data-a="cancel">Hủy</button><button class="cg-btn ${bad ? 'danger' : 'primary'}" data-a="ok">${bad ? 'Vẫn tiếp tục' : 'Tiếp tục'}</button></div>`;
      const md = modal(html);
      const upd = () => { let save = 0; md.el.querySelectorAll('[data-opt]').forEach(c => { if (c.checked) save += +c.dataset.save }); const u = Math.max(0, est.usd - save);
        md.el.querySelector('#cgTotal').textContent = vnd(u * est.rate); md.el.querySelector('#cgUsd').textContent = `≈ ${usd(u)} · tỷ giá ${est.rate.toLocaleString('vi-VN')} đ`;
        const after = m.spent_vnd + u * est.rate; md.el.querySelector('#cgAfter').textContent = `Sau lần này: ${vnd(after)} (${(after / m.budget_vnd * 100).toFixed(0)}% ngân sách)`;
        md.el.querySelector('#cgAdd').style.width = Math.max(0, Math.min(100 - m.spent_vnd / m.budget_vnd * 100, u * est.rate / m.budget_vnd * 100)) + '%' };
      md.el.addEventListener('change', upd); upd();
      const done = ok => { const o = {}; md.el.querySelectorAll('[data-opt]').forEach(c => o[c.dataset.opt] = c.checked); md.close(); resolve({ ok, options: o, est }) };
      md.el.addEventListener('cg-cancel', () => resolve({ ok: false, options: {}, est }));
      md.el.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === 'ok'); else if (e.target === md.el) done(false) });
      setTimeout(() => md.el.querySelector(bad ? '[data-a=cancel]' : '[data-a=ok]').focus(), 0);
    });
  };

  /* Ghi giá ước tính lên nút: CostGuard.label(button, 'rank', {...}, 'Quét mục đã chọn') */
  CG.label = async (btn, action, params, text) => { if (!btn) return; try { const e = await CG.quote(action, params); btn.textContent = `${text} · ~${vnd(e.vnd)}`; btn.title = `Chi phí ước tính ${vnd(e.vnd)} (${usd(e.usd)})` } catch (e) { btn.textContent = text } };

  /* ---------- Huy hiệu ngân sách + bảng chi tiêu ---------- */
  async function pill() {
    const nav = $('.nav'); if (!nav) return;
    let b = $('.cg-pill'); if (!b) { b = document.createElement('button'); b.className = 'cg-pill'; b.type = 'button'; b.addEventListener('click', panel); nav.appendChild(b) }
    try { const s = await CG.summary(); const pct = s.pct; b.className = 'cg-pill' + (s.over ? ' bad' : pct >= s.settings.warn_pct ? ' warn' : '');
      b.innerHTML = `<i></i>Chi phí tháng: ${vnd(s.spent_vnd)} / ${vnd(s.budget_vnd)}`; b.title = 'Xem chi tiêu và cài đặt ngân sách' } catch (e) { b.innerHTML = '<i></i>Chi phí' }
  }
  CG.after = () => setTimeout(pill, 400);

  const TIPS = s => [
    ['Rank Tracker mặc định quét Top 10 (chỉ theo dõi Google)', 'Rẻ hơn 3–5 lần so với quét Top 30–50. Chỉ quét sâu cho từ còn xa top.'],
    [`Bỏ qua từ khóa đã quét trong ${s.rank_recent_days} ngày`, 'Thứ hạng thay đổi theo tuần; quét lại hằng ngày chủ yếu tốn tiền.'],
    ['Nhắc gom từ khóa khi tra volume', 'Giá tính theo lần tra (tối đa 1.000 từ), không theo số từ.'],
    [`Cảnh báo phân tích AI Overview trùng trong ${s.geo_recent_days} ngày`, 'Kết quả cũ được lưu trong Lịch sử, mở lại miễn phí. Từ khóa không có AI Overview thì không gọi AI.'],
    [`Cảnh báo cập nhật backlink dày hơn ${s.bl_recent_days} ngày`, 'Backlink thay đổi chậm. Dùng file Search Console nếu muốn miễn phí hoàn toàn.'],
    [`Cảnh báo phân tích gợi ý chủ đề trùng trong ${s.tp_recent_days ?? 30} ngày`, 'Kết quả lưu lại, mở lại miễn phí. Chế độ tiết kiệm chỉ đọc sitemap đối thủ và Search Console, không tốn tiền dữ liệu.'],
    [`Cảnh báo kiểm tra câu trả lời AI lặp lại trong ${s.aiq_recent_days ?? 14} ngày`, 'Câu trả lời của AI thay đổi theo tuần; kiểm tra 2–4 tuần một lần là đủ. Chỉ kiểm tra câu hỏi đang theo dõi.'],
    [`Hỏi trước mỗi lần dùng từ ${vnd(s.confirm_over_vnd)}`, `Cảnh báo khi dùng ${s.warn_pct}% ngân sách; báo đỏ khi vượt.`],
    [s.auto_stop ? 'Tự dừng lịch Autopost khi vượt ngân sách' : 'Lịch Autopost vẫn chạy khi vượt ngân sách (đang tắt tự dừng)', 'Viết bài là khoản tốn nhất khi chạy tự động.'],
    ['Lưu lại mọi kết quả AI', 'Gợi ý title, báo cáo, phân tích GEO, tin xin link đều lưu; xem lại không tốn phí.'],
  ];
  async function panel() {
    const s = await CG.summary(); const S = s.settings, mx = Math.max(1, ...s.by_module.map(x => x.vnd));
    const html = `<div class="cg-h"><h2>Chi phí & ngân sách · tháng ${esc(s.month.slice(5))}/${esc(s.month.slice(0, 4))}</h2><button class="cg-btn" data-a="close">Đóng</button></div>
      <div class="cg-b">
        ${s.demo ? '<div class="cg-w warn">Bản xem trước — số liệu mẫu. Bản cài trên máy ghi chi phí thật của từng lần gọi DataForSEO và Claude.</div>' : ''}
        <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end">
          <div><div class="cg-big">${vnd(s.spent_vnd)}</div><div class="cg-sub">đã dùng / ngân sách ${vnd(s.budget_vnd)} (${s.pct.toFixed(0)}%)</div></div>
          <div><div style="font-size:18px;font-weight:700">${vnd(s.forecast_vnd)}</div><div class="cg-sub">dự kiến cả tháng nếu dùng như hiện tại</div></div></div>
        <div class="cg-bar"><i style="width:${Math.min(100, s.pct)}%;${s.over ? 'background:var(--bad,var(--hi))' : ''}"></i></div>
        ${s.over ? `<div class="cg-w bad">Đã vượt ngân sách tháng.${S.auto_stop ? ' Lịch Autopost tự động đang tạm dừng.' : ''}</div>` : s.pct >= S.warn_pct ? `<div class="cg-w warn">Đã dùng ${s.pct.toFixed(0)}% ngân sách tháng.</div>` : ''}
        <div class="cg-sec">Theo công cụ</div>
        ${s.by_module.length ? `<table class="cg-t"><tbody>${s.by_module.map(x => `<tr><td>${esc(x.module)}</td><td style="width:40%"><div class="cg-bar" style="height:6px"><i style="width:${x.vnd / mx * 100}%"></i></div></td><td class="n">${x.n} lần</td><td class="n"><b>${vnd(x.vnd)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="cg-sub">Chưa có chi phí nào trong tháng.</div>'}
        ${s.recent.length ? `<div class="cg-sec">Gần đây</div><table class="cg-t"><tbody>${s.recent.slice(0, 10).map(x => `<tr><td class="cg-sub">${new Date(x.at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(x.module)} · ${esc(x.label)}</td><td class="n">${vnd(x.vnd)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="cg-sec">Cài đặt ngân sách</div>
        <div class="cg-grid">
          <label>Ngân sách mỗi tháng (đ)<input type="number" min="0" step="10000" id="cgBudget" value="${S.budget_month_vnd}"></label>
          <label>Hỏi trước khi một lần dùng từ (đ)<input type="number" min="0" step="1000" id="cgConfirm" value="${S.confirm_over_vnd}"></label>
          <label>Cảnh báo khi dùng đến (%)<input type="number" min="10" max="100" step="5" id="cgWarn" value="${S.warn_pct}"></label>
          <label>Bỏ qua từ vừa quét trong (ngày)<input type="number" min="0" max="30" id="cgRank" value="${S.rank_recent_days}"></label>
          <label>Cảnh báo GEO trùng trong (ngày)<input type="number" min="0" max="60" id="cgGeo" value="${S.geo_recent_days}"></label>
          <label>Cảnh báo cập nhật backlink trong (ngày)<input type="number" min="0" max="60" id="cgBl" value="${S.bl_recent_days}"></label>
          <label>Số trang tối đa mỗi lần quét website<input type="number" min="10" max="5000" step="10" id="cgCrawl" value="${S.crawl_max_pages ?? 2000}"></label>
          <label>Số bài lịch tự động tối đa mỗi ngày (mọi website)<input type="number" min="0" max="100" id="cgApMax" value="${S.autopost_daily_max ?? 10}"></label>
          <label>Cảnh báo gợi ý chủ đề trùng trong (ngày)<input type="number" min="0" max="90" id="cgTp" value="${S.tp_recent_days ?? 30}"></label>
          <label>Tỷ giá USD → VND<input type="number" min="1000" step="100" id="cgRate" value="${s.rate}"></label>
          <label style="flex-direction:row;align-items:center;gap:8px;color:var(--ink)"><input type="checkbox" id="cgStop" ${S.auto_stop ? 'checked' : ''} style="accent-color:var(--accent)"> Tự dừng lịch Autopost khi vượt ngân sách</label>
        </div>
        <details><summary class="cg-sub" style="cursor:pointer">Bảng giá đang dùng (chỉnh khi nhà cung cấp đổi giá hoặc bạn đổi model AI)</summary>
          <div class="cg-grid" style="margin-top:10px">${[['dfs_volume_task', 'Tra volume / lần (USD)'], ['dfs_serp_page', 'Thứ hạng / trang 10 kết quả'], ['dfs_aio_extra', 'Thêm AI Overview / lần'], ['dfs_bl_request', 'Backlinks / lần gọi'], ['dfs_bl_row', 'Backlinks / dòng'], ['dfs_labs_task', 'Gợi ý chủ đề / lần gọi'], ['dfs_labs_item', 'Gợi ý chủ đề / dòng'], ['dfs_llm_scrape', 'Hỏi ChatGPT/Gemini / câu'], ['llm_provider_est', 'Phí Perplexity ước tính / câu'], ['dfs_llmm_task', 'LLM Mentions / lần gọi'], ['dfs_aiv_task', 'Lượng tìm kiếm AI / lần gọi'], ['claude_in', 'Claude đầu vào / 1 triệu token'], ['claude_out', 'Claude đầu ra / 1 triệu token']]
            .map(([k, l]) => `<label>${l}<input type="text" inputmode="decimal" data-price="${k}" value="${s.prices[k]}"></label>`).join('')}</div></details>
        <div class="cg-sec">Mẹo tiết kiệm đã cài mặc định</div>
        <ol class="cg-tips">${TIPS(S).map(([a, b]) => `<li><b>${esc(a)}.</b> ${esc(b)}</li>`).join('')}</ol>
      </div>
      <div class="cg-f"><span class="cg-sub" id="cgMsg" style="margin-right:auto;align-self:center"></span><button class="cg-btn" data-a="close">Đóng</button><button class="cg-btn primary" data-a="save">Lưu cài đặt</button></div>`;
    const md = modal(html, true);
    md.el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a && e.target !== md.el) return; if (!a || a.dataset.a === 'close') { md.close(); return }
      const prices = {}; md.el.querySelectorAll('[data-price]').forEach(i => prices[i.dataset.price] = parseFloat(String(i.value).replace(',', '.')));
      const body = { budget_month_vnd: +md.el.querySelector('#cgBudget').value, confirm_over_vnd: +md.el.querySelector('#cgConfirm').value, warn_pct: +md.el.querySelector('#cgWarn').value,
        rank_recent_days: +md.el.querySelector('#cgRank').value, geo_recent_days: +md.el.querySelector('#cgGeo').value, bl_recent_days: +md.el.querySelector('#cgBl').value, tp_recent_days: +md.el.querySelector('#cgTp').value,
        crawl_max_pages: +md.el.querySelector('#cgCrawl').value, autopost_daily_max: +md.el.querySelector('#cgApMax').value,
        auto_stop: md.el.querySelector('#cgStop').checked, usd_vnd: +md.el.querySelector('#cgRate').value, prices };
      if (!CG.live) { Object.assign(SET, body); md.close(); toast('Đã lưu (bản xem trước)'); pill(); return }
      try { await http('api/cost/settings', { method: 'POST', body: JSON.stringify(body) }); md.close(); toast('Đã lưu cài đặt chi phí'); pill() } catch (err) { md.el.querySelector('#cgMsg').textContent = err.message }
    });
  }
  CG.openPanel = panel;
  /* ---------- Tài khoản đăng nhập ---------- */
  const _fetch = window.fetch.bind(window);
  window.fetch = async (...a) => { const r = await _fetch(...a); if (r.status === 401) { try { const j = await r.clone().json(); if (j && j.login) location.href = 'auth/login?m=expired&next=' + encodeURIComponent(location.pathname + location.search) } catch (e) {} } return r };
  async function who() { try { const r = await _fetch('auth/me'); if (!r.ok) return; const j = await r.json(); if (!j.enabled || !j.user) return; const nav = $('.nav'); if (!nav || $('.cg-user')) return;
    const u = document.createElement('span'); u.className = 'cg-user'; u.style.cssText = 'align-self:center;display:inline-flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);white-space:nowrap';
    u.innerHTML = `${j.user.picture ? `<img src="${esc(j.user.picture)}" alt="" width="22" height="22" style="border-radius:50%" referrerpolicy="no-referrer">` : ''}<span title="${esc(j.user.email)}">${esc(j.user.email)}</span><a href="auth/logout" style="color:var(--accent);font-weight:600;text-decoration:none">Đăng xuất</a>`;
    nav.appendChild(u) } catch (e) {} }
  CG.settings = async () => (await CG.summary()).settings;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { pill(); who() }); else { pill(); who() }
  window.CostGuard = CG;
})();
