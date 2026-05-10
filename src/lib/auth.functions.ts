import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";
import type { AuthSession, User } from "./types";

export const loginFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { username: string; password: string } }) => {
    const found = db.prepare(
      "SELECT * FROM users WHERE username=? AND password=?"
    ).get(data.username, data.password) as any;

    if (!found) throw new Error("Sai tên đăng nhập hoặc mật khẩu");

    const { password: _pw, ...user } = found;
    const session: AuthSession = {
      user: user as User,
      token: uid() + uid(),
    };
    return session;
  });

export const registerFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    full_name: string; phone?: string; username: string;
    password: string; role: string; branch_id?: string;
  }}) => {
    const exists = db.prepare("SELECT id FROM users WHERE username=?").get(data.username);
    if (exists) throw new Error("Tên đăng nhập đã tồn tại");

    db.prepare(`INSERT INTO users (id,full_name,username,password,phone,role,branch_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        uid(), data.full_name, data.username, data.password,
        data.phone || null, data.role, data.branch_id || null, now()
      );
    return { success: true, username: data.username };
  });

export const changePasswordFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    user_id: string; old_password: string; new_password: string;
  }}) => {
    const u = db.prepare("SELECT * FROM users WHERE id=? AND password=?")
      .get(data.user_id, data.old_password);
    if (!u) throw new Error("Mật khẩu cũ không đúng");
    db.prepare("UPDATE users SET password=? WHERE id=?")
      .run(data.new_password, data.user_id);
    return { success: true };
  });

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  return db.prepare(`
    SELECT u.id, u.full_name, u.username, u.phone, u.role, u.branch_id,
           u.created_at, COALESCE(b.name,'Tất cả') as branch_name
    FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id
    ORDER BY u.full_name
  `).all();
});

export const getFormOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  return {
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    roles: [
      { value: "admin",     label: "Quản trị viên" },
      { value: "manager",   label: "Quản lý" },
      { value: "cashier",   label: "Thu ngân" },
      { value: "warehouse", label: "Thủ kho" },
    ],
  };
});