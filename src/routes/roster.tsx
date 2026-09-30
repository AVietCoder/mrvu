// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import {
  getRosterMonthFn,
  setRosterCellFn,
  setDayOffFn,
  copyRosterWeekFn,
  upsertShiftFn,
  deleteShiftFn,
} from "@/lib/hr.functions";
import { AppShell, Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { hasPermission } from "@/lib/types";
import { buildShortNames } from "@/lib/staff-name";
import { exportRosterExcel } from "@/lib/export-hr";
import { todayVN } from "@/lib/date-vn";
import {
  ChevronLeft, ChevronRight, Copy, Download, Loader2, Plus, Settings2, Trash2, Pencil, Search,
  CalendarDays, CalendarRange, Lock, Clock, Building2, CalendarOff,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/roster")({
  head: () => ({ meta: [{ title: "Lịch trực — Mr.Vũ" }] }),
  component: RosterPage,
});

// ─── Ngày tháng ────────────────────────────────────────────────────────────
const WD_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WD_LONG = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const addMonths = (d: string, n: number) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
/** Thứ Hai của tuần chứa ngày d (dùng cho Sao chép tuần). */
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

// ─── Màu cố định cho từng nhân viên ────────────────────────────────────────
// Cùng một người luôn cùng một màu ở mọi ô, mọi tuần → nhìn lướt là dò được
// lịch của một người, không phải đọc từng chữ như trên Excel.
const PALETTE = [
  "bg-sky-100 text-sky-900 border-sky-200",
  "bg-emerald-100 text-emerald-900 border-emerald-200",
  "bg-violet-100 text-violet-900 border-violet-200",
  "bg-rose-100 text-rose-900 border-rose-200",
  "bg-teal-100 text-teal-900 border-teal-200",
  "bg-orange-100 text-orange-900 border-orange-200",
  "bg-indigo-100 text-indigo-900 border-indigo-200",
  "bg-lime-100 text-lime-900 border-lime-200",
  "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200",
  "bg-cyan-100 text-cyan-900 border-cyan-200",
  "bg-stone-200 text-stone-900 border-stone-300",
  "bg-pink-100 text-pink-900 border-pink-200",
];
const colorOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

function RosterPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  // ── Quyền: xem thì ai cũng xem; sửa chỉ các chi nhánh mình được gán ──
  const hasRosterPerm = Boolean(user && (isAdmin || hasPermission(user as any, "manage_roster")));
  const myBranches = useMemo(() => new Set<string>(user?.branch_ids ?? []), [user]);
  const canEditBranch = (bid: string) => isAdmin || (hasRosterPerm && myBranches.has(bid));
  const canEditUser = (u: any) => isAdmin || (hasRosterPerm && (u?.branch_ids ?? []).some((b: string) => myBranches.has(b)));

  const getFn = useServerFn(getRosterMonthFn);
  const cellFn = useServerFn(setRosterCellFn);
  const offFn = useServerFn(setDayOffFn);
  const copyFn = useServerFn(copyRosterWeekFn);

  const today = todayVN();
  const [view, setView] = useState<"week" | "month">("week");
  // Chế độ Tuần = 7 ngày liên tiếp BẮT ĐẦU TỪ anchor (mặc định hôm nay).
  const [anchor, setAnchor] = useState(today);
  const [branchFilter, setBranchFilter] = useState("");
  const [tab, setTab] = useState<"grid" | "shifts">("grid");

  const range = useMemo(
    () => (view === "week" ? { from: anchor, to: addDays(anchor, 6) } : { month: anchor.slice(0, 7) }),
    [view, anchor],
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["roster", view, range, user?.id],
    // Server chỉ trả chi nhánh người xem được phân quyền (admin thấy hết).
    queryFn: () => getFn({ data: { ...range, actorId: user?.id } }),
    enabled: Boolean(user?.id),
    placeholderData: (prev) => prev,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["roster"] });

  const users = data?.users ?? [];
  const userById = useMemo(() => new Map(users.map((u: any) => [u.id, u])), [users]);
  const short = useMemo(() => buildShortNames(users), [users]);
  const fullName = (id: string) => userById.get(id)?.full_name ?? id;
  const branchName = useMemo(() => new Map((data?.branches ?? []).map((b: any) => [b.id, b.name])), [data]);

  // Ca đang bật, gom theo chi nhánh
  const groups = useMemo(() => {
    const shifts = (data?.shifts ?? []).filter((s: any) => s.is_active && (!branchFilter || s.branch_id === branchFilter));
    const m = new Map<string, any[]>();
    for (const s of shifts) (m.get(s.branch_id) ?? m.set(s.branch_id, []).get(s.branch_id)).push(s);
    return [...m.entries()]
      .map(([bid, list]) => ({ branchId: bid, name: branchName.get(bid) ?? bid, shifts: list.sort((a, b) => a.sort_order - b.sort_order) }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [data, branchFilter, branchName]);

  const byCell = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of data?.entries ?? []) {
      if (!e.shift_id) continue;
      const k = `${e.work_date}|${e.shift_id}`;
      (m.get(k) ?? m.set(k, []).get(k)).push(e);
    }
    return m;
  }, [data]);
  const offByDate = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of data?.entries ?? []) {
      if (e.shift_id) continue;
      (m.get(e.work_date) ?? m.set(e.work_date, []).get(e.work_date)).push(e);
    }
    return m;
  }, [data]);

  const dates: string[] = data?.dates ?? [];
  const editableBranchIds = useMemo(
    () => (data?.branches ?? []).filter((b: any) => canEditBranch(b.id)).map((b: any) => b.id),
    [data, isAdmin, hasRosterPerm, myBranches],
  );

  // ── Điều hướng ──
  const isWeek = view === "week";
  const title = isWeek
    ? `${dm(anchor)} – ${dm(addDays(anchor, 6))}/${addDays(anchor, 6).slice(0, 4)}`
    : `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;
  const go = (delta: number) => setAnchor(isWeek ? addDays(anchor, 7 * delta) : addMonths(anchor, delta));
  const switchView = (v: "week" | "month") => {
    if (v === view) return;
    // Sang Tuần: nếu đang xem tháng hiện tại thì bắt đầu từ hôm nay, không thì từ đầu tháng đó.
    if (v === "week") setAnchor(anchor.slice(0, 7) === today.slice(0, 7) ? today : `${anchor.slice(0, 7)}-01`);
    setView(v);
  };

  // ── Ô ca ──
  const [cell, setCell] = useState<null | { date: string; shift: any }>(null);
  const [picked, setPicked] = useState<Record<string, { half: boolean; note: string }>>({});
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  function openCell(date: string, shift: any) {
    if (!canEditBranch(shift.branch_id)) return;
    const cur: Record<string, any> = {};
    for (const e of byCell.get(`${date}|${shift.id}`) ?? []) cur[e.user_id] = { half: e.kind === "half_off", note: e.note ?? "" };
    setPicked(cur);
    setQ("");
    setCell({ date, shift });
  }
  async function saveCell() {
    if (!cell || saving) return;
    setSaving(true);
    try {
      await cellFn({
        data: {
          date: cell.date,
          shiftId: cell.shift.id,
          people: Object.entries(picked).map(([user_id, v]) => ({ user_id, half: v.half, note: v.note })),
          actorId: user?.id,
        },
      });
      setCell(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }

  // ── Nghỉ ──
  const [offDate, setOffDate] = useState<string | null>(null);
  const [offUser, setOffUser] = useState("");
  const [offKind, setOffKind] = useState<"off" | "holiday">("off");
  async function addOff() {
    if (!offDate || !offUser) return;
    try {
      const r = await offFn({ data: { date: offDate, userId: offUser, kind: offKind, actorId: user?.id } });
      if (r.removedShifts) toast.info(`Đã gỡ ${fullName(offUser)} khỏi ${r.removedShifts} ca trong ngày`);
      setOffUser("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }
  async function removeOff(uid_: string) {
    try {
      await offFn({ data: { date: offDate, userId: uid_, kind: null, actorId: user?.id } });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  // ── Sao chép tuần ──
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState(mondayOf(addDays(today, -7)));
  const [copyTo, setCopyTo] = useState(mondayOf(today));
  const [copyBranch, setCopyBranch] = useState("");
  const [copying, setCopying] = useState(false);
  async function doCopy(overwrite = false) {
    setCopying(true);
    try {
      const r = await copyFn({
        data: { fromStart: mondayOf(copyFrom), toStart: mondayOf(copyTo), branchId: copyBranch || undefined, overwrite, actorId: user?.id },
      });
      if (r.needConfirm) {
        if (window.confirm(`Tuần đích đã có ${r.existing} lượt xếp ca. Ghi đè toàn bộ?`)) return doCopy(true);
        return;
      }
      toast.success(`Đã sao chép ${r.copied} lượt`);
      setCopyOpen(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi sao chép");
    } finally {
      setCopying(false);
    }
  }

  function exportExcel() {
    if (!data) return;
    const label = (e: any) => `${short.get(e.user_id) ?? ""}${e.kind === "half_off" ? " (½)" : ""}${e.note ? ` - ${e.note}` : ""}`;
    exportRosterExcel({
      month: dates[0]?.slice(0, 7) ?? anchor.slice(0, 7),
      sheetName: isWeek ? `${dm(dates[0]).replace("/", "-")} đến ${dm(dates[dates.length - 1]).replace("/", "-")}` : undefined,
      fileName: isWeek ? `lich-truc-${dates[0]}-den-${dates[dates.length - 1]}.xlsx` : undefined,
      dates,
      rows: groups.flatMap((g) =>
        g.shifts.map((s: any) => ({
          branch: g.name,
          shift: s.name,
          cells: Object.fromEntries(dates.map((d) => [d, (byCell.get(`${d}|${s.id}`) ?? []).map(label).join("\n")])),
        })),
      ),
      offCells: Object.fromEntries(
        dates.map((d) => [d, (offByDate.get(d) ?? []).map((e: any) => `${short.get(e.user_id)} ${e.kind === "holiday" ? "lễ" : "OFF"}`).join("\n")]),
      ),
    }).catch((e) => toast.error(e?.message ?? "Xuất Excel thất bại"));
  }

  const summaryRows = useMemo(() => {
    const s = data?.summary ?? {};
    return Object.entries(s)
      .map(([uid_, v]: any) => ({ uid: uid_, name: userById.get(uid_)?.full_name ?? uid_, ...v }))
      .sort((a, b) => b.shifts - a.shifts);
  }, [data, userById]);

  // ── Mảnh giao diện dùng chung ──
  const chip = (e: any, size: "sm" | "md" = "md", showNote = true) => (
    <div
      key={e.id}
      title={`${fullName(e.user_id)}${e.kind === "half_off" ? " — nửa ngày" : ""}${e.note ? ` — ${e.note}` : ""}`}
      className={`max-w-full truncate rounded-md border font-semibold leading-tight ${size === "md" ? "px-2 py-1 text-sm" : "px-1.5 py-0.5 text-xs"} ${colorOf(e.user_id)}`}
    >
      {short.get(e.user_id)}
      {e.kind === "half_off" && <span className="ml-1 rounded bg-white/70 px-1 text-[10px] font-bold text-orange-700">½</span>}
      {e.note && (showNote ? <div className="truncate text-[11px] font-normal opacity-80">{e.note}</div> : <span className="opacity-60">*</span>)}
    </div>
  );
  const offChip = (e: any, size: "sm" | "md" = "md") => (
    <div
      key={e.id}
      title={`${fullName(e.user_id)} — ${e.kind === "holiday" ? "nghỉ lễ" : "OFF"}`}
      className={`max-w-full truncate rounded-md font-semibold ${size === "md" ? "px-2 py-1 text-sm" : "px-1.5 py-0.5 text-xs"} ${e.kind === "holiday" ? "bg-purple-100 text-purple-800" : "bg-red-100 text-red-800"}`}
    >
      {short.get(e.user_id)} <span className="font-normal opacity-80">{e.kind === "holiday" ? "lễ" : "OFF"}</span>
    </div>
  );
  const shiftTime = (s: any) => (s.start_time ? `${s.start_time.slice(0, 5)}–${(s.end_time ?? "").slice(0, 5)}` : s.name);

  // ── Chế độ TUẦN, màn hình lớn: bảng ca × 7 ngày, vừa khít chiều ngang ──
  const weekTable = (
    <Card className="mb-4 hidden p-0 overflow-hidden lg:block">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[150px] xl:w-[170px]" />
          {dates.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="border-b border-r bg-slate-50 px-3 py-3 text-left text-sm font-semibold text-slate-600">Ca trực</th>
            {dates.map((d) => {
              const isToday = d === today;
              const isSun = dow(d) === 0;
              return (
                <th
                  key={d}
                  className={`border-b border-r px-1 py-2.5 text-center font-normal ${isToday ? "bg-amber-100" : isSun ? "bg-rose-50" : "bg-slate-50"}`}
                >
                  <div className={`text-xs font-semibold uppercase tracking-wide ${isToday ? "text-amber-800" : isSun ? "text-rose-600" : "text-slate-500"}`}>
                    {WD_LONG[dow(d)]}
                  </div>
                  <div className={`mt-0.5 text-xl font-bold ${isToday ? "text-amber-900" : isSun ? "text-rose-700" : "text-slate-800"}`}>{dm(d)}</div>
                  {isToday && <div className="mx-auto mt-1 w-fit rounded-full bg-amber-500 px-2 py-px text-[10px] font-bold uppercase text-white">Hôm nay</div>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const editable = canEditBranch(g.branchId);
            return (
              <Fragment key={g.branchId}>
                <tr>
                  <td colSpan={dates.length + 1} className="border-b bg-slate-100/80 px-3 py-2 text-sm font-bold text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-primary" />
                      {g.name}
                      {!editable && hasRosterPerm && <Lock className="h-3.5 w-3.5 text-slate-400" title="Không thuộc chi nhánh bạn quản lý" />}
                    </span>
                  </td>
                </tr>
                {g.shifts.map((s: any) => (
                  <tr key={s.id}>
                    <td className="border-b border-r px-3 py-2 align-top">
                      <div className="text-sm font-semibold text-slate-800">{s.name}</div>
                      {s.start_time && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />{shiftTime(s)}
                        </div>
                      )}
                    </td>
                    {dates.map((d) => {
                      const es = byCell.get(`${d}|${s.id}`) ?? [];
                      return (
                        <td
                          key={d}
                          onClick={() => openCell(d, s)}
                          className={`group h-16 border-b border-r p-1.5 align-top ${d === today ? "bg-amber-50" : dow(d) === 0 ? "bg-rose-50/40" : ""} ${editable ? "cursor-pointer hover:bg-primary/5" : ""}`}
                        >
                          <div className="flex flex-col gap-1">
                            {es.map((e: any) => chip(e, "md"))}
                            {editable && es.length === 0 && (
                              <div className="flex justify-center py-1.5 text-transparent group-hover:text-muted-foreground"><Plus className="h-4 w-4" /></div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            );
          })}
          <tr>
            <td className="border-r bg-red-50 px-3 py-2 align-top">
              <div className="flex items-center gap-1.5 text-sm font-bold text-red-700"><CalendarOff className="h-4 w-4" />OFF / Nghỉ lễ</div>
            </td>
            {dates.map((d) => (
              <td
                key={d}
                onClick={() => hasRosterPerm && setOffDate(d)}
                className={`h-14 border-r p-1.5 align-top ${d === today ? "bg-amber-50" : "bg-red-50/40"} ${hasRosterPerm ? "cursor-pointer hover:bg-red-100/60" : ""}`}
              >
                <div className="flex flex-col gap-1">{(offByDate.get(d) ?? []).map((e: any) => offChip(e, "md"))}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Card>
  );

  // ── Chế độ THÁNG, màn hình lớn: lịch 7 cột (T2 → CN) ──
  const lead = dates.length ? (dow(dates[0]) + 6) % 7 : 0;
  const calCells: (string | null)[] = [...Array(lead).fill(null), ...dates];
  while (calCells.length % 7) calCells.push(null);
  const monthCalendar = (
    <Card className="mb-4 hidden p-0 overflow-hidden lg:block">
      <div className="grid grid-cols-7 border-b bg-slate-50">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <div key={w} className={`border-r py-2.5 text-center text-sm font-semibold uppercase tracking-wide last:border-r-0 ${w === 0 ? "text-rose-600" : "text-slate-500"}`}>
            {WD_LONG[w]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {calCells.map((d, i) => {
          if (!d) return <div key={`x${i}`} className="border-b border-r bg-slate-50/60 [&:nth-child(7n)]:border-r-0" />;
          const isToday = d === today;
          const offs = offByDate.get(d) ?? [];
          return (
            <div
              key={d}
              className={`group relative min-h-[132px] border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0 ${isToday ? "bg-amber-50 ring-2 ring-inset ring-amber-400" : dow(d) === 0 ? "bg-rose-50/40" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-base font-bold ${isToday ? "bg-amber-500 text-white" : dow(d) === 0 ? "text-rose-700" : "text-slate-800"}`}
                >
                  {Number(d.slice(8))}
                </span>
                {hasRosterPerm && (
                  <button
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-700 opacity-0 hover:bg-red-100 group-hover:opacity-100"
                    onClick={() => setOffDate(d)}
                  >
                    + OFF
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {groups.map((g) => (
                  <div key={g.branchId}>
                    {groups.length > 1 && <div className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{g.name}</div>}
                    {g.shifts.map((s: any) => {
                      const es = byCell.get(`${d}|${s.id}`) ?? [];
                      const editable = canEditBranch(g.branchId);
                      return (
                        <div
                          key={s.id}
                          onClick={() => openCell(d, s)}
                          title={`${g.name} · ${s.name}`}
                          className={`flex items-start gap-1 rounded px-0.5 py-px ${editable ? "cursor-pointer hover:bg-primary/10" : ""}`}
                        >
                          <span className="w-9 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">{s.start_time ? s.start_time.slice(0, 5) : s.name}</span>
                          <div className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                            {es.length ? es.map((e: any) => chip(e, "sm", false)) : <span className="text-xs text-slate-300">·</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {offs.length > 0 && (
                  <div
                    className={`flex flex-wrap gap-0.5 border-t border-dashed pt-1 ${hasRosterPerm ? "cursor-pointer" : ""}`}
                    onClick={() => hasRosterPerm && setOffDate(d)}
                  >
                    {offs.map((e: any) => offChip(e, "sm"))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );

  // ── Màn hình nhỏ (điện thoại / tablet dọc): danh sách từng ngày ──
  const agenda = (
    <div className="mb-4 space-y-3 lg:hidden">
      {dates.map((d) => {
        const isToday = d === today;
        const offs = offByDate.get(d) ?? [];
        return (
          <Card key={d} className={`p-0 overflow-hidden ${isToday ? "ring-2 ring-amber-400" : ""}`}>
            <div className={`flex items-center gap-3 border-b px-4 py-2.5 ${isToday ? "bg-amber-100" : dow(d) === 0 ? "bg-rose-50" : "bg-slate-50"}`}>
              <div className={`text-2xl font-bold tabular-nums ${isToday ? "text-amber-900" : dow(d) === 0 ? "text-rose-700" : "text-slate-800"}`}>{d.slice(8)}</div>
              <div className="flex-1 leading-tight">
                <div className={`font-semibold ${isToday ? "text-amber-900" : "text-slate-700"}`}>{WD_LONG[dow(d)]}</div>
                <div className="text-xs text-muted-foreground">tháng {Number(d.slice(5, 7))}/{d.slice(0, 4)}</div>
              </div>
              {isToday && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Hôm nay</span>}
              {hasRosterPerm && (
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setOffDate(d)}>+ OFF</Button>
              )}
            </div>
            <div className="divide-y">
              {groups.map((g) => (
                <div key={g.branchId} className="px-4 py-2">
                  <div className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <Building2 className="h-3.5 w-3.5 text-primary" />{g.name}
                  </div>
                  {g.shifts.map((s: any) => {
                    const es = byCell.get(`${d}|${s.id}`) ?? [];
                    const editable = canEditBranch(g.branchId);
                    return (
                      <div
                        key={s.id}
                        onClick={() => openCell(d, s)}
                        className={`flex items-start gap-3 rounded-md py-1.5 ${editable ? "cursor-pointer active:bg-primary/10" : ""}`}
                      >
                        <div className="w-24 shrink-0 pt-1 text-sm font-medium text-slate-600">{s.name}</div>
                        <div className="flex flex-1 flex-wrap gap-1">
                          {es.length ? es.map((e: any) => chip(e, "md")) : <span className="pt-1 text-sm text-slate-300">{editable ? "+ Xếp người" : "—"}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {offs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 bg-red-50/50 px-4 py-2">
                  <span className="mr-1 text-xs font-bold text-red-700">Nghỉ:</span>
                  {offs.map((e: any) => offChip(e, "md"))}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );

  return (
    <AppShell title="Lịch trực ca" loading={isLoading && !data}>
      {/* ── Thanh công cụ ── */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            <button
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${isWeek ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => switchView("week")}
            >
              <CalendarRange className="h-4 w-4" />Tuần
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${!isWeek ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => switchView("month")}
            >
              <CalendarDays className="h-4 w-4" />Tháng
            </button>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label="Trước"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setAnchor(today)}>Hôm nay</Button>
            <Button variant="outline" size="icon" onClick={() => go(1)} aria-label="Sau"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="text-lg font-semibold tracking-tight sm:text-xl">
            {title}
            {isFetching && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="hidden flex-1 xl:block" />

          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
            <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:flex-none" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">Tất cả chi nhánh</option>
              {[...new Set((data?.shifts ?? []).map((s: any) => s.branch_id))].map((bid: any) => (
                <option key={bid} value={bid}>{branchName.get(bid) ?? bid}</option>
              ))}
            </select>
            {tab === "grid" && editableBranchIds.length > 0 && (
              <Button variant="outline" onClick={() => { setCopyBranch(isAdmin ? branchFilter : branchFilter || editableBranchIds[0] || ""); setCopyOpen(true); }}>
                <Copy className="mr-1 h-4 w-4" />Sao chép tuần
              </Button>
            )}
            {tab === "grid" && (
              <Button variant="outline" onClick={exportExcel} disabled={!data}><Download className="mr-1 h-4 w-4" />Excel</Button>
            )}
            <Button variant={tab === "shifts" ? "default" : "outline"} onClick={() => setTab(tab === "grid" ? "shifts" : "grid")}>
              <Settings2 className="mr-1 h-4 w-4" />{tab === "grid" ? "Cài đặt ca" : "Về lịch"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-amber-400" />hôm nay</span>
          <span className="flex items-center gap-1"><span className="rounded bg-orange-100 px-1 font-bold text-orange-700">½</span>nửa ngày</span>
          <span className="flex items-center gap-1"><span className="rounded bg-red-100 px-1.5 font-semibold text-red-700">OFF</span>nghỉ</span>
          <span className="flex items-center gap-1"><span className="rounded bg-purple-100 px-1.5 font-semibold text-purple-700">lễ</span>nghỉ lễ</span>
          <span className="hidden sm:inline">Rê chuột vào tên để xem họ tên đầy đủ và ghi chú.</span>
          {hasRosterPerm ? (
            !isAdmin && (
              <span className="flex items-center gap-1 text-foreground">
                <Lock className="h-3 w-3" />Bạn sửa được lịch của: {editableBranchIds.map((b) => branchName.get(b)).join(", ") || "chưa được gán chi nhánh nào"}
              </span>
            )
          ) : (
            <span className="flex items-center gap-1"><Lock className="h-3 w-3" />Chỉ xem — cần quyền "Quản lý lịch trực" để xếp ca.</span>
          )}
        </div>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/40">
          <div className="mb-2 text-sm text-destructive">{String((error as any).message)}</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Thử lại</Button>
        </Card>
      )}

      {tab === "shifts" ? (
        <ShiftSettings data={data} canEditBranch={canEditBranch} editableBranchIds={editableBranchIds} branchName={branchName} onChanged={refresh} actorId={user?.id} />
      ) : (
        data && (
          <>
            {data.noBranch ? (
              <Card className="mb-4 py-10 text-center text-sm text-muted-foreground">
                Tài khoản của bạn chưa được gán chi nhánh nào nên chưa xem được lịch trực — nhờ quản trị viên gán chi nhánh ở trang Nhân viên.
              </Card>
            ) : groups.length === 0 ? (
              <Card className="mb-4 py-10 text-center text-sm text-muted-foreground">
                Chưa có ca trực nào{branchFilter ? " cho chi nhánh này" : ""}. Bấm <strong>Cài đặt ca</strong> để thêm.
              </Card>
            ) : (
              <>
                {isWeek ? weekTable : monthCalendar}
                {agenda}
              </>
            )}

            {/* Tổng hợp — thay cho các số đếm tay "VY 3", "lễ 2" trên Excel */}
            <Card>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
                <div className="text-base font-semibold">Tổng hợp {isWeek ? "7 ngày" : "tháng"}</div>
                <div className="text-xs text-muted-foreground">Cột "từ đầu năm" tính đến hết khoảng đang xem</div>
              </div>
              {summaryRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">Chưa xếp lịch trong khoảng này.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">Nhân viên</th>
                        <th className="text-right font-medium">Số ca</th>
                        <th className="text-right font-medium">Nửa ngày</th>
                        <th className="text-right font-medium">OFF</th>
                        <th className="text-right font-medium">Lễ</th>
                        <th className="text-right font-medium">OFF từ đầu năm</th>
                        <th className="text-right font-medium">Lễ từ đầu năm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((r: any) => (
                        <tr key={r.uid} className="border-b last:border-0">
                          <td className="py-2">
                            <span className={`mr-2 inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${colorOf(r.uid)}`}>{short.get(r.uid)}</span>
                            {r.name}
                          </td>
                          <td className="text-right font-semibold">{r.shifts}</td>
                          <td className="text-right">{r.half_off || ""}</td>
                          <td className="text-right text-red-700">{r.off || ""}</td>
                          <td className="text-right text-purple-700">{r.holiday || ""}</td>
                          <td className="text-right text-muted-foreground">{r.year_off || ""}</td>
                          <td className="text-right text-muted-foreground">{r.year_holiday || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )
      )}

      {/* ── Dialog xếp người vào ô ── */}
      <Dialog open={!!cell} onOpenChange={(v) => !v && setCell(null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{cell && `${WD_LONG[dow(cell.date)]} ${dm(cell.date)}`}</DialogTitle>
            <DialogDescription>
              {cell && `${branchName.get(cell.shift.branch_id)} · Ca ${cell.shift.name}`}. Tick người trực; có thể đánh dấu nửa ngày và ghi chú (vd "off chiều").
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Tìm nhân viên..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1">
            {users
              .filter((u: any) => !q || u.full_name.toLowerCase().includes(q.toLowerCase()))
              // Đã chọn lên đầu, rồi tới người thuộc chính chi nhánh của ca.
              .sort((a: any, b: any) => {
                const sel = Number(!!picked[b.id]) - Number(!!picked[a.id]);
                if (sel) return sel;
                const bid = cell?.shift.branch_id;
                return Number((b.branch_ids ?? []).includes(bid)) - Number((a.branch_ids ?? []).includes(bid));
              })
              .map((u: any) => {
                const p = picked[u.id];
                return (
                  <div key={u.id} className={`rounded-lg border px-2.5 py-2 ${p ? "border-primary/50 bg-primary/5" : ""}`}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={!!p}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const n = { ...prev };
                            if (e.target.checked) n[u.id] = { half: false, note: "" };
                            else delete n[u.id];
                            return n;
                          })
                        }
                      />
                      <span className={`rounded border px-1.5 text-xs font-semibold ${colorOf(u.id)}`}>{short.get(u.id)}</span>
                      <span className="flex-1">{u.full_name}</span>
                    </label>
                    {p && (
                      <div className="mt-1.5 flex items-center gap-2 pl-6">
                        <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                          <input type="checkbox" checked={p.half} onChange={(e) => setPicked((prev) => ({ ...prev, [u.id]: { ...p, half: e.target.checked } }))} />
                          Nửa ngày
                        </label>
                        <Input className="h-8 text-xs" placeholder="Ghi chú" value={p.note} onChange={(e) => setPicked((prev) => ({ ...prev, [u.id]: { ...p, note: e.target.value } }))} />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 bg-background pt-2">
            <Button variant="outline" onClick={() => setCell(null)}>Huỷ</Button>
            <Button onClick={saveCell} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Lưu ({Object.keys(picked).length} người)</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog nghỉ ── */}
      <Dialog open={!!offDate} onOpenChange={(v) => !v && setOffDate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Nghỉ ngày {offDate && `${WD_LONG[dow(offDate)]} ${dm(offDate)}`}</DialogTitle>
            <DialogDescription>Đánh dấu nghỉ sẽ gỡ người đó khỏi các ca trong ngày. Chỉ chọn được nhân viên thuộc chi nhánh bạn quản lý.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {(offDate ? offByDate.get(offDate) ?? [] : []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-sm">
                <span>
                  <span className="font-medium">{fullName(e.user_id)}</span>
                  <span className={`ml-2 rounded px-1.5 text-xs font-semibold ${e.kind === "holiday" ? "bg-purple-100 text-purple-800" : "bg-red-100 text-red-800"}`}>
                    {e.kind === "holiday" ? "Nghỉ lễ" : "OFF"}
                  </span>
                </span>
                {canEditUser(userById.get(e.user_id)) && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeOff(e.user_id)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">Nhân viên</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={offUser} onChange={(e) => setOffUser(e.target.value)}>
                <option value="">— Chọn —</option>
                {users.filter(canEditUser).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={offKind} onChange={(e) => setOffKind(e.target.value as any)}>
              <option value="off">OFF</option>
              <option value="holiday">Nghỉ lễ</option>
            </select>
            <Button onClick={addOff} disabled={!offUser}><Plus className="h-4 w-4" /></Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog sao chép tuần ── */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sao chép lịch 1 tuần</DialogTitle>
            <DialogDescription>Chép toàn bộ ca + ngày nghỉ của tuần nguồn sang tuần đích (tuần tính từ Thứ Hai đến Chủ nhật).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Chi nhánh {isAdmin ? "(để trống = tất cả)" : "*"}</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={copyBranch} onChange={(e) => setCopyBranch(e.target.value)}>
                {isAdmin && <option value="">Tất cả chi nhánh</option>}
                {editableBranchIds.map((b) => <option key={b} value={b}>{branchName.get(b)}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Tuần nguồn (chọn ngày bất kỳ trong tuần)</Label>
              <Input type="date" className="mt-1" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} />
              <div className="mt-1 text-xs text-muted-foreground">Từ Thứ Hai {dm(mondayOf(copyFrom))} đến Chủ nhật {dm(addDays(mondayOf(copyFrom), 6))}</div>
            </div>
            <div>
              <Label className="text-xs">Tuần đích</Label>
              <Input type="date" className="mt-1" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} />
              <div className="mt-1 text-xs text-muted-foreground">Từ Thứ Hai {dm(mondayOf(copyTo))} đến Chủ nhật {dm(addDays(mondayOf(copyTo), 6))}</div>
            </div>
            <Button className="w-full" onClick={() => doCopy(false)} disabled={copying || (!isAdmin && !copyBranch)}>
              {copying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Sao chép
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ShiftSettings({ data, canEditBranch, editableBranchIds, branchName, onChanged, actorId }: any) {
  const upsert = useServerFn(upsertShiftFn);
  const del = useServerFn(deleteShiftFn);
  const [draft, setDraft] = useState<any>(null);
  const shifts = (data?.shifts ?? []) as any[];

  async function save() {
    try {
      await upsert({ data: { ...draft, actorId } });
      setDraft(null);
      onChanged();
      toast.success("Đã lưu ca");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }
  async function toggle(s: any) {
    try {
      await upsert({ data: { ...s, is_active: !s.is_active, actorId } });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }
  async function remove(s: any) {
    if (!window.confirm(`Xoá ca ${s.name}?`)) return;
    try {
      await del({ data: { id: s.id, actorId } });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold">Ca trực theo chi nhánh</div>
          <div className="text-xs text-muted-foreground">Mỗi chi nhánh tự định nghĩa các ca của mình. Tắt ca thay vì xoá để giữ lịch sử.</div>
        </div>
        {editableBranchIds.length > 0 && (
          <Button size="sm" onClick={() => setDraft({ branch_id: editableBranchIds[0], name: "", start_time: "", end_time: "", sort_order: 0, is_active: true })}>
            <Plus className="mr-1 h-4 w-4" />Thêm ca
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr><th className="py-2 font-medium">Chi nhánh</th><th className="font-medium">Ca</th><th className="font-medium">Giờ</th><th className="font-medium">Thứ tự</th><th></th></tr>
          </thead>
          <tbody>
            {shifts.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Chưa có ca nào.</td></tr>}
            {[...shifts]
              .sort((a, b) => String(branchName.get(a.branch_id)).localeCompare(String(branchName.get(b.branch_id)), "vi") || a.sort_order - b.sort_order)
              .map((s: any) => {
                const editable = canEditBranch(s.branch_id);
                return (
                  <tr key={s.id} className={`border-b last:border-0 ${s.is_active ? "" : "opacity-50"}`}>
                    <td className="py-2">{branchName.get(s.branch_id)}</td>
                    <td className="font-semibold">{s.name}{!s.is_active && <span className="ml-1 font-normal text-muted-foreground">(đã tắt)</span>}</td>
                    <td className="text-muted-foreground">{s.start_time && `${s.start_time} – ${s.end_time ?? ""}`}</td>
                    <td>{s.sort_order}</td>
                    <td className="whitespace-nowrap text-right">
                      {editable ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.is_active ? "Tắt" : "Bật"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDraft({ ...s })}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      ) : (
                        <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground" title="Không thuộc chi nhánh bạn quản lý" />
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{draft?.id ? "Sửa ca" : "Thêm ca"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Chi nhánh *</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
                  {editableBranchIds.map((b: string) => <option key={b} value={b}>{branchName.get(b)}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Tên ca * (hiển thị trên lịch)</Label>
                <Input className="mt-1" placeholder="8h30-18h00" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Bắt đầu</Label><Input type="time" className="mt-1" value={draft.start_time ?? ""} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} /></div>
                <div><Label className="text-xs">Kết thúc</Label><Input type="time" className="mt-1" value={draft.end_time ?? ""} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} /></div>
                <div><Label className="text-xs">Thứ tự</Label><Input type="number" className="mt-1" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} /></div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>Huỷ</Button>
                <Button onClick={save} disabled={!draft.branch_id || !draft.name?.trim()}>Lưu</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
