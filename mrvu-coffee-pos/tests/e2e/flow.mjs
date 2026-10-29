// Kiểm thử luồng bán mang đi nhanh trên trình duyệt thật với REST giả lập CÓ TRẠNG THÁI (không phải Supabase thật).
// Chạy: node tests/e2e/flow.mjs <baseUrl>. Kiểm: số thao tác, thêm món liên tục, chống thu trùng, chuyển khoản, máy in lỗi, mất mạng, màn hình pha chế.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.argv[2] ?? 'http://localhost:4173'
const SB = 'http://sb.test'
const uid = '00000000-0000-0000-0000-000000000001', store = '00000000-0000-0000-0000-0000000000aa'
const session = { access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: uid, email: 'o@x.vn', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } }
const perms = ['pos.use', 'order.create', 'order.pay', 'order.cancel', 'order.refund', 'order.reprint', 'price.edit', 'discount.apply', 'settings.manage', 'reports.view', 'shift.manage']
const products = [
  { id: 'p1', store_id: store, category_id: 'c1', code: 'CF02', name: 'Cà phê sữa', price: 25000, is_active: true, sort_order: 1, image_url: null,
    product_variants: [{ id: 'vM', product_id: 'p1', name: 'Size M', price: 25000, is_active: true, sort_order: 1 }, { id: 'vL', product_id: 'p1', name: 'Size L', price: 30000, is_active: true, sort_order: 2 }],
    product_modifiers: [{ modifier_id: 'mdA' }] },
  { id: 'p2', store_id: store, category_id: 'c1', code: 'CF01', name: 'Cà phê đen', price: 20000, is_active: true, sort_order: 2, image_url: null, product_variants: [], product_modifiers: [] },
]
const modifiers = [{ id: 'mdA', name: 'Mức đá', min_select: 0, max_select: 1, sort_order: 1, modifier_options: [{ id: 'oA', modifier_id: 'mdA', name: 'Ít đá', price_delta: 0, is_active: true, sort_order: 1 }] }]
const price = (it) => (it.variant_id === 'vL' ? 30000 : products.find((p) => p.id === it.product_id).price)
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

