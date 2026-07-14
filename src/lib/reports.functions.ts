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

    const fromTs = fromDate + "T00:00:00+07:00";
    const toTs = toDate + "T23:59:59+07:00";
    const SELECT = "id, status, total, created_at, completed_at, branch_id, employee_id, customer_id";

    // Phân trang qua .range() để KHÔNG bị cắt ở mốc 1000 dòng mặc định của
    // Supabase (kỳ > 1000 đơn trước đây bị thiếu → doanh thu sai).
    async function fetchAllPaged(build: () => any): Promise<any[]> {
      const PAGE = 1000;
      let from = 0;
      let all: any[] = [];
      while (true) {
        const { data: page, error } = await build().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = page ?? [];
        all = all.concat(rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all;
    }

    // 1. Đơn HOÀN TẤT lọc theo NGÀY HOÀN TẤT (completed_at) — đây là điểm mấu
    //    chốt: doanh thu ghi nhận vào ngày đơn hoàn tất, KHÔNG phải ngày tạo.
    //    ⇒ đơn hoàn tất trong kỳ dù tạo trước kỳ vẫn được tính; đơn tạo trong kỳ
    //    nhưng hoàn tất sau kỳ KHÔNG bị tính nhầm.
    const completedByCompletedAt = await fetchAllPaged(() =>
      supabase.from("orders").select(SELECT)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .gte("completed_at", fromTs).lte("completed_at", toTs)
        .order("completed_at", { ascending: true }),
    );
    // 1b. Đơn hoàn tất CŨ thiếu completed_at (dữ liệu legacy) → fallback ngày tạo
    const completedNullCompleted = await fetchAllPaged(() =>
      supabase.from("orders").select(SELECT)
        .eq("status", "completed")
        .is("completed_at", null)
        .gte("created_at", fromTs).lte("created_at", toTs)
        .order("created_at", { ascending: true }),
    );
    const completedOrders = [...completedByCompletedAt, ...completedNullCompleted];

    // 2. Đơn CHƯA hoàn tất (đặt hàng / nháp / hủy) — lọc theo NGÀY TẠO.
    const otherOrders = await fetchAllPaged(() =>
      supabase.from("orders").select(SELECT)
        .in("status", ["reserved", "draft", "cancelled"])
        .gte("created_at", fromTs).lte("created_at", toTs)
        .order("created_at", { ascending: true }),
    );

    // 3. Phiếu TRẢ HÀNG (status 'returned') — lọc theo NGÀY TẠO phiếu trả.
    //    total của phiếu trả = giá trị hàng khách trả; sẽ TRỪ khỏi doanh thu.
    const returnedOrders = await fetchAllPaged(() =>
      supabase.from("orders").select(SELECT)
        .eq("status", "returned")
        .gte("created_at", fromTs).lte("created_at", toTs)
        .order("created_at", { ascending: true }),
    );

    // _rawOrders = đơn hoàn tất + đơn chưa hoàn tất (KHÔNG gồm phiếu trả).
    const ordersInRange: any[] = [...completedOrders, ...otherOrders];

    // Tải order_items cho đơn hoàn tất (top sản phẩm) + phiếu trả (trừ bớt qty).
    async function fetchItemsFor(ids: string[]): Promise<any[]> {
      let items: any[] = [];
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const { data: batch, error } = await supabase
          .from("order_items")
          .select("order_id, product_id, qty, unit_price")
          .in("order_id", ids.slice(i, i + BATCH));
        if (error) throw new Error(error.message);
        items = items.concat(batch ?? []);
      }
      return items;
    }
    const orderItems = completedOrders.length
      ? await fetchItemsFor(completedOrders.map((o: any) => o.id))
      : [];
    const returnItems = returnedOrders.length
      ? await fetchItemsFor(returnedOrders.map((o: any) => o.id))
      : [];

    // 3. Ref data nhỏ — tải song song
    const [products, customers, branches, users, stock] = await Promise.all([
      fetchAllRows<any>("products", { select: "id, name, sku, min_stock" }),
      fetchAllRows<any>("customers", { select: "id, name, phone, debt" }),
      fetchRows<any>("branches", { select: "id, name" }),
      fetchRows<any>("users", { select: "id, full_name" }),
      fetchAllRows<any>("stock", { select: "product_id, qty" }),
    ]);

    // 4. Tính toán server-side
    //    Doanh thu THUẦN = tổng đơn hoàn tất − tổng phiếu trả hàng.
    const grossRevenue = completedOrders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
    const returnsTotal = returnedOrders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
    const totalRevenue = grossRevenue - returnsTotal;
    const totalOrders = completedOrders.length;
    const returnsCount = returnedOrders.length;

    // Doanh thu theo ngày (14 ngày gần nhất): đơn hoàn tất ghi theo completed_at
    // (fallback created_at), phiếu trả TRỪ theo ngày tạo phiếu trả.
    const recentDaysMap = new Map<string, number>();
    completedOrders.forEach((o) => {
      const k = normalizeDate(o.completed_at || o.created_at);
      recentDaysMap.set(k, (recentDaysMap.get(k) || 0) + Number(o.total || 0));
    });
    returnedOrders.forEach((o) => {
      const k = normalizeDate(o.created_at);
      recentDaysMap.set(k, (recentDaysMap.get(k) || 0) - Number(o.total || 0));
    });

    const days: { date: string; revenue: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      days.push({ date: key.slice(5), revenue: recentDaysMap.get(key) || 0 });
    }

    // Top sản phẩm (số lượng bán THUẦN = bán ra − trả lại)
    const orderMap = new Map(completedOrders.map((o: any) => [o.id, o]));
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const topQty = new Map<string, number>();
    for (const item of orderItems) {
      if (!orderMap.has(item.order_id)) continue;
      topQty.set(item.product_id, (topQty.get(item.product_id) ?? 0) + Number(item.qty || 0));
    }
    for (const item of returnItems) {
      topQty.set(item.product_id, (topQty.get(item.product_id) ?? 0) - Number(item.qty || 0));
    }
    const topProducts = [...topQty.entries()]
      .map(([productId, qty]) => ({ name: productMap.get(productId)?.name ?? productId, qty }))
      .filter((p) => p.qty > 0)
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

    // Theo chi nhánh / nhân viên — doanh thu THUẦN (đơn hoàn tất − hàng trả).
    const branchOrdersMap = new Map<string, { revenue: number; orders: number; returns: number }>();
    completedOrders.forEach((o) => {
      if (!o.branch_id) return;
      const cur = branchOrdersMap.get(o.branch_id) || { revenue: 0, orders: 0, returns: 0 };
      cur.revenue += Number(o.total || 0);
      cur.orders += 1;
      branchOrdersMap.set(o.branch_id, cur);
    });
    returnedOrders.forEach((o) => {
      if (!o.branch_id) return;
      const cur = branchOrdersMap.get(o.branch_id) || { revenue: 0, orders: 0, returns: 0 };
      cur.revenue -= Number(o.total || 0);
      cur.returns += Number(o.total || 0);
      branchOrdersMap.set(o.branch_id, cur);
    });
    const byBranch = branches
      .map((b: any) => {
        const stats = branchOrdersMap.get(b.id) || { revenue: 0, orders: 0, returns: 0 };
        return { name: b.name, revenue: stats.revenue, orders: stats.orders, returns: stats.returns };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);

    const employeeOrdersMap = new Map<string, { revenue: number; returns: number }>();
    completedOrders.forEach((o) => {
      if (!o.employee_id) return;
      const cur = employeeOrdersMap.get(o.employee_id) || { revenue: 0, returns: 0 };
      cur.revenue += Number(o.total || 0);
      employeeOrdersMap.set(o.employee_id, cur);
    });
    returnedOrders.forEach((o) => {
      if (!o.employee_id) return;
      const cur = employeeOrdersMap.get(o.employee_id) || { revenue: 0, returns: 0 };
      cur.revenue -= Number(o.total || 0);
      cur.returns += Number(o.total || 0);
      employeeOrdersMap.set(o.employee_id, cur);
    });
    const byEmployee = users
      .map((u: any) => {
        const stats = employeeOrdersMap.get(u.id) || { revenue: 0, returns: 0 };
        return { name: u.full_name, revenue: stats.revenue, returns: stats.returns };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);

    return {
      // Date range used (UI có thể hiển thị lại)
      date_from: fromDate,
      date_to: toDate,
      // Tổng kết
      totalRevenue,        // doanh thu THUẦN (đã trừ hàng trả)
      grossRevenue,        // doanh thu gộp (chưa trừ hàng trả)
      returnsTotal,        // tổng giá trị hàng trả trong kỳ
      returnsCount,        // số phiếu trả hàng
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
      //   _rawOrders  = đơn hoàn tất (theo completed_at) + đơn chưa hoàn tất
      //   _rawReturns = phiếu trả hàng (theo ngày tạo phiếu trả)
      _rawOrders: ordersInRange ?? [],
      _rawReturns: returnedOrders,
      _rawItems: orderItems,
      _rawReturnItems: returnItems,
      _rawProducts: products,
      _rawBranches: branches,
      _rawUsers: users,
    };
  });