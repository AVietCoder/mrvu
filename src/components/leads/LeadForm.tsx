// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertLeadFn, findLeadDuplicatesFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerSourceField, customerSourceError } from "@/components/CustomerSourceField";
import { LEAD_ACTIVITY_KINDS } from "@/lib/types";
import { AlertTriangle, Loader2, UserCheck, ShoppingBag, Wrench } from "lucide-react";
import { toast } from "sonner";
import { ProductMultiPicker, todayVN, addDaysStr, dmy, shortStaff, StageBadge } from "./shared";
import { TicketFormBody } from "@/components/warranty/TicketForm";

const EMPTY = {
  branch_id: "", lead_date: "", name: "", phone: "", address: "",
  interest_product_ids: [] as string[], interest_note: "",
  source: "", source_note: "", owner_id: "", helper_ids: [] as string[],
  next_follow_up: "", first_kind: "note", first_note: "",
};

/** Thêm / sửa khách tiềm năng. lead = null → thêm mới. */
export function LeadForm({ open, lead, meta, onClose, onSaved }: any) {
  const { user, activeBranchId } = useAuth();
  const qc = useQueryClient();
  const saveFn = useServerFn(upsertLeadFn);
  const dupFn = useServerFn(findLeadDuplicatesFn);
  const [f, setF] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const isNew = !lead?.id;
  const navigate = useNavigate();
  // Nhu cầu của khách: mua quạt mới (lead) hay liên hệ bảo hành (→ phiếu bảo hành khách lẻ).
  const [purpose, setPurpose] = useState<"buy" | "warranty">("buy");

  useEffect(() => {
    if (!open) return;
    setPurpose("buy");
    if (lead?.id) {
      setF({
        ...EMPTY,
        ...lead,
        phone: lead.phone ?? "", address: lead.address ?? "", interest_note: lead.interest_note ?? "",
        source: lead.source ?? "", source_note: lead.source_note ?? "", owner_id: lead.owner_id ?? "",
        helper_ids: lead.helper_ids ?? [], interest_product_ids: lead.interest_product_ids ?? [],
        next_follow_up: lead.next_follow_up ?? "",
      });
    } else {
      const myBranches: string[] = meta?.me?.branchIds ?? [];
      const def = (meta?.branches ?? []).find((b: any) => b.id === activeBranchId) ?? (meta?.branches ?? []).find((b: any) => myBranches.includes(b.id)) ?? meta?.branches?.[0];
      setF({ ...EMPTY, branch_id: def?.id ?? "", lead_date: todayVN(), owner_id: user?.id ?? "", next_follow_up: addDaysStr(todayVN(), 1) });
    }
  }, [open, lead?.id]);

  const canAssign = Boolean(meta?.me?.isAdmin || (meta?.me?.isSalesManager && (meta?.me?.branchIds ?? []).includes(f.branch_id)));
  const branchStaff = useMemo(
    () => (meta?.staff ?? []).filter((u: any) => !f.branch_id || (u.branch_ids ?? []).includes(f.branch_id) || u.id === f.owner_id || f.helper_ids.includes(u.id)),
    [meta, f.branch_id, f.owner_id, f.helper_ids],
  );

  // Cảnh báo trùng theo SĐT (khách đã có / lead đang mở)
  const phoneDeb = useDebouncedValue(f.phone, 400);
  const { data: dup } = useQuery({
    queryKey: ["leadDup", phoneDeb, lead?.id],
    queryFn: () => dupFn({ data: { actorId: user?.id, phone: phoneDeb, excludeId: lead?.id } }),
    enabled: open && String(phoneDeb ?? "").replace(/\D/g, "").length >= 9,
  });

  async function save() {
    if (!f.name.trim()) return toast.error("Nhập tên khách");
    if (!f.branch_id) return toast.error("Chọn showroom");
    const srcErr = customerSourceError(f.source, f.source_note, isNew);
    if (srcErr) return toast.error(srcErr);
    setSaving(true);
    try {
      const r = await saveFn({ data: { ...f, id: lead?.id, owner_id: canAssign ? f.owner_id : undefined, actorId: user?.id } });
      toast.success(isNew ? "Đã thêm khách tiềm năng" : "Đã lưu");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      onSaved?.(r.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: any) => setF((p: any) => ({ ...p, ...patch }));
  const staffName = (id: string) => (meta?.staff ?? []).find((u: any) => u.id === id)?.full_name ?? id;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{isNew ? "Thêm khách tiềm năng" : `Sửa — ${lead?.name}`}</DialogTitle>
          <DialogDescription>Khách hỏi / ghé showroom chưa mua. Có SĐT thì tự nối với khách hàng đã có.</DialogDescription>
        </DialogHeader>

        {isNew && (
          <div>
            <Label>Nhu cầu của khách *</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["buy", "Quan tâm mua quạt mới", "Lưu vào khách tiềm năng để chăm sóc", ShoppingBag],
                ["warranty", "Liên hệ bảo hành", "Tạo phiếu bảo hành khách lẻ", Wrench],
              ].map(([key, label, desc, Icon]: any) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPurpose(key)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left ${purpose === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted"}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${purpose === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-muted-foreground">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isNew && purpose === "warranty" ? (
          // Khách liên hệ bảo hành → phiếu bảo hành khách lẻ (không tính vào tỉ lệ chốt lead).
          <TicketFormBody
            kind="retail"
            silent
            initial={{ branch_id: f.branch_id, customer_name: f.name, phone: f.phone, address: f.address }}
            onCancel={onClose}
            onSaved={(r: any) => {
              onClose();
              toast.success(`Đã tạo phiếu bảo hành ${r.code}`, {
                action: { label: "Mở phiếu", onClick: () => navigate({ to: "/warranty", search: { ticket: r.id } as any }) },
              });
            }}
          />
        ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Showroom *</Label>
              <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" value={f.branch_id} onChange={(e) => set({ branch_id: e.target.value })}>
                <option value="">— Chọn —</option>
                {(meta?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Ngày tiếp nhận *</Label>
              <Input type="date" className="mt-1.5" value={f.lead_date} onChange={(e) => set({ lead_date: e.target.value })} />
            </div>
            <div>
              <Label>Hẹn chăm tiếp</Label>
              <Input type="date" className="mt-1.5" value={f.next_follow_up ?? ""} onChange={(e) => set({ next_follow_up: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Tên khách *</Label>
              <Input className="mt-1.5" autoFocus={isNew} placeholder="vd: Chị Thảo, Anh Quý" value={f.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div>
              <Label>Số điện thoại</Label>
              <Input className="mt-1.5" inputMode="tel" placeholder="Không bắt buộc" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
          </div>

          {(dup?.customer || (dup?.leads ?? []).length > 0 || (dup?.otherBranchLeads ?? []).length > 0) && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              {dup.customer && (
                <div className="flex items-start gap-2">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Đã là khách hàng: <strong>{dup.customer.name}</strong> — đã mua {dup.customer.completed_orders} đơn. Lead sẽ tự nối với khách này.</span>
                </div>
              )}
              {(dup.otherBranchLeads ?? []).length > 0 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Khách này đang được tư vấn ở showroom khác: <strong>{dup.otherBranchLeads.map((o: any) => `${o.branch_name}${o.count > 1 ? ` (${o.count})` : ""}`).join(", ")}</strong>.</span>
                </div>
              )}
              {(dup.leads ?? []).map((l: any) => (
                <div key={l.id} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Đang có lead mở: <strong>{l.name}</strong> ({dmy(l.lead_date)}) — {shortStaff(staffName(l.owner_id))} phụ trách · <StageBadge stage={l.stage} />
                  </span>
                </div>
              ))}
            </div>
          )}

          <div>
            <Label>Địa chỉ / khu vực</Label>
            <Input className="mt-1.5" placeholder="vd: Tân Bình, Biên Hòa" value={f.address} onChange={(e) => set({ address: e.target.value })} />
          </div>

          <div>
            <Label>Quan tâm mẫu</Label>
            <div className="mt-1.5"><ProductMultiPicker products={meta?.products ?? []} value={f.interest_product_ids} onChange={(ids) => set({ interest_product_ids: ids })} /></div>
            <Input className="mt-1.5" placeholder="Ghi thêm: phòng khách, trần cao 3m, công trình 6 cái…" value={f.interest_note} onChange={(e) => set({ interest_note: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CustomerSourceField source={f.source} note={f.source_note} required={isNew} onChange={({ source, note }) => set({ source, source_note: note })} />
            <div>
              <Label>Người phụ trách</Label>
              <select
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 disabled:opacity-70"
                disabled={!canAssign}
                value={f.owner_id}
                onChange={(e) => set({ owner_id: e.target.value, helper_ids: f.helper_ids.filter((h: string) => h !== e.target.value) })}
              >
                <option value="">— Chưa gán —</option>
                {branchStaff.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
              {!canAssign && <div className="mt-1 text-xs text-muted-foreground">Chỉ quản lý bán hàng / admin đổi được người phụ trách.</div>}
            </div>
          </div>

          <div>
            <Label>Người hỗ trợ</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {branchStaff.filter((u: any) => u.id !== f.owner_id).map((u: any) => {
                const on = f.helper_ids.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => set({ helper_ids: on ? f.helper_ids.filter((h: string) => h !== u.id) : [...f.helper_ids, u.id] })}
                    className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {shortStaff(u.full_name)}
                  </button>
                );
              })}
            </div>
          </div>

          {isNew && (
            <div className="rounded-lg border p-3">
              <Label>Lần chăm đầu tiên (không bắt buộc)</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {LEAD_ACTIVITY_KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => set({ first_kind: k.key })}
                    className={`rounded-full border px-2.5 py-1 text-xs ${f.first_kind === k.key ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                    {k.label}
                  </button>
                ))}
              </div>
              <textarea
                className="mt-2 min-h-[70px] w-full rounded-md border bg-background px-3 py-2"
                placeholder="vd: Đã kết bạn Zalo, gửi catalog Lotus + Rose, hẹn cuối tuần ra showroom"
                value={f.first_note}
                onChange={(e) => set({ first_note: e.target.value })}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose}>Huỷ</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{isNew ? "Thêm" : "Lưu"}</Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
