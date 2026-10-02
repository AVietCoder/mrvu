// @ts-nocheck
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLeadFn, addLeadActivityFn, setLeadStageFn, convertLeadToCustomerFn, deleteLeadFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { useCustomerGroups } from "@/hooks/useCustomerGroups";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_STAGES, LEAD_LOST_REASONS, LEAD_ACTIVITY_KINDS } from "@/lib/types";
import { Loader2, Phone, MapPin, Pencil, UserPlus, ShoppingCart, Trash2, CalendarClock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { StageBadge, money, dmy, dm, todayVN, addDaysStr, sourceText, shortStaff } from "./shared";

const KIND_ICON: Record<string, string> = { call: "📞", zalo: "💬", quote: "🧾", visit: "🏬", note: "📝", stage: "🔁" };

export function LeadDetail({ leadId, open, onClose, onEdit, metaHook }: any) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getLeadFn);
  const actFn = useServerFn(addLeadActivityFn);
  const stageFn = useServerFn(setLeadStageFn);
  const convFn = useServerFn(convertLeadToCustomerFn);
  const delFn = useServerFn(deleteLeadFn);
  const { active: groups } = useCustomerGroups();
  const { data, isLoading, error } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => getFn({ data: { actorId: user?.id, id: leadId } }),
    enabled: open && Boolean(leadId),
  });
  const [kind, setKind] = useState("call");
  const [content, setContent] = useState("");
  const [follow, setFollow] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostNote, setLostNote] = useState("");
  const [wonOpen, setWonOpen] = useState(false);
  const [wonCode, setWonCode] = useState("");
  const [wonAmount, setWonAmount] = useState("");
  const [convOpen, setConvOpen] = useState(false);
  const [group, setGroup] = useState("");

  const l = data?.lead;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["myFollowUps"] });
  };
  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const today = todayVN();
  const overdue = l?.next_follow_up && l.next_follow_up <= today && !["won", "lost"].includes(l.stage);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {isLoading || !l ? (
          <div className="flex justify-center py-12">{error ? <span className="text-destructive">{String((error as any).message)}</span> : <Loader2 className="h-6 w-6 animate-spin" />}</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                {l.name} <StageBadge stage={l.stage} />
                {l.won_auto && <span className="text-xs font-normal text-emerald-700">(tự nhận theo đơn)</span>}
              </DialogTitle>
              <DialogDescription>
                {metaHook.branchName(l.branch_id)} · tiếp nhận {dmy(l.lead_date)} · phụ trách <strong>{metaHook.staffName(l.owner_id)}</strong>
                {(l.helper_ids ?? []).length > 0 && <> · hỗ trợ {(l.helper_ids ?? []).map((h: string) => shortStaff(metaHook.staffName(h))).join(", ")}</>}
                {l.legacy_staff && <> · NV (dữ liệu cũ): {l.legacy_staff}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {/* Thông tin */}
              <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{l.phone || <span className="text-muted-foreground">Chưa có SĐT</span>}</div>
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{l.address || "—"}</div>
                <div><span className="text-muted-foreground">Nguồn: </span>{sourceText(l)}</div>
                <div className={overdue ? "font-medium text-amber-700" : ""}>
                  <CalendarClock className="mr-1 inline h-4 w-4" />Hẹn chăm: {l.next_follow_up ? dmy(l.next_follow_up) : "—"}{overdue && " (tới hạn)"}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Quan tâm: </span>
                  {(l.interest_product_ids ?? []).map((id: string) => (
                    <span key={id} className="mr-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{metaHook.productName(id)}</span>
                  ))}
                  {l.interest_note || ((l.interest_product_ids ?? []).length ? "" : "—")}
                </div>
                {data.customer && (
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Khách hàng: </span>
                    <Link to="/customers/$id" params={{ id: data.customer.id }} className="font-medium text-primary underline">{data.customer.name}</Link>
                    {data.customer.company_name && <span className="text-muted-foreground"> ({data.customer.company_name})</span>}
                    <span className="text-muted-foreground"> — đã mua {data.customer.completed_orders} đơn</span>
                  </div>
                )}
                {l.stage === "won" && (
                  <div className="sm:col-span-2 font-medium text-emerald-700">
                    Đã chốt{data.order ? <> đơn <Link to="/orders/$id" params={{ id: data.order.id }} className="underline">{data.order.code}</Link></> : ""}
                    {l.won_amount ? ` — ${money(l.won_amount)}đ` : ""}
                  </div>
                )}
                {l.stage === "lost" && (
                  <div className="sm:col-span-2 text-rose-700">
                    Không chốt: {LEAD_LOST_REASONS.find((r) => r.key === l.lost_reason)?.label ?? "—"}{l.lost_note ? ` — ${l.lost_note}` : ""}
                  </div>
                )}
              </div>

              {/* Thao tác */}
              <div className="flex flex-wrap gap-2">
                {l.can_edit && <Button variant="outline" size="sm" onClick={() => onEdit(l)}><Pencil className="mr-1 h-4 w-4" />Sửa</Button>}
                {l.can_edit && !l.customer_id && (
                  <Button variant="outline" size="sm" onClick={() => setConvOpen((v) => !v)}><UserPlus className="mr-1 h-4 w-4" />Chuyển thành khách hàng</Button>
                )}
                {l.customer_id && (
                  <Link to="/orders" search={{ newFor: l.customer_id } as any}>
                    <Button size="sm"><ShoppingCart className="mr-1 h-4 w-4" />Tạo đơn</Button>
                  </Link>
                )}
                {l.can_assign && (
                  <Button
                    variant="ghost" size="sm" className="ml-auto text-destructive"
                    onClick={async () => {
                      if (!confirm(`Xoá khách tiềm năng "${l.name}"?`)) return;
                      if (await run("del", () => delFn({ data: { actorId: user?.id, id: l.id } }), "Đã xoá")) onClose();
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />Xoá
                  </Button>
                )}
              </div>
              {convOpen && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
                  <div className="min-w-[200px] flex-1">
                    <Label>Nhóm khách hàng *</Label>
                    <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" value={group} onChange={(e) => setGroup(e.target.value)}>
                      <option value="">— Chọn nhóm —</option>
                      {groups.map((g: any) => <option key={g.code} value={g.code}>{g.name}</option>)}
                    </select>
                  </div>
                  <Button
                    disabled={!group || busy === "conv"}
                    onClick={async () => {
                      if (await run("conv", () => convFn({ data: { actorId: user?.id, leadId: l.id, groupName: group } }), "Đã chuyển thành khách hàng")) setConvOpen(false);
                    }}
                  >
                    {busy === "conv" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Tạo khách hàng
                  </Button>
                  <div className="w-full text-xs text-muted-foreground">Mang theo tên, SĐT, địa chỉ, nguồn. Nếu SĐT đã là khách có sẵn thì chỉ nối, không tạo mới.</div>
                </div>
              )}

              {/* Trạng thái */}
              {l.can_edit && (
                <div>
                  <Label>Chuyển trạng thái</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {LEAD_STAGES.map((s) => (
                      <button
                        key={s.key}
                        disabled={s.key === l.stage || Boolean(busy)}
                        onClick={() => {
                          if (s.key === "lost") return setLostOpen(true);
                          if (s.key === "won") return setWonOpen(true);
                          run("stage", () => stageFn({ data: { actorId: user?.id, leadId: l.id, stage: s.key } }), `Đã chuyển "${s.label}"`);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${s.tone} ${s.key === l.stage ? "ring-2 ring-primary" : "hover:brightness-95"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {lostOpen && (
                    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                      <div className="min-w-[200px]">
                        <Label>Lý do không chốt *</Label>
                        <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                          <option value="">— Chọn —</option>
                          {LEAD_LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </div>
                      <Input className="min-w-[200px] flex-1" placeholder="Ghi thêm (bắt buộc nếu chọn Khác)" value={lostNote} onChange={(e) => setLostNote(e.target.value)} />
                      <Button
                        variant="destructive"
                        disabled={!lostReason || busy === "lost"}
                        onClick={async () => {
                          if (await run("lost", () => stageFn({ data: { actorId: user?.id, leadId: l.id, stage: "lost", lostReason, lostNote } }), "Đã chuyển Không chốt")) setLostOpen(false);
                        }}
                      >
                        Xác nhận
                      </Button>
                    </div>
                  )}
                  {wonOpen && (
                    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                      <div>
                        <Label>Mã đơn (nếu có)</Label>
                        <Input className="mt-1.5 w-40 font-mono" placeholder="HD0098xx" value={wonCode} onChange={(e) => setWonCode(e.target.value.trim())} />
                      </div>
                      <div>
                        <Label>Hoặc số tiền</Label>
                        <Input className="mt-1.5 w-40" inputMode="numeric" placeholder="vd mua qua đại lý" value={wonAmount} onChange={(e) => setWonAmount(e.target.value.replace(/\D/g, ""))} />
                      </div>
                      <Button
                        disabled={busy === "won"}
                        onClick={async () => {
                          if (await run("won", () => stageFn({ data: { actorId: user?.id, leadId: l.id, stage: "won", wonOrderCode: wonCode || undefined, wonAmount: wonAmount ? Number(wonAmount) : undefined } }), "Đã chuyển Đã chốt")) setWonOpen(false);
                        }}
                      >
                        Xác nhận đã chốt
                      </Button>
                      <div className="w-full text-xs text-muted-foreground">Khách mua trực tiếp trên app thì không cần bấm: tạo đơn cho khách là lead tự chuyển "Đã chốt".</div>
                    </div>
                  )}
                </div>
              )}

              {/* Ghi chăm sóc */}
              {l.can_edit && (
                <div className="rounded-lg border p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_ACTIVITY_KINDS.map((k) => (
                      <button key={k.key} type="button" onClick={() => setKind(k.key)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${kind === k.key ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                        {KIND_ICON[k.key]} {k.label}
                      </button>
                    ))}
                  </div>
                  <textarea className="mt-2 min-h-[64px] w-full rounded-md border bg-background px-3 py-2" placeholder="Nội dung lần chăm này…" value={content} onChange={(e) => setContent(e.target.value)} />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Hẹn chăm tiếp:</span>
                    {[["Mai", 1], ["3 ngày", 3], ["1 tuần", 7], ["2 tuần", 14]].map(([lb, n]: any) => {
                      const d = addDaysStr(today, n);
                      return (
                        <button key={lb} type="button" onClick={() => setFollow(d)} className={`rounded-full border px-2 py-0.5 text-xs ${follow === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{lb}</button>
                      );
                    })}
                    <Input type="date" className="h-8 w-40" value={follow ?? ""} onChange={(e) => setFollow(e.target.value || null)} />
                    <button type="button" onClick={() => setFollow(null)} className={`rounded-full border px-2 py-0.5 text-xs ${follow === null ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>Không hẹn</button>
                    <Button
                      className="ml-auto" size="sm"
                      disabled={!content.trim() || busy === "act"}
                      onClick={async () => {
                        if (await run("act", () => actFn({ data: { actorId: user?.id, leadId: l.id, kind, content, nextFollowUp: follow } }), "Đã ghi")) {
                          setContent("");
                          setFollow(undefined);
                        }
                      }}
                    >
                      {busy === "act" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Ghi lại
                    </Button>
                  </div>
                </div>
              )}

              {/* Nhật ký */}
              <div>
                <div className="mb-2 font-semibold">Quá trình chăm sóc ({(data.activities ?? []).length})</div>
                <ol className="relative space-y-3 border-l pl-4">
                  {(data.activities ?? []).map((a: any) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[22px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-background text-xs">{KIND_ICON[a.kind] ?? "•"}</span>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })} · {a.user_id ? shortStaff(metaHook.staffName(a.user_id)) : "Hệ thống"}
                        {a.kind !== "note" && a.kind !== "stage" && <> · {LEAD_ACTIVITY_KINDS.find((k) => k.key === a.kind)?.label}</>}
                      </div>
                      <div className={`whitespace-pre-wrap ${a.kind === "stage" ? "text-muted-foreground italic" : ""}`}>{a.content}</div>
                    </li>
                  ))}
                  {(data.activities ?? []).length === 0 && <li className="text-muted-foreground">Chưa có lần chăm nào.</li>}
                </ol>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
