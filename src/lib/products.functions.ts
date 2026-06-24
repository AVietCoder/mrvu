// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchAllRows, fetchRows, insertRow, now, uid, updateWhere, logActivity } from "./supabase";

// Sinh SKU KHÔNG trùng: lấy số lớn nhất ở cuối TẤT CẢ sku hiện có rồi +1.
// KHÔNG dùng COUNT(*): khi xoá sản phẩm thì count tụt xuống và sinh ra một SKU
// ĐÃ tồn tại -> lỗi: duplicate key value violates unique constraint
// "products_sku_key". Lấy theo MAX nên SKU mới luôn lớn hơn mọi SKU đang có,
// an toàn kể cả sau khi đã xoá. (Vẫn kèm retry ở dưới để chống đua 2 request.)
async function nextSku(): Promise<string> {
  const rows = await fetchAllRows<{ sku: string }>("products", { select: "sku" });
  let max = 0;
  for (const r of rows) {
    // Chỉ xét SKU đúng định dạng app tự sinh: "SP-<số>" (vd SP-0309).
    // SKU nhập tay / nhập kho định dạng khác (vd SP000620) là chuỗi khác hẳn
    // nên KHÔNG bao giờ trùng với "SP-####" -> bỏ qua khi tính số kế tiếp.
    const m = String(r?.sku ?? "").match(/^SP-0*(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return "SP-" + String(max + 1).padStart(4, "0");
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
    // payload KHÔNG chứa sku: sku chỉ sinh khi TẠO MỚI (trong vòng retry bên
    // dưới) và KHÔNG thay đổi khi sửa (giao diện không cho sửa SKU).
    const payload = {
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

    // ===== SỬA =====
    if (data.id) {
      await updateWhere("products", payload, { id: data.id });
      await logActivity({
        action: "update_product",
        detail: `Cập nhật sản phẩm: ${data.name}`,
        employee_id: data.actor_id || null,
      });
      return { ok: true };
    }

    // ===== TẠO MỚI =====
    // 🛡️ Chống tạo trùng do double-submit / request gửi lặp: nếu vừa có 1 sản
    // phẩm trùng (tên + thương hiệu + nhóm) tạo trong ~10 giây gần đây thì coi
    // như submit lặp, trả về bản ghi đã có thay vì chèn dòng mới.
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

    // 🔁 Chèn kèm retry chống trùng SKU: nếu 2 request chạy song song (hoặc số
    // nhảy chưa kịp cập nhật) làm trùng products_sku_key thì TÍNH LẠI SKU rồi
    // thử lại. INSERT là atomic nên lần lỗi không để lại dòng rác.
    const id = uid();
    let lastErr: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const sku = (data.sku?.trim() || (await nextSku())) as string;
      try {
        await insertRow("products", { id, ...payload, sku, created_at: now() });
        await logActivity({
          action: "create_product",
          detail: `Thêm sản phẩm: ${data.name} (SKU ${sku})`,
          employee_id: data.actor_id || null,
        });
        return { ok: true, id, sku };
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        const isSkuDup =
          /products_sku_key/i.test(msg) || (/duplicate key/i.test(msg) && /sku/i.test(msg));
        if (isSkuDup) {
          // SKU người dùng tự nhập mà trùng -> báo rõ để họ đổi, không tự sửa.
          if (data.sku?.trim()) {
            throw new Error(`Mã SKU "${data.sku.trim()}" đã tồn tại, vui lòng dùng mã khác.`);
          }
          lastErr = e; // SKU tự sinh bị trùng -> vòng sau nextSku() sẽ lấy số mới
          continue;
        }
        throw e; // lỗi khác -> ném ra ngay
      }
    }
    throw lastErr ?? new Error("Không tạo được SKU duy nhất, vui lòng thử lại.");
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