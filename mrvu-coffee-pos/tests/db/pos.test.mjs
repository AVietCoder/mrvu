import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser } from './harness.mjs'

let db, admin
const U = {
  owner: '00000000-0000-0000-0000-0000000000a1',
  cashier: '00000000-0000-0000-0000-0000000000a2',
  staff: '00000000-0000-0000-0000-0000000000a3',
}
let store, prod, variant, optA, optB, ing, tableIds = {}, customer

// Chạy fn với tư cách user trên một kết nối bất kỳ (dùng cho kiểm thử đồng thời).
async function runAs(client, userId, fn) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    const r = await fn((sql, p) => client.query(sql, p))
    await client.query('commit')
    return r
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}

const SAVE = `select rpc_save_order($1,$2,$3::order_type,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::order_status) r`
const save = (q, o) => q(SAVE, [store, o.id ?? null, o.type ?? 'takeaway', o.table ?? null, o.customer ?? null,
  o.note ?? '', o.discAmt ?? 0, o.discPct ?? 0, o.surcharge ?? 0, JSON.stringify(o.items), o.version ?? null,
  o.status ?? 'open']).then((r) => r.rows[0].r)
const pay = (q, id, lines, key) => q(`select rpc_pay_order($1,$2::jsonb,$3) r`, [id, JSON.stringify(lines), key]).then((r) => r.rows[0].r)
const item = (qty = 1, extra = {}) => ({ product_id: prod, variant_id: variant, quantity: qty, ...extra })
const stockOf = async () => Number((await admin.query(`select current_stock s from ingredients where id=$1`, [ing])).rows[0].s)
const sqlstate = async (p) => { try { await p; return null } catch (e) { return { code: e.code, message: e.message } } }

before(async () => {
  db = await startDb()
  admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán thử') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    await q(`select rpc_set_user_role($1,$2,'staff')`, [store, U.staff])
    prod = (await q(`insert into products (store_id, code, name, price) values ($1,'CF','Cà phê sữa',25000) returning id`, [store])).rows[0].id
    variant = (await q(`insert into product_variants (product_id, store_id, name, price) values ($1,$2,'Size L',32000) returning id`, [prod, store])).rows[0].id
    await q(`insert into product_variants (product_id, store_id, name, price) values ($1,$2,'Size M',25000)`, [prod, store])
    const m = (await q(`insert into modifiers (store_id, name, min_select, max_select) values ($1,'Topping',0,1) returning id`, [store])).rows[0].id
    optA = (await q(`insert into modifier_options (modifier_id, store_id, name, price_delta) values ($1,$2,'Trân châu',5000) returning id`, [m, store])).rows[0].id
    optB = (await q(`insert into modifier_options (modifier_id, store_id, name, price_delta) values ($1,$2,'Thạch',3000) returning id`, [m, store])).rows[0].id
    await q(`insert into product_modifiers values ($1,$2)`, [prod, m])
    await q(`insert into product_costs values ($1,$2,9000)`, [prod, store])
    customer = (await q(`insert into customers (store_id, name, phone) values ($1,'Khách A','0900') returning id`, [store])).rows[0].id
    await q(`insert into customers (store_id, name, phone) values ($1,'Khách B','0900')`, [store]) // trùng SĐT được phép
    for (const n of ['B1', 'B2', 'B3']) {
      tableIds[n] = (await q(`insert into tables (store_id, name) values ($1,$2) returning id`, [store, n])).rows[0].id
    }
  })
  ing = (await admin.query(`insert into ingredients (store_id, name, unit) values ($1,'Cà phê','g') returning id`, [store])).rows[0].id
  await admin.query(`insert into stock_movements (store_id, ingredient_id, type, quantity, reason) values ($1,$2,'opening',1000,'Tồn đầu')`, [store, ing])
  await admin.query(`insert into product_recipes (store_id, product_id, variant_id, ingredient_id, quantity) values ($1,$2,null,$3,20)`, [store, prod, ing])
})
after(async () => { await db?.stop() })

test('mã đơn tuần tự theo ngày, SĐT khách có thể trùng', async () => {
  const a = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
  const b = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
  assert.match(a.code, /^\d{6}-0001$/)
  assert.match(b.code, /^\d{6}-0002$/)
  const dup = await admin.query(`select count(*)::int n from customers where phone='0900'`)
  assert.equal(dup.rows[0].n, 2)
})

