// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create_order: { label: "Tạo đơn", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  update_order: { label: "Sửa đơn", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  cancel_order: { label: "Huỷ đơn", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  delete_order: { label: "Xóa đơn", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  complete_order: { label: "HT đơn", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  create_movement: { label: "Nhập kho", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  create_transfer: { label: "Chuyển kho", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  confirm_transfer: { label: "XN chuyển kho", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  create_cash_voucher: { label: "Phiếu thu/chi", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  create_customer: { label: "Tạo KH", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  update_customer: { label: "Sửa KH", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  delete_customer: { label: "Xóa KH", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  create_product: { label: "Tạo SP", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  update_product: { label: "Sửa SP", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  delete_product: { label: "Xóa SP", color: "bg-slate-100 text-slate-700 border border-slate-200" },
  login: { label: "Đăng nhập", color: "bg-slate-100 text-slate-700 border border-slate-200" },
};

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function money(v: number) {
  return (v || 0).toLocaleString("vi-VN") + "đ";
}

function normalizeStatus(status?: string) {
  const s = String(status || "").toLowerCase();

  if (s === "completed" || s === "done") {
    return {
      label: "Hoàn thành",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }

  if (s === "reserved" || s === "pending") {
    return {
      label: "Đang giữ",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }

  if (s === "cancelled" || s === "canceled") {
    return {
      label: "Đã huỷ",
      className: "bg-rose-50 text-rose-700 border-rose-200",
    };
  }

  return {
    label: status || "Đang xử lý",
    className: "bg-slate-50 text-slate-700 border-slate-200",
  };
}

const PAGE_SIZE = 50;

function ActivityPage() {
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  const listFn = useServerFn(listActivityLogs);
  const employeeDetailFn = useServerFn(getEmployeeDetail);
  const listUsers = useServerFn(listUsersFn);

  const { data, isLoading } = useQuery({
    queryKey: ["activity_logs", page, search],
    queryFn: () =>
      listFn({
        data: { page, search },
      }),
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
    queryFn: () =>
      employeeDetailFn({
        data: { id: selectedEmployee.employee_id },
      }),
    enabled: !!selectedEmployee?.employee_id,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const employeeOrders = employeeQuery.data?.orders ?? [];

  function getEmployeeName(log: any) {
    if (!log?.employee_id) return "—";

    const found = users?.find((u: any) => u.id === log.employee_id);

    return (
      found?.full_name ||
      log?.full_name ||
      log?.employee_name ||
      log?.username ||
      "—"
    );
  }

  const employeeStats = useMemo(() => {
    return employeeOrders.reduce(
      (acc: any, order: any) => {
        acc.totalOrders += 1;
        acc.totalRevenue += Number(order.total || 0);
        acc.totalPaid += Number(order.paid || 0);

        if (order.status === "completed" || order.status === "done") {
          acc.completed += 1;
        }

        return acc;
      },
      {
        totalOrders: 0,
        totalRevenue: 0,
        totalPaid: 0,
        completed: 0,
      }
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
      <div className="mb-4 flex items-center gap-3 rounded-2xl border bg-muted/30 px-4 py-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 bg-background"
            placeholder="Tìm theo hành động, chi tiết..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <span className="text-sm text-muted-foreground">
          {total.toLocaleString("vi-VN")} bản ghi
        </span>
      </div>

      <div className="rounded-2xl overflow-hidden border bg-background shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b text-left">
            <tr>
              <th className="py-3 px-4 text-muted-foreground">Thời gian</th>
              <th className="px-4 text-muted-foreground">Nhân viên</th>
              <th className="px-4 text-muted-foreground">Hành động</th>
              <th className="px-4 text-muted-foreground">Chi tiết</th>
            </tr>
          </thead>

          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-14 text-center text-muted-foreground">
                  {isLoading ? "Đang tải..." : "Chưa có dữ liệu"}
                </td>
              </tr>
            )}

            {logs.map((log: any) => {
              const meta = ACTION_LABELS[log.action] ?? {
                label: log.action,
                color: "bg-slate-100 text-slate-700 border border-slate-200",
              };

              return (
                <tr
                  key={log.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-3 px-4 whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDate(log.created_at)}
                  </td>

                  <td className="px-4">
                    {log.employee_id ? (
                      <button
                        onClick={() => setSelectedEmployee(log)}
                        className="font-semibold text-primary hover:underline text-left"
                      >
                        {getEmployeeName(log)}
                      </button>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                  </td>

                  <td className="px-4">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                  </td>

                  <td
                    className="px-4 text-muted-foreground max-w-xs truncate"
                    title={log.detail ?? ""}
                  >
                    {log.detail ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            className="flex items-center gap-1 px-4 py-2 rounded-xl border bg-background hover:bg-muted/40 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Trước
          </button>

          <span className="text-sm text-muted-foreground">
            Trang {page} / {totalPages}
          </span>

          <button
            className="flex items-center gap-1 px-4 py-2 rounded-xl border bg-background hover:bg-muted/40 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <Dialog
        open={!!selectedEmployee}
        onOpenChange={(v) => {
          if (!v) setSelectedEmployee(null);
        }}
      >
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden rounded-3xl p-0 gap-0">
          <div className="border-b bg-muted/20 px-6 py-5">
            <DialogHeader className="space-y-2">
              <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
                <User2 className="h-5 w-5 text-primary" />
                <span className="truncate">{getEmployeeName(selectedEmployee)}</span>
              </DialogTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Thống kê đơn hàng và doanh thu của nhân viên
              </div>
            </DialogHeader>
          </div>

          <div className="p-6 overflow-y-auto">
            {employeeQuery.isLoading ? (
              <div className="py-12 text-center text-muted-foreground">
                Đang tải dữ liệu nhân viên...
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ShoppingCart className="h-4 w-4" />
                      Tổng đơn
                    </div>
                    <div className="mt-3 text-3xl font-semibold tracking-tight">
                      {employeeStats.totalOrders}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wallet className="h-4 w-4" />
                      Doanh thu
                    </div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight">
                      {money(employeeStats.totalRevenue)}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wallet className="h-4 w-4" />
                      Đã thanh toán
                    </div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight">
                      {money(employeeStats.totalPaid)}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      Hoàn thành
                    </div>
                    <div className="mt-3 text-3xl font-semibold tracking-tight">
                      {employeeStats.completed}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border overflow-hidden bg-background shadow-sm">
                  <div className="px-5 py-4 border-b bg-muted/30">
                    <div className="font-semibold text-base">
                      Đơn hàng nhân viên đã xử lý
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Danh sách đơn hàng gắn với nhân viên này
                    </div>
                  </div>

                  <div className="max-h-[50vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium">Mã đơn</th>
                          <th className="text-left px-5 py-3 font-medium">Ngày tạo</th>
                          <th className="text-left px-5 py-3 font-medium">Trạng thái</th>
                          <th className="text-right px-5 py-3 font-medium">Tổng tiền</th>
                          <th className="text-right px-5 py-3 font-medium">Đã thanh toán</th>
                        </tr>
                      </thead>

                      <tbody>
                        {employeeOrders.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="py-12 text-center text-muted-foreground"
                            >
                              Nhân viên này chưa có đơn hàng
                            </td>
                          </tr>
                        )}

                        {employeeOrders.map((order: any) => {
                          const status = normalizeStatus(order.status);

                          return (
                            <tr
                              key={order.id}
                              className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                            >
                              <td className="px-5 py-3 font-medium">
                                {order.code || order.id}
                              </td>

                              <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  <CalendarDays className="h-4 w-4 shrink-0" />
                                  <span>{fmtDate(order.created_at)}</span>
                                </div>
                              </td>

                              <td className="px-5 py-3">
                                <Badge
                                  variant="outline"
                                  className={`rounded-full px-3 py-1 font-normal ${status.className}`}
                                >
                                  {status.label}
                                </Badge>
                              </td>

                              <td className="px-5 py-3 text-right font-semibold tabular-nums">
                                {money(order.total)}
                              </td>

                              <td className="px-5 py-3 text-right font-medium tabular-nums">
                                {money(order.paid)}
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