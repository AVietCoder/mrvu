import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store, prod, tbl
const U = { owner: '00000000-0000-0000-0000-0000000000a1', staff: '00000000-0000-0000-0000-0000000000a2', cashier: '00000000-0000-0000-0000-0000000000a3' }
const items = (q = 1) => JSON.stringify([{ product_id: prod, quantity: q }])
const save = (q, type, status, id = null, version = null) => q(`select rpc_save_order($1,$2,$3::order_type,$4,null,'',0,0,0,$5::jsonb,$6,$7::order_status) r`, [store, id, type, type === 'dine_in' ? tbl : null, items(), version, status]).then((r) => r.rows[0].r)
const pay = (q, id, key) => q(`select rpc_pay_order($1,$2::jsonb,$3)`, [id, JSON.stringify([{ method_code: 'cash', amount: 25000, tendered: 25000 }]), key])
const prep = async (id) => (await admin.query(`select prep_status s, version v from orders where id=$1`, [id])).rows[0]

before(async () => {
  db = await startDb(); admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán nhanh') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'staff')`, [store, U.staff]); await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    prod = (await q(`insert into products (store_id, code, name, price) values ($1,'CF','Cà phê sữa',25000) returning id`, [store])).rows[0].id
    tbl = (await q(`insert into tables (store_id, name) values ($1,'A1') returning id`, [store])).rows[0].id
  })
})
after(async () => { await db?.stop() })

test('đơn mang đi vào hàng đợi pha chế đúng lúc thanh toán, không có trước đó', async () => {
  let id
  await asUser(admin, U.cashier, async (q) => {
    id = (await save(q, 'takeaway', 'draft')).id
    assert.equal((await prep(id)).s, null)
    await pay(q, id, 'k-1')
  })
  assert.equal((await prep(id)).s, 'queued')
})

test('đơn tại bàn vào hàng đợi khi được xác nhận phục vụ', async () => {
  let id
  await asUser(admin, U.cashier, async (q) => { id = (await save(q, 'dine_in', 'open')).id })
  assert.equal((await prep(id)).s, 'queued')
})

test('pha chế: queued -> preparing -> ready -> served; phục vụ cũng đổi được; gọi lại không đổi gì', async () => {
  let id
  await asUser(admin, U.cashier, async (q) => { id = (await save(q, 'takeaway', 'open')).id; await pay(q, id, 'k-2') })
  await asUser(admin, U.staff, async (q) => {
    for (const s of ['preparing', 'ready', 'served']) assert.equal((await q(`select rpc_set_prep_status($1,$2) r`, [id, s])).rows[0].r, s)
    assert.equal((await q(`select rpc_set_prep_status($1,'served') r`, [id])).rows[0].r, 'served')
    await q(`select rpc_set_prep_status($1,'ready')`, [id]) // sửa nhầm: lùi lại được
    await expectFail(q, `select rpc_set_prep_status($1,'xong')`, [id], /không hợp lệ/)
  })
  assert.equal((await prep(id)).s, 'ready')
})

test('đổi trạng thái pha chế không tăng version (không gây xung đột sửa đơn tại bàn)', async () => {
  let id, v
  await asUser(admin, U.cashier, async (q) => { const r = await save(q, 'dine_in', 'open'); id = r.id; v = r.version })
  const before = (await prep(id)).v
  await asUser(admin, U.staff, async (q) => { await q(`select rpc_set_prep_status($1,'preparing')`, [id]) })
  assert.equal((await prep(id)).v, before)
  // thu ngân vẫn lưu được với version cũ
  await asUser(admin, U.cashier, async (q) => { await save(q, 'dine_in', 'open', id, before) })
  assert.ok((await prep(id)).v > before)
})

test('đơn hủy/hoàn toàn bộ/nháp không đổi trạng thái pha chế được', async () => {
  let a, b
  await asUser(admin, U.cashier, async (q) => { a = (await save(q, 'takeaway', 'open')).id; await pay(q, a, 'k-3'); b = (await save(q, 'dine_in', 'open')).id })
  await asUser(admin, U.owner, async (q) => {
    await q(`select rpc_refund_order($1,25000,'Làm sai món','cash','rf-p1')`, [a])
    await q(`select rpc_cancel_order($1,'Khách đổi ý')`, [b])
    await expectFail(q, `select rpc_set_prep_status($1,'preparing')`, [a], /không có trong hàng đợi/)
    await expectFail(q, `select rpc_set_prep_status($1,'preparing')`, [b], /không có trong hàng đợi/)
  })
})

test('đơn nháp chưa vào hàng đợi; người ngoài cửa hàng không đổi được', async () => {
  let d
  await asUser(admin, U.cashier, async (q) => { d = (await save(q, 'takeaway', 'draft')).id })
  await asUser(admin, U.staff, async (q) => { await expectFail(q, `select rpc_set_prep_status($1,'preparing')`, [d], /không có trong hàng đợi/) })
  const stranger = '00000000-0000-0000-0000-0000000000ff'
  await admin.query(`insert into auth.users (id, email) values ($1,'x@t.test')`, [stranger])
  await asUser(admin, stranger, async (q) => { await expectFail(q, `select rpc_set_prep_status($1,'preparing')`, [d], /không có quyền/) })
})

test('chỉ một phiếu bếp cho mỗi đơn', async () => {
  let id
  await asUser(admin, U.cashier, async (q) => { id = (await save(q, 'takeaway', 'open')).id; await pay(q, id, 'k-4') })
  await asUser(admin, U.cashier, async (q) => {
    const ins = `insert into receipt_print_jobs (store_id, order_id, kind, requested_by) values ($1,$2,'kitchen',$3)`
    await q(ins, [store, id, U.cashier])
    await expectFail(q, ins, [store, id, U.cashier], /duplicate|unique/i)
  })
})
