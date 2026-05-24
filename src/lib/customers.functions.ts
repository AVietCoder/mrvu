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
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data: customers, count: totalFilteredCustomers, error: custError } =
      await query.range(from, to);
    if (custError) throw new Error(custError.message);

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
      customers: customers ?? [],
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
    } else {
      await insertRow("customers", {
        id: uid(),
        ...payload,
        created_at: now(),
      });
    }
    return { ok: true };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("customers", { id: data.id });
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