// Smoke test giao diện với REST giả lập (không phải Supabase thật). Chạy: node tests/e2e/smoke.mjs <baseUrl>
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.argv[2] ?? 'http://localhost:4173'
const SB = 'http://sb.test'
const uid = '00000000-0000-0000-0000-000000000001', store = '00000000-0000-0000-0000-0000000000aa'
const session = { access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: uid, email: 'o@x.vn', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } }
const perms = ['pos.use', 'order.create', 'order.pay', 'order.cancel', 'order.refund', 'order.reprint', 'menu.manage', 'price.edit', 'discount.apply', 'settings.manage', 'users.manage', 'reports.view', 'costs.view', 'inventory.view', 'inventory.manage', 'stock.adjust', 'purchase.manage', 'customers.manage', 'shift.manage', 'cash.manage', 'audit.view']
const cat = { id: 'c1', store_id: store, name: 'Cà phê', sort_order: 1, is_active: true }
const prod = { id: 'p1', store_id: store, category_id: 'c1', code: 'CF01', name: 'Cà phê sữa', price: 25000, is_active: true, sort_order: 1, image_url: null, product_variants: [], product_modifiers: [] }
const tables = [{ id: 't1', name: 'A1', area: 'Tầng 1', seats: 4, status: 'free', opened_at: null, is_active: true }]
const rows = {
  profiles: { full_name: 'Chủ quán', active: true },
  user_roles: { role: 'owner', store_id: store, stores: { id: store, name: 'Quán thử', address: '', phone: '', footer_note: '', enable_delivery: false } },
  role_permissions: perms.map((permission) => ({ permission })),
  categories: [cat], products: [prod], tables, payment_methods: [{ id: 'm1', code: 'cash', name: 'Tiền mặt', is_cash: true, is_active: true }], orders: [], customers: [],
  rpc_dashboard: { today: { orders: 3, net: 150000, avg_order: 50000 }, yesterday: { orders: 2, net: 100000, avg_order: 50000 }, open_orders: 1, low_stock: 2 },
  rpc_report_sales: { from: '2026-10-22', to: '2026-10-28', summary: { orders: 3, gross: 150000, discount: 0, refunds: 0, net: 150000, avg_order: 50000, cost: 54000, profit: 96000 }, by_day: [{ day: '2026-10-28', orders: 3, revenue: 150000 }], by_hour: [{ hour: 9, orders: 3, revenue: 150000 }], by_method: [{ method: 'cash', name: 'Tiền mặt', amount: 150000 }], by_staff: [{ user_id: null, name: 'Chủ quán', orders: 3, revenue: 150000 }], top_products: [{ name: 'Cà phê sữa', quantity: 6, revenue: 150000 }], by_category: [{ name: 'Cà phê', quantity: 6, revenue: 150000 }] },
  shift_summary: { shift_id: 's', opening_cash: 0, cash_sales: 0, other_sales: {}, cash_in: 0, cash_out: 0, cash_refunds: 0, orders: 0, expected_cash: 0 },
  print_settings: { method: 'simulator', printer_name: '', paper_width: 80, auto_print: true, allow_reprint: true, margin_mm: 2, font_size: 12, copies: 1, kitchen_enabled: false, kitchen_printer_name: '' },
}
const errors = []
const browser = await chromium.launch()
async function run(name, vp) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-sb-auth-token', JSON.stringify(s)), [session])
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()) // không phụ thuộc mạng ngoài
  await ctx.route(`${SB}/**`, (route) => {
    const u = new URL(route.request().url()); const t = u.pathname.split('/').pop()
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    let body = rows[t] ?? []
    if (single && Array.isArray(body)) body = body[0] ?? null
    const wantsObj = single || t === 'profiles' || t === 'user_roles' || t === 'print_settings' || t.startsWith('rpc_') || t === 'shift_summary'
    if (t === 'user_roles' || t === 'profiles') body = rows[t]
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(wantsObj && t !== 'user_roles' ? body : t === 'user_roles' ? [rows.user_roles] : body) })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`) })
  const out = []
  for (const path of ['/', '/pos', '/ban', '/pha-che', '/don-hang', '/thuc-don', '/danh-muc', '/topping', '/khach-hang', '/kho', '/nhap-hang', '/nhan-vien', '/thu-chi', '/bao-cao', '/may-in', '/tai-khoan', '/nhat-ky']) {
    await page.goto(`${base}/#${path}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700)
    const text = (await page.locator('body').innerText()).slice(0, 4000)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    const h1 = await page.locator('h1').first().innerText({ timeout: 1500 }).catch(() => '')
    const crashed = await page.locator('[role=alert]:has-text("Có lỗi khi hiển thị")').count()
    out.push({ path, h1, ok: crashed === 0 && (path === '/pos' ? (await page.locator('input[placeholder^="Tìm món"]').count()) > 0 : h1.length > 0), overflow })
    if (path === '/pos' && name === 'desktop') { // tương tác: chọn món -> giỏ hàng có tiền và nút thanh toán bật
      await page.getByText('Cà phê sữa').first().click()
      const pay = page.getByRole('button', { name: /khách đưa tiền thừa \(F4\)/ })
      await pay.waitFor({ timeout: 3000 })
      const cartOk = (await page.locator('body').innerText()).includes('25.000') && (await pay.isEnabled())
      out[out.length - 1].ok = out[out.length - 1].ok && cartOk
      out[out.length - 1].h1 = cartOk ? 'chọn món vào giỏ OK' : 'giỏ hàng không cập nhật'
    }
    await page.screenshot({ path: `/tmp/smoke-${name}-${path.replace(/\W/g, '') || 'home'}.png` })
  }
  console.log(name); for (const o of out) console.log(' ', o.ok && !o.overflow ? 'OK  ' : 'FAIL', o.path, '|', o.h1); if (out.some((o) => !o.ok || o.overflow)) errors.push(`${name}: có màn hình lỗi`); await ctx.close()
}
await run('desktop', { width: 1366, height: 768 }); await run('tablet', { width: 820, height: 1180 })
await browser.close()
if (errors.length) { console.log('LỖI TRÌNH DUYỆT:\n' + [...new Set(errors)].join('\n')); process.exit(1) }
