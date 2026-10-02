import { Building2 } from "lucide-react";

const clean = (s?: string | null) => String(s ?? "").trim();

/** "Tên khách — Tên công ty" cho chỗ chỉ nhận chuỗi (Excel, tiêu đề, title…). */
export function customerLabel(name?: string | null, company?: string | null, fallback = "Khách lẻ") {
  const n = clean(name) || fallback;
  const c = clean(company);
  return c ? `${n} — ${c}` : n;
}

/**
 * Tên khách + TÊN CÔNG TY ở dòng dưới (chỉ khi khách có tên công ty).
 * Dùng ở mọi nơi hiện tên khách: đơn hàng, CSKH, lịch làm việc, sổ quỹ…
 */
export function CustomerName({
  name,
  company,
  fallback = "Khách lẻ",
  className = "",
  companyClassName = "",
}: {
  name?: string | null;
  company?: string | null;
  fallback?: string;
  className?: string;
  companyClassName?: string;
}) {
  const c = clean(company);
  return (
    <span className="block min-w-0">
      <span className={`block truncate ${className}`}>{clean(name) || fallback}</span>
      {c && (
        <span className={`mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground ${companyClassName}`} title={c}>
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{c}</span>
        </span>
      )}
    </span>
  );
}
