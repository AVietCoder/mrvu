// Gộp các migration thành một tệp để dán vào Supabase SQL Editor: node scripts/build-setup-sql.mjs
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('supabase/migrations')
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
const body = files.map((f) => `-- ===== ${f} =====\n${fs.readFileSync(path.join(dir, f), 'utf8').trim()}\n`).join('\n')
const out = `-- MR.VŨ COFFEE POS: gộp ${files.length} migration (${files[0]} .. ${files.at(-1)}).\n-- CHỈ chạy MỘT LẦN trên dự án Supabase mới, còn trống. Không chạy lại trên dữ liệu đang dùng.\n\n${body}`
fs.writeFileSync('supabase/setup_all.sql', out)
console.log(`Đã tạo supabase/setup_all.sql từ ${files.length} migration.`)
