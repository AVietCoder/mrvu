// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getSalesByCustomer } from "@/lib/reports.functions";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateVN } from "@/lib/date-vn";
import { Download, Search, Users, Loader2, ChevronDown, ChevronUp } from "lucide-react";

const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + " đ";

/** Hiện tối đa bấy nhiêu mã đơn, còn lại gập lại để bảng không dài vô tận. */
const CODES_PREVIEW = 4;

/**
 * Đơn hàng bán theo khách trong khoảng thời gian.
 * Mỗi khách một dòng: STT, tên khách, khoảng thời gian mua trong kỳ, các đơn,
 * tổng tiền. Dùng chung bộ lọc ngày của trang Báo cáo (fromDate/toDate).
 */
export function SalesByCustomer({
  fromDate,
  toDate,
  enabled = true,
}: {
  fromDate: string;
  toDate: string;
  enabled?: boolean;
}) {
  const fn = useServerFn(getSalesByCustomer);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sales-by-customer", fromDate, toDate],
    queryFn: () => fn({ data: { date_from: fromDate, date_to: toDate } }),
    enabled,
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const all = (data?.rows ?? []) as any[];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    // Tìm theo tên, SĐT (bỏ dấu cách) hoặc mã khách.
    const qDigits = q.replace(/\s+/g, "");
    return all.filter(
      (r) =>
        String(r.customer_name ?? "").toLowerCase().includes(q) ||
        String(r.customer_code ?? "").toLowerCase().includes(q) ||
        (qDigits && String(r.phone ?? "").replace(/\s+/g, "").includes(qDigits)),
    );
  }, [data, search]);

  // Tổng theo đúng những dòng đang hiển thị (sau khi tìm kiếm).
  const shownTotal = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const shownOrders = rows.reduce((s, r) => s + Number(r.order_count || 0), 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function exportCsv() {
    // Bọc ô trong dấu ngoặc kép: tên khách/ghi chú hay có dấu phẩy, không bọc
    // thì cột trong Excel bị lệch.
    const cell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(cell(`Đơn hàng bán theo khách từ ${formatDateVN(fromDate)} đến ${formatDateVN(toDate)}`));
    lines.push("");
    lines.push(["STT", "Tên khách", "Mã khách", "SĐT", "Khoảng thời gian", "Số đơn", "Đơn hàng", "Tổng tiền", "Hàng trả"].map(cell).join(","));
    rows.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          r.customer_name,
          r.customer_code ?? "",
          r.phone ?? "",
          `${formatDateVN(r.first_date)} - ${formatDateVN(r.last_date)}`,
          r.order_count,
          r.orders.map((o: any) => o.code).join(" "),
          Math.round(r.total),
          Math.round(r.returned_total || 0),
        ].map(cell).join(","),
      );
    });
    lines.push(["", "TỔNG", "", "", "", shownOrders, "", Math.round(shownTotal), ""].map(cell).join(","));

    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `don-hang-theo-khach-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Đơn hàng bán theo khách
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateVN(fromDate)} – {formatDateVN(toDate)} · chỉ tính đơn đã hoàn tất, theo ngày hoàn tất
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="h-9 pl-8 w-56"
              placeholder="Tìm tên, SĐT, mã khách..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Tóm tắt */}
      {data && (
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          <span>
            <span className="text-muted-foreground">Khách: </span>
            <strong>{data.summary.customers}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Đơn: </span>
            <strong>{data.summary.orders}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Tổng tiền: </span>
            <strong>{moneyFmt(data.summary.total)}</strong>
          </span>
          {data.summary.returned_total > 0 && (
            <span className="text-orange-600">
              Hàng trả: -{moneyFmt(data.summary.returned_total)}
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-8 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="py-6 text-center text-sm">
          <div className="text-destructive mb-2">Không tải được: {String((error as any).message)}</div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Thử lại</Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3 w-12">STT</th>
                <th className="py-2 pr-3">Tên khách</th>
                <th className="py-2 pr-3">Khoảng thời gian</th>
                <th className="py-2 pr-3">Đơn hàng</th>
                <th className="py-2 text-right">Tổng tiền</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    {search ? "Không có khách nào khớp từ khoá." : "Không có đơn hoàn tất nào trong khoảng thời gian này."}
                  </td>
                </tr>
              )}
              {rows.map((r: any, i: number) => {
                const key = r.customer_id ?? "__walk_in__";
                const isOpen = expanded.has(key);
                const shown = isOpen ? r.orders : r.orders.slice(0, CODES_PREVIEW);
                const hidden = r.orders.length - shown.length;
                return (
                  <tr key={key} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3">
                      {r.customer_id ? (
                        <Link
                          to="/customers/$id"
                          params={{ id: r.customer_id }}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {r.customer_name}
                        </Link>
                      ) : (
                        <span className="font-medium italic">{r.customer_name}</span>
                      )}
                      {(r.customer_code || r.phone) && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {[r.customer_code, r.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {r.first_date === r.last_date
                        ? formatDateVN(r.first_date)
                        : `${formatDateVN(r.first_date)} – ${formatDateVN(r.last_date)}`}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="text-xs text-muted-foreground mb-1">{r.order_count} đơn</div>
                      <div className="flex flex-wrap gap-1">
                        {shown.map((o: any) => (
                          <Link
                            key={o.id}
                            to="/orders/$id"
                            params={{ id: o.id }}
                            title={`${formatDateVN(o.date)} · ${moneyFmt(o.total)}`}
                            className="font-mono text-xs rounded bg-muted px-1.5 py-0.5 hover:bg-primary hover:text-primary-foreground"
                          >
                            {o.code}
                          </Link>
                        ))}
                        {r.orders.length > CODES_PREVIEW && (
                          <button
                            className="text-xs text-primary inline-flex items-center"
                            onClick={() => toggle(key)}
                          >
                            {isOpen ? (
                              <>Thu gọn <ChevronUp className="h-3 w-3" /></>
                            ) : (
                              <>+{hidden} đơn <ChevronDown className="h-3 w-3" /></>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <div className="font-semibold">{moneyFmt(r.total)}</div>
                      {r.returned_total > 0 && (
                        <div className="text-xs text-orange-600">Trả hàng: -{moneyFmt(r.returned_total)}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2 pr-3" colSpan={3}>
                    Tổng {search ? "(theo kết quả tìm)" : ""}
                  </td>
                  <td className="py-2 pr-3">{shownOrders} đơn</td>
                  <td className="py-2 text-right">{moneyFmt(shownTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}
