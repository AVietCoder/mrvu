// Quy tắc bảo hành thuần (không đụng DB) — dùng chung cho server và form ở client.

/** Hạn bảo hành PHỤ KIỆN / linh kiện (tháng) khi mẫu chưa cài riêng. */
export const DEFAULT_WARRANTY_MONTHS = 12;
/** Hạn bảo hành ĐỘNG CƠ (tháng) khi mẫu chưa cài riêng — "động cơ 10 năm". */
export const DEFAULT_MOTOR_MONTHS = 120;

/** Một thời điểm → "YYYY-MM-DD" theo giờ Việt Nam. */
export const vnDay = (ts: string | number | Date) => new Date(new Date(ts).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Cộng tháng trên "YYYY-MM-DD"; ngày 31 + 1 tháng → ngày cuối tháng sau. */
export function addMonthsStr(d: string, months: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1 + months, day));
  if (x.getUTCDate() !== day) x.setUTCDate(0);
  return x.toISOString().slice(0, 10);
}

export type WarrantyKey = "in" | "out" | "partial" | "unknown";

/**
 * Hạn bảo hành HAI MỨC theo mẫu: động cơ (`warranty_motor_months`, mặc định 120
 * tháng) và phụ kiện / linh kiện (`warranty_months`, mặc định 12 tháng). Hết hạn
 * = ngày mua + số tháng, so với NGÀY GỬI bảo hành (không phải hôm nay — phiếu
 * cũ không tự đổi nhãn).
 *
 *   fault_part = "motor" | "accessory" → tính theo đúng mức đó.
 *   chưa xác định bộ phận lỗi          → "in" nếu cả hai còn hạn, "out" nếu cả
 *                                        hai hết hạn, còn lại là "partial"
 *                                        (thường: động cơ còn, phụ kiện hết).
 *   không có ngày mua                  → "unknown".
 */
export function warrantyState(t: {
  purchase_date?: string | null;
  warranty_months?: number | null;
  warranty_motor_months?: number | null;
  fault_part?: string | null;
  sent_date?: string | number | null;
}) {
  if (!t.purchase_date) {
    return { warranty: "unknown" as WarrantyKey, expires_on: null as string | null, accessory_expires_on: null as string | null, motor_expires_on: null as string | null, accessory_in: false, motor_in: false };
  }
  const day = String(t.purchase_date).slice(0, 10);
  const accessoryExp = addMonthsStr(day, Number(t.warranty_months) > 0 ? Number(t.warranty_months) : DEFAULT_WARRANTY_MONTHS);
  const motorExp = addMonthsStr(day, Number(t.warranty_motor_months) > 0 ? Number(t.warranty_motor_months) : DEFAULT_MOTOR_MONTHS);
  const sentDay = vnDay(t.sent_date || Date.now());
  const accessoryIn = sentDay <= accessoryExp;
  const motorIn = sentDay <= motorExp;

  let warranty: WarrantyKey;
  let expires: string;
  if (t.fault_part === "motor") {
    warranty = motorIn ? "in" : "out";
    expires = motorExp;
  } else if (t.fault_part === "accessory") {
    warranty = accessoryIn ? "in" : "out";
    expires = accessoryExp;
  } else if (accessoryIn === motorIn) {
    warranty = accessoryIn ? "in" : "out";
    // Cả hai còn hạn → mốc hết hạn GẦN nhất; cả hai hết → mốc hết hạn SAU cùng.
    expires = (accessoryIn ? accessoryExp < motorExp : accessoryExp > motorExp) ? accessoryExp : motorExp;
  } else {
    warranty = "partial";
    expires = motorIn ? motorExp : accessoryExp;
  }
  return { warranty, expires_on: expires as string | null, accessory_expires_on: accessoryExp as string | null, motor_expires_on: motorExp as string | null, accessory_in: accessoryIn, motor_in: motorIn };
}
