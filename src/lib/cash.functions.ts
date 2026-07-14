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
// ─────────────────────────────────────────────────────────────────────────
// Sổ quỹ: TÍNH Ở SERVER để client chỉ nhận 1 trang + số liệu (thay vì tải TẤT
// CẢ phiếu). Logic lọc / số dư (branchDelta, bên A→B, quyền xem) ĐƯỢC SAO Y
// NGUYÊN từ trang cũ → số tiền không đổi.
// ─────────────────────────────────────────────────────────────────────────
export const searchCashPage = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: any }) => {
    const page = Math.max(1, data?.page ?? 1);
    const pageSize = Math.max(1, data?.pageSize ?? 20);
    const fund = data?.fund ?? "all";
    const filterBranch = data?.filterBranch ?? "";
    const filterType = data?.filterType ?? "";
    const filterVoucherType = data?.filterVoucherType ?? ""; // lọc theo DANH MỤC thu/chi (cash_voucher_types)
    const filterBank = data?.filterBank ?? "";
    const search = (data?.search ?? "").toLowerCase();
    const canViewAll = !!data?.canViewAll;
    const branchIds: string[] = data?.branchIds ?? [];
    // ✅ Lọc theo khoảng ngày (giờ VN). Áp dụng cho DANH SÁCH + Tổng thu/Tổng chi;
    //    riêng TỒN QUỸ luôn tính trên toàn bộ lịch sử (số dư thực của quỹ).
    const dateFromTs = data?.dateFrom
      ? new Date(`${data.dateFrom}T00:00:00+07:00`).getTime()
      : null;
    const dateToTs = data?.dateTo
      ? new Date(`${data.dateTo}T23:59:59.999+07:00`).getTime()
      : null;
    const inDateRange = (v: any) => {
      if (dateFromTs === null && dateToTs === null) return true;
      const t = new Date(v.created_at).getTime();
      if (dateFromTs !== null && t < dateFromTs) return false;
      if (dateToTs !== null && t > dateToTs) return false;
      return true;
    };

    const [vouchers, branches, users, customers] = await Promise.all([
      fetchAllRows("cash_vouchers", { orderBy: "created_at", ascending: false }),
      fetchRows("branches", { orderBy: "name" }),
      fetchRows("users", { select: "id, full_name", orderBy: "full_name" }),
      fetchAllRows("customers", { select: "id, name", orderBy: "created_at", ascending: false }),
    ]);

    const branchName = new Map((branches as any[]).map((b) => [b.id, b.name]));
    const userName = new Map((users as any[]).map((u) => [u.id, u.full_name]));
    const custName = new Map((customers as any[]).map((c) => [c.id, c.name]));
    const gBranch = (id: string) => branchName.get(id) ?? "";
    const gUser = (id: string) => userName.get(id) ?? "";
    const gCust = (id: string) => custName.get(id) ?? "";

    const sideLabel = (kind: string, id: string, name: string): string => {
      if (kind === "customer") return gCust(id) || "Khách hàng";
      if (kind === "user") return gUser(id) || "Nhân viên";
      if (kind === "branch") return gBranch(id) || "Chi nhánh";
      if (kind === "other") return name || "—";
      return "—";
    };
    const voucherSides = (v: any): { a: string; b: string } => {
      if (v.from_kind || v.to_kind) {
        return {
          a: sideLabel(v.from_kind, v.from_id, v.from_name),
          b: sideLabel(v.to_kind, v.to_id, v.to_name),
        };
      }
      const isThu = v.type === "thu";
      const a = v.branch_id
        ? gBranch(v.branch_id)
        : (isThu ? gUser(v.collector_user_id) : gUser(v.payer_user_id)) || "—";
      const b = (isThu ? gCust(v.payer_customer_id) : gCust(v.receiver_customer_id)) || "—";
      return { a, b };
    };
    const voucherBranchIds = (v: any): string[] => {
      if (!v.from_kind && !v.to_kind) return v.branch_id ? [v.branch_id] : [];
      const ids: string[] = [];
      if (v.from_kind === "branch" && v.from_id) ids.push(v.from_id);
      if (v.to_kind === "branch" && v.to_id) ids.push(v.to_id);
      return ids;
    };
    const branchDelta = (v: any, bId: string): number => {
      const amt = Number(v.amount) || 0;
      const isThu = v.type === "thu";
      if (!v.from_kind && !v.to_kind) {
        if (v.branch_id === bId) return isThu ? amt : -amt;
        return 0;
      }
      let d = 0;
      if (v.from_kind === "branch" && v.from_id === bId) d += isThu ? amt : -amt;
      if (v.to_kind === "branch" && v.to_id === bId) d += isThu ? -amt : amt;
      return d;
    };

    const currentFund = fund === "all" ? null : fund;

    // Số liệu (CHỈ phiếu active) — logic branchStats cũ, bổ sung khoảng ngày:
    //   • thu / chi  : tính trong KHOẢNG NGÀY đang lọc (nếu có)
    //   • ton (tồn)  : LUÔN tính trên toàn bộ lịch sử = số dư thực của quỹ
    const active = (vouchers as any[]).filter(
      (v) => v.status === "active" && (currentFund ? v.fund_type === currentFund : true),
    );
    let stats: { thu: number; chi: number; ton: number };
    if (filterBranch) {
      let thu = 0, chi = 0, tonAll = 0;
      for (const v of active) {
        const d = branchDelta(v, filterBranch);
        tonAll += d;
        if (!inDateRange(v)) continue;
        if (d > 0) thu += d;
        else if (d < 0) chi += -d;
      }
      stats = { thu, chi, ton: tonAll };
    } else {
      let thu = 0, chi = 0, tonAll = 0;
      for (const v of active) {
        const amt = Number(v.amount || 0);
        const signed = v.type === "thu" ? amt : -amt;
        tonAll += signed;
        if (!inDateRange(v)) continue;
        if (v.type === "thu") thu += amt;
        else chi += amt;
      }
      stats = { thu, chi, ton: tonAll };
    }

    // Danh sách (mọi trạng thái) — y nguyên filtered cũ.
    const filtered = (vouchers as any[]).filter((v) => {
      const matchFund = !currentFund || v.fund_type === currentFund;
      const bIds = voucherBranchIds(v);
      const matchBranch = !filterBranch || bIds.includes(filterBranch);
      const matchAccess =
        canViewAll || branchIds.length === 0 || bIds.some((id) => branchIds.includes(id));
      const matchType = !filterType || v.type === filterType;
      const matchVoucherType = !filterVoucherType || v.voucher_type_id === filterVoucherType;
      const matchBank = !filterBank || (v.note ?? "").includes(filterBank);
      const matchDate = inDateRange(v); // ✅ lọc theo khoảng ngày
      const sides = voucherSides(v);
      const matchSearch =
        !search ||
        v.code?.toLowerCase().includes(search) ||
        sides.a?.toLowerCase().includes(search) ||
        sides.b?.toLowerCase().includes(search) ||
        v.note?.toLowerCase().includes(search);
      return matchFund && matchBranch && matchAccess && matchType && matchVoucherType && matchBank && matchDate && matchSearch;
    });

    const totalFiltered = filtered.length;
    const start = (page - 1) * pageSize;
    return {
      vouchers: filtered.slice(start, start + pageSize),
      meta: { totalFiltered },
      stats,
    };
  },
);

