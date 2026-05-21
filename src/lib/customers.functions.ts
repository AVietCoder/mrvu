// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchRows, insertRow, now, updateWhere, uid } from "./supabase";
import { supabase } from "./supabase"; // Sử dụng instance supabase gốc để gọi lệnh range và count

// Định nghĩa interface cho tham số truyền vào từ frontend
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
    const pageSize = data?.pageSize ?? 100; // Tăng lên 100 khách mỗi lần cuộn để xem được nhiều hơn
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

    const { data: customers, count: totalFilteredCustomers, error: custError } = await query.range(from, to);
    if (custError) throw new Error(custError.message);

    // Tính toán số liệu tổng quan của toàn bộ 15.000 khách
    const [statsRes, ordersRes] = await Promise.all([
      supabase.from("customers").select("debt"),
      fetchRows("orders", { orderBy: "created_at", ascending: false }),
    ]);

    let totalAllCustomers = 0;
    let totalAllDebt = 0;
    let totalDebtorCount = 0;

    const { data: allStats, error: statsError } = statsRes;
    
    if (!statsError && allStats) {
      totalAllCustomers = allStats.length;
      allStats.forEach(c => {
        if (c.debt > 0) {
          totalAllDebt += c.debt;
          totalDebtorCount++;
        }
      });
    }

    return {
      customers: customers ?? [],
      orders: ordersRes ?? [],
      meta: {
        totalFiltered: totalFilteredCustomers ?? 0,
        totalAllCustomers,
        totalAllDebt,
        totalDebtorCount
      }
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