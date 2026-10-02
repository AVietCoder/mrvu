// @ts-nocheck
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertClaimFn, confirmClaimReturnedFn, getClaimFn, deleteClaimFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FACTORY_RETURN_STATUSES, FACTORY_SOLUTIONS } from "@/lib/types";
import { Loader2, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProductPicker, AttachmentsField, dmyTime, shortStaff, todayVN } from "./shared";

const EMPTY = {
  factory_id: "", product_id: "", product_model: "", received_date: "", receiver_id: "",
  defect_description: "", media: [] as any[], factory_solution: "", return_status: "waiting",
  returned_date: "", shipping_note: "", ticket_id: "",
};
const SELECT = "mt-1.5 h-10 w-full rounded-md border bg-background px-3 disabled:opacity-70";

/**
 * Thêm / sửa yêu cầu bảo hành gửi nhà máy (chỉ admin). claim = null → thêm mới;
 * `fromTicket` = phiếu khách lẻ / đại lý để điền sẵn mẫu quạt, mô tả lỗi, ảnh.
 */
export function ClaimForm({ open, claim, fromTicket, metaHook, onClose, onSaved }: any) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { meta } = metaHook;
  const saveFn = useServerFn(upsertClaimFn);
  const getFn = useServerFn(getClaimFn);
  const delFn = useServerFn(deleteClaimFn);
  const [f, setF] = useState<any>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const isNew = !claim?.id;
  const set = (patch: any) => setF((p: any) => ({ ...p, ...patch }));

  useEffect(() => {
    if (!open) return;
    if (claim?.id) {
      setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, claim[k] ?? EMPTY[k]])), media: claim.media ?? [] });
    } else {
      const factories = (meta?.factories ?? []).filter((x: any) => x.is_active !== false);
      setF({
        ...EMPTY,
        factory_id: factories.length === 1 ? factories[0].id : "",
        received_date: todayVN(),
        receiver_id: user?.id ?? "",
        ...(fromTicket
          ? {
              ticket_id: fromTicket.id, product_id: fromTicket.product_id ?? "", product_model: fromTicket.product_model ?? "",
              defect_description: fromTicket.issue_note ?? "", media: fromTicket.attachments ?? [],
            }
          : {}),
      });
    }
  }, [open, claim?.id, fromTicket?.id]);

  const { data: detail } = useQuery({
    queryKey: ["warranty", "claim", claim?.id],
    queryFn: () => getFn({ data: { actorId: user?.id, id: claim.id } }),
    enabled: open && Boolean(claim?.id),
  });

  const sol = FACTORY_SOLUTIONS.find((x) => x.key === f.factory_solution);
  const factories = (meta?.factories ?? []).filter((x: any) => x.is_active !== false || x.id === f.factory_id);

  async function save() {
    if (!f.factory_id) return toast.error("Chọn nhà máy sản xuất");
    if (!f.product_id && !f.product_model.trim()) return toast.error("Chọn hoặc nhập mẫu quạt");
    if (f.return_status === "returned" && !f.returned_date) return toast.error("Nhập ngày nhà máy gửi trả");
    setBusy("save");
    try {
      const r = await saveFn({ data: { ...f, id: claim?.id, returned_date: f.returned_date || null, actorId: user?.id } });
      toast.success(isNew ? `Đã tạo yêu cầu ${r.code}` : "Đã lưu");
      qc.invalidateQueries({ queryKey: ["warranty"] });
      qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
      onSaved?.(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{isNew ? "Thêm yêu cầu bảo hành gửi nhà máy" : `Yêu cầu ${claim.code}`}</DialogTitle>
          <DialogDescription>
            Hàng lỗi gửi nhà máy xử lý — theo dõi hướng giải quyết và tiến độ nhà máy gửi trả linh kiện / động cơ.
            {(fromTicket?.code || detail?.ticket?.code) && <> Từ phiếu <strong className="font-mono">{fromTicket?.code ?? detail.ticket.code}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {(meta?.factories ?? []).length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">Chưa có nhà máy nào trong danh mục — thêm ở tab <strong>Cài đặt</strong> trước.</div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Nhà máy sản xuất *</Label>
              <select className={SELECT} value={f.factory_id} onChange={(e) => set({ factory_id: e.target.value })}>
                <option value="">— Chọn —</option>
                {factories.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Ngày tiếp nhận *</Label>
              <Input type="date" className="mt-1.5" value={f.received_date} onChange={(e) => set({ received_date: e.target.value })} />
            </div>
            <div>
              <Label>Người tiếp nhận</Label>
              <select className={SELECT} value={f.receiver_id} onChange={(e) => set({ receiver_id: e.target.value })}>
                <option value="">— Chưa gán —</option>
                {(meta?.staff ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label>Mẫu quạt *</Label>
            <div className="mt-1.5"><ProductPicker products={meta?.products ?? []} productId={f.product_id} model={f.product_model} onChange={(v) => set(v)} /></div>
          </div>

          <div>
            <Label>Tình trạng gặp lỗi</Label>
            <textarea className="mt-1.5 min-h-[72px] w-full rounded-md border bg-background px-3 py-2" placeholder="Mô tả chi tiết lỗi kỹ thuật" value={f.defect_description} onChange={(e) => set({ defect_description: e.target.value })} />
          </div>

          <div>
            <Label>Hình ảnh / video / link</Label>
            <div className="mt-1.5"><AttachmentsField value={f.media} onChange={(v) => set({ media: v })} /></div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Hướng xử lý từ nhà máy</Label>
                <select
                  className={SELECT}
                  value={f.factory_solution}
                  onChange={(e) => {
                    const next = FACTORY_SOLUTIONS.find((x) => x.key === e.target.value);
                    // Nhà máy không bảo hành → đóng; nhận đổi mới → chờ gửi trả.
                    set({ factory_solution: e.target.value, ...(next ? { return_status: next.accept ? (f.return_status === "returned" ? "returned" : "waiting") : "rejected" } : {}) });
                  }}
                >
                  <option value="">— Nhà máy chưa trả lời —</option>
                  {FACTORY_SOLUTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Trạng thái gửi trả</Label>
                <select className={SELECT} value={f.return_status} onChange={(e) => set({ return_status: e.target.value, ...(e.target.value === "returned" && !f.returned_date ? { returned_date: todayVN() } : {}) })}>
                  {FACTORY_RETURN_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
            </div>
            {sol?.accept && f.return_status === "waiting" && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">⚠️ Chờ nhà máy trả hàng — hệ thống nhắc khi quá {metaHook.meta?.factories?.find((x: any) => x.id === f.factory_id)?.sla_days ?? 14} ngày kể từ lúc cập nhật hướng xử lý.</div>
            )}
            {f.return_status === "returned" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label>Ngày NM gửi trả *</Label>
                  <Input type="date" className="mt-1.5" value={f.returned_date ?? ""} onChange={(e) => set({ returned_date: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Mã vận đơn / ghi chú trả hàng</Label>
                  <Input className="mt-1.5" placeholder="Mã bưu gửi, thông tin nhận hàng…" value={f.shipping_note ?? ""} onChange={(e) => set({ shipping_note: e.target.value })} />
                </div>
              </div>
            )}
            {f.return_status !== "returned" && (
              <div>
                <Label>Ghi chú</Label>
                <Input className="mt-1.5" placeholder="Mã vận đơn gửi đi, lý do từ chối…" value={f.shipping_note ?? ""} onChange={(e) => set({ shipping_note: e.target.value })} />
              </div>
            )}
          </div>

          {!isNew && (detail?.activities ?? []).length > 0 && (
            <div>
              <div className="mb-1.5 font-semibold">Lịch sử</div>
              <ul className="space-y-1.5 border-l pl-3 text-xs">
                {detail.activities.map((a: any) => (
                  <li key={a.id}><span className="text-muted-foreground">{dmyTime(a.at)} · {a.user_id ? shortStaff(metaHook.staffName(a.user_id)) : "Hệ thống"}</span> — {a.content}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 border-t pt-3">
            {!isNew && (
              <Button
                variant="outline" className="text-destructive" disabled={busy === "del"}
                onClick={async () => {
                  if (!window.confirm(`Xoá yêu cầu ${claim.code}? Không khôi phục được.`)) return;
                  setBusy("del");
                  try {
                    await delFn({ data: { actorId: user?.id, id: claim.id } });
                    toast.success("Đã xoá yêu cầu");
                    qc.invalidateQueries({ queryKey: ["warranty"] });
                    qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
                    onClose();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Lỗi xoá");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />Xoá
              </Button>
            )}
            <Button variant="outline" className="ml-auto" onClick={onClose}>Huỷ</Button>
            <Button onClick={save} disabled={busy === "save"}>{busy === "save" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{isNew ? "Tạo yêu cầu" : "Lưu"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Popup nhanh: "Xác nhận đã nhận hàng gửi trả" khi kiện hàng từ nhà máy về kho. */
export function ClaimReturnDialog({ claim, onClose }: { claim: any | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fn = useServerFn(confirmClaimReturnedFn);
  const [date, setDate] = useState(todayVN());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!claim) return;
    setDate(todayVN());
    setNote(claim.shipping_note ?? "");
  }, [claim?.id]);
  return (
    <Dialog open={Boolean(claim)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-emerald-600" />Đã nhận hàng nhà máy gửi trả</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{claim?.code}</span> · {claim?.factory_name} · {claim?.product_model}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Ngày nhận hàng *</Label>
            <Input type="date" className="mt-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Mã vận đơn / ghi chú trả hàng</Label>
            <Input className="mt-1.5" placeholder="Mã bưu gửi, thông tin nhận hàng…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Huỷ</Button>
            <Button
              disabled={!date || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await fn({ data: { actorId: user?.id, id: claim.id, returned_date: date, shipping_note: note } });
                  toast.success("Đã xác nhận nhận hàng");
                  qc.invalidateQueries({ queryKey: ["warranty"] });
                  qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
                  onClose();
                } catch (e: any) {
                  toast.error(e?.message ?? "Lỗi");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Xác nhận đã nhận
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
