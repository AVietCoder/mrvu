import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

function nextSku(): string {
  const row = db.prepare("SELECT COUNT(*) as c FROM products").get() as any;
  return "SP-" + String(row.c + 1).padStart(4, "0");
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  return {
    products: db.prepare("SELECT * FROM products ORDER BY name").all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY name").all(),
    brands: db.prepare("SELECT * FROM brands ORDER BY name").all(),
    stock: db.prepare("SELECT * FROM stock").all(),
  };
});

export const upsertProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const sku = data.sku?.trim() || (data.id ? undefined : nextSku());
    if (data.id) {
      db.prepare(`UPDATE products SET
        sku=?, name=?, category_id=?, brand_id=?,
        power=?, color=?, blade_size=?,
        image_url=?, description=?,
        cost_price=?, sale_price=?, min_stock=?, tech_fee=?
        WHERE id=?`).run(
        sku ?? data.sku, data.name,
        data.category_id || null, data.brand_id || null,
        data.power || null, data.color || null, data.blade_size || null,
        data.image_url || null, data.description || null,
        data.cost_price, data.sale_price, data.min_stock,
        data.tech_fee || 0, data.id
      );
    } else {
      db.prepare(`INSERT INTO products
        (id,sku,name,category_id,brand_id,power,color,blade_size,image_url,description,cost_price,sale_price,min_stock,tech_fee,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        uid(), sku, data.name,
        data.category_id || null, data.brand_id || null,
        data.power || null, data.color || null, data.blade_size || null,
        data.image_url || null, data.description || null,
        data.cost_price, data.sale_price, data.min_stock,
        data.tech_fee || 0, now()
      );
    }
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM stock WHERE product_id=?").run(data.id);
    db.prepare("DELETE FROM products WHERE id=?").run(data.id);
    return { ok: true };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string } }) => {
    if (data.id) {
      db.prepare("UPDATE categories SET name=? WHERE id=?").run(data.name, data.id);
    } else {
      db.prepare("INSERT INTO categories (id,name) VALUES (?,?)").run(uid(), data.name);
    }
    return { ok: true };
  });

export const upsertBrand = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string } }) => {
    if (data.id) {
      db.prepare("UPDATE brands SET name=? WHERE id=?").run(data.name, data.id);
    } else {
      db.prepare("INSERT INTO brands (id,name) VALUES (?,?)").run(uid(), data.name);
    }
    return { ok: true };
  });

export const deleteBrand = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM brands WHERE id=?").run(data.id);
    return { ok: true };
  });