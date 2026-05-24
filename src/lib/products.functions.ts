// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { countRows, deleteWhere, fetchRows, insertRow, now, uid, updateWhere } from "./supabase";

async function nextSku(): Promise<string> {
  const count = await countRows("products");
  return "SP-" + String(count + 1).padStart(4, "0");
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const [products, categories, brands, stock] = await Promise.all([
    fetchRows("products", { orderBy: "name" }),
    fetchRows("categories", { orderBy: "name" }),
    fetchRows("brands", { orderBy: "name" }),
    fetchRows("stock"),
  ]);

  return { products, categories, brands, stock };
});

export const upsertProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const sku = (data.sku?.trim() || (data.id ? undefined : await nextSku())) as string | undefined;
    const payload = {
      sku: sku ?? data.sku,
      name: data.name,
      category_id: data.category_id || null,
      brand_id: data.brand_id || null,
      power: data.power || null,
      color: data.color || null,
      blade_size: data.blade_size || null,
      image_url: data.image_url || null,
      description: data.description || null,
      cost_price: Number(data.cost_price || 0),
      sale_price: Number(data.sale_price || 0),
      min_stock: Number(data.min_stock || 0),
      tech_fee: Number(data.tech_fee || 0),
    };

    if (data.id) {
      await updateWhere("products", payload, { id: data.id });
      await insertRow("activity_logs", { id: uid(), employee_id: null, action: "update_product", detail: data.name, created_at: now() }).catch(() => undefined);
    } else {
      await insertRow("products", {
        id: uid(),
        ...payload,
        created_at: now(),
      });
      await insertRow("activity_logs", { id: uid(), employee_id: null, action: "create_product", detail: data.name, created_at: now() }).catch(() => undefined);
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("stock", { product_id: data.id });
    await deleteWhere("products", { id: data.id });
    await insertRow("activity_logs", { id: uid(), employee_id: null, action: "delete_product", detail: `ID: ${data.id}`, created_at: now() }).catch(() => undefined);
    return { ok: true };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string } }) => {
    if (data.id) {
      await updateWhere("categories", { name: data.name }, { id: data.id });
    } else {
      await insertRow("categories", { id: uid(), name: data.name });
    }
    return { ok: true };
  });

export const upsertBrand = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string } }) => {
    if (data.id) {
      await updateWhere("brands", { name: data.name }, { id: data.id });
    } else {
      await insertRow("brands", { id: uid(), name: data.name });
    }
    return { ok: true };
  });

export const deleteBrand = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("brands", { id: data.id });
    return { ok: true };
  });
