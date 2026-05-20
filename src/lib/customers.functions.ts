import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchRows, insertRow, now, updateWhere, uid } from "./supabase";

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  const [customers, orders, order_items] = await Promise.all([
    fetchRows("customers", { orderBy: "name" }),
    fetchRows("orders", { orderBy: "created_at", ascending: false }),
    fetchRows("order_items"),
  ]);

  return { customers, orders, order_items };
});

export const upsertCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
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
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("customers", { id: data.id });
    return { ok: true };
  });

export const recordPayment = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { customer_id: string; amount: number } }) => {
    const rows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: data.customer_id },
      select: "debt",
      limit: 1,
    });
    const current = rows[0]?.debt ?? 0;
    const next = Math.max(0, current - Number(data.amount || 0));
    await updateWhere("customers", { debt: next }, { id: data.customer_id });
    return { ok: true };
  });
