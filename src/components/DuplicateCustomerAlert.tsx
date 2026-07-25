import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Phone, User2, ArrowRight } from "lucide-react";

import { findDuplicateCustomers } from "@/lib/customers.functions";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { fmt } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DuplicateMatch = {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
  company_name?: string | null;
  debt?: number | null;
  total_buy?: number | null;
  match_phone: boolean;
  match_name: boolean;
};

/**
 * useDuplicateCustomers — dò khách trùng THEO THỜI GIAN THỰC trong lúc gõ form.
 * Debounce 350ms để không bắn request mỗi phím; chỉ dò khi SĐT ≥ 8 chữ số
 * hoặc tên ≥ 2 ký tự (tránh kết quả rác lúc mới gõ 1 chữ).
 */
export function useDuplicateCustomers({
  name,
  phone,
  excludeId,
  enabled = true,
}: {
  name: string;
  phone: string;
  excludeId?: string;
  enabled?: boolean;
}) {
  const findFn = useServerFn(findDuplicateCustomers);
  const debouncedName = useDebouncedValue((name ?? "").trim(), 350);
  const debouncedPhone = useDebouncedValue((phone ?? "").trim(), 350);

  const active =
    enabled &&
    (debouncedPhone.replace(/\D/g, "").length >= 8 || debouncedName.length >= 2);

  const { data, isFetching } = useQuery({
    queryKey: ["customers", "duplicate", debouncedName, debouncedPhone, excludeId ?? ""],
    queryFn: () =>
      findFn({ data: { name: debouncedName, phone: debouncedPhone, excludeId } }),
    enabled: active,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  return {
    matches: (active ? ((data?.matches ?? []) as DuplicateMatch[]) : []),
    checking: active && isFetching,
  };
}

function matchReason(m: DuplicateMatch) {
  if (m.match_phone && m.match_name) return "Trùng cả tên và SĐT";
  if (m.match_phone) return "Trùng số điện thoại";
  return "Trùng tên";
}

function addressOf(m: DuplicateMatch) {
  return [m.address, m.ward, m.province].filter(Boolean).join(", ");
}

/**
 * DuplicateCustomerAlert — hộp cảnh báo vàng hiện ngay dưới ô Tên/SĐT.
 * `onPick` (nếu truyền) cho phép dùng luôn khách đã có thay vì tạo mới.
 */
export function DuplicateCustomerAlert({
  matches,
  checking,
  onPick,
  pickLabel = "Dùng khách này",
  className = "",
}: {
  matches: DuplicateMatch[];
  checking?: boolean;
  onPick?: (m: DuplicateMatch) => void;
  pickLabel?: string;
  className?: string;
}) {
  if (checking && matches.length === 0) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Đang kiểm tra khách hàng trùng...
      </div>
    );
  }

  if (matches.length === 0) return null;

  return (
    <div
      className={`rounded-xl border border-amber-300 bg-amber-50 p-3 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-900">
            Khách hàng này có thể đã có trong hệ thống
            {matches.length > 1 ? ` (${matches.length} kết quả)` : ""}
          </div>
          <div className="mt-0.5 text-xs text-amber-800">
            Kiểm tra lại trước khi tạo mới để tránh tách công nợ ra 2 bản ghi.
          </div>

          <div className="mt-2 space-y-1.5">
            {matches.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-background px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <User2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {m.name}
                    </span>
                    {m.phone && (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {m.phone}
                      </span>
                    )}
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {matchReason(m)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    {addressOf(m) && <span className="truncate">{addressOf(m)}</span>}
                    <span>Tổng bán: {fmt(Number(m.total_buy ?? 0))}</span>
                    <span
                      className={
                        Number(m.debt ?? 0) > 0 ? "font-medium text-destructive" : ""
                      }
                    >
                      Công nợ: {fmt(Number(m.debt ?? 0))}
                    </span>
                  </div>
                </div>

                {onPick && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-amber-300 text-xs text-amber-900 hover:bg-amber-100"
                    onClick={() => onPick(m)}
                  >
                    {pickLabel} <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * DuplicateConfirmDialog — chốt chặn cuối: bấm Lưu mà vẫn còn cảnh báo trùng
 * thì hỏi lại 1 lần. Xác nhận xong là vẫn tạo được (chỉ cảnh báo, không chặn).
 */
export function DuplicateConfirmDialog({
  open,
  onOpenChange,
  matches,
  onConfirm,
  saving,
  isEdit = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matches: DuplicateMatch[];
  onConfirm: () => void;
  saving?: boolean;
  isEdit?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <div className="rounded-lg bg-amber-100 p-1.5">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            Khách hàng đã tồn tại
          </DialogTitle>
          <DialogDescription>
            Hệ thống tìm thấy {matches.length} khách hàng trùng.{" "}
            {isEdit
              ? "Bạn vẫn muốn lưu thông tin này?"
              : "Bạn vẫn muốn tạo thêm một khách hàng mới?"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[280px] space-y-1.5 overflow-y-auto">
          {matches.map((m) => (
            <div key={m.id} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                {m.phone && (
                  <span className="font-mono text-xs text-muted-foreground">{m.phone}</span>
                )}
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  {matchReason(m)}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Tổng bán: {fmt(Number(m.total_buy ?? 0))} · Công nợ:{" "}
                {fmt(Number(m.debt ?? 0))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Để tôi kiểm tra lại
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Đang lưu...
              </>
            ) : isEdit ? (
              "Vẫn lưu thay đổi"
            ) : (
              "Vẫn tạo khách mới"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
