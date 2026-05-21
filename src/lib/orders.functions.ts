import { createServerFn } from "@tanstack/react-start";
import { countRows, deleteWhere, fetchAllRows, fetchRows, insertRow, now, uid, updateWhere } from "./supabase";

async function nextCode() {
  const count = await countRows("orders");
  return "HD" + String(count + 1).padStart(6, "0");
}

async function adjustStock(productId: string, branchId: string, delta: number) {
  const rows = await fetchRows<{ qty: number }>("stock", {
    eq: { product_id: productId, branch_id: branchId },
    select: "qty",
    limit: 1,
  });
  const current = rows[0]?.qty ?? 0;
  const next = Math.max(0, current + delta);

  if (rows.length) {
    await updateWhere("stock", { qty: next }, { product_id: productId, branch_id: branchId });
  } else {
    await insertRow("stock", { product_id: productId, branch_id: branchId, qty: next });
  }
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const [orders, items, products, customers, employees, branches, schedules, schedule_assignments, users] =
    await Promise.all([
      fetchRows("orders", { orderBy: "created_at", ascending: false }),
      fetchRows("order_items"),
      fetchAllRows("products", { orderBy: "name" }),
      fetchAllRows("customers", { orderBy: "name" }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchRows("branches", { orderBy: "name" }),
      fetchRows("schedules", {
        select: "id, title, type, status, scheduled_date, scheduled_time, order_id, created_at",
        orderBy: "created_at",
        ascending: false,
      }),
      fetchRows("schedule_assignments"),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
    ]);

  const linkedSchedules = schedules.filter((s: any) => s.order_id != null);

  return {
    orders,
    items,
    products,
    customers,
    employees: employees.map((u: any) => ({ id: u.id, name: u.full_name })),
    branches,
    schedules: linkedSchedules,
    schedule_assignments,
    users,
  };
});

export const createOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const total = Math.max(0, subtotal - (data.discount || 0));
    const oid = uid();
    const code = await nextCode();

    await insertRow("orders", {
      id: oid,
      code,
      customer_id: data.customer_id || null,
      branch_id: data.branch_id,
      employee_id: data.employee_id || null,
      status: data.status,
      subtotal,
      discount: Number(data.discount || 0),
      total,
      deposit: Number(data.deposit || 0),
      paid: Number(data.paid || 0),
      note: data.note || null,
      created_at: now(),
    });

    for (const it of data.items) {
      const itemTotal = it.qty * it.unit_price - (it.discount || 0);
      await insertRow("order_items", {
        id: uid(),
        order_id: oid,
        product_id: it.product_id,
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
        discount: Number(it.discount || 0),
        total: itemTotal,
      });

      if (data.status === "completed") {
        await adjustStock(it.product_id, data.branch_id, -Number(it.qty));
      }
    }

    if (data.status === "completed" && data.customer_id) {
      const customerRows = await fetchRows<{ debt: number }>("customers", {
        eq: { id: data.customer_id },
        select: "debt",
        limit: 1,
      });
      const currentDebt = customerRows[0]?.debt ?? 0;
      const owed = total - (data.paid || 0);
      if (owed > 0) {
        await updateWhere("customers", { debt: currentDebt + owed }, { id: data.customer_id });
      }
    }

    await insertRow("activity_logs", {
      id: uid(),
      employee_id: data.employee_id || null,
      action: "create_order",
      detail: code,
      created_at: now(),
    });

    return { ok: true, code };
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; status: string } }) => {
    await updateWhere("orders", { status: data.status }, { id: data.id });
    return { ok: true };
  });

export const updateOrder = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const subtotal = data.items.reduce(
      (s: number, it: any) => s + it.qty * it.unit_price - (it.discount || 0),
      0,
    );
    const total = Math.max(0, subtotal - (data.discount || 0));

    await updateWhere(
      "orders",
      {
        customer_id: data.customer_id || null,
        branch_id: data.branch_id,
        employee_id: data.employee_id || null,
        status: data.status,
        subtotal,
        discount: Number(data.discount || 0),
        total,
        deposit: Number(data.deposit || 0),
        paid: Number(data.paid || 0),
        note: data.note || null,
      },
      { id: data.id },
    );

    await deleteWhere("order_items", { order_id: data.id });
    for (const it of data.items) {
      const itemTotal = it.qty * it.unit_price - (it.discount || 0);
      await insertRow("order_items", {
        id: uid(),
        order_id: data.id,
        product_id: it.product_id,
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
        discount: Number(it.discount || 0),
        total: itemTotal,
      });
    }

    return { ok: true };
  });
