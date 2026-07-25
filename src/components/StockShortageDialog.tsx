import { Link } from "@tanstack/react-router";
import { Boxes, PackageX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type StockShortage = {
  product_name: string;
  sku?: string | null;
  needed: number;
  available: number;
};

/**
 * StockShortageDialog — thay cho toast đỏ 1 dòng khó đọc trước đây
 * ("Không đủ hàng để hoàn tất: Quạt A: cần 5, còn 2 | Quạt B: ...").
 *
 * Hiện bảng rõ ràng từng sản phẩm: Cần / Còn / Thiếu, kèm lối tắt sang trang
 * Tồn kho để nhập thêm hoặc chuyển kho.
 */
export function StockShortageDialog({
  open,
  onOpenChange,
  shortages,
  branchName,
  orderCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shortages: StockShortage[];
  branchName?: string;
  orderCode?: string;
}) {
  const totalMissing = shortages.reduce(
    (s, x) => s + Math.max(0, x.needed - x.available),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-destructive/20 bg-destructive/5 px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-destructive">
            <div className="rounded-xl bg-destructive/10 p-2">
              <PackageX className="h-5 w-5" />
            </div>
            Không đủ hàng để hoàn tất đơn
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            Cần bổ sung <strong className="text-destructive">{totalMissing}</strong> sản
            phẩm ({shortages.length} mặt hàng)
            {branchName ? ` tại ${branchName}` : ""}
            {orderCode ? ` để xuất đơn ${orderCode}` : ""}. Hãy nhập thêm hàng, chuyển
            kho, hoặc giảm số lượng trên đơn.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] overflow-y-auto px-6 py-4">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2 text-right font-medium">Cần</th>
                  <th className="px-3 py-2 text-right font-medium">Còn</th>
                  <th className="px-3 py-2 text-right font-medium">Thiếu</th>
                </tr>
              </thead>
              <tbody>
                {shortages.map((s, i) => {
                  const missing = Math.max(0, s.needed - s.available);
                  return (
                    <tr key={`${s.product_name}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{s.product_name}</div>
                        {s.sku && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            SKU: {s.sku}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{s.needed}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {s.available}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-block rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
                          -{missing}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 border-t bg-muted/20 px-6 py-4 sm:flex-row">
          <Link to="/inventory" className="w-full sm:w-auto">
            <Button type="button" variant="outline" className="w-full">
              <Boxes className="mr-1.5 h-4 w-4" /> Xem tồn kho
            </Button>
          </Link>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Đã hiểu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
