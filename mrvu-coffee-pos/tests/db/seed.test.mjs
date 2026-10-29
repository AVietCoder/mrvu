import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { startDb, asUser } from './harness.mjs'

let db, admin
const OWNER = '00000000-0000-0000-0000-0000000000f1'
before(async () => { db = await startDb(); admin = db.admin; await admin.query(`insert into auth.users (id, email) values ($1,'o@t.test')`, [OWNER]) })
after(async () => { await db?.stop() })

test('setup_all.sql gộp đủ migration và chạy được trên DB trống', async () => {
  const files = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  const all = fs.readFileSync('supabase/setup_all.sql', 'utf8')
  for (const f of files) assert.ok(all.includes(`===== ${f} =====`), `thiếu ${f} trong setup_all.sql (chạy: node scripts/build-setup-sql.mjs)`)
  const solo = await startDb({ setupFile: 'supabase/setup_all.sql' })
  try {
    const count = async (c) => (await c.query(`select (select count(*) from pg_tables where schemaname='public')::int t, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')::int f, (select count(*) from pg_policies)::int p`)).rows[0]
    assert.deepEqual(await count(solo.admin), await count(admin)) // cùng số bảng, hàm, chính sách RLS như chạy từng migration
  } finally { await solo.stop() }
})

test('dữ liệu mẫu: chạy sau khi có cửa hàng, thêm đủ, chạy lại không nhân đôi, bán trừ kho theo công thức', async () => {
  await assert.rejects(admin.query(fs.readFileSync('supabase/seed_demo.sql', 'utf8')), /Chưa có cửa hàng/)
  let store
  await asUser(admin, OWNER, async (q) => { store = (await q(`select rpc_bootstrap_store('Quán thử') id`)).rows[0].id })
  const seed = fs.readFileSync('supabase/seed_demo.sql', 'utf8')
  await admin.query(seed); await admin.query(seed)
  const n = async (t) => Number((await admin.query(`select count(*) c from ${t} where store_id=$1`, [store])).rows[0].c)
  assert.equal(await n('products'), 4); assert.equal(await n('ingredients'), 4); assert.equal(await n('tables'), 4); assert.equal(await n('product_recipes'), 5)
  assert.equal(await n('modifiers'), 3)
  await asUser(admin, OWNER, async (q) => {
    const p = (await q(`select id from products where store_id=$1 and code='CF01'`, [store])).rows[0].id
    const o = (await q(`select rpc_save_order($1,null,'takeaway',null,null,'',0,0,0,$2::jsonb,null,'open') r`, [store, JSON.stringify([{ product_id: p, quantity: 3 }])])).rows[0].r
    await q(`select rpc_pay_order($1,$2::jsonb,'seed-1')`, [o.id ?? o.order_id ?? o, JSON.stringify([{ method_code: 'cash', amount: 60000, tendered: 100000 }])])
  })
  assert.equal(Number((await admin.query(`select current_stock s from ingredients where store_id=$1 and name='Cà phê hạt'`, [store])).rows[0].s), 2000 - 54)
})
