// @ts-nocheck
import { useMemo, useState } from "react";
import { Download, Fan, Package, Puzzle, Search } from "lucide-react";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Báo cáo hàng bán (tab Doanh thu theo kỳ): tổng SỐ LƯỢNG hàng bán được trong khoảng ngày
 * đang chọn, gộp theo Tuần / Tháng / Quý / Năm, và theo từng mặt hàng.
 * Cùng quy ước với Top sản phẩm: đơn HOÀN TẤT tính theo ngày hoàn tất, phiếu trả hàng TRỪ
 * theo ngày tạo phiếu trả; "Phụ kiện & dịch vụ" = hàng bỏ tick "Tính vào tổng số hàng hóa" (count_in_total) —
 * gồm cả dịch vụ như Công lắp đặt, Phụ thu, Bảo hành VIP.
 */
type Group = "week" | "month" | "quarter" | "year";
const GROUPS: { key: Group; label: string }[] = [
  { key: "week", label: "Tuần" },
  { key: "month", label: "Tháng" },
  { key: "quarter", label: "Quý" },
  { key: "year", label: "Năm" },
];
const money = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
const qtyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n || 0);
const dtf = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
const vnDay = (v: any) => dtf.format(new Date(v));
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function bucketOf(day: string, g: Group): { key: string; label: string } {
  const y = day.slice(0, 4), m = Number(day.slice(5, 7));
  if (g === "year") return { key: y, label: `Năm ${y}` };
  if (g === "quarter") { const q = Math.ceil(m / 3); return { key: `${y}-Q${q}`, label: `Quý ${q}/${y}` }; }
  if (g === "month") return { key: day.slice(0, 7), label: `Tháng ${m}/${y}` };
  // Tuần bắt đầu thứ Hai
  const d = new Date(`${day}T00:00:00Z`);
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const a = mon.toISOString().slice(0, 10), b = sun.toISOString().slice(0, 10);
  return { key: a, label: `Tuần ${dm(a)} – ${dm(b)}${a.slice(0, 4) !== b.slice(0, 4) ? "" : `/${a.slice(0, 4)}`}` };
}

