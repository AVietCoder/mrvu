// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { countRows, deleteWhere, fetchAllRows, fetchRows, insertRow, now, supabase, uid, updateWhere, logActivity } from "./supabase";

async function nextSku(): Promise<string> {
  const count = await countRows("products");
  return "SP-" + String(count + 1).padStart(4, "0");
}

// ─────────────────────────────────────────────────────────────────────────
// PHÂN TRANG PHÍA SERVER cho danh sách hàng hóa (mẫu giống listCustomers).
// ─────────────────────────────────────────────────────────────────────────
interface SearchProductsArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  brand?: string;
}

export const searchProductsPage = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: SearchProductsArgs | undefined }) => {
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.max(1, data?.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    const { data: rows, error } = await supabase.rpc("search_products_page", {
      p_search: data?.search || null,
      p_category: data?.category || null,
      p_brand: data?.brand || null,
      p_limit: pageSize,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);

    const products = (rows ?? []) as any[];
    const totalFiltered = products[0]?.filtered_count
      ? Number(products[0].filtered_count)
      : 0;

    return { products, meta: { totalFiltered } };
  },
);

// Số liệu + danh sách phụ trợ (danh mục/thương hiệu/chi nhánh) — gộp 1 lần gọi.
export const getProductStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabase.rpc("products_stats");
    if (error) throw new Error(error.message);
    const s = (data ?? {}) as any;
    return {
      totalProducts: Number(s.total_products ?? 0),
      lowStockCount: Number(s.low_stock_count ?? 0),
      categories: (s.categories ?? []) as any[],
      brands: (s.brands ?? []) as any[],
      branches: (s.branches ?? []) as any[],
    };
  },
);

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