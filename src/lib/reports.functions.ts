"use server";
import { createServerFn } from "@tanstack/react-start";
import db from "@/server/db.server";

export const getReports = createServerFn({ method: "GET" }).handler(async () => {
  // Doanh thu tổng
  const rev = db.prepare(
    "SELECT COALESCE(SUM(total),0) as v FROM orders WHERE status='completed'"
  ).get() as any;
  const totalRevenue: number = rev.v;

  const cnt = db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE status='completed'"
  ).get() as any;
  const totalOrders: number = cnt.c;

  // Doanh thu 14 ngày gần nhất
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const r = db.prepare(
      "SELECT COALESCE(SUM(total),0) as v FROM orders WHERE status='completed' AND DATE(created_at)=?"
    ).get(key) as any;
    days.push({ date: key.slice(5), revenue: r.v });
  }

  // Top sản phẩm
  const topProducts = db.prepare(`
    SELECT p.name, COALESCE(SUM(oi.qty),0) as qty
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'completed'
    GROUP BY p.id ORDER BY qty DESC LIMIT 5
  `).all();

  // Tồn kho thấp
  const lowStock = db.prepare(`
    SELECT p.name, p.sku, COALESCE(SUM(s.qty),0) as qty, p.min_stock as min
    FROM products p
    LEFT JOIN stock s ON s.product_id = p.id
    GROUP BY p.id
    HAVING qty <= p.min_stock
    ORDER BY qty ASC LIMIT 10
  `).all();

  // Công nợ
  const debtRow = db.prepare(
    "SELECT COALESCE(SUM(debt),0) as v FROM customers"
  ).get() as any;
  const totalDebt: number = debtRow.v;

  const debtors = db.prepare(
    "SELECT * FROM customers WHERE debt > 0 ORDER BY debt DESC LIMIT 10"
  ).all();

  const productCount = (db.prepare("SELECT COUNT(*) as c FROM products").get() as any).c;
  const customerCount = (db.prepare("SELECT COUNT(*) as c FROM customers").get() as any).c;

  // Theo chi nhánh
  const byBranch = db.prepare(`
    SELECT b.name, COALESCE(SUM(o.total),0) as revenue, COUNT(o.id) as orders
    FROM branches b
    LEFT JOIN orders o ON o.branch_id = b.id AND o.status='completed'
    GROUP BY b.id ORDER BY revenue DESC
  `).all();

  // Theo nhân viên
    const byEmployee = db.prepare(`
      SELECT u.full_name as name,
            COALESCE(SUM(o.total),0) as revenue
      FROM users u
      LEFT JOIN orders o
        ON o.employee_id = u.id
      AND o.status='completed'
      GROUP BY u.id
      ORDER BY revenue DESC
    `).all();

  return {
    totalRevenue, totalOrders, totalDebt,
    productCount, customerCount,
    days, topProducts, lowStock, debtors,
    byBranch, byEmployee,
  };
});