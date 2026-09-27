/**
 * Ngày tháng theo giờ Việt Nam (UTC+07).
 *
 * Vì sao cần: phần lớn code trong repo đang tính "hôm nay" bằng
 * `new Date().toISOString().slice(0, 10)` — đó là ngày theo **UTC**. Từ 17:00
 * giờ Việt Nam trở đi, UTC vẫn đang ở ngày hôm trước, nên mọi thứ gắn với
 * "hôm nay" sẽ lệch đúng một ngày suốt buổi tối.
 *
 * Với chăm sóc khách hàng thì lệch một ngày nghĩa là chúc sinh nhật sai ngày
 * và nhắc bảo dưỡng sai ngày, nên các tính năng mới dùng thống nhất module này.
 *
 * Dùng đúng cách đã có sẵn trong `reports.functions.ts` (Intl với locale
 * "sv-SE" cho ra định dạng YYYY-MM-DD) để không sinh ra cách làm thứ hai.
 *
 * ⚠️ Phạm vi: CHỈ dùng cho code mới. Không đi sửa các chỗ cũ đang dùng UTC —
 * việc đó nằm ngoài phạm vi và dễ làm vỡ hành vi đang chạy.
 */

export const TZ_VN = "Asia/Ho_Chi_Minh";

const dtf = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ_VN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Một thời điểm bất kỳ → "YYYY-MM-DD" theo giờ VN. */
export function localDateKeyVN(value: string | number | Date): string {
  return dtf.format(new Date(value));
}

/** Hôm nay theo giờ VN, dạng "YYYY-MM-DD". */
export function todayVN(): string {
  return dtf.format(new Date());
}

/** Cộng/trừ ngày trên chuỗi "YYYY-MM-DD" mà không đụng tới múi giờ. */
export function addDaysVN(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Dùng UTC để phép cộng thuần số học, không bị giờ mùa hè hay offset xen vào.
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * Cộng tháng theo đúng luật của Postgres: KẸP về ngày cuối tháng đích thay vì
 * tràn sang tháng sau. 31/08 + 6 tháng = 28/02 (không phải 03/03).
 *
 * Có mặt ở đây để phía JS kiểm chứng lại được kết quả của RPC — hai bên phải
 * ra cùng một ngày, nếu lệch là có lỗi.
 */
export function addMonthsClampVN(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" để hiển thị. */
export function formatDateVN(dateKey: string | null | undefined): string {
  if (!dateKey) return "—";
  const [y, m, d] = String(dateKey).slice(0, 10).split("-");
  if (!y || !m || !d) return String(dateKey);
  return `${d}/${m}/${y}`;
}
