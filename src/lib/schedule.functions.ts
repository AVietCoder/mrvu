// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchRows, insertRow, now, supabase, uid, updateWhere } from "./supabase";

export const listSchedules = createServerFn({ method: "GET" }).handler(async () => {
  const [
    schedules,
    assignments,
    difficulties,
    tech_fees,
    work_difficulties,
    users,
    customers,
    branches,
    products,
    orders,
    order_items,
  ] = await Promise.all([
    fetchRows("schedules", { orderBy: "scheduled_date", ascending: false }),
    fetchRows("schedule_assignments"),
    fetchRows("schedule_difficulties"),
    fetchRows("tech_fees"),
    fetchRows("work_difficulties", { orderBy: "bonus", ascending: false }),
    fetchRows("users", { select: "id, full_name, username", orderBy: "full_name" }),
    fetchRows("customers", { select: "id, name, phone, address, ward, district, province", orderBy: "name" }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("products", { select: "id, sku, name, tech_fee", orderBy: "name" }),
    fetchRows("orders", {
      select: "id, code, customer_id, branch_id, status, total, created_at",
      orderBy: "created_at",
      ascending: false,
      limit: 200,
    }),
    fetchRows("order_items", { select: "order_id, product_id, qty" }),
  ]);

  return {
    schedules,
    assignments,
    difficulties,
    tech_fees,
    work_difficulties,
    users,
    customers,
    branches,
    products,
    orders,
    order_items,
  };
});

export const createSchedule = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      title: string;
      type: string;
      scheduled_date: string;
      scheduled_time?: string;
      customer_id?: string;
      branch_id?: string;
      order_id?: string;
      address?: string;
      note?: string;
      created_by: string;
      assigned_by?: string;
    };
  }) => {
    const id = uid();
    await insertRow("schedules", {
      id,
      title: data.title,
      type: data.type,
      status: "pending",
      scheduled_date: data.scheduled_date,
      scheduled_time: data.scheduled_time || null,
      customer_id: data.customer_id || null,
      branch_id: data.branch_id || null,
      order_id: data.order_id || null,
      address: data.address || null,
      note: data.note || null,
      created_by: data.created_by,
      assigned_by: data.assigned_by || null,
      created_at: now(),
    });
    return { id };
  });

export const approveSchedule = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      schedule_id: string;
      user_ids: string[];
      difficulty_ids: string[];
      tech_fees: { product_id: string; qty: number; unit_fee: number }[];
    };
  }) => {
    await updateWhere("schedules", { status: "approved" }, { id: data.schedule_id });

    await deleteWhere("schedule_assignments", { schedule_id: data.schedule_id });
    if (data.user_ids.length) {
      await supabase.from("schedule_assignments").insert(
        data.user_ids.map((user_id) => ({
          schedule_id: data.schedule_id,
          user_id,
        })),
      );
    }

    await deleteWhere("schedule_difficulties", { schedule_id: data.schedule_id });
    if (data.difficulty_ids.length) {
      await supabase.from("schedule_difficulties").insert(
        data.difficulty_ids.map((difficulty_id) => ({
          schedule_id: data.schedule_id,
          difficulty_id,
        })),
      );
    }

    await deleteWhere("tech_fees", { schedule_id: data.schedule_id });
    if (data.tech_fees.length) {
      await supabase.from("tech_fees").insert(
        data.tech_fees.map((tf) => ({
          schedule_id: data.schedule_id,
          product_id: tf.product_id,
          qty: Number(tf.qty),
          unit_fee: Number(tf.unit_fee),
        })),
      );
    }

    return { ok: true };
  });

export const updateScheduleStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string } }) => {
    await updateWhere("schedules", { status: data.status }, { id: data.id });
    return { ok: true };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("schedules", { id: data.id });
    return { ok: true };
  });

// Quản lý tính chất công việc
export const listWorkDifficulties = createServerFn({ method: "GET" }).handler(async () => {
  return fetchRows("work_difficulties", { orderBy: "bonus", ascending: false });
});

export const upsertWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: { id?: string; name: string; description?: string; bonus: number };
  }) => {
    if (data.id) {
      await updateWhere(
        "work_difficulties",
        { name: data.name, description: data.description || null, bonus: Number(data.bonus) },
        { id: data.id },
      );
    } else {
      await insertRow("work_difficulties", {
        id: uid(),
        name: data.name,
        description: data.description || null,
        bonus: Number(data.bonus),
      });
    }
    return { ok: true };
  });

export const deleteWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("work_difficulties", { id: data.id });
    return { ok: true };
  });
