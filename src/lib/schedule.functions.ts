import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

export const listSchedules = createServerFn({ method: "GET" }).handler(async () => {
  return {
    schedules: db.prepare("SELECT * FROM schedules ORDER BY scheduled_date DESC, scheduled_time ASC").all(),
    assignments: db.prepare("SELECT * FROM schedule_assignments").all(),
    difficulties: db.prepare("SELECT * FROM schedule_difficulties").all(),
    tech_fees: db.prepare("SELECT * FROM tech_fees").all(),
    work_difficulties: db.prepare("SELECT * FROM work_difficulties ORDER BY bonus DESC").all(),
    users: db.prepare("SELECT id, full_name, username FROM users ORDER BY full_name").all(),
    customers: db.prepare("SELECT id, name, phone, address, ward, district, province FROM customers ORDER BY name").all(),
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    products: db.prepare("SELECT id, sku, name, tech_fee FROM products ORDER BY name").all(),
    orders: db.prepare(`
      SELECT id, code, customer_id, branch_id, status, total, created_at
      FROM orders
      WHERE status IN ('reserved','draft','completed')
      ORDER BY created_at DESC
      LIMIT 200
    `).all(),
    order_items: db.prepare("SELECT order_id, product_id, qty FROM order_items").all(),
  };
});

export const createSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    title: string; type: string; scheduled_date: string;
    scheduled_time?: string; customer_id?: string; branch_id?: string;
    order_id?: string; address?: string; note?: string; created_by: string;
  }}) => {
    const id = uid();
    db.prepare(`INSERT INTO schedules
      (id,title,type,status,scheduled_date,scheduled_time,customer_id,branch_id,order_id,address,note,created_by,created_at)
      VALUES (?,?,?,'pending',?,?,?,?,?,?,?,?,?)`)
      .run(id, data.title, data.type, data.scheduled_date,
        data.scheduled_time || null, data.customer_id || null,
        data.branch_id || null, data.order_id || null,
        data.address || null, data.note || null, data.created_by, now());
    return { id };
  });

export const approveSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    schedule_id: string;
    user_ids: string[];
    difficulty_ids: string[];
    tech_fees: { product_id: string; qty: number; unit_fee: number }[];
  }}) => {
    const t = db.transaction(() => {
      db.prepare("UPDATE schedules SET status='approved' WHERE id=?").run(data.schedule_id);

      db.prepare("DELETE FROM schedule_assignments WHERE schedule_id=?").run(data.schedule_id);
      for (const uid of data.user_ids) {
        db.prepare("INSERT OR IGNORE INTO schedule_assignments VALUES (?,?)").run(data.schedule_id, uid);
      }

      db.prepare("DELETE FROM schedule_difficulties WHERE schedule_id=?").run(data.schedule_id);
      for (const did of data.difficulty_ids) {
        db.prepare("INSERT OR IGNORE INTO schedule_difficulties VALUES (?,?)").run(data.schedule_id, did);
      }

      db.prepare("DELETE FROM tech_fees WHERE schedule_id=?").run(data.schedule_id);
      for (const tf of data.tech_fees) {
        db.prepare("INSERT INTO tech_fees (schedule_id,product_id,qty,unit_fee) VALUES (?,?,?,?)")
          .run(data.schedule_id, tf.product_id, tf.qty, tf.unit_fee);
      }
    });
    t();
    return { ok: true };
  });

export const updateScheduleStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string }}) => {
    db.prepare("UPDATE schedules SET status=? WHERE id=?").run(data.status, data.id);
    return { ok: true };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string }}) => {
    db.prepare("DELETE FROM schedules WHERE id=?").run(data.id);
    return { ok: true };
  });

// Quản lý tính chất công việc
export const listWorkDifficulties = createServerFn({ method: "GET" }).handler(async () => {
  return db.prepare("SELECT * FROM work_difficulties ORDER BY bonus DESC").all();
});

export const upsertWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string; description?: string; bonus: number }}) => {
    if (data.id) {
      db.prepare("UPDATE work_difficulties SET name=?,description=?,bonus=? WHERE id=?")
        .run(data.name, data.description || null, data.bonus, data.id);
    } else {
      db.prepare("INSERT INTO work_difficulties (id,name,description,bonus) VALUES (?,?,?,?)")
        .run(uid(), data.name, data.description || null, data.bonus);
    }
    return { ok: true };
  });

export const deleteWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string }}) => {
    db.prepare("DELETE FROM work_difficulties WHERE id=?").run(data.id);
    return { ok: true };
  });
