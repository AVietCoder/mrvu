import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";
import type { AuthSession, User, Permission } from "./types";

function loadUser(row: any): User {
  const branches = db.prepare("SELECT branch_id FROM user_branches WHERE user_id=?")
    .all(row.id).map((r: any) => r.branch_id);
  const permissions = db.prepare("SELECT permission FROM user_permissions WHERE user_id=?")
    .all(row.id).map((r: any) => r.permission as Permission);
  return {
    id: row.id,
    full_name: row.full_name,
    username: row.username,
    phone: row.phone,
    is_admin: row.is_admin === 1,
    branch_ids: branches,
    permissions,
    created_at: row.created_at,
  };
}

export const loginFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { username: string; password: string } }) => {
    const row = db.prepare("SELECT * FROM users WHERE username=? AND password=?")
      .get(data.username, data.password) as any;
    if (!row) throw new Error("Sai tên đăng nhập hoặc mật khẩu");
    const session: AuthSession = { user: loadUser(row), token: uid() + uid() };
    return session;
  });

export const registerFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    full_name: string; phone?: string; username: string;
    password: string; branch_ids?: string[];
  }}) => {
    const exists = db.prepare("SELECT id FROM users WHERE username=?").get(data.username);
    if (exists) throw new Error("Tên đăng nhập đã tồn tại");
    const id = uid();
    db.prepare("INSERT INTO users (id,full_name,username,password,phone,is_admin,created_at) VALUES (?,?,?,?,?,0,?)")
      .run(id, data.full_name, data.username, data.password, data.phone || null, now());
    for (const bid of (data.branch_ids ?? [])) {
      db.prepare("INSERT OR IGNORE INTO user_branches (user_id,branch_id) VALUES (?,?)").run(id, bid);
    }
    return { success: true, username: data.username };
  });

export const changePasswordFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    user_id: string; old_password: string; new_password: string;
  }}) => {
    const u = db.prepare("SELECT id FROM users WHERE id=? AND password=?")
      .get(data.user_id, data.old_password);
    if (!u) throw new Error("Mật khẩu cũ không đúng");
    db.prepare("UPDATE users SET password=? WHERE id=?").run(data.new_password, data.user_id);
    return { success: true };
  });

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const rows = db.prepare("SELECT * FROM users ORDER BY full_name").all() as any[];
  return rows.map(loadUser);
});

export const updateUserPermsFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    user_ids: string[];
    permissions: Permission[];
    branch_ids: string[];
  }}) => {
    const transaction = db.transaction(() => {
      for (const uid of data.user_ids) {
        // Xóa quyền cũ, ghi lại mới
        db.prepare("DELETE FROM user_permissions WHERE user_id=?").run(uid);
        for (const p of data.permissions) {
          db.prepare("INSERT OR IGNORE INTO user_permissions (user_id,permission) VALUES (?,?)").run(uid, p);
        }
        // Cập nhật chi nhánh
        db.prepare("DELETE FROM user_branches WHERE user_id=?").run(uid);
        for (const bid of data.branch_ids) {
          db.prepare("INSERT OR IGNORE INTO user_branches (user_id,branch_id) VALUES (?,?)").run(uid, bid);
        }
      }
    });
    transaction();
    return { success: true };
  });

export const deleteUserFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { id: string } }) => {
    db.prepare("DELETE FROM users WHERE id=? AND is_admin=0").run(data.id);
    return { success: true };
  });

export const getFormOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  return {
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
  };
});