export function SalesQtyReport({ data, fromDate, toDate }: { data: any; fromDate: string; toDate: string }) {
  const [group, setGroup] = useState<Group>("month");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "main" | "acc">("all");

  const r = useMemo(() => {
    const orders: any[] = data?._rawOrders ?? [];
    const returns: any[] = data?._rawReturns ?? [];
    const items: any[] = data?._rawItems ?? [];
    const returnItems: any[] = data?._rawReturnItems ?? [];
    const products = new Map(((data?._rawProducts ?? []) as any[]).map((p) => [p.id, p]));
    const dayOfOrder = new Map<string, string>();
    for (const o of orders) if (o.status === "completed") dayOfOrder.set(o.id, vnDay(o.completed_at || o.created_at));
    for (const o of returns) dayOfOrder.set(o.id, vnDay(o.created_at));

    const buckets = new Map<string, { label: string; main: number; acc: number; amount: number }>();
    const byProduct = new Map<string, { id: string; name: string; sku: string; acc: boolean; qty: number; returned: number; amount: number }>();
    let main = 0, acc = 0, amount = 0;
    const add = (it: any, sign: 1 | -1) => {
      const day = dayOfOrder.get(it.order_id);
      if (!day || day < fromDate || day > toDate) return;
      const p: any = products.get(it.product_id);
      const isAcc = p?.count_in_total === false;
      const n = Number(it.qty || 0) * sign;
      const money = Number(it.qty || 0) * Number(it.unit_price || 0) * sign;
      const b = bucketOf(day, group);
      const row = buckets.get(b.key) ?? { label: b.label, main: 0, acc: 0, amount: 0 };
      if (isAcc) row.acc += n; else row.main += n;
      row.amount += money;
      buckets.set(b.key, row);
      const pr = byProduct.get(it.product_id) ?? { id: it.product_id, name: p?.name ?? "(hàng đã xoá)", sku: p?.sku ?? "", acc: isAcc, qty: 0, returned: 0, amount: 0 };
      pr.qty += n;
      if (sign < 0) pr.returned += Number(it.qty || 0);
      pr.amount += money;
      byProduct.set(it.product_id, pr);
      if (isAcc) acc += n; else main += n;
      amount += money;
    };
    items.forEach((it) => add(it, 1));
    returnItems.forEach((it) => add(it, -1));
    return {
      main, acc, amount,
      buckets: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, ...v })),
      products: [...byProduct.values()].filter((p) => p.qty !== 0 || p.returned > 0).sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    };
  }, [data, fromDate, toDate, group]);

  const term = q.trim().toLowerCase();
  const shown = r.products.filter(
    (p) => (kind === "all" || (kind === "acc") === p.acc) && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
  );

  function exportCsv() {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      `Báo cáo hàng bán ${fromDate} → ${toDate}`,
      "",
      `Kỳ (${GROUPS.find((g) => g.key === group)?.label}),Quạt / hàng chính,Phụ kiện & dịch vụ,Tiền hàng`,
      ...r.buckets.map((b) => [esc(b.label), b.main, b.acc, Math.round(b.amount)].join(",")),
      "",
      "Mã hàng,Tên hàng,Loại,Số lượng bán (thuần),Trả lại,Tiền hàng",
      ...r.products.map((p) => [esc(p.sku), esc(p.name), p.acc ? "Phụ kiện / dịch vụ" : "Hàng chính", p.qty, p.returned, Math.round(p.amount)].join(",")),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-hang-ban_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const maxB = Math.max(1, ...r.buckets.map((b) => Math.max(0, b.main + b.acc)));
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="font-semibold text-base">Báo cáo hàng bán</div>
          <div className="text-xs text-muted-foreground">Số lượng bán thuần (bán ra − trả lại) từ {dm(fromDate)}/{fromDate.slice(0, 4)} đến {dm(toDate)}/{toDate.slice(0, 4)}</div>
        </div>
        <div className="flex overflow-hidden rounded-md border text-sm">
          {GROUPS.map((g) => (
            <button key={g.key} type="button" onClick={() => setGroup(g.key)}
              className={`px-3 py-1.5 font-medium transition-colors ${group === g.key ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
              {g.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-700"><Fan className="h-5 w-5" /></div>
          <div><div className="text-xs text-muted-foreground">Quạt / hàng chính</div><div className="text-xl font-bold tabular-nums">{qtyFmt(r.main)}</div></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-700"><Puzzle className="h-5 w-5" /></div>
          <div><div className="text-xs text-muted-foreground">Phụ kiện &amp; dịch vụ</div><div className="text-xl font-bold tabular-nums">{qtyFmt(r.acc)}</div></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Package className="h-5 w-5" /></div>
          <div><div className="text-xs text-muted-foreground">Tiền hàng (theo giá bán từng dòng)</div><div className="text-xl font-bold tabular-nums">{money(r.amount)}<span className="ml-1 text-sm text-muted-foreground">đ</span></div></div>
        </div>
      </div>

      {r.buckets.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Không có hàng bán trong khoảng này</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium">Theo {GROUPS.find((g) => g.key === group)?.label.toLowerCase()}</div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2">Kỳ</th><th className="px-3 py-2 text-right">Hàng chính</th><th className="px-3 py-2 text-right">Phụ kiện &amp; DV</th><th className="px-3 py-2 text-right">Tiền hàng</th></tr>
                </thead>
                <tbody className="divide-y">
                  {r.buckets.map((b) => (
                    <tr key={b.key}>
                      <td className="px-3 py-2">
                        <div className="whitespace-nowrap">{b.label}</div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(Math.max(0, b.main + b.acc) / maxB) * 100}%` }} /></div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{qtyFmt(b.main)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(b.acc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30 font-semibold">
                  <tr><td className="px-3 py-2">Tổng</td><td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.main)}</td><td className="px-3 py-2 text-right tabular-nums">{qtyFmt(r.acc)}</td><td className="px-3 py-2 text-right tabular-nums">{money(r.amount)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm font-medium">Theo mặt hàng ({shown.length})</span>
              <select className="h-8 rounded-md border bg-background px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                <option value="all">Tất cả</option>
                <option value="main">Hàng chính</option>
                <option value="acc">Phụ kiện &amp; dịch vụ</option>
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 w-40 pl-7 text-xs" placeholder="Tìm hàng…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-lg border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2">Mặt hàng</th><th className="px-3 py-2 text-right">SL</th><th className="px-3 py-2 text-right">Tiền hàng</th></tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-1.5">
                        <div className="font-medium leading-snug">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{[p.sku, p.acc ? "Phụ kiện / DV" : null, p.returned ? `trả ${p.returned}` : null].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{qtyFmt(p.qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(p.amount)}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Không có mặt hàng phù hợp</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
