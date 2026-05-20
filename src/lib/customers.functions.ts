import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import {
  deleteWhere,
  fetchRows,
  insertRow,
  now,
  updateWhere,
  uid,
} from "./supabase";

type CustomerUpsertPayload = {
  name: string;
  phone: string | null;
  ward: string | null;
  district: string | null;
  province: string | null;
  address: string | null;
  group_name: string;
  debt: number;
  external_code?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getField(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return "";
}

function parseMoney(value: unknown) {
  const raw = clean(value).replace(/[^\d-]/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n);
}

function mapGroup(value: unknown) {
  const text = clean(value).toLowerCase();
  if (!text) return "le";
  if (text.includes("vip")) return "vip";
  if (text.includes("đại lý") || text.includes("dai ly")) return "dai_ly";
  if (text.includes("công trình") || text.includes("cong trinh")) return "cong_trinh";
  return "le";
}

async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(fn));
  }
}

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  const [customers, orders, order_items] = await Promise.all([
    fetchRows("customers", { orderBy: "name" }),
    fetchRows("orders", { orderBy: "created_at", ascending: false }),
    fetchRows("order_items"),
  ]);

  return { customers, orders, order_items };
});

export const upsertCustomer = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    const payload = {
      name: data.name,
      phone: data.phone || null,
      ward: data.ward || null,
      district: data.district || null,
      province: data.province || null,
      address: data.address || null,
      group_name: data.group_name,
      debt: data.debt || 0,
    };

    if (data.id) {
      await updateWhere("customers", payload, { id: data.id });
    } else {
      await insertRow("customers", {
        id: uid(),
        ...payload,
        created_at: now(),
      });
    }

    return { ok: true };
  },
);

export const deleteCustomer = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    await deleteWhere("customers", { id: data.id });
    return { ok: true };
  },
);

export const recordPayment = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { customer_id: string; amount: number } }) => {
    const rows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: data.customer_id },
      select: "debt",
      limit: 1,
    });

    const current = rows[0]?.debt ?? 0;
    const next = Math.max(0, current - Number(data.amount || 0));

    await updateWhere("customers", { debt: next }, { id: data.customer_id });
    return { ok: true };
  },
);

export const importCustomersCsv = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { csv: string } }) => {
    const parsed = Papa.parse<Record<string, string>>(data.csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
    });

    const rows = (parsed.data || []).filter((row) =>
      Object.values(row).some((v) => clean(v) !== ""),
    );

    const dedup = new Map<
      string,
      {
        external_code: string | null;
        name: string;
        phone: string | null;
        ward: string | null;
        district: string | null;
        province: string | null;
        address: string | null;
        group_name: string;
        debt: number;
      }
    >();

    let skipped = 0;

    for (const row of rows) {
      const external_code =
        getField(row, ["Mã khách hàng", "Mă khách hàng", "Mã KH"]) || null;

      const name = getField(row, [
        "Tên khách hàng",
        "Khách hàng",
        "Họ tên",
        "Ho tên",
      ]);

      if (!name) {
        skipped++;
        continue;
      }

      const phone =
        getField(row, ["Điện thoại", "?i?n tho?i", "Số điện thoại"]) || null;

      const address =
        getField(row, ["Địa chỉ", "??a ch?", "Dia chi"]) || null;

      const ward =
        getField(row, ["Phường/Xã", "Ph??ng/Xă", "Phuong/Xa"]) || null;

      const district =
        getField(row, ["Quận/Huyện", "Khu vực giao hàng", "Khu v?c giao hàng"]) ||
        null;

      const province =
        getField(row, ["Tỉnh/Thành phố", "Tinh/Thanh pho"]) || null;

      const debtRaw = getField(row, [
        "Nợ cần thu hiện tại",
        "N? c?n thu hi?n t?i",
        "Công nợ",
        "Cong no",
      ]);

      const group_name = mapGroup(getField(row, [
        "Nhóm khách hàng",
        "Nhom khach hang",
      ]));

      const payload = {
        external_code,
        name,
        phone,
        ward,
        district,
        province,
        address,
        group_name,
        debt: parseMoney(debtRaw),
      };

      const dedupKey = external_code || phone || `${name}__${address || ""}`;
      dedup.set(dedupKey, payload); // dòng cuối cùng thắng
    }

    const existingCustomers = await fetchRows<{
      id: string;
      external_code?: string | null;
      phone?: string | null;
    }>("customers", {
      select: "id, external_code, phone",
    });

    const byExternal = new Map<string, { id: string }>();
    const byPhone = new Map<string, { id: string }>();

    for (const c of existingCustomers) {
      if (c.external_code) byExternal.set(clean(c.external_code), { id: c.id });
      if (c.phone) byPhone.set(clean(c.phone), { id: c.id });
    }

    const updates: Array<{ id: string; payload: CustomerUpsertPayload }> = [];
    const inserts: CustomerUpsertPayload[] = [];

    for (const payload of dedup.values()) {
      const externalKey = payload.external_code ? clean(payload.external_code) : "";
      const phoneKey = payload.phone ? clean(payload.phone) : "";

      const matched = externalKey
        ? byExternal.get(externalKey)
        : phoneKey
          ? byPhone.get(phoneKey)
          : undefined;

      const insertPayload: CustomerUpsertPayload = {
        external_code: payload.external_code || null,
        name: payload.name,
        phone: payload.phone,
        ward: payload.ward,
        district: payload.district,
        province: payload.province,
        address: payload.address,
        group_name: payload.group_name,
        debt: payload.debt,
      };

      const updatePayload: CustomerUpsertPayload = {
        name: payload.name,
        phone: payload.phone,
        ward: payload.ward,
        district: payload.district,
        province: payload.province,
        address: payload.address,
        group_name: payload.group_name,
        debt: payload.debt,
        ...(payload.external_code ? { external_code: payload.external_code } : {}),
      };

      if (matched) {
        updates.push({ id: matched.id, payload: updatePayload });
      } else {
        inserts.push(insertPayload);
      }
    }

    await runInChunks(updates, 20, async ({ id, payload }) => {
      await updateWhere("customers", payload, { id });
    });

    await runInChunks(inserts, 20, async (payload) => {
      await insertRow("customers", {
        id: uid(),
        created_at: now(),
        ...payload,
      });
    });

    return {
      ok: true,
      total: rows.length,
      created: inserts.length,
      updated: updates.length,
      skipped,
    };
  },
);