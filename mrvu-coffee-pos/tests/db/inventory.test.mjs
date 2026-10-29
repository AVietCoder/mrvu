import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store, ing1, ing2, prod, variant, other, stocktakeBefore
const U = { owner: '00000000-0000-0000-0000-0000000000c1', cashier: '00000000-0000-0000-0000-0000000000c2', manager: '00000000-0000-0000-0000-0000000000c3' }
const stock = async (id) => Number((await admin.query(`select current_stock s from ingredients where id=$1`, [id])).rows[0].s)

before(async () => {
  db = await startDb(); admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán kho') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    await q(`select rpc_set_user_role($1,$2,'manager')`, [store, U.manager])
    ing1 = (await q(`insert into ingredients (store_id, name, unit, min_stock) values ($1,'Cà phê hạt','g',500) returning id`, [store])).rows[0].id
    ing2 = (await q(`insert into ingredients (store_id, name, unit) values ($1,'Sữa đặc','ml') returning id`, [store])).rows[0].id
    prod = (await q(`insert into products (store_id, code, name, price) values ($1,'CF','Cà phê sữa',25000) returning id`, [store])).rows[0].id
    variant = (await q(`insert into product_variants (product_id, store_id, name, price) values ($1,$2,'L',30000) returning id`, [prod, store])).rows[0].id
  })
  other = (await admin.query(`insert into stores (name) values ('Quán khác') returning id`)).rows[0].id
})
after(async () => { await db?.stop() })

const items = (...l) => JSON.stringify(l.map(([ingredient_id, quantity, unit_cost]) => ({ ingredient_id, quantity, unit_cost })))
const save = (q, o) => q(`select rpc_save_purchase($1,$2,$3,$4,$5::jsonb,$6::po_status) id`, [store, o.id ?? null, o.supplier ?? null, o.note ?? '', o.items, o.status ?? 'draft']).then((r) => r.rows[0].id)

test('nhập hàng: lưu nháp, nhận hàng cộng kho đúng một lần, ghi giá nhập', async () => {
  let po
  await asUser(admin, U.manager, async (q) => {
    po = await save(q, { items: items([ing1, 1000, 300], [ing2, 2000, 45]) })
    const row = (await q(`select code, total, status from purchase_orders where id=$1`, [po])).rows[0]
    assert.match(row.code, /^PN-\d{6}-001$/); assert.equal(Number(row.total), 390000); assert.equal(row.status, 'draft')
    po = await save(q, { id: po, items: items([ing1, 1000, 300], [ing2, 1000, 50]), status: 'ordered' }) // sửa phiếu
    assert.equal(Number((await q(`select total from purchase_orders where id=$1`, [po])).rows[0].total), 350000)
    assert.equal(Number((await q(`select count(*) c from purchase_order_items where purchase_order_id=$1`, [po])).rows[0].c), 2)
  })
  assert.equal(await stock(ing1), 0)
  await asUser(admin, U.manager, async (q) => {
    const a = (await q(`select rpc_receive_purchase($1) r`, [po])).rows[0].r
    assert.equal(a.replayed, false)
    const b = (await q(`select rpc_receive_purchase($1) r`, [po])).rows[0].r
    assert.equal(b.replayed, true)
    await expectFail(q, `select rpc_save_purchase($1,$2,null,'',$3::jsonb,'draft')`, [store, po, items([ing1, 1, 1])], /đã nhận/)
    await expectFail(q, `select rpc_cancel_purchase($1,'nhầm')`, [po], /đã nhận hàng/)
  })
  assert.equal(await stock(ing1), 1000); assert.equal(await stock(ing2), 1000) // không cộng đôi
  assert.equal(Number((await admin.query(`select count(*) c from ingredient_prices`)).rows[0].c), 2)
})

test('nhận hàng đồng thời hai lần chỉ cộng kho một lần', async () => {
  let po
  await asUser(admin, U.manager, async (q) => { po = await save(q, { items: items([ing1, 100, 300]) }) })
  const before = await stock(ing1)
  const run = async () => { const c = await db.connect(); try {
    await c.query('begin'); await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [U.manager])
    const r = (await c.query(`select rpc_receive_purchase($1) r`, [po])).rows[0].r; await c.query('commit'); return r } finally { await c.end() } }
  const res = await Promise.all([run(), run()])
  assert.deepEqual(res.map((r) => r.replayed).sort(), [false, true])
  assert.equal(await stock(ing1), before + 100)
})

