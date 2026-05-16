import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listSchedules, createSchedule, approveSchedule,
  updateScheduleStatus, deleteSchedule,
  listWorkDifficulties, upsertWorkDifficulty, deleteWorkDifficulty,
} from "@/lib/schedule.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card } from "@/components/AppShell";
import { fmtMoney, SCHEDULE_TYPES, ALL_PERMISSIONS, type Permission } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarDays, Plus, CheckCircle2, Clock, Trash2,
  Wrench, ShieldOff, Settings, Pencil, Receipt, ExternalLink, UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { hasPermission } from "@/lib/types";
import { Link } from "@tanstack/react-router";
import { SearchFilter } from "@/components/SearchFilter";
import { Pagination } from "@/components/Pagination";

export const Route = createFileRoute("/schedule")({
  head: () => ({ meta: [{ title: "Lịch làm việc — QuatTran POS" }] }),
  component: Page,
});

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Chờ duyệt",    color: "bg-yellow-100 text-yellow-700" },
  approved:    { label: "Đã duyệt",     color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "Đang làm",     color: "bg-orange-100 text-orange-700" },
  done:        { label: "Hoàn thành",   color: "bg-green-100 text-green-700" },
  cancelled:   { label: "Đã hủy",       color: "bg-gray-100 text-gray-700" },
};

// Format ngày thành nhóm theo tuần
function groupByDate(schedules: any[]) {
  const map: Record<string, any[]> = {};

  for (const s of schedules) {
    const d = s.scheduled_date?.slice(0, 10) ?? "unknown";
    if (!map[d]) map[d] = [];
    map[d].push(s);
  }

  return Object.entries(map)
    .sort(([a], [b]) => b.localeCompare(a)) // ngày mới nhất lên trước
    .map(([date, items]) => [
      date,
      [...items].sort((a: any, b: any) => {
        const da = `${a.scheduled_date ?? ""} ${a.scheduled_time ?? "00:00"}`;
        const db = `${b.scheduled_date ?? ""} ${b.scheduled_time ?? "00:00"}`;
        return db.localeCompare(da); // trong ngày cũng sort mới nhất trước
      }),
    ] as [string, any[]]);
}

