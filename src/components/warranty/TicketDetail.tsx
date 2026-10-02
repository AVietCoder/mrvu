// @ts-nocheck
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTicketFn, setTicketStageFn, addTicketNoteFn, deleteTicketFn,
  ticketOrderOptionsFn, linkTicketOrderFn, createTicketScheduleFn,
} from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerName } from "@/components/CustomerName";
import { WARRANTY_FAULT_PARTS, WARRANTY_FINAL_ACTIONS, WARRANTY_STAGES, warrantyActionLabel, warrantyIssueLabel } from "@/lib/types";
import { Loader2, Phone, MapPin, Pencil, Trash2, AlarmClock, Factory, CalendarPlus, ShoppingCart, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { StageBadge, WarrantyBadge, ReturnBadge, AttachmentList, money, dmy, dmyTime, shortStaff, todayVN } from "./shared";

const KIND_ICON: Record<string, string> = { note: "📝", stage: "🔁", system: "⚙️" };
const SCHEDULE_STATUS: Record<string, string> = { pending: "Chờ duyệt", approved: "Đã duyệt", in_progress: "Đang làm", done: "Hoàn thành", cancelled: "Đã huỷ" };

function Row({ label, children }: any) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

export function TicketDetail({ ticketId, open, onClose, onEdit, onSendFactory, metaHook }: any) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getTicketFn);
  const stageFn = useServerFn(setTicketStageFn);
  const noteFn = useServerFn(addTicketNoteFn);
  const delFn = useServerFn(deleteTicketFn);
  const optionsFn = useServerFn(ticketOrderOptionsFn);
  const linkFn = useServerFn(linkTicketOrderFn);
  const scheduleFn = useServerFn(createTicketScheduleFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["warranty", "ticket", ticketId],
    queryFn: () => getFn({ data: { actorId: user?.id, id: ticketId } }),
    enabled: open && Boolean(ticketId),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [action, setAction] = useState("");
  const [price, setPrice] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderQ, setOrderQ] = useState("");
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");

  const t = data?.ticket;
  const me = metaHook.meta?.me;
  const { data: orderOpts, isFetching: optsLoading } = useQuery({
    queryKey: ["warranty", "orderOptions", ticketId, orderQ],
    queryFn: () => optionsFn({ data: { actorId: user?.id, id: ticketId, q: orderQ } }),
    enabled: open && orderOpen && Boolean(ticketId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["warranty"] });
    qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {isLoading || !t ? (
          <div className="flex justify-center py-12">{error ? <span className="text-destructive">{String((error as any).message)}</span> : <Loader2 className="h-6 w-6 animate-spin" />}</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                <span className="font-mono">{t.code}</span>
                <StageBadge stage={t.stage} />
                <WarrantyBadge warranty={t.warranty} expiresOn={t.expires_on} motorIn={t.motor_in} />
                {t.overdue && <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"><AlarmClock className="h-3.5 w-3.5" />Quá 24h chưa phản hồi</span>}
              </DialogTitle>
              <DialogDescription>
                {t.kind === "dealer" ? "Bảo hành đại lý" : "Bảo hành khách lẻ"} · {metaHook.branchName(t.branch_id)} · gửi {dmyTime(t.sent_date)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">{t.kind === "dealer" ? "Đại lý gửi" : "Khách hàng"}</div>
                  {t.customer_id ? (
                    <Link to="/customers/$id" params={{ id: t.customer_id }} target="_blank" className="hover:text-primary hover:underline">
                      <CustomerName name={t.customer_name} company={t.customer_company} className="font-semibold" />
                    </Link>
                  ) : (
                    <CustomerName name={t.customer_name} company={t.customer_company} className="font-semibold" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{t.phone || <span className="text-muted-foreground">Chưa có SĐT</span>}</div>
                  <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>{t.address || "—"}</span></div>
                </div>
                <Row label="Mẫu quạt">{t.product_model || "—"}</Row>
                <Row label="Ngày mua">
                  {t.purchase_date ? dmy(t.purchase_date) : "Chưa rõ"}
                  {data.purchase_order && (
                    <a href={`/orders/${data.purchase_order.id}`} target="_blank" rel="noopener noreferrer" className="ml-2 font-mono text-xs text-primary underline">{data.purchase_order.code}</a>
                  )}
                  <div className="text-xs font-normal text-muted-foreground">
                    Động cơ {t.warranty_motor_months ?? 120} tháng{t.motor_expires_on && <> ({t.motor_in ? "đến" : "hết từ"} {dmy(t.motor_expires_on)})</>}
                    {" · "}Phụ kiện {t.warranty_months} tháng{t.accessory_expires_on && <> ({t.accessory_in ? "đến" : "hết từ"} {dmy(t.accessory_expires_on)})</>}
                  </div>
                </Row>
                <Row label="Nhân viên tiếp nhận">{metaHook.staffName(t.receptionist_id)}</Row>
                <Row label="Kỹ thuật xử lý">{t.technician_id ? metaHook.staffName(t.technician_id) : <span className="font-normal text-muted-foreground">Chưa phân công</span>}</Row>
                <Row label="Ngày phản hồi">{t.response_date ? dmyTime(t.response_date) : <span className={t.overdue ? "text-rose-600" : "font-normal text-muted-foreground"}>Chưa phản hồi{t.hours_waiting != null ? ` (${t.hours_waiting} giờ)` : ""}</span>}</Row>
                <Row label="Loại lỗi · bộ phận lỗi">
                  {t.issue_type ? warrantyIssueLabel(t.issue_type) : <span className="font-normal text-muted-foreground">Chưa phân loại</span>}
                  {" · "}
                  {t.fault_part ? WARRANTY_FAULT_PARTS.find((x) => x.key === t.fault_part)?.label : <span className="font-normal text-muted-foreground">chưa xác định bộ phận</span>}
                </Row>
                <div className="sm:col-span-2">
                  <div className="text-xs text-muted-foreground">{t.kind === "dealer" ? "Tình trạng đại lý báo" : "Tình trạng khách báo"}</div>
                  <div className="whitespace-pre-wrap">{t.issue_note || "—"}</div>
                </div>
                {(t.attachments ?? []).length > 0 && (
                  <div className="sm:col-span-2">
                    <div className="mb-1 text-xs text-muted-foreground">Hình ảnh / video</div>
                    <AttachmentList items={t.attachments} />
                  </div>
                )}
                {t.solution_advice && (
                  <div className="sm:col-span-2">
                    <div className="text-xs text-muted-foreground">Tư vấn hướng xử lý</div>
                    <div className="whitespace-pre-wrap">{t.solution_advice}</div>
                  </div>
                )}
                <Row label="Kết quả xử lý cuối">{t.final_action ? warrantyActionLabel(t.final_action) : <span className="font-normal text-muted-foreground">Chưa có</span>}</Row>
                <Row label="Giá linh kiện mua">{Number(t.spare_part_price) > 0 ? `${money(t.spare_part_price)}đ` : t.final_action === "free_support" ? "Miễn phí" : "—"}</Row>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onEdit(t)}><Pencil className="mr-1.5 h-4 w-4" />Sửa phiếu</Button>
                {me?.isAdmin && onSendFactory && (
                  <Button variant="outline" size="sm" onClick={() => onSendFactory(t)}><Factory className="mr-1.5 h-4 w-4" />Gửi nhà máy</Button>
                )}
                {me?.canSchedule && !data.schedule && (
                  <Button variant="outline" size="sm" onClick={() => { setSchedDate(todayVN()); setSchedOpen((v) => !v); }}><CalendarPlus className="mr-1.5 h-4 w-4" />Tạo lịch bảo hành</Button>
                )}
                {data.can_delete && (
                  <Button
                    variant="outline" size="sm" className="ml-auto text-destructive"
                    disabled={busy === "del"}
                    onClick={async () => {
                      if (!window.confirm(`Xoá phiếu ${t.code}? Không khôi phục được.`)) return;
                      if (await run("del", () => delFn({ data: { actorId: user?.id, id: t.id } }), "Đã xoá phiếu")) onClose();
                    }}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />Xoá
                  </Button>
                )}
              </div>

              {schedOpen && !data.schedule && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
                  <div>
                    <Label>Ngày hẹn *</Label>
                    <Input type="date" className="mt-1.5 w-44" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Giờ</Label>
                    <Input type="time" className="mt-1.5 w-32" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
                  </div>
                  <Button
                    disabled={!schedDate || busy === "sched"}
                    onClick={async () => {
                      if (await run("sched", () => scheduleFn({ data: { actorId: user?.id, id: t.id, scheduled_date: schedDate, scheduled_time: schedTime } }), "Đã tạo lịch bảo hành (chờ duyệt)")) setSchedOpen(false);
                    }}
                  >
                    Tạo lịch
                  </Button>
                  <div className="w-full text-xs text-muted-foreground">Lịch loại "Bảo hành" sẽ nằm ở trang Lịch làm việc, chờ duyệt và phân công kỹ thuật như lịch thường.</div>
                </div>
              )}
              {data.schedule && (
                <div className="rounded-lg border p-3">
                  <span className="text-muted-foreground">Lịch bảo hành: </span>
                  <Link to="/schedule" className="font-medium text-primary underline">{dmy(String(data.schedule.scheduled_date).slice(0, 10))} {data.schedule.scheduled_time ?? ""}</Link>
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{SCHEDULE_STATUS[data.schedule.status] ?? data.schedule.status}</span>
                </div>
              )}

              {(data.claims ?? []).length > 0 && (
                <div className="rounded-lg border p-3">
                  <div className="mb-1 font-semibold">Đã gửi nhà máy</div>
                  <div className="flex flex-wrap gap-2">
                    {data.claims.map((c: any) => (
                      <span key={c.id} className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1">
                        <span className="font-mono text-xs">{c.code}</span>
                        {c.factory_id && <span className="text-xs text-muted-foreground">{metaHook.factoryName(c.factory_id)}</span>}
                        <ReturnBadge status={c.return_status} />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Đơn bán linh kiện — chỉ liên kết để tra cứu, không tạo phiếu thu */}
              <div className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">Đơn bán linh kiện</span>
                  {data.part_order ? (
                    <>
                      <a href={`/orders/${data.part_order.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline">{data.part_order.code}</a>
                      <span className="text-muted-foreground">{money(data.part_order.total)}đ</span>
                      <Button variant="ghost" size="sm" className="ml-auto h-8" disabled={busy === "unlink"} onClick={() => run("unlink", () => linkFn({ data: { actorId: user?.id, id: t.id, orderId: null } }), "Đã gỡ đơn")}><Unlink className="mr-1 h-4 w-4" />Gỡ</Button>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Chưa gắn</span>
                      <div className="ml-auto flex flex-wrap gap-2">
                        {t.customer_id && (
                          <a href={`/orders?newFor=${encodeURIComponent(t.customer_id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">Tạo đơn bán linh kiện</a>
                        )}
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setOrderOpen((v) => !v)}><Link2 className="mr-1 h-4 w-4" />Gắn đơn có sẵn</Button>
                      </div>
                    </>
                  )}
                </div>
                {orderOpen && !data.part_order && (
                  <div className="mt-2 space-y-2">
                    <Input className="h-9" placeholder="Tìm theo mã đơn (để trống = đơn gần đây của khách này)" value={orderQ} onChange={(e) => setOrderQ(e.target.value.trim())} />
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {optsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      {!optsLoading && (orderOpts?.orders ?? []).length === 0 && <div className="text-xs text-muted-foreground">Không có đơn phù hợp.</div>}
                      {(orderOpts?.orders ?? []).map((o: any) => (
                        <button
                          key={o.id} type="button" disabled={busy === "link"}
                          onClick={async () => { if (await run("link", () => linkFn({ data: { actorId: user?.id, id: t.id, orderId: o.id } }), `Đã gắn đơn ${o.code}`)) setOrderOpen(false); }}
                          className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left hover:bg-muted"
                        >
                          <span className="font-mono text-xs font-semibold">{o.code}</span>
                          <span className="text-xs text-muted-foreground">{dmy(String(o.created_at).slice(0, 10))}</span>
                          <span className="font-medium">{money(o.total)}đ</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Chuyển trạng thái */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Chuyển trạng thái</div>
                <div className="flex flex-wrap gap-1.5">
                  {WARRANTY_STAGES.map((s) => (
                    <button
                      key={s.key} type="button" disabled={busy === "stage" || s.key === t.stage}
                      onClick={() => {
                        if (s.key === "done" && !t.final_action) {
                          setAction("");
                          setPrice(Number(t.spare_part_price) > 0 ? String(Math.round(Number(t.spare_part_price))) : "");
                          return setDoneOpen(true);
                        }
                        run("stage", () => stageFn({ data: { actorId: user?.id, id: t.id, stage: s.key } }), `Đã chuyển "${s.label}"`);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${s.tone} ${s.key === t.stage ? "ring-2 ring-primary" : "hover:brightness-95"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {doneOpen && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                    <div className="min-w-[200px]">
                      <Label>Kết quả xử lý cuối *</Label>
                      <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" value={action} onChange={(e) => { setAction(e.target.value); if (e.target.value === "free_support") setPrice(""); }}>
                        <option value="">— Chọn —</option>
                        {WARRANTY_FINAL_ACTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Giá linh kiện mua{action === "buy_part" ? " *" : ""}</Label>
                      <Input className="mt-1.5 w-40" inputMode="numeric" placeholder={action === "free_support" ? "Miễn phí" : "0"} disabled={action === "free_support"} value={price ? money(price) : ""} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <Button
                      disabled={!action || busy === "done"}
                      onClick={async () => {
                        if (await run("done", () => stageFn({ data: { actorId: user?.id, id: t.id, stage: "done", final_action: action, spare_part_price: Number(price) || 0 } }), "Đã hoàn tất phiếu")) setDoneOpen(false);
                      }}
                    >
                      Xác nhận hoàn tất
                    </Button>
                    <Button variant="ghost" onClick={() => setDoneOpen(false)}>Huỷ</Button>
                  </div>
                )}
              </div>

              {/* Trao đổi nội bộ */}
              <div className="rounded-lg border p-3">
                <textarea className="min-h-[60px] w-full rounded-md border bg-background px-3 py-2" placeholder="Ghi chú / trao đổi nội bộ giữa NV tiếp nhận và kỹ thuật…" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" disabled={!note.trim() || busy === "note"} onClick={async () => { if (await run("note", () => noteFn({ data: { actorId: user?.id, id: t.id, content: note } }), "Đã ghi")) setNote(""); }}>
                    {busy === "note" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Ghi lại
                  </Button>
                </div>
              </div>

              <div>
                <div className="mb-2 font-semibold">Lịch sử xử lý ({(data.activities ?? []).length})</div>
                <ol className="relative space-y-3 border-l pl-4">
                  {(data.activities ?? []).map((a: any) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[22px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-background text-xs">{KIND_ICON[a.kind] ?? "•"}</span>
                      <div className="text-xs text-muted-foreground">{dmyTime(a.at)} · {a.user_id ? shortStaff(metaHook.staffName(a.user_id)) : "Hệ thống"}</div>
                      <div className={`whitespace-pre-wrap ${a.kind === "note" ? "" : "text-muted-foreground italic"}`}>{a.content}</div>
                    </li>
                  ))}
                  {(data.activities ?? []).length === 0 && <li className="text-muted-foreground">Chưa có hoạt động nào.</li>}
                </ol>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
