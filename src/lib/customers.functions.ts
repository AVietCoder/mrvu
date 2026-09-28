// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { normalizePhoneForStorage } from "./zalo/phone";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { CUSTOMER_SOURCES } from "./types";
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

    // RPC chỉ trả các cột để HIỂN THỊ danh sách (không có giới tính, ngày sinh,
    // CCCD, hộ chiếu, MST, ngân hàng, ghi chú, nguồn khách…). Form "Sửa" và hộp
    // xem chi tiết dùng chính dòng này → trước đây bấm Lưu là XOÁ các cột đó.
    // Nạp đủ cột cho đúng ~pageSize khách của trang rồi ghép vào (số tính toán
    // của RPC như công nợ giữ nguyên, không bị ghi đè).
    const customers = (rows ?? []) as any[];
    if (customers.length) {
      const { data: full } = await supabase
        .from("customers")
        .select("*")
        .in("id", customers.map((c) => c.id));
      const byId = new Map(((full ?? []) as any[]).map((c) => [c.id, c]));
      for (let i = 0; i < customers.length; i++) {
        const f = byId.get(customers[i].id);
        if (f) customers[i] = { ...f, ...customers[i] };
      }
    }
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

    // Nhóm khách BẮT BUỘC khi tạo mới. Trước đây thiếu nhóm thì DB ngầm gán
    // "Khách lẻ" (default của cột) — không ai chọn mà vẫn lưu được, nên gần
    // như toàn bộ khách đều rơi vào "lẻ". Khi sửa khách thì không gửi nhóm
    // lên = giữ nguyên nhóm cũ.
    const groupCode = String(data.group_name ?? "").trim();
    if (!data.id && !groupCode) {
      throw new Error("Vui lòng chọn nhóm khách hàng");
    }
    if (data.id && data.group_name !== undefined && !groupCode) {
      throw new Error("Vui lòng chọn nhóm khách hàng");
    }

    // Nguồn khách "Biết Mr.Vũ qua đâu?" (v20): BẮT BUỘC khi tạo mới. Khi sửa
    // chỉ ghi nếu client gửi lên — khách cũ chưa có nguồn vẫn lưu được.
    // Rỗng = không đổi (form sửa từ danh sách có thể không nạp nguồn cũ) — không bao giờ xoá nguồn đã có.
    const source = String(data.source ?? "").trim() || undefined;
    const sourceNote = String(data.source_note ?? "").trim();
    if (!data.id && !source) throw new Error("Vui lòng chọn \"Biết Mr.Vũ qua đâu?\"");
    if (source && !CUSTOMER_SOURCES.some((x) => x.key === source)) throw new Error("Nguồn khách không hợp lệ");
    if (source === "khac" && !sourceNote) throw new Error("Chọn \"Khác\" thì nhập cụ thể biết Mr.Vũ qua đâu");
    // Ghi RIÊNG sau khi lưu khách (cùng mẫu birthday): thiếu cột thì báo rõ cần
    // chạy migration, không làm hỏng việc tạo khách.
    const saveSource = async (id: string) => {
      if (source === undefined) return;
      const { error } = await supabase
        .from("customers")
        .update({ source: source || null, source_note: source === "khac" ? sourceNote : null })
        .eq("id", id);
      // KHÔNG ném lỗi: khách đã được lưu rồi — báo lỗi lúc này khiến nhân viên
      // bấm tạo lại và sinh khách trùng. Chỉ ghi log (thường là chưa chạy v20).
      if (error) console.warn(`[customers] Chưa lưu được nguồn khách (cần sql_migration_v20_customer_source.sql?): ${error.message}`);
    };

    const payload: Record<string, any> = {
      name: data.name,
      // Nhân viên gõ "0906 249 669" vẫn được, nhưng lưu xuống thì bỏ dấu cách.
      // Chuẩn hoá Ở SERVER để mọi lối vào đều đi qua đây: trang khách hàng,
      // nút "Tạo mới" nhanh trong form đơn, và cả import nếu sau này có.
      phone: normalizePhoneForStorage(data.phone),
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
      await saveSource(data.id);
      await logActivity({ action: "update_customer", detail: `Cập nhật khách hàng: ${data.name}`, employee_id: data._actor_id ?? null });
    } else {
      const newId = uid();
      await insertRow("customers", {
        id: newId,
        ...payload,
        // Khách mới: nếu không phải admin thì công nợ khởi tạo = 0
        debt: actorAdmin ? (Number(data.debt) || 0) : 0,
        debt_adjustment: actorAdmin ? (Number(data.debt_adjustment) || 0) : 0,
        created_by: data._actor_id || null,
        created_by_name: data.created_by_name || null,
        created_at: now(),
      });
      await saveSource(newId);
      await logActivity({ action: "create_customer", detail: `Thêm khách hàng mới: ${data.name}`, employee_id: data._actor_id ?? null });
    }
    return { ok: true };
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("cash_vouchers", { payer_customer_id: data.id });
    await deleteWhere("cash_vouchers", { receiver_customer_id: data.id });

    // Xóa order_items của các đơn thuộc khách TRƯỚC khi xóa orders.
    // Nếu không, ràng buộc khóa ngoại order_items.order_id → orders.id sẽ chặn
    // việc xóa (lỗi với mọi khách đã từng có đơn) và để lại order_items mồ côi.
    const custOrders = await fetchRows<{ id: string }>("orders", {
      eq: { customer_id: data.id },
      select: "id",
    });
    for (const o of custOrders) {
      await deleteWhere("order_items", { order_id: o.id });
    }

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
/**
 * findDuplicateCustomers — cảnh báo "khách này đã có rồi" khi đang nhập KH mới.
 *
 * Hai tiêu chí (theo yêu cầu nghiệp vụ):
 *   1. Trùng SỐ ĐIỆN THOẠI — so theo phần chữ số, bỏ qua khoảng trắng/dấu chấm
 *      người dùng gõ ("0912 345 678" và "0912345678" coi như một).
 *   2. Trùng TÊN — so khớp chính xác nhưng bỏ qua hoa/thường (ilike không
 *      wildcard), tránh việc gõ "Anh Tuấn" lại tạo thêm bản ghi thứ 2.
 *
 * Chỉ CẢNH BÁO, không chặn: hàm này không được gọi trong upsertCustomer.
 * `excludeId` để lúc SỬA khách không tự báo trùng với chính nó.
 */
