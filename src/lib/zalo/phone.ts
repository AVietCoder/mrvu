/**
 * Chuẩn hoá SĐT Việt Nam về dạng Zalo ZNS yêu cầu: 84xxxxxxxxx (không dấu +).
 *
 * Dữ liệu customers.phone trong DB nhập tay nên rất tạp: "0888 283 289",
 * "+84 888.283.289", "0888-283-289"… Gửi sai định dạng thì Zalo trả lỗi và
 * VẪN có thể bị tính phí ở một số mã lỗi, nên chuẩn hoá kỹ trước khi enqueue.
 *
 * Trả về null nếu không phải SĐT di động VN hợp lệ — gọi bên ngoài phải coi
 * null là "không gửi được", tuyệt đối không đoán bừa.
 */
export function normalizeVnPhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Bỏ mọi ký tự không phải số, trừ dấu + ở đầu.
  let s = String(input).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);

  // 0084xxxxxxxxx → 84xxxxxxxxx
  if (s.startsWith("0084")) s = s.slice(2);

  // 0xxxxxxxxx (10 số) → 84xxxxxxxxx
  if (s.startsWith("0")) s = "84" + s.slice(1);

  // Thiếu mã quốc gia: 9 số bắt đầu bằng đầu số di động → thêm 84.
  if (!s.startsWith("84") && s.length === 9) s = "84" + s;

  // Di động VN sau chuyển đổi đầu số: 84 + 9 chữ số, chữ số đầu là 3/5/7/8/9.
  if (!/^84[35789]\d{8}$/.test(s)) return null;

  return s;
}
