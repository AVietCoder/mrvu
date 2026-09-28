import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOMER_SOURCES } from "@/lib/types";

/**
 * Ô "Biết Mr.Vũ qua đâu?" (migration v20) — dùng chung cho form tạo / sửa
 * khách ở trang Khách hàng, trang chi tiết khách và tạo nhanh trong đơn hàng.
 * Chọn "Khác" thì hiện ô nhập cụ thể (bắt buộc).
 */
export function CustomerSourceField({
  source,
  note,
  onChange,
  required = true,
  className = "",
}: {
  source: string;
  note: string;
  onChange: (v: { source: string; note: string }) => void;
  /** true = tạo mới (bắt buộc). Khi sửa khách cũ thì không bắt buộc. */
  required?: boolean;
  className?: string;
}) {
  const missing = required && !source;
  const missingNote = source === "khac" && !note.trim();
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs font-medium">
        Biết Mr.Vũ qua đâu? {required && <span className="text-destructive">*</span>}
      </Label>
      <select
        className={`mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm ${missing ? "border-destructive/60" : "border-input"}`}
        value={source}
        onChange={(e) => onChange({ source: e.target.value, note: e.target.value === "khac" ? note : "" })}
      >
        <option value="" disabled={required}>— Chọn nguồn —</option>
        {/* Nguồn cũ (legacy) chỉ hiện khi khách đang mang giá trị đó. */}
        {CUSTOMER_SOURCES.filter((s) => !s.legacy || s.key === source).map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
      {source === "khac" && (
        <Input
          className={`mt-1.5 bg-background ${missingNote ? "border-destructive/60" : ""}`}
          placeholder="Nhập cụ thể (vd: hội chợ, biển hiệu, báo chí…)"
          value={note}
          autoFocus
          onChange={(e) => onChange({ source, note: e.target.value })}
        />
      )}
    </div>
  );
}

/** Kiểm tra trước khi gửi: trả về câu báo lỗi hoặc null. */
export function customerSourceError(source: string, note: string, required: boolean): string | null {
  if (required && !source) return 'Vui lòng chọn "Biết Mr.Vũ qua đâu?"';
  if (source === "khac" && !note.trim()) return 'Chọn "Khác" thì nhập cụ thể biết Mr.Vũ qua đâu';
  return null;
}