test('phân quyền: thu ngân không nhập hàng, không điều chỉnh kho, không sửa công thức', async () => {
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_save_purchase($1,null,null,'',$2::jsonb,'draft')`, [store, items([ing1, 1, 1])], /không có quyền/)
    await expectFail(q, `select rpc_adjust_stock($1,$2,'waste',1,1,'đổ bỏ')`, [store, ing1], /không có quyền/)
    await expectFail(q, `select rpc_stocktake($1,'[]'::jsonb,'')`, [store], /không có quyền/)
    await expectFail(q, `select rpc_save_recipe($1,$2,null,'[]'::jsonb)`, [store, prod], /không có quyền/)
  })
})

test('hao hụt: cần lý do, không vượt tồn; điều chỉnh tăng/giảm ghi sổ và audit', async () => {
  await asUser(admin, U.manager, async (q) => {
    const s0 = await stock(ing1)
    await expectFail(q, `select rpc_adjust_stock($1,$2,'waste',5,1,'')`, [store, ing1], /lý do/)
    await expectFail(q, `select rpc_adjust_stock($1,$2,'waste',999999,1,'đổ bỏ')`, [store, ing1], /lớn hơn tồn kho/)
    await expectFail(q, `select rpc_adjust_stock($1,$2,'waste',0,1,'đổ bỏ')`, [store, ing1], /lớn hơn 0/)
    const left = (await q(`select rpc_adjust_stock($1,$2,'waste',50,1,'Đổ do hỏng') r`, [store, ing1])).rows[0].r
    assert.equal(Number(left), s0 - 50)
    await q(`select rpc_adjust_stock($1,$2,'adjustment',20,-1,'Kiểm lệch')`, [store, ing1])
    await q(`select rpc_adjust_stock($1,$2,'adjustment',5,1,'Tìm thấy thêm')`, [store, ing1])
  })
  assert.equal((await admin.query(`select count(*)::int c from audit_logs where action like 'stock.%'`)).rows[0].c, 3)
})

test('kiểm kho tạo phiếu điều chỉnh phần chênh lệch; số đúng thì không tạo gì', async () => {
  await asUser(admin, U.manager, async (q) => {
    const cur1 = await stock(ing1), cur2 = await stock(ing2)
    const n0 = Number((await q(`select count(*) c from stock_movements`)).rows[0].c)
    stocktakeBefore = cur1
    const r = (await q(`select rpc_stocktake($1,$2::jsonb,'Cuối ngày') r`, [store, JSON.stringify([{ ingredient_id: ing1, counted: cur1 - 10 }, { ingredient_id: ing2, counted: cur2 }])])).rows[0].r
    assert.equal(r.changed, 1)
    assert.equal(Number((await q(`select count(*) c from stock_movements`)).rows[0].c), n0 + 1)
    await expectFail(q, `select rpc_stocktake($1,$2::jsonb,'')`, [store, JSON.stringify([{ ingredient_id: ing1, counted: -1 }])], /không hợp lệ/)
  })
  assert.equal(await stock(ing1), stocktakeBefore - 10) // đã chỉnh về số đếm thực tế
})

test('sổ kho bất biến và tồn kho không sửa tay được', async () => {
  await asUser(admin, U.owner, async (q) => {
    await expectFail(q, `update ingredients set current_stock = 999 where id=$1`, [ing1], /.+/)
    await expectFail(q, `insert into stock_movements (store_id, ingredient_id, type, quantity) values ($1,$2,'adjustment',10)`, [store, ing1], /row-level security/)
  })
  await assert.rejects(admin.query(`update stock_movements set quantity = 1`), /.+/) // trigger bất biến chặn cả quản trị
  await assert.rejects(admin.query(`delete from stock_movements`), /.+/)
})

test('công thức món: thay trọn bộ, từ chối nguyên liệu của cửa hàng khác, bán trừ kho theo công thức', async () => {
  const foreign = (await admin.query(`insert into ingredients (store_id, name, unit) values ($1,'Lạ','g') returning id`, [other])).rows[0].id
  await asUser(admin, U.manager, async (q) => {
    await q(`select rpc_save_recipe($1,$2,null,$3::jsonb)`, [store, prod, JSON.stringify([{ ingredient_id: ing1, quantity: 18 }, { ingredient_id: ing2, quantity: 30 }])])
    await q(`select rpc_save_recipe($1,$2,null,$3::jsonb)`, [store, prod, JSON.stringify([{ ingredient_id: ing1, quantity: 20 }, { ingredient_id: ing2, quantity: 30 }])])
    assert.equal(Number((await q(`select count(*) c from product_recipes where product_id=$1`, [prod])).rows[0].c), 2)
    await expectFail(q, `select rpc_save_recipe($1,$2,null,$3::jsonb)`, [store, prod, JSON.stringify([{ ingredient_id: foreign, quantity: 1 }])], /không thuộc/)
  })
  const s1 = await stock(ing1), s2 = await stock(ing2)
  await asUser(admin, U.owner, async (q) => {
    const o = (await q(`select rpc_save_order($1,null,'takeaway',null,null,'',0,0,0,$2::jsonb,null,'open') r`, [store, JSON.stringify([{ product_id: prod, variant_id: variant, quantity: 2 }])])).rows[0].r
    await q(`select rpc_pay_order($1,$2::jsonb,'inv-1')`, [o.id ?? o.order_id ?? o, JSON.stringify([{ method_code: 'cash', amount: 60000, tendered: 60000 }])])
  })
  assert.equal(await stock(ing1), s1 - 40); assert.equal(await stock(ing2), s2 - 60)
})

test('hủy phiếu chưa nhận cần lý do; không dùng nhà cung cấp/nguyên liệu của cửa hàng khác', async () => {
  const foreign = (await admin.query(`insert into ingredients (store_id, name, unit) values ($1,'Lạ 2','g') returning id`, [other])).rows[0].id
  const foreignSup = (await admin.query(`insert into suppliers (store_id, name) values ($1,'NCC lạ') returning id`, [other])).rows[0].id
  await asUser(admin, U.manager, async (q) => {
    await expectFail(q, `select rpc_save_purchase($1,null,null,'',$2::jsonb,'draft')`, [store, items([foreign, 1, 1])], /không thuộc/)
    await expectFail(q, `select rpc_save_purchase($1,null,$2,'',$3::jsonb,'draft')`, [store, foreignSup, items([ing1, 1, 1])], /không thuộc/)
    const po = await save(q, { items: items([ing1, 1, 1]) })
    await expectFail(q, `select rpc_cancel_purchase($1,'')`, [po], /lý do/)
    await q(`select rpc_cancel_purchase($1,'Đặt nhầm')`, [po])
    await expectFail(q, `select rpc_receive_purchase($1)`, [po], /đã hủy/)
  })
})
