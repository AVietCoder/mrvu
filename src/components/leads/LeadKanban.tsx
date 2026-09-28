// @ts-nocheck
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLeadsFn, setLeadStageFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEAD_STAGES, LEAD_LOST_REASONS } from "@/lib/types";
import { Loader2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { dm, todayVN, shortStaff, money } from "./shared";

/**
 * 6 cột trạng thái, kéo thả thẻ để đổi bước (máy tính). Trên điện thoại bấm
 * thẻ để mở chi tiết rồi đổi trạng thái ở đó. Kéo sang "Không chốt" → hỏi lý do.
 */
export function LeadKanban({ filters, metaHook, onOpen }: any) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listLeadsFn);
  const stageFn = useServerFn(setLeadStageFn);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["leads", "kanban", filters],
    queryFn: () => listFn({ data: { actorId: user?.id, ...filters, stage: "all", pageSize: 1000 } }),
  });
  const rows = (data?.rows ?? []) as any[];
  const today = todayVN();

  async function move(lead: any, stage: string, extra: any = {}) {
    if (lead.stage === stage) return;
    if (!lead.can_edit) return toast.error("Bạn chỉ đổi trạng thái khách mình phụ trách / hỗ trợ");
    try {
      await stageFn({ data: { actorId: user?.id, leadId: lead.id, stage, ...extra } });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", lead.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  if (isLoading) return <Card className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  if (error) return <Card className="text-sm text-destructive">{String((error as any).message)}</Card>;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {LEAD_STAGES.map((s) => {
          const col = rows.filter((r) => r.stage === s.key);
          const revenue = s.key === "won" ? col.reduce((a, r) => a + (Number(r.won_amount) || 0), 0) : 0;
          return (
            <div
              key={s.key}
              onDragOver={(e) => { e.preventDefault(); setOver(s.key); }}
              onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const lead = rows.find((r) => r.id === dragId);
                setDragId(null);
                if (!lead) return;
                if (s.key === "lost") { setLostFor(lead); setReason(""); setNote(""); return; }
                move(lead, s.key);
              }}
              className={`flex min-h-[200px] flex-col rounded-xl border bg-slate-50/60 transition-colors ${over === s.key ? "ring-2 ring-primary" : ""}`}
            >
              <div className={`flex items-center justify-between rounded-t-xl border-b px-3 py-2 ${s.tone}`}>
                <span className="font-semibold">{s.label}</span>
                <span className="text-sm font-bold">{col.length}</span>
              </div>
              {revenue > 0 && <div className="border-b px-3 py-1 text-xs text-emerald-700">Doanh thu {money(revenue)}đ</div>}
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                {col.map((r) => {
                  const overdue = r.next_follow_up && r.next_follow_up <= today && !["won", "lost"].includes(r.stage);
                  return (
                    <div
                      key={r.id}
                      draggable={r.can_edit}
                      onDragStart={() => setDragId(r.id)}
                      onClick={() => onOpen(r.id)}
                      className={`cursor-pointer rounded-lg border bg-background p-2.5 text-sm shadow-sm hover:shadow-md ${overdue ? "border-amber-400" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold leading-tight">{r.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{dm(r.lead_date)}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {[...(r.interest_product_ids ?? []).map(metaHook.productName), r.interest_note].filter(Boolean).join(", ") || "—"}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{r.owner_id ? shortStaff(metaHook.staffName(r.owner_id)) : r.legacy_staff || "Chưa gán"}</span>
                        {r.next_follow_up && !["won", "lost"].includes(r.stage) && (
                          <span className={`flex items-center gap-0.5 ${overdue ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>
                            <CalendarClock className="h-3 w-3" />{dm(r.next_follow_up)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {col.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">Kéo thẻ vào đây</div>}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(lostFor)} onOpenChange={(v) => !v && setLostFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Không chốt — {lostFor?.name}</DialogTitle></DialogHeader>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— Lý do —</option>
            {LEAD_LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <Input placeholder="Ghi thêm (bắt buộc nếu Khác)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLostFor(null)}>Huỷ</Button>
            <Button variant="destructive" disabled={!reason} onClick={async () => { await move(lostFor, "lost", { lostReason: reason, lostNote: note }); setLostFor(null); }}>Xác nhận</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
