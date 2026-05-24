// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { listActivityLogs } from "@/lib/activity.functions";
import { History, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
});

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create_order:       { label: "Tạo đơn",        color: "bg-green-100 text-green-700" },
  update_order:       { label: "Sửa đơn",         color: "bg-yellow-100 text-yellow-700" },
  cancel_order:       { label: "Huỷ đơn",         color: "bg-red-100 text-red-700" },
  delete_order:       { label: "Xóa đơn",         color: "bg-red-100 text-red-700" },
  complete_order:     { label: "HT đơn",          color: "bg-blue-100 text-blue-700" },
  create_movement:    { label: "Nhập kho",        color: "bg-teal-100 text-teal-700" },
  create_transfer:    { label: "Chuyển kho",      color: "bg-indigo-100 text-indigo-700" },
  confirm_transfer:   { label: "XN chuyển kho",   color: "bg-indigo-100 text-indigo-700" },
  create_cash_voucher:{ label: "Phiếu thu/chi",   color: "bg-orange-100 text-orange-700" },
  create_customer:    { label: "Tạo KH",          color: "bg-purple-100 text-purple-700" },
  update_customer:    { label: "Sửa KH",          color: "bg-purple-100 text-purple-700" },
  delete_customer:    { label: "Xóa KH",          color: "bg-red-100 text-red-700" },
  create_product:     { label: "Tạo SP",          color: "bg-cyan-100 text-cyan-700" },
  update_product:     { label: "Sửa SP",          color: "bg-cyan-100 text-cyan-700" },
  delete_product:     { label: "Xóa SP",          color: "bg-red-100 text-red-700" },
  login:              { label: "Đăng nhập",       color: "bg-gray-100 text-gray-600" },
};

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString("vi-VN", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

const PAGE_SIZE = 50;

function ActivityPage() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const listFn = useServerFn(listActivityLogs);

  const { data, isLoading } = useQuery({
    queryKey: ["activity_logs", page, search],
    queryFn: () => listFn({ data: { page, search } }),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    enabled: isAdmin,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Tìm theo hành động, chi tiết..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-sm text-muted-foreground">{total.toLocaleString("vi-VN")} bản ghi</span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40 border-b">
            <tr>
              <th className="py-2 px-3">Thời gian</th>
              <th className="px-3">Nhân viên</th>
              <th className="px-3">Hành động</th>
              <th className="px-3">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-muted-foreground">
                  {isLoading ? "Đang tải..." : "Chưa có dữ liệu"}
                </td>
              </tr>
            )}
            {logs.map((log: any) => {
              const meta = ACTION_LABELS[log.action] ?? { label: log.action, color: "bg-gray-100 text-gray-600" };
              return (
                <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="py-2 px-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(log.created_at)}</td>
                  <td className="px-3 font-medium">{log.employee_name ?? "—"}</td>
                  <td className="px-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  </td>
                  <td className="px-3 text-muted-foreground max-w-xs truncate" title={log.detail ?? ""}>{log.detail ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded border text-sm disabled:opacity-40 hover:bg-muted/40"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          ><ChevronLeft className="h-4 w-4" /> Trước</button>
          <span className="text-sm text-muted-foreground">Trang {page} / {totalPages}</span>
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded border text-sm disabled:opacity-40 hover:bg-muted/40"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >Sau <ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </AppShell>
  );
}
