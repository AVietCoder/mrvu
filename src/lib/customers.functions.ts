// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import {
  aggregateColumn,
  countRows,
  deleteWhere,
  fetchAllRows,
  fetchRows,
  insertRow,
  now,
  supabase,
  uid,
  updateWhere,
} from "./supabase";

interface ListCustomersArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  group?: string;
  debtFilter?: string;
  sortBy?: string;
}

export const listCustomers = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: ListCustomersArgs | undefined }) => {
    const page = data?.page ?? 1;
    const pageSize = data?.pageSize ?? 100;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("customers")
      .select("*", { count: "exact" });

    if (data?.search) {
      const q = `%${data.search}%`;
      query = query.or(`name.ilike.${q},phone.ilike.${q}`);
    }
    if (data?.group) {
      query = query.eq("group_name", data.group);
    }
    if (data?.debtFilter === "debt") {
      query = query.gt("debt", 0);
    } else if (data?.debtFilter === "no_debt") {
      query = query.eq("debt", 0);
    }

    if (data?.sortBy === "name") {
      query = query.order("name", { ascending: true });
    } else if (data?.sortBy === "debt_desc") {
      query = query.order("debt", { ascending: false });
    } else if (data?.sortBy === "debt_asc") {
      query = query.order("debt", { ascending: true });
    } else if (data?.sortBy === "total_buy_desc" || data?.sortBy === "total_buy_asc") {
      // total_buy is computed from orders — we sort after fetching all IDs
      query = query.order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const isTotalBuySort = data?.sortBy === "total_buy_desc" || data?.sortBy === "total_buy_asc";

    let customerRows: any[];
    let totalFilteredCustomers: number | null;

    if (isTotalBuySort) {
      // Fetch all matching customers (no range), sort by total_buy, then paginate
      const { data: allCustomers, count, error: custError } = await query;
      if (custError) throw new Error(custError.message);
      totalFilteredCustomers = count;

      // Compute total_buy for each customer from orders
      const allOrders = await fetchAllRows("orders", { select: "customer_id, total, status" });
      const buyMap = new Map<string, number>();
      for (const o of allOrders) {
        if (o.status === "completed" && o.customer_id) {
          buyMap.set(o.customer_id, (buyMap.get(o.customer_id) ?? 0) + Number(o.total || 0));
        }
      }
      const sorted = (allCustomers ?? [])
        .map((c: any) => ({ ...c, total_buy: buyMap.get(c.id) ?? 0 }))
        .sort((a: any, b: any) => data?.sortBy === "total_buy_desc" ? b.total_buy - a.total_buy : a.total_buy - b.total_buy);
      customerRows = sorted.slice(from, to + 1);
    } else {
      const { data: customers, count, error: custError } = await query.range(from, to);
      if (custError) throw new Error(custError.message);
      totalFilteredCustomers = count;
      customerRows = customers ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // Thống kê toàn cục: KHÔNG dùng .select("debt") thường vì
    // Supabase giới hạn 1000 dòng → 15.000 khách sẽ bị mất 14.000.
    // Dùng aggregateColumn (phân trang qua .range()) để tính đúng.
    // ────────────────────────────────────────────────────────────────
    const [debtAgg, totalAllCustomers, orders] = await Promise.all([
      aggregateColumn("customers", "debt"),
      countRows("customers"),
      fetchAllRows("orders", { orderBy: "created_at", ascending: false }),
    ]);

    return {
      customers: customerRows ?? [],
      orders: orders ?? [],
      meta: {
        totalFiltered: totalFilteredCustomers ?? 0,
        totalAllCustomers,
        totalAllDebt: debtAgg.sum,
        totalDebtorCount: debtAgg.positiveCount,
      },
    };
  });

export const upsertCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const payload = {
      name: data.name,
      phone: data.phone || null,
      ward: data.ward || null,
      district: data.district || null,
      province: data.province || null,
      address: data.address || null,
      group_name: data.group_name,
      debt: data.debt || 0,
    };

    if (data.id) {
      await updateWhere("customers", payload, { id: data.id });
      await insertRow("activity_logs", { id: uid(), employee_id: null, action: "update_customer", detail: data.name, created_at: now() }).catch(() => undefined);
    } else {
      await insertRow("customers", {
        id: uid(),
        ...payload,
        created_at: now(),
      });
      await insertRow("activity_logs", { id: uid(), employee_id: null, action: "create_customer", detail: data.name, created_at: now() }).catch(() => undefined);
    }
    return { ok: true };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("customers", { id: data.id });
    await insertRow("activity_logs", { id: uid(), employee_id: null, action: "delete_customer", detail: `ID: ${data.id}`, created_at: now() }).catch(() => undefined);
    return { ok: true };
  });

export const recordPayment = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { customer_id: string; amount: number } }) => {
    const rows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: data.customer_id },
      select: "debt",
      limit: 1,
    });
    const current = rows[0]?.debt ?? 0;
    const next = Math.max(0, current - Number(data.amount || 0));
    await updateWhere("customers", { debt: next }, { id: data.customer_id });
    return { ok: true };
  });
export const getCustomerById = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: { id: string } }) => {
    const customer = await fetchRows("customers", {
      eq: { id: data.id },
      limit: 1,
    });

    const orders = await fetchRows("orders", {
      eq: { customer_id: data.id },
      orderBy: "created_at",
      ascending: false,
    });

    return {
      customer: customer[0] ?? null,
      orders,
    };
  });