const results = []
const problems = []
const check = (scenario, name, ok, detail = '') => { results.push({ scenario, name, ok }); console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`); if (!ok) problems.push(`${scenario}: ${name} ${detail}`) }

const browser = await chromium.launch()

async function scenario(name, { printMethod = 'simulator', kitchen = false, payFails = false } = {}, body) {
  console.log(name)
  const st = { seq: 0, saveCalls: 0, payCalls: 0, payBodies: [], orders: {}, jobs: {}, jobSeq: 0, prepCalls: [] }
  const settings = { method: printMethod, printer_name: 'XP-58', paper_width: 58, auto_print: true, allow_reprint: true, margin_mm: 2, font_size: 12, copies: 1, kitchen_enabled: kitchen, kitchen_printer_name: '' }
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-sb-auth-token', JSON.stringify(s)), [session])
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const t = u.pathname.split('/').pop(); const method = req.method()
    const accept = req.headers()['accept'] ?? ''; const single = accept.includes('vnd.pgrst.object')
    const send = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
    const pick = (b) => (single ? (Array.isArray(b) ? (b[0] ?? null) : b) : b)
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const payload = () => { try { return JSON.parse(req.postData() ?? '{}') } catch { return {} } }
    if (t === 'rpc_save_order') {
      const p = payload(); st.saveCalls++; st.seq++
      const total = p.p_items.reduce((s, it) => s + price(it) * it.quantity, 0)
      const id = `o${st.seq}`; const code = `261028-${String(st.seq).padStart(4, '0')}`
      st.orders[id] = { id, code, type: p.p_type, note: '', created_at: new Date().toISOString(), status: 'open', prep_status: 'queued', total, tables: null,
        order_items: p.p_items.map((it, i) => ({ id: `i${st.seq}${i}`, name_snapshot: products.find((x) => x.id === it.product_id).name, variant_snapshot: it.variant_id === 'vL' ? 'Size L' : it.variant_id === 'vM' ? 'Size M' : null, quantity: it.quantity, note: it.note, order_item_modifiers: [] })) }
      return send({ id, code, version: 1, status: 'open', total })
    }
    if (t === 'rpc_pay_order') {
      const p = payload(); st.payCalls++; st.payBodies.push(p)
      await new Promise((r) => setTimeout(r, 400))
      if (payFails) return route.abort('connectionfailed')
      const o = st.orders[p.p_order_id]; o.status = 'paid'; o.prep_status = 'queued'
      return send({ order_id: o.id, receipt_id: `r-${o.id}`, receipt_no: `HD-${o.code}`, replayed: false })
    }
    if (t === 'rpc_set_prep_status') { const p = payload(); st.prepCalls.push(p); st.orders[p.p_order].prep_status = p.p_status; return send({}) }
    if (t === 'receipts') return send(pick([{ id: 'r-x', issued_at: new Date().toISOString(), snapshot: { receipt_no: 'HD-1', order_code: '261028-0001', type: 'takeaway', table: null, cashier: 'Chủ quán', customer: null,
      store: { name: 'Quán thử', address: '', phone: '', footer_note: '' }, items: [{ name: 'Cà phê đen', variant: null, quantity: 1, unit_price: 20000, note: '', line_total: 20000, modifiers: [] }],
      subtotal: 20000, discount: 0, surcharge: 0, total: 20000, payments: [{ method_name: 'Tiền mặt', amount: 20000, tendered: 20000, change: 0 }] } }]))
    if (t === 'receipt_print_jobs') {
      if (method === 'POST') { const p = payload(); const id = `j${++st.jobSeq}`; st.jobs[id] = { attempts: 0, error: null, reason: null, receipt_id: null, order_id: null, created_at: new Date().toISOString(), ...p, id }; return send(pick([st.jobs[id]]), 201) }
      if (method === 'PATCH') { const id = u.searchParams.get('id')?.replace('eq.', ''); if (id && st.jobs[id]) Object.assign(st.jobs[id], payload()); return route.fulfill({ status: 204, headers: cors }) }
      const id = u.searchParams.get('id')?.replace('eq.', '')
      return send(id ? pick([st.jobs[id]]) : [])
    }
    if (t === 'orders') {
      const sel = u.searchParams.get('select') ?? ''
      if (!single && sel.includes('prep_status')) return send(Object.values(st.orders).filter((o) => o.status === 'paid' && ['queued', 'preparing', 'ready'].includes(o.prep_status)))
      const id = u.searchParams.get('id')?.replace('eq.', '')
      if (id && st.orders[id]) return send(pick([st.orders[id]]))
      return send(single ? null : [])
    }
    const rows = {
      profiles: { full_name: 'Chủ quán', active: true },
      user_roles: [{ role: 'owner', store_id: store, stores: { id: store, name: 'Quán thử', address: '', phone: '', footer_note: '', enable_delivery: false } }],
      role_permissions: perms.map((permission) => ({ permission })),
      categories: [{ id: 'c1', store_id: store, name: 'Cà phê', sort_order: 1, is_active: true }], products, modifiers, tables: [],
      payment_methods: [{ id: 'm1', code: 'cash', name: 'Tiền mặt', is_cash: true, is_active: true }, { id: 'm2', code: 'transfer', name: 'Chuyển khoản', is_cash: false, is_active: true }],
      print_settings: settings, customers: [], shift_summary: { shift_id: 's' },
    }
    const b = rows[t] ?? []
    return send(t === 'profiles' || t === 'print_settings' ? b : pick(b))
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`))
  await page.goto(`${base}/#/pos`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[placeholder^="Tìm món"]').waitFor({ timeout: 8000 })
  await body({ page, st })
  await ctx.close()
}

const cashBtn = (page) => page.getByRole('button', { name: /Tiền mặt \(F3\)/ })
const add = (page, name) => page.getByRole('button', { name: `Thêm ${name}` }).click()
const callNo = (page) => page.getByTestId('call-no')