// Dữ liệu tra cứu cho form + hiển thị tên (KHÔNG kèm danh sách phiếu).
export const getCashRefs = createServerFn({ method: "GET" }).handler(async () => {
  const [branches, users, customers, voucherTypes, voucherNames] = await Promise.all([
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("users", { select: "id, full_name, is_admin", orderBy: "full_name" }),
    fetchAllRows("customers", { select: "id, name, phone", orderBy: "created_at", ascending: false }),
    fetchRows("cash_voucher_types", { orderBy: "name" }),
    // ✅ Gợi ý "Đơn vị khác": các tên đã từng nhập ở phiếu cũ (from_name/to_name)
    fetchAllRows("cash_vouchers", {
      select: "from_name, to_name, created_at",
      orderBy: "created_at",
      ascending: false,
    }),
  ]);

  // Gom tên "đơn vị khác" đã dùng, mới nhất lên trước, bỏ trùng (không phân
  // biệt hoa thường), tối đa 200 gợi ý.
  const seen = new Set<string>();
  const otherParties: string[] = [];
  for (const v of voucherNames as any[]) {
    for (const raw of [v.to_name, v.from_name]) {
      const name = String(raw ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      otherParties.push(name);
      if (otherParties.length >= 200) break;
    }
    if (otherParties.length >= 200) break;
  }

  return { branches, users, customers, voucherTypes, otherParties };
});

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