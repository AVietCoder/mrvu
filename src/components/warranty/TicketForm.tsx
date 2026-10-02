// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertTicketFn, lookupPurchaseFn, searchDealersFn } from "@/lib/warranty.functions";
import { warrantyState } from "@/lib/warranty-rules";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AsyncSearchableSelect } from "@/components/AsyncSearchableSelect";
import { WARRANTY_FAULT_PARTS, WARRANTY_FINAL_ACTIONS, WARRANTY_ISSUE_TYPES, WARRANTY_STAGES } from "@/lib/types";
import { Loader2, UserCheck, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useWarrantyMeta, ProductPicker, AttachmentsField, WarrantyBadge, dmy, money, nowLocalInput, toLocalInput } from "./shared";

const EMPTY = {
  branch_id: "", customer_id: "", customer_name: "", phone: "", address: "",
  product_id: "", product_model: "", purchase_date: "", purchase_order_id: "",
  sent_date: "", receptionist_id: "", technician_id: "",
  issue_type: "", fault_part: "", issue_note: "", attachments: [] as any[],
  solution_advice: "", final_action: "", spare_part_price: "", stage: "new",
};
const SELECT = "mt-1.5 h-10 w-full rounded-md border bg-background px-3 disabled:opacity-70";
// Loại lỗi nào nói rõ bộ phận → tự chọn sẵn "bộ phận lỗi" (nhân viên vẫn đổi được).
const ISSUE_TO_PART: Record<string, string> = { dong_co: "motor", remote: "accessory", den: "accessory", mach: "accessory", canh: "accessory", ngoai_quan: "accessory" };

/**
 * Thân form phiếu bảo hành (khách lẻ / đại lý). Dùng trong hộp thoại ở trang Bảo
 * hành và nhúng vào form "Thêm khách tiềm năng" khi chọn nhu cầu "Liên hệ bảo hành".
 * `initial` = giá trị điền sẵn khi thêm mới (showroom, tên, SĐT đã gõ).
 */
