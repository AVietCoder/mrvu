import { createServerFn } from "@tanstack/react-start";
import db from "@/server/db.server";

export type SiteSettings = {
  site_name: string;
  logo_url: string;
  primary_color: string;
  address: string;
  phone: string;
  email: string;
  tax_code: string;
};

const DEFAULTS: SiteSettings = {
  site_name: "QuatTran POS",
  logo_url: "",
  primary_color: "#2563eb",
  address: "",
  phone: "",
  email: "",
  tax_code: "",
};

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const rows = db.prepare("SELECT key, value FROM site_settings").all() as { key: string; value: string }[];
  const settings: Partial<SiteSettings> = {};
  for (const row of rows) {
    (settings as any)[row.key] = row.value;
  }
  return { ...DEFAULTS, ...settings } as SiteSettings;
});

export const updateSettings = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: Partial<SiteSettings> }) => {
    const stmt = db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        stmt.run(key, String(value));
      }
    }
    return { ok: true };
  });