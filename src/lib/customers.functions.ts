import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  return {
    customers: db.prepare("SELECT * FROM customers ORDER BY name").all(),
    orders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all(),
  };
});

export const upsertCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    if (data.id) {
      db.prepare(`UPDATE customers SET name=?,phone=?,address=?,group_name=?,debt=? WHERE id=?`)
        .run(data.name, data.phone||null, data.address||null, data.group_name, data.debt||0, data.id);
    } else {
      db.prepare(`INSERT INTO customers (id,name,phone,address,group_name,debt,created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(uid(), data.name, data.phone||null, data.address||null, data.group_name, data.debt||0, now());
    }
    return { ok: true };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM customers WHERE id=?").run(data.id);
    return { ok: true };
  });

export const recordPayment = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { customer_id: string; amount: number } }) => {
    db.prepare("UPDATE customers SET debt = MAX(0, debt - ?) WHERE id=?")
      .run(data.amount, data.customer_id);
    return { ok: true };
  });