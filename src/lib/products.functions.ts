import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  return {
    products: db.prepare("SELECT * FROM products ORDER BY name").all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY name").all(),
    stock: db.prepare("SELECT * FROM stock").all(),
  };
});

export const upsertProduct = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    if (data.id) {
      db.prepare(`UPDATE products SET
        sku=?, name=?, category_id=?, brand=?, power=?, color=?,
        blade_size=?, image_url=?, description=?, cost_price=?, sale_price=?, min_stock=?
        WHERE id=?`).run(
        data.sku, data.name, data.category_id || null, data.brand || null,
        data.power || null, data.color || null, data.blade_size || null,
        data.image_url || null, data.description || null,
        data.cost_price, data.sale_price, data.min_stock, data.id
      );
    } else {
      db.prepare(`INSERT INTO products
        (id,sku,name,category_id,brand,power,color,blade_size,image_url,description,cost_price,sale_price,min_stock,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        uid(), data.sku, data.name, data.category_id || null, data.brand || null,
        data.power || null, data.color || null, data.blade_size || null,
        data.image_url || null, data.description || null,
        data.cost_price, data.sale_price, data.min_stock, now()
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