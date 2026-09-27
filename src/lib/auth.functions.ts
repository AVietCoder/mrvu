// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import type { AuthSession, Permission, User } from "./types";
import {
  deleteWhere,
  fetchRow,
  fetchRows,
  insertRow,
  now,
  supabase,
  uid,
  updateWhere,
  logActivity,
} from "./supabase";

async function loadUser(row: any): Promise<User> {
  const [branchRows, permRows] = await Promise.all([
    fetchRows<{ branch_id: string }>("user_branches", { eq: { user_id: row.id }, select: "branch_id" }),
    fetchRows<{ permission: Permission }>("user_permissions", { eq: { user_id: row.id }, select: "permission" }),
  ]);

  return {
    id: row.id,
    full_name: row.full_name,
    username: row.username,
    phone: row.phone ?? undefined,
    birthday: row.birthday ?? undefined,
    position_id: row.position_id ?? undefined,
    is_admin: Number(row.is_admin),
    branch_ids: branchRows.map((r) => r.branch_id),
    permissions: permRows.map((r) => r.permission),
    created_at: row.created_at,
  };
}

export const loginFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { username: string; password: string } }) => {
    const row = await fetchRow<any>("users", {
      eq: { username: data.username, password: data.password },
    });

    if (!row) throw new Error("Sai tên đăng nhập hoặc mật khẩu");
    const user = await loadUser(row);
    const session: AuthSession = { user, token: uid() + uid() };
    await logActivity({ action: "login", detail: `${user.full_name} (${user.username}) đăng nhập`, employee_id: user.id });
    return session;
  });

export const registerFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      full_name: string;
      phone?: string;
      birthday?: string;   // yyyy-mm-dd
      position_id?: string;
      username: string;
      password: string;
      branch_ids?: string[];
      actor_id?: string; // admin tạo: id admin; tự đăng ký: bỏ trống
    };
  }) => {
    const exists = await fetchRow("users", { eq: { username: data.username }, select: "id" });
    if (exists) throw new Error("Tên đăng nhập đã tồn tại");

    const user = await insertRow<any>("users", {
      id: uid(),
      full_name: data.full_name,
      username: data.username,
      password: data.password,
      phone: data.phone || null,
      is_admin: Number(0),
      created_at: now(),
    });

    // Ngày sinh ghi RIÊNG, có .catch(): insertRow là bản nghiêm ngặt, nếu DB
    // chưa chạy migration v11 thì cả câu insert hỏng = KHÔNG TẠO ĐƯỢC tài
    // khoản nào. Thiếu ngày sinh chỉ là không nhắc được sinh nhật.
    if (data.birthday) {
      await updateWhere("users", { birthday: data.birthday }, { id: user.id }).catch(
        () => undefined,
      );
    }
    // Chức vụ cũng ghi riêng (migration v18) — thiếu cột thì vẫn tạo được tài khoản.
    if (data.position_id) {
      await updateWhere("users", { position_id: data.position_id }, { id: user.id }).catch(
        () => undefined,
      );
    }

    if (data.branch_ids?.length) {
      await supabase.from("user_branches").upsert(
        data.branch_ids.map((branch_id) => ({ user_id: user.id, branch_id })),
        { onConflict: "user_id,branch_id" },
      );
    }

    // Nếu có admin thực hiện => log với employee_id = admin
    // Nếu tự đăng ký => log với employee_id = chính user mới tạo (để hiện tên người đăng ký)
    const actor = data.actor_id || user.id;
    const byWho = data.actor_id ? "(Admin tạo)" : "(Tự đăng ký)";
    await logActivity({
      action: "register",
      detail: `Tạo tài khoản: ${data.username} - ${data.full_name} ${byWho}`,
      employee_id: actor,
    });
    return { success: true, username: data.username };
  });

export const changePasswordFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: { user_id: string; old_password: string; new_password: string };
  }) => {
    const u = await fetchRow("users", {
      eq: { id: data.user_id, password: data.old_password },
      select: "id",
    });
    if (!u) throw new Error("Mật khẩu cũ không đúng");

    await updateWhere("users", { password: data.new_password }, { id: data.user_id });
    await logActivity({ action: "change_password", detail: "Đổi mật khẩu", employee_id: data.user_id });
    return { success: true };
  });

// Reset mật khẩu bởi admin (không cần mật khẩu cũ)
export const resetPasswordFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: { user_id: string; new_password: string; admin_id: string };
  }) => {
    const admin = await fetchRow("users", {
      eq: { id: data.admin_id, is_admin: Number(1) },
      select: "id",
    });
    if (!admin) throw new Error("Không có quyền thực hiện");

    const target = await fetchRow<any>("users", { eq: { id: data.user_id }, select: "username, full_name" });
    await updateWhere("users", { password: data.new_password }, { id: data.user_id });
    await logActivity({
      action: "reset_password",
      detail: `Admin reset mật khẩu cho ${target?.username || data.user_id}${target?.full_name ? ` (${target.full_name})` : ""}`,
      employee_id: data.admin_id,
    });
    return { success: true };
  });

/**
 * Sửa hồ sơ nhân viên đã tồn tại (hiện chỉ dùng cho ngày sinh và SĐT).
 * Trước đây chỉ có đổi quyền và reset mật khẩu, không có đường nào sửa được
 * thông tin cá nhân của nhân viên đã tạo.
 *
 * Kiểm quyền admin theo đúng mẫu resetPasswordFn ở trên.
 */
