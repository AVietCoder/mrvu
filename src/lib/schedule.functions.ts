// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchRows, insertRow, now, supabase, uid, updateWhere, logActivity } from "./supabase";

export const listSchedules = createServerFn({ method: "GET" }).handler(async () => {
  const [
    schedules,
    assignments,
    difficulties,
    tech_fees,
    work_difficulties,
    work_types,
    users,
    customers,
    branches,
    products,
    orders,
    order_items,
    user_permissions,
  ] = await Promise.all([
    fetchRows("schedules", { orderBy: "scheduled_date", ascending: false }),
    fetchRows("schedule_assignments"),
    fetchRows("schedule_difficulties"),
    fetchRows("tech_fees"),
    fetchRows("work_difficulties", { orderBy: "bonus", ascending: false }),
    fetchRows("work_types", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name, username, is_admin", orderBy: "full_name" }),
    fetchRows("customers", { select: "id, name, phone, address, ward, district, province", orderBy: "created_at", ascending: false }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("products", { select: "id, sku, name, tech_fee", orderBy: "name" }),
    fetchRows("orders", {
      select: "id, code, customer_id, branch_id, status, total, created_at",
      orderBy: "created_at",
      ascending: false,
      limit: 200,
    }),
    fetchRows("order_items", { select: "order_id, product_id, qty" }),
    fetchRows("user_permissions", { select: "user_id, permission" }),
  ]);

  // Gắn permissions vào users
  const usersWithPerms = users.map((u: any) => ({
    ...u,
    permissions: (user_permissions as any[]).filter((p: any) => p.user_id === u.id).map((p: any) => p.permission),
  }));

  return {
    schedules,
    assignments,
    difficulties,
    tech_fees,
    work_difficulties,
    work_types,
    users: usersWithPerms,
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
      work_type_id?: string;
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
      work_type_id: data.work_type_id || null,
      created_at: now(),
    });
    await logActivity({ action: "create_schedule", detail: `Tạo lịch làm việc: ${data.title} (${data.scheduled_date})`, employee_id: data.created_by });
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
      work_type_id?: string | null;
      actor_id?: string;
    };
  }) => {
    await updateWhere(
      "schedules",
      { status: "approved", work_type_id: data.work_type_id || null },
      { id: data.schedule_id },
    );

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

    await logActivity({
      action: "approve_schedule",
      detail: `Duyệt lịch ${data.schedule_id} — ${data.user_ids.length} KTV`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

export const updateScheduleStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string; actor_id?: string } }) => {
    await updateWhere("schedules", { status: data.status }, { id: data.id });
    await logActivity({
      action: "update_schedule_status",
      detail: `Cập nhật trạng thái lịch ${data.id} → ${data.status}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; actor_id?: string } }) => {
    await deleteWhere("schedules", { id: data.id });
    await logActivity({
      action: "delete_schedule",
      detail: `Xóa lịch làm việc ${data.id}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

// ── Quản lý tính chất công việc (work_difficulties) ────────────
export const listWorkDifficulties = createServerFn({ method: "GET" }).handler(async () => {
  return fetchRows("work_difficulties", { orderBy: "bonus", ascending: false });
});

export const upsertWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: { id?: string; name: string; description?: string; bonus: number; actor_id?: string };
  }) => {
    if (data.id) {
      await updateWhere(
        "work_difficulties",
        { name: data.name, description: data.description || null, bonus: Number(data.bonus) },
        { id: data.id },
      );
      await logActivity({
        action: "update_work_difficulty",
        detail: `Sửa tính chất CV: ${data.name} (${Number(data.bonus).toLocaleString("vi-VN")}đ)`,
        employee_id: data.actor_id || null,
      });
    } else {
      await insertRow("work_difficulties", {
        id: uid(),
        name: data.name,
        description: data.description || null,
        bonus: Number(data.bonus),
      });
      await logActivity({
        action: "create_work_difficulty",
        detail: `Thêm tính chất CV: ${data.name} (${Number(data.bonus).toLocaleString("vi-VN")}đ)`,
        employee_id: data.actor_id || null,
      });
    }
    return { ok: true };
  });

