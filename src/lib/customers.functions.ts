import { createServerFn } from "@tanstack/react-start";
import {
  deleteWhere,
  fetchRows,
  insertRow,
  now,
  updateWhere,
  uid,
} from "./supabase";

type CustomerUpsertPayload = {
  external_code?: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  ward: string | null;
  district: string | null;
  province: string | null;
  total_sales: number;
  debt: number;
};

type ImportedCustomerRow = {
  external_code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  ward: string | null;
  district: string | null;
  province: string | null;
  total_sales: number;
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: unknown) {
  const raw = clean(value).replace(/[^\d-]/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n);
}

function getField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return "";
}

function normalizeRow(row: Record<string, unknown>): ImportedCustomerRow | null {
  const external_code = getField(row, ["Mã khách hàng", "Ma khách hàng", "Mă khách hàng", "Mã KH"]) || null;
  const name = getField(row, ["Tên khách hàng", "Ten khách hàng", "Khách hàng", "Ho ten", "Họ tên"]);
  if (!name) return null;

  const phone = getField(row, ["Điện thoại", "So dien thoai", "Số điện thoại"]) || null;
  const address = getField(row, ["Địa chỉ", "Dia chi"]) || null;
  const ward = getField(row, ["Phường/Xã", "Phuong/Xa"]) || null;
  const district = getField(row, ["Khu vực giao hàng", "Quan/Huyen", "Quận/Huyện"]) || null;
  const province = getField(row, ["Tỉnh/Thành phố", "Tinh/Thanh pho"]) || null;

  const total_sales = parseMoney(
    getField(row, ["Tổng bán", "Tong ban", "Tổng doanh số", "Tong doanh so"]),
  );

  return {
    external_code,
    name,
    phone,
    address,
    ward,
    district,
    province,
    total_sales,
  };
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
      external_code: data.external_code || null,
      name: data.name,
      phone: data.phone || null,
      address: data.address || null,
      ward: data.ward || null,
      district: data.district || null,
      province: data.province || null,
      total_sales: Number(data.total_sales) || 0,
      debt: Number(data.debt) || 0,
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

export const importCustomersRows = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { rows: Record<string, unknown>[] } }) => {
    const normalized = (data.rows || [])
      .map(normalizeRow)
      .filter(Boolean) as ImportedCustomerRow[];

    const dedup = new Map<string, ImportedCustomerRow>();

    for (const row of normalized) {
      const key =
        clean(row.external_code) ||
        clean(row.phone) ||
        `${clean(row.name)}__${clean(row.address)}`;

      dedup.set(key, row);
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

    for (const row of dedup.values()) {
      const externalKey = clean(row.external_code);
      const phoneKey = clean(row.phone);

      const matched = externalKey
        ? byExternal.get(externalKey)
        : phoneKey
          ? byPhone.get(phoneKey)
          : undefined;

      const payload: CustomerUpsertPayload = {
        external_code: row.external_code,
        name: row.name,
        phone: row.phone,
        address: row.address,
        ward: row.ward,
        district: row.district,
        province: row.province,
        total_sales: row.total_sales,
        debt: 0, // không import công nợ
      };

      if (matched) {
        updates.push({ id: matched.id, payload });
      } else {
        inserts.push(payload);
      }
    }

    await runInChunks(updates, 50, async ({ id, payload }) => {
      await updateWhere("customers", payload, { id });
    });

    await runInChunks(inserts, 50, async (payload) => {
      await insertRow("customers", {
        id: uid(),
        created_at: now(),
        ...payload,
      });
    });

    return {
      ok: true,
      total: normalized.length,
      created: inserts.length,
      updated: updates.length,
      skipped: (data.rows || []).length - normalized.length,
    };
  },
);