export const updateUserProfileFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      user_id: string;
      full_name?: string;
      phone?: string;
      birthday?: string | null;
      position_id?: string | null;
      admin_id: string;
    };
  }) => {
    const admin = await fetchRow("users", {
      eq: { id: data.admin_id, is_admin: Number(1) },
      select: "id",
    });
    if (!admin) throw new Error("Không có quyền thực hiện");

    const fields: Record<string, any> = {};
    if (data.full_name !== undefined) fields.full_name = data.full_name;
    if (data.phone !== undefined) fields.phone = data.phone || null;
    if (Object.keys(fields).length) {
      await updateWhere("users", fields, { id: data.user_id });
    }

    // Ngày sinh tách riêng, có .catch() phòng DB chưa chạy migration v11 —
    // cột thiếu thì chỉ mất phần sinh nhật, không làm hỏng việc sửa hồ sơ.
    if (data.birthday !== undefined) {
      await updateWhere("users", { birthday: data.birthday || null }, { id: data.user_id }).catch(
        () => undefined,
      );
    }

    // Chức vụ: báo lỗi rõ nếu chưa chạy migration v18 (người dùng chủ động đổi).
    if (data.position_id !== undefined) {
      const { error } = await supabase
        .from("users")
        .update({ position_id: data.position_id || null })
        .eq("id", data.user_id);
      if (error) throw new Error(`Không lưu được chức vụ: ${error.message}. Cần chạy sql_migration_v18_positions.sql.`);
    }

    const target = await fetchRow<any>("users", { eq: { id: data.user_id }, select: "username, full_name" });
    await logActivity({
      action: "update_user_profile",
      detail: `Cập nhật hồ sơ ${target?.username || data.user_id}${target?.full_name ? ` (${target.full_name})` : ""}`,
      employee_id: data.admin_id,
    });
    return { success: true };
  });

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchRows<any>("users", { orderBy: "full_name" });
  const users = await Promise.all(rows.map((row) => loadUser(row)));
  return users;
});

export const updateUserPermsFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      user_ids: string[];
      permissions: Permission[];
      branch_ids: string[];
    };
  }) => {
    for (const userId of data.user_ids) {
      await deleteWhere("user_permissions", { user_id: userId });
      if (data.permissions.length) {
        await supabase.from("user_permissions").insert(
          data.permissions.map((permission) => ({
            user_id: userId,
            permission,
          })),
        );
      }

      await deleteWhere("user_branches", { user_id: userId });
      if (data.branch_ids.length) {
        await supabase.from("user_branches").insert(
          data.branch_ids.map((branch_id) => ({
            user_id: userId,
            branch_id,
          })),
        );
      }
    }
    return { success: true };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; actor_id?: string } }) => {
    await deleteWhere("users", { id: data.id, is_admin: Number(0) });
    await logActivity({
      action: "delete_user",
      detail: `Xóa tài khoản user ${data.id}`,
      employee_id: data.actor_id || null,
    });
    return { success: true };
  });

export const getFormOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const [branches, positions] = await Promise.all([
    fetchRows("branches", { orderBy: "name" }),
    // Chưa chạy migration v18 thì chưa có bảng → danh sách rỗng, trang vẫn chạy.
    fetchRows("positions", { orderBy: "sort_order" }).catch(() => []),
  ]);
  return { branches, positions };
});

// ═══════════════════════════════════════════════════════════════════════════
// CHỨC VỤ (migration v18) — chỉ admin thêm / đổi tên / xoá
// ═══════════════════════════════════════════════════════════════════════════
async function assertAdminId(adminId?: string) {
  const admin = adminId
    ? await fetchRow("users", { eq: { id: adminId, is_admin: Number(1) }, select: "id" })
    : null;
  if (!admin) throw new Error("Không có quyền thực hiện");
}

export const upsertPositionFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id?: string; name: string; admin_id: string } }) => {
    await assertAdminId(data.admin_id);
    const name = String(data.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Nhập tên chức vụ");
    if (name.length > 60) throw new Error("Tên chức vụ tối đa 60 ký tự");

    if (data.id) {
      const { error } = await supabase.from("positions").update({ name }).eq("id", data.id);
      if (error) throw new Error(/uq_positions_name|duplicate/i.test(error.message) ? `Đã có chức vụ "${name}"` : error.message);
    } else {
      const { data: last } = await supabase.from("positions").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const { error } = await supabase
        .from("positions")
        .insert({ id: uid(), name, sort_order: Number(last?.[0]?.sort_order ?? 0) + 1 });
      if (error) throw new Error(/uq_positions_name|duplicate/i.test(error.message) ? `Đã có chức vụ "${name}"` : error.message);
    }
    await logActivity({ action: "upsert_position", detail: `${data.id ? "Đổi tên" : "Thêm"} chức vụ: ${name}`, employee_id: data.admin_id });
    return { ok: true };
  });

export const deletePositionFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string; admin_id: string } }) => {
    await assertAdminId(data.admin_id);
    // FK ON DELETE SET NULL: nhân viên đang giữ chức vụ này về "chưa có chức vụ".
    const { error } = await supabase.from("positions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logActivity({ action: "delete_position", detail: `Xoá chức vụ ${data.id}`, employee_id: data.admin_id });
    return { ok: true };
  });
