import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store, prod, cat
const U = { owner: '00000000-0000-0000-0000-0000000000d1', cashier: '00000000-0000-0000-0000-0000000000d2', cashier2: '00000000-0000-0000-0000-0000000000d3', staff: '00000000-0000-0000-0000-0000000000d4' }

const sell = async (uid, qty, method = 'cash', key = Math.random().toString(36)) => asUser(admin, uid, async (q) => {
  const o = (await q(`select rpc_save_order($1,null,'takeaway',null,null,'',0,0,0,$2::jsonb,null,'open') r`, [store, JSON.stringify([{ product_id: prod, quantity: qty }])])).rows[0].r
  const id = o.id ?? o.order_id ?? o
  await q(`select rpc_pay_order($1,$2::jsonb,$3)`, [id, JSON.stringify([{ method_code: method, amount: 25000 * qty, ...(method === 'cash' ? { tendered: 25000 * qty } : {}) }]), key])
  return id
})

before(async () => {
  db = await startDb(); admin = db.admin
  for (const [k, id] of Object.entries(U)) await admin.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`])
  await asUser(admin, U.owner, async (q) => {
    store = (await q(`select rpc_bootstrap_store('Quán ca') id`)).rows[0].id
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier])
    await q(`select rpc_set_user_role($1,$2,'cashier')`, [store, U.cashier2])
    await q(`select rpc_set_user_role($1,$2,'staff')`, [store, U.staff])
    prod = (await q(`insert into products (store_id, code, name, price) values ($1,'CF','Cà phê',25000) returning id`, [store])).rows[0].id
    cat = (await q(`select id from cash_categories where store_id=$1 and name='Chi khác'`, [store])).rows[0].id
  })
})
after(async () => { await db?.stop() })

test('mở ca: một người một ca; nhân viên phục vụ không mở được; tiền đầu ca hợp lệ', async () => {
  await asUser(admin, U.staff, async (q) => { await expectFail(q, `select rpc_open_shift($1,0)`, [store], /không có quyền/) })
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_open_shift($1,-1)`, [store], /không hợp lệ/)
    await expectFail(q, `select rpc_open_shift($1,100.5)`, [store], /không hợp lệ/)
    await q(`select rpc_open_shift($1,500000)`, [store])
    await expectFail(q, `select rpc_open_shift($1,0)`, [store], /đang có một ca/)
  })
})

test('thu chi tiền mặt cần ca mở, gắn đúng ca, không ghi trực tiếp bằng bảng', async () => {
  await asUser(admin, U.cashier2, async (q) => {
    await expectFail(q, `select rpc_add_cash_tx($1,'expense',$2,10000,'cash','Mua đá')`, [store, cat], /mở ca/)
    await q(`select rpc_add_cash_tx($1,'expense',$2,10000,'transfer','Trả bằng chuyển khoản')`, [store, cat]) // không phải tiền mặt: không cần ca
  })
  await asUser(admin, U.cashier, async (q) => {
    await q(`select rpc_add_cash_tx($1,'expense',$2,50000,'cash','Mua đá viên')`, [store, cat])
    await q(`select rpc_add_cash_tx($1,'income',null,20000,'cash','Khách trả thừa gửi lại')`, [store])
    await expectFail(q, `select rpc_add_cash_tx($1,'expense',$2,0,'cash','x y z')`, [store, cat], /không hợp lệ/)
    await expectFail(q, `select rpc_add_cash_tx($1,'expense',$2,5000,'cash','')`, [store, cat], /diễn giải/)
    await expectFail(q, `select rpc_add_cash_tx($1,'income',$2,5000,'cash','Sai danh mục')`, [store, cat], /Danh mục/)
    await expectFail(q, `insert into cash_transactions (store_id,type,amount,created_by) values ($1,'expense',1,$2)`, [store, U.cashier], /permission denied|row-level/)
  })
  await asUser(admin, U.staff, async (q) => { await expectFail(q, `select rpc_add_cash_tx($1,'expense',$2,1000,'cash','Không đủ quyền')`, [store, cat], /không có quyền/) })
})

