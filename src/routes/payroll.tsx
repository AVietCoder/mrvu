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
import { useCustomerGroups } from "@/hooks/useCustomerGroups";
import { exportPayrollExcel, printPayslips } from "@/lib/export-hr";
import { todayVN, formatDateVN } from "@/lib/date-vn";
import {
  ChevronLeft, ChevronRight, Lock, Unlock, Wallet, Printer, Download, Loader2, ShieldOff, Wand2, Pencil,
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
  X: "bg-green-100 text-green-800",
  N: "bg-yellow-100 text-yellow-800",
  L: "bg-blue-100 text-blue-800",
  K: "bg-red-100 text-red-700",
};

function PayrollPage() {
  const { user, isAdmin } = useAuth();
  const canView = Boolean(user && (isAdmin || hasPermission(user as any, "manage_payroll")));
  const [month, setMonth] = useState(shiftMonth(todayVN().slice(0, 7), 0));
  const [tab, setTab] = useState<"attendance" | "payroll" | "profiles">("attendance");
  const [y, mm] = month.split("-");

  if (!canView) {
    return (
      <AppShell title="Bảng lương">
        <Card className="text-center py-12">
          <ShieldOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <div className="font-medium">Bạn không có quyền xem bảng lương</div>
          <div className="text-sm text-muted-foreground">Cần quyền "Chấm công & bảng lương".</div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Chấm công & Bảng lương">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-semibold min-w-[110px] text-center">Tháng {Number(mm)}/{y}</div>
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <div className="flex-1" />
          <div className="flex rounded-md border overflow-hidden text-sm">
            {[["attendance", "Chấm công"], ["payroll", "Bảng lương"], ["profiles", "Hồ sơ lương"]].map(([k, l]) => (
              <button key={k} className={`px-3 py-1.5 ${tab === k ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setTab(k as any)}>{l}</button>
            ))}
          </div>
        </div>
      </Card>
      {tab === "attendance" && <AttendanceTab month={month} actorId={user?.id} />}
      {tab === "payroll" && <PayrollTab month={month} actorId={user?.id} />}
      {tab === "profiles" && <ProfilesTab actorId={user?.id} />}
    </AppShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Chấm công
// ═══════════════════════════════════════════════════════════════════════════
function AttendanceTab({ month, actorId }: { month: string; actorId?: string }) {
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

  // Khoá theo TỪNG NGƯỜI (người đã chốt lương thì hàng của họ chỉ xem).
  const lockedCount = (data?.rows ?? []).filter((r: any) => r.locked).length;

  async function cycle(userId: string, date: string, current: string | null, rowLocked: boolean) {
    if (rowLocked) return;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const key = `${userId}|${date}`;
    setLocal((p) => ({ ...p, [key]: next }));
    try {
      await setFn({ data: { userId, date, code: next, actorId } });
    } catch (e: any) {
      setLocal((p) => ({ ...p, [key]: current }));
      toast.error(e?.message ?? "Lỗi lưu chấm công");
    }
  }

  async function fillAll() {
    if (!data?.rows?.length) return;
    if (!window.confirm("Điền X cho mọi ngày thường và K cho Chủ nhật — CHỈ các ô còn trống. Các ô đã chấm tay giữ nguyên.")) return;
    setFilling(true);
    try {
      const r = await fillFn({ data: { month, userIds: data.rows.map((r: any) => r.user_id), weekdayCode: "X", sundayCode: "K", onlyEmpty: true, actorId } });
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

  if (isLoading) return <Card className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;
  if (!data?.rows?.length)
    return (
      <Card className="text-sm text-muted-foreground">
        Chưa có nhân viên nào trong bảng lương. Vào tab <strong>Hồ sơ lương</strong> để thêm.
      </Card>
    );

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

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b text-xs">
        {Object.entries({ X: "Làm cả ngày", N: "Nửa ngày", L: "Nghỉ có lương", K: "Nghỉ không lương" }).map(([c, l]) => (
          <span key={c} className="flex items-center gap-1"><span className={`rounded px-1.5 font-bold ${CODE_STYLE[c]}`}>{c}</span>{l}</span>
        ))}
        <span className="text-muted-foreground">· Bấm ô để đổi mã · Công thực tế = X + N/2 + L</span>
        <div className="flex-1" />
        {lockedCount > 0 && (
          <span className="text-orange-700 font-medium flex items-center gap-1"><Lock className="h-3.5 w-3.5" />{lockedCount} người đã chốt lương — hàng của họ chỉ xem</span>
        )}
        {lockedCount < (data?.rows?.length ?? 0) && (
          <Button size="sm" variant="outline" onClick={fillAll} disabled={filling}>
            {filling ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Điền nhanh ô trống
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-max">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-muted border px-2 py-1.5 text-left min-w-[170px]">Họ và tên</th>
              {data.dates.map((d: string) => (
                <th key={d} className={`border px-0.5 py-1 w-8 ${dow(d) === 0 ? "bg-amber-50" : "bg-muted"}`}>
                  <div>{Number(d.slice(8))}</div>
                  <div className="text-muted-foreground font-normal">{WD[dow(d)]}</div>
                </th>
              ))}
              {["X", "N", "L", "K"].map((c) => <th key={c} className="border px-1.5 bg-muted">{c}</th>)}
              <th className="border px-2 bg-muted">Công</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => {
              const t = totals(r);
              return (
                <tr key={r.user_id}>
                  <td className="sticky left-0 z-10 bg-background border px-2 py-1">
                    <div className="font-medium">{r.full_name}</div>
                    {r.position && <div className="text-muted-foreground">{r.position}</div>}
                  </td>
                  {data.dates.map((d: string) => {
                    const c = codeOf(r, d);
                    return (
                      <td
                        key={d}
                        onClick={() => cycle(r.user_id, d, c, r.locked)}
                        title={r.notes?.[d] ?? ""}
                        className={`border text-center font-bold select-none ${r.locked ? "opacity-70" : "cursor-pointer hover:ring-1 hover:ring-primary"} ${c ? CODE_STYLE[c] : dow(d) === 0 ? "bg-amber-50/60" : ""}`}
                      >
                        {c ?? ""}
                      </td>
                    );
                  })}
                  <td className="border text-center">{t.X || ""}</td>
                  <td className="border text-center">{t.N || ""}</td>
                  <td className="border text-center">{t.L || ""}</td>
                  <td className="border text-center">{t.K || ""}</td>
                  <td className="border text-center font-bold px-2">{t.worked}<span className="text-muted-foreground font-normal">/{r.standard_days}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bảng lương
// ═══════════════════════════════════════════════════════════════════════════
function MoneyInput({ value, disabled, onSave, width = "w-24", decimals = false }: any) {
  const [v, setV] = useState<string | null>(null);
  const shown = v ?? (value ? String(value) : "");
  return (
    <input
      className={`h-7 ${width} rounded border border-input bg-background px-1.5 text-right text-xs disabled:bg-transparent disabled:border-transparent`}
      inputMode="decimal"
      disabled={disabled}
      value={shown}
      placeholder="0"
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

function PayrollTab({ month, actorId }: { month: string; actorId?: string }) {
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

  const rows = (data?.rows ?? []) as any[];
  const s = data?.summary;
  const siteName = settings?.site_name?.trim() || "MR*VU";

  if (isLoading) return <Card className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  const draftCount = rows.filter((r) => !r.locked).length;
  const lockedUnpaid = rows.filter((r) => r.locked && !r.cash_voucher_id);
  const paidCount = s?.paid ?? 0;

  async function lockRows(userIds?: string[]) {
    const who = userIds?.length === 1 ? rows.find((r) => r.user_id === userIds[0])?.full_name : `${draftCount} người chưa chốt`;
    if (!window.confirm(`Chốt lương tháng ${month} cho ${who}? Sau khi chốt, số liệu được giữ nguyên dù lịch/đơn/phiếu thay đổi.`)) return;
    await run("lock", async () => {
      const r = await lockFn({ data: { month, userIds, actorId } });
      toast.success(`Đã chốt lương ${r.people} người`);
      refresh();
    });
  }
  async function unlockRows(userIds?: string[]) {
    await run("unlock", async () => {
      const r = await unlockFn({ data: { month, userIds, actorId } });
      toast.success(`Đã mở lại ${r.unlocked} người${r.skippedPaid ? ` (bỏ qua ${r.skippedPaid} người đã chi)` : ""}`);
      refresh();
    });
  }

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded bg-muted px-2 py-1">{draftCount} chưa chốt</span>
            <span className="rounded bg-orange-100 text-orange-800 px-2 py-1">{lockedUnpaid.length} đã chốt, chưa chi</span>
            <span className="rounded bg-green-100 text-green-800 px-2 py-1">{paidCount} đã chi</span>
          </div>
          <span className="text-sm text-muted-foreground">
            Tổng thực lĩnh <strong className="text-foreground">{money(s?.net)}đ</strong>
          </span>
          <div className="flex-1" />
          {draftCount > 0 && (
            <Button onClick={() => lockRows()} disabled={!!busy}>
              {busy === "lock" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lock className="h-4 w-4 mr-1" />}Chốt lương ({draftCount})
            </Button>
          )}
          {lockedUnpaid.length > 0 && (
            <Button variant="outline" onClick={() => unlockRows()} disabled={!!busy}>
              <Unlock className="h-4 w-4 mr-1" />Mở lại ({lockedUnpaid.length})
            </Button>
          )}
          {lockedUnpaid.length > 0 && (
            <Button onClick={() => { setPayResult(null); setPayOpen(true); }} disabled={!!busy}>
              <Wallet className="h-4 w-4 mr-1" />Chi lương qua Sổ quỹ
            </Button>
          )}
          <Button variant="outline" onClick={() => printPayslips(rows, month, siteName)} disabled={!rows.length}>
            <Printer className="h-4 w-4 mr-1" />In phiếu lương
          </Button>
          <Button variant="outline" onClick={() => exportPayrollExcel({ month, rows }).catch((e) => toast.error(e?.message))} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" />Excel
          </Button>
        </div>
        {!data?.scopeAll && (
          <div className="text-xs text-muted-foreground mt-2">
            Bạn đang xem nhân viên thuộc các chi nhánh mình được gán. Chốt / mở lại / chi lương chỉ áp dụng cho những người này.
          </div>
        )}
        {data?.hasSalaryVoucherType === false && (
          <div className="text-xs text-orange-700 mt-2">Sổ quỹ chưa có loại phiếu chi "Chi Lương" — cần tạo trước khi chi lương.</div>
        )}
      </Card>

      {!rows.length ? (
        <Card className="text-sm text-muted-foreground">Chưa có nhân viên nào trong bảng lương. Vào tab <strong>Hồ sơ lương</strong> để thêm.</Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-max">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-2 py-1" rowSpan={2}>STT</th>
                  <th className="sticky left-0 z-20 bg-muted border px-2 py-1 text-left min-w-[160px]" rowSpan={2}>Tên NV</th>
                  <th className="border px-2" colSpan={4}>Lương & thời gian làm việc</th>
                  <th className="border px-2" colSpan={6}>Phụ cấp / thu nhập thêm</th>
                  <th className="border px-2" colSpan={4}>Khấu trừ</th>
                  <th className="border px-2" rowSpan={2}>Thực lĩnh</th>
                  <th className="border px-2" rowSpan={2}></th>
                </tr>
                <tr className="bg-muted">
                  {["Lương CB", "Công chuẩn", "Công TT", "Lương TN", "DS kỹ thuật", "Hoa hồng", "Tăng ca (giờ ×1,5 / ×2)", "Xăng xe tỉnh", "Thưởng", "Phụ cấp", "Tạm ứng", "BHXH", "Công đoàn", "Trừ khác"].map((h) => (
                    <th key={h} className="border px-2 py-1 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={r.user_id} className="hover:bg-muted/30">
                    <td className="border px-2 text-center">{i + 1}</td>
                    <td className="sticky left-0 z-10 bg-background border px-2 py-1">
                      <div className="font-medium flex items-center gap-1">
                        {r.full_name}
                        {r.locked && <Lock className="h-3 w-3 text-orange-600" title="Đã chốt" />}
                      </div>
                      <div className="text-muted-foreground">{r.position}</div>
                    </td>
                    <td className="border px-2 text-right">{money(r.base_salary)}</td>
                    <td className="border px-2 text-center">{r.standard_days}</td>
                    <td className="border px-2 text-center font-medium">{r.worked_days}</td>
                    <td className="border px-2 text-right">{money(r.salary_by_days)}</td>
                    <td className="border px-2 text-right">
                      {r.tech_enabled || r.snapshot ? (
                        <button className="underline decoration-dotted hover:text-primary" disabled={r.snapshot} onClick={() => setDetail({ kind: "tech", row: r })}>{money(r.tech_revenue)}</button>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="border px-2 text-right">
                      {r.commission_rate > 0 && !r.snapshot ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button className="underline decoration-dotted hover:text-primary" onClick={() => setDetail({ kind: "commission", row: r })}>
                            {money(r.commission)}{r.commission_override !== null && <span className="text-orange-600">*</span>}
                          </button>
                        </div>
                      ) : r.commission ? money(r.commission) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="border px-1">
                      <div className="flex items-center gap-1 justify-end">
                        <MoneyInput value={r.ot_hours_15} width="w-11" decimals disabled={r.locked} onSave={(n: number) => save(r.user_id, { ot_hours_15: n })} />
                        <MoneyInput value={r.ot_hours_20} width="w-11" decimals disabled={r.locked} onSave={(n: number) => save(r.user_id, { ot_hours_20: n })} />
                        <span className="w-20 text-right">{money(r.overtime_amount)}</span>
                      </div>
                    </td>
                    <td className="border px-1" title={r.travel_note}>
                      <MoneyInput value={r.travel_allowance} disabled={r.locked} onSave={(n: number) => save(r.user_id, { travel_allowance: n })} />
                    </td>
                    <td className="border px-1"><MoneyInput value={r.bonus} disabled={r.locked} onSave={(n: number) => save(r.user_id, { bonus: n })} /></td>
                    <td className="border px-1" title={r.extra_note}><MoneyInput value={r.extra_allowance} disabled={r.locked} onSave={(n: number) => save(r.user_id, { extra_allowance: n })} /></td>
                    <td className="border px-2 text-right">
                      {r.advance && !r.snapshot ? (
                        <button className="underline decoration-dotted hover:text-primary" onClick={() => setDetail({ kind: "advance", row: r })}>{money(r.advance)}</button>
                      ) : money(r.advance)}
                    </td>
                    <td className="border px-2 text-right">{money(r.social_insurance)}</td>
                    <td className="border px-2 text-right">{money(r.union_fee)}</td>
                    <td className="border px-1" title={r.other_note}><MoneyInput value={r.other_deduction} disabled={r.locked} onSave={(n: number) => save(r.user_id, { other_deduction: n })} /></td>
                    <td className="border px-2 text-right font-bold text-base whitespace-nowrap">
                      {money(r.net_pay)}
                      {r.cash_voucher_id && !String(r.cash_voucher_id).startsWith("pending:") && <div className="text-[10px] font-normal text-green-700">đã chi</div>}
                    </td>
                    <td className="border px-1 whitespace-nowrap">
                      {!r.locked ? (
                        <>
                          <Button size="sm" variant="ghost" title="Ghi chú xăng xe / phụ cấp / trừ khác, ghi đè hoa hồng" onClick={() => setDetail({ kind: "notes", row: r })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Chốt lương riêng người này" disabled={!!busy} onClick={() => lockRows([r.user_id])}>
                            <Lock className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : !r.cash_voucher_id ? (
                        <Button size="sm" variant="ghost" title="Mở lại để sửa" disabled={!!busy} onClick={() => unlockRows([r.user_id])}>
                          <Unlock className="h-3.5 w-3.5 text-orange-600" />
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" title="In phiếu lương" onClick={() => printPayslips([r], month, siteName)}><Printer className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted font-bold">
                  <td className="border px-2" colSpan={5}>TỔNG CHI</td>
                  {["salary_by_days", "tech_revenue", "commission", "overtime_amount", "travel_allowance", "bonus", "extra_allowance", "advance", "social_insurance", "union_fee", "other_deduction", "net_pay"].map((k) => (
                    <td key={k} className="border px-2 text-right">{money(rows.reduce((s2, r) => s2 + Number(r[k] || 0), 0))}</td>
                  ))}
                  <td className="border" />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-muted-foreground border-t">
            Lương TN = Lương CB / công chuẩn × công thực tế · Tăng ca = Lương CB / công chuẩn / 8 × giờ × 1,5 (hoặc × 2) ·
            DS kỹ thuật chỉ tính lịch đã hoàn thành · Tạm ứng tự cộng từ phiếu chi "Tạm ứng" trong Sổ quỹ ·
            {isFetching ? " đang cập nhật…" : " "}
            <button className="underline" onClick={() => refetch()}>tải lại</button>
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
            <DialogTitle>Chi lương tháng {month}</DialogTitle>
            <DialogDescription>
              Tạo 1 phiếu chi "Chi Lương" trong Sổ quỹ cho mỗi người chưa được chi. Bấm lại sẽ bỏ qua người đã chi — không tạo phiếu trùng.
            </DialogDescription>
          </DialogHeader>
          {payResult ? (
            <div className="space-y-1 text-sm max-h-[50vh] overflow-y-auto">
              {payResult.length === 0 && <div className="text-muted-foreground">Không còn ai cần chi.</div>}
              {payResult.map((r) => (
                <div key={r.user_id} className={r.ok ? "" : "text-destructive"}>
                  {r.ok ? "✓" : "✗"} {r.name} — {r.ok ? `${r.code} · ${money(r.amount)}đ` : r.reason}
                </div>
              ))}
              <Button className="w-full mt-2" onClick={() => setPayOpen(false)}>Đóng</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Chi từ chi nhánh / quỹ *</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={payBranch} onChange={(e) => setPayBranch(e.target.value)}>
                  <option value="">— Chọn —</option>
                  {(opts?.branches ?? [])
                    .filter((b: any) => data?.scopeAll || (data?.scopeBranchIds ?? []).includes(b.id))
                    .map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Hình thức</Label>
                <div className="flex gap-3 mt-1 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" checked={payFund === "ngan_hang"} onChange={() => setPayFund("ngan_hang")} />Chuyển khoản</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={payFund === "tien_mat"} onChange={() => setPayFund("tien_mat")} />Tiền mặt</label>
                </div>
              </div>
              <div className="rounded bg-muted/50 p-2 text-sm">
                Sẽ chi cho <strong>{lockedUnpaid.filter((r) => r.net_pay > 0).length}</strong> người đã chốt, tổng{" "}
                <strong>{money(lockedUnpaid.filter((r) => r.net_pay > 0).reduce((a, r) => a + r.net_pay, 0))}đ</strong>
                {draftCount > 0 && <div className="text-xs text-orange-700 mt-1">{draftCount} người chưa chốt sẽ không được chi.</div>}
              </div>
              <Button
                className="w-full"
                disabled={!payBranch || !!busy}
                onClick={() =>
                  run("pay", async () => {
                    const r = await payFn({ data: { month, fundType: payFund, branchId: payBranch, actorId } });
                    setPayResult(r.results);
                    refresh();
                    qc.invalidateQueries({ queryKey: ["cash"] });
                  })
                }
              >
                {busy === "pay" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Tạo phiếu chi
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setNotes({}); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {r && (
          <>
            <DialogHeader>
              <DialogTitle>
                {k === "tech" && `Lương doanh số — ${r.full_name}`}
                {k === "commission" && `Hoa hồng — ${r.full_name}`}
                {k === "advance" && `Tạm ứng — ${r.full_name}`}
                {k === "notes" && `Ghi chú & điều chỉnh — ${r.full_name}`}
              </DialogTitle>
              {k === "commission" && (
                <DialogDescription>
                  {r.commission_rate}% × doanh thu đơn hoàn tất trong tháng của nhóm khách "{r.commission_group}" = {money(r.commission_base)}đ × {r.commission_rate}% = {money(r.commission_auto)}đ
                </DialogDescription>
              )}
            </DialogHeader>

            {k === "tech" && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-1">Ngày</th><th>Công việc</th><th>Loại / phụ phí</th><th className="text-right">Số người</th><th className="text-right">Phần của NV</th></tr>
                </thead>
                <tbody>
                  {(r.tech_lines ?? []).length === 0 && <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">Không có lịch đã hoàn thành trong tháng.</td></tr>}
                  {(r.tech_lines ?? []).map((l: any) => (
                    <tr key={l.schedule_id} className="border-b last:border-0">
                      <td className="py-1 whitespace-nowrap">{formatDateVN(l.scheduled_date)}</td>
                      <td>{l.title}</td>
                      <td className="text-muted-foreground">
                        {l.work_type ? `${l.work_type.name}${l.work_type.qty > 1 ? ` ×${l.work_type.qty}` : ""}` : ""}
                        {(l.difficulties ?? []).map((d: any) => ` + ${d.name}${d.qty > 1 ? ` ×${d.qty}` : ""}`).join("")}
                      </td>
                      <td className="text-right">{l.num_people}</td>
                      <td className="text-right font-medium">{money(l.money_share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {k === "commission" && (
              <>
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground border-b"><tr><th className="py-1">Ngày</th><th>Hoá đơn</th><th>Khách</th><th className="text-right">Tổng tiền</th></tr></thead>
                  <tbody>
                    {(r.commission_orders ?? []).map((o: any) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-1">{formatDateVN(String(o.date).slice(0, 10))}</td>
                        <td className="font-mono">{o.code}</td>
                        <td>{o.customer_name}</td>
                        <td className="text-right">{money(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {k === "advance" && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground border-b"><tr><th className="py-1">Ngày</th><th>Phiếu</th><th>Ghi chú</th><th className="text-right">Số tiền</th></tr></thead>
                <tbody>
                  {(r.advance_vouchers ?? []).map((v: any) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-1">{formatDateVN(String(v.created_at).slice(0, 10))}</td>
                      <td className="font-mono">{v.code}</td>
                      <td>{v.note}</td>
                      <td className={`text-right ${v.amount < 0 ? "text-green-700" : ""}`}>{money(v.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {k === "notes" && (
              <div className="space-y-3 text-sm">
                {[
                  ["travel_note", "Diễn giải xăng xe đi tỉnh", "vd: 11/6 Biên Hoà, 27/6 Long An"],
                  ["extra_note", "Ghi chú phụ cấp", "vd: kéo thêm đoạn điện về tụ"],
                  ["other_note", "Ghi chú trừ khác", ""],
                ].map(([f, l, ph]) => (
                  <div key={f}>
                    <Label className="text-xs">{l}</Label>
                    <Input className="mt-1" placeholder={ph} defaultValue={r[f] ?? ""} onChange={(e) => setNotes((p: any) => ({ ...p, [f]: e.target.value }))} />
                  </div>
                ))}
                {r.commission_rate > 0 && (
                  <div>
                    <Label className="text-xs">Ghi đè hoa hồng (để trống = tự tính {money(r.commission_auto)}đ)</Label>
                    <Input
                      className="mt-1"
                      inputMode="numeric"
                      defaultValue={r.commission_override ?? ""}
                      placeholder="Tự tính"
                      onChange={(e) => setNotes((p: any) => ({ ...p, commission_override: e.target.value.replace(/[^\d]/g, "") }))}
                    />
                    <div className="text-xs text-muted-foreground mt-1">Dùng khi hoa hồng tính theo quý / theo tiền thực thu khác với doanh thu tháng.</div>
                  </div>
                )}
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
  const { groups, labelOf } = useCustomerGroups();
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

  if (isLoading) return <Card className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  const list = ((data ?? []) as any[]).filter((u) => showAll || u.profile?.in_payroll);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="font-medium">Hồ sơ lương nhân viên</div>
          <div className="text-xs text-muted-foreground">
            Chỉ người có hồ sơ và bật "Có trong bảng lương" mới xuất hiện ở tab Chấm công / Bảng lương.
            Người quản lý chỉ thấy nhân viên thuộc chi nhánh mình được gán; nhân viên chưa gán chi nhánh chỉ admin thấy.
          </div>
        </div>
        <label className="text-sm flex items-center gap-1.5">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Hiện tất cả nhân viên (để thêm người mới)
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-muted-foreground border-b">
            <tr><th className="py-1.5">Nhân viên</th><th>Chi nhánh</th><th>Chức vụ</th><th className="text-right">Lương CB</th><th className="text-right">Công chuẩn</th><th>Lương DS</th><th>Hoa hồng</th><th>Ngân hàng</th><th></th></tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">Chưa có ai. Tick "Hiện tất cả nhân viên" để thêm.</td></tr>}
            {list.map((u) => {
              const p = u.profile;
              return (
                <tr key={u.user_id} className={`border-b last:border-0 ${p?.in_payroll ? "" : "text-muted-foreground"}`}>
                  <td className="py-1.5">{u.full_name}</td>
                  <td className="text-xs text-muted-foreground max-w-[200px]">{(u.branches ?? []).join(", ") || <span className="text-orange-600">chưa gán chi nhánh</span>}</td>
                  <td>{p?.position ?? ""}</td>
                  <td className="text-right">{p ? money(p.base_salary) : ""}</td>
                  <td className="text-right">{p?.standard_days ?? ""}</td>
                  <td>{p?.tech_revenue ? "✓" : ""}</td>
                  <td>{p?.commission_rate > 0 ? `${p.commission_rate}% · ${labelOf(p.commission_group)}` : ""}</td>
                  <td className="text-xs">{p?.bank_account ? `${p.bank_name ?? ""} ${p.bank_account}` : ""}</td>
                  <td className="text-right">
                    <Button size="sm" variant={p ? "ghost" : "outline"} onClick={() => setEdit({ user_id: u.user_id, full_name: u.full_name, standard_days: 26, in_payroll: true, ...(p ?? {}) })}>
                      {p ? <Pencil className="h-4 w-4" /> : "Thêm"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Hồ sơ lương — {edit?.full_name}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[["position", "Chức vụ / bộ phận", "Kỹ thuật"], ["area", "Khu vực", "HCM"], ["start_label", "Năm bắt đầu làm", "Tháng 3.2018"]].map(([f, l, ph]) => (
                  <div key={f}><Label className="text-xs">{l}</Label><Input className="mt-1" placeholder={ph} value={edit[f] ?? ""} onChange={(e) => setEdit({ ...edit, [f]: e.target.value })} /></div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><Label className="text-xs">Lương cơ bản *</Label><Input className="mt-1" inputMode="numeric" value={edit.base_salary ?? ""} onChange={(e) => setEdit({ ...edit, base_salary: e.target.value.replace(/[^\d]/g, "") })} /></div>
                <div><Label className="text-xs">Số công chuẩn</Label><Input className="mt-1" inputMode="decimal" value={edit.standard_days ?? 26} onChange={(e) => setEdit({ ...edit, standard_days: e.target.value })} /></div>
                <div><Label className="text-xs">BHXH trừ/tháng</Label><Input className="mt-1" inputMode="numeric" value={edit.social_insurance ?? ""} onChange={(e) => setEdit({ ...edit, social_insurance: e.target.value.replace(/[^\d]/g, "") })} /></div>
                <div><Label className="text-xs">Công đoàn/tháng</Label><Input className="mt-1" inputMode="numeric" value={edit.union_fee ?? ""} onChange={(e) => setEdit({ ...edit, union_fee: e.target.value.replace(/[^\d]/g, "") })} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><Label className="text-xs">Ngân hàng</Label><Input className="mt-1" placeholder="MSB, Vietcombank..." value={edit.bank_name ?? ""} onChange={(e) => setEdit({ ...edit, bank_name: e.target.value })} /></div>
                <div><Label className="text-xs">Số tài khoản</Label><Input className="mt-1 font-mono" value={edit.bank_account ?? ""} onChange={(e) => setEdit({ ...edit, bank_account: e.target.value })} /></div>
                <div><Label className="text-xs">Chủ tài khoản</Label><Input className="mt-1" value={edit.bank_owner ?? ""} onChange={(e) => setEdit({ ...edit, bank_owner: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 rounded border p-2">
                <input type="checkbox" checked={!!edit.tech_revenue} onChange={(e) => setEdit({ ...edit, tech_revenue: e.target.checked })} />
                <span><strong>Tính lương doanh số từ Lịch làm việc</strong> <span className="text-muted-foreground">(kỹ thuật viên — tiền công các lịch đã hoàn thành được phân công)</span></span>
              </label>
              <div className="grid grid-cols-2 gap-3 rounded border p-2">
                <div><Label className="text-xs">% hoa hồng</Label><Input className="mt-1" inputMode="decimal" placeholder="0.5" value={edit.commission_rate ?? ""} onChange={(e) => setEdit({ ...edit, commission_rate: e.target.value.replace(/[^\d.]/g, "") })} /></div>
                <div>
                  <Label className="text-xs">Trên doanh thu nhóm khách</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={edit.commission_group ?? ""} onChange={(e) => setEdit({ ...edit, commission_group: e.target.value })}>
                    <option value="">— Không —</option>
                    {groups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">Vd: 0.5 + Đại lý = 0,5% doanh thu các đơn hoàn tất trong tháng của khách nhóm Đại lý.</div>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={edit.in_payroll !== false} onChange={(e) => setEdit({ ...edit, in_payroll: e.target.checked })} />
                Có trong bảng lương
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEdit(null)}>Huỷ</Button>
                <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Lưu</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
