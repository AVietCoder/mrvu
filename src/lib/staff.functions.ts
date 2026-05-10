import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

export const listEmployees = createServerFn({ method: "GET" }).handler(async () => {
  return {
    employees: db.prepare("SELECT * FROM employees ORDER BY name").all(),
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    logs: db.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 50").all(),
  };
});

export const upsertEmployee = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    if (data.id) {
      db.prepare("UPDATE employees SET name=?,phone=?,role=?,branch_id=? WHERE id=?")
        .run(data.name, data.phone||null, data.role, data.branch_id||null, data.id);
    } else {
      db.prepare("INSERT INTO employees (id,name,phone,role,branch_id,created_at) VALUES (?,?,?,?,?,?)")
        .run(uid(), data.name, data.phone||null, data.role, data.branch_id||null, now());
    }
    return { ok: true };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM employees WHERE id=?").run(data.id);
    return { ok: true };
  });

export const listBranches = createServerFn({ method: "GET" }).handler(async () => {
  return {
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    stock: db.prepare("SELECT * FROM stock").all(),
    orders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all(),
  };
});

export const upsertBranch = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    if (data.id) {
      db.prepare("UPDATE branches SET name=?,address=?,phone=? WHERE id=?")
        .run(data.name, data.address||null, data.phone||null, data.id);
    } else {
      db.prepare("INSERT INTO branches (id,name,address,phone,created_at) VALUES (?,?,?,?,?)")
        .run(uid(), data.name, data.address||null, data.phone||null, now());
    }
    return { ok: true };
  });

export const deleteBranch = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM branches WHERE id=?").run(data.id);
    return { ok: true };
  });