// Build MR.VŨ COFFEE POS (thư mục mrvu-coffee-pos/) thành web tĩnh trong public/cafe/,
// để web chính phục vụ ở /cafe (xem src/routes/cafe.ts). Chạy tự động trong `npm run build`.
//
//   node scripts/build-cafe.mjs
//
// POS là ứng dụng RIÊNG: Supabase riêng (đăng nhập + database), chỉ đọc 2 biến
// VITE_CAFE_SUPABASE_URL / VITE_CAFE_SUPABASE_ANON_KEY (lấy từ .env gốc hoặc biến môi trường Vercel).
// Các biến VITE_* khác của web chính bị gỡ khỏi môi trường build POS để không lọt sang.
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { parse } from "dotenv";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const POS = path.join(ROOT, "mrvu-coffee-pos");
const OUT = path.join(ROOT, "public", "cafe");
const KEYS = ["VITE_CAFE_SUPABASE_URL", "VITE_CAFE_SUPABASE_ANON_KEY"];

const fileEnv = fs.existsSync(path.join(ROOT, ".env")) ? parse(fs.readFileSync(path.join(ROOT, ".env"))) : {};
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_") || k.startsWith("VITE_CAFE_")));
for (const k of KEYS) if (!env[k] && fileEnv[k]) env[k] = fileEnv[k];

const missing = KEYS.filter((k) => !env[k]);
if (missing.length) {
  console.warn(`[cafe] Thiếu ${missing.join(", ")} → /cafe vẫn build nhưng sẽ hiện màn hình "Chưa cấu hình Supabase".`);
}

function run(cmd) {
  console.log(`[cafe] ${cmd}`);
  const r = spawnSync(cmd, { cwd: POS, env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Cài lại khi chưa có node_modules hoặc package-lock.json mới hơn lần cài trước.
const installed = path.join(POS, "node_modules", ".package-lock.json");
if (!fs.existsSync(installed) || fs.statSync(path.join(POS, "package-lock.json")).mtimeMs > fs.statSync(installed).mtimeMs) {
  run("npm ci --no-audit --no-fund");
}

run("npx tsc -b");
run(`npx vite build --base /cafe/ --outDir "${OUT}" --emptyOutDir`);
console.log(`[cafe] Xong → ${path.relative(ROOT, OUT)}`);
