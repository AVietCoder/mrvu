import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin
const U = {
  owner: '00000000-0000-0000-0000-000000000001',
  cashier: '00000000-0000-0000-0000-000000000002',
  staff: '00000000-0000-0000-0000-000000000003',
  outsider: '00000000-0000-0000-0000-000000000004',
}
let store, otherStore, product, variant, option, orderRow

before(async () => {
  db = await startDb()
  admin = db.admin
  for (const [k, id] of Object.entries(U)) {
    await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@mrvu.test`])
  }
})
after(async () => { await db?.stop() })

test('profile được tạo tự động khi có tài khoản mới', async () => {
  const r = await admin.query('select count(*)::int n from profiles')
  assert.equal(r.rows[0].n, 4)
})

test('người đầu tiên khởi tạo cửa hàng thành Owner, người sau bị chặn', async () => {
  await asUser(admin, U.owner, async (q) => {
    const r = await q(`select rpc_bootstrap_store('MR.VŨ COFFEE', 'Hà Nội', '0900000000') id`)
    store = r.rows[0].id
  })
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_bootstrap_store('Cửa hàng giả')`, [], /đã được khởi tạo/)
  })
  const m = await admin.query(`select count(*)::int n from payment_methods where store_id=$1`, [store])
  assert.equal(m.rows[0].n, 2)
})