test('đóng ca: dự kiến = đầu ca + bán tiền mặt + thu - chi - hoàn; chuyển khoản không tính vào két', async () => {
  const o1 = await sell(U.cashier, 2)            // +50.000 tiền mặt
  await sell(U.cashier, 1)                       // +25.000 tiền mặt
  await sell(U.cashier, 3, 'transfer')           // 75.000 chuyển khoản
  // hoàn tiền mặt một phần 10.000 do chủ quán thực hiện (thu ngân không có quyền hoàn)
  await asUser(admin, U.owner, async (q) => { await q(`select rpc_refund_order($1,10000,'Khách đổi ý','cash','rf-1')`, [o1]) })
  const refundedByOwner = Number((await admin.query(`select coalesce(sum(amount),0) a from refunds`)).rows[0].a)
  let shift
  await asUser(admin, U.cashier, async (q) => {
    shift = (await q(`select id from shifts where opened_by=$1 and status='open'`, [U.cashier])).rows[0].id
    const s = (await q(`select shift_summary($1) r`, [shift])).rows[0].r
    assert.equal(Number(s.cash_sales), 75000); assert.equal(Number(s.other_sales.transfer), 75000)
    assert.equal(Number(s.cash_in), 20000); assert.equal(Number(s.cash_out), 50000)
    assert.equal(Number(s.cash_refunds), 0) // hoàn do người khác (chủ) không trừ vào ca của thu ngân
    assert.equal(Number(s.expected_cash), 500000 + 75000 + 20000 - 50000)
    assert.equal(s.orders, 3)
  })
  assert.equal(refundedByOwner, 10000)
  await asUser(admin, U.cashier, async (q) => {
    await expectFail(q, `select rpc_close_shift($1,540000,'')`, [shift], /lệch.*ghi lý do/)
    await expectFail(q, `select rpc_close_shift($1,-5,'x y z')`, [shift], /không hợp lệ/)
    const r = (await q(`select rpc_close_shift($1,540000,'Thiếu 5.000 do trả nhầm tiền thối') r`, [shift])).rows[0].r
    assert.equal(Number(r.difference), -5000); assert.equal(Number(r.expected_cash), 545000)
    await expectFail(q, `select rpc_close_shift($1,545000,'')`, [shift], /đã đóng/)
  })
  const row = (await admin.query(`select status, expected_cash, counted_cash, difference, note from shifts where id=$1`, [shift])).rows[0]
  assert.equal(row.status, 'closed'); assert.equal(Number(row.difference), -5000)
})

test('đóng ca khớp tiền không cần lý do; ca của người khác chỉ quản lý đóng được', async () => {
  let s2
  await asUser(admin, U.cashier2, async (q) => { s2 = (await q(`select rpc_open_shift($1,100000) id`, [store])).rows[0].id })
  await asUser(admin, U.cashier, async (q) => { await expectFail(q, `select rpc_close_shift($1,100000,'')`, [s2], /Chỉ người mở ca/) })
  await asUser(admin, U.owner, async (q) => {
    const r = (await q(`select rpc_close_shift($1,100000,'') r`, [s2])).rows[0].r
    assert.equal(Number(r.difference), 0)
  })
})

test('hoàn tiền mặt do chính người mở ca thực hiện được trừ khỏi két', async () => {
  // cho thu ngân quyền hoàn tiền tạm thời để kiểm thử đường tính
  await admin.query(`insert into role_permissions (role, permission) values ('cashier','order.refund') on conflict do nothing`)
  const id = await (async () => {
    await asUser(admin, U.cashier, async (q) => { await q(`select rpc_open_shift($1,0)`, [store]) })
    return sell(U.cashier, 2)
  })()
  await asUser(admin, U.cashier, async (q) => {
    await q(`select rpc_refund_order($1,20000,'Món lỗi','cash','rf-cash-1')`, [id])
    const sh = (await q(`select id from shifts where opened_by=$1 and status='open'`, [U.cashier])).rows[0].id
    const s = (await q(`select shift_summary($1) r`, [sh])).rows[0].r
    assert.equal(Number(s.cash_refunds), 20000); assert.equal(Number(s.expected_cash), 50000 - 20000)
  })
  await admin.query(`delete from role_permissions where role='cashier' and permission='order.refund'`)
})

test('hủy/ghi nhật ký: mở ca, đóng ca, thu chi có audit', async () => {
  const r = await admin.query(`select action, count(*)::int c from audit_logs where action in ('shift.open','shift.close','cash.expense','cash.income') group by action`)
  const m = Object.fromEntries(r.rows.map((x) => [x.action, x.c]))
  assert.ok(m['shift.open'] >= 3 && m['shift.close'] >= 2 && m['cash.expense'] >= 2 && m['cash.income'] >= 1)
})
