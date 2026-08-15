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

/**
 * Chuẩn hoá SĐT để LƯU VÀO DB.
 *
 * Khác với normalizeVnPhone (dùng lúc gửi Zalo, ra dạng 84xxxxxxxxx), hàm này
 * giữ dạng nội địa 0xxxxxxxxx vì đó là cách người dùng đọc và tra cứu.
 *
 * Nhân viên vẫn được gõ thoải mái "0906 249 669", "+84 906.249.669" — chỉ là
 * lúc lưu thì bỏ hết dấu cách và dấu phân tách. Lợi ích thật: tìm kiếm và
 * cảnh báo khách trùng mới ăn khớp, chứ cùng một số mà lưu ba kiểu thì hệ
 * thống coi như ba người khác nhau.
 *
 * Số không phải di động VN (số bàn, số nước ngoài) thì CHỈ bỏ dấu phân tách,
 * không ép về dạng nào — thà giữ nguyên còn hơn làm sai dữ liệu của khách.
 */
export function normalizePhoneForStorage(input: string | null | undefined): string | null {
  if (input == null) return null;

  // Dữ liệu thật có ký tự điều khiển vô hình lọt vào khi copy-paste
  // (vd U+202D ở đầu "\u202D090 7464646"). Bỏ trước, nếu không mọi so sánh sau
  // đều sai mà nhìn bằng mắt không thấy gì bất thường.
  const raw = String(input).replace(/[​-\u200F\u202A-\u202E﻿]/g, "").trim();
  if (!raw) return null;

  // ★ CHỈ ĐỘNG VÀO KHI CHẮC CHẮN ĐÓ LÀ MỘT SỐ DUY NHẤT.
  // Ô SĐT trong dữ liệu hiện có chứa đủ thứ: "0976833191(Triệu Thị Phin)",
  // "0903 336755 -0917777693", "Chị Hằng 0983848833". Bóc dấu cách trong
  // những chuỗi đó sẽ dính tên vào số hoặc dính hai số thành một số rác.
  // Có chữ cái, dấu "/" hay "," -> GIỮ NGUYÊN VĂN, thà xấu còn hơn sai.
  if (!/^[\d\s.()+-]+$/.test(raw)) return raw;

  const compact = raw.replace(/[\s.()-]/g, "");

  const vn = normalizeVnPhone(compact);
  if (vn) return "0" + vn.slice(2); // 84906249669 -> 0906249669

  // Không phải di động VN (số bàn, tổng đài 1900...) nhưng vẫn là MỘT số có
  // độ dài hợp lý -> chỉ bỏ dấu phân tách.
  if (/^\+?\d{6,12}$/.test(compact)) return compact;

  // Quá dài / quá ngắn: gần như chắc chắn là hai số viết dính nhau.
  // Không đoán, giữ nguyên để người dùng tự sửa.
  return raw;
}
