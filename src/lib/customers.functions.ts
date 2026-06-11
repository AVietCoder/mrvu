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

// ✅ Kiểm tra actor có phải admin không (gác sửa công nợ phía server)
async function isActorAdmin(actorId?: string | null): Promise<boolean> {
  if (!actorId) return false;
  const rows = await fetchRows<{ is_admin: number }>("users", {
    eq: { id: actorId },
    select: "is_admin",
    limit: 1,
  });
  return Number(rows[0]?.is_admin) === 1;
}

interface ListCustomersArgs {
  page?: number;
  pageSize?: number;
  search?: string;
  group?: string;
  debtFilter?: string;
  sortBy?: string;
}

/**
 * listCustomers — OPTIMIZED
 *
 * Cũ: SELECT * + fetchAllRows("orders") + fetchAllRows("cash_vouchers")
 *     → mỗi lần mở trang phải tải TOÀN BỘ orders + vouchers về client
 *       để tính lại công nợ. Với 10k đơn + 10k phiếu → vài MB payload,
 *       3–10s lag. Đồng thời mọi sort/filter công nợ phải làm ở client.
 *
 * Mới: gọi RPC `search_customers_page` (xem migration SQL kèm theo).
 *      - Tìm kiếm server-side trên name / phone / email (mở rộng từ name+phone).
 *      - Sort / filter công nợ / total_buy thực hiện ở Postgres → đúng và nhanh.
 *      - Trả về CHỈ các cột cần hiển thị (id, name, phone, email, địa chỉ,
 *        group_name, customer_type, company_name, debt, debt_adjustment,
 *        total_buy, total_paid, total_paid_back, computed_debt, display_debt).
 *      - Mỗi page payload ~ pageSize dòng, không phải toàn bộ DB.
 *
 * Số liệu thống kê (tổng KH / tổng nợ / số người nợ / tổng bán) tách ra
 * `getCustomerStats()` — query 1 lần, cache riêng.
 * Logic nghiệp vụ (cách tính displayDebt) giữ NGUYÊN: total_buy - total_paid
 *  + total_paid_back + debt_adjustment.
 */
export const listCustomers = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: ListCustomersArgs | undefined }) => {
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.max(1, data?.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    const { data: rows, error } = await supabase.rpc("search_customers_page", {
      p_search: data?.search ?? null,
      p_group: data?.group || null,
      p_debt_filter: data?.debtFilter || "all",
      p_sort: data?.sortBy || "date",
      p_limit: pageSize,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);

    const customers = (rows ?? []) as any[];
    const totalFiltered = customers[0]?.filtered_count
      ? Number(customers[0].filtered_count)
      : 0;

    return {
      customers,
      meta: { totalFiltered },
    };
  });

/**
 * getCustomerStats — số liệu tổng cho 4 thẻ thống kê ở đầu trang.
 * Cache riêng (staleTime dài) để không phải tính lại sau mỗi lần đổi page/search.
 */
export const getCustomerStats = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data, error } = await supabase.rpc("customer_stats");
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) ?? {};
    return {
      totalAllCustomers: Number(row.total_all_customers ?? 0),
      totalAllDebt: Number(row.total_all_debt ?? 0),
      totalDebtorCount: Number(row.total_debtor_count ?? 0),
      totalSales: Number(row.total_sales ?? 0),
    };
  });

/**
 * exportCustomerDebts — lấy TOÀN BỘ khách hàng khớp bộ lọc hiện tại (không phân
 * trang) để xuất file Excel công nợ. Dùng lại RPC `search_customers_page` với
 * limit lớn nên công thức công nợ GIỮ NGUYÊN, đồng nhất với bảng đang hiển thị:
 *   display_debt = total_buy - total_paid + total_paid_back + debt_adjustment
 */
export const exportCustomerDebts = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: ListCustomersArgs | undefined }) => {
    const { data: rows, error } = await supabase.rpc("search_customers_page", {
      p_search: data?.search ?? null,
      p_group: data?.group || null,
      p_debt_filter: data?.debtFilter || "all",
      p_sort: data?.sortBy || "debt_desc",
      p_limit: 100000, // lấy hết, không phân trang
      p_offset: 0,
    });
    if (error) throw new Error(error.message);
    return { customers: (rows ?? []) as any[] };
  });

