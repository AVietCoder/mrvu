import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";
import type { Permission } from "./types";

function adjustStock(productId: string, branchId: string, delta: number) {
  const row = db.prepare("SELECT qty FROM stock WHERE product_id=? AND branch_id=?")
    .get(productId, branchId);
  if (row) {
    db.prepare("UPDATE stock SET qty=qty+? WHERE product_id=? AND branch_id=?")
      .run(delta, productId, branchId);
  } else {
    db.prepare("INSERT INTO stock (product_id,branch_id,qty) VALUES (?,?,?)")
      .run(productId, branchId, Math.max(0, delta));
  }
}

// ✏️ Helper: kiểm tra actor có quyền không
function requirePerm(actorId: string | undefined, perm: Permission) {
  if (!actorId) throw new Error("Chưa đăng nhập");
  const u = db.prepare("SELECT is_admin FROM users WHERE id=?").get(actorId) as any;
  if (!u) throw new Error("Tài khoản không tồn tại");
  if (u.is_admin === 1) return; // admin luôn được
  const has = db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?")
    .get(actorId, perm);
  if (!has) throw new Error("Bạn không có quyền thực hiện thao tác này");
}

export const listInventory = createServerFn({ method: "GET" }).handler(async () => {
  return {
    products: db.prepare("SELECT * FROM products ORDER BY name").all(),
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    stock: db.prepare("SELECT * FROM stock").all(),
    movements: db.prepare(
      "SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 100"
    ).all(),
  };
});

export const createMovement = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    type: "in" | "out" | "transfer";
    product_id: string;
    from_branch?: string;
    to_branch?: string;
    qty: number;
    unit_cost?: number;
    note?: string;
    actor_id?: string; // ✏️ ai đang thao tác
  }}) => {
    // ✏️ Check quyền server-side
    if (data.type === "in")       requirePerm(data.actor_id, "stock_in");
    if (data.type === "out")      requirePerm(data.actor_id, "stock_out");
    if (data.type === "transfer") requirePerm(data.actor_id, "stock_transfer");

    if (data.type === "in" && data.to_branch) {
      adjustStock(data.product_id, data.to_branch, data.qty);
    } else if (data.type === "out" && data.from_branch) {
      adjustStock(data.product_id, data.from_branch, -data.qty);
    } else if (data.type === "transfer" && data.from_branch && data.to_branch) {
      adjustStock(data.product_id, data.from_branch, -data.qty);
      adjustStock(data.product_id, data.to_branch, data.qty);
    } else {
      throw new Error("Thiếu thông tin chi nhánh");
    }

    db.prepare(`INSERT INTO stock_movements
      (id,type,product_id,from_branch,to_branch,qty,unit_cost,note,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        uid(), data.type, data.product_id,
        data.from_branch || null, data.to_branch || null,
        data.qty, data.unit_cost || 0, data.note || null, now(),
        data.actor_id || null
      );
    return { ok: true };
  });
