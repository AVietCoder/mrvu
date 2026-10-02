// @ts-nocheck
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listFactoriesFn, upsertFactoryFn, deleteFactoryFn, listWarrantyProductsFn, setProductWarrantyMonthsFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Pencil, Trash2, Search, Factory } from "lucide-react";
import { toast } from "sonner";

const EMPTY_FACTORY = { id: "", name: "", contact_name: "", phone: "", note: "", sla_days: "14", is_active: true };
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

function Factories() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listFactoriesFn);
  const saveFn = useServerFn(upsertFactoryFn);
  const delFn = useServerFn(deleteFactoryFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["warranty", "factories"],
    queryFn: () => listFn({ data: { actorId: user?.id } }),
    enabled: Boolean(user?.id),
  });
  const [form, setForm] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["warranty"] });
    qc.invalidateQueries({ queryKey: ["warrantyMeta"] });
    qc.invalidateQueries({ queryKey: ["warrantyAlerts"] });
  };

  async function save() {
    if (!form.name.trim()) return toast.error("Nhập tên nhà máy");
    setSaving(true);
    try {
      await saveFn({ data: { ...form, id: form.id || undefined, sla_days: Number(form.sla_days), actorId: user?.id } });
      toast.success("Đã lưu nhà máy");
      setForm(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  }
  async function remove(f: any) {
    if (!window.confirm(`Xoá nhà máy "${f.name}"?`)) return;
    try {
      await delFn({ data: { actorId: user?.id, id: f.id } });
      toast.success("Đã xoá");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xoá");
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Factory className="h-5 w-5 text-muted-foreground" />
        <div className="mr-auto">
          <div className="font-semibold">Danh mục nhà máy</div>
          <div className="text-xs text-muted-foreground">Hạn gửi trả = số ngày kể từ khi nhà máy báo hướng xử lý; quá hạn sẽ hiện cảnh báo ở trang Tổng quan.</div>
        </div>
        <Button size="sm" onClick={() => setForm({ ...EMPTY_FACTORY })}><Plus className="mr-1 h-4 w-4" />Thêm nhà máy</Button>
      </div>
      {error ? (
        <div className="p-6 text-sm text-destructive">{String((error as any).message)}</div>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (data?.factories ?? []).length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Chưa có nhà máy nào — thêm nhà máy để bắt đầu ghi nhận hàng lỗi gửi nhà máy.</div>
      ) : (
        <div className="divide-y">
          {data.factories.map((f: any) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{f.name}{f.is_active === false && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-normal text-slate-600">Ngừng dùng</span>}</div>
                <div className="text-xs text-muted-foreground">{[f.contact_name, f.phone, f.note].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>Hạn gửi trả <strong className="text-foreground">{f.sla_days} ngày</strong></div>
                <div>{f.claim_count} yêu cầu</div>
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Sửa" onClick={() => setForm({ ...EMPTY_FACTORY, ...f, contact_name: f.contact_name ?? "", phone: f.phone ?? "", note: f.note ?? "", sla_days: String(f.sla_days) })}><Pencil className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8 text-destructive" aria-label="Xoá" onClick={() => remove(f)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(form)} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">{form?.id ? "Sửa nhà máy" : "Thêm nhà máy"}</DialogTitle>
            <DialogDescription>Nhà máy sản xuất nhận bảo hành hàng lỗi.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3 text-sm">
              <div>
                <Label>Tên nhà máy *</Label>
                <Input className="mt-1.5" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Người liên hệ</Label>
                  <Input className="mt-1.5" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                </div>
                <div>
                  <Label>Số điện thoại</Label>
                  <Input className="mt-1.5" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Hạn gửi trả (ngày) *</Label>
                  <Input className="mt-1.5" inputMode="numeric" value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value.replace(/\D/g, "") })} />
                </div>
                <label className="flex cursor-pointer items-end gap-2 pb-2.5">
                  <input type="checkbox" className="h-4 w-4" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Đang hoạt động
                </label>
              </div>
              <div>
                <Label>Ghi chú / chính sách bảo hành</Label>
                <textarea className="mt-1.5 min-h-[60px] w-full rounded-md border bg-background px-3 py-2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setForm(null)}>Huỷ</Button>
                <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Lưu</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProductMonths() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listWarrantyProductsFn);
  const setFn = useServerFn(setProductWarrantyMonthsFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["warranty", "productMonths"],
    queryFn: () => listFn({ data: { actorId: user?.id } }),
    enabled: Boolean(user?.id),
  });
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [bulkMotor, setBulkMotor] = useState("");
  const [bulkPart, setBulkPart] = useState("");
  // Ô đang sửa dở: { [productId]: { motor?: string; part?: string } }
  const [draft, setDraft] = useState<Record<string, { motor?: string; part?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const v24 = data?.migratedV24 !== false;

  const catName = useMemo(() => new Map((data?.categories ?? []).map((c: any) => [c.id, c.name])), [data]);
  const rows = useMemo(() => {
    const k = fold(q.trim());
    return ((data?.products ?? []) as any[]).filter(
      (p) => (showHidden || p.is_hidden !== true) && (!categoryId || p.category_id === categoryId) && (!k || fold(`${p.name} ${p.sku ?? ""}`).includes(k)),
    );
  }, [data, q, categoryId, showHidden]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["warranty"] });
    qc.invalidateQueries({ queryKey: ["warrantyMeta"] });
  };
  const valid = (v?: string) => v === undefined || v === "" || (Number(v) >= 1 && Number(v) <= 240);

  async function apply(key: string, productIds: string[], motor: string | undefined, part: string | undefined, okMsg: string) {
    if (!valid(motor) || !valid(part)) return toast.error("Số tháng bảo hành phải từ 1 đến 240");
    setBusy(key);
    try {
      await setFn({ data: { actorId: user?.id, productIds, motorMonths: motor ? Number(motor) : undefined, months: part ? Number(part) : undefined } });
      toast.success(okMsg);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !productIds.includes(id))));
      refresh();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b px-4 py-3">
        <div className="font-semibold">Hạn bảo hành theo từng mẫu quạt</div>
        <div className="text-xs text-muted-foreground">
          Hai mức: <strong>động cơ</strong> (mặc định 120 tháng) và <strong>phụ kiện / linh kiện</strong> (mặc định 12 tháng). Đổi số tháng → phiếu đang mở của mẫu đó cập nhật theo; phiếu đã hoàn tất giữ nguyên.
        </div>
      </div>
      {!v24 && (
        <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">Chưa chạy <strong>sql_migration_v24_warranty_two_tier.sql</strong> — chưa đặt được hạn động cơ (đang tạm tính 120 tháng).</div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 pl-9" placeholder="Tìm tên mẫu / mã hàng…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Tất cả nhóm hàng</option>
          {(data?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Cả hàng ẩn</label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">Đặt cho <strong className="text-foreground">{rows.length}</strong> mẫu đang lọc:</span>
        <span className="ml-auto">Động cơ</span>
        <Input className="h-9 w-20 text-right" inputMode="numeric" placeholder="tháng" disabled={!v24} value={bulkMotor} onChange={(e) => setBulkMotor(e.target.value.replace(/\D/g, ""))} />
        <span>Phụ kiện</span>
        <Input className="h-9 w-20 text-right" inputMode="numeric" placeholder="tháng" value={bulkPart} onChange={(e) => setBulkPart(e.target.value.replace(/\D/g, ""))} />
        <Button
          variant="outline" size="sm" className="h-9" disabled={(!bulkMotor && !bulkPart) || !rows.length || busy === "bulk"}
          onClick={async () => {
            const what = [bulkMotor ? `động cơ ${bulkMotor} tháng` : "", bulkPart ? `phụ kiện ${bulkPart} tháng` : ""].filter(Boolean).join(", ");
            if (!window.confirm(`Đặt ${what} cho ${rows.length} mẫu đang lọc?`)) return;
            if (await apply("bulk", rows.map((p) => p.id), bulkMotor || undefined, bulkPart || undefined, `Đã đặt ${what} cho ${rows.length} mẫu`)) { setBulkMotor(""); setBulkPart(""); }
          }}
        >
          {busy === "bulk" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Áp dụng
        </Button>
      </div>
      {error ? (
        <div className="p-6 text-sm text-destructive">{String((error as any).message)}</div>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-4 py-2 font-semibold">Mẫu quạt</th>
                <th className="px-2 font-semibold">Nhóm hàng</th>
                <th className="px-2 text-right font-semibold">Động cơ (tháng)</th>
                <th className="px-2 text-right font-semibold">Phụ kiện (tháng)</th>
                <th className="px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Không có mẫu nào khớp</td></tr>}
              {rows.slice(0, 300).map((p) => {
                const cur = { motor: String(p.warranty_motor_months ?? 120), part: String(p.warranty_months ?? 12) };
                const d = draft[p.id] ?? {};
                const motorDirty = d.motor !== undefined && d.motor !== cur.motor;
                const partDirty = d.part !== undefined && d.part !== cur.part;
                const dirty = motorDirty || partDirty;
                const save = () => apply(p.id, [p.id], motorDirty ? d.motor : undefined, partDirty ? d.part : undefined, `Đã lưu hạn bảo hành: ${p.name}`);
                const edit = (k: "motor" | "part", v: string) => setDraft((all) => ({ ...all, [p.id]: { ...all[p.id], [k]: v.replace(/\D/g, "") } }));
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-1.5">
                      <span className="font-medium">{p.name}</span>
                      {p.sku && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.sku}</span>}
                      {p.is_hidden === true && <span className="ml-2 rounded bg-slate-200 px-1.5 text-xs text-slate-600">ẩn</span>}
                    </td>
                    <td className="px-2 text-muted-foreground">{catName.get(p.category_id) ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        className={`ml-auto h-8 w-20 text-right ${motorDirty ? "border-primary" : ""}`} inputMode="numeric" disabled={!v24}
                        value={d.motor ?? cur.motor} onChange={(e) => edit("motor", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(); }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        className={`ml-auto h-8 w-20 text-right ${partDirty ? "border-primary" : ""}`} inputMode="numeric"
                        value={d.part ?? cur.part} onChange={(e) => edit("part", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(); }}
                      />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <Button size="sm" className="h-8" variant={dirty ? "default" : "outline"} disabled={!dirty || busy === p.id} onClick={save}>
                        {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 300 && <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">Đang hiện 300 / {rows.length} mẫu — gõ tìm hoặc lọc nhóm hàng để thu hẹp.</div>}
        </div>
      )}
    </Card>
  );
}

/** Cài đặt bảo hành (chỉ admin): danh mục nhà máy + hạn bảo hành theo mẫu. */
export function WarrantySettings() {
  return (
    <div className="space-y-4">
      <Factories />
      <ProductMonths />
    </div>
  );
}
