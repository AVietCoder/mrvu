import { createServerFn } from "@tanstack/react-start";
import { supabase } from "./supabase";
import { fetchRows, insertRow, updateWhere, deleteWhere, uid, now } from "./supabase";

// ─── Types ────────────────────────────────────────────────────────────────────
export type CashVoucherType = "thu" | "chi";
export type CashFundType = "tien_mat" | "ngan_hang";
export type CashVoucherStatus = "active" | "cancelled";

// ─── listCash ────────────────────────────────────────────────────────────────
export const listCash = createServerFn({ method: "GET" }).handler(async () => {
  const [vouchers, branches, users, voucherTypes] = await Promise.all([
    fetchRows("cash_vouchers", { orderBy: "created_at", ascending: false }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
    fetchRows("cash_voucher_types", { orderBy: "name" }),
  ]);

  return { vouchers, branches, users, voucherTypes };
});

// ─── createCashVoucher ────────────────────────────────────────────────────────
export const createCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    // Generate code: PT000001 or PC000001
    const prefix = data.type === "thu" ? "PT" : "PC";
    const { count } = await supabase
      .from("cash_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("type", data.type);
    const code = prefix + String((count ?? 0) + 1).padStart(6, "0");

    const id = uid();
    await insertRow("cash_vouchers", {
      id,
      code,
      type: data.type,                     // 'thu' | 'chi'
      fund_type: data.fund_type,           // 'tien_mat' | 'ngan_hang'
      branch_id: data.branch_id,
      amount: Number(data.amount),
      voucher_type_id: data.voucher_type_id || null,
      payer_receiver: data.payer_receiver || null,
      note: data.note || null,
      accounting: data.accounting ?? true,
      status: "active",
      created_by: data.created_by || null,
      created_at: now(),
    });

    return { ok: true, code };
  },
);

// ─── updateCashVoucher ────────────────────────────────────────────────────────
export const updateCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    await updateWhere(
      "cash_vouchers",
      {
        amount: Number(data.amount),
        voucher_type_id: data.voucher_type_id || null,
        payer_receiver: data.payer_receiver || null,
        note: data.note || null,
        accounting: data.accounting ?? true,
      },
      { id: data.id },
    );
    return { ok: true };
  },
);

// ─── cancelCashVoucher ────────────────────────────────────────────────────────
export const cancelCashVoucher = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    await updateWhere("cash_vouchers", { status: "cancelled" }, { id: data.id });
    return { ok: true };
  },
);

// ─── upsertCashVoucherType ────────────────────────────────────────────────────
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

// ─── deleteCashVoucherType ────────────────────────────────────────────────────
export const deleteCashVoucherType = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }) => {
    await deleteWhere("cash_voucher_types", { id: data.id });
    return { ok: true };
  },
);
