import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store, p1, p2
const U = { owner: '00000000-0000-0000-0000-0000000000e1', manager: '00000000-0000-0000-0000-0000000000e2', cashier: '00000000-0000-0000-0000-0000000000e3' }
const vn = (iso) => iso // ISO đã có múi giờ

async function sell(uid, items, method = 'cash', key = Math.random().toString(36), disc = 0) {
  return asUser(admin, uid, async (q) => {
    const o = (await q(`select rpc_save_order($1,null,'takeaway',null,null,'',$2,0,0,$3::jsonb,null,'open') r`, [store, disc, JSON.stringify(items)])).rows[0].r
    const id = o.id ?? o.order_id ?? o
    const total = Number((await q(`select total from orders where id=$1`, [id])).rows[0].total)
    await q(`select rpc_pay_order($1,$2::jsonb,$3)`, [id, JSON.stringify([{ method_code: method, amount: total, ...(method === 'cash' ? { tendered: total } : {}) }]), key])
    return id
  })
}
// Dời ngày thanh toán để kiểm thử múi giờ (tắt trigger cho phiên quản trị).
async function backdate(id, iso) { await admin.query(`set session_replication_role = replica`); await admin.query(`update orders set paid_at=$2 where id=$1`, [id, iso]); await admin.query(`set session_replication_role = origin`) }
const report = (uid, from, to) => asUser(admin, uid, async (q) => (await q(`select rpc_report_sales($1,$2::date,$3::date) r`, [store, from, to])).rows[0].r)

before(async () => {
  db = await startDb(); admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán báo cáo') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'manager')`, [store, U.manager])
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    const cat = (await q(`insert into categories (store_id, name) values ($1,'Cà phê') returning id`, [store])).rows[0].id
    p1 = (await q(`insert into products (store_id, code, name, price, category_id) values ($1,'CF','Cà phê sữa',25000,$2) returning id`, [store, cat])).rows[0].id
    p2 = (await q(`insert into products (store_id, code, name, price) values ($1,'TR','Trà đào',40000) returning id`, [store])).rows[0].id
    await q(`insert into product_costs values ($1,$2,9000)`, [p1, store]); await q(`insert into product_costs values ($1,$2,15000)`, [p2, store])
  })
})
after(async () => { await db?.stop() })

test('báo cáo tính đúng doanh thu, giảm giá, giá vốn, phương thức, top món, theo ngày/giờ (giờ Việt Nam)', async () => {
  const a = await sell(U.owner, [{ product_id: p1, quantity: 2 }])                       // 50.000, vốn 18.000
  const b = await sell(U.owner, [{ product_id: p2, quantity: 1 }], 'transfer')            // 40.000, vốn 15.000
  const c = await sell(U.owner, [{ product_id: p1, quantity: 4 }], 'cash', undefined, 10000) // 100.000-10.000 = 90.000, vốn 36.000
  // 23:30 ngày 10/03 giờ VN = 16:30 UTC cùng ngày; 00:10 ngày 11/03 giờ VN = 17:10 UTC ngày 10
  await backdate(a, '2026-03-10T16:30:00Z'); await backdate(b, '2026-03-10T17:10:00Z'); await backdate(c, '2026-03-11T03:00:00Z')
  const r = await report(U.owner, '2026-03-10', '2026-03-11')
  assert.equal(Number(r.summary.orders), 3); assert.equal(Number(r.summary.gross), 180000)
  assert.equal(Number(r.summary.discount), 10000); assert.equal(Number(r.summary.net), 180000)
  assert.equal(Number(r.summary.cost), 69000); assert.equal(Number(r.summary.profit), 111000)
  assert.equal(Number(r.summary.avg_order), 60000)
  const days = Object.fromEntries(r.by_day.map((d) => [d.day, Number(d.revenue)]))
  assert.deepEqual(days, { '2026-03-10': 50000, '2026-03-11': 130000 })   // đơn b (00:10 VN) thuộc ngày 11
  const hours = Object.fromEntries(r.by_hour.map((h) => [h.hour, Number(h.orders)]))
  assert.equal(hours[23], 1); assert.equal(hours[0], 1); assert.equal(hours[10], 1)
  const methods = Object.fromEntries(r.by_method.map((m) => [m.method, Number(m.amount)]))
  assert.deepEqual(methods, { cash: 140000, transfer: 40000 })
  assert.equal(r.top_products[0].name, 'Cà phê sữa'); assert.equal(Number(r.top_products[0].quantity), 6)
  const cats = Object.fromEntries(r.by_category.map((x) => [x.name, Number(x.revenue)]))
  assert.deepEqual(cats, { 'Cà phê': 150000, 'Khác': 40000 }) // doanh số theo dòng món, trước giảm giá toàn đơn
  // ngày 10 chỉ có đơn lúc 23:30 giờ VN; đơn 00:10 giờ VN đã sang ngày 11
  assert.equal(Number((await report(U.owner, '2026-03-10', '2026-03-10')).summary.orders), 1)
  assert.equal(Number((await report(U.owner, '2026-03-11', '2026-03-11')).summary.orders), 2)
})