export const findDuplicateCustomers = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: { name?: string; phone?: string; excludeId?: string } | undefined }) => {
    const name = (data?.name ?? "").trim();
    const phoneDigits = (data?.phone ?? "").replace(/\D/g, "");
    const excludeId = data?.excludeId || null;

    const SELECT =
      "id, name, phone, address, ward, district, province, group_name, customer_type, company_name, debt, total_buy, created_at";

    const byPhoneQuery =
      phoneDigits.length >= 8
        ? supabase.from("customers").select(SELECT).ilike("phone", `%${phoneDigits}%`).limit(5)
        : Promise.resolve({ data: [] as any[] });

    const byNameQuery =
      name.length >= 2
        ? supabase.from("customers").select(SELECT).ilike("name", name).limit(5)
        : Promise.resolve({ data: [] as any[] });

    const [byPhone, byName] = await Promise.all([byPhoneQuery, byNameQuery]);

    const merged = new Map<string, any>();
    for (const row of (byPhone as any)?.data ?? []) {
      if (row.id === excludeId) continue;
      merged.set(row.id, { ...row, match_phone: true, match_name: false });
    }
    for (const row of (byName as any)?.data ?? []) {
      if (row.id === excludeId) continue;
      const existing = merged.get(row.id);
      if (existing) existing.match_name = true;
      else merged.set(row.id, { ...row, match_phone: false, match_name: true });
    }

    // Trùng cả SĐT lẫn tên → gần như chắc chắn là cùng một người → xếp lên đầu.
    const matches = [...merged.values()].sort(
      (a, b) =>
        Number(b.match_phone) + Number(b.match_name) - (Number(a.match_phone) + Number(a.match_name)),
    );

    return { matches };
  });

