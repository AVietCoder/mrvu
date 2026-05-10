import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

function nextCode() {
  const row = db.prepare("SELECT COUNT(*) as c FROM orders").get() as any;
  return "HD" + String(row.c + 1).padStart(6, "0");
}

function adjustStock(productId: string, branchId: string, delta: number) {
  const row = db.prepare("SELECT qty FROM stock WHERE product_id=? AND branch_id=?")
    .get(productId, branchId);
  if (row) {
    db.prepare("UPDATE stock SET qty=qty+? WHERE product_id=? AND branch_id=?")
      .run(delta, productId, branchId);
  } else {
    db.prepare("INSERT INTO stock (product_id,branch_id,qty) VALUES (?,?,?)")
      .run(productId, branchId, Math.max(0, delta));
  }
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  return {
    orders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all(),
    items: db.prepare("SELECT * FROM order_items").all(),
    products: db.prepare("SELECT * FROM products").all(),
    customers: db.prepare("SELECT * FROM customers ORDER BY name").all(),
    employees: db.prepare("SELECT * FROM employees ORDER BY name").all(),
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
  };
});

export const createOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0), 0
    );
    const total = Math.max(0, subtotal - (data.discount || 0));
    const oid = uid();
    const code = nextCode();

    // Dùng transaction để đảm bảo toàn vẹn dữ liệu
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO orders
        (id,code,customer_id,branch_id,employee_id,status,subtotal,discount,total,deposit,paid,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          oid, code,
          data.customer_id || null, data.branch_id,
          data.employee_id || null, data.status,
          subtotal, data.discount || 0, total,
          data.deposit || 0, data.paid || 0,
          data.note || null, now()
        );

      for (const it of data.items) {
        const itemTotal = it.qty * it.unit_price - (it.discount || 0);
        db.prepare(`INSERT INTO order_items (id,order_id,product_id,qty,unit_price,discount,total)
          VALUES (?,?,?,?,?,?,?)`)
          .run(uid(), oid, it.product_id, it.qty, it.unit_price, it.discount || 0, itemTotal);

        if (data.status === "completed") {
          adjustStock(it.product_id, data.branch_id, -it.qty);
        }
      }

      // Ghi công nợ nếu chưa trả đủ
      if (data.status === "completed" && data.customer_id) {
        const owed = total - (data.paid || 0);
        if (owed > 0) {
          db.prepare("UPDATE customers SET debt=debt+? WHERE id=?")
            .run(owed, data.customer_id);
        }
      }

      db.prepare(`INSERT INTO activity_logs (id,employee_id,action,detail,created_at)
        VALUES (?,?,?,?,?)`)
        .run(uid(), data.employee_id || null, "create_order", code, now());
    });

    transaction();
    return { ok: true, code };
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string } }) => {
    db.prepare("UPDATE orders SET status=? WHERE id=?").run(data.status, data.id);
    return { ok: true };
  });