test('thanh toán: idempotent, không trùng payment/receipt, kho chỉ trừ một lần', async () => {
  const before0 = await stockOf()
  const o = await asUser(admin, U.cashier, (q) => save(q, { customer, items: [item(2, { option_ids: [optA] })] }))
  assert.equal(o.total, 74000)
  const r1 = await asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 74000, tendered: 100000 }], 'K1'))
  assert.equal(r1.replayed, false)
  const r2 = await asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 74000, tendered: 100000 }], 'K1'))
  assert.equal(r2.replayed, true)
  assert.equal(r2.receipt_id, r1.receipt_id)

  const err = await sqlstate(asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 74000 }], 'K-KHAC')))
  assert.equal(err.code, 'MR409')

  assert.equal((await admin.query(`select count(*)::int n from payments where order_id=$1`, [o.id])).rows[0].n, 1)
  assert.equal((await admin.query(`select count(*)::int n from receipts where order_id=$1`, [o.id])).rows[0].n, 1)
  assert.equal(await stockOf(), before0 - 2 * 20) // 2 ly x 20g, chỉ trừ một lần
  const row = (await admin.query(`select change_amount c, tendered t from payments where order_id=$1`, [o.id])).rows[0]
  assert.equal(row.c, '26000'); assert.equal(row.t, '100000')
  const cost = await admin.query(`select unit_cost from order_item_costs c join order_items i on i.id=c.order_item_id where i.order_id=$1`, [o.id])
  assert.equal(cost.rows[0].unit_cost, '9000')
  const cust = (await admin.query(`select total_spent s, order_count n from customers where id=$1`, [customer])).rows[0]
  assert.equal(cust.s, '74000'); assert.equal(cust.n, 1)
})

test('hai yêu cầu thanh toán đồng thời chỉ tạo một giao dịch', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
  const stock0 = await stockOf()
  const c1 = await db.connect(), c2 = await db.connect()
  try {
    // Cùng khóa: cả hai thành công, đúng một bản ghi thật.
    const res = await Promise.all([
      runAs(c1, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 32000 }], 'SAME')),
      runAs(c2, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 32000 }], 'SAME')),
    ])
    assert.equal(res.filter((r) => !r.replayed).length, 1)
    assert.equal(res[0].receipt_id, res[1].receipt_id)
    assert.equal((await admin.query(`select count(*)::int n from payments where order_id=$1`, [o.id])).rows[0].n, 1)
    assert.equal(await stockOf(), stock0 - 20)

    // Khác khóa (hai thu ngân bấm cùng lúc): một thành công, một bị từ chối.
    const o2 = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
    const settled = await Promise.allSettled([
      runAs(c1, U.cashier, (q) => pay(q, o2.id, [{ method_code: 'cash', amount: 32000 }], 'A')),
      runAs(c2, U.owner, (q) => pay(q, o2.id, [{ method_code: 'cash', amount: 32000 }], 'B')),
    ])
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1)
    const failed = settled.find((s) => s.status === 'rejected')
    assert.equal(failed.reason.code, 'MR409')
    assert.equal((await admin.query(`select count(*)::int n from receipts where order_id=$1`, [o2.id])).rows[0].n, 1)
  } finally { await c1.end(); await c2.end() }
})

test('thanh toán kết hợp, kiểm tra tổng và tiền khách đưa', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { items: [item(2, { option_ids: [optA] })] })) // 74.000
  const bad1 = await sqlstate(asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 50000 }], 'S1')))
  assert.match(bad1.message, /không khớp/)
  const bad2 = await sqlstate(asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 74000, tendered: 50000 }], 'S2')))
  assert.match(bad2.message, /chưa đủ/)
  const bad3 = await sqlstate(asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'bitcoin', amount: 74000 }], 'S3')))
  assert.match(bad3.message, /không hợp lệ/)
  assert.equal((await admin.query(`select status from orders where id=$1`, [o.id])).rows[0].status, 'open') // không nửa chừng

  await asUser(admin, U.cashier, (q) => pay(q, o.id, [
    { method_code: 'cash', amount: 50000, tendered: 100000 },
    { method_code: 'transfer', amount: 24000, reference: 'FT123' }], 'S4'))
  const snap = (await admin.query(`select snapshot from receipts where order_id=$1`, [o.id])).rows[0].snapshot
  assert.equal(snap.total, 74000)
  assert.equal(snap.payments.length, 2)
  assert.equal(snap.payments[0].change, 50000)
  assert.equal(snap.payments[1].reference, 'FT123')
  assert.equal(snap.items[0].modifiers[0].name, 'Trân châu')
})