test('Owner cấp vai trò; thu ngân không tự nâng quyền', async () => {
  await asUser(admin, U.owner, async (q) => {
    await q(`select rpc_set_user_role($1, $2, 'cashier')`, [store, U.cashier])
    await q(`select rpc_set_user_role($1, $2, 'staff')`, [store, U.staff])
  })
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_set_user_role($1, $2, 'owner')`, [store, U.cashier], /quản lý người dùng/)
    const hack = await q(`update user_roles set role='owner' where user_id=$1`, [U.cashier])
    assert.equal(hack.rowCount, 0) // RLS: không có policy ghi nên không dòng nào bị sửa
    const r = await q(`select role from user_roles where user_id=$1`, [U.cashier])
    assert.equal(r.rows[0].role, 'cashier')
  })
  await asUser(admin, U.owner, async (q) => {
    await expectFail(q, `select rpc_set_user_role($1, $2, 'staff')`, [store, U.owner], /ít nhất một Owner/)
  })
})

test('thực đơn: staff chỉ đọc, không thấy giá vốn', async () => {
  await asUser(admin, U.owner, async (q) => {
    const c = await q(`insert into categories (store_id, name) values ($1,'Cà phê') returning id`, [store])
    const p = await q(
      `insert into products (store_id, category_id, code, name, price) values ($1,$2,'CF01','Cà phê sữa',25000) returning id`,
      [store, c.rows[0].id])
    product = p.rows[0].id
    const v = await q(`insert into product_variants (product_id, store_id, name, price) values ($1,$2,'Size L',32000) returning id`, [product, store])
    variant = v.rows[0].id
    const m = await q(`insert into modifiers (store_id, name, max_select) values ($1,'Topping',3) returning id`, [store])
    const o = await q(`insert into modifier_options (modifier_id, store_id, name, price_delta) values ($1,$2,'Trân châu',5000) returning id`, [m.rows[0].id, store])
    option = o.rows[0].id
    await q(`insert into product_modifiers (product_id, modifier_id) values ($1,$2)`, [product, m.rows[0].id])
    await q(`insert into product_costs (product_id, store_id, cost_estimate) values ($1,$2,9000)`, [product, store])
    const costs = await q(`select * from product_costs`)
    assert.equal(costs.rows.length, 1)
  })
  await asUser(admin, U.staff, async (q) => {
    assert.equal((await q(`select * from products`)).rows.length, 1)
    assert.equal((await q(`select * from product_costs`)).rows.length, 0)
    await expectFail(q, `insert into products (store_id, code, name, price) values ($1,'X','X',1)`, [store])
    const hack = await q(`update products set name='hack' where id=$1`, [product])
    assert.equal(hack.rowCount, 0)
  })
  await asUser(admin, U.cashier, async (q) => {
    assert.equal((await q(`select * from product_costs`)).rows.length, 0)
    const upd = await q(`update products set price=1 where id=$1`, [product])
    assert.equal(upd.rowCount, 0) // RLS: không có quyền menu.manage
  })
})

test('cách ly dữ liệu giữa các cửa hàng', async () => {
  const s = await admin.query(`insert into stores (name) values ('Chi nhánh khác') returning id`)
  otherStore = s.rows[0].id
  await admin.query(`insert into categories (store_id, name) values ($1,'Bí mật')`, [otherStore])
  await asUser(admin, U.owner, async (q) => {
    assert.equal((await q(`select * from categories where store_id=$1`, [otherStore])).rows.length, 0)
    assert.equal((await q(`select * from stores`)).rows.length, 1)
  })
  await asUser(admin, U.outsider, async (q) => {
    assert.equal((await q(`select * from stores`)).rows.length, 0)
    assert.equal((await q(`select * from products`)).rows.length, 0)
  })
})

const SAVE = `select rpc_save_order($1,$2,$3::order_type,$4,null,$5,$6,$7,$8,$9::jsonb,$10,$11::order_status) r`
const saveArgs = (o) => [store, o.id ?? null, o.type ?? 'takeaway', o.table ?? null, o.note ?? '', o.discAmt ?? 0,
  o.discPct ?? 0, o.surcharge ?? 0, JSON.stringify(o.items), o.version ?? null, o.status ?? 'open']

test('đơn hàng: client không ghi trực tiếp, giá lấy từ database', async () => {
  await asUser(admin, U.staff, async (q) => {
    // Ghi trực tiếp bị từ chối (RLS không có policy ghi)
    await expectFail(q, `insert into orders (store_id, code, type, status, created_by) values ($1,'HACK','takeaway','open',$2)`, [store, U.staff])

    const r = await q(SAVE, saveArgs({ items: [{ product_id: product, variant_id: variant, quantity: 2, option_ids: [option] }] }))
    orderRow = r.rows[0].r
    // (32.000 + 5.000) x 2 = 74.000, giá lấy từ danh mục
    assert.equal(orderRow.total, 74000)
    await expectFail(q, SAVE, saveArgs({ id: orderRow.id, version: orderRow.version,
      items: [{ product_id: product, variant_id: variant, quantity: 1, price_override: 1000 }] }), /quyền thay đổi giá/)
    await expectFail(q, SAVE, saveArgs({ id: orderRow.id, version: orderRow.version, discAmt: 10000,
      items: [{ product_id: product, variant_id: variant, quantity: 1 }] }), /quyền áp dụng giảm giá/)
    const tamper = await q(`update orders set total=1 where id=$1`, [orderRow.id])
    assert.equal(tamper.rowCount, 0) // không có policy ghi
  })
  const chk = await admin.query(`select total from orders where id=$1`, [orderRow.id])
  assert.equal(chk.rows[0].total, '74000')
})

test('owner được giảm giá; tổng tính trong DB', async () => {
  await asUser(admin, U.owner, async (q) => {
    const cur = await q(`select version from orders where id=$1`, [orderRow.id])
    const r = await q(SAVE, saveArgs({ id: orderRow.id, version: cur.rows[0].version, discAmt: 4000, discPct: 10,
      items: [{ product_id: product, variant_id: variant, quantity: 2, option_ids: [option] }] }))
    // giảm 4.000 + 10% của 74.000 (7.400) = 11.400
    assert.equal(r.rows[0].r.total, 74000 - 11400)
    orderRow = r.rows[0].r
  })
})

test('hóa đơn đã thanh toán không bị sửa hoặc xóa cứng', async () => {
  let id
  await asUser(admin, U.owner, async (q) => {
    id = orderRow.id
    await q(`select rpc_pay_order($1, $2::jsonb, 'key-rls-1')`, [id, JSON.stringify([{ method_code: 'cash', amount: orderRow.total }])])
    const del = await q(`delete from orders where id=$1`, [id])
    assert.equal(del.rowCount, 0)
    const r = await q(`update orders set note='sửa' where id=$1`, [id])
    assert.equal(r.rowCount, 0)
  })
  // Ngay cả superuser cũng không xóa được đơn đã thanh toán.
  await assert.rejects(admin.query(`delete from orders where id=$1`, [id]), /Không được xóa đơn/)
  await assert.rejects(admin.query(`update orders set note='x' where id=$1`, [id]), /không được sửa trực tiếp/)
  await assert.rejects(admin.query(`delete from payments where order_id=$1`, [id]), /chỉ được thêm mới/)
  await assert.rejects(admin.query(`delete from receipts where order_id=$1`, [id]), /chỉ được thêm mới/)
})

test('sổ kho, nhật ký, thanh toán là bất biến; tồn kho không sửa trực tiếp', async () => {
  const ing = await admin.query(
    `insert into ingredients (store_id, name, unit) values ($1,'Cà phê hạt','g') returning id`, [store])
  const iid = ing.rows[0].id
  await admin.query(
    `insert into stock_movements (store_id, ingredient_id, type, quantity, reason) values ($1,$2,'opening',1000,'Tồn đầu')`,
    [store, iid])
  const s = await admin.query(`select current_stock from ingredients where id=$1`, [iid])
  assert.equal(s.rows[0].current_stock, '1000.000')

  await asUser(admin, U.owner, async (q) => {
    await expectFail(q, `update ingredients set current_stock=999999 where id=$1`, [iid], /tồn kho/)
    await expectFail(q, `insert into stock_movements (store_id, ingredient_id, type, quantity) values ($1,$2,'adjustment',5)`, [store, iid])
    await expectFail(q, `insert into ingredients (store_id, name, unit, current_stock) values ($1,'Gian lận','g',500)`, [store], /tồn bằng 0/)
    await expectFail(q, `insert into audit_logs (store_id, action, entity) values ($1,'x','y')`, [store])
  })
  await assert.rejects(admin.query(`update stock_movements set quantity=1`), /chỉ được thêm mới/)
  await assert.rejects(admin.query(`delete from audit_logs`), /chỉ được thêm mới/)
})

test('nhật ký chỉ người có quyền audit.view mới đọc', async () => {
  await asUser(admin, U.cashier, async (q) => {
    assert.equal((await q(`select * from audit_logs`)).rows.length, 0)
  })
  await asUser(admin, U.owner, async (q) => {
    assert.ok((await q(`select * from audit_logs`)).rows.length >= 2)
  })
})

test('khóa tài khoản làm mất quyền ngay', async () => {
  await asUser(admin, U.owner, async (q) => { await q(`select rpc_set_user_active($1,$2,false)`, [store, U.staff]) })
  await asUser(admin, U.staff, async (q) => {
    assert.equal((await q(`select * from products`)).rows.length, 0)
  })
})
