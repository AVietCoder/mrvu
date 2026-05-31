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
import { recalculateCustomerDebt } from "./customers.functions";

function extractRelatedCustomerIds(v: any): string[] {
  return Array.from(
    new Set(
      [
        v?.payer_customer_id,
        v?.receiver_customer_id,
        // Bên A / Bên B nếu là khách hàng
        v?.from_kind === "customer" ? v?.from_id : null,
        v?.to_kind === "customer" ? v?.to_id : null,
      ]
        .filter(Boolean)
        .map(String),
    ),
  );
}

// Từ mô hình A → B, suy ra các cột cũ để giữ tương thích (công nợ khách,
// chi nhánh, tìm kiếm theo nhân viên ở phiếu cũ).
function legacyFieldsFromAB(data: any) {
  const sides = [
    { kind: data.from_kind, id: data.from_id },
    { kind: data.to_kind, id: data.to_id },
  ];
  const firstOf = (k: string) => sides.find((s) => s.kind === k && s.id)?.id || null;

  const customerId = firstOf("customer");
  const userId = firstOf("user");
  const branchId = firstOf("branch");
  const isThu = data.type === "thu";

  return {
    branch_id: branchId || data.branch_id || null,
    payer_customer_id: isThu ? customerId : null,
    receiver_customer_id: isThu ? null : customerId,
    collector_user_id: isThu ? userId : null,
    payer_user_id: isThu ? null : userId,
  };
}

// ─── listCash — trả về toàn bộ dữ liệu cần thiết cho trang Sổ quỹ ──────────
export const listCash = createServerFn({ method: "GET" }).handler(async () => {
  // ❗ cash_vouchers, customers có thể vượt 1000 dòng → dùng fetchAllRows.
  const [vouchers, branches, users, customers, voucherTypes] = await Promise.all([
    fetchAllRows("cash_vouchers", { orderBy: "created_at", ascending: false }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name, is_admin", orderBy: "full_name" }),
    fetchAllRows("customers", { select: "id, name, phone", orderBy: "created_at", ascending: false }),
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

    const legacy = legacyFieldsFromAB(data);

    await insertRow("cash_vouchers", {
      id: uid(),
      code,
      type: data.type, // 'thu' | 'chi'
      fund_type: data.fund_type, // 'tien_mat' | 'ngan_hang'
      branch_id: legacy.branch_id,
      amount: Number(data.amount),
      voucher_type_id: data.voucher_type_id || null,
      // ── Mô hình A → B ──
      from_kind: data.from_kind || null,
      from_id:   data.from_kind && data.from_kind !== "other" ? (data.from_id || null) : null,
      from_name: data.from_kind === "other" ? (data.from_name || null) : null,
      to_kind:   data.to_kind || null,
      to_id:     data.to_kind && data.to_kind !== "other" ? (data.to_id || null) : null,
      to_name:   data.to_kind === "other" ? (data.to_name || null) : null,
      // ── Cột cũ (tương thích công nợ / phiếu cũ) ──
      collector_user_id: legacy.collector_user_id,
      payer_customer_id: legacy.payer_customer_id,
      payer_user_id: legacy.payer_user_id,
      receiver_customer_id: legacy.receiver_customer_id,
      note: data.note || null,
      // Field accounting vẫn giữ để tương thích DB; UI không còn cho nhập.
      accounting: data.accounting ?? true,
      status: "active",
      created_by: data.created_by || null,
      // ✨ Cho phép chọn thời gian tạo phiếu từ UI, mặc định lấy now().
      created_at: data.created_at || now(),
    });

    for (const customerId of extractRelatedCustomerIds(data)) {
      await recalculateCustomerDebt(customerId);
    }

    return { ok: true, code };
  },
);

// ─── updateCashVoucher ───────────────────────────────────────────────────────
export const updateCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    const { data: existingVoucher } = await supabase
      .from("cash_vouchers")
      .select("payer_customer_id, receiver_customer_id, from_kind, from_id, to_kind, to_id")
      .eq("id", data.id)
      .maybeSingle();

    const legacy = legacyFieldsFromAB(data);

    const updatePayload: Record<string, any> = {
      amount: Number(data.amount),
      fund_type: data.fund_type,        // ✅ FIX: cập nhật loại quỹ (tiền mặt / ngân hàng)
      branch_id: legacy.branch_id,      // ✅ chi nhánh suy từ A/B
      voucher_type_id: data.voucher_type_id || null,
      // ── Mô hình A → B ──
      from_kind: data.from_kind || null,
      from_id:   data.from_kind && data.from_kind !== "other" ? (data.from_id || null) : null,
      from_name: data.from_kind === "other" ? (data.from_name || null) : null,
      to_kind:   data.to_kind || null,
      to_id:     data.to_kind && data.to_kind !== "other" ? (data.to_id || null) : null,
      to_name:   data.to_kind === "other" ? (data.to_name || null) : null,
      // ── Cột cũ ──
      collector_user_id: legacy.collector_user_id,
      payer_customer_id: legacy.payer_customer_id,
      payer_user_id: legacy.payer_user_id,
      receiver_customer_id: legacy.receiver_customer_id,
      note: data.note || null,
      accounting: data.accounting ?? true,
      created_at: data.created_at || now(),  // ✅ Cập nhật thời gian khi edit
    };
    await updateWhere("cash_vouchers", updatePayload, { id: data.id });

    const affectedCustomerIds = new Set<string>([
      ...(extractRelatedCustomerIds(existingVoucher) ?? []),
      ...extractRelatedCustomerIds({ ...updatePayload, type: data.type }),
    ]);
    for (const customerId of affectedCustomerIds) {
      await recalculateCustomerDebt(customerId);
    }

    return { ok: true };
  },
);

// ─── cancelCashVoucher ───────────────────────────────────────────────────────
export const cancelCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    const { data: voucher } = await supabase
      .from("cash_vouchers")
      .select("id, type, payer_customer_id, receiver_customer_id, from_kind, from_id, to_kind, to_id, status")
      .eq("id", data.id)
      .maybeSingle();

    await updateWhere("cash_vouchers", { status: "cancelled" }, { id: data.id });

    for (const customerId of extractRelatedCustomerIds(voucher)) {
      await recalculateCustomerDebt(customerId);
    }

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
