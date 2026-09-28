// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  getAttendanceMonthFn,
  setAttendanceFn,
  fillAttendanceRowFn,
  getPayrollFn,
  savePayrollInputFn,
  lockPayrollFn,
  unlockPayrollFn,
  payPayrollFn,
  listPayProfilesFn,
  upsertPayProfileFn,
  getPayrollAssignmentsFn,
  setPayrollAssignmentsFn,
  setSalesCoefFn,
  setSalesKpiFn,
} from "@/lib/hr.functions";
import { getSettings } from "@/lib/settings.functions";
import { getFormOptionsFn } from "@/lib/auth.functions";
import { AppShell, Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { hasPermission } from "@/lib/types";
import { exportPayrollExcel, printPayslips } from "@/lib/export-hr";
import { ScrollX } from "@/components/ScrollX";
import { todayVN, formatDateVN } from "@/lib/date-vn";
import {
  ChevronLeft, ChevronRight, Lock, Unlock, Wallet, Printer, Download, Loader2, ShieldOff, Wand2, Pencil,
  CalendarCheck, Banknote, UserCog, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Plus, Info,
  Network, Search, Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/payroll")({
  head: () => ({ meta: [{ title: "Bảng lương — Mr.Vũ" }] }),
  component: PayrollPage,
});

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const money = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const shiftMonth = (m: string, delta: number) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1 + delta, 1)).toISOString().slice(0, 7);
};

/** Bấm ô chấm công xoay vòng đúng các mã của file Excel. */
const CYCLE: (string | null)[] = ["X", "N", "L", "K", null];
const CODE_STYLE: Record<string, string> = {
  X: "bg-emerald-100 text-emerald-800",
  N: "bg-amber-100 text-amber-800",
  L: "bg-sky-100 text-sky-800",
  K: "bg-rose-100 text-rose-700",
};
const CODE_LABEL: Record<string, string> = { X: "Làm cả ngày", N: "Nửa ngày", L: "Nghỉ có lương", K: "Nghỉ không lương" };

const TABS = [
  ["attendance", "Chấm công", CalendarCheck, false],
  ["payroll", "Bảng lương", Banknote, false],
  ["profiles", "Hồ sơ lương", UserCog, false],
  // Chỉ admin: chỉ định người quản lý lương được quản lý những ai.
  ["assign", "Phân việc", Network, true],
] as const;

