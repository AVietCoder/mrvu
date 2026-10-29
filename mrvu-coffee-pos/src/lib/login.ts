// Tài khoản đăng nhập bằng tên đăng nhập; Supabase Auth lưu dưới dạng email nội bộ.
// Phải khớp hàm login_email() trong supabase/migrations/0011_username_login.sql.
const DOMAIN = '@mrvu-cafe.local'

/** Gõ "thungan1" → "thungan1@mrvu-cafe.local". Gõ email đầy đủ thì giữ nguyên (tài khoản tạo kiểu cũ). */
export function toLoginEmail(input: string): string {
  const v = input.trim().toLowerCase()
  return v.includes('@') ? v : v + DOMAIN
}

/** Hiển thị: bỏ hậu tố nội bộ, email thật giữ nguyên. */
export function displayUsername(email: string | null | undefined): string {
  const v = email ?? ''
  return v.toLowerCase().endsWith(DOMAIN) ? v.slice(0, -DOMAIN.length) : v
}