function Page() {
  const { user, isAdmin } = useAuth();
  const listFn    = useServerFn(listSchedules);
  const createFn  = useServerFn(createSchedule);
  const approveFn = useServerFn(approveSchedule);
  const statusFn  = useServerFn(updateScheduleStatus);
  const deleteFn  = useServerFn(deleteSchedule);
  const listDiff  = useServerFn(listWorkDifficulties);
  const upsertDiff= useServerFn(upsertWorkDifficulty);
  const deleteDiff= useServerFn(deleteWorkDifficulty);
  const qc = useQueryClient();

  const canCreate  = isAdmin || (!!user && hasPermission(user, "create_schedule"));
  const canApprove = isAdmin || (!!user && hasPermission(user, "approve_schedule"));
  const isTech     = !isAdmin && !!user && hasPermission(user, "technician");

  const { data } = useQuery({ queryKey: ["schedules"], queryFn: () => listFn() });
  const { data: diffData } = useQuery({ queryKey: ["work-difficulties"], queryFn: () => listDiff() });

  const [tab, setTab] = useState<"calendar" | "list" | "difficulties">("list");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType]     = useState("");
  const [filterDate, setFilterDate]     = useState(new Date().toISOString().slice(0, 10)); // mặc định hôm nay

  // Search / sort / pagination cho tab Danh sách
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "title">("newest");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5);

  // ── Dialog tạo lịch ───────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "", type: "install", scheduled_date: todayStr,
    scheduled_time: nowTimeStr, customer_id: "", branch_id: "",
    order_id: "",
    address: "", note: "",
  });

  // Khi chọn đơn → auto-fill khách hàng / chi nhánh / địa chỉ + tiêu đề gợi ý
  function pickOrder(orderId: string) {
    const order: any = (data?.orders ?? []).find((o: any) => o.id === orderId);
    if (!order) {
      setCreateForm((f) => ({ ...f, order_id: "" }));
      return;
    }
    const cust: any = (data?.customers ?? []).find((c: any) => c.id === order.customer_id);
    const addrParts = cust ? [cust.address, cust.ward, cust.district, cust.province].filter(Boolean) : [];
    setCreateForm((f) => ({
      ...f,
      order_id: orderId,
      customer_id: order.customer_id || f.customer_id,
      branch_id: order.branch_id || f.branch_id,
      address: addrParts.join(", ") || f.address,
      title: f.title || `Lắp đặt - ${order.code}${cust ? ` - ${cust.name}` : ""}`,
    }));
  }

  // ── Dialog duyệt lịch ─────────────────────────────────────
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [assignedUsers, setAssignedUsers] = useState<string[]>([]);
  const [assignedDiffs, setAssignedDiffs] = useState<string[]>([]);
  const [techFees, setTechFees] = useState<{ product_id: string; qty: number; unit_fee: number }[]>([]);

  // ── Dialog tính chất CV ────────────────────────────────────
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffForm, setDiffForm] = useState<{ id?: string; name: string; description: string; bonus: string }>({
    name: "", description: "", bonus: "0",
  });

  // Filter + nhóm lịch
  const mySchedules = useMemo(() => {
    let list = data?.schedules ?? [];
    if (isTech && user) {
      const myIds = new Set(
        (data?.assignments ?? []).filter((a: any) => a.user_id === user.id).map((a: any) => a.schedule_id),
      );
      list = list.filter((s: any) => myIds.has(s.id));
    }
    if (filterStatus) list = list.filter((s: any) => s.status === filterStatus);
    if (filterType) list = list.filter((s: any) => s.type === filterType);
    if (filterDate) list = list.filter((s: any) => (s.scheduled_date ?? "").slice(0, 10) === filterDate);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s: any) => {
        const cust = (data?.customers ?? []).find((c: any) => c.id === s.customer_id);
        return (
          s.title?.toLowerCase().includes(q) ||
          cust?.name?.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q)
        );
      });
    }
    list = [...list].sort((a: any, b: any) => {
      if (sortBy === "title") return (a.title ?? "").localeCompare(b.title ?? "");
      const da = `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`;
      const db = `${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`;
      return sortBy === "oldest" ? da.localeCompare(db) : db.localeCompare(da);
    });
    return list;
  }, [data, isTech, user, filterStatus, filterType, filterDate, search, sortBy]);

  const pagedSchedules = useMemo(
    () => mySchedules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [mySchedules, page],
  );

  const grouped = useMemo(() => groupByDate(mySchedules), [mySchedules]);

  // Tính tiền công cho 1 lịch
  function calcTechPay(scheduleId: string): number {
    const fees = (data?.tech_fees ?? []).filter((f: any) => f.schedule_id === scheduleId);
    const diffIds = (data?.difficulties ?? []).filter((d: any) => d.schedule_id === scheduleId).map((d: any) => d.difficulty_id);
    const bonusTotal = diffIds.reduce((sum: number, did: string) => {
      const wdiff = (data?.work_difficulties ?? []).find((w: any) => w.id === did);
      return sum + (wdiff?.bonus ?? 0);
    }, 0);
    const feeTotal = fees.reduce((sum: number, f: any) => sum + f.qty * f.unit_fee, 0);
    return feeTotal + bonusTotal;
  }

  async function handleCreate() {
    if (!createForm.title || !createForm.scheduled_date) return toast.error("Vui lòng điền tiêu đề và ngày");
    if (!user) return;
    try {
      await createFn({ data: { ...createForm, created_by: user.id,
        customer_id: createForm.customer_id || undefined,
        branch_id: createForm.branch_id || undefined,
        order_id: createForm.order_id || undefined,
      }});
      toast.success("Đã tạo lịch" + (createForm.order_id ? " (đã liên kết đơn hàng)" : ""));
      setCreateOpen(false);
      setCreateForm({
        title: "", type: "install", scheduled_date: todayStr,
        scheduled_time: nowTimeStr, customer_id: "", branch_id: "",
        order_id: "", address: "", note: "",
      });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  function openApprove(s: any) {
    setApproveTarget(s);
    const existing = (data?.assignments ?? []).filter((a: any) => a.schedule_id === s.id).map((a: any) => a.user_id);
    const existingDiffs = (data?.difficulties ?? []).filter((d: any) => d.schedule_id === s.id).map((d: any) => d.difficulty_id);
    const existingFees = (data?.tech_fees ?? []).filter((f: any) => f.schedule_id === s.id);
    setAssignedUsers(existing);
    setAssignedDiffs(existingDiffs);
    setTechFees(existingFees.length > 0 ? existingFees : [{ product_id: data?.products[0]?.id ?? "", qty: 1, unit_fee: data?.products[0]?.tech_fee ?? 0 }]);
    setApproveOpen(true);
  }

  async function handleApprove() {
    if (!approveTarget) return;
    try {
      await approveFn({ data: {
        schedule_id: approveTarget.id,
        user_ids: assignedUsers,
        difficulty_ids: assignedDiffs,
        tech_fees: techFees,
      }});
      toast.success("Đã duyệt và phân công");
      setApproveOpen(false);
      qc.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  async function handleStatus(id: string, status: string) {
    await statusFn({ data: { id, status } });
    qc.invalidateQueries({ queryKey: ["schedules"] });
    toast.success("Đã cập nhật trạng thái");
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa lịch này?")) return;
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["schedules"] });
    toast.success("Đã xóa");
  }

  async function handleSaveDiff() {
    try {
      await upsertDiff({ data: { ...diffForm, bonus: Number(diffForm.bonus) || 0 } });
      toast.success("Đã lưu");
      setDiffOpen(false);
      setDiffForm({ name: "", description: "", bonus: "0" });
      qc.invalidateQueries({ queryKey: ["work-difficulties"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  if (!canCreate && !canApprove && !isTech && !isAdmin) {
    return (
      <AppShell title="Lịch làm việc">
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <ShieldOff className="h-16 w-16 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Bạn không có quyền truy cập trang này.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Lịch làm việc">
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <TabsList>
            <TabsTrigger value="list">Danh sách</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays className="h-4 w-4 mr-1" />Thời khóa biểu</TabsTrigger>
            {isAdmin && <TabsTrigger value="difficulties"><Settings className="h-4 w-4 mr-1" />Tính chất CV</TabsTrigger>}
          </TabsList>
          <div className="ml-auto flex flex-wrap gap-2">
            {/* Lọc theo ngày — mặc định hôm nay */}
            <input
              type="date"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
            <select className="h-9 rounded-md border bg-background px-2 text-sm"
              value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">Tất cả trạng thái</option>
              {Object.entries(STATUS_LABELS).map(([v, {label}]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm"
              value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">Tất cả loại</option>
              {SCHEDULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Tạo lịch
              </Button>
            )}
          </div>
        </div>

        {/* ── Thời khóa biểu ── */}
        <TabsContent value="calendar">
          {grouped.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">Không có lịch nào</div>
          )}
          <div className="space-y-6">
            {grouped.map(([date, schedules]) => (
              <div key={date}>
                <div className="flex items-center gap-2 mb-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <span className="font-semibold">
                    {new Date(date).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
                  </span>
                  <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">{schedules.length} lịch</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {schedules.map((s: any) => {
                    const typeInfo = SCHEDULE_TYPES.find((t) => t.value === s.type);
                    const status = STATUS_LABELS[s.status];
                    const assignees = (data?.assignments ?? []).filter((a: any) => a.schedule_id === s.id);
                    const techPay = isTech ? calcTechPay(s.id) : null;
                    const customer = data?.customers.find((c: any) => c.id === s.customer_id);
                    const linkedOrder: any = s.order_id
                      ? (data?.orders ?? []).find((o: any) => o.id === s.order_id)
                      : null;

                    return (
                      <Card key={s.id} className="relative">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{s.title}</div>
                            {s.scheduled_time && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {s.scheduled_time}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 items-end shrink-0">
                            <span className={`text-xs rounded-full px-2 py-0.5 ${typeInfo?.color}`}>{typeInfo?.label}</span>
                            <span className={`text-xs rounded-full px-2 py-0.5 ${status?.color}`}>{status?.label}</span>
                          </div>
                        </div>

                        {linkedOrder && (
                          <Link
                            to="/orders/$id"
                            params={{ id: linkedOrder.id }}
                            className="mb-2 inline-flex items-center gap-1 text-xs rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 hover:bg-blue-100"
                            title="Xem chi tiết đơn hàng"
                          >
                            <Receipt className="h-3 w-3" />
                            <span className="font-mono font-medium">{linkedOrder.code}</span>
                            <span>· {fmtMoney(linkedOrder.total)}</span>
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </Link>
                        )}

                        {customer && <div className="text-xs text-muted-foreground mb-1">👤 {customer.name}</div>}
                        {s.address && <div className="text-xs text-muted-foreground mb-1">📍 {s.address}</div>}

                        {/* Người phụ trách */}
                        {assignees.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {assignees.map((a: any) => {
                              const u = data?.users.find((u: any) => u.id === a.user_id);
                              return <span key={a.user_id} className="text-xs bg-muted rounded-full px-2 py-0.5">{u?.full_name ?? a.user_id}</span>;
                            })}
                          </div>
                        )}

                        {/* Tiền công (chỉ kỹ thuật viên) */}
                        {isTech && techPay !== null && techPay > 0 && (
                          <div className="text-sm font-semibold text-green-600 mb-2">
                            💰 Tiền công: {fmtMoney(techPay)}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-1 flex-wrap mt-2">
                          {canApprove && s.status === "pending" && (
                            <Button size="sm" variant="outline" onClick={() => openApprove(s)}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Duyệt
                            </Button>
                          )}
                          {canApprove && s.status === "approved" && (
                            <Button size="sm" variant="outline" onClick={() => handleStatus(s.id, "in_progress")}>
                              Bắt đầu
                            </Button>
                          )}
                          {(canApprove || isTech) && s.status === "in_progress" && (
                            <Button size="sm" variant="outline" onClick={() => handleStatus(s.id, "done")}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Hoàn thành
                            </Button>
                          )}
                          {canApprove && s.status === "approved" && (
                            <Button size="sm" variant="outline" onClick={() => openApprove(s)}>
                              <Pencil className="h-3 w-3 mr-1" /> Sửa
                            </Button>
                          )}
                          {(isAdmin || canCreate) && !["done","cancelled"].includes(s.status) && (
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Danh sách ── */}
        <TabsContent value="list">
          <SearchFilter
            search={search}
            onSearch={(v) => { setSearch(v); setPage(1); }}
            placeholder="Tìm tiêu đề / khách / địa chỉ…"
            sortOptions={[
              { value: "newest", label: "Mới nhất" },
              { value: "oldest", label: "Cũ nhất" },
              { value: "title", label: "Tiêu đề A–Z" },
            ]}
            sortValue={sortBy}
            onSort={(v) => { setSortBy(v as any); setPage(1); }}
            total={mySchedules.length}
            totalLabel="lịch"
          />
          <Card>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Tiêu đề</th>
                    <th className="pr-3">Loại</th>
                    <th className="pr-3">Ngày</th>
                    <th className="pr-3">Khách hàng</th>
                    <th className="pr-3">Phụ trách</th>
                    <th className="pr-3">Trạng thái</th>
                    {isTech && <th className="pr-3">Tiền công</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSchedules.map((s: any) => {
                    const typeInfo = SCHEDULE_TYPES.find((t) => t.value === s.type);
                    const status = STATUS_LABELS[s.status];
                    const assignees = (data?.assignments ?? []).filter((a: any) => a.schedule_id === s.id);
                    const customer = data?.customers.find((c: any) => c.id === s.customer_id);
                    const techPay = isTech ? calcTechPay(s.id) : null;
                    return (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3 font-medium">{s.title}</td>
                        <td className="pr-3"><span className={`text-xs rounded-full px-2 py-0.5 ${typeInfo?.color}`}>{typeInfo?.label}</span></td>
                        <td className="pr-3 text-xs">{s.scheduled_date?.slice(0,10)} {s.scheduled_time}</td>
                        <td className="pr-3 text-muted-foreground">{customer?.name ?? "—"}</td>
                        <td className="pr-3">
                          <div className="flex flex-wrap gap-1">
                            {assignees.map((a: any) => {
                              const u = data?.users.find((u: any) => u.id === a.user_id);
                              return <span key={a.user_id} className="text-xs bg-muted rounded-full px-2 py-0.5">{u?.full_name ?? "?"}</span>;
                            })}
                            {assignees.length === 0 && <span className="text-xs text-muted-foreground">Chưa phân công</span>}
                          </div>
                        </td>
                        <td className="pr-3"><span className={`text-xs rounded-full px-2 py-0.5 ${status?.color}`}>{status?.label}</span></td>
                        {isTech && <td className="pr-3 text-green-600 font-medium text-sm">{techPay ? fmtMoney(techPay) : "—"}</td>}
                        <td>
                          {canApprove && s.status === "pending" && (
                            <Button size="sm" variant="outline" onClick={() => openApprove(s)}>Duyệt</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {mySchedules.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Không có lịch nào</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={mySchedules.length}
            onPageChange={setPage}
            label="lịch"
          />
        </TabsContent>

        {/* ── Tính chất công việc (admin only) ── */}
        {isAdmin && (
          <TabsContent value="difficulties">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="font-medium">Tính chất công việc</div>
                <Button size="sm" onClick={() => { setDiffForm({ name: "", description: "", bonus: "0" }); setDiffOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2 pr-3">Tên</th><th className="pr-3">Mô tả</th><th className="text-right pr-3">Tiền thêm</th><th></th></tr>
                </thead>
                <tbody>
                  {(diffData as any[] ?? []).map((d: any) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">{d.name}</td>
                      <td className="pr-3 text-muted-foreground">{d.description ?? "—"}</td>
                      <td className="text-right pr-3 text-green-600 font-medium">+{fmtMoney(d.bonus)}</td>
                      <td className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => {
                          setDiffForm({ id: d.id, name: d.name, description: d.description ?? "", bonus: String(d.bonus) });
                          setDiffOpen(true);
                        }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={async () => {
                          await deleteWorkDifficulty({ data: { id: d.id } });
                          qc.invalidateQueries({ queryKey: ["work-difficulties"] });
                        }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Dialog tạo lịch ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tạo lịch làm việc</DialogTitle></DialogHeader>
          {/* Đơn hàng liên kết — chọn trước để auto-fill */}
          {/* Người bán đơn hàng được liên kết (nếu có), fallback về người đăng nhập */}
          {(() => {
            const linkedOrder: any = createForm.order_id
              ? (data?.orders ?? []).find((o: any) => o.id === createForm.order_id)
              : null;
            const seller: any = linkedOrder?.employee_id
              ? (data?.employees ?? []).find((e: any) => e.id === linkedOrder.employee_id)
              : null;
            const displayName = seller?.name ?? user?.full_name ?? "—";
            const displayLabel = seller ? "Người bán đơn hàng" : "Người tạo lịch";
            return (
              <div className="mb-3 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                <UserCog className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{displayLabel}:</span>
                <span className="font-medium">{displayName}</span>
                {seller && (
                  <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    Auto từ đơn
                  </span>
                )}
              </div>
            );
          })()}
          <div className="mb-3 rounded-md border bg-blue-50/50 p-3">
            <Label className="flex items-center gap-1 text-blue-900">
              <Receipt className="h-4 w-4" /> Liên kết với đơn hàng (tuỳ chọn)
            </Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={createForm.order_id}
              onChange={(e) => pickOrder(e.target.value)}
            >
              <option value="">— Không liên kết —</option>
              {(data?.orders ?? []).map((o: any) => {
                const c: any = (data?.customers ?? []).find((x: any) => x.id === o.customer_id);
                return (
                  <option key={o.id} value={o.id}>
                    {o.code} · {c?.name ?? "Khách lẻ"} · {fmtMoney(o.total)} ({o.status})
                  </option>
                );
              })}
            </select>
            <div className="text-xs text-muted-foreground mt-1">
              Khi chọn đơn, khách hàng / chi nhánh / địa chỉ sẽ tự điền.
            </div>
          </div>
          <div className="space-y-3">
            <div><Label>Tiêu đề *</Label>
              <Input className="mt-1" value={createForm.title}
                onChange={(e) => setCreateForm({...createForm, title: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Loại công việc</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={createForm.type} onChange={(e) => setCreateForm({...createForm, type: e.target.value})}>
                  {SCHEDULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></div>
              <div><Label>Ngày *</Label>
                <Input className="mt-1" type="date" value={createForm.scheduled_date}
                  onChange={(e) => setCreateForm({...createForm, scheduled_date: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Giờ</Label>
                <Input className="mt-1" type="time" value={createForm.scheduled_time}
                  onChange={(e) => setCreateForm({...createForm, scheduled_time: e.target.value})} /></div>
              <div><Label>Chi nhánh</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={createForm.branch_id} onChange={(e) => setCreateForm({...createForm, branch_id: e.target.value})}>
                  <option value="">-- Chọn --</option>
                  {data?.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            </div>
            <div><Label>Khách hàng</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={createForm.customer_id} onChange={(e) => setCreateForm({...createForm, customer_id: e.target.value})}>
                <option value="">-- Chọn --</option>
                {data?.customers.map((c: any) => <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>)}
              </select></div>
            <div><Label>Địa chỉ lắp đặt</Label>
              <Input className="mt-1" value={createForm.address}
                onChange={(e) => setCreateForm({...createForm, address: e.target.value})} /></div>
            <div><Label>Ghi chú</Label>
              <Input className="mt-1" value={createForm.note}
                onChange={(e) => setCreateForm({...createForm, note: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button onClick={handleCreate}>Tạo lịch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog duyệt lịch ── */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Duyệt lịch & Phân công</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Phân công người */}
            <div>
              <Label className="font-medium">Phân công nhân viên</Label>
              <div className="mt-2 border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
                {(data?.users ?? []).map((u: any) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={assignedUsers.includes(u.id)}
                      onChange={() => setAssignedUsers((p) => p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id])}
                    /> {u.full_name}
                  </label>
                ))}
              </div>
            </div>

            {/* Tính chất công việc */}
            <div>
              <Label className="font-medium">Tính chất công việc</Label>
              <div className="mt-2 border rounded-md p-2 space-y-1">
                {(data?.work_difficulties ?? []).map((d: any) => (
                  <label key={d.id} className="flex items-center justify-between text-sm cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input type="checkbox"
                        checked={assignedDiffs.includes(d.id)}
                        onChange={() => setAssignedDiffs((p) => p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id])}
                      /> {d.name}
                    </div>
                    <span className="text-green-600 font-medium">+{fmtMoney(d.bonus)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Sản phẩm lắp + tiền công */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Sản phẩm & tiền công</Label>
                <Button size="sm" variant="outline"
                  onClick={() => setTechFees([...techFees, { product_id: data?.products[0]?.id ?? "", qty: 1, unit_fee: data?.products[0]?.tech_fee ?? 0 }])}>
                  <Plus className="h-3 w-3 mr-1" /> Thêm SP
                </Button>
              </div>
              {techFees.map((tf, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 mb-2">
                  <select className="col-span-6 h-9 rounded-md border bg-background px-2 text-sm"
                    value={tf.product_id}
                    onChange={(e) => {
                      const p = data?.products.find((x: any) => x.id === e.target.value);
                      const next = [...techFees];
                      next[idx] = { ...tf, product_id: e.target.value, unit_fee: p?.tech_fee ?? 0 };
                      setTechFees(next);
                    }}>
                    {data?.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Input type="number" className="col-span-2" placeholder="SL" value={tf.qty}
                    onChange={(e) => { const next = [...techFees]; next[idx].qty = Number(e.target.value); setTechFees(next); }} />
                  <Input type="number" className="col-span-3" placeholder="Tiền/cái" value={tf.unit_fee}
                    onChange={(e) => { const next = [...techFees]; next[idx].unit_fee = Number(e.target.value); setTechFees(next); }} />
                  <button className="col-span-1 hover:text-destructive"
                    onClick={() => setTechFees(techFees.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {/* Tổng tiền công preview */}
              <div className="rounded-md bg-muted/50 p-2 text-sm">
                Tổng tiền công dự kiến: <span className="font-semibold text-green-600">
                  {fmtMoney(
                    techFees.reduce((s, tf) => s + tf.qty * tf.unit_fee, 0) +
                    assignedDiffs.reduce((s, did) => {
                      const d = (data?.work_difficulties ?? []).find((x: any) => x.id === did);
                      return s + (d?.bonus ?? 0);
                    }, 0)
                  )}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Hủy</Button>
            <Button onClick={handleApprove}>Xác nhận duyệt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog tính chất CV ── */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="w-full max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{diffForm.id ? "Sửa" : "Thêm"} tính chất công việc</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Tên *</Label><Input className="mt-1" value={diffForm.name} onChange={(e) => setDiffForm({...diffForm, name: e.target.value})} /></div>
            <div><Label>Mô tả</Label><Input className="mt-1" value={diffForm.description} onChange={(e) => setDiffForm({...diffForm, description: e.target.value})} /></div>
            <div><Label>Tiền thưởng thêm (₫)</Label><Input className="mt-1" type="number" value={diffForm.bonus} onChange={(e) => setDiffForm({...diffForm, bonus: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffOpen(false)}>Hủy</Button>
            <Button onClick={handleSaveDiff}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
