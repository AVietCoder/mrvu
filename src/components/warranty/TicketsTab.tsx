// @ts-nocheck
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listTicketsFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ScrollX";
import { CustomerName } from "@/components/CustomerName";
import { WARRANTY_STAGES, warrantyActionLabel, warrantyIssueLabel } from "@/lib/types";
import { Plus, Search, Loader2, AlarmClock, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { StageBadge, WarrantyBadge, PRESETS, presetRange, dmyTime, dmy, money, shortStaff, shortBranch } from "./shared";
import { TicketForm } from "./TicketForm";
import { TicketDetail } from "./TicketDetail";

const SELECT = "h-10 rounded-md border bg-background px-3 text-sm";
const ROW_TONE: Record<string, string> = { in: "bg-emerald-50/50", out: "bg-rose-50/60", partial: "bg-amber-50/60", unknown: "" };

/** Danh sách phiếu bảo hành của khách lẻ (kind = retail) hoặc đại lý (kind = dealer). */
export function TicketsTab({ kind, metaHook, openTicketId, onSendFactory }: { kind: "retail" | "dealer"; metaHook: any; openTicketId?: string; onSendFactory?: (t: any) => void }) {
  const { user } = useAuth();
  const { meta } = metaHook;
  const listFn = useServerFn(listTicketsFn);
  const isDealer = kind === "dealer";

  const [preset, setPreset] = useState("3m");
  const [range, setRange] = useState(presetRange("3m"));
  const [branchId, setBranchId] = useState("");
  const [stage, setStage] = useState("open");
  const [warranty, setWarranty] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState("");
  const qDeb = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [formTicket, setFormTicket] = useState<any | null | undefined>(undefined); // undefined = đóng, null = thêm mới
  const [detailId, setDetailId] = useState<string | null>(openTicketId ?? null);

  useEffect(() => { if (openTicketId) setDetailId(openTicketId); }, [openTicketId]);
  useEffect(() => { setPage(1); }, [kind, range.from, range.to, branchId, stage, warranty, technicianId, overdue, qDeb]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["warranty", "tickets", kind, range.from, range.to, branchId, stage, warranty, technicianId, overdue, qDeb, page],
    queryFn: () =>
      listFn({
        data: {
          actorId: user?.id, kind, from: range.from || undefined, to: range.to || undefined,
          branchId: branchId || undefined, stage, warranty: warranty || undefined,
          technicianId: technicianId || undefined, overdue: overdue || undefined, q: qDeb, page, pageSize: 30,
        },
      }),
    enabled: Boolean(user?.id),
    placeholderData: (prev: any) => prev,
  });

  const counts = data?.stageCounts ?? {};
  const openCount = (counts.new ?? 0) + (counts.processing ?? 0) + (counts.waiting_part ?? 0);
  const allCount = Object.values(counts).reduce((a: number, b: any) => a + Number(b), 0);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 30));
  const technicians = (meta?.staff ?? []).filter((u: any) => u.is_technician);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setPreset(k); setRange(presetRange(k)); }} className={`rounded-md px-2.5 py-1 text-sm ${preset === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
        <Input type="date" className="h-10 w-40" value={range.from} onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} />
        <span className="text-muted-foreground">→</span>
        <Input type="date" className="h-10 w-40" value={range.to} onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} />
        <Button className="ml-auto" onClick={() => setFormTicket(null)}><Plus className="mr-1.5 h-4 w-4" />Thêm phiếu {isDealer ? "đại lý" : "khách lẻ"}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 pl-9" placeholder={`Tìm mã phiếu, ${isDealer ? "đại lý" : "tên khách"}, SĐT, mẫu quạt…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(meta?.branches ?? []).length > 1 && (
          <select className={SELECT} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Tất cả showroom</option>
            {(meta?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{shortBranch(b.name)}</option>)}
          </select>
        )}
        <select className={SELECT} value={warranty} onChange={(e) => setWarranty(e.target.value)}>
          <option value="">Còn hạn + hết hạn</option>
          <option value="in">🟢 Còn hạn BH</option>
          <option value="out">🛑 Hết hạn BH</option>
          <option value="partial">🟡 Còn hạn một phần</option>
          <option value="unknown">Chưa rõ ngày mua</option>
        </select>
        <select className={SELECT} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Mọi kỹ thuật</option>
          <option value="__none">Chưa phân công</option>
          {technicians.map((u: any) => <option key={u.id} value={u.id}>{shortStaff(u.full_name)}</option>)}
        </select>
        <button type="button" onClick={() => setOverdue((v) => !v)} className={`inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm ${overdue ? "border-rose-400 bg-rose-50 text-rose-700" : "hover:bg-muted"}`}>
          <AlarmClock className="h-4 w-4" />Quá 24h chưa phản hồi{(data?.overdueCount ?? 0) > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-xs font-semibold text-white">{data.overdueCount}</span>}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[["open", "Đang xử lý", openCount, "bg-slate-100 text-slate-700 border-slate-200"], ...WARRANTY_STAGES.map((s) => [s.key, s.label, counts[s.key] ?? 0, s.tone]), ["all", "Tất cả", allCount, "bg-white text-slate-700 border-slate-200"]].map(([k, label, n, tone]: any) => (
          <button key={k} type="button" onClick={() => setStage(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${tone} ${stage === k ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}>
            {label} <span className="tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      {data?.noBranch && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
          Tài khoản của bạn chưa được gán chi nhánh nào nên chưa xem được phiếu bảo hành — nhờ quản trị viên gán chi nhánh ở trang Nhân viên.
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {error ? (
          <div className="p-6 text-sm text-destructive">{String((error as any).message)}</div>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (data?.rows ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Chưa có phiếu bảo hành nào khớp bộ lọc.</div>
        ) : (
          <ScrollX>
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Mã phiếu</th>
                  <th className="px-3 font-semibold">Ngày gửi</th>
                  <th className="px-3 font-semibold">{isDealer ? "Đại lý" : "Khách hàng"}</th>
                  <th className="px-3 font-semibold">Mẫu quạt</th>
                  <th className="px-3 font-semibold">Bảo hành</th>
                  <th className="px-3 font-semibold">Tình trạng báo</th>
                  <th className="px-3 font-semibold">Kỹ thuật</th>
                  <th className="px-3 font-semibold">Kết quả</th>
                  <th className="px-3 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.id} className={`cursor-pointer hover:brightness-95 ${ROW_TONE[r.warranty] ?? ""}`} onClick={() => setDetailId(r.id)}>
                    <td className="border-t px-3 py-2.5 align-top">
                      <div className="font-mono text-xs font-semibold">{r.code}</div>
                      {(meta?.allBranches ?? []).length > 1 && <div className="text-xs text-muted-foreground">{shortBranch(metaHook.branchName(r.branch_id))}</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">
                      <div className="tabular-nums">{dmyTime(r.sent_date)}</div>
                      {r.overdue && <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-rose-600"><AlarmClock className="h-3.5 w-3.5" />chưa phản hồi {r.hours_waiting}h</div>}
                    </td>
                    <td className="max-w-[220px] border-t px-3 py-2.5 align-top">
                      <CustomerName name={r.customer_name} company={r.customer_company} className="font-semibold" />
                      <div className="text-xs text-muted-foreground">{r.phone || "—"}</div>
                    </td>
                    <td className="max-w-[180px] border-t px-3 py-2.5 align-top"><div className="line-clamp-2">{r.product_model || "—"}</div></td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">
                      <WarrantyBadge warranty={r.warranty} expiresOn={r.expires_on} motorIn={r.motor_in} />
                      <div className="mt-0.5 text-xs text-muted-foreground">{r.purchase_date ? `mua ${dmy(r.purchase_date)}` : ""}</div>
                    </td>
                    <td className="max-w-[240px] border-t px-3 py-2.5 align-top">
                      {r.issue_type && <div className="text-xs font-medium">{warrantyIssueLabel(r.issue_type)}</div>}
                      <div className="line-clamp-2 text-muted-foreground">{r.issue_note || (r.issue_type ? "" : "—")}</div>
                      {(r.attachments ?? []).length > 0 && <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="h-3 w-3" />{r.attachments.length} file</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">{r.technician_id ? shortStaff(metaHook.staffName(r.technician_id)) : <span className="text-muted-foreground">Chưa phân công</span>}</td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">
                      {r.final_action ? warrantyActionLabel(r.final_action) : <span className="text-muted-foreground">—</span>}
                      {Number(r.spare_part_price) > 0 && <div className="text-xs font-medium tabular-nums">{money(r.spare_part_price)}đ</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top"><StageBadge stage={r.stage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
        {(data?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
            <span>{data.total} phiếu{isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-2">Trang {page}/{totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <TicketForm
        open={formTicket !== undefined}
        kind={kind}
        ticket={formTicket}
        onClose={() => setFormTicket(undefined)}
        onSaved={(r: any) => { setFormTicket(undefined); setDetailId(r.id); }}
      />
      <TicketDetail
        ticketId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onEdit={(t: any) => { setDetailId(null); setFormTicket(t); }}
        onSendFactory={onSendFactory ? (t: any) => { setDetailId(null); onSendFactory(t); } : undefined}
        metaHook={metaHook}
      />
    </div>
  );
}
