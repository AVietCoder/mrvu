import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase dùng SERVICE ROLE — CHỈ ĐƯỢC IMPORT TRONG SERVER FUNCTION.
 *
 * Vì sao cần client riêng thay vì dùng `supabase` sẵn có trong src/lib/supabase.ts:
 * client đó dùng anon key có tiền tố VITE_ nên Vite nhúng thẳng vào bundle
 * trình duyệt. Các bảng Zalo bật RLS deny-all (migration v8) nên anon key
 * KHÔNG đọc/ghi được — cố dùng sẽ chỉ nhận về mảng rỗng, không báo lỗi.
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY bypass toàn bộ RLS. Không đặt tiền tố VITE_,
 * không import file này từ bất kỳ file .tsx nào.
 */

function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Thiếu biến môi trường ${name}. Thêm vào .env (KHÔNG dùng tiền tố VITE_) ` +
        `và khai báo trên trang cấu hình của Netlify/Vercel.`,
    );
  }
  return value;
}

// <any> là cố ý: repo không sinh Database type từ Supabase, nên nếu để mặc
// định thì mọi row suy ra kiểu `never` và không insert/update được gì.
let cached: ReturnType<typeof createClient<any, any, any>> | null = null;

/**
 * Khởi tạo lười (lazy): đọc env lúc gọi chứ không lúc import, để trang nào
 * không đụng tới Zalo thì không vỡ chỉ vì chưa cấu hình xong biến môi trường.
 */
export function getSupabaseAdmin() {
  if (cached) return cached;

  const url =
    process.env.SUPABASE_URL ||
    requireServerEnv("VITE_SUPABASE_URL"); // URL không phải bí mật, dùng lại được
  const serviceKey = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  cached = createClient<any, any, any>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
