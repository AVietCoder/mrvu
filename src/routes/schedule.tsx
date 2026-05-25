// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listSchedules, createSchedule, approveSchedule,
  updateScheduleStatus, deleteSchedule,
  listWorkDifficulties, upsertWorkDifficulty, deleteWorkDifficulty,
  listWorkTypes, upsertWorkType, deleteWorkType,
  attendanceSummary,
} from "@/lib/schedule.functions";
import { useAuth } from "@/context/AuthContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import { AppShell, Card } from "@/components/AppShell";
import { fmtMoney, SCHEDULE_TYPES, ALL_PERMISSIONS, type Permission } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarDays, Plus, CheckCircle2, Clock, Trash2,
  Wrench, ShieldOff, Settings, Pencil, Receipt, ExternalLink, UserCog, Loader2, BarChart3, Tag, Eye, X, Copy, Check,
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
  const listWT    = useServerFn(listWorkTypes);
  const upsertWT  = useServerFn(upsertWorkType);
  const deleteWT  = useServerFn(deleteWorkType);
  const attendanceFn = useServerFn(attendanceSummary);
  const qc = useQueryClient();

  const canCreate  = isAdmin || (!!user && hasPermission(user, "create_schedule"));
  const canApprove = isAdmin || (!!user && hasPermission(user, "approve_schedule"));
  const isTech     = !isAdmin && !!user && hasPermission(user, "technician");

  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(false);

  const { data } = useQuery({ queryKey: ["schedules"], queryFn: () => listFn() });
  const { data: diffData } = useQuery({ queryKey: ["work-difficulties"], queryFn: () => listDiff() });
  const { data: wtData } = useQuery({ queryKey: ["work-types"], queryFn: () => listWT() });

  const [tab, setTab] = useState<"calendar" | "list" | "difficulties" | "work-types" | "attendance">("list");
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
    order_id: "", address: "", note: "",
    assigned_by: "", // Người giao việc
    work_type_id: "", // Loại hình CV chọn khi tạo
  });

  // Dialog xem chi tiết lịch
  const [viewSchedule, setViewSchedule] = useState<any>(null);
  const [copied, setCopied] = useState(false);

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

  // ── Dialog loại hình CV ────────────────────────────────────
  const [wtOpen, setWtOpen] = useState(false);
  const [wtForm, setWtForm] = useState<{ id?: string; name: string; description: string; price: string }>({
    name: "", description: "", price: "0",
  });
  // Loại hình CV được chọn khi duyệt (mặc định lấy theo schedule.work_type_id)
  const [workTypeId, setWorkTypeId] = useState<string>("");

  // ── Chấm công ──────────────────────────────────────────────
  const [attFrom, setAttFrom] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [attTo, setAttTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [attDetail, setAttDetail] = useState<any>(null);
  const { data: attData, isLoading: attLoading, refetch: refetchAttendance } = useQuery({
    queryKey: ["attendance", attFrom, attTo],
    queryFn: () => attendanceFn({ data: { date_from: attFrom, date_to: attTo } }),
    enabled: tab === "attendance" && (canApprove || isAdmin || isTech),
  });

  // Filter + nhóm lịch
  const mySchedules = useMemo(() => {
    let list = data?.schedules ?? [];
    // Kỹ thuật viên: chỉ thấy lịch được giao
    if (isTech && !canApprove && user) {
      const myIds = new Set(
        (data?.assignments ?? []).filter((a: any) => a.user_id === user.id).map((a: any) => a.schedule_id),
      );
      list = list.filter((s: any) => myIds.has(s.id));
    } else if (!canApprove && canCreate && user) {
      // Chỉ có quyền tạo lịch: chỉ thấy lịch mình tạo (không phân công được)
      list = list.filter((s: any) => s.created_by === user.id);
    }
    // canApprove (hoặc admin): thấy tất cả lịch — không lọc thêm
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

  // Tính tiền công cho 1 người trong lịch
  function calcTechPay(scheduleId: string): number {
    const fees = (data?.tech_fees ?? []).filter((f: any) => f.schedule_id === scheduleId);
    const diffIds = (data?.difficulties ?? []).filter((d: any) => d.schedule_id === scheduleId).map((d: any) => d.difficulty_id);
    const assignees = (data?.assignments ?? []).filter((a: any) => a.schedule_id === scheduleId);
    const numPeople = Math.max(1, assignees.length);

    // thu nhập (bonus từ tech_fees)
    const bonusTotal = fees.reduce((sum: number, f: any) => sum + f.qty * f.unit_fee, 0);
    // Tính chất CV nhân số người
    const diffBonusPerTask = diffIds.reduce((sum: number, did: string) => {
      const wdiff = (data?.work_difficulties ?? []).find((w: any) => w.id === did);
      return sum + (wdiff?.bonus ?? 0);
    }, 0);
    const diffBonus = diffBonusPerTask * numPeople;
    // Tiền đơn hàng KHÔNG tính vào lương kỹ thuật viên
    const totalPool = bonusTotal + diffBonus;
    return totalPool / numPeople;
  }

  async function handleCreate() {
    if (!createForm.title || !createForm.scheduled_date) return toast.error("Vui lòng điền tiêu đề và ngày");
    if (!user) return;
    setCreating(true);
    try {
      await createFn({ data: { ...createForm, created_by: user.id,
        customer_id: createForm.customer_id || undefined,
        branch_id: createForm.branch_id || undefined,
        order_id: createForm.order_id || undefined,
        assigned_by: createForm.assigned_by || undefined,
        work_type_id: createForm.work_type_id || undefined,
      }});
      toast.success("Đã tạo lịch" + (createForm.order_id ? " (đã liên kết đơn hàng)" : ""));
      setCreateOpen(false);
      setCreateForm({
        title: "", type: "install", scheduled_date: todayStr,
        scheduled_time: nowTimeStr, customer_id: "", branch_id: "",
        order_id: "", address: "", note: "", assigned_by: "", work_type_id: "",
      });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
    finally { setCreating(false); }
  }

  function openApprove(s: any) {
    setApproveTarget(s);
    const existing = (data?.assignments ?? []).filter((a: any) => a.schedule_id === s.id).map((a: any) => a.user_id);
    const existingDiffs = (data?.difficulties ?? []).filter((d: any) => d.schedule_id === s.id).map((d: any) => d.difficulty_id);
    const existingFees = (data?.tech_fees ?? []).filter((f: any) => f.schedule_id === s.id);
    setAssignedUsers(existing);
    setAssignedDiffs(existingDiffs);
    setTechFees(existingFees.length > 0 ? existingFees : []);
    setWorkTypeId(s.work_type_id || "");
    setApproveOpen(true);
  }

  async function handleApprove() {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await approveFn({ data: {
        schedule_id: approveTarget.id,
        user_ids: assignedUsers,
        difficulty_ids: assignedDiffs,
        tech_fees: techFees,
        work_type_id: workTypeId || null,
        actor_id: user?.id,
      }});
      toast.success("Đã duyệt và phân công");
      setApproveOpen(false);
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
    finally { setApproving(false); }
  }

  async function handleStatus(id: string, status: string) {
    await statusFn({ data: { id, status, actor_id: user?.id } });
    qc.invalidateQueries({ queryKey: ["schedules"] });
    qc.invalidateQueries({ queryKey: ["attendance"] });
    toast.success("Đã cập nhật trạng thái");
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa lịch này?")) return;
    await deleteFn({ data: { id, actor_id: user?.id } });
    qc.invalidateQueries({ queryKey: ["schedules"] });
    qc.invalidateQueries({ queryKey: ["attendance"] });
    toast.success("Đã xóa");
  }

  async function handleSaveDiff() {
    try {
      await upsertDiff({ data: { ...diffForm, bonus: Number(diffForm.bonus) || 0, actor_id: user?.id } });
      toast.success("Đã lưu");
      setDiffOpen(false);
      setDiffForm({ name: "", description: "", bonus: "0" });
      qc.invalidateQueries({ queryKey: ["work-difficulties"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  async function handleSaveWT() {
    if (!wtForm.name.trim()) return toast.error("Nhập tên loại hình");
    try {
      await upsertWT({ data: { ...wtForm, price: Number(wtForm.price) || 0, actor_id: user?.id } });
      toast.success("Đã lưu loại hình");
      setWtOpen(false);
      setWtForm({ name: "", description: "", price: "0" });
      qc.invalidateQueries({ queryKey: ["work-types"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  async function handleDeleteWT(id: string) {
    if (!confirm("Xóa loại hình này?")) return;
    await deleteWT({ data: { id, actor_id: user?.id } });
    qc.invalidateQueries({ queryKey: ["work-types"] });
  }

  async function handleDeleteDiff(id: string) {
    if (!confirm("Xóa tính chất này?")) return;
    await deleteDiff({ data: { id, actor_id: user?.id } });
    qc.invalidateQueries({ queryKey: ["work-difficulties"] });
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
            {(canApprove || isAdmin || isTech) && <TabsTrigger value="attendance"><BarChart3 className="h-4 w-4 mr-1" />Chấm công</TabsTrigger>}
            {isAdmin && <TabsTrigger value="work-types"><Tag className="h-4 w-4 mr-1" />Loại hình CV</TabsTrigger>}
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
                            className="mb-2 flex items-center gap-1.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1.5 hover:bg-blue-100 transition-colors"
                            title="Xem chi tiết đơn hàng"
                          >
                            <Receipt className="h-3.5 w-3.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-mono font-semibold">{linkedOrder.code}</div>
                              <div className="text-xs opacity-80">{fmtMoney(linkedOrder.total)} · {linkedOrder.status === "completed" ? "Hoàn tất" : linkedOrder.status === "reserved" ? "Đặt hàng" : linkedOrder.status}</div>
                            </div>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </Link>
                        )}

                        {customer && (canApprove || isAdmin) && <div className="text-xs text-muted-foreground mb-1">👤 {customer.name}</div>}
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

                        {/* Người giao việc */}
                        {s.assigned_by && (() => {
                          const assigner = data?.users.find((u: any) => u.id === s.assigned_by);
                          return assigner ? (
                            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                              <UserCog className="h-3 w-3" />
                              <span>Người giao việc: <span className="font-medium text-foreground">{assigner.full_name}</span></span>
                            </div>
                          ) : null;
                        })()}

                        {/* Người tạo lịch */}
                        {s.created_by && (() => {
                          const creator = data?.users.find((u: any) => u.id === s.created_by);
                          return creator ? (
                            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                              <UserCog className="h-3 w-3" />
                              <span>Người tạo: <span className="font-medium">{creator.full_name}</span></span>
                            </div>
                          ) : null;
                        })()}

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
                    {!isTech && !canApprove ? <th className="pr-3">Khách hàng</th> : null}
                    <th className="pr-3">Người phụ trách</th>
                    <th className="pr-3">Người giao việc</th>
                    <th className="pr-3">Người tạo</th>
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
                    const assigner = s.assigned_by ? data?.users.find((u: any) => u.id === s.assigned_by) : null;
                    const creator = s.created_by ? data?.users.find((u: any) => u.id === s.created_by) : null;
                    return (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => setViewSchedule(s)}>
                        <td className="py-2 pr-3 font-medium max-w-[200px] truncate">{s.title}</td>
                        <td className="pr-3"><span className={`text-xs rounded-full px-2 py-0.5 ${typeInfo?.color}`}>{typeInfo?.label}</span></td>
                        <td className="pr-3 text-xs whitespace-nowrap">{s.scheduled_date?.slice(0,10)} {s.scheduled_time}</td>
                        {!isTech && !canApprove ? <td className="pr-3 text-muted-foreground text-sm">{customer?.name ?? "—"}</td> : null}
                        <td className="pr-3">
                          <div className="flex flex-wrap gap-1">
                            {assignees.map((a: any) => {
                              const u = data?.users.find((u: any) => u.id === a.user_id);
                              return <span key={a.user_id} className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{u?.full_name ?? "?"}</span>;
                            })}
                            {assignees.length === 0 && <span className="text-xs text-muted-foreground">Chưa phân công</span>}
                          </div>
                        </td>
                        <td className="pr-3">
                          {assigner ? (
                            <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{assigner.full_name}</span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="pr-3">
                          {creator ? (
                            <span className="text-xs bg-muted rounded-full px-2 py-0.5">{creator.full_name}</span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="pr-3"><span className={`text-xs rounded-full px-2 py-0.5 ${status?.color}`}>{status?.label}</span></td>
                        {isTech && <td className="pr-3 text-green-600 font-medium text-sm">{techPay ? fmtMoney(techPay) : "—"}</td>}
                        <td onClick={(e) => e.stopPropagation()}>
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
                <div>
                  <div className="font-medium">Tính chất công việc</div>
                  <div className="text-xs text-muted-foreground">Mỗi tính chất tick trong 1 lịch = 1 điểm (chia đều theo số NV). Số tiền tương ứng cũng chia đều.</div>
                </div>
                <Button size="sm" onClick={() => { setDiffForm({ name: "", description: "", bonus: "0" }); setDiffOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2 pr-3">Tên</th><th className="pr-3">Mô tả</th><th className="text-right pr-3">Tiền / lượt</th><th></th></tr>
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
                        <Button size="icon" variant="ghost" onClick={() => handleDeleteDiff(d.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {((diffData as any[]) ?? []).length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Chưa có tính chất CV nào</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        )}

        {/* ── Loại hình công việc (admin only) ── */}
        {isAdmin && (
          <TabsContent value="work-types">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-medium">Loại hình công việc</div>
                  <div className="text-xs text-muted-foreground">Mỗi lịch chỉ chọn 1 loại hình = 1 điểm (chia đều theo số NV). Tiền cũng chia đều.</div>
                </div>
                <Button size="sm" onClick={() => { setWtForm({ name: "", description: "", price: "0" }); setWtOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2 pr-3">Tên loại hình</th><th className="pr-3">Mô tả</th><th className="text-right pr-3">Đơn giá</th><th></th></tr>
                </thead>
                <tbody>
                  {(wtData as any[] ?? []).map((w: any) => (
                    <tr key={w.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">{w.name}</td>
                      <td className="pr-3 text-muted-foreground">{w.description ?? "—"}</td>
                      <td className="text-right pr-3 text-green-600 font-medium">{fmtMoney(w.price)}</td>
                      <td className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => {
                          setWtForm({ id: w.id, name: w.name, description: w.description ?? "", price: String(w.price) });
                          setWtOpen(true);
                        }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDeleteWT(w.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {((wtData as any[]) ?? []).length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Chưa có loại hình CV nào</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        )}

        {/* ── Chấm công (admin / approve_schedule) ── */}
        {(canApprove || isAdmin || isTech) && (
          <TabsContent value="attendance">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <div className="font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Bảng chấm công</div>
                  <div className="text-xs text-muted-foreground">
                    Chỉ tính các lịch đã <b>duyệt / đang làm / hoàn thành</b>. Điểm = (1 loại hình + N tính chất) ÷ số NV. Tiền cũng chia đều.
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span>Từ</span>
                    <input
                      type="date"
                      value={attFrom}
                      max={attTo}
                      onChange={(e) => setAttFrom(e.target.value)}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span>đến</span>
                    <input
                      type="date"
                      value={attTo}
                      min={attFrom}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setAttTo(e.target.value)}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => refetchAttendance()}>Làm mới</Button>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-3">Nhân viên</th>
                      <th className="pr-3 text-right">Số lịch</th>
                      <th className="pr-3 text-right">Điểm loại hình</th>
                      <th className="pr-3 text-right">Điểm tính chất</th>
                      <th className="pr-3 text-right">Tổng điểm</th>
                      <th className="pr-3 text-right">Tiền tháng</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {attLoading && (
                      <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">
                        <Loader2 className="inline h-4 w-4 mr-1 animate-spin" /> Đang tải…
                      </td></tr>
                    )}
                    {!attLoading && (attData?.rows ?? []).length === 0 && (
                      <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">Không có dữ liệu chấm công trong tháng</td></tr>
                    )}
                    {(attData?.rows ?? []).filter((r: any) => isTech && !canApprove && !isAdmin ? r.user_id === user?.id : true).map((r: any) => (
                      <tr key={r.user_id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{r.full_name}</div>
                          <div className="text-xs text-muted-foreground">{r.username}</div>
                        </td>
                        <td className="pr-3 text-right">{r.schedule_count}</td>
                        <td className="pr-3 text-right">{r.type_points.toFixed(2)}</td>
                        <td className="pr-3 text-right">{r.diff_points.toFixed(2)}</td>
                        <td className="pr-3 text-right font-semibold">{(r.type_points + r.diff_points).toFixed(2)}</td>
                        <td className="pr-3 text-right text-green-600 font-semibold">{fmtMoney(r.total_money)}</td>
                        <td className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setAttDetail(r)}>
                            <Eye className="h-3 w-3 mr-1" /> Chi tiết
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {(attData?.rows ?? []).filter((r: any) => isTech && !canApprove && !isAdmin ? r.user_id === user?.id : true).length > 0 && (
                    <tfoot>
                      <tr className="border-t bg-muted/30 font-semibold">
                        <td className="py-2 pr-3">Tổng</td>
                        <td className="pr-3 text-right">{(attData?.rows ?? []).filter((r: any) => isTech && !canApprove && !isAdmin ? r.user_id === user?.id : true).reduce((s: number, r: any) => s + r.schedule_count, 0)}</td>
                        <td className="pr-3 text-right">{(attData?.rows ?? []).reduce((s: number, r: any) => s + r.type_points, 0).toFixed(2)}</td>
                        <td className="pr-3 text-right">{(attData?.rows ?? []).reduce((s: number, r: any) => s + r.diff_points, 0).toFixed(2)}</td>
                        <td className="pr-3 text-right">{(attData?.rows ?? []).reduce((s: number, r: any) => s + r.type_points + r.diff_points, 0).toFixed(2)}</td>
                        <td className="pr-3 text-right text-green-700">{fmtMoney((attData?.rows ?? []).reduce((s: number, r: any) => s + r.total_money, 0))}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
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
          {/* Người tạo lịch — luôn hiển thị */}
          <div className="mb-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-muted-foreground font-medium">Người tạo lịch:</span>
              <span className="font-semibold text-foreground">{user?.full_name ?? "—"}</span>
              <span className="ml-auto rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs">
                Bạn
              </span>
            </div>
            {(() => {
              const linkedOrder: any = createForm.order_id
                ? (data?.orders ?? []).find((o: any) => o.id === createForm.order_id)
                : null;
              const seller: any = linkedOrder?.employee_id
                ? (data?.employees ?? []).find((e: any) => e.id === linkedOrder.employee_id)
                : null;
              if (!seller) return null;
              return (
                <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-1.5">
                  <UserCog className="h-3.5 w-3.5 shrink-0" />
                  <span>Người bán đơn hàng:</span>
                  <span className="font-medium text-foreground">{seller.name}</span>
                  <span className="ml-auto rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                    Auto từ đơn
                  </span>
                </div>
              );
            })()}
          </div>
          <div className="mb-3 rounded-md border bg-blue-50/50 p-3">
            <Label className="flex items-center gap-1 text-blue-900">
              <Receipt className="h-4 w-4" /> Liên kết với đơn hàng (tuỳ chọn)
            </Label>
            <SearchableSelect
              value={createForm.order_id}
              onChange={(v) => pickOrder(v)}
              emptyLabel="— Không liên kết —"
              placeholder="Tìm mã đơn, khách hàng..."
              options={(data?.orders ?? []).map((o: any) => {
                const c: any = (data?.customers ?? []).find((x: any) => x.id === o.customer_id);
                return { value: o.id, label: o.code, sub: `${c?.name ?? "Khách lẻ"} · ${fmtMoney(o.total)}` };
              })}
            />
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
                <SearchableSelect
                  value={createForm.branch_id}
                  onChange={(v) => setCreateForm({...createForm, branch_id: v})}
                  emptyLabel="-- Chọn --"
                  placeholder="Tìm chi nhánh..."
                  options={(data?.branches ?? []).map((b: any) => ({ value: b.id, label: b.name }))}
                /></div>
            </div>
            <div><Label>Khách hàng</Label>
              <SearchableSelect
                value={createForm.customer_id}
                onChange={(v) => setCreateForm({...createForm, customer_id: v})}
                emptyLabel="-- Chọn --"
                placeholder="Tìm khách hàng..."
                options={(data?.customers ?? []).map((c: any) => ({ value: c.id, label: c.name, sub: c.phone ?? undefined }))}
              /></div>
            <div><Label>Địa chỉ lắp đặt</Label>
              <Input className="mt-1" value={createForm.address}
                onChange={(e) => setCreateForm({...createForm, address: e.target.value})} /></div>
            <div><Label>Người giao việc</Label>
              <SearchableSelect
                value={createForm.assigned_by}
                onChange={(v) => setCreateForm({...createForm, assigned_by: v})}
                emptyLabel="— Không chỉ định —"
                placeholder="Tìm người dùng..."
                options={(data?.users ?? []).map((u: any) => ({ value: u.id, label: u.full_name }))}
              /></div>
            <div><Label>Loại hình công việc</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={createForm.work_type_id}
                onChange={(e) => setCreateForm({...createForm, work_type_id: e.target.value})}>
                <option value="">— Chưa chọn loại hình —</option>
                {((data?.work_types ?? wtData) ?? []).map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name} — {fmtMoney(w.price)}</option>
                ))}
              </select></div>
            <div><Label>Ghi chú</Label>
              <Input className="mt-1" value={createForm.note}
                onChange={(e) => setCreateForm({...createForm, note: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button onClick={handleCreate} disabled={creating}>{creating ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang tạo...</> : "Tạo lịch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Duyệt lịch & Phân công</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Phân công người */}
            <div>
              <Label className="font-medium">Phân công nhân viên kỹ thuật</Label>
              <div className="text-xs text-muted-foreground mb-1">Chỉ hiện nhân viên có quyền kỹ thuật.</div>
              <div className="mt-2 border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
                {(data?.users ?? []).filter((u: any) => u.is_admin || (u.permissions ?? []).includes("technician")).map((u: any) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={assignedUsers.includes(u.id)}
                      onChange={() => setAssignedUsers((p) => p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id])}
                    /> {u.full_name}{u.is_admin ? <span className="ml-1 text-xs text-blue-600">(Admin)</span> : null}
                  </label>
                ))}
                {(data?.users ?? []).filter((u: any) => u.is_admin || (u.permissions ?? []).includes("technician")).length === 0 && (
                  <div className="text-xs text-muted-foreground italic">Chưa có nhân viên kỹ thuật — cần phân quyền trước.</div>
                )}
              </div>
            </div>

            {/* Loại hình công việc (1 lựa chọn) */}
            <div>
              <Label className="font-medium">Loại hình công việc (chấm công)</Label>
              <div className="text-xs text-muted-foreground mb-1">Mỗi lịch chỉ chọn 1 loại hình. Điểm = 1 chia đều theo số NV.</div>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={workTypeId}
                onChange={(e) => setWorkTypeId(e.target.value)}
              >
                <option value="">— Không tính loại hình —</option>
                {((data?.work_types ?? wtData) ?? []).map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name} — {fmtMoney(w.price)}</option>
                ))}
              </select>
            </div>

            {/* Tính chất công việc */}
            <div>
              <Label className="font-medium">Tính chất công việc (chấm công)</Label>
              <div className="text-xs text-muted-foreground mb-1">Có thể tick nhiều. Mỗi tính chất = 1 điểm chia đều theo số NV.</div>
              <div className="mt-1 border rounded-md p-2 space-y-1">
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
                {(data?.work_difficulties ?? []).length === 0 && (
                  <div className="text-xs text-muted-foreground italic">Chưa có tính chất CV — admin cần tạo trước.</div>
                )}
              </div>
            </div>


            {/* thu nhập (bonus) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Thu nhập khác</Label>
                <Button size="sm" variant="outline"
                  onClick={() => setTechFees([...techFees, { product_id: "", qty: 1, unit_fee: 0 }])}>
                  <Plus className="h-3 w-3 mr-1" /> Thêm thu nhập
                </Button>
              </div>
              {techFees.map((tf, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 mb-2">
                  <Input className="col-span-6" placeholder="Tên thu nhập / mô tả"
                    value={tf.product_id}
                    onChange={(e) => {
                      const next = [...techFees];
                      next[idx] = { ...tf, product_id: e.target.value };
                      setTechFees(next);
                    }} />
                  <Input type="number" className="col-span-2" placeholder="SL" value={tf.qty}
                    onChange={(e) => { const next = [...techFees]; next[idx].qty = Number(e.target.value); setTechFees(next); }} />
                  <Input type="number" className="col-span-3" placeholder="Tiền thu nhập" value={tf.unit_fee}
                    onChange={(e) => { const next = [...techFees]; next[idx].unit_fee = Number(e.target.value); setTechFees(next); }} />
                  <button className="col-span-1 hover:text-destructive"
                    onClick={() => setTechFees(techFees.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(() => {
                const numPeople = Math.max(1, assignedUsers.length);
                // Tiền thu nhập tổng
                const bonusTotal = techFees.reduce((s, tf) => s + tf.qty * tf.unit_fee, 0);
                // Tính chất công việc: tự động nhân theo số người
                const diffBonus = assignedDiffs.reduce((s, did) => {
                  const d = (data?.work_difficulties ?? []).find((x: any) => x.id === did);
                  return s + (d?.bonus ?? 0);
                }, 0) * numPeople;
                // Tiền đơn hàng liên kết
                // orderTotal không tính vào lương
                // Tiền đơn không tính vào lương kỹ thuật
                const totalPool = bonusTotal + diffBonus;
                const perPerson = totalPool / numPeople;
                return (
                  <div className="rounded-md bg-muted/50 p-2 text-sm space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Thu nhập</span><span>{fmtMoney(bonusTotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Tính chất CV × {numPeople} người</span><span>{fmtMoney(diffBonus)}</span>
                    </div>
                    {/* Tiền đơn hàng không tính vào lương kỹ thuật */}
                    <div className="flex justify-between font-semibold border-t pt-1">
                      <span>Tiền công / người ({numPeople} người)</span>
                      <span className="text-green-600">{fmtMoney(perPerson)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Hủy</Button>
            <Button onClick={handleApprove} disabled={approving}>{approving ? "Đang duyệt..." : "Xác nhận duyệt"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="w-full max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{diffForm.id ? "Sửa" : "Thêm"} tính chất công việc</DialogTitle></DialogHeader>
          <div
            className="space-y-3"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
                handleSaveDiff();
              }
            }}
          >
            <div><Label>Tên *</Label><Input className="mt-1" autoFocus value={diffForm.name} onChange={(e) => setDiffForm({...diffForm, name: e.target.value})} /></div>
            <div><Label>Mô tả</Label><Input className="mt-1" value={diffForm.description} onChange={(e) => setDiffForm({...diffForm, description: e.target.value})} /></div>
            <div><Label>Tiền thưởng thêm (₫)</Label><Input className="mt-1" type="number" value={diffForm.bonus} onChange={(e) => setDiffForm({...diffForm, bonus: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffOpen(false)}>Hủy</Button>
            <Button onClick={handleSaveDiff}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog thêm/sửa Loại hình CV ── */}
      <Dialog open={wtOpen} onOpenChange={setWtOpen}>
        <DialogContent className="w-full max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{wtForm.id ? "Sửa" : "Thêm"} loại hình công việc</DialogTitle></DialogHeader>
          <div className="space-y-3" onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault(); handleSaveWT();
            }
          }}>
            <div><Label>Tên loại hình *</Label>
              <Input className="mt-1" autoFocus value={wtForm.name} onChange={(e) => setWtForm({...wtForm, name: e.target.value})} />
            </div>
            <div><Label>Mô tả</Label>
              <Input className="mt-1" value={wtForm.description} onChange={(e) => setWtForm({...wtForm, description: e.target.value})} />
            </div>
            <div><Label>Đơn giá / lượt (₫)</Label>
              <Input className="mt-1" type="number" value={wtForm.price} onChange={(e) => setWtForm({...wtForm, price: e.target.value})} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWtOpen(false)}>Hủy</Button>
            <Button onClick={handleSaveWT}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog chi tiết chấm công 1 nhân viên ── */}
      <Dialog open={!!attDetail} onOpenChange={(o) => { if (!o) setAttDetail(null); }}>
        <DialogContent className="w-full max-w-3xl max-h-[92vh] overflow-y-auto">
          {attDetail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Chi tiết chấm công — {attDetail.full_name}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="text-xs text-muted-foreground">Tháng</div>
                  <div className="font-semibold">{attData?.month}</div>
                </div>
                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="text-xs text-muted-foreground">Số lịch</div>
                  <div className="font-semibold">{attDetail.schedule_count}</div>
                </div>
                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="text-xs text-muted-foreground">Tổng điểm</div>
                  <div className="font-semibold">{(attDetail.type_points + attDetail.diff_points).toFixed(2)}</div>
                </div>
                <div className="rounded-lg border p-3 bg-green-50 border-green-200">
                  <div className="text-xs text-green-700">Tổng tiền</div>
                  <div className="font-semibold text-green-700">{fmtMoney(attDetail.total_money)}</div>
                </div>
              </div>

              <div className="font-medium text-sm mb-2">Danh sách công việc đã làm</div>
              <div className="overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs">
                    <tr>
                      <th className="py-2 px-3">Ngày</th>
                      <th className="px-3">Lịch / Đơn hàng</th>
                      <th className="px-3">Khách hàng</th>
                      <th className="px-3">Loại hình</th>
                      <th className="px-3">Tính chất</th>
                      <th className="px-3 text-right">Chia (NV)</th>
                      <th className="px-3 text-right">Điểm</th>
                      <th className="px-3 text-right">Tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attDetail.lines.map((ln: any) => {
                      const cust = (attData?.customers ?? []).find((c: any) => c.id === ln.customer_id);
                      const ord = ln.order_id ? (attData?.orders ?? []).find((o: any) => o.id === ln.order_id) : null;
                      return (
                        <tr key={ln.schedule_id} className="border-t">
                          <td className="py-2 px-3 whitespace-nowrap text-xs">
                            {ln.scheduled_date?.slice(0, 10)} {ln.scheduled_time ?? ""}
                          </td>
                          <td className="px-3">
                            <div className="font-medium">{ln.title}</div>
                            {ord && (
                              <Link to="/orders/$id" params={{ id: ord.id }}
                                className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                                <Receipt className="h-3 w-3" /> {ord.code} · {fmtMoney(ord.total)}
                              </Link>
                            )}
                          </td>
                          <td className="px-3 text-xs">{cust?.name ?? "—"}</td>
                          <td className="px-3 text-xs">
                            {ln.work_type ? (
                              <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                                {ln.work_type.name} ({fmtMoney(ln.work_type.price)})
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 text-xs">
                            <div className="flex flex-wrap gap-1">
                              {ln.difficulties.map((d: any) => (
                                <span key={d.id} className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
                                  {d.name} (+{fmtMoney(d.bonus)})
                                </span>
                              ))}
                              {ln.difficulties.length === 0 && <span className="text-muted-foreground">—</span>}
                            </div>
                          </td>
                          <td className="px-3 text-right text-xs">{ln.num_people}</td>
                          <td className="px-3 text-right">
                            {(ln.type_point_share + ln.diff_point_share).toFixed(2)}
                          </td>
                          <td className="px-3 text-right text-green-600 font-medium">{fmtMoney(ln.money_share)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setAttDetail(null)}>
                  <X className="h-4 w-4 mr-1" /> Đóng
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog xem chi tiết lịch làm việc ── */}
      <Dialog open={!!viewSchedule} onOpenChange={(o) => { if (!o) setViewSchedule(null); }}>
        <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
          {viewSchedule && (() => {
            const s = viewSchedule;
            const typeInfo = SCHEDULE_TYPES.find((t) => t.value === s.type);
            const status = STATUS_LABELS[s.status];
            const assignees = (data?.assignments ?? []).filter((a: any) => a.schedule_id === s.id);
            const customer = data?.customers.find((c: any) => c.id === s.customer_id);
            const assigner = s.assigned_by ? data?.users.find((u: any) => u.id === s.assigned_by) : null;
            const creator = s.created_by ? data?.users.find((u: any) => u.id === s.created_by) : null;
            const linkedOrder: any = s.order_id ? (data?.orders ?? []).find((o: any) => o.id === s.order_id) : null;
            const techPay = calcTechPay(s.id);
            const fees = (data?.tech_fees ?? []).filter((f: any) => f.schedule_id === s.id);
            const diffIds = (data?.difficulties ?? []).filter((d: any) => d.schedule_id === s.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-lg flex flex-wrap items-center gap-2">
                    <span>{s.title}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${typeInfo?.color}`}>{typeInfo?.label}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${status?.color}`}>{status?.label}</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Thông tin cơ bản */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground mb-1">Ngày / Giờ</div>
                      <div className="font-medium">{s.scheduled_date?.slice(0,10)} {s.scheduled_time ?? ""}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground mb-1">Khách hàng</div>
                      <div className="font-medium">{customer ? `${customer.name}${customer.phone ? ` — ${customer.phone}` : ""}` : "Chưa chọn"}</div>
                    </div>
                    {s.address && (
                      <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Địa chỉ</div>
                        <div className="font-medium">{s.address}</div>
                      </div>
                    )}
                    {s.note && (
                      <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Ghi chú</div>
                        <div className="font-medium">{s.note}</div>
                      </div>
                    )}
                  </div>

                  {/* Người liên quan */}
                  <div className="space-y-2">
                    <div className="font-medium text-sm">Nhân sự liên quan</div>
                    <div className="grid grid-cols-1 gap-2">
                      {creator && (
                        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                          <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div>
                            <div className="text-xs text-muted-foreground">Người tạo lịch</div>
                            <div className="font-medium text-sm">{creator.full_name}</div>
                          </div>
                        </div>
                      )}
                      {assigner && (
                        <div className="flex items-center gap-3 rounded-lg border bg-orange-50 border-orange-200 px-3 py-2">
                          <UserCog className="h-4 w-4 text-orange-600 shrink-0" />
                          <div>
                            <div className="text-xs text-orange-600">Người giao việc</div>
                            <div className="font-medium text-sm">{assigner.full_name}</div>
                          </div>
                        </div>
                      )}
                      {assignees.length > 0 && (
                        <div className="rounded-lg border bg-blue-50 border-blue-200 px-3 py-2">
                          <div className="text-xs text-blue-600 mb-1.5">Người phụ trách / thực hiện ({assignees.length})</div>
                          <div className="flex flex-wrap gap-1.5">
                            {assignees.map((a: any) => {
                              const u = data?.users.find((u: any) => u.id === a.user_id);
                              return (
                                <span key={a.user_id} className="text-sm bg-blue-100 text-blue-700 rounded-full px-3 py-1 font-medium">
                                  {u?.full_name ?? a.user_id}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Đơn hàng liên kết */}
                  {linkedOrder && (
                    <div className="rounded-lg border bg-blue-50/50 border-blue-200 px-3 py-2">
                      <div className="text-xs text-muted-foreground mb-1">Đơn hàng liên kết</div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">{linkedOrder.code}</span>
                        <span className="text-sm">{fmtMoney(linkedOrder.total)}</span>
                      </div>
                    </div>
                  )}

                  {/* Tiền công */}
                  {(fees.length > 0 || diffIds.length > 0) && (() => {
                    const numPeople = Math.max(1, assignees.length);
                    const bonusTotal = fees.reduce((sum: number, f: any) => sum + f.qty * f.unit_fee, 0);
                    const diffBonusPerTask = diffIds.reduce((sum: number, d: any) => {
                      const wd = data?.work_difficulties.find((w: any) => w.id === d.difficulty_id);
                      return sum + (wd?.bonus ?? 0);
                    }, 0);
                    const diffBonus = diffBonusPerTask * numPeople;
                    const orderTotal = linkedOrder?.total ?? 0;
                    const totalPool = bonusTotal + diffBonus + orderTotal;
                    const perPerson = totalPool / numPeople;
                    return (
                    <div>
                      <div className="font-medium text-sm mb-2">Tiền công dự kiến</div>
                      <div className="space-y-1.5">
                        {fees.map((f: any) => (
                          <div key={f.product_id} className="flex justify-between text-sm rounded border px-3 py-2">
                            <span>{f.product_id} × {f.qty}</span>
                            <span className="font-medium text-green-600">+{fmtMoney(f.qty * f.unit_fee)}</span>
                          </div>
                        ))}
                        {diffIds.map((d: any) => {
                          const wd = data?.work_difficulties.find((w: any) => w.id === d.difficulty_id);
                          return wd ? (
                            <div key={d.difficulty_id} className="flex justify-between text-sm rounded border px-3 py-2">
                              <span>{wd.name} × {numPeople} người</span>
                              <span className="font-medium text-green-600">+{fmtMoney(wd.bonus * numPeople)}</span>
                            </div>
                          ) : null;
                        })}
                        {(() => { const linkedOrder2: any = s.order_id ? (data?.orders ?? []).find((o: any) => o.id === s.order_id) : null; return linkedOrder2?.total > 0 ? (
                          <div className="flex justify-between text-sm rounded border px-3 py-2">
                            <span>Tiền đơn hàng</span>
                            <span className="font-medium text-green-600">+{fmtMoney(linkedOrder2.total)}</span>
                          </div>
                        ) : null; })()}
                        <div className="flex justify-between font-semibold text-sm rounded border border-green-200 bg-green-50 px-3 py-2">
                          <span>Tiền công / người ({numPeople} người)</span>
                          <span className="text-green-700">{fmtMoney(perPerson)}</span>
                        </div>
                      </div>
                    </div>
                    );
                  })()}
                </div>

                {/* Nội dung tin nhắn */}
                {(() => {
                  const workType = s.work_type_id ? (data?.work_types ?? []).find((w: any) => w.id === s.work_type_id) : null;
                  const orderInfo = linkedOrder ? `${linkedOrder.code} — ${fmtMoney(linkedOrder.total)}` : "Không có";
                  const assigneeNames = assignees.map((a: any) => { const u = data?.users.find((u: any) => u.id === a.user_id); return u?.full_name ?? a.user_id; }).join(", ") || "Chưa phân công";
                  const msgContent = [
                    "📋 Nội dung đơn hàng:",
                    "",
                    `• Tiêu đề: ${s.title}`,
                    `• Loại công việc: ${SCHEDULE_TYPES.find((t) => t.value === s.type)?.label ?? s.type}`,
                    workType ? `• Loại hình: ${workType.name}` : null,
                    `• Ngày lắp: ${s.scheduled_date?.slice(0, 10) ?? "—"}${s.scheduled_time ? " " + s.scheduled_time : ""}`,
                    customer ? `• Khách hàng: ${customer.name}${customer.phone ? " — " + customer.phone : ""}` : null,
                    s.address ? `• Địa chỉ: ${s.address}` : null,
                    linkedOrder ? `• Đơn hàng: ${orderInfo}` : null,
                    assignees.length > 0 ? `• Người thực hiện: ${assigneeNames}` : null,
                    assigner ? `• Người giao việc: ${assigner.full_name}` : null,
                    creator ? `• Người tạo lịch: ${creator.full_name}` : null,
                    s.note ? `• Ghi chú: ${s.note}` : null,
                    `• Trạng thái: ${STATUS_LABELS[s.status]?.label ?? s.status}`,
                  ].filter(Boolean).join("\n");
                  
                  function copyMsg() {
                    navigator.clipboard.writeText(msgContent).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }
                  
                  return (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-medium text-muted-foreground">📋 Nội dung tin nhắn</div>
                        <Button size="sm" variant="outline" onClick={copyMsg} className="h-7 text-xs">
                          {copied ? <><Check className="h-3 w-3 mr-1 text-green-600" /> Đã copy!</> : <><Copy className="h-3 w-3 mr-1" /> Copy</>}
                        </Button>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap text-foreground/80 leading-relaxed">{msgContent}</pre>
                    </div>
                  );
                })()}
                <DialogFooter className="flex-wrap gap-2">
                  {canApprove && s.status === "pending" && (
                    <Button variant="outline" onClick={() => { setViewSchedule(null); openApprove(s); }}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Duyệt & Phân công
                    </Button>
                  )}
                  {(isAdmin || canCreate) && !["done","cancelled"].includes(s.status) && (
                    <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setViewSchedule(null); handleDelete(s.id); }}>
                      <Trash2 className="h-4 w-4 mr-1" /> Xóa
                    </Button>
                  )}
                  <Button onClick={() => setViewSchedule(null)}>Đóng</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