export const upsertCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    // ✅ Chỉ admin mới được chỉnh sửa công nợ / điều chỉnh công nợ
    const actorAdmin = await isActorAdmin(data._actor_id);

    const payload: Record<string, any> = {
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
    };

    // Chỉ ghi debt / debt_adjustment khi actor là admin.
    if (actorAdmin) {
      payload.debt = Number(data.debt) || 0; // cho phép âm
      payload.debt_adjustment = Number(data.debt_adjustment) || 0;
    }

    if (data.id) {
      await updateWhere("customers", payload, { id: data.id });
      await logActivity({ action: "update_customer", detail: `Cập nhật khách hàng: ${data.name}`, employee_id: data._actor_id ?? null });
    } else {
      await insertRow("customers", {
        id: uid(),
        ...payload,
        // Khách mới: nếu không phải admin thì công nợ khởi tạo = 0
        debt: actorAdmin ? (Number(data.debt) || 0) : 0,
        debt_adjustment: actorAdmin ? (Number(data.debt_adjustment) || 0) : 0,
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
    await deleteWhere("cash_vouchers", { payer_customer_id: data.id });
    await deleteWhere("cash_vouchers", { receiver_customer_id: data.id });
    
    await deleteWhere("orders", { customer_id: data.id });
    await deleteWhere("schedules", { customer_id: data.id });
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

// ─── payCustomerDebt — Chi trả tiền cho khách (đối xứng với collectCustomerPayment) ─────
export const payCustomerDebt = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { customer_id: string; amount: number; branch_id: string; employee_id?: string; note?: string; fund_type?: string } }) => {
    const amount = Number(data.amount || 0);
    if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0");

    // Sinh mã PC duy nhất
    let code: string = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const { count } = await supabase
        .from("cash_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("type", "chi");
      const candidate = "PC" + String((count ?? 0) + 1 + attempt).padStart(6, "0");
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
      code = "PC" + ts + rand;
    }
    const fundType = data.fund_type === "ngan_hang" ? "ngan_hang" : "tien_mat";

    await insertRow("cash_vouchers", {
      id: uid(),
      code,
      type: "chi",
      fund_type: fundType,
      branch_id: data.branch_id,
      amount,
      voucher_type_id: null,
      collector_user_id: null,
      payer_customer_id: null,
      payer_user_id: data.employee_id || null,
      receiver_customer_id: data.customer_id,
      note: data.note || `Chi trả công nợ cho khách`,
      accounting: true,
      status: "active",
      created_by: data.employee_id || null,
      created_at: now(),
    });

    const newDebt = await recalculateCustomerDebt(data.customer_id);

    await logActivity({ action: "pay_customer_debt", detail: `Chi trả ${amount.toLocaleString("vi-VN")} ₫ cho khách (${code})`, employee_id: data.employee_id || null });

    return { ok: true, code, new_debt: newDebt };
  });
// Tra cứu khách hàng GỌN (cho ô chọn khách kiểu async: chỉ cần nhãn).
export const getCustomerLite = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: { id: string } }) => {
    if (!data?.id) return null;
    const rows = await fetchRows("customers", {
      eq: { id: data.id },
      select: "id, name, phone, address, ward, district, province",
      limit: 1,
    });
    return (rows?.[0] as any) ?? null;
  });