export function TicketFormBody({ kind = "retail", ticket, initial, onSaved, onCancel, silent = false }: any) {
  const { user, activeBranchId } = useAuth();
  const qc = useQueryClient();
  const { meta, productById } = useWarrantyMeta();
  const saveFn = useServerFn(upsertTicketFn);
  const lookupFn = useServerFn(lookupPurchaseFn);
  const dealersFn = useServerFn(searchDealersFn);
  const [f, setF] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [purchaseTouched, setPurchaseTouched] = useState(false);
  const isNew = !ticket?.id;
  const isDealer = (ticket?.kind ?? kind) === "dealer";
  const set = (patch: any) => setF((p: any) => ({ ...p, ...patch }));

  useEffect(() => {
    setPurchaseTouched(false);
    if (ticket?.id) {
      setF({
        ...EMPTY,
        ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, ticket[k] ?? EMPTY[k]])),
        sent_date: toLocalInput(ticket.sent_date),
        spare_part_price: Number(ticket.spare_part_price) > 0 ? String(Math.round(Number(ticket.spare_part_price))) : "",
        attachments: ticket.attachments ?? [],
      });
    } else {
      setF({ ...EMPTY, sent_date: nowLocalInput(), receptionist_id: user?.id ?? "", ...(initial ?? {}) });
    }
  }, [ticket?.id, kind]);

  // Thêm mới: mặc định showroom đang chọn (hoặc showroom đầu tiên được gán).
  useEffect(() => {
    if (!isNew || f.branch_id || !meta?.branches?.length) return;
    const def = meta.branches.find((b: any) => b.id === activeBranchId) ?? meta.branches[0];
    if (def) set({ branch_id: def.id });
  }, [meta, isNew, f.branch_id]);

  // Tự tìm khách + các đơn đã mua → gợi ý ngày mua.
  const phoneDeb = useDebouncedValue(f.phone, 400);
  const phoneOk = String(phoneDeb ?? "").replace(/\D/g, "").length >= 9;
  const lookupKey = f.customer_id || (!isDealer && phoneOk ? `p:${phoneDeb}` : "");
  const { data: lookup } = useQuery({
    queryKey: ["warranty", "lookup", lookupKey],
    queryFn: () => lookupFn({ data: { actorId: user?.id, customerId: f.customer_id || undefined, phone: f.customer_id ? undefined : phoneDeb } }),
    enabled: Boolean(user?.id && lookupKey),
    staleTime: 60_000,
  });
  const purchases = (lookup?.purchases ?? []) as any[];
  const matches = useMemo(() => purchases.filter((p) => !f.product_id || p.product_id === f.product_id), [purchases, f.product_id]);

  // Chọn mẫu mà khách từng mua → tự điền ngày mua của đơn gần nhất (chưa sửa tay).
  useEffect(() => {
    if (!isNew || purchaseTouched || !f.product_id || !matches.length) return;
    if (f.purchase_date === matches[0].date && f.purchase_order_id === matches[0].order_id) return;
    set({ purchase_date: matches[0].date, purchase_order_id: matches[0].order_id });
  }, [matches, f.product_id, purchaseTouched, isNew]);

  // Hạn bảo hành hai mức của mẫu: phụ kiện + động cơ.
  const months = productById.get(f.product_id)?.warranty_months ?? ticket?.warranty_months ?? 12;
  const motorMonths = productById.get(f.product_id)?.warranty_motor_months ?? ticket?.warranty_motor_months ?? 120;
  const state = warrantyState({
    purchase_date: f.purchase_date || null, warranty_months: months, warranty_motor_months: motorMonths,
    fault_part: f.fault_part || null, sent_date: f.sent_date ? `${f.sent_date}:00+07:00` : Date.now(),
  });

  const branchStaff = useMemo(
    () => (meta?.staff ?? []).filter((u: any) => !f.branch_id || (u.branch_ids ?? []).includes(f.branch_id) || u.id === f.receptionist_id),
    [meta, f.branch_id, f.receptionist_id],
  );
  const technicians = useMemo(() => {
    const techs = (meta?.staff ?? []).filter((u: any) => u.is_technician || u.id === f.technician_id);
    return techs.length ? techs : meta?.staff ?? [];
  }, [meta, f.technician_id]);

  async function save() {
    if (!f.branch_id) return toast.error("Chọn showroom tiếp nhận");
    if (isDealer ? !f.customer_id : !f.customer_name.trim()) return toast.error(isDealer ? "Chọn đại lý gửi bảo hành" : "Nhập tên khách");
    if (!f.product_id && !f.product_model.trim()) return toast.error("Chọn hoặc nhập mẫu quạt");
    if (f.final_action === "buy_part" && !(Number(f.spare_part_price) > 0)) return toast.error('Kết quả "Mua linh kiện mới" bắt buộc nhập giá linh kiện');
    setSaving(true);
    try {
      const r = await saveFn({
        data: {
          ...f,
          id: ticket?.id,
          kind: isDealer ? "dealer" : "retail",
          spare_part_price: Number(f.spare_part_price) || 0,
          purchase_date: f.purchase_date || null,
          actorId: user?.id,
        },
      });
      // silent: nơi nhúng (form khách tiềm năng) tự báo kèm nút mở phiếu.
      if (!silent) toast.success(isNew ? `Đã tạo phiếu bảo hành ${r.code}` : "Đã lưu");
      qc.invalidateQueries({ queryKey: ["warranty"] });
      qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
      onSaved?.(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Showroom tiếp nhận *</Label>
          <select className={SELECT} value={f.branch_id} onChange={(e) => set({ branch_id: e.target.value })}>
            <option value="">— Chọn —</option>
            {(meta?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Ngày gửi bảo hành *</Label>
          <Input type="datetime-local" className="mt-1.5" value={f.sent_date} onChange={(e) => set({ sent_date: e.target.value })} />
        </div>
        <div>
          <Label>Nhân viên tiếp nhận</Label>
          <select className={SELECT} value={f.receptionist_id} onChange={(e) => set({ receptionist_id: e.target.value })}>
            <option value="">— Chưa gán —</option>
            {branchStaff.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>

      {isDealer ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Đại lý gửi *</Label>
            <AsyncSearchableSelect
              className="mt-1.5"
              value={f.customer_id}
              onChange={(v) => { setPurchaseTouched(false); set({ customer_id: v, purchase_date: "", purchase_order_id: "" }); }}
              placeholder="Tìm đại lý theo tên, công ty, SĐT…"
              fetchOptions={async (q) => {
                const r = await dealersFn({ data: { actorId: user?.id, q } });
                return (r?.customers ?? []).map((c: any) => ({ value: c.id, label: c.name, sub: [c.company_name, c.phone, c.is_dealer ? "" : `nhóm ${c.group_label}`].filter(Boolean).join(" · ") || undefined }));
              }}
              resolveSelected={async (id) => {
                const r = await dealersFn({ data: { actorId: user?.id, ids: [id] } });
                const c = r?.customers?.[0];
                return c ? { value: c.id, label: c.name, sub: [c.company_name, c.phone].filter(Boolean).join(" · ") || undefined } : null;
              }}
            />
            <div className="mt-1 text-xs text-muted-foreground">Mặc định hiện nhóm "Đại lý"; gõ tên để tìm cả khách đang ở nhóm khác.</div>
          </div>
          <div>
            <Label>SĐT liên hệ (nếu khác SĐT đại lý)</Label>
            <Input className="mt-1.5" inputMode="tel" placeholder={lookup?.customer?.phone ?? "Không bắt buộc"} value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Tên khách *</Label>
            <Input className="mt-1.5" autoFocus={isNew && !initial?.customer_name} placeholder="vd: Chị Thảo, Anh Quý" value={f.customer_name} onChange={(e) => set({ customer_name: e.target.value })} />
          </div>
          <div>
            <Label>Số điện thoại</Label>
            <Input className="mt-1.5" inputMode="tel" placeholder="Có SĐT thì tự tìm đơn đã mua" value={f.phone} onChange={(e) => { setPurchaseTouched(false); set({ phone: e.target.value, customer_id: "" }); }} />
          </div>
        </div>
      )}

      {lookup?.customer && (
        <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sky-900">
          <div className="flex items-start gap-2">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {isDealer ? "Đại lý" : "Đã là khách hàng"}: <strong>{lookup.customer.name}</strong>
              {lookup.customer.company_name && <> — {lookup.customer.company_name}</>}
              {!isDealer && " · phiếu sẽ tự nối với khách này"}
            </span>
          </div>
          {purchases.length > 0 ? (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium"><ShoppingBag className="h-3.5 w-3.5" />Đã mua — bấm để lấy mẫu + ngày mua:</div>
              <div className="flex flex-wrap gap-1.5">
                {(f.product_id ? matches : purchases).slice(0, 8).map((p, i) => {
                  const on = f.purchase_order_id === p.order_id && f.product_id === p.product_id;
                  return (
                    <button
                      key={`${p.order_id}-${p.product_id}-${i}`}
                      type="button"
                      onClick={() => { setPurchaseTouched(true); set({ product_id: p.product_id, product_model: productById.get(p.product_id)?.name ?? f.product_model, purchase_date: p.date, purchase_order_id: p.order_id }); }}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "border-sky-300 bg-white hover:bg-sky-100"}`}
                    >
                      {productById.get(p.product_id)?.name ?? "(mẫu đã xoá)"} · {dmy(p.date)} · <span className="font-mono">{p.order_code}</span>
                    </button>
                  );
                })}
                {f.product_id && matches.length === 0 && <span className="text-xs">Khách chưa từng mua mẫu này trên hệ thống — nhập ngày mua bằng tay.</span>}
              </div>
            </div>
          ) : (
            <div className="text-xs">Chưa có đơn hoàn tất nào trên hệ thống — nhập ngày mua bằng tay.</div>
          )}
        </div>
      )}

      {!isDealer && (
        <div>
          <Label>Địa chỉ</Label>
          <Input className="mt-1.5" placeholder={lookup?.customer?.address || "Địa chỉ lắp quạt"} value={f.address} onChange={(e) => set({ address: e.target.value })} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label>Mẫu quạt *</Label>
          <div className="mt-1.5">
            <ProductPicker
              products={meta?.products ?? []}
              productId={f.product_id}
              model={f.product_model}
              onChange={(v) => { setPurchaseTouched(false); set({ ...v, ...(v.product_id !== f.product_id ? { purchase_order_id: "" } : {}) }); }}
            />
          </div>
        </div>
        <div>
          <Label>Ngày mua quạt</Label>
          <Input type="date" className="mt-1.5" value={f.purchase_date ?? ""} onChange={(e) => { setPurchaseTouched(true); set({ purchase_date: e.target.value, purchase_order_id: "" }); }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <WarrantyBadge warranty={state.warranty} expiresOn={state.expires_on} motorIn={state.motor_in} />
        <span>
          Động cơ <strong>{motorMonths} tháng</strong>{state.motor_expires_on && <> ({state.motor_in ? "đến" : "hết từ"} {dmy(state.motor_expires_on)})</>}
          {" · "}Phụ kiện <strong>{months} tháng</strong>{state.accessory_expires_on && <> ({state.accessory_in ? "đến" : "hết từ"} {dmy(state.accessory_expires_on)})</>}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Loại lỗi</Label>
          <select className={SELECT} value={f.issue_type} onChange={(e) => set({ issue_type: e.target.value, ...(!f.fault_part && ISSUE_TO_PART[e.target.value] ? { fault_part: ISSUE_TO_PART[e.target.value] } : {}) })}>
            <option value="">— Chưa phân loại —</option>
            {WARRANTY_ISSUE_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <Label>Bộ phận lỗi</Label>
          <select className={SELECT} value={f.fault_part} onChange={(e) => set({ fault_part: e.target.value })}>
            <option value="">— Chưa xác định —</option>
            {WARRANTY_FAULT_PARTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <Label>Kỹ thuật xử lý</Label>
          <select className={SELECT} value={f.technician_id} onChange={(e) => set({ technician_id: e.target.value })}>
            <option value="">— Chưa phân công —</option>
            {technicians.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <Label>{isDealer ? "Tình trạng đại lý báo" : "Tình trạng khách báo"}</Label>
        <textarea className="mt-1.5 min-h-[72px] w-full rounded-md border bg-background px-3 py-2" placeholder="vd: Quạt kêu to khi chạy số 3, đã dùng 8 tháng" value={f.issue_note} onChange={(e) => set({ issue_note: e.target.value })} />
      </div>

      <div>
        <Label>Hình ảnh / video lỗi</Label>
        <div className="mt-1.5"><AttachmentsField value={f.attachments} onChange={(v) => set({ attachments: v })} /></div>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div>
          <Label>Tư vấn hướng xử lý</Label>
          <textarea className="mt-1.5 min-h-[60px] w-full rounded-md border bg-background px-3 py-2" placeholder="Phương án kỹ thuật tư vấn ban đầu" value={f.solution_advice} onChange={(e) => set({ solution_advice: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Kết quả xử lý cuối</Label>
            <select className={SELECT} value={f.final_action} onChange={(e) => set({ final_action: e.target.value, ...(e.target.value === "free_support" ? { spare_part_price: "" } : {}) })}>
              <option value="">— Chưa có —</option>
              {WARRANTY_FINAL_ACTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Giá linh kiện mua{f.final_action === "buy_part" ? " *" : ""}</Label>
            <Input
              className="mt-1.5" inputMode="numeric" placeholder={f.final_action === "free_support" ? "Miễn phí" : "0"}
              disabled={f.final_action === "free_support"}
              value={f.spare_part_price ? money(f.spare_part_price) : ""}
              onChange={(e) => set({ spare_part_price: e.target.value.replace(/\D/g, "") })}
            />
          </div>
          {!isNew && (
            <div>
              <Label>Trạng thái phiếu</Label>
              <select className={SELECT} value={f.stage} onChange={(e) => set({ stage: e.target.value })}>
                {WARRANTY_STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground">Giá linh kiện chỉ ghi để thống kê — không tự tạo phiếu thu. Khi thu tiền, tạo đơn bán linh kiện rồi gắn vào phiếu ở màn hình chi tiết.</div>
      </div>

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={onCancel}>Huỷ</Button>
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{isNew ? "Tạo phiếu bảo hành" : "Lưu"}</Button>
      </div>
    </div>
  );
}

/** Hộp thoại thêm / sửa phiếu bảo hành. ticket = null → thêm mới. */
export function TicketForm({ open, kind, ticket, initial, fromOrderCode, onClose, onSaved }: any) {
  const isDealer = (ticket?.kind ?? kind) === "dealer";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{ticket?.id ? `Sửa phiếu ${ticket.code}` : `Thêm phiếu bảo hành — ${isDealer ? "đại lý" : "khách lẻ"}`}{fromOrderCode && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">từ đơn {fromOrderCode}</span>}</DialogTitle>
          <DialogDescription>
            {isDealer ? "Đại lý gửi yêu cầu / hàng bảo hành." : "Khách lẻ liên hệ bảo hành."} Hệ thống tự gắn nhãn còn hạn / hết hạn theo ngày mua và hạn bảo hành của mẫu.
          </DialogDescription>
        </DialogHeader>
        {open && <TicketFormBody kind={kind} ticket={ticket} initial={initial} onSaved={onSaved} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