export const deleteWorkDifficulty = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; actor_id?: string } }) => {
    await deleteWhere("work_difficulties", { id: data.id });
    await logActivity({
      action: "delete_work_difficulty",
      detail: `Xóa tính chất CV ${data.id}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

// ── Quản lý loại hình công việc (work_types) ───────────────────
export const listWorkTypes = createServerFn({ method: "GET" }).handler(async () => {
  return fetchRows("work_types", { orderBy: "name" });
});

export const upsertWorkType = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: { id?: string; name: string; description?: string; price: number; actor_id?: string };
  }) => {
    if (data.id) {
      await updateWhere(
        "work_types",
        { name: data.name, description: data.description || null, price: Number(data.price) },
        { id: data.id },
      );
      await logActivity({
        action: "update_work_type",
        detail: `Sửa loại hình CV: ${data.name} (${Number(data.price).toLocaleString("vi-VN")}đ)`,
        employee_id: data.actor_id || null,
      });
    } else {
      await insertRow("work_types", {
        id: uid(),
        name: data.name,
        description: data.description || null,
        price: Number(data.price),
        created_at: now(),
      });
      await logActivity({
        action: "create_work_type",
        detail: `Thêm loại hình CV: ${data.name} (${Number(data.price).toLocaleString("vi-VN")}đ)`,
        employee_id: data.actor_id || null,
      });
    }
    return { ok: true };
  });

export const deleteWorkType = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; actor_id?: string } }) => {
    await deleteWhere("work_types", { id: data.id });
    await logActivity({
      action: "delete_work_type",
      detail: `Xóa loại hình CV ${data.id}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

// ── Bảng chấm công theo tháng ─────────────────────────────────
// Trả về danh sách NV + tổng điểm/tiền tháng được chọn.
// Supports date_from / date_to (YYYY-MM-DD) or fallback to month (YYYY-MM)
export const attendanceSummary = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { month?: string; date_from?: string; date_to?: string } }) => {
    let from: string;
    let next: string; // exclusive upper bound
    let month: string;

    if (data?.date_from && data?.date_to) {
      from = data.date_from;
      // next = date_to + 1 day (inclusive end)
      const toDate = new Date(data.date_to);
      toDate.setDate(toDate.getDate() + 1);
      next = toDate.toISOString().slice(0, 10);
      month = data.date_from.slice(0, 7);
    } else {
      month = data?.month || new Date().toISOString().slice(0, 7);
      from = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }

    const { data: schedules, error: e1 } = await supabase
      .from("schedules")
      .select("id, title, scheduled_date, scheduled_time, work_type_id, status, customer_id, order_id, address")
      .gte("scheduled_date", from)
      .lt("scheduled_date", next)
      .in("status", ["approved", "in_progress", "done"]);
    if (e1) throw new Error(e1.message);

    const ids = (schedules ?? []).map((s: any) => s.id);
    const [assigns, diffs, wtypes, wdiffs, users, customers, orders] = await Promise.all([
      ids.length
        ? supabase.from("schedule_assignments").select("schedule_id, user_id").in("schedule_id", ids).then((r) => r.data ?? [])
        : Promise.resolve([]),
      ids.length
        ? supabase.from("schedule_difficulties").select("schedule_id, difficulty_id").in("schedule_id", ids).then((r) => r.data ?? [])
        : Promise.resolve([]),
      fetchRows("work_types"),
      fetchRows("work_difficulties"),
      fetchRows("users", { select: "id, full_name, username" }),
      fetchRows("customers", { select: "id, name, phone", orderBy: "created_at", ascending: false }),
      fetchRows("orders", { select: "id, code, total" }),
    ]);

    const wtMap: Record<string, any> = {};
    for (const w of wtypes) wtMap[w.id] = w;
    const wdMap: Record<string, any> = {};
    for (const w of wdiffs) wdMap[w.id] = w;
    const userMap: Record<string, any> = {};
    for (const u of users) userMap[u.id] = u;

    // gom assignments theo schedule
    const assignBySchedule: Record<string, string[]> = {};
    for (const a of assigns as any[]) {
      (assignBySchedule[a.schedule_id] ||= []).push(a.user_id);
    }
    const diffsBySchedule: Record<string, string[]> = {};
    for (const d of diffs as any[]) {
      (diffsBySchedule[d.schedule_id] ||= []).push(d.difficulty_id);
    }

    // tổng hợp theo user
    const perUser: Record<string, {
      user_id: string;
      full_name: string;
      username: string;
      type_points: number;
      diff_points: number;
      total_money: number;
      schedule_count: number;
      lines: any[];
    }> = {};

    for (const s of schedules as any[]) {
      const people = assignBySchedule[s.id] || [];
      if (!people.length) continue;
      const n = people.length;
      const wt = s.work_type_id ? wtMap[s.work_type_id] : null;
      const dIds = diffsBySchedule[s.id] || [];
      const diffSumPrice = dIds.reduce((sum, did) => sum + Number(wdMap[did]?.bonus || 0), 0);
      const typePrice = Number(wt?.price || 0);

      for (const uid_ of people) {
        const u = userMap[uid_] || { id: uid_, full_name: uid_, username: "" };
        const row = (perUser[uid_] ||= {
          user_id: uid_,
          full_name: u.full_name,
          username: u.username,
          type_points: 0,
          diff_points: 0,
          total_money: 0,
          schedule_count: 0,
          lines: [],
        });
        const typePt = wt ? 1 / n : 0;
        const diffPt = dIds.length / n;
        const money = (typePrice + diffSumPrice) / n;
        row.type_points += typePt;
        row.diff_points += diffPt;
        row.total_money += money;
        row.schedule_count += 1;
        row.lines.push({
          schedule_id: s.id,
          title: s.title,
          scheduled_date: s.scheduled_date,
          scheduled_time: s.scheduled_time,
          status: s.status,
          customer_id: s.customer_id,
          order_id: s.order_id,
          address: s.address,
          work_type: wt ? { id: wt.id, name: wt.name, price: Number(wt.price || 0) } : null,
          difficulties: dIds.map((id) => ({
            id,
            name: wdMap[id]?.name || id,
            bonus: Number(wdMap[id]?.bonus || 0),
          })),
          num_people: n,
          type_point_share: typePt,
          diff_point_share: diffPt,
          money_share: money,
        });
      }
    }

    return {
      month,
      rows: Object.values(perUser).sort((a, b) => b.total_money - a.total_money),
      customers,
      orders,
    };
  });
