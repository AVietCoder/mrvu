// @ts-nocheck
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyAttendanceFn, setMyAttendanceFn } from "@/lib/hr.functions";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarCheck, Loader2, Lock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const CODES = [
  ["X", "Cả ngày", "bg-emerald-100 text-emerald-800 border-emerald-300"],
  ["N", "Nửa ngày", "bg-amber-100 text-amber-800 border-amber-300"],
  ["L", "Nghỉ có lương", "bg-sky-100 text-sky-800 border-sky-300"],
  ["K", "Nghỉ không lương", "bg-rose-100 text-rose-700 border-rose-300"],
] as const;
const STYLE: Record<string, string> = Object.fromEntries(CODES.map(([k, , c]) => [k, c]));
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/**
 * Tự chấm công (quyền "Tự chấm công"). Nhân viên chỉ chấm được NGÀY HÔM NAY —
 * server tự lấy ngày theo giờ VN. Ngày quản lý đã chấm thì chỉ thêm ghi chú.
 * Bên dưới là lịch tháng (chỉ xem) để tự theo dõi số công.
 */
export function MyAttendanceCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyAttendanceFn);
  const setFn = useServerFn(setMyAttendanceFn);
  const month = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  const { data, isLoading, error } = useQuery({
    queryKey: ["myAttendance", userId, month],
    queryFn: () => getFn({ data: { actorId: userId, month } }),
    enabled: Boolean(userId),
  });
  const todayRec = data ? data.days?.[data.today] : null;
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCode(todayRec?.code ?? null);
    setNote(todayRec?.note ?? "");
  }, [todayRec?.code, todayRec?.note]);

  async function save() {
    setSaving(true);
    try {
      await setFn({ data: { actorId: userId, code: data?.todayByManager ? undefined : code, note } });
      toast.success("Đã lưu chấm công hôm nay");
      qc.invalidateQueries({ queryKey: ["myAttendance"] });
      qc.invalidateQueries({ queryKey: ["mySalary"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu chấm công");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Card className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;
  if (!data) return null;

  const [y, m, d] = data.today.split("-");
  const lockedCode = data.todayByManager || data.locked;
  const changed = code !== (todayRec?.code ?? null) || note !== (todayRec?.note ?? "");
  const lead = (dow(data.dates[0]) + 6) % 7; // lịch bắt đầu từ Thứ Hai

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarCheck className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Chấm công hôm nay</div>
          <div className="text-xs text-muted-foreground">{WD[dow(data.today)]}, {Number(d)}/{Number(m)}/{y}</div>
        </div>
        <div className="rounded-lg bg-slate-100 px-3 py-1 text-right tabular-nums">
          <span className="text-lg font-bold">{data.totals.worked}</span>
          <span className="text-xs text-muted-foreground">/{data.standard_days} công tháng {Number(m)}</span>
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        {/* Chấm hôm nay */}
        <div className="space-y-3">
          {data.locked && (
            <div className="flex items-center gap-1.5 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800"><Lock className="h-4 w-4" />Lương tháng này đã chốt — không chấm được nữa.</div>
          )}
          {data.todayByManager && !data.locked && (
            <div className="flex items-center gap-1.5 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
              <CheckCircle2 className="h-4 w-4" />Quản lý đã chấm hôm nay cho bạn — bạn chỉ thêm được ghi chú.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CODES.map(([k, label, cls]) => (
              <button
                key={k}
                disabled={lockedCode}
                onClick={() => setCode(k)}
                className={`rounded-xl border-2 px-2 py-3 text-center transition-all disabled:cursor-not-allowed ${cls} ${code === k ? "ring-2 ring-primary ring-offset-1" : "border-transparent opacity-80 hover:opacity-100"}`}
              >
                <div className="text-xl font-bold">{k}</div>
                <div className="text-xs font-medium">{label}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Ghi chú (vd: đi lắp Biên Hoà, xin nghỉ chiều…)"
              value={note}
              disabled={data.locked || !code}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button onClick={save} disabled={saving || data.locked || !code || !changed}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lưu
            </Button>
          </div>
          {todayRec && !changed && (
            <div className="text-xs text-muted-foreground">
              Đã chấm: <strong className="text-foreground">{CODES.find(([k]) => k === todayRec.code)?.[1]}</strong>
              {todayRec.self ? " (bạn tự chấm)" : " (quản lý chấm)"}.
            </div>
          )}
        </div>

        {/* Lịch tháng — chỉ xem */}
        <div>
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-muted-foreground">
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => <div key={`x${i}`} />)}
            {data.dates.map((dt: string) => {
              const rec = data.days[dt];
              const isToday = dt === data.today;
              return (
                <div
                  key={dt}
                  title={rec ? `${CODES.find(([k]) => k === rec.code)?.[1] ?? ""}${rec.note ? ` — ${rec.note}` : ""}` : "Chưa chấm"}
                  className={`relative grid aspect-square place-items-center rounded-md border text-xs font-bold ${rec ? STYLE[rec.code] : "border-slate-100 text-slate-300"} ${isToday ? "ring-2 ring-amber-400" : ""}`}
                >
                  <span className="absolute left-1 top-0.5 text-[9px] font-normal opacity-60">{Number(dt.slice(8))}</span>
                  {rec?.code ?? ""}
                  {rec?.note && <span className="absolute right-0 top-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-rose-500" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
