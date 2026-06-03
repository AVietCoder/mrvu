// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { listActivityLogs } from "@/lib/activity.functions";
import { getEmployeeDetail } from "@/lib/details.functions";
import { listUsersFn } from "@/lib/auth.functions";
import {
  History,
  Search,
  ChevronLeft,
  ChevronRight,
  User2,
  ShoppingCart,
  Wallet,
  CalendarDays,
  ShieldCheck,
  Clock3,
  TrendingUp,
  ExternalLink,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
});

const ACTION_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  create_order:     { label: "Tạo đơn",       color: "bg-blue-50 text-blue-700 border-blue-200",     dot: "bg-blue-400" },
  update_order:     { label: "Sửa đơn",        color: "bg-amber-50 text-amber-700 border-amber-200",   dot: "bg-amber-400" },
  cancel_order:     { label: "Huỷ đơn",        color: "bg-rose-50 text-rose-700 border-rose-200",      dot: "bg-rose-400" },
  delete_order:     { label: "Xóa đơn",        color: "bg-red-50 text-red-700 border-red-200",         dot: "bg-red-400" },
  complete_order:   { label: "HT đơn",         color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
  create_movement:  { label: "Nhập kho",       color: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-400" },
  create_transfer:  { label: "Chuyển kho",     color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-400" },
  confirm_transfer: { label: "XN chuyển kho",  color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-400" },
  create_cash_voucher: { label: "Phiếu thu/chi", color: "bg-teal-50 text-teal-700 border-teal-200",   dot: "bg-teal-400" },
  create_customer:  { label: "Tạo KH",         color: "bg-sky-50 text-sky-700 border-sky-200",         dot: "bg-sky-400" },
  update_customer:  { label: "Sửa KH",         color: "bg-cyan-50 text-cyan-700 border-cyan-200",      dot: "bg-cyan-400" },
  delete_customer:  { label: "Xóa KH",         color: "bg-rose-50 text-rose-700 border-rose-200",      dot: "bg-rose-400" },
  create_product:   { label: "Tạo SP",         color: "bg-lime-50 text-lime-700 border-lime-200",      dot: "bg-lime-400" },
  update_product:   { label: "Sửa SP",         color: "bg-green-50 text-green-700 border-green-200",   dot: "bg-green-400" },
  delete_product:   { label: "Xóa SP",         color: "bg-red-50 text-red-700 border-red-200",         dot: "bg-red-400" },
  login:            { label: "Đăng nhập",      color: "bg-slate-50 text-slate-600 border-slate-200",   dot: "bg-slate-400" },
  register:         { label: "Đăng ký TK",     color: "bg-slate-50 text-slate-700 border-slate-200",   dot: "bg-slate-500" },
  change_password:  { label: "Đổi MK",         color: "bg-gray-50 text-gray-600 border-gray-200",      dot: "bg-gray-400" },
  reset_password:   { label: "Reset MK",       color: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-400" },
  delete_user:      { label: "Xóa tài khoản",  color: "bg-red-50 text-red-700 border-red-200",         dot: "bg-red-500" },
  create_employee:  { label: "Tạo NV",         color: "bg-lime-50 text-lime-700 border-lime-200",      dot: "bg-lime-500" },
  update_employee:  { label: "Sửa NV",         color: "bg-yellow-50 text-yellow-700 border-yellow-200", dot: "bg-yellow-400" },
  delete_employee:  { label: "Xóa NV",         color: "bg-red-50 text-red-700 border-red-200",         dot: "bg-red-400" },
  create_branch:    { label: "Tạo chi nhánh",  color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-400" },
  update_branch:    { label: "Sửa chi nhánh",  color: "bg-blue-50 text-blue-600 border-blue-200",      dot: "bg-blue-300" },
  delete_branch:    { label: "Xóa chi nhánh",  color: "bg-red-50 text-red-700 border-red-200",         dot: "bg-red-400" },
  stock_in:         { label: "Nhập kho",        color: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-400" },
  stock_out:        { label: "Xuất kho",        color: "bg-pink-50 text-pink-700 border-pink-200",      dot: "bg-pink-400" },
  stock_transfer:   { label: "Chuyển kho",      color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-400" },
  cancel_transfer:  { label: "Huỷ chuyển kho", color: "bg-rose-50 text-rose-700 border-rose-200",      dot: "bg-rose-400" },
  approve_schedule: { label: "Duyệt lịch",      color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  create_schedule:  { label: "Tạo lịch",        color: "bg-teal-50 text-teal-700 border-teal-200",     dot: "bg-teal-400" },
  delete_schedule:  { label: "Xóa lịch",        color: "bg-rose-50 text-rose-700 border-rose-200",     dot: "bg-rose-400" },
  update_schedule_status: { label: "Cập nhật lịch", color: "bg-cyan-50 text-cyan-700 border-cyan-200", dot: "bg-cyan-400" },
  customer_payment: { label: "Thu công nợ",     color: "bg-green-50 text-green-700 border-green-200",  dot: "bg-green-500" },
  create_work_type:     { label: "Thêm loại hình CV",  color: "bg-lime-50 text-lime-700 border-lime-200",     dot: "bg-lime-500" },
  update_work_type:     { label: "Sửa loại hình CV",   color: "bg-yellow-50 text-yellow-700 border-yellow-200", dot: "bg-yellow-500" },
  delete_work_type:     { label: "Xóa loại hình CV",   color: "bg-red-50 text-red-700 border-red-200",        dot: "bg-red-500" },
  create_work_difficulty: { label: "Thêm tính chất CV", color: "bg-lime-50 text-lime-700 border-lime-200",     dot: "bg-lime-400" },
  update_work_difficulty: { label: "Sửa tính chất CV",  color: "bg-yellow-50 text-yellow-700 border-yellow-200", dot: "bg-yellow-400" },
  delete_work_difficulty: { label: "Xóa tính chất CV",  color: "bg-red-50 text-red-700 border-red-200",        dot: "bg-red-400" },
};

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function money(v: number) {
  return (v || 0).toLocaleString("vi-VN") + "đ";
}

function normalizeStatus(status?: string) {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done")
    return { label: "Hoàn thành", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (s === "reserved" || s === "pending")
    return { label: "Đang giữ", className: "bg-amber-50 text-amber-700 border-amber-200" };
  if (s === "cancelled" || s === "canceled")
    return { label: "Đã huỷ", className: "bg-rose-50 text-rose-700 border-rose-200" };
  return { label: status || "Đang xử lý", className: "bg-slate-50 text-slate-700 border-slate-200" };
}

// Extract order ID from log detail or meta
function extractOrderId(log: any): string | null {
  if (log.order_id) return log.order_id;
  if (log.meta?.order_id) return log.meta.order_id;
  if (log.ref_id && ["create_order","update_order","cancel_order","delete_order","complete_order"].includes(log.action))
    return log.ref_id;
  return null;
}

const PAGE_SIZE = 50;

function StatCard({ icon: Icon, label, value, accent }: any) {
  return (
    <div className="rounded-2xl border bg-background p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className={`p-1.5 rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function ActivityPage() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  // Debounce ô tìm kiếm: `search` nằm trong queryKey và được gửi LÊN SERVER mỗi
  // lần gõ. Debounce 300ms → mỗi lần ngừng gõ chỉ gọi server 1 lần (thay vì mỗi
  // ký tự 1 lần). Tham số gửi đi vẫn là `search` nên server xử lý y hệt.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  // Về trang 1 đúng khi từ khoá (đã debounce) thực sự đổi → tránh gọi thừa
  // 1 request ở trang cũ với từ khoá cũ.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const listFn = useServerFn(listActivityLogs);
  const employeeDetailFn = useServerFn(getEmployeeDetail);
  const listUsers = useServerFn(listUsersFn);

  const { data, isLoading } = useQuery({
    queryKey: ["activity_logs", page, debouncedSearch],
    queryFn: () => listFn({ data: { page, search: debouncedSearch } }),
    refetchInterval: 30_000, // tự làm mới mỗi 30 giây
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    enabled: isAdmin,
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsers(),
  });

  const employeeQuery = useQuery({
    queryKey: ["employee_activity_detail", selectedEmployee?.employee_id],
    queryFn: () => employeeDetailFn({ data: { id: selectedEmployee.employee_id } }),
    enabled: !!selectedEmployee?.employee_id,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const employeeOrders = employeeQuery.data?.orders ?? [];

  function getEmployeeName(log: any) {
    if (!log?.employee_id) return "—";
    const found = users?.find((u: any) => u.id === log.employee_id);
    return found?.full_name || log?.full_name || log?.employee_name || log?.username || "—";
  }

  const employeeStats = useMemo(() => {
    return employeeOrders.reduce(
      (acc: any, order: any) => {
        acc.totalOrders += 1;
        acc.totalRevenue += Number(order.total || 0);
        acc.totalPaid += Number(order.paid || 0);
        if (order.status === "completed" || order.status === "done") acc.completed += 1;
        return acc;
      },
      { totalOrders: 0, totalRevenue: 0, totalPaid: 0, completed: 0 }
    );
  }, [employeeOrders]);

  if (!isAdmin) {
    return (
      <AppShell title="Lịch sử thao tác">
        <div className="flex flex-col items-center justify-center h-60 gap-3 text-muted-foreground">
          <History className="h-12 w-12 opacity-30" />
          <p>Bạn không có quyền xem trang này.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Lịch sử thao tác" loading={isLoading && !data}>
      {/* Search Bar */}
      <div className="mb-5 flex items-center gap-3 rounded-2xl border bg-background px-4 py-3 shadow-sm">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 bg-muted/30 border-0 focus-visible:ring-1 rounded-xl"
            placeholder="Tìm theo hành động, chi tiết..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-xl">
          <History className="h-4 w-4" />
          <span className="font-medium">{total.toLocaleString("vi-VN")}</span>
          <span>bản ghi</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden border bg-background shadow-sm">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-muted/40 border-b text-left">
            <tr>
              <th className="py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Thời gian</th>
              <th className="px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nhân viên</th>
              <th className="px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hành động</th>
              <th className="px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-16 text-center text-muted-foreground">
                  {isLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <History className="h-10 w-10 opacity-20" />
                      <span>Chưa có dữ liệu</span>
                    </div>
                  )}
                </td>
              </tr>
            )}

            {logs.map((log: any) => {
              const meta = ACTION_CONFIG[log.action] ?? {
                label: log.action,
                color: "bg-slate-100 text-slate-700 border-slate-200",
                dot: "bg-slate-400",
              };
              const orderId = extractOrderId(log);
              const isOrderAction = ["create_order","update_order","cancel_order","delete_order","complete_order"].includes(log.action);

              return (
                <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors group">
                  <td className="py-3.5 px-5 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground font-mono">{fmtDate(log.created_at)}</span>
                  </td>

                  <td className="px-5">
                    {log.employee_id ? (
                      <button
                        onClick={() => setSelectedEmployee(log)}
                        className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline text-left group-hover:text-primary/80 transition-colors"
                      >
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                          {getEmployeeName(log)?.[0]?.toUpperCase() || "?"}
                        </div>
                        {getEmployeeName(log)}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="px-5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${meta.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </td>

                  <td className="px-5 max-w-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground truncate text-xs" title={log.detail ?? ""}>
                        {log.detail ?? "—"}
                      </span>
                      {isOrderAction && orderId && (
                        <Link
                          to="/orders/$id"
                          params={{ id: orderId }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Xem đơn
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border bg-background hover:bg-muted/40 disabled:opacity-40 text-sm font-medium transition-colors"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Trước
          </button>
          <span className="text-sm text-muted-foreground px-2">
            Trang <span className="font-semibold text-foreground">{page}</span> / {totalPages}
          </span>
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border bg-background hover:bg-muted/40 disabled:opacity-40 text-sm font-medium transition-colors"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Employee Detail Dialog */}
      <Dialog
        open={!!selectedEmployee}
        onOpenChange={(v) => { if (!v) setSelectedEmployee(null); }}
      >
        <DialogContent className="          h-[100dvh]
          w-[100vw]
          max-w-none
          overflow-hidden
          border-0
          bg-[#f4f6f8]
          p-0
          dark:bg-background
          sm:h-[96vh]
          sm:w-[98vw]
          sm:max-w-[1600px]
          sm:rounded-2xl">
          {/* Header */}
          <div className="flex items-start justify-between px-7 py-5 border-b bg-gradient-to-r from-primary/5 to-background shrink-0">
            <DialogHeader className="space-y-1">
              <DialogTitle className="flex items-center gap-3 text-xl font-bold text-foreground">
                <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
                  {getEmployeeName(selectedEmployee)?.[0]?.toUpperCase() || "?"}
                </div>
                <div>
                  <div>{getEmployeeName(selectedEmployee)}</div>
                  <div className="text-sm font-normal text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Thống kê đơn hàng và doanh thu
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-7">
            {employeeQuery.isLoading ? (
              <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Đang tải dữ liệu nhân viên...</span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    icon={ShoppingCart}
                    label="Tổng đơn"
                    value={employeeStats.totalOrders}
                    accent="bg-blue-100 text-blue-600"
                  />
                  <StatCard
                    icon={TrendingUp}
                    label="Doanh thu"
                    value={money(employeeStats.totalRevenue)}
                    accent="bg-emerald-100 text-emerald-600"
                  />
                  <StatCard
                    icon={Wallet}
                    label="Đã thanh toán"
                    value={money(employeeStats.totalPaid)}
                    accent="bg-violet-100 text-violet-600"
                  />
                  <StatCard
                    icon={ShieldCheck}
                    label="Hoàn thành"
                    value={employeeStats.completed}
                    accent="bg-amber-100 text-amber-600"
                  />
                </div>

                {/* Orders Table */}
                <div className="rounded-2xl border overflow-hidden bg-background shadow-sm">
                  <div className="px-6 py-4 border-b bg-muted/30 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-base">Đơn hàng đã xử lý</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {employeeOrders.length} đơn hàng gắn với nhân viên này
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-semibold">
                      {employeeOrders.length} đơn
                    </Badge>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-6 py-3 font-semibold text-xs uppercase tracking-wide">Mã đơn</th>
                          <th className="text-left px-6 py-3 font-semibold text-xs uppercase tracking-wide">Ngày tạo</th>
                          <th className="text-left px-6 py-3 font-semibold text-xs uppercase tracking-wide">Trạng thái</th>
                          <th className="text-right px-6 py-3 font-semibold text-xs uppercase tracking-wide">Tổng tiền</th>
                          <th className="text-right px-6 py-3 font-semibold text-xs uppercase tracking-wide">Đã TT</th>
                          <th className="px-6 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeOrders.length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-14 text-center text-muted-foreground">
                              <ShoppingCart className="h-10 w-10 opacity-20 mx-auto mb-2" />
                              Nhân viên này chưa có đơn hàng
                            </td>
                          </tr>
                        )}
                        {employeeOrders.map((order: any) => {
                          const status = normalizeStatus(order.status);
                          return (
                            <tr key={order.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors group/row">
                              <td className="px-6 py-3.5">
                                <Link
                                  to="/orders/$id"
                                  params={{ id: order.id }}
                                  className="font-semibold text-primary hover:underline"
                                >
                                  {order.code || order.id}
                                </Link>
                              </td>
                              <td className="px-6 py-3.5 whitespace-nowrap text-muted-foreground text-xs">
                                <div className="flex items-center gap-1.5">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                  {fmtDate(order.created_at)}
                                </div>
                              </td>
                              <td className="px-6 py-3.5">
                                <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}>
                                  {status.label}
                                </Badge>
                              </td>
                              <td className="px-6 py-3.5 text-right font-semibold tabular-nums">
                                {money(order.total)}
                              </td>
                              <td className="px-6 py-3.5 text-right font-medium tabular-nums text-muted-foreground">
                                {money(order.paid)}
                              </td>
                              <td className="px-6 py-3.5">
                                <Link
                                  to="/orders/$id"
                                  params={{ id: order.id }}
                                  className="opacity-0 group-hover/row:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Mở
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
