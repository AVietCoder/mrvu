// @ts-nocheck
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listClaimsFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ScrollX";
import { factorySolutionLabel } from "@/lib/types";
import { Plus, Search, Loader2, AlertTriangle, PackageCheck, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { ReturnBadge, PRESETS, presetRange, dmy, shortStaff } from "./shared";
import { ClaimForm, ClaimReturnDialog } from "./ClaimForm";

const SELECT = "h-10 rounded-md border bg-background px-3 text-sm";

/**
 * Yêu cầu bảo hành gửi nhà máy (chỉ admin).
 *   mode = "all"      → mọi yêu cầu, lọc theo ngày tiếp nhận.
 *   mode = "awaiting" → tab "Chờ NM trả hàng": hàng nhà máy nhận đổi mới nhưng
 *                       chưa gửi trả (mọi thời gian, chờ lâu nhất lên đầu).
 */
export function ClaimsTab({ mode, metaHook, fromTicket, onFromTicketDone }: { mode: "all" | "awaiting"; metaHook: any; fromTicket?: any; onFromTicketDone?: () => void }) {
  const { user } = useAuth();
  const { meta } = metaHook;
  const listFn = useServerFn(listClaimsFn);
  const awaitingMode = mode === "awaiting";

  const [preset, setPreset] = useState("3m");
  const [range, setRange] = useState(presetRange("3m"));
  const [factoryId, setFactoryId] = useState("");
  const [status, setStatus] = useState(awaitingMode ? "awaiting" : "all");
  const [q, setQ] = useState("");
  const qDeb = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [formClaim, setFormClaim] = useState<any | null | undefined>(undefined); // undefined = đóng, null = thêm mới
  const [returning, setReturning] = useState<any | null>(null);

  // Bấm "Gửi nhà máy" ở phiếu khách lẻ / đại lý → mở form điền sẵn.
  useEffect(() => { if (fromTicket) setFormClaim(null); }, [fromTicket?.id]);
  useEffect(() => { setStatus(awaitingMode ? "awaiting" : "all"); }, [awaitingMode]);
  useEffect(() => { setPage(1); }, [mode, range.from, range.to, factoryId, status, qDeb]);

  const from = awaitingMode ? undefined : range.from || undefined;
  const to = awaitingMode ? undefined : range.to || undefined;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["warranty", "claims", mode, from, to, factoryId, status, qDeb, page],
    queryFn: () => listFn({ data: { actorId: user?.id, from, to, factoryId: factoryId || undefined, status, q: qDeb, page, pageSize: 30 } }),
    enabled: Boolean(user?.id),
    placeholderData: (prev: any) => prev,
  });
  const c = data?.counts ?? {};
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 30));
  const chips = awaitingMode
    ? [["awaiting", "Đang chờ NM trả", c.awaiting ?? 0, "bg-amber-100 text-amber-800 border-amber-200"], ["overdue", "Quá hạn", c.overdue ?? 0, "bg-rose-100 text-rose-800 border-rose-200"]]
    : [
        ["all", "Tất cả", c.all ?? 0, "bg-white text-slate-700 border-slate-200"],
        ["no_solution", "NM chưa trả lời", c.no_solution ?? 0, "bg-slate-100 text-slate-700 border-slate-200"],
        ["awaiting", "Chờ NM trả hàng", c.awaiting ?? 0, "bg-amber-100 text-amber-800 border-amber-200"],
        ["overdue", "Quá hạn", c.overdue ?? 0, "bg-rose-100 text-rose-800 border-rose-200"],
        ["returned", "NM đã gửi trả", c.returned ?? 0, "bg-emerald-100 text-emerald-800 border-emerald-300"],
        ["rejected", "Từ chối / Đóng", c.rejected ?? 0, "bg-slate-200 text-slate-700 border-slate-300"],
      ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!awaitingMode && (
          <>
            <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
              {PRESETS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setPreset(k); setRange(presetRange(k)); }} className={`rounded-md px-2.5 py-1 text-sm ${preset === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
              ))}
            </div>
            <Input type="date" className="h-10 w-40" value={range.from} onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} />
            <span className="text-muted-foreground">→</span>
            <Input type="date" className="h-10 w-40" value={range.to} onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} />
          </>
        )}
        {awaitingMode && <div className="text-sm text-muted-foreground">Hàng nhà máy đã nhận đổi mới nhưng chưa gửi trả — bấm <strong>Đã nhận hàng</strong> khi kiện hàng về kho.</div>}
        <Button className="ml-auto" onClick={() => setFormClaim(null)}><Plus className="mr-1.5 h-4 w-4" />Thêm yêu cầu nhà máy</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 pl-9" placeholder="Tìm mã yêu cầu, mẫu quạt, lỗi, mã vận đơn…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={SELECT} value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
          <option value="">Tất cả nhà máy</option>
          {(meta?.factories ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chips.map(([k, label, n, tone]: any) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${tone} ${status === k ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}>
            {label} <span className="tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {error ? (
          <div className="p-6 text-sm text-destructive">{String((error as any).message)}</div>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (data?.rows ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{awaitingMode ? "Không có hàng nào đang chờ nhà máy gửi trả." : "Chưa có yêu cầu nào khớp bộ lọc."}</div>
        ) : (
          <ScrollX>
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Mã yêu cầu</th>
                  <th className="px-3 font-semibold">Tiếp nhận</th>
                  <th className="px-3 font-semibold">Nhà máy</th>
                  <th className="px-3 font-semibold">Mẫu quạt</th>
                  <th className="px-3 font-semibold">Tình trạng lỗi</th>
                  <th className="px-3 font-semibold">Hướng xử lý từ NM</th>
                  <th className="px-3 font-semibold">Gửi trả</th>
                  <th className="px-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.id} className={`cursor-pointer hover:brightness-95 ${r.overdue ? "bg-rose-50/70" : r.awaiting ? "bg-amber-50/60" : ""}`} onClick={() => setFormClaim(r)}>
                    <td className="border-t px-3 py-2.5 align-top">
                      <div className="font-mono text-xs font-semibold">{r.code}</div>
                      {r.ticket_code && <div className="font-mono text-xs text-muted-foreground">↳ {r.ticket_code}</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">
                      <div className="tabular-nums">{dmy(r.received_date)}</div>
                      <div className="text-xs text-muted-foreground">{shortStaff(metaHook.staffName(r.receiver_id))}</div>
                    </td>
                    <td className="border-t px-3 py-2.5 align-top font-medium">{r.factory_name ?? "(đã xoá)"}</td>
                    <td className="max-w-[180px] border-t px-3 py-2.5 align-top"><div className="line-clamp-2">{r.product_model || "—"}</div></td>
                    <td className="max-w-[240px] border-t px-3 py-2.5 align-top">
                      <div className="line-clamp-2 text-muted-foreground">{r.defect_description || "—"}</div>
                      {(r.media ?? []).length > 0 && <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="h-3 w-3" />{r.media.length} file</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top">{r.factory_solution ? factorySolutionLabel(r.factory_solution) : <span className="text-muted-foreground">NM chưa trả lời</span>}</td>
                    <td className="border-t px-3 py-2.5 align-top whitespace-nowrap">
                      <ReturnBadge status={r.return_status} />
                      {r.awaiting && (
                        <div className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${r.overdue ? "text-rose-600" : "text-amber-700"}`}>
                          <AlertTriangle className="h-3.5 w-3.5" />chờ {r.days_waiting} ngày{r.overdue ? ` (hạn ${r.sla_days})` : ""}
                        </div>
                      )}
                      {r.returned_date && <div className="mt-0.5 text-xs text-muted-foreground">{dmy(r.returned_date)}{r.shipping_note ? ` · ${r.shipping_note}` : ""}</div>}
                    </td>
                    <td className="border-t px-3 py-2.5 align-top text-right" onClick={(e) => e.stopPropagation()}>
                      {r.awaiting && (
                        <Button size="sm" variant="outline" className="h-8 whitespace-nowrap border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setReturning(r)}>
                          <PackageCheck className="mr-1 h-4 w-4" />Đã nhận hàng
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
        {(data?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
            <span>{data.total} yêu cầu{isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-2">Trang {page}/{totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <ClaimForm
        open={formClaim !== undefined}
        claim={formClaim}
        fromTicket={formClaim === null ? fromTicket : undefined}
        metaHook={metaHook}
        onClose={() => { setFormClaim(undefined); onFromTicketDone?.(); }}
        onSaved={() => { setFormClaim(undefined); onFromTicketDone?.(); }}
      />
      <ClaimReturnDialog claim={returning} onClose={() => setReturning(null)} />
    </div>
  );
}