export const getCustomerById = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: { id: string } }) => {
    const customer = await fetchRows("customers", {
      eq: { id: data.id },
      limit: 1,
    });

    const ordersRaw = await fetchRows("orders", {
      eq: { customer_id: data.id },
      select: "id, code, status, total, created_at, completed_at",
      orderBy: "created_at",
      ascending: false,
    });

    // Sort: completed dùng completed_at, còn lại dùng created_at — giảm dần
    const orders = [...ordersRaw].sort((a: any, b: any) => {
      const dateA = a.status === "completed" ? (a.completed_at ?? a.created_at) : a.created_at;
      const dateB = b.status === "completed" ? (b.completed_at ?? b.created_at) : b.created_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    const branches = await fetchRows("branches", { orderBy: "name" });

    // Lịch sử thu tiền (phiếu thu trong cash_vouchers liên quan đến khách hàng này)
    const { data: paymentHistory } = await supabase
      .from("cash_vouchers")
      .select("id, code, amount, fund_type, note, created_at, collector_user_id, status, type")
      .eq("payer_customer_id", data.id)
      .eq("type", "thu")
      .order("created_at", { ascending: false });

    // Lịch sử chi trả (phiếu chi trả lại tiền cho khách)
    const { data: payBackHistory } = await supabase
      .from("cash_vouchers")
      .select("id, code, amount, fund_type, note, created_at, payer_user_id, status, type")
      .eq("receiver_customer_id", data.id)
      .eq("type", "chi")
      .order("created_at", { ascending: false });

    // Lấy thông tin users để hiện tên người thu
    const users = await fetchRows("users", { select: "id, full_name", orderBy: "full_name" });

    return {
      customer: customer[0] ?? null,
      orders,
      branches,
      paymentHistory: (paymentHistory ?? []).filter((p: any) => p.status !== "cancelled"),
      allPaymentHistory: paymentHistory ?? [],
      payBackHistory: (payBackHistory ?? []).filter((p: any) => p.status !== "cancelled"),
      users,
    };
  });

export async function recalculateCustomerDebt(customerId: string): Promise<number> {
  const [
    completedOrdersRows,
    returnedOrdersRows,
    allReceiptsRows,
    allPayBacksRows,
    customerRows,
  ] = await Promise.all([
    fetchRows<{ total: number }>("orders", {
      eq: { customer_id: customerId, status: "completed" },
      select: "total",
    }),
    // ✅ Đơn TRẢ HÀNG (status "returned") làm GIẢM giá trị hàng khách giữ lại,
    //    nên phải TRỪ khỏi tổng mua khi tính công nợ. Trước đây bị bỏ sót →
    //    công nợ bị tính DƯ đúng bằng giá trị hàng đã trả (cộng thêm phiếu chi
    //    hoàn tiền lại càng sai). Đây là gốc rễ lỗi "tính công nợ trả hàng".
    fetchRows<{ total: number }>("orders", {
      eq: { customer_id: customerId, status: "returned" },
      select: "total",
    }),
    supabase
      .from("cash_vouchers")
      .select("amount")
      .eq("payer_customer_id", customerId)
      .eq("type", "thu")
      .neq("status", "cancelled"),
    supabase
      .from("cash_vouchers")
      .select("amount")
      .eq("receiver_customer_id", customerId)
      .eq("type", "chi")
      .neq("status", "cancelled"),
    fetchRows<{ debt_adjustment: number }>("customers", {
      eq: { id: customerId },
      select: "debt_adjustment",
      limit: 1,
    }),
  ]);

  const totalSpent = completedOrdersRows.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalReturned = returnedOrdersRows.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalPaid = (allReceiptsRows.data ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const totalPaidBack = (allPayBacksRows.data ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  // ✅ Giữ phần điều chỉnh thủ công của admin khi tính lại
  const adjustment = Number(customerRows[0]?.debt_adjustment) || 0;
  // Công nợ = (hàng đã mua − hàng đã trả) − đã thu + đã chi trả lại + điều chỉnh
  const newDebt = totalSpent - totalReturned - totalPaid + totalPaidBack + adjustment;

  await updateWhere("customers", { debt: newDebt }, { id: customerId });
  return newDebt;
}

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

    const newDebt = await recalculateCustomerDebt(data.customer_id);

    await logActivity({ action: "collect_payment", detail: `Thu ${amount.toLocaleString("vi-VN")} ₫ từ khách (${code})`, employee_id: data.employee_id || null });

    return { ok: true, code, new_debt: newDebt };
  });