test('lịch sử giữ giá tại thời điểm bán khi thực đơn đổi giá', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
  await asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 32000 }], 'H1'))
  await asUser(admin, U.owner, (q) => q(`update product_variants set price=99000 where id=$1`, [variant]))
  const it = (await admin.query(`select unit_price, name_snapshot, variant_snapshot from order_items where order_id=$1`, [o.id])).rows[0]
  assert.equal(it.unit_price, '32000'); assert.equal(it.variant_snapshot, 'Size L')
  const snap = (await admin.query(`select snapshot from receipts where order_id=$1`, [o.id])).rows[0].snapshot
  assert.equal(snap.items[0].unit_price, 32000)
  await asUser(admin, U.owner, (q) => q(`update product_variants set price=32000 where id=$1`, [variant]))
})

test('khóa lạc quan: hai người cùng sửa một đơn', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] }))
  await asUser(admin, U.cashier, (q) => save(q, { id: o.id, version: o.version, items: [item(2)] }))
  const err = await sqlstate(asUser(admin, U.staff, (q) => save(q, { id: o.id, version: o.version, items: [item(3)] })))
  assert.equal(err.code, 'MR409')
  assert.match(err.message, /người khác cập nhật/)
})

test('kiểm tra món: ngừng bán, bắt buộc size, giới hạn topping', async () => {
  const noVariant = await sqlstate(asUser(admin, U.cashier, (q) => save(q, { items: [{ product_id: prod, quantity: 1 }] })))
  assert.match(noVariant.message, /chọn size/)
  const tooMany = await sqlstate(asUser(admin, U.cashier, (q) => save(q, { items: [item(1, { option_ids: [optA, optB] })] })))
  assert.match(tooMany.message, /tối đa 1/)
  const zero = await sqlstate(asUser(admin, U.cashier, (q) => save(q, { items: [item(0)] })))
  assert.match(zero.message, /Số lượng/)
  await admin.query(`update products set is_active=false where id=$1`, [prod])
  const off = await sqlstate(asUser(admin, U.cashier, (q) => save(q, { items: [item(1)] })))
  assert.match(off.message, /ngừng bán/)
  await admin.query(`update products set is_active=true where id=$1`, [prod])
  const priced = await asUser(admin, U.owner, (q) => save(q, { items: [item(1, { price_override: 20000 })] }))
  assert.equal(priced.total, 20000) // owner có quyền price.edit
})

test('hủy đơn: cần quyền và lý do; đơn hủy không thanh toán được; bàn được giải phóng', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { type: 'dine_in', table: tableIds.B1, items: [item(1)] }))
  assert.equal((await admin.query(`select status from tables where id=$1`, [tableIds.B1])).rows[0].status, 'occupied')
  const noPerm = await sqlstate(asUser(admin, U.cashier, (q) => q(`select rpc_cancel_order($1,'khách đổi ý')`, [o.id])))
  assert.match(noPerm.message, /không có quyền/)
  const noReason = await sqlstate(asUser(admin, U.owner, (q) => q(`select rpc_cancel_order($1,'')`, [o.id])))
  assert.match(noReason.message, /lý do/)
  await asUser(admin, U.owner, (q) => q(`select rpc_cancel_order($1,'khách đổi ý')`, [o.id]))
  assert.equal((await admin.query(`select status from tables where id=$1`, [tableIds.B1])).rows[0].status, 'free')
  const payCancelled = await sqlstate(asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 32000 }], 'X')))
  assert.equal(payCancelled.code, 'MR409')
  const log = await admin.query(`select count(*)::int n from audit_logs where action='order.cancel' and entity_id=$1`, [o.id])
  assert.equal(log.rows[0].n, 1)
})

