/**
 * Tên ngắn của nhân viên để hiển thị trong ô lịch trực / chấm công.
 *
 * Tên trong hệ thống thường kèm SĐT và danh xưng: "Ms. Thảo - 0888 283 289",
 * "Bích Loan 096.234.8886". Lịch trực cũ trên Excel chỉ ghi "THẢO", "LOAN" —
 * nhét nguyên tên dài vào ô 1 ngày thì lưới không đọc được.
 */

function clean(full: string): string {
  return String(full || "")
    .replace(/[\d][\d\s.\-]{5,}[\d]/g, " ") // bỏ số điện thoại
    .replace(/^\s*(ms|mr|mrs|a|c|anh|chị|chi)\.?\s+/i, "") // bỏ danh xưng đầu
    .replace(/[-–|]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "Ms. Thảo - 0888 283 289" → "Thảo"; "Đặng Thành Đức" → "Đức". */
export function shortName(full: string): string {
  const words = clean(full).split(/\s+/).filter(Boolean);
  return words[words.length - 1] || String(full || "").trim();
}

/**
 * Tên ngắn cho cả danh sách, tự tránh trùng: hai người cùng tên cuối thì
 * lấy thêm chữ đứng trước ("Thành Đức" / "Minh Đức").
 */
export function buildShortNames(users: { id: string; full_name: string }[]): Map<string, string> {
  const words = new Map(users.map((u) => [u.id, clean(u.full_name).split(/\s+/).filter(Boolean)]));
  const out = new Map<string, string>();
  const count = new Map<string, number>();
  for (const [, w] of words) {
    const k = (w[w.length - 1] || "").toLowerCase();
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  for (const u of users) {
    const w = words.get(u.id) ?? [];
    const last = w[w.length - 1] || u.full_name;
    const dup = (count.get(String(last).toLowerCase()) ?? 0) > 1;
    out.set(u.id, dup && w.length >= 2 ? w.slice(-2).join(" ") : last);
  }
  return out;
}
