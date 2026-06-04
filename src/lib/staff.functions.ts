// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { deleteWhere, fetchAllRows, fetchRows, insertRow, now, uid, updateWhere, logActivity } from "./supabase";

export const listEmployees = createServerFn({ method: "GET" }).handler(async () => {
  const [employees, branches, logs] = await Promise.all([
    fetchRows("employees", { orderBy: "name" }),
    fetchRows("branches", { orderBy: "name" }),
    fetchRows("activity_logs", { orderBy: "created_at", ascending: false, limit: 50 }),
  ]);

  return { employees, branches, logs };
});

export const upsertEmployee = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const payload = {
      name: data.name,
      phone: data.phone || null,
      role: data.role,
      branch_id: data.branch_id || null,
    };

    if (data.id) {
      await updateWhere("employees", payload, { id: data.id });
      await logActivity({ action: "update_employee", detail: `Cập nhật nhân viên: ${data.name}` });
    } else {
      await insertRow("employees", { id: uid(), ...payload, created_at: now() });
      await logActivity({ action: "create_employee", detail: `Thêm nhân viên mới: ${data.name} — ${data.role ?? ""}` });
    }
    return { ok: true };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("employees", { id: data.id });
    await logActivity({ action: "delete_employee", detail: `Xóa nhân viên ID: ${data.id}` });
    return { ok: true };
  });

export const listBranches = createServerFn({ method: "GET" }).handler(async () => {
  // Trang Chi nhánh chỉ cần danh sách chi nhánh (số đơn/doanh thu lấy từ getReports).
  // Trước đây hàm này tải kèm TOÀN BỘ stock + TOÀN BỘ orders (không dùng) → bỏ.
  const branches = await fetchRows("branches", { orderBy: "name" });
  return { branches };
});

export const upsertBranch = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: any }) => {
    const payload = {
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
    };

    if (data.id) {
      await updateWhere("branches", payload, { id: data.id });
      await logActivity({ action: "update_branch", detail: `Cập nhật chi nhánh: ${data.name}` });
    } else {
      await insertRow("branches", { id: uid(), ...payload, created_at: now() });
      await logActivity({ action: "create_branch", detail: `Thêm chi nhánh mới: ${data.name}` });
    }
    return { ok: true };
  });

export const deleteBranch = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("branches", { id: data.id });
    await logActivity({ action: "delete_branch", detail: `Xóa chi nhánh ID: ${data.id}` });
    return { ok: true };
  });