test('hoàn tiền: một phần rồi toàn bộ, hoàn kho đúng một lần, idempotent', async () => {
  const o = await asUser(admin, U.cashier, (q) => save(q, { customer, items: [item(2)] })) // 64.000
  await asUser(admin, U.cashier, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 64000 }], 'R1'))
  const afterSale = await stockOf()
  const REF = `select rpc_refund_order($1,$2,$3,'cash',$4) r`

  const noPerm = await sqlstate(asUser(admin, U.cashier, (q) => q(REF, [o.id, 10000, 'lý do', 'rf0'])))
  assert.match(noPerm.message, /không có quyền/)

  const p1 = await asUser(admin, U.owner, (q) => q(REF, [o.id, 10000, 'món bị đổ', 'rf1']).then((r) => r.rows[0].r))
  assert.equal(p1.order_status, 'partially_refunded')
  assert.equal(await stockOf(), afterSale) // hoàn một phần không hoàn kho
  const replay = await asUser(admin, U.owner, (q) => q(REF, [o.id, 10000, 'món bị đổ', 'rf1']).then((r) => r.rows[0].r))
  assert.equal(replay.replayed, true)
  assert.equal((await admin.query(`select refunded_total r from orders where id=$1`, [o.id])).rows[0].r, '10000')

  const tooMuch = await sqlstate(asUser(admin, U.owner, (q) => q(REF, [o.id, 60000, 'quá mức', 'rf2'])))
  assert.match(tooMuch.message, /vượt quá/)

  const p2 = await asUser(admin, U.owner, (q) => q(REF, [o.id, 54000, 'hoàn phần còn lại', 'rf3']).then((r) => r.rows[0].r))
  assert.equal(p2.order_status, 'refunded')
  assert.equal(await stockOf(), afterSale + 2 * 20) // hoàn kho đúng một lần
  const again = await sqlstate(asUser(admin, U.owner, (q) => q(REF, [o.id, 1000, 'thêm', 'rf4'])))
  assert.equal(again.code, 'MR409')
  assert.equal((await admin.query(`select count(*)::int n from stock_movements where order_id=$1 and type='sale_reversal'`, [o.id])).rows[0].n, 1)
  const cust = (await admin.query(`select total_spent s from customers where id=$1`, [customer])).rows[0]
  assert.equal(cust.s, '74000') // 74.000 (đơn trước) + 64.000 - 64.000 hoàn
})

test('bàn: trạng thái, chuyển bàn, gộp và tách order', async () => {
  const tstat = async (n) => (await admin.query(`select status from tables where id=$1`, [tableIds[n]])).rows[0].status

  const a = await asUser(admin, U.cashier, (q) => save(q, { type: 'dine_in', table: tableIds.B1, items: [item(1), item(2)] }))
  assert.equal(await tstat('B1'), 'occupied')
  await asUser(admin, U.cashier, (q) => save(q, { id: a.id, version: a.version, type: 'dine_in', table: tableIds.B1, status: 'pending_payment', items: [item(1), item(2)] }))
  assert.equal(await tstat('B1'), 'pending_payment')

  const cur = (await admin.query(`select version from orders where id=$1`, [a.id])).rows[0].version
  await asUser(admin, U.cashier, (q) => q(`select rpc_move_table($1,$2,$3)`, [a.id, tableIds.B2, cur]))
  assert.equal(await tstat('B1'), 'free'); assert.equal(await tstat('B2'), 'pending_payment')

  const b = await asUser(admin, U.cashier, (q) => save(q, { type: 'dine_in', table: tableIds.B3, items: [item(1)] }))
  const busy = await sqlstate(asUser(admin, U.cashier, (q) => q(`select rpc_move_table($1,$2,$3)`, [b.id, tableIds.B2, b.version])))
  assert.equal(busy.code, 'MR409')

  // Gộp b vào a: tổng đúng, b bị hủy, B3 trống
  const merged = await asUser(admin, U.cashier, (q) => q(`select rpc_merge_orders($1,$2) r`, [b.id, a.id]).then((r) => r.rows[0].r))
  const ta = (await admin.query(`select total, status from orders where id=$1`, [a.id])).rows[0]
  assert.equal(ta.total, String(32000 + 64000 + 32000))
  assert.equal((await admin.query(`select status, total from orders where id=$1`, [b.id])).rows[0].status, 'cancelled')
  assert.equal((await admin.query(`select total from orders where id=$1`, [b.id])).rows[0].total, '0')
  assert.equal(await tstat('B3'), 'free')
  assert.equal(merged.id, a.id)

  // Tách một dòng sang order mới ở bàn B3
  const items = (await admin.query(`select id from order_items where order_id=$1 order by quantity desc`, [a.id])).rows
  const split = await asUser(admin, U.cashier, (q) => q(`select rpc_move_items($1,$2::uuid[],null,$3) r`, [a.id, [items[0].id], tableIds.B3]).then((r) => r.rows[0].r))
  assert.equal((await admin.query(`select total from orders where id=$1`, [split.target_id])).rows[0].total, '64000')
  assert.equal((await admin.query(`select total from orders where id=$1`, [a.id])).rows[0].total, String(32000 + 32000))
  assert.equal(await tstat('B3'), 'occupied')

  // Không được chuyển hết món
  const rest = (await admin.query(`select id from order_items where order_id=$1`, [a.id])).rows.map((r) => r.id)
  const all = await sqlstate(asUser(admin, U.cashier, (q) => q(`select rpc_move_items($1,$2::uuid[],null,null)`, [a.id, rest])))
  assert.match(all.message, /ít nhất một món/)

  // Thanh toán giải phóng bàn
  await asUser(admin, U.cashier, (q) => pay(q, split.target_id, [{ method_code: 'cash', amount: 64000 }], 'T-PAY'))
  assert.equal(await tstat('B3'), 'free')
})

