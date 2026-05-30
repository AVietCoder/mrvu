// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchAllRows } from "./supabase";

const TZ = "Asia/Ho_Chi_Minh";

function localDateKey(value: string | Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function normalizeDate(value: any): string {
  if (!value) return "";
  return localDateKey(value);
}

export const getReports = createServerFn({ method: "GET" }).handler(async () => {
  const [orders, orderItems, products, customers, branches, users, stock] = await Promise.all([
    fetchAllRows<any>("orders", { select: "id, status, total, created_at, branch_id, employee_id, customer_id" }),
    fetchAllRows<any>("order_items", { select: "order_id, product_id, qty" }),
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
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateKey(d);
    const revenue = completedOrders
      .filter((o: any) => normalizeDate(o.created_at) === key)
      .reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
    days.push({ date: key.slice(5), revenue });
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

  const byBranch = branches
    .map((branch: any) => {
      const branchOrders = completedOrders.filter((o: any) => o.branch_id === branch.id);
      return {
        name: branch.name,
        revenue: branchOrders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0),
        orders: branchOrders.length,
      };
    })
    .sort((a: any, b: any) => b.revenue - a.revenue);

  const byEmployee = users
    .map((user: any) => {
      const employeeOrders = completedOrders.filter((o: any) => o.employee_id === user.id);
      return {
        name: user.full_name,
        revenue: employeeOrders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0),
      };
    })
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
    // Raw data for client-side date range filtering
    _rawOrders: orders,
    _rawItems: orderItems,
    _rawProducts: products,
    _rawBranches: branches,
    _rawUsers: users,
  };
});