test('hoàn tiền: toàn bộ loại khỏi top món/giá vốn; một phần trừ vào doanh thu thuần', async () => {
  const d = await sell(U.owner, [{ product_id: p2, quantity: 1 }])    // 40.000
  const e = await sell(U.owner, [{ product_id: p1, quantity: 2 }])    // 50.000
  await backdate(d, '2026-04-05T03:00:00Z'); await backdate(e, '2026-04-05T04:00:00Z')
  await asUser(admin, U.owner, async (q) => {
    await q(`select rpc_refund_order($1,40000,'Khách trả món','cash','rp-full')`, [d])
    await q(`select rpc_refund_order($1,10000,'Giảm do chậm','cash','rp-part')`, [e])
  })
  await admin.query(`set session_replication_role = replica`)
  await admin.query(`update refunds set created_at='2026-04-05T05:00:00Z'`); await admin.query(`set session_replication_role = origin`)
  const r = await report(U.owner, '2026-04-05', '2026-04-05')
  assert.equal(Number(r.summary.gross), 90000); assert.equal(Number(r.summary.refunds), 50000); assert.equal(Number(r.summary.net), 40000)
  assert.equal(Number(r.summary.cost), 18000) // đơn hoàn toàn bộ không tính vốn (đã hoàn kho); đơn hoàn một phần vẫn tính
  assert.deepEqual(r.top_products.map((p) => p.name), ['Cà phê sữa'])
})

test('phân quyền: thu ngân không xem báo cáo/tổng quan; quản lý xem được; khoảng ngày được kiểm tra', async () => {
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_report_sales($1,'2026-03-10','2026-03-11')`, [store], /không có quyền/)
    await expectFail(q, `select rpc_dashboard($1)`, [store], /không có quyền/)
  })
  await asUser(admin, U.manager, async (q) => {
    await expectFail(q, `select rpc_report_sales($1,'2026-03-11','2026-03-10')`, [store], /không hợp lệ/)
    await expectFail(q, `select rpc_report_sales($1,'2024-01-01','2026-03-10')`, [store], /366/)
    const d = (await q(`select rpc_dashboard($1) r`, [store])).rows[0].r
    assert.ok('today' in d && 'open_orders' in d && 'low_stock' in d)
  })
})

test('quản lý không có costs.view thì không thấy giá vốn/lợi nhuận', async () => {
  await admin.query(`delete from role_permissions where role='manager' and permission='costs.view'`)
  const r = await report(U.manager, '2026-03-10', '2026-03-11')
  assert.equal(r.summary.cost, null); assert.equal(r.summary.profit, null); assert.equal(Number(r.summary.gross), 180000)
  await admin.query(`insert into role_permissions values ('manager','costs.view')`)
})

test('báo cáo cửa hàng khác không lộ dữ liệu', async () => {
  const other = (await admin.query(`insert into stores (name) values ('Khác') returning id`)).rows[0].id
  await asUser(admin, U.owner, async (q) => { await expectFail(q, `select rpc_report_sales($1,'2026-03-10','2026-03-11')`, [other], /không có quyền/) })
})
