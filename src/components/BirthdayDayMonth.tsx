/**
 * Ngày sinh KHÁCH HÀNG chỉ cần ngày + tháng (không hỏi năm).
 *
 * Cột customers.birthday là kiểu date nên lưu kèm năm "giữ chỗ" 1904 — năm
 * nhuận để 29/02 hợp lệ. Nhắc sinh nhật chỉ so ngày + tháng nên không ảnh
 * hưởng. Khách cũ đã có năm thật: đổi ngày / tháng vẫn giữ nguyên năm cũ.
 */
export const BIRTHDAY_PLACEHOLDER_YEAR = "1904";

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "1904-05-07" → "07/05"; "1990-05-07" → "07/05/1990"; rỗng → "". */
export function formatBirthday(value?: string | null): string {
  if (!value) return "";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return y === BIRTHDAY_PLACEHOLDER_YEAR ? `${d}/${m}` : `${d}/${m}/${y}`;
}

/** Tuổi chỉ có nghĩa khi biết năm thật. */
export const hasRealBirthYear = (value?: string | null) =>
  Boolean(value) && String(value).slice(0, 4) !== BIRTHDAY_PLACEHOLDER_YEAR;

export function BirthdayDayMonth({
  value,
  onChange,
  className = "",
}: {
  value: string; // "yyyy-mm-dd" hoặc ""
  onChange: (v: string) => void;
  className?: string;
}) {
  const [y, m, d] = value ? value.slice(0, 10).split("-") : ["", "", ""];
  const month = Number(m) || 0;
  const day = Number(d) || 0;
  const year = y || BIRTHDAY_PLACEHOLDER_YEAR;
  const maxDay = month ? DAYS_IN_MONTH[month - 1] : 31;

  function emit(nextDay: number, nextMonth: number) {
    if (!nextDay && !nextMonth) return onChange("");
    // Chưa chọn đủ cả 2 thì chưa lưu giá trị (giữ lựa chọn tạm bằng ngày / tháng 01).
    const mm = nextMonth || 1;
    const dd = Math.min(nextDay || 1, DAYS_IN_MONTH[mm - 1]);
    onChange(`${year}-${pad(mm)}-${pad(dd)}`);
  }

  const sel = "h-10 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className={`flex gap-2 ${className}`}>
      <select className={`${sel} w-24`} value={day || ""} onChange={(e) => emit(Number(e.target.value), month)} aria-label="Ngày">
        <option value="">Ngày</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{pad(n)}</option>
        ))}
      </select>
      <select className={`${sel} flex-1`} value={month || ""} onChange={(e) => emit(day, Number(e.target.value))} aria-label="Tháng">
        <option value="">Tháng</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>Tháng {n}</option>
        ))}
      </select>
      {value && (
        <button type="button" onClick={() => onChange("")} className="px-1 text-xs text-muted-foreground hover:text-destructive" title="Xoá ngày sinh">
          Xoá
        </button>
      )}
    </div>
  );
}
