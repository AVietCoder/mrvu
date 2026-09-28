// @ts-nocheck
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getLeadMetaFn } from "@/lib/leads.functions";
import { useAuth } from "@/context/AuthContext";
import { leadStageOf, customerSourceLabel } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

export const money = (n: any) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
export const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export const addDaysStr = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
export const dmy = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
export const dm = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
export const sourceText = (l: any) => customerSourceLabel(l.source, l.source_note) || "—";

/** Danh mục cho khách tiềm năng: showroom trong phạm vi, nhân viên, hàng hóa. */
export function useLeadMeta() {
  const { user } = useAuth();
  const fn = useServerFn(getLeadMetaFn);
  const q = useQuery({
    queryKey: ["leadMeta", user?.id],
    queryFn: () => fn({ data: { actorId: user?.id } }),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });
  const meta = q.data;
  const staffById = useMemo(() => new Map((meta?.staff ?? []).map((u: any) => [u.id, u])), [meta]);
  const branchById = useMemo(() => new Map((meta?.allBranches ?? []).map((b: any) => [b.id, b])), [meta]);
  const productById = useMemo(() => new Map((meta?.products ?? []).map((p: any) => [p.id, p])), [meta]);
  return {
    ...q,
    meta,
    staffName: (id?: string | null) => (id ? staffById.get(id)?.full_name ?? "—" : "—"),
    branchName: (id?: string | null) => (id ? branchById.get(id)?.name ?? "—" : "—"),
    productName: (id: string) => productById.get(id)?.name ?? "(đã xoá)",
  };
}

/** Tên ngắn cho nhân viên: "Ms. Thảo - 0888 283 289" → "Thảo". */
export function shortStaff(name?: string | null) {
  if (!name || name === "—") return "—";
  const clean = name.replace(/^(ms|mr|mrs)\.?\s*/i, "").split(/\s+-\s+|\s+\d/)[0].trim();
  const parts = clean.split(/\s+/);
  return parts.length > 2 ? parts.slice(-2).join(" ") : clean;
}

export function StageBadge({ stage, className = "" }: { stage: string; className?: string }) {
  const s = leadStageOf(stage);
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.tone} ${className}`}>{s.label}</span>;
}

/** Chọn NHIỀU hàng hóa: gõ tìm → bấm để thêm, hiện thành chip. */
export function ProductMultiPicker({ products, value, onChange }: { products: any[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  const hits = useMemo(() => {
    const k = fold(q.trim());
    return (products ?? []).filter((p) => !value.includes(p.id) && (!k || fold(`${p.name} ${p.sku ?? ""}`).includes(k))).slice(0, 30);
  }, [products, q, value]);
  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {byId.get(id)?.name ?? "(đã xoá)"}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Bỏ"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <Input
        placeholder="Gõ tên mẫu quạt để thêm…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-background shadow-lg">
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange([...value, p.id]); setQ(""); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{p.name}</span>
              {p.sku && <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
