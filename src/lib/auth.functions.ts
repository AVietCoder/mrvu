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
    return session;
  });

export const registerFn = createServerFn({ method: "POST" })
  .handler(async ({
    data,
  }: {
    data: {
      full_name: string;
      phone?: string;
      username: string;
      password: string;
      branch_ids?: string[];
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

    if (data.branch_ids?.length) {
      await supabase.from("user_branches").upsert(
        data.branch_ids.map((branch_id) => ({ user_id: user.id, branch_id })),
        { onConflict: "user_id,branch_id" },
      );
    }

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

    await updateWhere("users", { password: data.new_password }, { id: data.user_id });
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
  .handler(async ({ data }: { data: { id: string } }) => {
    await deleteWhere("users", { id: data.id, is_admin: Number(0) });
    return { success: true };
  });

export const getFormOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  return {
    branches: await fetchRows("branches", { orderBy: "name" }),
  };
});
