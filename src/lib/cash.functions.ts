// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import {
  supabase,
  fetchRows,
  fetchAllRows,
  insertRow,
  updateWhere,
  deleteWhere,
  uid,
  now,
} from "./supabase";

// ─── listCash — trả về toàn bộ dữ liệu cần thiết cho trang Sổ quỹ ──────────
export const listCash = createServerFn({ method: "GET" }).handler(async () => {
  // ❗ cash_vouchers, customers có thể vượt 1000 dòng → dùng fetchAllRows.
  const [vouchers, branches, users, customers, voucherTypes] = await Promise.all([
    fetchAllRows("cash_vouchers", { orderBy: "created_at", ascending: false }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name, is_admin", orderBy: "full_name" }),
    fetchAllRows("customers", { select: "id, name, phone", orderBy: "name" }),
    fetchRows("cash_voucher_types", { orderBy: "name" }),
  ]);
  return { vouchers, branches, users, customers, voucherTypes };
});

// ─── createCashVoucher ───────────────────────────────────────────────────────
export const createCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    const prefix = data.type === "thu" ? "PT" : "PC";
    // Retry loop to avoid duplicate key race condition
    let code: string = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const { count } = await supabase
        .from("cash_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("type", data.type);
      const candidate = prefix + String((count ?? 0) + 1 + attempt).padStart(6, "0");
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
      code = prefix + ts + rand;
    }

    await insertRow("cash_vouchers", {
      id: uid(),
      code,
      type: data.type, // 'thu' | 'chi'
      fund_type: data.fund_type, // 'tien_mat' | 'ngan_hang'
      branch_id: data.branch_id,
      amount: Number(data.amount),
      voucher_type_id: data.voucher_type_id || null,
      collector_user_id: data.collector_user_id || null,
      payer_customer_id: data.payer_customer_id || null,
      payer_user_id: data.payer_user_id || null,
      receiver_customer_id: data.receiver_customer_id || null,
      note: data.note || null,
      // Field accounting vẫn giữ để tương thích DB; UI không còn cho nhập.
      accounting: data.accounting ?? true,
      status: "active",
      created_by: data.created_by || null,
      // ✨ Cho phép chọn thời gian tạo phiếu từ UI, mặc định lấy now().
      created_at: data.created_at || now(),
    });
    return { ok: true, code };
  },
);

// ─── updateCashVoucher ───────────────────────────────────────────────────────
export const updateCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    const updatePayload: Record<string, any> = {
      amount: Number(data.amount),
      voucher_type_id: data.voucher_type_id || null,
      collector_user_id: data.collector_user_id || null,
      payer_customer_id: data.payer_customer_id || null,
      payer_user_id: data.payer_user_id || null,
      receiver_customer_id: data.receiver_customer_id || null,
      note: data.note || null,
      accounting: data.accounting ?? true,
    };
    if (data.created_at) {
      updatePayload.created_at = data.created_at;
    }
    await updateWhere("cash_vouchers", updatePayload, { id: data.id });
    return { ok: true };
  },
);

// ─── cancelCashVoucher ───────────────────────────────────────────────────────
export const cancelCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    await updateWhere("cash_vouchers", { status: "cancelled" }, { id: data.id });
    return { ok: true };
  },
);

// ─── upsertCashVoucherType ───────────────────────────────────────────────────
export const upsertCashVoucherType = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id?: string; name: string; kind: "thu" | "chi" } }) => {
    if (data.id) {
      await updateWhere("cash_voucher_types", { name: data.name, kind: data.kind }, { id: data.id });
    } else {
      await insertRow("cash_voucher_types", { id: uid(), name: data.name, kind: data.kind });
    }
    return { ok: true };
  },
);

// ─── deleteCashVoucherType ───────────────────────────────────────────────────
export const deleteCashVoucherType = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    await deleteWhere("cash_voucher_types", { id: data.id });
    return { ok: true };
  },
);
