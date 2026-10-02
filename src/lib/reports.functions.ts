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

// Phân trang qua .range() để KHÔNG bị cắt ở mốc 1000 dòng mặc định của
// Supabase (kỳ > 1000 đơn trước đây bị thiếu → doanh thu sai).
// Dùng chung cho getReports và getSalesByCustomer.
export async function fetchAllPaged(build: () => any): Promise<any[]> {
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
      // count_in_total (v15): phụ kiện đi kèm không vào Top sản phẩm. Chưa chạy
      // migration thì thiếu cột → đọc lại không có cột đó, không làm hỏng báo cáo.
      fetchAllRows<any>("products", { select: "id, name, sku, min_stock, count_in_total" }).catch(() =>
        fetchAllRows<any>("products", { select: "id, name, sku, min_stock" }),
      ),
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
      .filter(([productId]) => productMap.get(productId)?.count_in_total !== false)
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

// ── Đơn hàng bán theo khách / theo khoảng thời gian ──────────────────────────
// Liệt kê mỗi khách một dòng: các đơn đã mua trong kỳ và tổng tiền.
//
// Ngữ nghĩa GIỐNG HỆT getReports ở trên để hai con số không bao giờ lệch nhau:
//   - Chỉ tính đơn HOÀN TẤT, theo NGÀY HOÀN TẤT (completed_at) giờ Việt Nam.
//   - Đơn cũ thiếu completed_at → lấy ngày tạo.
//   - Phiếu trả hàng (status 'returned') lấy theo ngày tạo, trả riêng ở cột
//     "trả hàng" để người xem tự thấy, KHÔNG âm thầm trừ vào tổng mua.
// Đơn khách lẻ (không gắn khách) gom chung một dòng.
export const getSalesByCustomer = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { date_from?: string; date_to?: string } }) => {
    const toDate = data?.date_to || localDateKey(new Date());
    const fromDate = data?.date_from || toDate;
    const fromTs = fromDate + "T00:00:00+07:00";
    const toTs = toDate + "T23:59:59+07:00";
    const SEL = "id, code, customer_id, total, status, created_at, completed_at";

    const [byCompletedAt, legacyNoCompletedAt, returned] = await Promise.all([
      fetchAllPaged(() =>
        supabase.from("orders").select(SEL)
          .eq("status", "completed")
          .not("completed_at", "is", null)
          .gte("completed_at", fromTs).lte("completed_at", toTs)
          .order("completed_at", { ascending: true }),
      ),
      fetchAllPaged(() =>
        supabase.from("orders").select(SEL)
          .eq("status", "completed")
          .is("completed_at", null)
          .gte("created_at", fromTs).lte("created_at", toTs)
          .order("created_at", { ascending: true }),
      ),
      fetchAllPaged(() =>
        supabase.from("orders").select(SEL)
          .eq("status", "returned")
          .gte("created_at", fromTs).lte("created_at", toTs),
      ),
    ]);

    const WALK_IN = "__walk_in__";
    type Row = {
      customer_id: string | null;
      orders: { id: string; code: string; total: number; date: string }[];
      total: number;
      returned_total: number;
      first_date: string;
      last_date: string;
    };
    const groups = new Map<string, Row>();
    const touch = (cid: string | null) => {
      const key = cid || WALK_IN;
      let g = groups.get(key);
      if (!g) {
        g = { customer_id: cid, orders: [], total: 0, returned_total: 0, first_date: "", last_date: "" };
        groups.set(key, g);
      }
      return g;
    };

    for (const o of [...byCompletedAt, ...legacyNoCompletedAt]) {
      const g = touch(o.customer_id);
      const date = normalizeDate(o.completed_at || o.created_at);
      const total = Number(o.total || 0);
      g.orders.push({ id: o.id, code: o.code, total, date });
      g.total += total;
      if (!g.first_date || date < g.first_date) g.first_date = date;
      if (!g.last_date || date > g.last_date) g.last_date = date;
    }
    // Phiếu trả chỉ gắn vào khách ĐÃ có đơn mua trong kỳ — khách chỉ có phiếu
    // trả mà không mua gì trong kỳ không thuộc danh sách "đơn hàng bán".
    for (const r of returned) {
      const g = groups.get(r.customer_id || WALK_IN);
      if (g) g.returned_total += Number(r.total || 0);
    }

    // Lấy tên khách theo lô, chỉ đúng những khách xuất hiện trong kỳ.
    const ids = [...groups.values()].map((g) => g.customer_id).filter(Boolean) as string[];
    const custMap = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: rows, error } = await supabase
        .from("customers")
        .select("id, name, phone, external_code, company_name")
        .in("id", ids.slice(i, i + 500));
      if (error) throw new Error(error.message);
      for (const c of rows ?? []) custMap.set(c.id, c);
    }

    const rows = [...groups.values()]
      .map((g) => {
        const c = g.customer_id ? custMap.get(g.customer_id) : null;
        g.orders.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return {
          ...g,
          customer_name: g.customer_id ? c?.name ?? "(khách đã xoá)" : "Khách lẻ (không lưu thông tin)",
          customer_company: c?.company_name ?? null,
          phone: c?.phone ?? null,
          customer_code: c?.external_code ?? null,
          order_count: g.orders.length,
        };
      })
      // Mua nhiều nhất lên đầu.
      .sort((a, b) => b.total - a.total);

    return {
      date_from: fromDate,
      date_to: toDate,
      rows,
      summary: {
        customers: rows.filter((r) => r.customer_id).length,
        orders: rows.reduce((s, r) => s + r.order_count, 0),
        total: rows.reduce((s, r) => s + r.total, 0),
        returned_total: rows.reduce((s, r) => s + r.returned_total, 0),
      },
    };
  });
