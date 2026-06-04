// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchAllRows, fetchRows, insertRow, now, supabase, uid, updateWhere, logActivity } from "./supabase";

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
    // ⚠️ Các bảng dưới đây CÓ THỂ vượt 1000 dòng. Supabase mặc định cắt ở
    // 1000 → phải dùng fetchAllRows để KHÔNG mất dữ liệu (lịch/đơn/khách
    // hiển thị thiếu, chấm công sai). fetchAllRows tự phân trang lấy đủ 100%.
    fetchAllRows("schedules", { orderBy: "scheduled_date", ascending: false }),
    fetchAllRows("schedule_assignments"),
    fetchAllRows("schedule_difficulties"),
    fetchAllRows("tech_fees"),
    // Bảng cấu hình nhỏ (vài chục dòng) — giữ fetchRows là đủ.
    fetchRows("work_difficulties", { orderBy: "bonus", ascending: false }),
    fetchRows("work_types", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name, username, is_admin", orderBy: "full_name" }),
    fetchAllRows("customers", { select: "id, name, phone, address, ward, district, province", orderBy: "created_at", ascending: false }),
    fetchRows("branches", { orderBy: "name" }),
    fetchAllRows("products", { select: "id, sku, name, tech_fee", orderBy: "name" }),
    fetchAllRows("orders", {
      select: "id, code, customer_id, branch_id, employee_id, status, subtotal, discount, discount_type, discount_pct, vat_rate, vat_amount, total, deposit, paid, payment_method, note, created_at",
      orderBy: "created_at",
      ascending: false,
    }),
    fetchAllRows("order_items", { select: "order_id, product_id, qty, unit_price, discount, total" }),
    fetchAllRows("user_permissions", { select: "user_id, permission" }),
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
      // Mỗi tính chất kèm số lượng (qty). Vẫn nhận difficulty_ids cũ để tương thích ngược.
      difficulties?: { difficulty_id: string; qty?: number }[];
      difficulty_ids?: string[];
      tech_fees: { product_id: string; qty: number; unit_fee: number; user_id?: string }[];
      work_type_id?: string | null;
      work_type_qty?: number;
      scheduled_date?: string | null;
      actor_id?: string;
    };
  }) => {
    // Chuẩn hoá danh sách tính chất + số lượng (hỗ trợ cả payload cũ).
    const diffList: { difficulty_id: string; qty: number }[] =
      (data.difficulties && data.difficulties.length
        ? data.difficulties
        : (data.difficulty_ids ?? []).map((id) => ({ difficulty_id: id }))
      ).map((d) => ({ difficulty_id: d.difficulty_id, qty: Math.max(1, Number(d.qty ?? 1)) }));

    const updateFields: Record<string, any> = {
      status: "approved",
      work_type_id: data.work_type_id || null,
      // Không chọn loại hình thì qty = 1 (vô hại); có chọn thì lấy qty người dùng nhập.
      work_type_qty: data.work_type_id ? Math.max(1, Number(data.work_type_qty ?? 1)) : 1,
    };
    if (data.scheduled_date) updateFields.scheduled_date = data.scheduled_date;
    await updateWhere(
      "schedules",
      updateFields,
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
    if (diffList.length) {
      await supabase.from("schedule_difficulties").insert(
        diffList.map((d) => ({
          schedule_id: data.schedule_id,
          difficulty_id: d.difficulty_id,
          qty: d.qty,
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
          ...(tf.user_id ? { user_id: tf.user_id } : {}),
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
      .select("id, title, scheduled_date, scheduled_time, work_type_id, work_type_qty, status, customer_id, order_id, address")
      .gte("scheduled_date", from)
      .lt("scheduled_date", next)
      .in("status", ["approved", "in_progress", "done"]);
    if (e1) throw new Error(e1.message);

    const ids = (schedules ?? []).map((s: any) => s.id);
    const [assigns, diffs, fees, wtypes, wdiffs, users, customers, orders] = await Promise.all([
      ids.length
        ? supabase.from("schedule_assignments").select("schedule_id, user_id").in("schedule_id", ids).then((r) => r.data ?? [])
        : Promise.resolve([]),
      ids.length
        ? supabase.from("schedule_difficulties").select("schedule_id, difficulty_id, qty").in("schedule_id", ids).then((r) => r.data ?? [])
        : Promise.resolve([]),
      ids.length
        ? supabase.from("tech_fees").select("schedule_id, product_id, qty, unit_fee, user_id").in("schedule_id", ids).then((r) => r.data ?? [])
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
    const diffsBySchedule: Record<string, { difficulty_id: string; qty: number }[]> = {};
    for (const d of diffs as any[]) {
      (diffsBySchedule[d.schedule_id] ||= []).push({ difficulty_id: d.difficulty_id, qty: Math.max(1, Number(d.qty ?? 1)) });
    }
    // Thu nhập khác (tech_fees) gom theo lịch — tách riêng: phần chia đều và phần gán cho user cụ thể
    const feesBySchedule: Record<string, { items: any[]; sharedTotal: number; perUserExtra: Record<string, number> }> = {};
    for (const f of fees as any[]) {
      const bucket = (feesBySchedule[f.schedule_id] ||= { items: [], sharedTotal: 0, perUserExtra: {} });
      const amount = Number(f.qty || 0) * Number(f.unit_fee || 0);
      bucket.items.push({
        product_id: f.product_id,
        qty: Number(f.qty || 0),
        unit_fee: Number(f.unit_fee || 0),
        amount,
        user_id: f.user_id || null,
      });
      if (f.user_id) {
        // Gán trực tiếp cho user này
        bucket.perUserExtra[f.user_id] = (bucket.perUserExtra[f.user_id] ?? 0) + amount;
      } else {
        // Chia đều
        bucket.sharedTotal += amount;
      }
    }

    // tổng hợp theo user
    const perUser: Record<string, {
      user_id: string;
      full_name: string;
      username: string;
      type_points: number;
      diff_points: number;
      total_money: number;
      extra_income: number;
      schedule_count: number;
      lines: any[];
    }> = {};

    for (const s of schedules as any[]) {
      const people = assignBySchedule[s.id] || [];
      if (!people.length) continue;
      const n = people.length;
      const wt = s.work_type_id ? wtMap[s.work_type_id] : null;
      const wtQty = Math.max(1, Number(s.work_type_qty ?? 1));
      const dRows = diffsBySchedule[s.id] || [];
      // TIỀN nhân theo số lượng; ĐIỂM thì không (vẫn đếm số tính chất / loại hình).
      const diffSumPrice = dRows.reduce((sum, d) => sum + Number(wdMap[d.difficulty_id]?.bonus || 0) * d.qty, 0);
      const typePrice = Number(wt?.price || 0) * wtQty;
      // Thu nhập khác: phần chia đều và phần riêng theo user
      const feeBucket = feesBySchedule[s.id] || { items: [], sharedTotal: 0, perUserExtra: {} };
      const sharedExtraTotal = feeBucket.sharedTotal;

      for (const uid_ of people) {
        const u = userMap[uid_] || { id: uid_, full_name: uid_, username: "" };
        const row = (perUser[uid_] ||= {
          user_id: uid_,
          full_name: u.full_name,
          username: u.username,
          type_points: 0,
          diff_points: 0,
          total_money: 0,
          extra_income: 0,
          schedule_count: 0,
          lines: [],
        });
        const typePt = wt ? 1 / n : 0;
        const diffPt = dRows.length / n;
        // Tiền thu nhập riêng của user này trong lịch (nếu có)
        const userDirectExtra = feeBucket.perUserExtra[uid_] ?? 0;
        // Tiền công/người = (loại hình + tính chất + phần chia đều) / số người + tiền riêng
        const money = (typePrice + diffSumPrice + sharedExtraTotal) / n + userDirectExtra;
        const extraIncomeShare = sharedExtraTotal / n + userDirectExtra;
        row.type_points += typePt;
        row.diff_points += diffPt;
        row.total_money += money;
        row.extra_income += extraIncomeShare;
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
          work_type: wt ? { id: wt.id, name: wt.name, price: Number(wt.price || 0), qty: wtQty } : null,
          difficulties: dRows.map((d) => ({
            id: d.difficulty_id,
            name: wdMap[d.difficulty_id]?.name || d.difficulty_id,
            bonus: Number(wdMap[d.difficulty_id]?.bonus || 0),
            qty: d.qty,
          })),
          extra_income: feeBucket.items,
          extra_income_total: sharedExtraTotal + Object.values(feeBucket.perUserExtra).reduce((a, b) => a + b, 0),
          extra_income_share: extraIncomeShare,
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

export const updateScheduleOrderLink = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { schedule_id: string; order_id: string | null; actor_id?: string } }) => {
    await updateWhere("schedules", { order_id: data.order_id || null }, { id: data.schedule_id });
    await logActivity({
      action: "update_schedule_link",
      detail: `Cập nhật liên kết đơn hàng cho lịch ${data.schedule_id}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });

// ── Server-side search for schedule form (no 100-row limit) ────
export const searchOrdersForSchedule = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { q?: string; limit?: number; ids?: string[] } }) => {
    const q = (data?.q ?? "").trim();
    const limit = Math.min(Math.max(Number(data?.limit ?? 30), 1), 100);

    let orderRows: any[] = [];
    if (data?.ids && data.ids.length) {
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, code, customer_id, branch_id, total, created_at")
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      orderRows = rows ?? [];
    } else {
      // If query looks like a phone or name, search customers first
      let customerIds: string[] = [];
      if (q) {
        const { data: custs } = await supabase
          .from("customers")
          .select("id")
          .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(50);
        customerIds = (custs ?? []).map((c: any) => c.id);
      }

      let query = supabase
        .from("orders")
        .select("id, code, customer_id, branch_id, total, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (q) {
        const orClauses = [`code.ilike.%${q}%`];
        if (customerIds.length) orClauses.push(`customer_id.in.(${customerIds.join(",")})`);
        query = query.or(orClauses.join(","));
      }

      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      orderRows = rows ?? [];
    }

    const custIds = Array.from(new Set(orderRows.map((o) => o.customer_id).filter(Boolean)));
    let customers: any[] = [];
    if (custIds.length) {
      const { data: rows } = await supabase
        .from("customers")
        .select("id, name, phone, address, ward, district, province")
        .in("id", custIds);
      customers = rows ?? [];
    }
    return { orders: orderRows, customers };
  });

export const searchCustomersForSchedule = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { q?: string; limit?: number; ids?: string[] } }) => {
    const q = (data?.q ?? "").trim();
    const limit = Math.min(Math.max(Number(data?.limit ?? 30), 1), 100);

    if (data?.ids && data.ids.length) {
      const { data: rows, error } = await supabase
        .from("customers")
        .select("id, name, phone, address, ward, district, province")
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      return { customers: rows ?? [] };
    }

    let query = supabase
      .from("customers")
      .select("id, name, phone, address, ward, district, province")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { customers: rows ?? [] };
  });

// ── Cập nhật thông tin lịch (cho chủ lịch hoặc admin) ─────────
export const updateSchedule = createServerFn({ method: "POST" })
  .handler(async ({ data }: {
    data: {
      id: string;
      title?: string;
      scheduled_date?: string;
      scheduled_time?: string | null;
      branch_id?: string | null;
      order_id?: string | null;
      customer_id?: string | null;
      address?: string | null;
      note?: string | null;
      assigned_user_ids?: string[];
      created_by?: string;
      actor_id?: string;
      actor_is_admin?: boolean;
    };
  }) => {
    // Server-side permission check
    if (!data.actor_is_admin) {
      const existing = await fetchRows("schedules", { select: "id, created_by", eq: { id: data.id } });
      const row = (existing as any[])[0];
      if (!row) throw new Error("Không tìm thấy lịch");
      if (row.created_by !== data.actor_id) {
        throw new Error("Bạn không có quyền sửa lịch này");
      }
      // Non-admin cannot reassign creator
      if (data.created_by && data.created_by !== row.created_by) {
        throw new Error("Chỉ admin mới được đổi người tạo");
      }
    }

    const fields: Record<string, any> = {};
    if (data.title !== undefined) fields.title = data.title;
    if (data.scheduled_date !== undefined) fields.scheduled_date = data.scheduled_date;
    if (data.scheduled_time !== undefined) fields.scheduled_time = data.scheduled_time || null;
    if (data.branch_id !== undefined) fields.branch_id = data.branch_id || null;
    if (data.order_id !== undefined) fields.order_id = data.order_id || null;
    if (data.customer_id !== undefined) fields.customer_id = data.customer_id || null;
    if (data.address !== undefined) fields.address = data.address || null;
    if (data.note !== undefined) fields.note = data.note || null;
    if (data.actor_is_admin && data.created_by) fields.created_by = data.created_by;

    if (Object.keys(fields).length) {
      await updateWhere("schedules", fields, { id: data.id });
    }

    if (data.assigned_user_ids) {
      await deleteWhere("schedule_assignments", { schedule_id: data.id });
      if (data.assigned_user_ids.length) {
        await supabase.from("schedule_assignments").insert(
          data.assigned_user_ids.map((user_id) => ({ schedule_id: data.id, user_id })),
        );
      }
    }

    await logActivity({
      action: "update_schedule",
      detail: `Sửa thông tin lịch ${data.id}`,
      employee_id: data.actor_id || null,
    });
    return { ok: true };
  });
