// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchAllRows, fetchRows, supabase } from "./supabase";

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

// ── getReports — ĐÃ TỐI ƯU ───────────────────────────────────────────────────
// Cũ: tải TOÀN BỘ orders + order_items + products + customers + branches + users
//     + stock về client, sau đó lọc ngày ở client (useMemo trong reports.tsx).
//     Với 10k đơn → vài MB JSON, 5-15s lag.
//
// Mới: nhận date_from / date_to từ client, lọc ở SERVER ngay trong query.
//   - orders: chỉ tải đơn trong khoảng ngày (gte/lte).
//   - order_items: chỉ tải cho các order_id trong kết quả trên (batched .in()).
//   - customers / users / branches / stock: vẫn fetchAllRows/fetchRows vì cần
//     để join tên — nhưng chỉ select đúng cột cần hiển thị.
//   - Thống kê tổng (lowStock, debtors) tính server-side, trả kết quả nhỏ.
//
// Nhận thêm date_from, date_to để server lọc.
// UI truyền preset (7d, 30d, custom…) khi gọi fn({ data: {date_from, date_to} }).
export const getReports = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { date_from?: string; date_to?: string } }) => {
    // Mặc định 30 ngày gần nhất nếu không truyền
    const toDate = data?.date_to || localDateKey(new Date());
    const fromDate = data?.date_from || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return localDateKey(d);
    })();

    // 1. Tải orders trong khoảng ngày — server-side filter
    const { data: ordersInRange, error: e1 } = await supabase
      .from("orders")
      .select("id, status, total, created_at, completed_at, branch_id, employee_id, customer_id")
      .gte("created_at", fromDate + "T00:00:00+07:00")
      .lte("created_at", toDate + "T23:59:59+07:00");
    if (e1) throw new Error(e1.message);

    // 2. Tải order_items CHỈ cho các đơn trong khoảng — không tải toàn bộ bảng
    const orderIds = (ordersInRange ?? []).map((o: any) => o.id);
    let orderItems: any[] = [];
    if (orderIds.length > 0) {
      // Supabase .in() giới hạn 1000 phần tử — batch nếu cần
      const BATCH = 500;
      for (let i = 0; i < orderIds.length; i += BATCH) {
        const { data: batch, error } = await supabase
          .from("order_items")
          .select("order_id, product_id, qty, unit_price")
          .in("order_id", orderIds.slice(i, i + BATCH));
        if (error) throw new Error(error.message);
        orderItems = orderItems.concat(batch ?? []);
      }
    }

    // 3. Ref data nhỏ — tải song song
    const [products, customers, branches, users, stock] = await Promise.all([
      fetchAllRows<any>("products", { select: "id, name, sku, min_stock" }),
      fetchAllRows<any>("customers", { select: "id, name, phone, debt" }),
      fetchRows<any>("branches", { select: "id, name" }),
      fetchRows<any>("users", { select: "id, full_name" }),
      fetchAllRows<any>("stock", { select: "product_id, qty" }),
    ]);

    // 4. Tính toán server-side
    const completedOrders = (ordersInRange ?? []).filter((o: any) => o.status === "completed");
    const totalRevenue = completedOrders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
    const totalOrders = completedOrders.length;

    // Doanh thu theo ngày (14 ngày gần nhất trong khoảng)
    const recentDaysMap = new Map<string, number>();
    completedOrders.forEach((o) => {
      const k = normalizeDate(o.created_at);
      recentDaysMap.set(k, (recentDaysMap.get(k) || 0) + Number(o.total || 0));
    });

    const days: { date: string; revenue: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      days.push({ date: key.slice(5), revenue: recentDaysMap.get(key) || 0 });
    }

    // Top sản phẩm
    const orderMap = new Map(completedOrders.map((o: any) => [o.id, o]));
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const topQty = new Map<string, number>();
    for (const item of orderItems) {
      if (!orderMap.has(item.order_id)) continue;
      topQty.set(item.product_id, (topQty.get(item.product_id) ?? 0) + Number(item.qty || 0));
    }
    const topProducts = [...topQty.entries()]
      .map(([productId, qty]) => ({ name: productMap.get(productId)?.name ?? productId, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // Tồn kho thấp
    const stockByProduct = new Map<string, number>();
    for (const row of stock) {
      stockByProduct.set(row.product_id, (stockByProduct.get(row.product_id) ?? 0) + Number(row.qty || 0));
    }
    const lowStock = products
      .map((p: any) => ({ name: p.name, sku: p.sku, qty: stockByProduct.get(p.id) ?? 0, min: Number(p.min_stock || 0) }))
      .filter((p: any) => p.qty <= p.min)
      .sort((a: any, b: any) => a.qty - b.qty)
      .slice(0, 10);

    // Công nợ
    const totalDebt = customers.reduce((sum: number, c: any) => sum + Number(c.debt || 0), 0);
    const debtors = customers
      .filter((c: any) => Number(c.debt || 0) > 0)
      .sort((a: any, b: any) => Number(b.debt || 0) - Number(a.debt || 0))
      .slice(0, 10);

    // Thống kê đếm tổng (toàn bộ DB, không filter ngày)
    const productCount = products.length;
    const customerCount = customers.length;

    // Theo chi nhánh / nhân viên
    const branchOrdersMap = new Map<string, { revenue: number; orders: number }>();
    completedOrders.forEach((o) => {
      if (!o.branch_id) return;
      const cur = branchOrdersMap.get(o.branch_id) || { revenue: 0, orders: 0 };
      branchOrdersMap.set(o.branch_id, { revenue: cur.revenue + Number(o.total || 0), orders: cur.orders + 1 });
    });
    const byBranch = branches
      .map((b: any) => {
        const stats = branchOrdersMap.get(b.id) || { revenue: 0, orders: 0 };
        return { name: b.name, revenue: stats.revenue, orders: stats.orders };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);

    const employeeOrdersMap = new Map<string, number>();
    completedOrders.forEach((o) => {
      if (!o.employee_id) return;
      employeeOrdersMap.set(o.employee_id, (employeeOrdersMap.get(o.employee_id) || 0) + Number(o.total || 0));
    });
    const byEmployee = users
      .map((u: any) => ({ name: u.full_name, revenue: employeeOrdersMap.get(u.id) || 0 }))
      .sort((a: any, b: any) => b.revenue - a.revenue);

    return {
      // Date range used (UI có thể hiển thị lại)
      date_from: fromDate,
      date_to: toDate,
      // Tổng kết
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
      // Raw data của KHOẢNG NGÀY ĐÃ LỌC (không phải toàn bộ) — dùng cho
      // biểu đồ ngày/tháng và thống kê chi tiết ở client.
      _rawOrders: ordersInRange ?? [],
      _rawItems: orderItems,
      _rawProducts: products,
      _rawBranches: branches,
      _rawUsers: users,
    };
  });
