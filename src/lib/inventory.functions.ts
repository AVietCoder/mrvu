import { createServerFn } from "@tanstack/react-start";
import db, { uid, now } from "@/server/db.server";

function adjustStock(productId: string, branchId: string, delta: number) {
  const row = db.prepare("SELECT qty FROM stock WHERE product_id=? AND branch_id=?").get(productId, branchId);
  if (row) {
    db.prepare("UPDATE stock SET qty=qty+? WHERE product_id=? AND branch_id=?").run(delta, productId, branchId);
  } else {
    db.prepare("INSERT INTO stock (product_id,branch_id,qty) VALUES (?,?,?)").run(productId, branchId, Math.max(0, delta));
  }
}

export const listInventory = createServerFn({ method: "GET" }).handler(async () => {
  return {
    products: db.prepare("SELECT * FROM products ORDER BY name").all(),
    branches: db.prepare("SELECT * FROM branches ORDER BY name").all(),
    stock: db.prepare("SELECT * FROM stock").all(),
    movements: db.prepare("SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 100").all(),
    transfers: db.prepare("SELECT * FROM stock_transfers ORDER BY created_at DESC").all(),
    transfer_items: db.prepare("SELECT * FROM stock_transfer_items").all(),
  };
});

// Nhập / Xuất kho — nhận branch_id (cho cả nhập và xuất)
export const createMovement = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    type: "in" | "out";
    product_id: string;
    branch_id: string;
    qty: number;
    unit_cost?: number;
    note?: string;
    created_by?: string;
    actor_id?: string;  // alias
  }}) => {
    const branchId = data.branch_id;
    const createdBy = data.created_by || data.actor_id || null;
    const delta = data.type === "in" ? data.qty : -data.qty;
    adjustStock(data.product_id, branchId, delta);
    db.prepare(`INSERT INTO stock_movements
      (id,type,product_id,from_branch,to_branch,qty,unit_cost,note,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        uid(), data.type, data.product_id,
        data.type === "out" ? branchId : null,
        data.type === "in"  ? branchId : null,
        data.qty, data.unit_cost || 0, data.note || null, now(), createdBy
      );
    return { ok: true };
  });

// Tạo phiếu chuyển kho (kho gửi trừ ngay, kho nhận chờ xác nhận)
export const createTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: {
    from_branch: string; to_branch: string;
    items: { product_id: string; qty: number }[];
    note?: string; created_by?: string;
  }}) => {
    if (data.from_branch === data.to_branch) throw new Error("Chi nhánh nguồn và đích không được giống nhau");
    const tid = uid();
    const t = db.transaction(() => {
      db.prepare(`INSERT INTO stock_transfers (id,from_branch,to_branch,status,note,created_by,created_at)
        VALUES (?,?,?,'pending',?,?,?)`)
        .run(tid, data.from_branch, data.to_branch, data.note || null, data.created_by || null, now());
      for (const item of data.items) {
        db.prepare("INSERT INTO stock_transfer_items (id,transfer_id,product_id,qty) VALUES (?,?,?,?)")
          .run(uid(), tid, item.product_id, item.qty);
        // Trừ kho gửi ngay
        adjustStock(item.product_id, data.from_branch, -item.qty);
        // Ghi movement
        db.prepare(`INSERT INTO stock_movements (id,type,product_id,from_branch,to_branch,qty,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(uid(), "transfer", item.product_id, data.from_branch, data.to_branch, item.qty, `Phiếu chuyển kho ${tid}`, now(), data.created_by || null);
      }
    });
    t();
    return { id: tid };
  });

// Chi nhánh nhận bấm xác nhận → kho nhận tăng lên
export const confirmTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string }}) => {
    const transfer = db.prepare("SELECT * FROM stock_transfers WHERE id=?").get(data.transfer_id) as any;
    if (!transfer) throw new Error("Không tìm thấy phiếu chuyển kho");
    if (transfer.status !== "pending") throw new Error("Phiếu này đã được xử lý");

    const items = db.prepare("SELECT * FROM stock_transfer_items WHERE transfer_id=?").all(data.transfer_id) as any[];
    const t = db.transaction(() => {
      for (const item of items) {
        adjustStock(item.product_id, transfer.to_branch, item.qty);
      }
      db.prepare("UPDATE stock_transfers SET status='confirmed', confirmed_at=? WHERE id=?")
        .run(now(), data.transfer_id);
    });
    t();
    return { ok: true };
  });

export const cancelTransfer = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { transfer_id: string }}) => {
    const transfer = db.prepare("SELECT * FROM stock_transfers WHERE id=?").get(data.transfer_id) as any;
    if (!transfer || transfer.status !== "pending") throw new Error("Không thể hủy phiếu này");

    const items = db.prepare("SELECT * FROM stock_transfer_items WHERE transfer_id=?").all(data.transfer_id) as any[];
    const t = db.transaction(() => {
      // Hoàn lại kho gửi
      for (const item of items) {
        adjustStock(item.product_id, transfer.from_branch, item.qty);
      }
      db.prepare("UPDATE stock_transfers SET status='cancelled' WHERE id=?").run(data.transfer_id);
    });
    t();
    return { ok: true };
  });
