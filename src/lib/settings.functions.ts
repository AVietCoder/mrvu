// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchRows, supabase } from "./supabase";

export type SiteSettings = {
  site_name: string;
  logo_url: string;
  primary_color: string;
  address: string;
  phone: string;
  email: string;
  tax_code: string;
  admin_email: string;
  bank_accounts: string; // JSON: [{bank, account_number, account_name, note}]
  print_templates: string; // JSON: { order_invoice, import_slip, transfer_slip, email_order }
};

const DEFAULTS: SiteSettings = {
  site_name: "QuatTran POS",
  logo_url: "",
  primary_color: "#2563eb",
  address: "",
  phone: "",
  email: "",
  tax_code: "",
  admin_email: "",
  bank_accounts: "[]",
  print_templates: "{}",
};

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchRows<{ key: keyof SiteSettings; value: string }>("site_settings", {
    select: "key, value",
  });
  const settings: Partial<SiteSettings> = {};
  for (const row of rows) {
    (settings as any)[row.key] = row.value;
  }
  return { ...DEFAULTS, ...settings } as SiteSettings;
});

export const updateSettings = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: Partial<SiteSettings> }) => {
    const rows = Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ({ key, value: String(value) }));
    if (rows.length) {
      await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
    }
    return { ok: true };
  });
