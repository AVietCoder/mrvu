// @ts-nocheck
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { upsertCustomerGroup, deleteCustomerGroup } from "@/lib/customers.functions";
import {
  useCustomerGroups,
  GROUP_COLOR_CLASS,
  GROUP_COLOR_LABEL,
} from "@/hooks/useCustomerGroups";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";

type Draft = { code?: string; name: string; color: string; sort_order: number; is_active: boolean };
const EMPTY: Draft = { name: "", color: "gray", sort_order: 0, is_active: true };

/**
 * Quản lý nhóm khách hàng: thêm, đổi tên/màu, bật/tắt, xoá.
 * Ai cũng xem được danh sách; chỉ admin sửa được (server kiểm lại lần nữa).
 */
export function CustomerGroupManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { groups, isLoading, fallback } = useCustomerGroups({ withCounts: true });
  const upsert = useServerFn(upsertCustomerGroup);
  const del = useServerFn(deleteCustomerGroup);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["customerGroups"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function save() {
    if (!draft || saving) return;
    if (!draft.name.trim()) return toast.error("Nhập tên nhóm");
    setSaving(true);
    try {
      await upsert({ data: { ...draft, name: draft.name.trim(), actorId: user?.id } });
      toast.success(draft.code ? "Đã cập nhật nhóm" : "Đã thêm nhóm");
      setDraft(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu nhóm");
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: any) {
    if (!window.confirm(`Xoá nhóm "${g.name}"?`)) return;
    setDeleting(g.code);
    try {
      await del({ data: { code: g.code, actorId: user?.id } });
      toast.success("Đã xoá nhóm");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xoá nhóm");
    } finally {
      setDeleting(null);
    }
  }

  async function toggleActive(g: any) {
    try {
      await upsert({
        data: {
          code: g.code,
          name: g.name,
          color: g.color,
          sort_order: g.sort_order,
          is_active: !g.is_active,
          actorId: user?.id,
        },
      });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setDraft(null);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhóm khách hàng</DialogTitle>
          <DialogDescription>
            Nhóm dùng để phân loại khách (lẻ, đại lý, VIP...). Tắt một nhóm sẽ ẩn nó khỏi ô chọn khi
            tạo khách mới, nhưng khách cũ trong nhóm vẫn giữ nguyên.
          </DialogDescription>
        </DialogHeader>

        {fallback && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            Chưa chạy <code>sql_migration_v12_customer_groups.sql</code> — đang dùng 4 nhóm mặc định,
            chưa thêm/sửa được.
          </div>
        )}

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g: any) => (
              <div
                key={g.code}
                className={`flex items-center gap-3 rounded-lg border p-3 ${g.is_active ? "" : "opacity-60"}`}
              >
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${GROUP_COLOR_CLASS[g.color] ?? GROUP_COLOR_CLASS.gray}`}>
                  {g.name}
                </span>
                <div className="flex-1 text-xs text-muted-foreground">
                  {g.customer_count != null ? `${g.customer_count.toLocaleString("vi-VN")} khách` : ""}
                  {!g.is_active && " · đã tắt"}
                </div>
                {isAdmin && !fallback && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(g)} title={g.is_active ? "Tắt nhóm" : "Bật nhóm"}>
                      {g.is_active ? "Tắt" : "Bật"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft({ code: g.code, name: g.name, color: g.color, sort_order: g.sort_order, is_active: g.is_active })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={g.code === "le" || deleting === g.code || (g.customer_count ?? 0) > 0}
                      title={
                        g.code === "le"
                          ? "Không xoá được nhóm mặc định"
                          : (g.customer_count ?? 0) > 0
                            ? "Nhóm đang có khách — chuyển khách sang nhóm khác hoặc tắt nhóm"
                            : "Xoá nhóm"
                      }
                      onClick={() => remove(g)}
                    >
                      {deleting === g.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Form thêm / sửa */}
        {isAdmin && !fallback && (
          draft ? (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
              <div className="font-medium text-sm">{draft.code ? "Sửa nhóm" : "Thêm nhóm mới"}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tên nhóm *</Label>
                  <Input
                    className="mt-1"
                    autoFocus
                    maxLength={50}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                    placeholder="VD: Khách sỉ"
                  />
                </div>
                <div>
                  <Label className="text-xs">Thứ tự hiển thị</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    value={draft.sort_order}
                    onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Màu nhãn</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.keys(GROUP_COLOR_CLASS).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft({ ...draft, color: c })}
                      className={`rounded px-2 py-1 text-xs font-medium border-2 ${GROUP_COLOR_CLASS[c]} ${
                        draft.color === c ? "border-foreground" : "border-transparent"
                      }`}
                    >
                      {GROUP_COLOR_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
              {draft.code && (
                <div className="text-xs text-muted-foreground">
                  Mã nhóm <code>{draft.code}</code> không đổi được — nó đang được lưu trong hồ sơ khách.
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                  <X className="h-4 w-4 mr-1" /> Huỷ
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Lưu
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setDraft({ ...EMPTY })}>
              <Plus className="h-4 w-4 mr-1" /> Thêm nhóm
            </Button>
          )
        )}

        {!isAdmin && (
          <div className="text-xs text-muted-foreground">Chỉ quản trị viên được thêm/sửa nhóm.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
