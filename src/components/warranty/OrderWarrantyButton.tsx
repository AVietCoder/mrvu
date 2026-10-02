// @ts-nocheck
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ticketPrefillFromOrderFn } from "@/lib/warranty.functions";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import { TicketForm } from "./TicketForm";
import { StageBadge } from "./shared";

/**
 * Ở trang chi tiết đơn: nút "Tạo phiếu bảo hành" điền sẵn từ đơn (khách, ghi chú
 * tình trạng, lịch kỹ thuật) và gắn đơn làm "đơn bán linh kiện". Đơn đã có phiếu
 * thì hiện mã phiếu để mở. Đơn ngoài chi nhánh được gán / chưa chạy v23 → ẩn.
 */
export function OrderWarrantyButton({ orderId }: { orderId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fn = useServerFn(ticketPrefillFromOrderFn);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["warranty", "orderPrefill", orderId],
    queryFn: () => fn({ data: { actorId: user?.id, orderId } }),
    enabled: Boolean(user?.id && orderId),
    retry: false,
  });
  if (!data?.allowed || !data.migrated || !data.prefill) return null;
  const { kind, order_code, ...initial } = data.prefill;
  return (
    <>
      {(data.tickets ?? []).map((t: any) => (
        <Link
          key={t.id}
          to="/warranty"
          search={{ ...(t.kind === "dealer" ? { tab: "dealer" } : {}), ticket: t.id } as any}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
          title="Mở phiếu bảo hành"
        >
          <Wrench className="h-4 w-4" />
          <span className="font-mono text-xs font-semibold">{t.code}</span>
          <StageBadge stage={t.stage} />
        </Link>
      ))}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Wrench className="h-4 w-4 mr-1" /> {(data.tickets ?? []).length ? "Thêm phiếu bảo hành" : "Tạo phiếu bảo hành"}
      </Button>
      <TicketForm
        open={open}
        kind={kind}
        ticket={null}
        initial={initial}
        fromOrderCode={order_code}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          qc.invalidateQueries({ queryKey: ["warranty", "orderPrefill", orderId] });
        }}
      />
    </>
  );
}
