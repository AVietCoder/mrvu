// @ts-nocheck
import { supabase } from "./supabase";

/**
 * Tên công ty của khách (customers.company_name) theo id — đọc theo lô 300 id.
 * Chỉ trả những khách CÓ tên công ty. Lỗi đọc → map rỗng (không làm hỏng màn hình
 * đang gọi: tên công ty chỉ là dòng phụ dưới tên khách).
 */
export async function companyNamesOf(ids: any[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set((ids ?? []).filter(Boolean).map(String))];
  for (let i = 0; i < uniq.length; i += 300) {
    try {
      const { data } = await supabase.from("customers").select("id, company_name").in("id", uniq.slice(i, i + 300));
      for (const c of data ?? []) {
        const name = String(c.company_name ?? "").trim();
        if (name) out.set(c.id, name);
      }
    } catch {
      // bỏ qua — xem ghi chú ở trên
    }
  }
  return out;
}

/** Gắn `customer_company` vào từng dòng theo `idKey` (mặc định customer_id). */
export async function attachCompany<T extends Record<string, any>>(rows: T[], idKey = "customer_id", outKey = "customer_company"): Promise<T[]> {
  if (!rows?.length) return rows ?? [];
  const map = await companyNamesOf(rows.map((r) => r[idKey]));
  if (!map.size) return rows;
  return rows.map((r) => (map.has(r[idKey]) ? { ...r, [outKey]: map.get(r[idKey]) } : r));
}
