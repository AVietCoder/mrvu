import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store, receipt
const U = { owner: '00000000-0000-0000-0000-0000000000b1', cashier: '00000000-0000-0000-0000-0000000000b2', staff: '00000000-0000-0000-0000-0000000000b3' }
const ins = (kind, uid, extra = {}) => [`insert into receipt_print_jobs (store_id, receipt_id, kind, requested_by, reason) values ($1,$2,$3::print_kind,$4,$5)`, [store, extra.receipt ?? receipt, kind, extra.by ?? uid, extra.reason ?? null]]

before(async () => {
  db = await startDb(); admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán in') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    await q(`select rpc_set_user_role($1,$2,'staff')`, [store, U.staff])
    const prod = (await q(`insert into products (store_id, code, name, price) values ($1,'CF','Cà phê',25000) returning id`, [store])).rows[0].id
    const o = (await q(`select rpc_save_order($1,null,'takeaway',null,null,'',0,0,0,$2::jsonb,null,'open') r`, [store, JSON.stringify([{ product_id: prod, quantity: 1 }])])).rows[0].r
    const id = o.id ?? o.order_id ?? o
    const p = (await q(`select rpc_pay_order($1,$2::jsonb,'k1') r`, [id, JSON.stringify([{ method_code: 'cash', amount: 25000, tendered: 25000 }])])).rows[0].r
    receipt = p.receipt_id
  })
})
after(async () => { await db?.stop() })

test('cửa hàng mới mặc định in giả lập; phương thức không hợp lệ bị từ chối', async () => {
  assert.equal((await admin.query(`select method from print_settings where store_id=$1`, [store])).rows[0].method, 'simulator')
  await asUser(admin, U.owner, async (q) => {
    await q(`update print_settings set method='qz_tray', printer_name='XP-80' where store_id=$1`, [store])
    await expectFail(q, `update print_settings set method='windows_driver' where store_id=$1`, [store], /check/i)
  })
})

test('chỉ người có settings.manage được đổi cài đặt máy in', async () => {
  await asUser(admin, U.cashier, async (q) => {
    const r = await q(`update print_settings set printer_name='X' where store_id=$1`, [store])
    assert.equal(r.rowCount, 0)
  })
})

test('mỗi hóa đơn chỉ một lệnh in tự động; bản thứ hai bị chặn', async () => {
  await asUser(admin, U.cashier, async (q) => {
    await q(...ins('receipt', U.cashier))
    await expectFail(q, ...ins('receipt', U.cashier), /duplicate|unique/i)
  })
})

test('requested_by phải là chính người gọi', async () => {
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, ...ins('kitchen', U.cashier, { by: U.owner, receipt: null }), /row-level security/i)
  })
})

test('in lại cần quyền order.reprint và lý do', async () => {
  await asUser(admin, U.staff, async (q) => { await expectFail(q, ...ins('reprint', U.staff, { reason: 'Khách yêu cầu' }), /row-level security/i) })
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, ...ins('reprint', U.cashier), /row-level security/i)
    await expectFail(q, ...ins('reprint', U.cashier, { reason: '  ' }), /row-level security/i)
    await q(...ins('reprint', U.cashier, { reason: 'Khách làm mất bill' }))
    await q(...ins('reprint', U.cashier, { reason: 'Máy in kẹt giấy' })) // in lại nhiều lần được phép
  })
  assert.equal(Number((await admin.query(`select count(*) c from receipt_print_jobs where kind='reprint'`)).rows[0].c), 2)
})

test('in thử cần settings.manage', async () => {
  await asUser(admin, U.cashier, async (q) => { await expectFail(q, ...ins('test', U.cashier, { receipt: null }), /row-level security/i) })
  await asUser(admin, U.owner, async (q) => { await q(...ins('test', U.owner, { receipt: null })) })
})

test('nhân viên phục vụ vẫn đọc được trạng thái lệnh in của cửa hàng', async () => {
  await asUser(admin, U.staff, async (q) => {
    assert.ok(Number((await q(`select count(*) c from receipt_print_jobs`)).rows[0].c) >= 3)
  })
})
