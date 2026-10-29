import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, asUser, expectFail } from './harness.mjs'

let db, admin, store
const ids = {}

// Như máy chủ Supabase Auth kiểm mật khẩu: so bcrypt trong auth.users.
async function passwordOk(username, password) {
  const r = await admin.query(
    `select encrypted_password = crypt($2, encrypted_password) ok from auth.users where email = login_email($1)`, [username, password])
  return r.rows[0]?.ok === true
}

async function asAnon(fn) {
  await admin.query('begin')
  try {
    await admin.query('set local role anon')
    const r = await fn((sql, params) => admin.query(sql, params))
    await admin.query('commit')
    return r
  } catch (e) {
    await admin.query('rollback')
    throw e
  }
}

before(async () => { db = await startDb(); admin = db.admin })
after(async () => { await db?.stop() })

test('cài đặt lần đầu ngay trên màn hình đăng nhập (chưa đăng nhập)', async () => {
  await asAnon(async (q) => {
    assert.equal((await q('select rpc_setup_status() s')).rows[0].s, false)
    await q(`select rpc_first_setup('MR.VŨ COFFEE', 'Hà Nội', '0900000000', 'Anh Vũ', 'Chu.Quan', 'matkhau1')`)
    assert.equal((await q('select rpc_setup_status() s')).rows[0].s, true)
  })
  const u = await admin.query(`select u.id, u.email, u.email_confirmed_at, u.aud, u.confirmation_token, p.full_name,
      r.role, r.store_id, (select count(*)::int from auth.identities i where i.user_id = u.id and i.provider = 'email') idn
    from auth.users u join profiles p on p.id = u.id join user_roles r on r.user_id = u.id`)
  assert.equal(u.rows.length, 1)
  const o = u.rows[0]
  assert.equal(o.email, 'chu.quan@mrvu-cafe.local')
  assert.ok(o.email_confirmed_at)
  assert.equal(o.aud, 'authenticated')
  assert.equal(o.confirmation_token, '')
  assert.equal(o.full_name, 'Anh Vũ')
  assert.equal(o.role, 'owner')
  assert.equal(o.idn, 1)
  assert.ok(await passwordOk('chu.quan', 'matkhau1'))
  assert.ok(!(await passwordOk('chu.quan', 'sai')))
  ids.owner = o.id
  store = o.store_id
  const pm = await admin.query('select count(*)::int n from payment_methods where store_id=$1', [store])
  assert.equal(pm.rows[0].n, 2)
})

test('cài đặt lần đầu chỉ chạy được một lần', async () => {
  await asAnon(async (q) => {
    await expectFail(q, `select rpc_first_setup('Quán giả', '', '', 'Kẻ lạ', 'kela', 'matkhau1')`, [], /đã được cài đặt/)
  })
  const n = await admin.query(`select count(*)::int n from auth.users`)
  assert.equal(n.rows[0].n, 1)
})

test('khách chưa đăng nhập không gọi được hàm tạo tài khoản', async () => {
  await asAnon(async (q) => {
    await expectFail(q, `select create_login('x123', 'matkhau1', 'X')`, [], /permission denied/)
    await expectFail(q, `select rpc_create_staff($1, 'x123', 'matkhau1', 'X', 'cashier')`, [store], /permission denied/)
  })
})

test('Owner tạo nhân viên bằng tên đăng nhập; trùng tên / tên sai / mật khẩu ngắn bị chặn', async () => {
  await asUser(admin, ids.owner, async (q) => {
    ids.manager = (await q(`select rpc_create_staff($1, 'quanly', 'matkhau2', 'Quản lý', 'manager') id`, [store])).rows[0].id
    ids.cashier = (await q(`select rpc_create_staff($1, 'thungan1', 'matkhau3', 'Thu ngân', 'cashier') id`, [store])).rows[0].id
    await expectFail(q, `select rpc_create_staff($1, 'ThuNgan1', 'matkhau3', 'Trùng', 'staff')`, [store], /đã có người dùng/)
    await expectFail(q, `select rpc_create_staff($1, 'thu ngân', 'matkhau3', 'Sai', 'staff')`, [store], /Tên đăng nhập/)
    await expectFail(q, `select rpc_create_staff($1, 'ngan', '123', 'Ngắn', 'staff')`, [store], /ít nhất 6/)
  })
  const r = await admin.query(`select role from user_roles where user_id=$1`, [ids.cashier])
  assert.equal(r.rows[0].role, 'cashier')
  assert.ok(await passwordOk('thungan1', 'matkhau3'))
})

test('Quản lý không tạo được Owner; lỗi thì không để lại tài khoản rác', async () => {
  // Mặc định chỉ Owner có users.manage; cấp thêm cho Quản lý để thử quy tắc "chỉ Owner đụng tới Owner".
  await admin.query(`insert into role_permissions (role, permission) values ('manager', 'users.manage')`)
  await asUser(admin, ids.manager, async (q) => {
    await expectFail(q, `select rpc_create_staff($1, 'chu2', 'matkhau1', 'Chủ 2', 'owner')`, [store], /Chỉ chủ cửa hàng/)
  })
  const n = await admin.query(`select count(*)::int n from auth.users where email = login_email('chu2')`)
  assert.equal(n.rows[0].n, 0)
})

test('thu ngân không tạo được tài khoản', async () => {
  await asUser(admin, ids.cashier, async (q) => {
    await expectFail(q, `select rpc_create_staff($1, 'thungan2', 'matkhau1', 'TN2', 'cashier')`, [store], /quản lý người dùng/)
  })
})

test('đổi mật khẩu: tự đổi, quản lý đổi cho nhân viên, chỉ Owner đổi được của Owner', async () => {
  await asUser(admin, ids.cashier, async (q) => {
    await q(`select rpc_set_password($1, $2, 'moi12345')`, [store, ids.cashier])
    await expectFail(q, `select rpc_set_password($1, $2, 'hack1234')`, [store, ids.manager], /quản lý người dùng/)
  })
  assert.ok(await passwordOk('thungan1', 'moi12345'))
  await asUser(admin, ids.manager, async (q) => {
    await q(`select rpc_set_password($1, $2, 'reset123')`, [store, ids.cashier])
    await expectFail(q, `select rpc_set_password($1, $2, 'hack1234')`, [store, ids.owner], /Chỉ chủ cửa hàng/)
    await expectFail(q, `select rpc_set_password($1, $2, '12')`, [store, ids.cashier], /ít nhất 6/)
  })
  assert.ok(await passwordOk('thungan1', 'reset123'))
  assert.ok(await passwordOk('chu.quan', 'matkhau1'))
  await asUser(admin, ids.owner, async (q) => {
    await q(`select rpc_set_password($1, $2, 'owner999')`, [store, ids.owner])
  })
  assert.ok(await passwordOk('chu.quan', 'owner999'))
  const logs = await admin.query(`select count(*)::int n from audit_logs where action = 'user.set_password'`)
  assert.equal(logs.rows[0].n, 3)
})
