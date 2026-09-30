// @ts-nocheck
import { Fragment, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listLeadsFn, exportLeadsFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ScrollX";
import { LEAD_STAGES, CUSTOMER_SOURCES } from "@/lib/types";
import { exportLeadsExcel } from "@/lib/export-leads";
import { Plus, Search, List, Columns3, BarChart3, Download, Loader2, CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useLeadMeta, StageBadge, dm, dmy, todayVN, addDaysStr, sourceText, shortStaff } from "./shared";
import { LeadForm } from "./LeadForm";
import { LeadDetail } from "./LeadDetail";
import { LeadKanban } from "./LeadKanban";
import { LeadReport } from "./LeadReport";

const PRESETS = [
  ["this", "Tháng này"],
  ["last", "Tháng trước"],
  ["3m", "3 tháng"],
  ["year", "Năm nay"],
  ["all", "Tất cả"],
] as const;
function presetRange(p: string) {
  const t = todayVN();
  const [y, m] = t.split("-").map(Number);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  if (p === "this") return { from: first(y, m), to: t };
  if (p === "last") return { from: first(y, m - 1), to: addDaysStr(first(y, m), -1) };
  if (p === "3m") return { from: first(y, m - 2), to: t };
  if (p === "year") return { from: `${y}-01-01`, to: t };
  return { from: "", to: "" };
}

/** Tab "Khách tiềm năng" trong trang Khách hàng (thay file Excel quản lý khách HCM). */
export function LeadsTab({ openLeadId }: { openLeadId?: string }) {
  const { user } = useAuth();
  const metaHook = useLeadMeta();
  const { meta } = metaHook;
  const listFn = useServerFn(listLeadsFn);
  const exportFn = useServerFn(exportLeadsFn);

  const [view, setView] = useState<"list" | "kanban" | "report">("list");
  const [preset, setPreset] = useState("3m");
  const [range, setRange] = useState(presetRange("3m"));
  const [branchId, setBranchId] = useState("");
  const [stage, setStage] = useState("open");
  const [ownerId, setOwnerId] = useState("");
  const [source, setSource] = useState("");
  const [due, setDue] = useState(false);
  const [q, setQ] = useState("");
  const qDeb = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [formLead, setFormLead] = useState<any | null | undefined>(undefined); // undefined = đóng, null = thêm mới
  const [detailId, setDetailId] = useState<string | null>(openLeadId ?? null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (openLeadId) setDetailId(openLeadId); }, [openLeadId]);
  useEffect(() => { setPage(1); }, [range, branchId, stage, ownerId, source, due, qDeb]);

  const filters = { from: range.from || undefined, to: range.to || undefined, branchId: branchId || undefined, ownerId: ownerId || undefined, source: source || undefined, followUp: due ? "due" : undefined, q: qDeb || undefined };
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["leads", "list", filters, stage, page],
    queryFn: () => listFn({ data: { actorId: user?.id, ...filters, stage, page, pageSize: 50 } }),
    enabled: view === "list" && Boolean(user?.id),
    placeholderData: (p) => p,
  });

  async function doExport() {
    setExporting(true);
    try {
      const rows = await exportFn({ data: { actorId: user?.id, from: filters.from, to: filters.to, branchId: filters.branchId } });
      await exportLeadsExcel({
        rows,
        branchName: metaHook.branchName,
        staffName: metaHook.staffName,
        productName: metaHook.productName,
        fileName: `khach-tiem-nang${range.from ? `-${range.from}` : ""}${range.to ? `-den-${range.to}` : ""}.xlsx`,
      });
      toast.success(`Đã xuất ${rows.length} khách tiềm năng`);
    } catch (e: any) {
      toast.error(e?.message ?? "Xuất Excel thất bại");
    } finally {
      setExporting(false);
    }
  }

  const today = todayVN();
  const rows = (data?.rows ?? []) as any[];
  const sc = data?.stageCounts ?? {};
  const openCount = ["new", "consulting", "appointment", "quoted"].reduce((a, k) => a + (sc[k] ?? 0), 0);
  const allCount = Object.values(sc).reduce((a: number, b: any) => a + Number(b), 0);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-4">
      {/* ── Thanh công cụ ── */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {[["list", "Danh sách", List], ["kanban", "Kanban", Columns3], ["report", "Báo cáo", BarChart3]].map(([k, l, Icon]: any) => (
              <button key={k} onClick={() => setView(k)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${view === k ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                <Icon className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(([k, l]) => (
              <button key={k} onClick={() => { setPreset(k); setRange(presetRange(k)); }} className={`rounded-full border px-2.5 py-1 text-xs ${preset === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>
            ))}
          </div>
          <Input type="date" className="h-9 w-36" value={range.from} onChange={(e) => { setPreset(""); setRange((r) => ({ ...r, from: e.target.value })); }} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-9 w-36" value={range.to} onChange={(e) => { setPreset(""); setRange((r) => ({ ...r, to: e.target.value })); }} />
          <div className="flex-1" />
          <Button variant="outline" onClick={doExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Xuất Excel
          </Button>
          <Button onClick={() => setFormLead(null)}><Plus className="mr-1.5 h-4 w-4" />Thêm khách tiềm năng</Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Tìm tên, SĐT…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className={sel} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Mọi showroom</option>
            {(meta?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={sel} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Mọi người phụ trách</option>
            <option value="__none">Chưa gán</option>
            {(meta?.staff ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select className={sel} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Mọi nguồn</option>
            {CUSTOMER_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="__none">Chưa có nguồn</option>
          </select>
          <button onClick={() => setDue((v) => !v)} className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm ${due ? "border-amber-400 bg-amber-100 text-amber-900" : "hover:bg-muted"}`}>
            <CalendarClock className="h-4 w-4" />Cần chăm hôm nay
          </button>
        </div>

        {view === "list" && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[["open", "Đang mở", openCount], ...LEAD_STAGES.map((s) => [s.key, s.label, sc[s.key] ?? 0]), ["all", "Tất cả", allCount]].map(([k, l, n]: any) => (
              <button key={k} onClick={() => setStage(k)} className={`rounded-full border px-3 py-1 text-sm ${stage === k ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {l} <span className={stage === k ? "opacity-80" : "text-muted-foreground"}>{n}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {view === "kanban" && <LeadKanban filters={filters} metaHook={metaHook} onOpen={setDetailId} />}
      {view === "report" && <LeadReport range={range} branchId={branchId} metaHook={metaHook} />}

      {data?.noBranch && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
          Tài khoản của bạn chưa được gán chi nhánh nào nên chưa xem được khách tiềm năng — nhờ quản trị viên gán chi nhánh ở trang Nhân viên.
        </Card>
      )}

      {view === "list" && (
        <Card className="p-0 overflow-hidden">
          {error ? (
            <div className="p-4 text-sm text-destructive">{String((error as any).message)}</div>
          ) : isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Không có khách tiềm năng phù hợp.</div>
          ) : (
            <ScrollX>
              <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[13px] text-slate-600">
                    {["Ngày", "Khách", "Khu vực", "Quan tâm", "Nguồn", "Lần chăm gần nhất", "Trạng thái", "Phụ trách", "Hẹn tiếp"].map((h) => (
                      <th key={h} className="border-b px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const month = String(r.lead_date).slice(0, 7);
                    const newMonth = i === 0 || month !== String(rows[i - 1].lead_date).slice(0, 7);
                    const overdue = r.next_follow_up && r.next_follow_up <= today && !["won", "lost"].includes(r.stage);
                    const tone = r.stage === "won" ? "bg-emerald-50/70" : r.stage === "lost" ? "bg-rose-50/70" : overdue ? "bg-amber-50/70" : "";
                    return (
                      <Fragment key={r.id}>
                        {newMonth && (
                          <tr><td colSpan={9} className="border-b bg-primary/5 px-3 py-1.5 text-center text-sm font-bold text-primary">Tháng {Number(month.slice(5))}/{month.slice(0, 4)}</td></tr>
                        )}
                        <tr className={`cursor-pointer hover:brightness-95 ${tone}`} onClick={() => setDetailId(r.id)}>
                          <td className="border-b px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{dm(r.lead_date)}</td>
                          <td className="border-b px-3 py-2.5 align-top">
                            <div className="font-semibold">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.phone || "—"}{r.customer_id && <span className="ml-1 rounded bg-sky-100 px-1 text-sky-700">khách cũ</span>}</div>
                          </td>
                          <td className="border-b px-3 py-2.5 align-top text-muted-foreground">{r.address || "—"}</td>
                          <td className="max-w-[220px] border-b px-3 py-2.5 align-top">
                            <div className="line-clamp-2">{[...(r.interest_product_ids ?? []).map(metaHook.productName), r.interest_note].filter(Boolean).join(", ") || "—"}</div>
                          </td>
                          <td className="border-b px-3 py-2.5 align-top whitespace-nowrap">{sourceText(r)}</td>
                          <td className="max-w-[280px] border-b px-3 py-2.5 align-top">
                            {r.last_activity ? (
                              <>
                                <div className="text-xs text-muted-foreground">{dmy(String(r.last_activity.at).slice(0, 10))}</div>
                                <div className="line-clamp-2">{r.last_activity.content}</div>
                              </>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="border-b px-3 py-2.5 align-top">
                            <StageBadge stage={r.stage} />
                            {r.won_order_code && <div className="mt-0.5 font-mono text-xs text-emerald-700">{r.won_order_code}</div>}
                          </td>
                          <td className="border-b px-3 py-2.5 align-top whitespace-nowrap">
                            {r.owner_id ? shortStaff(metaHook.staffName(r.owner_id)) : <span className="text-muted-foreground">{r.legacy_staff || "Chưa gán"}</span>}
                            {(r.helper_ids ?? []).length > 0 && <div className="text-xs text-muted-foreground">+ {(r.helper_ids ?? []).map((h: string) => shortStaff(metaHook.staffName(h))).join(", ")}</div>}
                          </td>
                          <td className={`border-b px-3 py-2.5 align-top whitespace-nowrap ${overdue ? "font-semibold text-amber-700" : ""}`}>{r.next_follow_up ? dm(r.next_follow_up) : "—"}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          )}
          {(data?.total ?? 0) > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
              <span>{data.total} khách{isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="px-2">Trang {page}/{totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <LeadForm
        open={formLead !== undefined}
        lead={formLead}
        meta={meta}
        onClose={() => setFormLead(undefined)}
        onSaved={(id: string) => { setFormLead(undefined); setDetailId(id); }}
      />
      <LeadDetail
        leadId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onEdit={(l: any) => { setDetailId(null); setFormLead(l); }}
        metaHook={metaHook}
      />
    </div>
  );
}