await scenario('A. Một ly: 2 thao tác (chạm món + Tiền mặt)', { kitchen: true }, async ({ page, st }) => {
  let actions = 0
  const t0 = Date.now()
  await add(page, 'Cà phê đen'); actions++
  await cashBtn(page).click(); actions++
  await callNo(page).waitFor({ timeout: 5000 })
  const ms = Date.now() - t0
  check('A', 'số thao tác = 2', actions === 2)
  check('A', 'không có hộp thoại nào chặn', (await page.locator('[role=dialog]').count()) === 0)
  check('A', 'hiện số gọi #1', (await callNo(page).innerText()) === '#1')
  check('A', 'giỏ hàng đã được dọn để bán tiếp', (await page.getByText('Chưa có món nào.').count()) === 1)
  check('A', 'không nhập tên/số điện thoại: đơn lưu mang đi, 1 lần lưu 1 lần thu', st.saveCalls === 1 && st.payCalls === 1 && st.orders.o1.type === 'takeaway')
  check('A', 'thu tiền mặt đủ, không cần nhập tiền khách đưa', st.payBodies[0].p_payments[0].method_code === 'cash' && st.payBodies[0].p_payments[0].tendered === 20000)
  await page.getByText('In thành công').first().waitFor({ timeout: 5000 })
  check('A', 'bill khách và phiếu pha chế đều in nền thành công', (await page.getByText('In thành công').count()) === 2)
  console.log(`  (từ lúc chạm món đến khi thấy số gọi: ${ms} ms, gồm 400 ms giả lập độ trễ máy chủ)`)
})

await scenario('B. Nhiều món liên tục, không hộp thoại giữa chừng', {}, async ({ page, st }) => {
  for (let i = 0; i < 3; i++) await add(page, 'Cà phê đen')
  await add(page, 'Cà phê sữa') // món có size + tùy chọn không bắt buộc: vẫn thêm ngay (size mặc định M)
  check('B', 'không mở hộp thoại khi thêm liên tục', (await page.locator('[role=dialog]').count()) === 0)
  check('B', 'tổng tiền 85.000 (20k×3 + 25k size M)', (await page.locator('aside:has-text("Đơn hiện tại")').innerText()).includes('85.000'))
  await page.getByRole('button', { name: 'Tùy chọn Cà phê sữa' }).click()
  check('B', 'nút Tùy chọn mở hộp chọn size/đá', (await page.getByRole('dialog').getByText('Size L').count()) === 1)
  await page.getByRole('dialog').getByRole('button', { name: /Size L/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Ít đá/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Thêm ·/ }).click()
  check('B', 'chọn Size L + Ít đá thêm dòng riêng, tổng 115.000', (await page.locator('aside:has-text("Đơn hiện tại")').innerText()).includes('115.000'))
  await page.keyboard.press('F3')
  await callNo(page).waitFor({ timeout: 5000 })
  check('B', 'phím tắt F3 thu tiền mặt', st.payCalls === 1 && st.orders.o1.order_items.length === 3)
  await add(page, 'Cà phê đen') // bán tiếp ngay khi thanh báo còn hiện
  check('B', 'bán tiếp được ngay, thanh báo không chặn', (await page.locator('aside:has-text("Đơn hiện tại")').innerText()).includes('20.000') && (await callNo(page).count()) === 1)
})

await scenario('C. Bấm nhiều lần không thu trùng', {}, async ({ page, st }) => {
  await add(page, 'Cà phê đen')
  const b = cashBtn(page)
  await Promise.allSettled([b.click({ timeout: 1000 }), b.click({ timeout: 1000, force: true }), page.keyboard.press('F3'), page.keyboard.press('F3')])
  await callNo(page).waitFor({ timeout: 5000 })
  await page.waitForTimeout(800)
  check('C', 'chỉ lưu 1 đơn', st.saveCalls === 1, `saveCalls=${st.saveCalls}`)
  check('C', 'chỉ gọi thu tiền 1 lần', st.payCalls === 1, `payCalls=${st.payCalls}`)
})

