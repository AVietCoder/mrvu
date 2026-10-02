// @ts-nocheck
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getWarrantyMetaFn } from "@/lib/warranty.functions";
import { uploadFileToCloudinary } from "@/lib/cloudinary";
import { useAuth } from "@/context/AuthContext";
import { FACTORY_RETURN_STATUSES, warrantyStageOf } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Paperclip, Link2, X, Film, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const money = (n: any) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
export const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export const addDaysStr = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
export const dmy = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
/** Mốc thời gian → "YYYY-MM-DDTHH:mm" theo giờ VN (cho ô datetime-local). */
export const toLocalInput = (ts?: string | number | null) => (ts ? new Date(new Date(ts).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : "");
export const nowLocalInput = () => toLocalInput(Date.now());
export const dmyTime = (ts?: string | null) =>
  ts ? new Date(ts).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "";
export const shortBranch = (name?: string | null) => String(name ?? "—").replace(/^Mr\.?\s*V[uũUŨ]\s*-\s*/i, "");

export const PRESETS = [
  ["this", "Tháng này"],
  ["last", "Tháng trước"],
  ["3m", "3 tháng"],
  ["year", "Năm nay"],
  ["all", "Tất cả"],
] as const;
export function presetRange(p: string) {
  const t = todayVN();
  const [y, m] = t.split("-").map(Number);
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  if (p === "this") return { from: first(y, m), to: t };
  if (p === "last") return { from: first(y, m - 1), to: addDaysStr(first(y, m), -1) };
  if (p === "3m") return { from: first(y, m - 2), to: t };
  if (p === "year") return { from: `${y}-01-01`, to: t };
  return { from: "", to: "" };
}

/** Danh mục cho bảo hành: showroom trong phạm vi, nhân viên, mẫu quạt, nhà máy (admin). */
export function useWarrantyMeta() {
  const { user } = useAuth();
  const fn = useServerFn(getWarrantyMetaFn);
  const q = useQuery({
    queryKey: ["warrantyMeta", user?.id],
    queryFn: () => fn({ data: { actorId: user?.id } }),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });
  const meta = q.data;
  const staffById = useMemo(() => new Map((meta?.staff ?? []).map((u: any) => [u.id, u])), [meta]);
  const branchById = useMemo(() => new Map((meta?.allBranches ?? []).map((b: any) => [b.id, b])), [meta]);
  const productById = useMemo(() => new Map((meta?.products ?? []).map((p: any) => [p.id, p])), [meta]);
  const factoryById = useMemo(() => new Map((meta?.factories ?? []).map((f: any) => [f.id, f])), [meta]);
  return {
    ...q,
    meta,
    productById,
    staffName: (id?: string | null) => (id ? staffById.get(id)?.full_name ?? "—" : "—"),
    branchName: (id?: string | null) => (id ? branchById.get(id)?.name ?? "—" : "—"),
    factoryName: (id?: string | null) => (id ? factoryById.get(id)?.name ?? "(đã xoá)" : "—"),
  };
}

/** Tên ngắn cho nhân viên: "Ms. Thảo - 0888 283 289" → "Thảo". */
export function shortStaff(name?: string | null) {
  if (!name || name === "—") return "—";
  const clean = name.replace(/^(ms|mr|mrs)\.?\s*/i, "").split(/\s+-\s+|\s+\d/)[0].trim();
  const parts = clean.split(/\s+/);
  return parts.length > 2 ? parts.slice(-2).join(" ") : clean;
}

const PILL = "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium";

export function StageBadge({ stage, className = "" }: { stage: string; className?: string }) {
  const s = warrantyStageOf(stage);
  return <span className={`${PILL} ${s.tone} ${className}`}>{s.label}</span>;
}

/**
 * 🟢 Còn hạn / 🛑 Hết hạn / 🟡 Còn hạn một phần (chưa xác định bộ phận lỗi, thường
 * là động cơ còn hạn mà phụ kiện đã hết) / ⚪ Chưa rõ ngày mua.
 */
export function WarrantyBadge({ warranty, expiresOn, motorIn = true, className = "" }: { warranty?: string; expiresOn?: string | null; motorIn?: boolean; className?: string }) {
  if (warranty === "partial") return <span title={`${motorIn ? "Phụ kiện đã hết hạn, động cơ còn hạn" : "Động cơ đã hết hạn, phụ kiện còn hạn"}${expiresOn ? ` đến ${dmy(expiresOn)}` : ""} — chọn bộ phận lỗi để chốt`} className={`${PILL} border-amber-300 bg-amber-100 text-amber-800 ${className}`}>🟡 Còn hạn {motorIn ? "động cơ" : "phụ kiện"}</span>;
  if (warranty === "in") return <span title={expiresOn ? `Hết hạn ${dmy(expiresOn)}` : ""} className={`${PILL} border-emerald-300 bg-emerald-100 text-emerald-800 ${className}`}>🟢 Còn hạn BH</span>;
  if (warranty === "out") return <span title={expiresOn ? `Đã hết hạn từ ${dmy(expiresOn)}` : ""} className={`${PILL} border-rose-300 bg-rose-100 text-rose-800 ${className}`}>🛑 Hết hạn BH</span>;
  return <span className={`${PILL} border-slate-200 bg-slate-100 text-slate-600 ${className}`}>Chưa rõ ngày mua</span>;
}

export function ReturnBadge({ status, className = "" }: { status: string; className?: string }) {
  const s = FACTORY_RETURN_STATUSES.find((x) => x.key === status) ?? FACTORY_RETURN_STATUSES[0];
  return <span className={`${PILL} ${s.tone} ${className}`}>{s.label}</span>;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/**
 * Chọn MỘT mẫu quạt: gõ tìm trong danh mục, hoặc gõ tên tự do (mẫu cũ / không có
 * trong danh mục) → lưu ở `model`.
 */
export function ProductPicker({ products, productId, model, onChange }: { products: any[]; productId: string; model: string; onChange: (v: { product_id: string; product_model: string }) => void }) {
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const k = fold(String(model ?? "").trim());
    return (products ?? []).filter((p) => !k || fold(`${p.name} ${p.sku ?? ""}`).includes(k)).slice(0, 30);
  }, [products, model]);
  return (
    <div className="relative">
      <Input
        placeholder="Gõ tên mẫu quạt…"
        value={model}
        onChange={(e) => { onChange({ product_id: "", product_model: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={productId ? "pr-8 font-medium" : ""}
      />
      {productId && (
        <button type="button" aria-label="Bỏ chọn" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => onChange({ product_id: "", product_model: "" })}>
          <X className="h-4 w-4" />
        </button>
      )}
      {open && !productId && hits.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-background shadow-lg">
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange({ product_id: p.id, product_model: p.name }); setOpen(false); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">BH động cơ {p.warranty_motor_months} · phụ kiện {p.warranty_months} tháng</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Danh sách ảnh / video / link đã đính kèm (chỉ xem). */
export function AttachmentList({ items, onRemove }: { items: any[]; onRemove?: (i: number) => void }) {
  if (!(items ?? []).length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((m, i) => (
        <div key={`${m.url}-${i}`} className="group relative">
          <a href={m.url} target="_blank" rel="noopener noreferrer" title={m.name || m.url} className="block">
            {m.kind === "image" ? (
              <img src={m.url} alt={m.name || "Ảnh lỗi"} loading="lazy" className="h-20 w-20 rounded-lg border object-cover" />
            ) : (
              <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 px-2 text-xs text-muted-foreground">
                {m.kind === "video" ? <Film className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />}
                <span className="w-full truncate text-center">{m.name || (m.kind === "video" ? "Video" : "Link")}</span>
              </span>
            )}
          </a>
          {onRemove && (
            <button type="button" aria-label="Xoá" onClick={() => onRemove(i)} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Tải ảnh / video lên (Cloudinary) hoặc dán link Drive / Zalo… */
export function AttachmentsField({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState("");
  const items = value ?? [];

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    setUploading(list.length);
    const added: any[] = [];
    for (const f of list) {
      try {
        const r = await uploadFileToCloudinary(f);
        added.push({ url: r.url, kind: r.kind, name: f.name });
      } catch (e: any) {
        toast.error(`${f.name}: ${e?.message ?? "không tải lên được"} — có thể dán link thay thế`);
      }
      setUploading((n) => n - 1);
    }
    setUploading(0);
    if (added.length) onChange([...items, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }
  function addLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) return toast.error("Link phải bắt đầu bằng http:// hoặc https://");
    onChange([...items, { url, kind: "link", name: url.replace(/^https?:\/\//i, "").slice(0, 40) }]);
    setLink("");
  }

  return (
    <div className="space-y-2">
      <AttachmentList items={items} onRemove={(i) => onChange(items.filter((_, idx) => idx !== i))} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        <Button type="button" variant="outline" size="sm" disabled={uploading > 0} onClick={() => inputRef.current?.click()}>
          {uploading > 0 ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
          {uploading > 0 ? `Đang tải ${uploading} file…` : "Tải ảnh / video"}
        </Button>
        <div className="flex min-w-[220px] flex-1 items-center gap-1.5">
          <Input className="h-9" placeholder="Hoặc dán link (Drive, Zalo…)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
          <Button type="button" variant="outline" size="sm" disabled={!link.trim()} onClick={addLink}><Link2 className="mr-1 h-4 w-4" />Thêm</Button>
        </div>
      </div>
    </div>
  );
}