// Tra cứu khách hàng GỌN (cho ô chọn khách kiểu async: chỉ cần nhãn).
export const getCustomerLite = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data: { id: string } }) => {
    if (!data?.id) return null;
    const rows = await fetchRows("customers", {
      eq: { id: data.id },
      // zalo_opt_out_at: form tạo đơn cần biết khách có từ chối nhận tin không
      // để khoá sẵn ô "Gửi thông báo Zalo", thay vì để nhân viên tick rồi tin
      // bị chặn im lặng ở tầng dưới.
      select: "id, name, phone, address, ward, district, province, zalo_opt_out_at",
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
    }).catch(() => [] as { debt_adjustment: number }[]),
    // ↑ An toàn: nếu DB chưa có cột debt_adjustment thì coi điều chỉnh = 0,
    //   KHÔNG để recalc văng lỗi (tránh kéo theo phiếu trả hàng thất bại).
  ]);

  const totalSpent = completedOrdersRows.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalReturned = returnedOrdersRows.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalPaid = (allReceiptsRows.data ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const totalPaidBack = (allPayBacksRows.data ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  // ✅ Giữ phần điều chỉnh thủ công của admin khi tính lại
  const adjustment = Number(customerRows[0]?.debt_adjustment) || 0;
  // ─── CÔNG THỨC CÔNG NỢ (nguồn sự thật duy nhất) ──────────────────────────
  //   debt = (hàng đã mua − hàng đã trả) − đã thu + đã chi trả lại + điều chỉnh
  //
  //   Riêng nghiệp vụ TRẢ HÀNG, vì nó thêm 1 đơn "returned" (total = giá trị
  //   hàng trả = "Khách cần nhận lại" = T) và 1 phiếu chi (= "Đã trả lại
  //   khách" = R), nên hàm này đảm bảo:
  //       debt_sau = debt_trước − T + R
  //   ⇒ đúng bằng công thức: công nợ − tiền phải trả khách + tiền khách đã trả.
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

// ═══════════════════════════════════════════════════════════════════════════
// NHÓM KHÁCH HÀNG (bảng customer_groups — migration v12)
//
// customers.group_name lưu MÃ nhóm (code). Mã là bất biến; tên và màu sửa
// được. Đọc thì ai cũng đọc được; thêm/sửa/xoá chỉ admin, ghi qua service
// role vì bảng bật RLS chỉ cho phép đọc bằng anon key.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 4 nhóm cũ vốn hardcode trong code. Dùng làm phương án dự phòng khi DB chưa
 * chạy migration v12 — trang khách hàng vẫn chạy bình thường như trước.
 */
const FALLBACK_GROUPS = [
  { code: "le", name: "Khách lẻ", color: "gray", sort_order: 1, is_active: true },
  { code: "dai_ly", name: "Đại lý", color: "blue", sort_order: 2, is_active: true },
  { code: "vip", name: "VIP", color: "amber", sort_order: 3, is_active: true },
  { code: "cong_trinh", name: "Công trình", color: "purple", sort_order: 4, is_active: true },
];

const GROUP_COLORS = ["gray", "blue", "amber", "purple", "green", "red", "pink", "teal"];

/** "Khách Sỉ Miền Nam" → "khach_si_mien_nam". Mã nhóm lưu trong customers. */
function slugifyGroupCode(name: string): string {
  return (
    String(name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "nhom"
  );
}

export const listCustomerGroups = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { withCounts?: boolean } }) => {
    const { data: rows, error } = await supabase
      .from("customer_groups")
      .select("code, name, color, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    // Chưa chạy migration v12 → trả 4 nhóm cũ, không làm vỡ trang.
    if (error) {
      return { groups: FALLBACK_GROUPS.map((g) => ({ ...g, customer_count: null })), fallback: true };
    }

    const groups = (rows ?? []) as any[];

    // Đếm số khách mỗi nhóm — chỉ khi màn quản lý cần (để biết nhóm nào xoá được).
    if (data?.withCounts) {
      await Promise.all(
        groups.map(async (g) => {
          g.customer_count = await countRows("customers", { eq: { group_name: g.code } }).catch(() => null);
        }),
      );
    }

    return { groups, fallback: false };
  },
);

async function assertAdmin(actorId?: string) {
  if (!(await isActorAdmin(actorId))) {
    throw new Error("Chỉ quản trị viên mới được quản lý nhóm khách hàng");
  }
}

export const upsertCustomerGroup = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: {
      code?: string; // có = sửa, không có = thêm mới
      name: string;
      color?: string;
      sort_order?: number;
      is_active?: boolean;
      actorId?: string;
    };
  }) => {
    await assertAdmin(data?.actorId);

    const name = String(data?.name ?? "").trim();
    if (!name) throw new Error("Nhập tên nhóm");
    if (name.length > 50) throw new Error("Tên nhóm tối đa 50 ký tự");

    const color = GROUP_COLORS.includes(String(data.color)) ? String(data.color) : "gray";
    const db = getSupabaseAdmin();

    // Trùng tên (không phân biệt hoa thường) → dễ gây nhầm lẫn khi chọn.
    const { data: same } = await db.from("customer_groups").select("code, name").ilike("name", name);
    if ((same ?? []).some((g: any) => g.code !== data.code)) {
      throw new Error(`Đã có nhóm tên "${name}"`);
    }

    if (data.code) {
      // Sửa: KHÔNG đổi mã — mã đang được lưu trong hàng nghìn khách.
      const { error } = await db
        .from("customer_groups")
        .update({
          name,
          color,
          sort_order: Number(data.sort_order ?? 0),
          is_active: data.is_active !== false,
        })
        .eq("code", data.code);
      if (error) throw new Error(error.message);
      await logActivity({ action: "update_customer_group", detail: `Sửa nhóm khách: ${name}`, employee_id: data.actorId ?? null });
      return { code: data.code };
    }

    // Thêm mới: sinh mã từ tên, thêm hậu tố nếu trùng mã đã có.
    const base = slugifyGroupCode(name);
    let code = base;
    for (let i = 2; i < 100; i++) {
      const { data: hit } = await db.from("customer_groups").select("code").eq("code", code).limit(1);
      if (!hit?.length) break;
      code = `${base}_${i}`;
    }

    const { data: maxRow } = await db
      .from("customer_groups")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);

    const { error } = await db.from("customer_groups").insert({
      code,
      name,
      color,
      sort_order: data.sort_order ?? Number(maxRow?.[0]?.sort_order ?? 0) + 1,
      is_active: data.is_active !== false,
      created_at: now(),
    });
    if (error) throw new Error(error.message);
    await logActivity({ action: "create_customer_group", detail: `Thêm nhóm khách: ${name}`, employee_id: data.actorId ?? null });
    return { code };
  },
);

export const deleteCustomerGroup = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { code: string; actorId?: string } }) => {
    await assertAdmin(data?.actorId);
    if (!data?.code) throw new Error("Thiếu mã nhóm");

    // "le" là giá trị mặc định của cột customers.group_name trong DB — xoá đi
    // thì mọi chỗ tạo khách không truyền nhóm sẽ lỗi khoá ngoại.
    if (data.code === "le") throw new Error('Không thể xoá nhóm mặc định "Khách lẻ"');

    const used = await countRows("customers", { eq: { group_name: data.code } });
    if (used > 0) {
      throw new Error(
        `Nhóm đang có ${used} khách. Chuyển các khách này sang nhóm khác, hoặc TẮT nhóm để ẩn khỏi ô chọn.`,
      );
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("customer_groups").delete().eq("code", data.code);
    if (error) throw new Error(error.message);
    await logActivity({ action: "delete_customer_group", detail: `Xoá nhóm khách: ${data.code}`, employee_id: data.actorId ?? null });
    return { ok: true };
  },
);
