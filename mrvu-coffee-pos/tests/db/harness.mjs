// Khởi chạy PostgreSQL nhúng, giả lập schema auth của Supabase, áp dụng migration.
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const MIGRATIONS = path.resolve('supabase/migrations')

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb,
  instance_id uuid, aud varchar(255), role varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token varchar(255), recovery_token varchar(255), email_change_token_new varchar(255), email_change varchar(255));
create table auth.identities (id uuid primary key default gen_random_uuid(), provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null, provider text not null,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, unique (provider_id, provider));
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated, public;
create extension if not exists pgcrypto;
`

export async function startDb(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpos-'))
  const port = 54000 + Math.floor(Math.random() * 1000)
  // Ép UTF-8: trên Windows initdb mặc định WIN1252, không chứa được tiếng Việt.
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} })
  await server.initialise()
  await server.start()
  const admin = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' })
  await admin.connect()
  await admin.query(SUPABASE_STUB)
  // opts.setupFile: áp dụng đúng một tệp SQL gộp (kiểm tra gói cài đặt) thay vì từng migration.
  const files = opts.setupFile ? [] : fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  if (opts.setupFile) await admin.query(fs.readFileSync(opts.setupFile, 'utf8'))
  for (const f of files) {
    try {
      await admin.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} lỗi: ${e.message}`)
    }
  }
  const connect = async () => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' }); await c.connect(); return c }
  const stop = async () => { await admin.end(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }) }
  return { admin, stop, connect }
}

// Chạy truy vấn với tư cách người dùng đã đăng nhập (RLS có hiệu lực).
export async function asUser(admin, userId, fn) {
  await admin.query('begin')
  try {
    await admin.query('set local role authenticated')
    await admin.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    const r = await fn((sql, params) => admin.query(sql, params))
    await admin.query('commit')
    return r
  } catch (e) {
    await admin.query('rollback')
    throw e
  }
}

// Kỳ vọng truy vấn bị từ chối; dùng savepoint để giữ giao dịch.
export async function expectFail(q, sql, params, re) {
  await q('savepoint sp')
  try {
    await q(sql, params)
  } catch (e) {
    await q('rollback to savepoint sp')
    if (re && !re.test(e.message)) throw new Error(`Lỗi khác kỳ vọng: ${e.message}`)
    return e.message
  }
  throw new Error(`Kỳ vọng bị từ chối nhưng đã thành công: ${sql}`)
}
