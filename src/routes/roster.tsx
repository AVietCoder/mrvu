// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Copy, Download, Loader2, Plus, Settings2, Trash2, Pencil, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/roster")({
  head: () => ({ meta: [{ title: "Lịch trực — Mr.Vũ" }] }),
  component: RosterPage,
});

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const shiftMonth = (m: string, delta: number) => {
  const [y, mm] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mm - 1 + delta, 1));
  return t.toISOString().slice(0, 7);
};
const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
/** Thứ 2 của tuần chứa ngày d. */
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));

const KIND_LABEL: Record<string, string> = { off: "OFF", holiday: "Lễ", half_off: "½" };

function RosterPage() {
  const { user, isAdmin } = useAuth();
  const canEdit = Boolean(user && (isAdmin || hasPermission(user as any, "manage_roster")));
  const qc = useQueryClient();

  const getFn = useServerFn(getRosterMonthFn);
  const cellFn = useServerFn(setRosterCellFn);
  const offFn = useServerFn(setDayOffFn);
  const copyFn = useServerFn(copyRosterWeekFn);

  const [month, setMonth] = useState(todayVN().slice(0, 7));
  const [branchFilter, setBranchFilter] = useState("");
  const [tab, setTab] = useState<"grid" | "shifts">("grid");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roster", month],
    queryFn: () => getFn({ data: { month } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["roster"] });

  const users = data?.users ?? [];
  const short = useMemo(() => buildShortNames(users), [users]);
  const fullName = useMemo(() => new Map(users.map((u: any) => [u.id, u.full_name])), [users]);
  const branchName = useMemo(() => new Map((data?.branches ?? []).map((b: any) => [b.id, b.name])), [data]);

  const shifts = useMemo(
    () =>
      (data?.shifts ?? [])
        .filter((s: any) => s.is_active && (!branchFilter || s.branch_id === branchFilter))
        .sort(
          (a: any, b: any) =>
            String(branchName.get(a.branch_id)).localeCompare(String(branchName.get(b.branch_id)), "vi") ||
            a.sort_order - b.sort_order,
        ),
    [data, branchFilter, branchName],
  );

  // entries theo (ngày|ca) và nghỉ theo ngày
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

  // ── Ô ca ──
  const [cell, setCell] = useState<null | { date: string; shift: any }>(null);
  const [picked, setPicked] = useState<Record<string, { half: boolean; note: string }>>({});
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  function openCell(date: string, shift: any) {
    if (!canEdit) return;
    const cur: Record<string, any> = {};
    for (const e of byCell.get(`${date}|${shift.id}`) ?? []) cur[e.user_id] = { half: e.kind === "half_off", note: e.note ?? "" };
    setPicked(cur);
    setQ("");
    setCell({ date, shift });
  }
  async function saveCell() {
    if (!cell) return;
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

  // ── Ô nghỉ ──
  const [offDate, setOffDate] = useState<string | null>(null);
  const [offUser, setOffUser] = useState("");
  const [offKind, setOffKind] = useState<"off" | "holiday">("off");
  async function addOff() {
    if (!offDate || !offUser) return;
    try {
      const r = await offFn({ data: { date: offDate, userId: offUser, kind: offKind, actorId: user?.id } });
      if (r.removedShifts) toast.info(`Đã gỡ ${fullName.get(offUser)} khỏi ${r.removedShifts} ca trong ngày`);
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
  const [copyFrom, setCopyFrom] = useState(mondayOf(addDays(todayVN(), -7)));
  const [copyTo, setCopyTo] = useState(mondayOf(todayVN()));
  const [copying, setCopying] = useState(false);
  async function doCopy(overwrite = false) {
    setCopying(true);
    try {
      const r = await copyFn({
        data: { fromStart: mondayOf(copyFrom), toStart: mondayOf(copyTo), branchId: branchFilter || undefined, overwrite, actorId: user?.id },
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
      month,
      dates: data.dates,
      rows: shifts.map((s: any) => ({
        branch: branchName.get(s.branch_id) ?? "",
        shift: s.name,
        cells: Object.fromEntries(data.dates.map((d: string) => [d, (byCell.get(`${d}|${s.id}`) ?? []).map(label).join("\n")])),
      })),
      offCells: Object.fromEntries(
        data.dates.map((d: string) => [d, (offByDate.get(d) ?? []).map((e: any) => `${short.get(e.user_id)} ${KIND_LABEL[e.kind] ?? ""}`).join("\n")]),
      ),
    }).catch((e) => toast.error(e?.message ?? "Xuất Excel thất bại"));
  }

  const summaryRows = useMemo(() => {
    const s = data?.summary ?? {};
    return Object.entries(s)
      .map(([uid_, v]: any) => ({ uid: uid_, name: fullName.get(uid_) ?? uid_, ...v }))
      .sort((a, b) => b.shifts - a.shifts);
  }, [data, fullName]);

  const [y, mm] = month.split("-");

  return (
    <AppShell title="Lịch trực ca" loading={isLoading}>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-semibold min-w-[110px] text-center">Tháng {Number(mm)}/{y}</div>
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">Tất cả chi nhánh</option>
            {[...new Set((data?.shifts ?? []).map((s: any) => s.branch_id))].map((bid: any) => (
              <option key={bid} value={bid}>{branchName.get(bid) ?? bid}</option>
            ))}
          </select>
          <div className="flex-1" />
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button className={`px-3 py-1.5 ${tab === "grid" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setTab("grid")}>Lịch</button>
            <button className={`px-3 py-1.5 ${tab === "shifts" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setTab("shifts")}>
              <Settings2 className="h-4 w-4 inline mr-1" />Cài đặt ca
            </button>
          </div>
          {tab === "grid" && canEdit && (
            <Button variant="outline" onClick={() => setCopyOpen(true)}><Copy className="h-4 w-4 mr-1" />Sao chép tuần</Button>
          )}
          {tab === "grid" && (
            <Button variant="outline" onClick={exportExcel} disabled={!data}><Download className="h-4 w-4 mr-1" />Excel</Button>
          )}
        </div>
        {!canEdit && (
          <div className="text-xs text-muted-foreground mt-2">Bạn đang xem lịch. Cần quyền "Xếp lịch trực" để sửa.</div>
        )}
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/40">
          <div className="text-sm text-destructive mb-2">{String((error as any).message)}</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Thử lại</Button>
        </Card>
      )}

      {tab === "shifts" ? (
        <ShiftSettings data={data} canEdit={canEdit} branchName={branchName} onChanged={refresh} actorId={user?.id} />
      ) : (
        data && (
          <>
            {shifts.length === 0 ? (
              <Card className="mb-4 text-sm text-muted-foreground">
                Chưa có ca trực nào{branchFilter ? " cho chi nhánh này" : ""}. Vào <strong>Cài đặt ca</strong> để thêm.
              </Card>
            ) : (
              <Card className="mb-4 p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse min-w-max">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-20 bg-muted border px-2 py-1.5 text-left min-w-[140px]">Chi nhánh</th>
                        <th className="sticky left-[140px] z-20 bg-muted border px-2 py-1.5 text-left min-w-[96px]">Ca</th>
                        {data.dates.map((d: string) => (
                          <th key={d} className={`border px-1 py-1 min-w-[64px] font-medium ${dow(d) === 0 ? "bg-amber-50" : "bg-muted"} ${d === todayVN() ? "ring-2 ring-primary ring-inset" : ""}`}>
                            <div>{WD[dow(d)]}</div>
                            <div className="text-muted-foreground">{Number(d.slice(8))}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.map((s: any) => (
                        <tr key={s.id}>
                          <td className="sticky left-0 z-10 bg-background border px-2 py-1 font-medium">{branchName.get(s.branch_id)}</td>
                          <td className="sticky left-[140px] z-10 bg-background border px-2 py-1 whitespace-nowrap">{s.name}</td>
                          {data.dates.map((d: string) => {
                            const es = byCell.get(`${d}|${s.id}`) ?? [];
                            return (
                              <td
                                key={d}
                                onClick={() => openCell(d, s)}
                                className={`border px-1 py-1 align-top text-center ${dow(d) === 0 ? "bg-amber-50/60" : ""} ${canEdit ? "cursor-pointer hover:bg-primary/10" : ""}`}
                              >
                                {es.map((e: any) => (
                                  <div key={e.id} title={`${fullName.get(e.user_id)}${e.note ? ` — ${e.note}` : ""}`} className="leading-tight">
                                    {short.get(e.user_id)}
                                    {e.kind === "half_off" && <span className="text-orange-600"> ½</span>}
                                    {e.note && <span className="text-muted-foreground">*</span>}
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr>
                        <td className="sticky left-0 z-10 bg-red-50 border px-2 py-1 font-semibold text-red-700" colSpan={2}>OFF / Lễ</td>
                        {data.dates.map((d: string) => (
                          <td
                            key={d}
                            onClick={() => canEdit && setOffDate(d)}
                            className={`border px-1 py-1 align-top text-center bg-red-50/40 ${canEdit ? "cursor-pointer hover:bg-red-100" : ""}`}
                          >
                            {(offByDate.get(d) ?? []).map((e: any) => (
                              <div key={e.id} title={fullName.get(e.user_id)} className={e.kind === "holiday" ? "text-purple-700" : "text-red-700"}>
                                {short.get(e.user_id)} {e.kind === "holiday" ? "lễ" : ""}
                              </div>
                            ))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Tổng hợp — thay cho các số đếm tay "VY 3", "lễ 2" trên Excel */}
            <Card>
              <div className="font-medium mb-2">Tổng hợp tháng {Number(mm)}/{y}</div>
              {summaryRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">Chưa xếp lịch cho tháng này.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-1.5">Nhân viên</th>
                      <th className="text-right">Số ca</th>
                      <th className="text-right">Nửa ngày</th>
                      <th className="text-right">OFF</th>
                      <th className="text-right">Lễ</th>
                      <th className="text-right">OFF từ đầu năm</th>
                      <th className="text-right">Lễ từ đầu năm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((r: any) => (
                      <tr key={r.uid} className="border-b last:border-0">
                        <td className="py-1.5">{r.name}</td>
                        <td className="text-right font-medium">{r.shifts}</td>
                        <td className="text-right">{r.half_off || ""}</td>
                        <td className="text-right text-red-700">{r.off || ""}</td>
                        <td className="text-right text-purple-700">{r.holiday || ""}</td>
                        <td className="text-right text-muted-foreground">{r.year_off || ""}</td>
                        <td className="text-right text-muted-foreground">{r.year_holiday || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )
      )}

      {/* Dialog xếp người vào ô */}
      <Dialog open={!!cell} onOpenChange={(v) => !v && setCell(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{cell && `${WD[dow(cell.date)]} ${cell.date.slice(8)}/${cell.date.slice(5, 7)} · ${branchName.get(cell.shift.branch_id)} · ${cell.shift.name}`}</DialogTitle>
            <DialogDescription>Tick người trực ca này. Có thể đánh dấu nửa ngày và ghi chú (vd "off chiều").</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Tìm nhân viên..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1">
            {users
              .filter((u: any) => !q || u.full_name.toLowerCase().includes(q.toLowerCase()))
              .sort((a: any, b: any) => Number(!!picked[b.id]) - Number(!!picked[a.id]))
              .map((u: any) => {
                const p = picked[u.id];
                return (
                  <div key={u.id} className={`rounded border px-2 py-1.5 ${p ? "bg-primary/5 border-primary/40" : ""}`}>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
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
                      <span className="flex-1">{u.full_name}</span>
                    </label>
                    {p && (
                      <div className="flex items-center gap-2 mt-1 pl-6">
                        <label className="text-xs flex items-center gap-1">
                          <input type="checkbox" checked={p.half} onChange={(e) => setPicked((prev) => ({ ...prev, [u.id]: { ...p, half: e.target.checked } }))} />
                          Nửa ngày
                        </label>
                        <Input className="h-7 text-xs" placeholder="Ghi chú" value={p.note} onChange={(e) => setPicked((prev) => ({ ...prev, [u.id]: { ...p, note: e.target.value } }))} />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="flex justify-end gap-2 sticky bottom-0 bg-background pt-2">
            <Button variant="outline" onClick={() => setCell(null)}>Huỷ</Button>
            <Button onClick={saveCell} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Lưu ({Object.keys(picked).length})</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog nghỉ */}
      <Dialog open={!!offDate} onOpenChange={(v) => !v && setOffDate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nghỉ ngày {offDate && `${WD[dow(offDate)]} ${offDate.slice(8)}/${offDate.slice(5, 7)}`}</DialogTitle>
            <DialogDescription>Đánh dấu nghỉ sẽ gỡ người đó khỏi các ca trong ngày.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {(offDate ? offByDate.get(offDate) ?? [] : []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                <span>{fullName.get(e.user_id)} <span className="text-muted-foreground">· {e.kind === "holiday" ? "Nghỉ lễ" : "OFF"}</span></span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeOff(e.user_id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Nhân viên</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={offUser} onChange={(e) => setOffUser(e.target.value)}>
                <option value="">— Chọn —</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
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

      {/* Dialog sao chép tuần */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sao chép lịch 1 tuần</DialogTitle>
            <DialogDescription>
              Chép toàn bộ ca + ngày nghỉ của tuần nguồn sang tuần đích (tính từ Thứ 2).
              {branchFilter ? " Chỉ chép các ca của chi nhánh đang lọc." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tuần nguồn (chọn ngày bất kỳ trong tuần)</Label>
              <Input type="date" className="mt-1" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} />
              <div className="text-xs text-muted-foreground mt-1">Thứ 2: {mondayOf(copyFrom)}</div>
            </div>
            <div>
              <Label className="text-xs">Tuần đích</Label>
              <Input type="date" className="mt-1" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} />
              <div className="text-xs text-muted-foreground mt-1">Thứ 2: {mondayOf(copyTo)}</div>
            </div>
            <Button className="w-full" onClick={() => doCopy(false)} disabled={copying}>
              {copying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Sao chép
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ShiftSettings({ data, canEdit, branchName, onChanged, actorId }: any) {
  const upsert = useServerFn(upsertShiftFn);
  const del = useServerFn(deleteShiftFn);
  const [draft, setDraft] = useState<any>(null);
  const shifts = (data?.shifts ?? []) as any[];
  const branches = (data?.branches ?? []) as any[];

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
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Ca trực theo chi nhánh</div>
        {canEdit && <Button size="sm" onClick={() => setDraft({ branch_id: "", name: "", start_time: "", end_time: "", sort_order: 0, is_active: true })}><Plus className="h-4 w-4 mr-1" />Thêm ca</Button>}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b">
          <tr><th className="py-1.5">Chi nhánh</th><th>Ca</th><th>Giờ</th><th>Thứ tự</th><th></th></tr>
        </thead>
        <tbody>
          {shifts.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Chưa có ca nào.</td></tr>}
          {[...shifts].sort((a, b) => String(branchName.get(a.branch_id)).localeCompare(String(branchName.get(b.branch_id)), "vi") || a.sort_order - b.sort_order).map((s: any) => (
            <tr key={s.id} className={`border-b last:border-0 ${s.is_active ? "" : "opacity-50"}`}>
              <td className="py-1.5">{branchName.get(s.branch_id)}</td>
              <td className="font-medium">{s.name}{!s.is_active && " (đã tắt)"}</td>
              <td className="text-muted-foreground">{s.start_time && `${s.start_time} – ${s.end_time ?? ""}`}</td>
              <td>{s.sort_order}</td>
              <td className="text-right">
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.is_active ? "Tắt" : "Bật"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...s })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{draft?.id ? "Sửa ca" : "Thêm ca"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Chi nhánh *</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>
                  <option value="">— Chọn —</option>
                  {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                <Button onClick={save}>Lưu</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