test('staff không thanh toán được; đơn tại bàn bắt buộc có bàn', async () => {
  const o = await asUser(admin, U.staff, (q) => save(q, { items: [item(1)] }))
  const e = await sqlstate(asUser(admin, U.staff, (q) => pay(q, o.id, [{ method_code: 'cash', amount: 32000 }], 'ST')))
  assert.match(e.message, /không có quyền thanh toán/)
  const e2 = await sqlstate(asUser(admin, U.staff, (q) => save(q, { type: 'dine_in', items: [item(1)] })))
  assert.match(e2.message, /chọn bàn/)
  const e3 = await sqlstate(asUser(admin, U.staff, (q) => save(q, { type: 'delivery', items: [item(1)] })))
  assert.match(e3.message, /giao hàng/)
})

test('lưu món nguyên tử: biến thể, topping, giá vốn, quyền', async () => {
  const mod = (await admin.query(`select id from modifiers where store_id=$1 limit 1`, [store])).rows[0].id
  const data = { code: 'TRA1', name: 'Trà đào', category_id: null, price: 30000, tax_rate: 8, is_active: true, sort_order: 2,
    variants: [{ name: 'M', price: 30000 }, { name: 'L', price: 38000 }], modifier_ids: [mod], cost_estimate: 11000 }
  const id = await asUser(admin, U.owner, (q) => q(`select rpc_save_product($1,null,$2::jsonb) id`, [store, JSON.stringify(data)]).then((r) => r.rows[0].id))
  const vars = (await admin.query(`select id, name from product_variants where product_id=$1 order by sort_order`, [id])).rows
  assert.equal(vars.length, 2)
  assert.equal((await admin.query(`select cost_estimate c from product_costs where product_id=$1`, [id])).rows[0].c, '11000')

  // Bỏ biến thể L: chỉ ngừng dùng, không xóa
  const upd = { ...data, variants: [{ id: vars[0].id, name: 'M', price: 31000 }] }
  await asUser(admin, U.owner, (q) => q(`select rpc_save_product($1,$2,$3::jsonb)`, [store, id, JSON.stringify(upd)]))
  const after = (await admin.query(`select name, is_active, price from product_variants where product_id=$1 order by sort_order`, [id])).rows
  assert.equal(after.length, 2)
  assert.equal(after.find((v) => v.name === 'L').is_active, false)
  assert.equal(after.find((v) => v.name === 'M').price, '31000')

  // Mã trùng bị từ chối, không để dữ liệu nửa chừng
  const dup = await sqlstate(asUser(admin, U.owner, (q) => q(`select rpc_save_product($1,null,$2::jsonb)`, [store, JSON.stringify({ ...data, variants: [{ name: 'X', price: 1 }] })])))
  assert.equal(dup.code, '23505')
  assert.equal((await admin.query(`select count(*)::int n from product_variants where name='X'`)).rows[0].n, 0)

  // Thu ngân không có quyền; manager không có quyền xem giá vốn thì không ghi được giá vốn
  const noPerm = await sqlstate(asUser(admin, U.cashier, (q) => q(`select rpc_save_product($1,null,$2::jsonb)`, [store, JSON.stringify({ ...data, code: 'Z' })])))
  assert.match(noPerm.message, /không có quyền/)
})
