// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchAllRows } from "./supabase";

const TZ = "Asia/Ho_Chi_Minh";
const dtfCache = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDateKey(value: string | Date): string {
  return dtfCache.format(new Date(value));
}

function normalizeDate(value: any): string {
  if (!value) return "";
  return localDateKey(value);
}

export const getReports = createServerFn({ method: "GET" }).handler(async () => {
  const [orders, orderItems, products, customers, branches, users, stock] = await Promise.all([
    fetchAllRows<any>("orders", { select: "id, status, total, created_at, completed_at, branch_id, employee_id, customer_id" }),
    fetchAllRows<any>("order_items", { select: "order_id, product_id, qty, unit_price" }),
    fetchAllRows<any>("products", { select: "id, name, sku, min_stock" }),
    fetchAllRows<any>("customers", { select: "id, name, phone, debt" }),
    fetchAllRows<any>("branches", { select: "id, name" }),
    fetchAllRows<any>("users", { select: "id, full_name" }),
    fetchAllRows<any>("stock", { select: "product_id, qty" }),
  ]);

  const completedOrders = orders.filter((o: any) => o.status === "completed");
  const totalRevenue = completedOrders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
  const totalOrders = completedOrders.length;

  const today = new Date();
  const days: { date: string; revenue: number }[] = [];
  
  const recentDaysMap = new Map<string, number>();
  completedOrders.forEach((o) => {
    const k = normalizeDate(o.created_at);
    recentDaysMap.set(k, (recentDaysMap.get(k) || 0) + Number(o.total || 0));
  });

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateKey(d);
    days.push({ date: key.slice(5), revenue: recentDaysMap.get(key) || 0 });
  }

  const orderMap = new Map(completedOrders.map((o: any) => [o.id, o]));
  const productMap = new Map(products.map((p: any) => [p.id, p]));
  const topQty = new Map<string, number>();

  for (const item of orderItems) {
    if (!orderMap.has(item.order_id)) continue;
    topQty.set(item.product_id, (topQty.get(item.product_id) ?? 0) + Number(item.qty || 0));
  }

  const topProducts = [...topQty.entries()]
    .map(([productId, qty]) => ({
      name: productMap.get(productId)?.name ?? productId,
      qty,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const stockByProduct = new Map<string, number>();
  for (const row of stock) {
    stockByProduct.set(row.product_id, (stockByProduct.get(row.product_id) ?? 0) + Number(row.qty || 0));
  }

  const lowStock = products
    .map((p: any) => ({
      name: p.name,
      sku: p.sku,
      qty: stockByProduct.get(p.id) ?? 0,
      min: Number(p.min_stock || 0),
    }))
    .filter((p: any) => p.qty <= p.min)
    .sort((a: any, b: any) => a.qty - b.qty)
    .slice(0, 10);

  const totalDebt = customers.reduce((sum: number, customer: any) => sum + Number(customer.debt || 0), 0);
  const debtors = customers
    .filter((customer: any) => Number(customer.debt || 0) > 0)
    .sort((a: any, b: any) => Number(b.debt || 0) - Number(a.debt || 0))
    .slice(0, 10);

  const productCount = products.length;
  const customerCount = customers.length;

  const branchOrdersMap = new Map<string, { revenue: number; orders: number }>();
  completedOrders.forEach((o) => {
    if (!o.branch_id) return;
    const cur = branchOrdersMap.get(o.branch_id) || { revenue: 0, orders: 0 };
    branchOrdersMap.set(o.branch_id, { revenue: cur.revenue + Number(o.total || 0), orders: cur.orders + 1 });
  });

  const byBranch = branches
    .map((branch: any) => {
      const stats = branchOrdersMap.get(branch.id) || { revenue: 0, orders: 0 };
      return {
        name: branch.name,
        revenue: stats.revenue,
        orders: stats.orders,
      };
    })
    .sort((a: any, b: any) => b.revenue - a.revenue);

  const employeeOrdersMap = new Map<string, number>();
  completedOrders.forEach((o) => {
    if (!o.employee_id) return;
    employeeOrdersMap.set(o.employee_id, (employeeOrdersMap.get(o.employee_id) || 0) + Number(o.total || 0));
  });

  const byEmployee = users
    .map((user: any) => ({
      name: user.full_name,
      revenue: employeeOrdersMap.get(user.id) || 0,
    }))
    .sort((a: any, b: any) => b.revenue - a.revenue);

  return {
    totalRevenue,
    totalOrders,
    totalDebt,
    productCount,
    customerCount,
    days,
    topProducts,
    lowStock,
    debtors,
    byBranch,
    byEmployee,
    _rawOrders: orders,
    _rawItems: orderItems,
    _rawProducts: products,
    _rawBranches: branches,
    _rawUsers: users,
  };
});