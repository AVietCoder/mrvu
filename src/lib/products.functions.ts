// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { countRows, deleteWhere, fetchAllRows, fetchRows, insertRow, now, uid, updateWhere, logActivity } from "./supabase";

async function nextSku(): Promise<string> {
  const count = await countRows("products");
  return "SP-" + String(count + 1).padStart(4, "0");
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const [products, categories, brands, stock] = await Promise.all([
    fetchAllRows("products", { orderBy: "name" }),
    fetchRows("categories", { orderBy: "name" }),
    fetchRows("brands", { orderBy: "name" }),
    fetchAllRows("stock"),
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
      await logActivity({
        action: "update_product",
        detail: `Cập nhật sản phẩm: ${data.name}`,
        employee_id: data.actor_id || null,
      });
    } else {
      // 🛡️ Lưới an toàn chống tạo trùng: nếu vừa có 1 sản phẩm trùng
      // (tên + thương hiệu + nhóm) được tạo trong ~10 giây gần đây thì coi như
      // đây là cú submit lặp (double-submit / request gửi 2 lần) — trả về bản
      // ghi đã có thay vì chèn thêm dòng mới.
      const recent = await fetchRows("products", {
        eq: {
          name: data.name,
          brand_id: data.brand_id || null,
          category_id: data.category_id || null,
        },
        orderBy: "created_at",
        ascending: false,
        limit: 1,
      });
      const last = recent[0] as any;
      if (last && Date.now() - new Date(last.created_at).getTime() < 10_000) {
        return { ok: true, id: last.id, deduped: true };
      }
      await insertRow("products", { id: uid(), ...payload, created_at: now() });
      await logActivity({
        action: "create_product",
        detail: `Thêm sản phẩm: ${data.name}`,
        employee_id: data.actor_id || null,
      });
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; actor_id?: string } }) => {
    // Remove stock (has CASCADE but delete explicitly to be safe)
    await deleteWhere("stock", { product_id: data.id });
    // Null out product_id in stock_movements and order_items (no CASCADE)
    await updateWhere("stock_movements", { product_id: null }, { product_id: data.id });
    await updateWhere("order_items", { product_id: null }, { product_id: data.id });
    await deleteWhere("products", { id: data.id });
    await logActivity({
      action: "delete_product",
      detail: `Xóa sản phẩm ID: ${data.id}`,
      employee_id: data.actor_id || null,
    });
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
    // Null out brand_id on all products using this brand before deleting
    await updateWhere("products", { brand_id: null }, { brand_id: data.id });
    await deleteWhere("brands", { id: data.id });
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    // Null out category_id on all products using this category before deleting
    await updateWhere("products", { category_id: null }, { category_id: data.id });
    await deleteWhere("categories", { id: data.id });
    return { ok: true };
  });