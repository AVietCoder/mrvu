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
  logActivity,
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
    } else if (data?.sortBy === "total_buy_desc") {
      query = query.order("total_buy", { ascending: false });
    } else if (data?.sortBy === "total_buy_asc") {
      query = query.order("total_buy", { ascending: true });
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
      email: data.email || null,
      gender: data.gender || null,
      birthday: data.birthday || null,
      ward: data.ward || null,
      district: data.district || null,
      province: data.province || null,
      address: data.address || null,
      group_name: data.group_name,
      customer_type: data.customer_type || "ca_nhan",
      company_name: data.company_name || null,
      tax_code: data.tax_code || null,
      cccd: data.cccd || null,
      passport_no: data.passport_no || null,
      bank_name: data.bank_name || null,
      bank_account: data.bank_account || null,
      note: data.note || null,
      debt: data.debt || 0,
    };

    if (data.id) {
      await updateWhere("customers", payload, { id: data.id });
      await logActivity({ action: "update_customer", detail: `Cập nhật khách hàng: ${data.name}`, employee_id: data._actor_id ?? null });
    } else {
      await insertRow("customers", {
        id: uid(),
        ...payload,
        created_by: data._actor_id || null,
        created_by_name: data.created_by_name || null,
        created_at: now(),
      });
      await logActivity({ action: "create_customer", detail: `Thêm khách hàng mới: ${data.name}`, employee_id: data._actor_id ?? null });
    }
    return { ok: true };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("customers", { id: data.id });
    await logActivity({ action: "delete_customer", detail: `Xóa khách hàng ID: ${data.id}` });
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
    const next = current - Number(data.amount || 0);  // Cho phép âm
    await updateWhere("customers", { debt: next }, { id: data.customer_id });
    await logActivity({ action: "customer_payment", detail: `Thu công nợ ${data.amount?.toLocaleString?.() ?? data.amount}đ — KH: ${data.customer_id}` });
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

    const branches = await fetchRows("branches", { orderBy: "name" });

    // Lịch sử thu tiền (phiếu thu trong cash_vouchers liên quan đến khách hàng này)
    const { data: paymentHistory, error: phError } = await supabase
      .from("cash_vouchers")
      .select("id, code, amount, fund_type, note, created_at, collector_user_id, status")
      .eq("payer_customer_id", data.id)
      .eq("type", "thu")
      .order("created_at", { ascending: false });

    // Lấy thông tin users để hiện tên người thu
    const users = await fetchRows("users", { select: "id, full_name", orderBy: "full_name" });

    return {
      customer: customer[0] ?? null,
      orders,
      branches,
      paymentHistory: (paymentHistory ?? []).filter((p: any) => p.status !== "cancelled"),
      allPaymentHistory: paymentHistory ?? [],
      users,
    };
  });
export const collectCustomerPayment = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { customer_id: string; amount: number; branch_id: string; employee_id?: string; note?: string; fund_type?: string } }) => {
    const amount = Number(data.amount || 0);
    if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0");

    // Retry loop to avoid duplicate key race condition
    let code: string = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const { count } = await supabase
        .from("cash_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("type", "thu");
      const candidate = "PT" + String((count ?? 0) + 1 + attempt).padStart(6, "0");
      const { data: existing } = await supabase
        .from("cash_vouchers")
        .select("id")
        .eq("code", candidate)
        .maybeSingle();
      if (!existing) { code = candidate; break; }
    }
    if (!code) {
      const ts = Date.now().toString().slice(-6);
      const rand = Math.floor(Math.random() * 100).toString().padStart(2, "0");
      code = "PT" + ts + rand;
    }
    const fundType = data.fund_type === "ngan_hang" ? "ngan_hang" : "tien_mat";

    await insertRow("cash_vouchers", {
      id: uid(),
      code,
      type: "thu",
      fund_type: fundType,
      branch_id: data.branch_id,
      amount,
      voucher_type_id: null,
      collector_user_id: data.employee_id || null,
      payer_customer_id: data.customer_id,
      payer_user_id: null,
      receiver_customer_id: null,
      note: data.note || `Thu tiền công nợ từ khách`,
      accounting: true,
      status: "active",
      created_by: data.employee_id || null,
      created_at: now(),
    });

    // Cập nhật công nợ khách hàng (cho phép âm nếu thanh toán thừa)
    const custRows = await fetchRows<{ debt: number }>("customers", {
      eq: { id: data.customer_id },
      select: "debt",
      limit: 1,
    });
    const currentDebt = custRows[0]?.debt ?? 0;
    const newDebt = currentDebt - amount;   // Không clamp về 0 — âm = thanh toán thừa
    await updateWhere("customers", { debt: newDebt }, { id: data.customer_id });

    await logActivity({ action: "collect_payment", detail: `Thu ${amount.toLocaleString("vi-VN")} ₫ từ khách (${code})`, employee_id: data.employee_id || null });

    return { ok: true, code, new_debt: newDebt };
  });