await scenario('D. Chuyển khoản', {}, async ({ page, st }) => {
  await add(page, 'Cà phê đen')
  await page.getByRole('button', { name: /Chuyển khoản \(F6\)/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.waitFor()
  check('D', 'mở sẵn phương thức Chuyển khoản', (await dlg.getByRole('button', { name: 'Chuyển khoản', exact: true }).getAttribute('aria-pressed')) === 'true')
  check('D', 'nhắc xác nhận thủ công (không tự xác minh ngân hàng)', (await dlg.innerText()).includes('không tự xác minh'))
  await dlg.getByRole('button', { name: /^Xác nhận/ }).click()
  await callNo(page).waitFor({ timeout: 5000 })
  check('D', 'ghi nhận thanh toán chuyển khoản', st.payCalls === 1 && st.payBodies[0].p_payments[0].method_code === 'transfer')
})

await scenario('E. Máy in lỗi: đơn giữ nguyên, bán tiếp được', { printMethod: 'qz_tray' }, async ({ page, st }) => {
  await add(page, 'Cà phê đen')
  await cashBtn(page).click()
  await callNo(page).waitFor({ timeout: 5000 })
  await page.getByText('In lỗi').first().waitFor({ timeout: 20000 })
  check('E', 'báo "In lỗi" ngay trên thanh báo, không hộp thoại', (await page.locator('[role=dialog]').count()) === 0)
  check('E', 'đơn vẫn ghi nhận đã thanh toán và nói rõ', (await page.getByText('Đơn đã thanh toán và được giữ nguyên').count()) >= 1 && st.orders.o1.status === 'paid')
  await add(page, 'Cà phê đen')
  check('E', 'tiếp tục bán đơn kế tiếp bình thường', (await page.locator('aside:has-text("Đơn hiện tại")').innerText()).includes('20.000'))
  check('E', 'có nút In lại', (await page.getByRole('button', { name: /In lại|Thử lại/ }).count()) >= 1)
  check('E', 'in lỗi không tạo thêm đơn hay thu thêm', st.saveCalls === 1 && st.payCalls === 1)
})

await scenario('F. Mất phản hồi khi thu tiền: không mất đơn, không thu mù quáng', { payFails: true }, async ({ page, st }) => {
  await add(page, 'Cà phê đen')
  await cashBtn(page).click()
  await page.getByText('Chưa nhận được phản hồi từ máy chủ').waitFor({ timeout: 8000 })
  check('F', 'cảnh báo rõ ràng, yêu cầu kiểm tra trạng thái', (await page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' }).count()) === 1)
  check('F', 'đơn đã được lưu trên server trước khi thu', st.saveCalls === 1 && st.orders.o1)
  await page.waitForTimeout(600)
  check('F', 'không tự gửi lại thu tiền', st.payCalls === 1, `payCalls=${st.payCalls}`)
})

await scenario('G. Màn hình pha chế', {}, async ({ page, st }) => {
  await add(page, 'Cà phê đen'); await cashBtn(page).click(); await callNo(page).waitFor({ timeout: 5000 })
  await page.goto(`${base}/#/pha-che`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Màn hình pha chế/ }).waitFor({ timeout: 5000 })
  const card = page.getByTestId('prep-o1'); await card.waitFor({ timeout: 5000 }).catch(async (e) => { console.log('DEBUG', (await page.locator('body').innerText()).slice(0, 600), JSON.stringify(st.orders)); throw e })
  check('G', 'đơn đã thanh toán xuất hiện ở "Chờ pha" với số gọi #1', (await card.innerText()).includes('#1') && (await card.innerText()).includes('Cà phê đen'))
  await card.getByRole('button', { name: 'Bắt đầu pha' }).click()
  await page.locator('section[aria-label="Đang pha"]').getByTestId('prep-o1').waitFor({ timeout: 8000 })
  await page.locator('section[aria-label="Đang pha"]').getByRole('button', { name: 'Pha xong' }).click()
  await page.locator('section[aria-label="Xong, chờ giao"]').getByTestId('prep-o1').waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Đã giao khách' }).click()
  await page.waitForTimeout(1500)
  check('G', 'đánh dấu đang pha → xong → đã giao (3 lệnh), đơn rời bảng', st.prepCalls.map((c) => c.p_status).join(',') === 'preparing,ready,served' && (await page.getByTestId('prep-o1').count()) === 0)
})

await browser.close()
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} kiểm tra đạt`)
if (problems.length) { console.log('LỖI:\n' + problems.join('\n')); process.exit(1) }