function PayrollPage() {
  const { user, isAdmin } = useAuth();
  const canView = Boolean(user && (isAdmin || hasPermission(user as any, "manage_payroll")));
  const [month, setMonth] = useState(todayVN().slice(0, 7));
  const [tab, setTab] = useState<"attendance" | "payroll" | "profiles" | "assign">("attendance");
  const [filters, setFiltersState] = useState<Filters>(() => loadFilters());
  const setFilters = (f: Filters) => {
    setFiltersState(f);
    saveFilters(f);
  };
  const [y, mm] = month.split("-");

  if (!canView) {
    return (
      <AppShell title="Bảng lương">
        <Card className="py-12 text-center">
          <ShieldOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <div className="text-base font-medium">Bạn không có quyền xem bảng lương</div>
          <div className="text-sm text-muted-foreground">Cần quyền "Quản lý lương nhân sự".</div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Chấm công & Bảng lương">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {(tab === "attendance" || tab === "payroll") && (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Tháng trước"><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[150px] text-center text-xl font-bold tracking-tight">Tháng {Number(mm)}/{y}</div>
              <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Tháng sau"><ChevronRight className="h-4 w-4" /></Button>
              {month !== todayVN().slice(0, 7) && (
                <Button variant="ghost" size="sm" onClick={() => setMonth(todayVN().slice(0, 7))}>Tháng này</Button>
              )}
            </div>
          )}
          <div className="flex-1" />
          <div className="flex w-full flex-wrap rounded-lg border bg-muted/40 p-1 sm:w-auto">
            {TABS.filter(([, , , adminOnly]) => !adminOnly || isAdmin).map(([k, l, Icon]) => (
              <button
                key={k}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${tab === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setTab(k as any)}
              >
                <Icon className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
        </div>
      </Card>
      {tab === "attendance" && <AttendanceTab month={month} actorId={user?.id} filters={filters} onFilters={setFilters} />}
      {tab === "payroll" && <PayrollTab month={month} actorId={user?.id} filters={filters} onFilters={setFilters} />}
      {tab === "profiles" && <ProfilesTab actorId={user?.id} />}
      {tab === "assign" && isAdmin && <AssignTab actorId={user?.id} />}
    </AppShell>
  );
}

function Loading() {
  return <Card className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
}
function EmptyPayroll() {
  const { isAdmin } = useAuth();
  return (
    <Card className="py-10 text-center text-base text-muted-foreground">
      {isAdmin ? (
        <>Chưa có nhân viên nào trong bảng lương. Vào tab <strong className="text-foreground">Hồ sơ lương</strong> để thêm.</>
      ) : (
        <>
          Chưa có ai trong bảng lương của bạn — bạn luôn quản lý được lương của chính mình, nhưng cần có hồ sơ lương trước.
          <div className="mt-1 text-sm">Vào tab <strong className="text-foreground">Hồ sơ lương</strong> để tạo hồ sơ cho mình; muốn quản lý thêm người thì nhờ quản trị viên tick ở tab <strong className="text-foreground">Phân việc</strong>.</div>
        </>
      )}
    </Card>
  );
}

// ─── Bộ lọc dùng chung cho tab Chấm công & Bảng lương ─────────────────────
type Filters = { q: string; branch: string; position: string; manager: string; att: string; pay: string };
const EMPTY_FILTERS: Filters = { q: "", branch: "", position: "", manager: "", att: "", pay: "" };
const FILTER_KEY = "mrvu.payroll.filters";
const fold = (s: string) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

function loadFilters(): Filters {
  try {
    return { ...EMPTY_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") };
  } catch {
    return EMPTY_FILTERS;
  }
}
function saveFilters(f: Filters) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {}
}

/** Tiêu chí chung: tên, chi nhánh, chức vụ, người quản lý lương. */
function matchCommon(r: any, f: Filters) {
  if (f.q && !fold(r.full_name).includes(fold(f.q))) return false;
  if (f.branch && !(r.branch_ids ?? []).includes(f.branch)) return false;
  if (f.position === "__none" ? Boolean(r.position_id) : f.position && r.position_id !== f.position) return false;
  if (f.manager && !(r.manager_ids ?? []).includes(f.manager)) return false;
  return true;
}
const isPaidRow = (r: any) => Boolean(r.cash_voucher_id) && !String(r.cash_voucher_id).startsWith("pending:");
/** Tiêu chí riêng tab Bảng lương. */
function matchPay(r: any, f: Filters) {
  switch (f.pay) {
    case "draft": return !r.locked;
    case "locked": return r.locked && !isPaidRow(r);
    case "paid": return isPaidRow(r);
    case "negative": return Number(r.net_pay) < 0;
    case "warning": return (r.sales_detail?.warnings ?? []).length > 0;
    case "override": return (r.commission_override ?? null) !== null || (r.business_override ?? null) !== null;
    default: return true;
  }
}

const ATT_OPTIONS = [
  ["", "Mọi tình trạng chấm công"],
  ["full", "Đủ công"],
  ["short", "Thiếu công"],
  ["none", "Chưa chấm ngày nào"],
  ["self", "Có ngày tự chấm"],
  ["note", "Có ghi chú"],
] as const;
const PAY_OPTIONS = [
  ["", "Mọi trạng thái lương"],
  ["draft", "Nháp (chưa chốt)"],
  ["locked", "Đã chốt, chưa chi"],
  ["paid", "Đã chi"],
  ["negative", "Thực lĩnh âm"],
  ["warning", "Có cảnh báo DS"],
  ["override", "Có số admin ghi đè"],
] as const;

function PayrollFilters({ value, onChange, options, tab, shown, total }: any) {
  const { isAdmin } = useAuth();
  const f: Filters = value;
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";
  const branches = options?.branches ?? [];
  const positions = options?.positions ?? [];
  const managers = options?.managers ?? [];
  const chips: [keyof Filters, string][] = [];
  if (f.q) chips.push(["q", `Tên: "${f.q}"`]);
  if (f.branch) chips.push(["branch", branches.find((b: any) => b.id === f.branch)?.name ?? "Chi nhánh"]);
  if (f.position) chips.push(["position", f.position === "__none" ? "Chưa có chức vụ" : positions.find((p: any) => p.id === f.position)?.name ?? "Chức vụ"]);
  if (f.manager) chips.push(["manager", `QL: ${managers.find((m: any) => m.id === f.manager)?.full_name ?? ""}`]);
  if (tab === "attendance" && f.att) chips.push(["att", ATT_OPTIONS.find(([k]) => k === f.att)?.[1] ?? ""]);
  if (tab === "payroll" && f.pay) chips.push(["pay", PAY_OPTIONS.find(([k]) => k === f.pay)?.[1] ?? ""]);

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Tìm tên nhân viên…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        {isAdmin && (
          <>
            <select className={sel} value={f.branch} onChange={(e) => set({ branch: e.target.value })}>
              <option value="">Mọi chi nhánh</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className={sel} value={f.position} onChange={(e) => set({ position: e.target.value })}>
              <option value="">Mọi chức vụ</option>
              {positions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__none">Chưa có chức vụ</option>
            </select>
            <select className={sel} value={f.manager} onChange={(e) => set({ manager: e.target.value })}>
              <option value="">Mọi người quản lý</option>
              {managers.map((m: any) => <option key={m.id} value={m.id}>Nhóm của {m.full_name}</option>)}
            </select>
          </>
        )}
        {tab === "attendance" && (
          <select className={sel} value={f.att} onChange={(e) => set({ att: e.target.value })}>
            {ATT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        {tab === "payroll" && (
          <select className={sel} value={f.pay} onChange={(e) => set({ pay: e.target.value })}>
            {PAY_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Đang hiện <strong className="text-foreground">{shown}</strong>/{total} người ·</span>
          {chips.map(([k, l]) => (
            <button key={k} onClick={() => set({ [k]: "" } as any)} className="inline-flex items-center gap-1 rounded-full border bg-primary/5 px-2.5 py-0.5 text-primary hover:bg-primary/10">
              {l}<span aria-hidden>×</span>
            </button>
          ))}
          <button className="ml-1 text-muted-foreground underline" onClick={() => onChange(EMPTY_FILTERS)}>Xoá lọc</button>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Chấm công
// ═══════════════════════════════════════════════════════════════════════════
function AttendanceTab({ month, actorId, filters, onFilters }: { month: string; actorId?: string; filters: Filters; onFilters: (f: Filters) => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getAttendanceMonthFn);
  const setFn = useServerFn(setAttendanceFn);
  const fillFn = useServerFn(fillAttendanceRowFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance", month],
    queryFn: () => getFn({ data: { month, actorId } }),
  });
  // Ghi đè lạc quan: bấm ô là đổi ngay, không chờ server.
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const [filling, setFilling] = useState(false);
  const [editCell, setEditCell] = useState<null | { row: any; date: string }>(null);
  const today = todayVN();

  async function cycle(userId: string, date: string, current: string | null, rowLocked: boolean) {
    if (rowLocked) return;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const key = `${userId}|${date}`;
    setLocal((p) => ({ ...p, [key]: next }));
    try {
      await setFn({ data: { userId, date, code: next, actorId } });
      qc.invalidateQueries({ queryKey: ["payroll", month] });
    } catch (e: any) {
      setLocal((p) => ({ ...p, [key]: current }));
      toast.error(e?.message ?? "Lỗi lưu chấm công");
    }
  }

  if (isLoading) return <Loading />;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;
  if (!data?.rows?.length) return <EmptyPayroll />;

  const codeOf = (r: any, d: string) => {
    const k = `${r.user_id}|${d}`;
    return k in local ? local[k] : r.codes[d] ?? null;
  };
  const totals = (r: any) => {
    const t = { X: 0, N: 0, L: 0, K: 0 };
    for (const d of data.dates) {
      const c = codeOf(r, d);
      if (c) t[c] += 1;
    }
    return { ...t, worked: t.X + t.N / 2 + t.L };
  };
  const matchAtt = (r: any) => {
    const t = totals(r);
    const std = Number(r.standard_days) || 26;
    switch (filters.att) {
      case "full": return t.worked >= std;
      case "short": return t.worked > 0 && t.worked < std;
      case "none": return t.X + t.N + t.L + t.K === 0;
      case "self": return Object.values(r.marks ?? {}).some((m: any) => m?.self);
      case "note": return Object.keys(r.notes ?? {}).length > 0;
      default: return true;
    }
  };
  const rows = data.rows.filter((r: any) => matchCommon(r, filters) && matchAtt(r));
  // Khoá theo TỪNG NGƯỜI (người đã chốt lương thì hàng của họ chỉ xem).
  const lockedCount = rows.filter((r: any) => r.locked).length;
  const filtering = rows.length !== data.rows.length;

  async function fillAll() {
    if (!rows.length) return;
    if (!window.confirm(`Điền X cho mọi ngày thường và K cho Chủ nhật — CHỈ các ô còn trống, cho ${rows.length} người đang hiện. Các ô đã chấm tay giữ nguyên.`)) return;
    setFilling(true);
    try {
      const r = await fillFn({ data: { month, userIds: rows.map((r: any) => r.user_id), weekdayCode: "X", sundayCode: "K", onlyEmpty: true, actorId } });
      toast.success(`Đã điền ${r.filled} ô`);
      setLocal({});
      qc.invalidateQueries({ queryKey: ["attendance", month] });
      qc.invalidateQueries({ queryKey: ["payroll", month] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      setFilling(false);
    }
  }

  return (
    <>
      <PayrollFilters value={filters} onChange={onFilters} options={data.filterOptions} tab="attendance" shown={rows.length} total={data.rows.length} />
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
          {Object.entries(CODE_LABEL).map(([c, l]) => (
            <span key={c} className="flex items-center gap-1.5 text-sm">
              <span className={`grid h-6 w-6 place-items-center rounded-md text-sm font-bold ${CODE_STYLE[c]}`}>{c}</span>{l}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-sm">
            <span className="h-5 w-5 rounded-md outline-dashed outline-2 -outline-offset-2 outline-sky-500" />NV tự chấm
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            <span className="relative h-5 w-5 rounded-md bg-slate-100"><span className="absolute right-0 top-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-rose-500" /></span>Có ghi chú
          </span>
          <span className="text-sm text-muted-foreground">Bấm ô để đổi mã · <strong className="text-foreground">chuột phải / giữ lâu</strong> để ghi chú</span>
          <div className="flex-1" />
          {lockedCount > 0 && (
            <span className="flex items-center gap-1 text-sm font-medium text-orange-700"><Lock className="h-4 w-4" />{lockedCount} người đã chốt — chỉ xem</span>
          )}
          {lockedCount < rows.length && (
            <Button variant="outline" onClick={fillAll} disabled={filling}>
              {filling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
              Điền nhanh ô trống{filtering ? ` (${rows.length} người đang lọc)` : ""}
            </Button>
          )}
        </div>
        <ScrollX>
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 min-w-[230px] border-b border-r bg-slate-50 px-4 py-2 text-left font-semibold text-slate-600">
                  Nhân viên <span className="font-normal text-muted-foreground">· công / chuẩn</span>
                </th>
                {data.dates.map((d: string) => {
                  const isToday = d === today;
                  const isSun = dow(d) === 0;
                  return (
                    <th key={d} className={`w-10 border-b border-r px-0 py-1.5 text-center ${isToday ? "bg-amber-100" : isSun ? "bg-rose-50" : "bg-slate-50"}`}>
                      <div className={`text-sm font-bold ${isToday ? "text-amber-900" : isSun ? "text-rose-700" : "text-slate-800"}`}>{Number(d.slice(8))}</div>
                      <div className={`text-[11px] font-medium ${isSun ? "text-rose-500" : "text-slate-400"}`}>{WD[dow(d)]}</div>
                    </th>
                  );
                })}
                {["X", "N", "L", "K"].map((c) => (
                  <th key={c} className="w-11 border-b border-r bg-slate-50 text-center">
                    <span className={`inline-grid h-6 w-6 place-items-center rounded-md text-xs font-bold ${CODE_STYLE[c]}`}>{c}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={data.dates.length + 5} className="py-10 text-center text-muted-foreground">Không có nhân viên khớp bộ lọc.</td></tr>
              )}
              {rows.map((r: any) => {
                const t = totals(r);
                const std = Number(r.standard_days) || 26;
                return (
                  <tr key={r.user_id} className="group">
                    <td className="sticky left-0 z-10 border-b border-r bg-background px-4 py-2 group-hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <span className="truncate">{r.full_name}</span>
                            {r.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-orange-600" title="Đã chốt lương" />}
                          </div>
                          {r.position && <div className="text-xs text-muted-foreground">{r.position}</div>}
                        </div>
                        {/* Số công đặt ngay cạnh tên để không bị khuất bên phải khi lưới dài. */}
                        <div className={`shrink-0 rounded-lg px-2.5 py-1 text-right tabular-nums ${t.worked >= std ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-800"}`}>
                          <span className="text-lg font-bold">{t.worked}</span>
                          <span className="text-xs text-muted-foreground">/{std}</span>
                        </div>
                      </div>
                    </td>
                    {data.dates.map((d: string) => {
                      const c = codeOf(r, d);
                      const note = r.notes?.[d];
                      const mark = r.marks?.[d];
                      const tip = [
                        CODE_LABEL[c] ?? "Chưa chấm",
                        note ? `Ghi chú: ${note}` : "",
                        mark?.self ? "Nhân viên tự chấm" : mark?.by ? `Chấm bởi ${mark.by}` : "",
                      ].filter(Boolean).join("\n");
                      return (
                        <td
                          key={d}
                          onClick={() => cycle(r.user_id, d, c, r.locked)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (!r.locked) setEditCell({ row: r, date: d });
                          }}
                          title={tip}
                          className={`group/cell relative h-12 select-none border-b border-r p-1 text-center ${d === today ? "bg-amber-50" : dow(d) === 0 ? "bg-rose-50/50" : ""} ${r.locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-primary/5"}`}
                        >
                          {c && (
                            <span className={`inline-grid h-8 w-8 place-items-center rounded-md text-sm font-bold ${CODE_STYLE[c]} ${mark?.self ? "outline-dashed outline-2 -outline-offset-2 outline-sky-500" : ""}`}>
                              {c}
                            </span>
                          )}
                          {!r.locked && (
                            <button
                              type="button"
                              title="Ghi chú / sửa ngày này"
                              onClick={(e) => { e.stopPropagation(); setEditCell({ row: r, date: d }); }}
                              className="absolute bottom-0 left-0 hidden rounded-tr bg-white/90 px-0.5 text-[10px] leading-none text-slate-500 shadow-sm hover:text-primary group-hover/cell:block"
                            >
                              ✎
                            </button>
                          )}
                          {note && <span className="pointer-events-none absolute right-0 top-0 border-l-[8px] border-t-[8px] border-l-transparent border-t-rose-500" />}
                        </td>
                      );
                    })}
                    {(["X", "N", "L", "K"] as const).map((c) => (
                      <td key={c} className="border-b border-r text-center font-semibold tabular-nums text-slate-700">{t[c] || ""}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      </Card>

      <AttendanceCellDialog
        key={editCell ? `${editCell.row.user_id}|${editCell.date}` : "none"}
        cell={editCell}
        code={editCell ? codeOf(editCell.row, editCell.date) : null}
        onClose={() => setEditCell(null)}
        onSaved={() => {
          if (editCell) setLocal((p) => { const n = { ...p }; delete n[`${editCell.row.user_id}|${editCell.date}`]; return n; });
          setEditCell(null);
          qc.invalidateQueries({ queryKey: ["attendance", month] });
          qc.invalidateQueries({ queryKey: ["payroll", month] });
        }}
        actorId={actorId}
      />
    </>
  );
}

/** Hộp sửa một ô chấm công: chọn mã + ghi chú lý do (nghỉ lễ, tăng ca…). */
function AttendanceCellDialog({ cell, code, onClose, onSaved, actorId }: any) {
  const setFn = useServerFn(setAttendanceFn);
  const [c, setC] = useState<string | null>(code ?? null);
  const [note, setNote] = useState<string>(cell ? cell.row.notes?.[cell.date] ?? "" : "");
  const [saving, setSaving] = useState(false);
  if (!cell) return null;
  const mark = cell.row.marks?.[cell.date];
  const [yy, mm, dd] = cell.date.split("-");

  async function save() {
    setSaving(true);
    try {
      await setFn({ data: { userId: cell.row.user_id, date: cell.date, code: c, note, actorId } });
      toast.success("Đã lưu");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">{WD[dow(cell.date)]} {Number(dd)}/{Number(mm)}/{yy} — {cell.row.full_name}</DialogTitle>
          <DialogDescription>
            {mark?.self ? "Nhân viên tự chấm" : mark?.by ? `Chấm bởi ${mark.by}` : "Chưa chấm"}
            {mark?.at ? ` · ${formatDateVN(String(mark.at).slice(0, 10))}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {(["X", "N", "L", "K"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setC(k)}
                className={`rounded-lg border-2 py-2 text-center transition-all ${c === k ? "border-primary shadow-sm" : "border-transparent"} ${CODE_STYLE[k]}`}
              >
                <div className="text-lg font-bold">{k}</div>
                <div className="text-[10px] leading-tight">{CODE_LABEL[k]}</div>
              </button>
            ))}
            <button
              onClick={() => setC(null)}
              className={`rounded-lg border-2 bg-slate-50 py-2 text-center text-slate-500 ${c === null ? "border-primary" : "border-transparent"}`}
            >
              <div className="text-lg font-bold">—</div>
              <div className="text-[10px] leading-tight">Xoá</div>
            </button>
          </div>
          <div>
            <Label>Ghi chú</Label>
            <Input className="mt-1.5" placeholder="vd: nghỉ lễ 2/9, tăng ca lắp công trình…" value={note} disabled={!c} onChange={(e) => setNote(e.target.value)} />
            {!c && <div className="mt-1 text-xs text-muted-foreground">Chọn mã trước rồi mới ghi chú được. Xoá mã thì ghi chú cũng bị xoá.</div>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Huỷ</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lưu</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bảng lương
// ═══════════════════════════════════════════════════════════════════════════
function MoneyInput({ value, disabled, onSave, width = "w-28", decimals = false, placeholder = "0" }: any) {
  const [v, setV] = useState<string | null>(null);
  const shown = v ?? (value ? (decimals ? String(value) : money(value)) : "");
  return (
    <input
      className={`h-9 ${width} rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:border-transparent disabled:bg-transparent`}
      inputMode="decimal"
      disabled={disabled}
      value={shown}
      placeholder={placeholder}
      onFocus={() => setV(value ? String(value) : "")}
      onChange={(e) => setV(e.target.value.replace(decimals ? /[^\d.,]/g : /[^\d]/g, ""))}
      onBlur={() => {
        if (v === null) return;
        const n = Number(String(v).replace(",", ".")) || 0;
        setV(null);
        if (n !== Number(value || 0)) onSave(n);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Stat({ label, value, sub, icon: Icon, tone = "slate" }: any) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-rose-100 text-rose-700",
    brand: "bg-primary/10 text-primary",
  };
  return (
    <Card className="flex items-start gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="truncate text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </Card>
  );
}

function PayrollTab({ month, actorId, filters, onFilters }: { month: string; actorId?: string; filters: Filters; onFilters: (f: Filters) => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPayrollFn);
  const saveFn = useServerFn(savePayrollInputFn);
  const lockFn = useServerFn(lockPayrollFn);
  const unlockFn = useServerFn(unlockPayrollFn);
  const payFn = useServerFn(payPayrollFn);
  const settingsFn = useServerFn(getSettings);
  const optsFn = useServerFn(getFormOptionsFn);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["payroll", month],
    queryFn: () => getFn({ data: { month, actorId } }),
  });
  const { data: settings } = useQuery({ queryKey: ["site_settings"], queryFn: () => settingsFn(), staleTime: 60_000 });
  const { data: opts } = useQuery({ queryKey: ["branches_list"], queryFn: () => optsFn(), staleTime: 300_000 });

  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [detail, setDetail] = useState<null | { kind: string; row: any }>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payFund, setPayFund] = useState<"tien_mat" | "ngan_hang">("ngan_hang");
  const [payBranch, setPayBranch] = useState("");
  const [payResult, setPayResult] = useState<any[] | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["payroll", month] });

  async function save(userId: string, values: Record<string, any>) {
    try {
      await saveFn({ data: { month, userId, values, actorId } });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    }
  }

  async function run(label: string, fn: () => Promise<any>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const allRows = (data?.rows ?? []) as any[];
  // Bộ lọc: thẻ tổng quan, TỔNG CỘNG, chốt / mở / chi / in / xuất đều theo các hàng đang hiện.
  const rows = allRows.filter((r) => matchCommon(r, filters) && matchPay(r, filters));
  const filtering = rows.length !== allRows.length;
  const s = {
    gross: rows.reduce((a, r) => a + Number(r.gross || 0), 0),
    deductions: rows.reduce((a, r) => a + Number(r.deductions || 0), 0),
    payout: rows.reduce((a, r) => a + Math.max(0, Number(r.net_pay || 0)), 0),
    negative: rows.filter((r) => Number(r.net_pay) < 0).length,
    paid: rows.filter(isPaidRow).length,
  };
  const siteName = settings?.site_name?.trim() || "MR*VU";

  if (isLoading) return <Loading />;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  const draftCount = rows.filter((r) => !r.locked).length;
  const lockedUnpaid = rows.filter((r) => r.locked && !r.cash_voucher_id);
  const paidCount = s?.paid ?? 0;
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);

  async function lockRows(userIds?: string[]) {
    const ids = userIds ?? rows.filter((r) => !r.locked).map((r) => r.user_id);
    const who = ids.length === 1 ? rows.find((r) => r.user_id === ids[0])?.full_name : `${ids.length} người chưa chốt${filtering ? " (đang lọc)" : ""}`;
    if (!window.confirm(`Chốt lương tháng ${month} cho ${who}? Sau khi chốt, số liệu được giữ nguyên dù lịch/đơn/phiếu thay đổi.`)) return;
    await run("lock", async () => {
      const r = await lockFn({ data: { month, userIds: ids, actorId } });
      toast.success(`Đã chốt lương ${r.people} người`);
      refresh();
    });
  }
  async function unlockRows(userIds?: string[]) {
    await run("unlock", async () => {
      const r = await unlockFn({ data: { month, userIds: userIds ?? lockedUnpaid.map((x) => x.user_id), actorId } });
      toast.success(`Đã mở lại ${r.unlocked} người${r.skippedPaid ? ` (bỏ qua ${r.skippedPaid} người đã chi)` : ""}`);
      refresh();
    });
  }

  // Ô tiêu đề / ô dữ liệu dùng chung để bảng đều nhau
  const TH = "border-b border-r px-3 py-2 text-[13px] font-semibold whitespace-nowrap";
  const TD = "border-b border-r px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  const linkBtn = "font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid";

  return (
    <>
      {/* ── Tổng quan ── */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tổng thu nhập" value={`${money(s?.gross)}đ`} sub={filtering ? `${rows.length}/${allRows.length} nhân viên (đang lọc)` : `${rows.length} nhân viên`} icon={TrendingUp} tone="green" />
        <Stat label="Tổng khấu trừ" value={`${money(s?.deductions)}đ`} sub="Tạm ứng lương, BHXH, công đoàn, trừ khác" icon={TrendingDown} tone="red" />
        <Stat
          label="Tổng chi (thực lĩnh)"
          value={`${money(s?.payout ?? s?.net)}đ`}
          sub={s?.negative > 0 ? <span className="text-rose-600">{s.negative} người thực lĩnh âm — không chi</span> : "Chỉ cộng người thực lĩnh > 0"}
          icon={Wallet}
          tone="brand"
        />
        <Card>
          <div className="mb-2 text-sm text-muted-foreground">Trạng thái</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Chưa chốt</span><strong className="tabular-nums">{draftCount}</strong></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Đã chốt, chưa chi</span><strong className="tabular-nums">{lockedUnpaid.length}</strong></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Đã chi</span><strong className="tabular-nums">{paidCount}</strong></div>
          </div>
        </Card>
      </div>

      <PayrollFilters value={filters} onChange={onFilters} options={data?.filterOptions} tab="payroll" shown={rows.length} total={allRows.length} />

      {/* ── Thao tác ── */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {draftCount > 0 && (
            <Button onClick={() => lockRows()} disabled={!!busy}>
              {busy === "lock" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Lock className="mr-1.5 h-4 w-4" />}Chốt lương ({draftCount}{filtering ? " đang lọc" : ""})
            </Button>
          )}
          {lockedUnpaid.length > 0 && (
            <Button onClick={() => { setPayResult(null); setPayOpen(true); }} disabled={!!busy}>
              <Wallet className="mr-1.5 h-4 w-4" />Chi lương qua Sổ quỹ
            </Button>
          )}
          {lockedUnpaid.length > 0 && (
            <Button variant="outline" onClick={() => unlockRows()} disabled={!!busy}>
              <Unlock className="mr-1.5 h-4 w-4" />Mở lại ({lockedUnpaid.length})
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => printPayslips(rows, month, siteName)} disabled={!rows.length}>
            <Printer className="mr-1.5 h-4 w-4" />In phiếu lương
          </Button>
          <Button variant="outline" onClick={() => exportPayrollExcel({ month, rows }).catch((e) => toast.error(e?.message))} disabled={!rows.length}>
            <Download className="mr-1.5 h-4 w-4" />Xuất Excel
          </Button>
        </div>
        {(!data?.scopeAll || data?.hasSalaryVoucherType === false || data?.salesInfo) && (
          <div className="mt-3 space-y-1 text-sm">
            {data?.salesInfo?.missingV19 && (
              <div className="flex items-start gap-1.5 text-orange-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Chưa chạy sql_migration_v19_sales_revenue.sql — hệ số mặc định 0,5% và chưa có KPI, nhân viên bán hàng tạm = 0.
              </div>
            )}
            {data?.salesInfo?.unattributed > 0 && (
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Tiền thu trong tháng <strong className="text-foreground">không xác định được người bán</strong>: {money(data.salesInfo.unattributed)}đ
                  — gồm phiếu thu không phải tiền bán hàng (chuyển quỹ, thu khác, nộp quỹ…) và khoản khách trả vượt số nợ theo đơn. Không tính vào DS của ai.
                </span>
              </div>
            )}
            {!data?.scopeAll && (
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />Bạn đang xem lương của chính mình và những nhân viên được admin phân cho. Chốt / mở lại / chi lương chỉ áp dụng cho những người này.
              </div>
            )}
            {data?.hasSalaryVoucherType === false && (
              <div className="flex items-start gap-1.5 text-orange-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Sổ quỹ chưa có loại phiếu chi "Chi Lương" — cần tạo trước khi chi lương.
              </div>
            )}
          </div>
        )}
      </Card>

      {!allRows.length ? (
        <EmptyPayroll />
      ) : !rows.length ? (
        <Card className="py-10 text-center text-muted-foreground">Không có nhân viên khớp bộ lọc.</Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ScrollX>
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th rowSpan={2} className={`${TH} sticky left-0 z-20 min-w-[250px] bg-slate-50 text-left text-slate-600`}>Nhân viên</th>
                  <th colSpan={4} className={`${TH} bg-slate-100 text-center text-slate-700`}>Lương & ngày công</th>
                  <th colSpan={7} className={`${TH} bg-emerald-50 text-center text-emerald-800`}>Thu nhập thêm</th>
                  <th colSpan={4} className={`${TH} bg-rose-50 text-center text-rose-800`}>Khấu trừ</th>
                  <th rowSpan={2} className={`${TH} sticky right-0 z-20 min-w-[140px] bg-primary/10 text-right text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.25)]`}>Thực lĩnh</th>
                </tr>
                <tr>
                  {[
                    ["Lương CB", "bg-slate-50"], ["Công", "bg-slate-50"], ["Chuẩn", "bg-slate-50"], ["Lương TN", "bg-slate-50"],
                    ["DS kỹ thuật", "bg-emerald-50/60"], ["DS bán hàng", "bg-emerald-50/60"], ["DS kinh doanh", "bg-emerald-50/60"], ["Tăng ca (giờ ×1,5 · ×2)", "bg-emerald-50/60"],
                    ["Xăng xe tỉnh", "bg-emerald-50/60"], ["Thưởng", "bg-emerald-50/60"], ["Phụ cấp", "bg-emerald-50/60"],
                    ["Tạm ứng", "bg-rose-50/60"], ["BHXH", "bg-rose-50/60"], ["Công đoàn", "bg-rose-50/60"], ["Trừ khác", "bg-rose-50/60"],
                  ].map(([h, bg]) => (
                    <th key={h} className={`${TH} ${bg} text-right font-medium text-slate-600`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => {
                  const paid = r.cash_voucher_id && !String(r.cash_voucher_id).startsWith("pending:");
                  return (
                    <tr key={r.user_id} className="group">
                      <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2.5 group-hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                              <span className="truncate">{r.full_name}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                              <span className="text-muted-foreground">{r.position}</span>
                              {paid ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-px font-medium text-emerald-700">Đã chi</span>
                              ) : r.locked ? (
                                <span className="rounded-full bg-orange-100 px-2 py-px font-medium text-orange-700">Đã chốt</span>
                              ) : (
                                <span className="rounded-full bg-slate-100 px-2 py-px font-medium text-slate-600">Nháp</span>
                              )}
                            </div>
                          </div>
                          {/* Thao tác nằm trong cột tên (dính trái) để luôn bấm được, không phải cuộn sang phải. */}
                          <div className="flex shrink-0 items-center">
                            {!r.locked ? (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" title="Ghi chú xăng xe / phụ cấp / trừ khác" onClick={() => setDetail({ kind: "notes", row: r })}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8" title="Chốt lương riêng người này" disabled={!!busy} onClick={() => lockRows([r.user_id])}>
                                  <Lock className="h-4 w-4" />
                                </Button>
                              </>
                            ) : !r.cash_voucher_id ? (
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Mở lại để sửa" disabled={!!busy} onClick={() => unlockRows([r.user_id])}>
                                <Unlock className="h-4 w-4 text-orange-600" />
                              </Button>
                            ) : null}
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="In phiếu lương" onClick={() => printPayslips([r], month, siteName)}><Printer className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      </td>
                      <td className={TD}>{money(r.base_salary)}</td>
                      <td className={`${TD} text-center`}>
                        <span className="font-semibold">{r.worked_days}</span>
                        {r.no_attendance && !r.locked && (
                          <div className="text-[11px] font-medium text-orange-600" title="Tháng này chưa chấm công ngày nào — sang tab Chấm công. Chưa trừ BHXH/công đoàn.">chưa chấm</div>
                        )}
                      </td>
                      <td className={`${TD} text-center text-muted-foreground`}>{r.standard_days}</td>
                      <td className={`${TD} font-medium`}>{money(r.salary_by_days)}</td>
                      <td className={TD}>
                        {r.tech_enabled || r.snapshot ? (
                          r.snapshot ? money(r.tech_revenue) : <button className={linkBtn} onClick={() => setDetail({ kind: "tech", row: r })}>{money(r.tech_revenue)}</button>
                        ) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      {/* DS bán hàng / DS kinh doanh: tự tính theo chức vụ, bấm để xem cách tính. */}
                      {([["sales", r.commission, r.sales_detail, r.commission_override], ["business", r.business_revenue, r.business_detail, r.business_override]] as const).map(([kind, val, det, ov]: any) => (
                        <td key={kind} className={TD}>
                          {det || val || r.snapshot ? (
                            <button className={linkBtn} onClick={() => setDetail({ kind, row: r })}>
                              {(det?.warnings ?? []).length > 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />}
                              {money(val)}
                              {ov !== null && ov !== undefined && <span className="text-orange-600" title="Admin đã ghi đè">*</span>}
                            </button>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      ))}
                      <td className={`${TD} px-2`}>
                        <div className="flex items-center justify-end gap-1.5">
                          <MoneyInput value={r.ot_hours_15} width="w-14" decimals placeholder="giờ" disabled={r.locked} onSave={(n: number) => save(r.user_id, { ot_hours_15: n })} />
                          <MoneyInput value={r.ot_hours_20} width="w-14" decimals placeholder="giờ" disabled={r.locked} onSave={(n: number) => save(r.user_id, { ot_hours_20: n })} />
                          <span className="w-24 text-right font-medium">{money(r.overtime_amount)}</span>
                        </div>
                      </td>
                      <td className={`${TD} px-2`} title={r.travel_note}>
                        <MoneyInput value={r.travel_allowance} disabled={r.locked} onSave={(n: number) => save(r.user_id, { travel_allowance: n })} />
                      </td>
                      <td className={`${TD} px-2`}><MoneyInput value={r.bonus} disabled={r.locked} onSave={(n: number) => save(r.user_id, { bonus: n })} /></td>
                      <td className={`${TD} px-2`} title={r.extra_note}><MoneyInput value={r.extra_allowance} disabled={r.locked} onSave={(n: number) => save(r.user_id, { extra_allowance: n })} /></td>
                      <td className={TD}>
                        {r.advance && !r.snapshot ? (
                          <button className={linkBtn} onClick={() => setDetail({ kind: "advance", row: r })}>{money(r.advance)}</button>
                        ) : money(r.advance)}
                      </td>
                      <td className={TD}>{money(r.social_insurance)}</td>
                      <td className={TD}>{money(r.union_fee)}</td>
                      <td className={`${TD} px-2`} title={r.other_note}><MoneyInput value={r.other_deduction} disabled={r.locked} onSave={(n: number) => save(r.user_id, { other_deduction: n })} /></td>
                      <td
                        className={`sticky right-0 z-10 border-b bg-background px-4 py-2.5 text-right text-lg font-bold tabular-nums whitespace-nowrap shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.25)] group-hover:bg-slate-50 ${r.net_pay < 0 ? "text-rose-600" : "text-slate-900"}`}
                        title={r.net_pay < 0 ? "Khấu trừ lớn hơn thu nhập — không chi lương, NV còn nợ số này" : undefined}
                      >
                        {money(r.net_pay)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td className="sticky left-0 z-10 border-r bg-slate-100 px-3 py-3 text-left">TỔNG CỘNG</td>
                  <td className="border-r bg-slate-100" colSpan={3} />
                  {["salary_by_days", "tech_revenue", "commission", "business_revenue", "overtime_amount", "travel_allowance", "bonus", "extra_allowance", "advance", "social_insurance", "union_fee", "other_deduction"].map((k) => (
                    <td key={k} className="border-r bg-slate-100 px-3 py-3 text-right tabular-nums">{money(sum(k))}</td>
                  ))}
                  <td className="sticky right-0 z-10 bg-primary/10 px-4 py-3 text-right text-lg tabular-nums text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.25)]" title="Tổng thực lĩnh (kể cả người âm)">
                    {money(sum("net_pay"))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </ScrollX>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-slate-50/60 px-4 py-3 text-[13px] text-muted-foreground">
            <span><strong className="text-slate-600">Lương TN</strong> = Lương CB ÷ công chuẩn × công</span>
            <span><strong className="text-slate-600">Tăng ca</strong> = Lương CB ÷ công chuẩn ÷ 8 × giờ × 1,5 (hoặc × 2)</span>
            <span><strong className="text-slate-600">DS kỹ thuật</strong>: chỉ lịch đã hoàn thành</span>
            <span><strong className="text-slate-600">Tạm ứng</strong>: phiếu "Chi tạm ứng lương" (tạm ứng công tác không trừ)</span>
            <span>Chưa chấm công thì chưa trừ BHXH/công đoàn</span>
            <button className="ml-auto underline" onClick={() => refetch()}>{isFetching ? "đang cập nhật…" : "tải lại"}</button>
          </div>
        </Card>
      )}

      {/* key theo người + loại: đổi người là state ghi chú làm mới hoàn toàn,
          không lưu nhầm ghi chú của người trước. */}
      <DetailDialog
        key={detail ? `${detail.kind}-${detail.row.user_id}` : "none"}
        detail={detail}
        onClose={() => setDetail(null)}
        month={month}
        onSave={save}
      />

      {/* Chi lương */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Chi lương tháng {month}</DialogTitle>
            <DialogDescription>
              Tạo 1 phiếu chi "Chi Lương" trong Sổ quỹ cho mỗi người chưa được chi. Bấm lại sẽ bỏ qua người đã chi — không tạo phiếu trùng.
            </DialogDescription>
          </DialogHeader>
          {payResult ? (
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto text-sm">
              {payResult.length === 0 && <div className="text-muted-foreground">Không còn ai cần chi.</div>}
              {payResult.map((r) => (
                <div key={r.user_id} className={`flex items-center gap-2 ${r.ok ? "" : "text-destructive"}`}>
                  {r.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4" />}
                  {r.name} — {r.ok ? `${r.code} · ${money(r.amount)}đ` : r.reason}
                </div>
              ))}
              <Button className="mt-2 w-full" onClick={() => setPayOpen(false)}>Đóng</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>Chi từ chi nhánh / quỹ *</Label>
                <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={payBranch} onChange={(e) => setPayBranch(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {(opts?.branches ?? [])
                    .filter((b: any) => data?.scopeAll || (data?.scopeBranchIds ?? []).includes(b.id))
                    .map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Hình thức</Label>
                <div className="mt-1.5 flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={payFund === "ngan_hang"} onChange={() => setPayFund("ngan_hang")} />Chuyển khoản</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={payFund === "tien_mat"} onChange={() => setPayFund("tien_mat")} />Tiền mặt</label>
                </div>
              </div>
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                Sẽ chi cho <strong>{lockedUnpaid.filter((r) => r.net_pay > 0).length}</strong> người đã chốt, tổng{" "}
                <strong className="text-base">{money(lockedUnpaid.filter((r) => r.net_pay > 0).reduce((a, r) => a + r.net_pay, 0))}đ</strong>
                {draftCount > 0 && <div className="mt-1 text-orange-700">{draftCount} người chưa chốt sẽ không được chi.</div>}
              </div>
              <Button
                className="w-full"
                disabled={!payBranch || !!busy}
                onClick={() =>
                  run("pay", async () => {
                    const r = await payFn({ data: { month, fundType: payFund, branchId: payBranch, userIds: rows.map((x) => x.user_id), actorId } });
                    setPayResult(r.results);
                    refresh();
                    qc.invalidateQueries({ queryKey: ["cash"] });
                  })
                }
              >
                {busy === "pay" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Tạo phiếu chi
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailDialog({ detail, onClose, onSave }: any) {
  const r = detail?.row;
  const [notes, setNotes] = useState<any>({});
  const open = Boolean(detail);
  const k = detail?.kind;
  const TBL = "w-full text-sm";
  const HEAD = "border-b text-left text-muted-foreground [&_th]:py-2 [&_th]:font-medium";
  const ROW = "border-b last:border-0 [&_td]:py-2";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setNotes({}); } }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {r && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">
                {k === "tech" && `DS kỹ thuật — ${r.full_name}`}
                {k === "sales" && `DS bán hàng — ${r.full_name}`}
                {k === "business" && `DS kinh doanh — ${r.full_name}`}
                {k === "advance" && `Tạm ứng lương — ${r.full_name}`}
                {k === "notes" && `Ghi chú & điều chỉnh — ${r.full_name}`}
              </DialogTitle>
              {k === "tech" && <DialogDescription>Tổng: <strong>{money(r.tech_revenue)}đ</strong> từ {(r.tech_lines ?? []).length} lịch đã hoàn thành.</DialogDescription>}
            </DialogHeader>

            {k === "tech" && (
              <table className={TBL}>
                <thead className={HEAD}>
                  <tr><th>Ngày</th><th>Công việc</th><th>Loại / phụ phí</th><th className="text-right">Số người</th><th className="text-right">Phần của NV</th></tr>
                </thead>
                <tbody>
                  {(r.tech_lines ?? []).length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Không có lịch đã hoàn thành trong tháng.</td></tr>}
                  {(r.tech_lines ?? []).map((l: any) => (
                    <tr key={l.schedule_id} className={ROW}>
                      <td className="whitespace-nowrap pr-3">{formatDateVN(l.scheduled_date)}</td>
                      <td className="pr-3">{l.title}</td>
                      <td className="pr-3 text-muted-foreground">
                        {l.work_type ? `${l.work_type.name}${l.work_type.qty > 1 ? ` ×${l.work_type.qty}` : ""}` : ""}
                        {(l.difficulties ?? []).map((d: any) => ` + ${d.name}${d.qty > 1 ? ` ×${d.qty}` : ""}`).join("")}
                      </td>
                      <td className="text-right">{l.num_people}</td>
                      <td className="text-right font-semibold tabular-nums">{money(l.money_share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {(k === "sales" || k === "business") && (
              <SalesDetail r={r} kind={k} onSave={onSave} onClose={onClose} />
            )}

            {k === "advance" && (
              <table className={TBL}>
                <thead className={HEAD}><tr><th>Ngày</th><th>Phiếu</th><th>Ghi chú</th><th className="text-right">Số tiền</th></tr></thead>
                <tbody>
                  {(r.advance_vouchers ?? []).map((v: any) => (
                    <tr key={v.id} className={ROW}>
                      <td className="pr-3">{formatDateVN(String(v.created_at).slice(0, 10))}</td>
                      <td className="pr-3 font-mono">{v.code}</td>
                      <td className="pr-3">{v.note}</td>
                      <td className={`text-right tabular-nums ${v.amount < 0 ? "text-emerald-700" : ""}`}>{money(v.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {k === "notes" && (
              <div className="space-y-4 text-sm">
                {[
                  ["travel_note", "Diễn giải xăng xe đi tỉnh", "vd: 11/6 Biên Hoà, 27/6 Long An"],
                  ["extra_note", "Ghi chú phụ cấp", "vd: kéo thêm đoạn điện về tụ"],
                  ["other_note", "Ghi chú trừ khác", ""],
                ].map(([f, l, ph]) => (
                  <div key={f}>
                    <Label>{l}</Label>
                    <Input className="mt-1.5" placeholder={ph} defaultValue={r[f] ?? ""} onChange={(e) => setNotes((p: any) => ({ ...p, [f]: e.target.value }))} />
                  </div>
                ))}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>Huỷ</Button>
                  <Button
                    onClick={async () => {
                      await onSave(r.user_id, notes);
                      setNotes({});
                      onClose();
                    }}
                  >
                    Lưu
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hồ sơ lương
// ═══════════════════════════════════════════════════════════════════════════
function ProfilesTab({ actorId }: { actorId?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPayProfilesFn);
  const saveFn = useServerFn(upsertPayProfileFn);
  const { data, isLoading, error } = useQuery({ queryKey: ["payProfiles"], queryFn: () => listFn({ data: { actorId } }) });
  const [edit, setEdit] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await saveFn({ data: { ...edit, actorId } });
      toast.success("Đã lưu hồ sơ lương");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["payProfiles"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loading />;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  const list = ((data ?? []) as any[]).filter((u) => showAll || u.profile?.in_payroll);
  const TH = "border-b bg-slate-50 px-4 py-3 text-[13px] font-semibold text-slate-600 whitespace-nowrap";
  const TD = "border-b px-4 py-3 align-middle";

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
        <div className="min-w-0 max-w-3xl">
          <div className="text-lg font-semibold">Hồ sơ lương nhân viên</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Chỉ người có hồ sơ và bật "Có trong bảng lương" mới xuất hiện ở tab Chấm công / Bảng lương.
            Người có quyền "Quản lý lương nhân sự" thấy chính mình + những nhân viên admin đã phân cho họ ở tab Phân việc.
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
          <input type="checkbox" className="h-4 w-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Hiện tất cả nhân viên (để thêm người mới)
        </label>
      </div>
      <ScrollX>
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Nhân viên</th>
              <th className={`${TH} text-left`}>Chi nhánh</th>
              <th className={`${TH} text-right`}>Lương CB</th>
              <th className={`${TH} text-center`}>Công chuẩn</th>
              <th className={`${TH} text-center`}>DS kỹ thuật</th>
              <th className={`${TH} text-left`}>Ngân hàng</th>
              <th className={`${TH} w-24`} />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có ai. Tick "Hiện tất cả nhân viên" để thêm.</td></tr>}
            {list.map((u) => {
              const p = u.profile;
              const off = !p?.in_payroll;
              return (
                <tr key={u.user_id} className={`hover:bg-slate-50 ${off ? "opacity-60" : ""}`}>
                  <td className={TD}>
                    <div className="font-semibold text-slate-800">{u.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p?.position || "—"}
                      {p && !p.in_payroll && <span className="ml-1.5 rounded bg-slate-200 px-1.5 text-[11px]">không trong bảng lương</span>}
                    </div>
                  </td>
                  <td className={`${TD} max-w-[260px]`}>
                    {(u.branches ?? []).length ? (
                      <div className="flex flex-wrap gap-1">
                        {(u.branches ?? []).map((b: string) => <span key={b} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{b}</span>)}
                      </div>
                    ) : <span className="text-xs font-medium text-orange-600">Chưa gán chi nhánh</span>}
                  </td>
                  <td className={`${TD} text-right text-base font-semibold tabular-nums`}>{p ? money(p.base_salary) : ""}</td>
                  <td className={`${TD} text-center tabular-nums`}>{p?.standard_days ?? ""}</td>
                  <td className={`${TD} text-center`}>
                    {p?.tech_revenue ? <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Có</span> : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className={TD}>
                    {p?.bank_account ? (
                      <>
                        <div className="text-xs text-muted-foreground">{p.bank_name}</div>
                        <div className="font-mono">{p.bank_account}</div>
                      </>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Button size="sm" variant={p ? "ghost" : "outline"} onClick={() => setEdit({ user_id: u.user_id, full_name: u.full_name, standard_days: 26, in_payroll: true, ...(p ?? {}) })}>
                      {p ? <><Pencil className="mr-1 h-4 w-4" />Sửa</> : <><Plus className="mr-1 h-4 w-4" />Thêm</>}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">Hồ sơ lương — {edit?.full_name}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-5 text-sm">
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thông tin chung</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[["position", "Chức vụ / bộ phận", "Kỹ thuật"], ["area", "Khu vực", "HCM"], ["start_label", "Năm bắt đầu làm", "Tháng 3.2018"]].map(([f, l, ph]) => (
                    <div key={f}><Label>{l}</Label><Input className="mt-1.5" placeholder={ph} value={edit[f] ?? ""} onChange={(e) => setEdit({ ...edit, [f]: e.target.value })} /></div>
                  ))}
                </div>
              </section>
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lương & khấu trừ cố định</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><Label>Lương cơ bản *</Label><Input className="mt-1.5 font-semibold" inputMode="numeric" value={edit.base_salary ?? ""} onChange={(e) => setEdit({ ...edit, base_salary: e.target.value.replace(/[^\d]/g, "") })} /></div>
                  <div><Label>Số công chuẩn</Label><Input className="mt-1.5" inputMode="decimal" value={edit.standard_days ?? 26} onChange={(e) => setEdit({ ...edit, standard_days: e.target.value })} /></div>
                  <div><Label>BHXH trừ/tháng</Label><Input className="mt-1.5" inputMode="numeric" value={edit.social_insurance ?? ""} onChange={(e) => setEdit({ ...edit, social_insurance: e.target.value.replace(/[^\d]/g, "") })} /></div>
                  <div><Label>Công đoàn/tháng</Label><Input className="mt-1.5" inputMode="numeric" value={edit.union_fee ?? ""} onChange={(e) => setEdit({ ...edit, union_fee: e.target.value.replace(/[^\d]/g, "") })} /></div>
                </div>
              </section>
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tài khoản nhận lương</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div><Label>Ngân hàng</Label><Input className="mt-1.5" placeholder="MSB, Vietcombank..." value={edit.bank_name ?? ""} onChange={(e) => setEdit({ ...edit, bank_name: e.target.value })} /></div>
                  <div><Label>Số tài khoản</Label><Input className="mt-1.5 font-mono" value={edit.bank_account ?? ""} onChange={(e) => setEdit({ ...edit, bank_account: e.target.value })} /></div>
                  <div><Label>Chủ tài khoản</Label><Input className="mt-1.5" value={edit.bank_owner ?? ""} onChange={(e) => setEdit({ ...edit, bank_owner: e.target.value })} /></div>
                </div>
              </section>
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thu nhập theo doanh số</div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 hover:bg-muted/40">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!edit.tech_revenue} onChange={(e) => setEdit({ ...edit, tech_revenue: e.target.checked })} />
                  <span><strong>Tính lương doanh số từ Lịch làm việc</strong><br /><span className="text-muted-foreground">Kỹ thuật viên — tiền công các lịch đã hoàn thành được phân công.</span></span>
                </label>
                <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                  <strong className="text-foreground">DS bán hàng / DS kinh doanh</strong> tự tính theo <strong className="text-foreground">chức vụ</strong> ở trang Nhân viên
                  (Quản lý bán hàng, Nhân viên bán hàng, Kinh doanh) từ tiền thực thu trong tháng. Hệ số và KPI đặt ở tab Phân việc.
                </div>
              </section>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4" checked={edit.in_payroll !== false} onChange={(e) => setEdit({ ...edit, in_payroll: e.target.checked })} />
                <span className="font-medium">Có trong bảng lương</span>
              </label>
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setEdit(null)}>Huỷ</Button>
                <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lưu hồ sơ</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Phân việc (chỉ admin): ai quản lý lương ai
// ═══════════════════════════════════════════════════════════════════════════
function AssignTab({ actorId }: { actorId?: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPayrollAssignmentsFn);
  const setFn = useServerFn(setPayrollAssignmentsFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["payrollAssignments"],
    queryFn: () => getFn({ data: { actorId } }),
  });
  const [managerId, setManagerId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyPayroll, setOnlyPayroll] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const optsFn = useServerFn(getFormOptionsFn);
  const { data: opts } = useQuery({ queryKey: ["branches_list"], queryFn: () => optsFn(), staleTime: 300_000 });
  const posName = (id?: string | null) => ((opts as any)?.positions ?? []).find((p: any) => p.id === id)?.name ?? null;

  const managers = (data?.managers ?? []) as any[];
  const current = managers.find((m) => m.id === managerId) ?? managers[0] ?? null;
  // Nhân viên bán hàng đang được > 1 quản lý bán hàng cùng tick → DS chỉ tính theo 1 người.
  const dupSales = useMemo(() => {
    const salesMgr = new Set(managers.filter((m) => m.position_id === "pos_sales_manager").map((m) => m.id));
    const count = new Map<string, string[]>();
    for (const a of (data?.assignments ?? []) as any[]) {
      if (!salesMgr.has(a.manager_id)) continue;
      count.set(a.user_id, [...(count.get(a.user_id) ?? []), a.manager_id]);
    }
    return new Map([...count.entries()].filter(([, v]) => v.length > 1));
  }, [data, managers]);
  const nameById = (id: string) => ((data?.staff ?? []) as any[]).find((u) => u.id === id)?.full_name ?? id;

  const assigned = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of (data?.assignments ?? []) as any[]) (m.get(a.manager_id) ?? m.set(a.manager_id, new Set()).get(a.manager_id)).add(a.user_id);
    return m;
  }, [data]);
  const mine = (current && assigned.get(current.id)) || new Set<string>();

  const staff = useMemo(() => {
    const k = q.trim().toLowerCase();
    return ((data?.staff ?? []) as any[])
      .filter((u) => current && u.id !== current.id && !u.is_admin)
      .filter((u) => !onlyPayroll || u.in_payroll || mine.has(u.id))
      .filter((u) => !k || u.full_name.toLowerCase().includes(k) || u.branches.join(" ").toLowerCase().includes(k))
      // Người đã được phân lên đầu
      .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.full_name.localeCompare(b.full_name, "vi"));
  }, [data, current, q, onlyPayroll, mine]);

  async function toggle(userIds: string[], on: boolean) {
    if (!current || !userIds.length) return;
    setPending((p) => new Set([...p, ...userIds]));
    try {
      await setFn({ data: { actorId, managerId: current.id, userIds, assigned: on } });
      await qc.invalidateQueries({ queryKey: ["payrollAssignments"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["payProfiles"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu phân việc");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        userIds.forEach((u) => n.delete(u));
        return n;
      });
    }
  }

  if (isLoading) return <Loading />;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  if (!managers.length) {
    return (
      <Card className="py-12 text-center">
        <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <div className="text-base font-semibold">Chưa có ai có quyền "Quản lý lương nhân sự"</div>
        <div className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Vào trang <strong className="text-foreground">Nhân viên</strong>, sửa tài khoản người phụ trách và tick quyền
          "Quản lý lương nhân sự". Sau đó quay lại đây để chọn những nhân viên họ được quản lý lương.
        </div>
      </Card>
    );
  }

  const visibleIds = staff.map((u) => u.id);
  const visibleOn = visibleIds.filter((id) => mine.has(id));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* Người quản lý */}
      <Card className="self-start p-0 overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="font-semibold">Người quản lý lương</div>
          <div className="text-xs text-muted-foreground">Có quyền "Quản lý lương nhân sự"</div>
        </div>
        <div className="divide-y">
          {managers.map((m) => {
            const n = assigned.get(m.id)?.size ?? 0;
            const active = current?.id === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setManagerId(m.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${active ? "bg-primary/10" : "hover:bg-muted/50"}`}
              >
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  {m.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-medium ${active ? "text-primary" : ""}`}>{m.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[posName(m.position_id), m.branches.join(", ") || "Chưa gán chi nhánh"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span
                  title="Số nhân viên được phân thêm (ngoài bản thân)"
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${n ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Nhân viên được quản lý */}
      {current && (
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-4 py-3">
            <div className="text-lg font-semibold">
              {current.full_name} <span className="font-normal text-muted-foreground">được quản lý lương của</span>{" "}
              <span className="text-primary">bản thân + {mine.size} nhân viên</span>
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              Tick để cho phép xem / sửa lương cơ bản, DS bán hàng, ngân hàng, chấm công, chốt & chi lương của nhân viên đó.
              Lưu ngay khi tick. <strong className="text-foreground">Lương và chấm công của chính {current.full_name} luôn được quản lý</strong> — không cần tick.
            </div>
          </div>
          {current.position_id === "pos_sales_manager" && (
            <SalesSettingsBox key={current.id} manager={current} data={data} actorId={actorId} />
          )}
          {dupSales.size > 0 && (
            <div className="border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />Nhân viên bị nhiều quản lý bán hàng cùng tick</div>
              <ul className="mt-1 list-disc pl-6">
                {[...dupSales.entries()].map(([u, ms]) => (
                  <li key={u}>{nameById(u)}: {ms.map(nameById).join(", ")} — DS bán hàng chỉ tính theo {nameById(ms.slice().sort((a, b) => nameById(a).localeCompare(nameById(b), "vi"))[0])}. Nên bỏ tick bớt.</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/60 px-4 py-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Tìm tên, chi nhánh..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={onlyPayroll} onChange={(e) => setOnlyPayroll(e.target.checked)} />
              Chỉ người có trong bảng lương
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={!visibleIds.length || visibleOn.length === visibleIds.length}
              onClick={() => toggle(visibleIds.filter((id) => !mine.has(id)), true)}
            >
              Chọn tất cả ({visibleIds.length - visibleOn.length})
            </Button>
            <Button variant="outline" size="sm" disabled={!visibleOn.length} onClick={() => toggle(visibleOn, false)}>
              Bỏ tất cả
            </Button>
          </div>
          <div className="divide-y">
            {staff.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Không có nhân viên phù hợp{onlyPayroll ? " — bỏ tick “Chỉ người có trong bảng lương” để xem tất cả" : ""}.
              </div>
            )}
            {staff.map((u) => {
              const on = mine.has(u.id);
              const busy = pending.has(u.id);
              return (
                <label key={u.id} className={`flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40 ${on ? "bg-emerald-50/50" : ""}`}>
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={on} disabled={busy} onChange={(e) => toggle([u.id], e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {u.full_name}
                      {!u.in_payroll && <span className="rounded bg-slate-100 px-1.5 text-[11px] font-normal text-slate-500">chưa có hồ sơ lương</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[posName(u.position_id) ?? u.position, u.branches.join(", ") || "Chưa gán chi nhánh"].filter(Boolean).join(" · ")}
                      {dupSales.has(u.id) && <span className="ml-1.5 font-medium text-amber-700">· trùng quản lý bán hàng</span>}
                    </div>
                  </div>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : on && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                </label>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Chi tiết cách tính DS bán hàng / DS kinh doanh + các khoản tiền thực thu. */
function SalesDetail({ r, kind, onSave, onClose }: any) {
  const { isAdmin } = useAuth();
  const isSales = kind === "sales";
  const d = isSales ? r.sales_detail : r.business_detail;
  const overrideKey = isSales ? "commission_override" : "business_override";
  const current = isSales ? r.commission : r.business_revenue;
  const auto = isSales ? r.commission_auto : r.business_auto;
  const [ov, setOv] = useState<string>(r[overrideKey] === null || r[overrideKey] === undefined ? "" : String(r[overrideKey]));
  const [saving, setSaving] = useState(false);
  const lines = (r.revenue_lines ?? []) as any[];
  const KIND: Record<string, string> = { order: "Thu tại đơn", debt: "Khách trả nợ", refund: "Hoàn tiền trả hàng" };
  const Row = ({ label, value, strong = false }: any) => (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "border-t font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4 text-sm">
      {r.snapshot ? (
        <div className="rounded-lg bg-muted/50 p-3">Đã chốt lương — số liệu được giữ nguyên: <strong>{money(current)}đ</strong>.</div>
      ) : !d ? (
        <div className="rounded-lg bg-muted/50 p-3 text-muted-foreground">
          {isSales
            ? 'Chỉ tính cho chức vụ "Quản lý bán hàng" / "Nhân viên bán hàng" (đặt ở trang Nhân viên).'
            : 'Chỉ tính cho chức vụ "Kinh doanh" (đặt ở trang Nhân viên).'}
        </div>
      ) : (
        <>
          {(d.warnings ?? []).map((w: string) => (
            <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}
            </div>
          ))}

          {isSales && d.role === "manager" && (
            <div className="rounded-lg border p-3">
              <div className="mb-2 font-semibold">Quản lý bán hàng: DS = SUM × {d.coef}%</div>
              <table className="w-full">
                <tbody>
                  {d.members.map((m: any) => (
                    <tr key={m.user_id} className="border-b last:border-0">
                      <td className="py-1.5">{m.full_name}{m.self && <span className="ml-1.5 text-xs text-muted-foreground">(bản thân)</span>}</td>
                      <td className="text-right tabular-nums">{money(m.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Row label="SUM (tổng thực thu cả nhóm)" value={`${money(d.sum)}đ`} strong />
              <Row label={`× hệ số ${d.coef}%`} value={<strong className="text-primary">{money(auto)}đ</strong>} />
            </div>
          )}

          {isSales && d.role === "staff" && d.y !== undefined && (
            <div className="rounded-lg border p-3">
              <div className="mb-1 font-semibold">Nhân viên bán hàng: DS = x ÷ y × 1% × max(0, SUM − KPI)</div>
              <div className="mb-2 text-xs text-muted-foreground">Nhóm của quản lý bán hàng <strong>{d.manager_name}</strong></div>
              <Row label="x — doanh thu thực thu của bạn" value={`${money(d.x)}đ`} />
              <Row label="y = SUM — tổng thực thu cả nhóm" value={`${money(d.y)}đ`} />
              {d.kpi !== undefined && (
                <>
                  <Row label="k = x ÷ y" value={`${((d.ratio ?? 0) * 100).toFixed(2)}%`} />
                  <Row label={`KPI của nhóm${d.kpi_month ? ` (đặt tháng ${d.kpi_month.slice(5)}/${d.kpi_month.slice(0, 4)})` : ""}`} value={`${money(d.kpi)}đ`} />
                  <Row label="T = SUM − KPI" value={d.below_kpi ? <span className="text-rose-600">Chưa đạt KPI → 0</span> : `${money(d.T)}đ`} />
                  <Row label="DS = k × 1% × T" value={<strong className="text-primary">{money(auto)}đ</strong>} strong />
                </>
              )}
            </div>
          )}

          {!isSales && (
            <div className="rounded-lg border p-3">
              <div className="mb-2 font-semibold">Kinh doanh: DS = {d.rate}% × doanh thu thực thu</div>
              <Row label="Doanh thu thực thu trong tháng" value={`${money(d.revenue)}đ`} />
              <Row label={`× ${d.rate}%`} value={<strong className="text-primary">{money(auto)}đ</strong>} strong />
            </div>
          )}

          {lines.length > 0 && (
            <details className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2 font-medium">Các khoản thu của {r.full_name} trong tháng ({lines.length})</summary>
              <div className="max-h-72 overflow-y-auto px-3 pb-2">
                <table className="w-full">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr><th className="py-1.5">Ngày</th><th>Loại</th><th>Đơn</th><th>Phiếu</th><th className="text-right">Số tiền</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">{formatDateVN(String(l.date).slice(0, 10))}</td>
                        <td className="pr-2">{KIND[l.kind] ?? l.kind}{l.customer_name ? <span className="block text-xs text-muted-foreground">{l.customer_name}</span> : null}</td>
                        <td className="pr-2 font-mono text-xs">{l.order_code}</td>
                        <td className="pr-2 font-mono text-xs">{l.voucher_code}</td>
                        <td className={`text-right tabular-nums ${l.amount < 0 ? "text-rose-600" : ""}`}>{money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pt-2 text-xs text-muted-foreground">
                  Tiền khách trả nợ được trừ vào các đơn còn nợ cũ nhất của khách trước, rồi tính cho người bán đơn đó.
                </div>
              </div>
            </details>
          )}
        </>
      )}

      {/* Ghi đè: CHỈ admin (server cũng chặn). */}
      {isAdmin && !r.locked && (
        <div className="rounded-lg border border-dashed p-3">
          <Label>Ghi đè số tiền (chỉ admin) — để trống = dùng số tự tính {money(auto)}đ</Label>
          <div className="mt-1.5 flex gap-2">
            <Input inputMode="numeric" placeholder="Tự tính" value={ov} onChange={(e) => setOv(e.target.value.replace(/[^\d]/g, ""))} />
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onSave(r.user_id, { [overrideKey]: ov === "" ? null : Number(ov) });
                setSaving(false);
                onClose();
              }}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lưu
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hệ số % và KPI theo tháng của MỘT quản lý bán hàng (chỉ admin, trong tab
 * Phân việc). KPI tháng chưa đặt = dùng KPI tháng gần nhất trước đó.
 */
function SalesSettingsBox({ manager, data, actorId }: any) {
  const qc = useQueryClient();
  const coefFn = useServerFn(setSalesCoefFn);
  const kpiFn = useServerFn(setSalesKpiFn);
  const [month, setMonth] = useState(todayVN().slice(0, 7));
  const settings = ((data?.salesSettings ?? []) as any[]).find((x) => x.manager_id === manager.id);
  const coef = settings ? Number(settings.coef) : Number(data?.defaultCoef ?? 0.5);
  const kpis = ((data?.salesKpis ?? []) as any[]).filter((k) => k.manager_id === manager.id);
  const own = kpis.find((k) => k.month === month);
  const inherited = [...kpis].filter((k) => k.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
  const [coefDraft, setCoefDraft] = useState<string | null>(null);
  const [kpiDraft, setKpiDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [y, mm] = month.split("-");

  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["payrollAssignments"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-b bg-primary/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <TrendingUp className="h-4 w-4 text-primary" />DS bán hàng của nhóm
      </div>
      {!data?.salesReady && (
        <div className="mb-2 text-sm text-orange-700">Cần chạy sql_migration_v19_sales_revenue.sql trước khi đặt hệ số / KPI.</div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-background p-3">
          <Label>Hệ số của {manager.full_name} (%)</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              inputMode="decimal"
              value={coefDraft ?? String(coef)}
              onChange={(e) => setCoefDraft(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            />
            <Button
              variant="outline"
              disabled={coefDraft === null || busy === "coef"}
              onClick={() => run("coef", () => coefFn({ data: { actorId, managerId: manager.id, coef: Number(coefDraft) } }), "Đã lưu hệ số").then(() => setCoefDraft(null))}
            >
              {busy === "coef" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
            </Button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">DS quản lý = SUM (thực thu bản thân + mọi người được phân) × hệ số. Mặc định 0,5%.</div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>KPI tháng {Number(mm)}/{y}</Label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMonth(shiftMonth(month, -1)); setKpiDraft(null); }}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMonth(shiftMonth(month, 1)); setKpiDraft(null); }}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="mt-1.5 flex gap-2">
            <Input
              inputMode="numeric"
              placeholder={inherited ? `${money(inherited.kpi)} (theo tháng ${inherited.month.slice(5)}/${inherited.month.slice(0, 4)})` : "Chưa đặt"}
              value={kpiDraft ?? (own ? money(own.kpi) : "")}
              onFocus={() => kpiDraft === null && setKpiDraft(own ? String(own.kpi) : "")}
              onChange={(e) => setKpiDraft(e.target.value.replace(/[^\d]/g, ""))}
            />
            <Button
              variant="outline"
              disabled={kpiDraft === null || busy === "kpi"}
              onClick={() =>
                run("kpi", () => kpiFn({ data: { actorId, managerId: manager.id, month, kpi: kpiDraft === "" ? null : Number(kpiDraft) } }), "Đã lưu KPI").then(() => setKpiDraft(null))
              }
            >
              {busy === "kpi" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
            </Button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {own
              ? `Đang dùng KPI đặt riêng cho tháng này. Xoá trống rồi Lưu để dùng lại KPI tháng trước.`
              : inherited
                ? `Chưa đặt riêng — đang dùng KPI tháng ${inherited.month.slice(5)}/${inherited.month.slice(0, 4)}.`
                : "Chưa có KPI → DS nhân viên bán hàng của nhóm tạm = 0."}{" "}
            NVBH = doanh thu mình ÷ SUM × 1% × (SUM − KPI).
          </div>
        </div>
      </div>
    </div>
  );
}
