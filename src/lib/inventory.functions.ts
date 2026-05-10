import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

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
  }}) => {
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
      (id,type,product_id,from_branch,to_branch,qty,unit_cost,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        uid(), data.type, data.product_id,
        data.from_branch || null, data.to_branch || null,
        data.qty, data.unit_cost || 0, data.note || null, now()
      );
    return { ok: true };
  });