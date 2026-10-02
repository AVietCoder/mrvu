// @ts-nocheck
import { formatBirthday, hasRealBirthYear } from "@/components/BirthdayDayMonth";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCareListFn, sendCareZaloFn, sendCareEmailFn } from "@/lib/care.functions";
import { AppShell, Card, StatCard } from "@/components/AppShell";
import { CustomerName } from "@/components/CustomerName";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { hasPermission } from "@/lib/types";
import { todayVN, formatDateVN } from "@/lib/date-vn";
import {
  Cake,
  Wrench,
  MessageCircle,
  Mail,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/care")({
  head: () => ({ meta: [{ title: "Chăm sóc khách hàng — Mr.Vũ" }] }),
  component: Page,
});

type Kind = "birthday" | "maintenance";

function Page() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const listFn = useServerFn(getCareListFn);
  const zaloFn = useServerFn(sendCareZaloFn);
  const emailFn = useServerFn(sendCareEmailFn);

  const [kind, setKind] = useState<Kind>("maintenance");
  const [date, setDate] = useState(todayVN());
  const [windowDays, setWindowDays] = useState(0);

  // Ai cũng XEM được; chỉ người có quyền mới BẤM GỬI được.
  const canSend = Boolean(user && (isAdmin || hasPermission(user as any, "customer_care")));

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["care", kind, date, windowDays],
    queryFn: () => listFn({ data: { kind, date, windowDays } }),
    retry: false,
  });

  const rows = data?.rows ?? [];
  const meta = data?.meta;

  // ── Chọn/bỏ chọn ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Đổi tab/ngày → danh sách khác hẳn, giữ lại lựa chọn cũ là gửi nhầm người.
  useEffect(() => setSelected(new Set()), [kind, date, windowDays]);

  const zaloable = useMemo(() => rows.filter((r: any) => r.can_zalo), [rows]);
  const emailable = useMemo(() => rows.filter((r: any) => r.can_email), [rows]);

  const selectedZalo = useMemo(
    () => zaloable.filter((r: any) => selected.has(r.customer_id)).map((r: any) => r.customer_id),
    [zaloable, selected],
  );
  const selectedEmail = useMemo(
    () => emailable.filter((r: any) => selected.has(r.customer_id)).map((r: any) => r.customer_id),
    [emailable, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Chọn tất cả chỉ tick những dòng THỰC SỰ gửi được, khỏi tạo kỳ vọng sai. */
  function toggleAll() {
    const usable = rows.filter((r: any) => r.can_zalo || r.can_email).map((r: any) => r.customer_id);
    setSelected((prev) => (prev.size >= usable.length ? new Set() : new Set(usable)));
  }

  // ── Gửi ─────────────────────────────────────────────────────────────────
  const [sending, setSending] = useState<null | "zalo" | "email">(null);
  const [results, setResults] = useState<any[] | null>(null);
  // Khoá đồng bộ: state React cập nhật bất đồng bộ nên hai cú click sát nhau
  // vẫn lọt qua `disabled`. Backstop thật vẫn là idempotency_key ở DB.
  const busy = useRef(false);

  async function doSend(channel: "zalo" | "email") {
    if (busy.current) return;
    const ids = channel === "zalo" ? selectedZalo : selectedEmail;
    if (!ids.length) return toast.error("Chưa chọn khách nào gửi được");

    if (channel === "zalo") {
      const price = meta?.unitPrice ?? 0;
      const cost = price > 0 ? ` (ước tính ${(ids.length * price).toLocaleString("vi-VN")}đ)` : "";
      if (
        !window.confirm(
          `Gửi Zalo cho ${ids.length} khách${cost}?\n\n` +
            `Tin đã gửi không thu hồi được và bị tính phí.`,
        )
      )
        return;
    } else if (!window.confirm(`Gửi email cho ${ids.length} khách?`)) {
      return;
    }

    busy.current = true;
    setSending(channel);
    setResults(null);
    try {
      const fn = channel === "zalo" ? zaloFn : emailFn;
      const r = await fn({ data: { kind, date, windowDays, customerIds: ids, actorId: user?.id } });
      setResults(r.results);
      const ok = r.results.filter((x: any) => x.ok).length;
      const fail = r.results.length - ok;
      if (ok && !fail) toast.success(`Xong: ${ok}/${r.results.length} khách`);
      else if (ok) toast.warning(`Một phần: ${ok} thành công, ${fail} không gửi được`);
      else toast.error("Không gửi được khách nào — xem lý do bên dưới");
      qc.invalidateQueries({ queryKey: ["care"] });
      qc.invalidateQueries({ queryKey: ["zaloDashboard"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi gửi");
    } finally {
      busy.current = false;
      setSending(null);
    }
  }

  const isBirthday = kind === "birthday";

  return (
    <AppShell title="Chăm sóc khách hàng" loading={isLoading}>
      {/* ── Cảnh báo ── */}
      {meta?.testMode && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          <strong>Chế độ chạy thử đang BẬT.</strong> Tin Zalo sẽ bị chặn và chỉ{" "}
          {meta.testPhonesCount} số thử nghiệm nhận được. Tắt trong trang Zalo OA khi muốn gửi thật.
        </div>
      )}
      {meta?.zaloBlockReason && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <strong>Chưa gửi Zalo được:</strong> {meta.zaloBlockReason}
        </div>
      )}
      {meta && !meta.emailReady && (
        <div className="mb-4 rounded-lg border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
          Chưa cấu hình <code>RESEND_API_KEY</code> trên máy chủ → nút gửi Email bị tắt.
        </div>
      )}

      {/* ── Chỉ số ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 mb-6">
        <StatCard
          label={isBirthday ? "Khách sinh nhật" : "Khách đến hạn bảo dưỡng"}
          value={String(rows.length)}
          sub={formatDateVN(date)}
        />
        <StatCard
          label="Gửi Zalo được"
          value={String(zaloable.length)}
          sub={`${rows.length - zaloable.length} thiếu SĐT hợp lệ`}
        />
        <StatCard
          label="Gửi Email được"
          value={String(emailable.length)}
          sub={`${rows.length - emailable.length} chưa có email`}
        />
      </div>

      {/* ── Bộ lọc ── */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-4 py-2 text-sm flex items-center gap-1.5 ${
                kind === "maintenance" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
              onClick={() => setKind("maintenance")}
            >
              <Wrench className="h-4 w-4" /> Bảo dưỡng
            </button>
            <button
              className={`px-4 py-2 text-sm flex items-center gap-1.5 ${
                kind === "birthday" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
              onClick={() => setKind("birthday")}
            >
              <Cake className="h-4 w-4" /> Sinh nhật
            </button>
          </div>

          <div>
            <Label className="text-xs">Ngày</Label>
            <Input
              type="date"
              className="mt-1 h-9"
              value={date}
              onChange={(e) => setDate(e.target.value || todayVN())}
            />
          </div>

          {!isBirthday && (
            <div>
              <Label className="text-xs">Quét bù (ngày)</Label>
              <Input
                type="number"
                min={0}
                max={30}
                className="mt-1 h-9 w-28"
                value={windowDays}
                onChange={(e) => setWindowDays(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
              />
            </div>
          )}

          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Tải lại
          </Button>
        </div>

        {!isBirthday && (
          <div className="text-xs text-muted-foreground mt-3">
            Hạn bảo dưỡng = <strong>ngày xuất kho + 6 tháng</strong> (ngày xuất kho là lúc đơn
            chuyển sang Hoàn tất, cũng chính là lúc hệ thống trừ kho). Quét bù giúp nhặt lại những
            ngày không ai mở trang — để 0 nghĩa là chỉ lấy đúng hôm nay.
          </div>
        )}
      </Card>

      {/* ── Lỗi ── */}
      {error && (
        <Card className="mb-6 border-destructive/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <div className="font-medium mb-1">Không tải được danh sách</div>
              <div className="text-sm text-muted-foreground mb-3">{String((error as any).message)}</div>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Thử lại
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Danh sách khách ── */}
      {!error && (
        <Card className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div className="font-medium">
              {isBirthday ? "Khách hàng sinh nhật hôm nay" : "Khách đến hạn bảo dưỡng"}
              <span className="text-muted-foreground font-normal"> ({rows.length})</span>
            </div>
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={toggleAll}>
                {selected.size > 0 ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {isBirthday
                ? "Hôm nay không có khách hàng nào sinh nhật."
                : "Không có đơn nào đến hạn bảo dưỡng trong ngày đã chọn."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 w-8"></th>
                    <th className="py-2 pr-3">Khách hàng</th>
                    <th className="py-2 pr-3">SĐT</th>
                    <th className="py-2 pr-3">Email</th>
                    {isBirthday ? (
                      <th className="py-2 pr-3">Ngày sinh</th>
                    ) : (
                      <>
                        <th className="py-2 pr-3">Sản phẩm</th>
                        <th className="py-2 pr-3">NV tạo đơn</th>
                        <th className="py-2 pr-3">Xuất kho</th>
                        <th className="py-2 pr-3">Đến hạn</th>
                      </>
                    )}
                    <th className="py-2">Đã gửi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const usable = r.can_zalo || r.can_email;
                    return (
                      <tr key={r.customer_id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={selected.has(r.customer_id)}
                            disabled={!usable}
                            onChange={() => toggle(r.customer_id)}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <CustomerName name={r.customer_name} company={r.customer_company} fallback="—" className="font-medium" />
                          {r.customer_code && (
                            <div className="text-xs text-muted-foreground font-mono">{r.customer_code}</div>
                          )}
                          {!usable && (
                            <div className="text-xs text-destructive">{r.blocked_reason}</div>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {r.phone || "—"}
                          {r.phone && !r.can_zalo && (
                            <div className="text-destructive">không hợp lệ</div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs">{r.email || "—"}</td>
                        {isBirthday ? (
                          <td className="py-2 pr-3">
                            {formatBirthday(r.birthday)}
                            {r.age != null && hasRealBirthYear(r.birthday) && (
                              <span className="text-muted-foreground"> ({r.age} tuổi)</span>
                            )}
                          </td>
                        ) : (
                          <>
                            <td className="py-2 pr-3">
                              <span title={(r.product_names ?? []).join(", ")}>
                                {(r.product_names ?? []).length <= 2
                                  ? (r.product_names ?? []).join(", ") || "—"
                                  : `${r.product_names[0]} +${r.product_names.length - 1} SP`}
                              </span>
                              {r.order_count > 1 && (
                                <div className="text-xs text-muted-foreground">
                                  {r.order_count} đơn cùng đến hạn
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-sm">{(r.staff_names ?? []).join(", ") || "—"}</td>
                            <td className="py-2 pr-3 text-xs">
                              {r.last_shipped_at
                                ? formatDateVN(String(r.last_shipped_at).slice(0, 10))
                                : "—"}
                            </td>
                            <td className="py-2 pr-3 text-xs">{formatDateVN(r.first_due_date)}</td>
                          </>
                        )}
                        <td className="py-2 text-xs text-muted-foreground">
                          {r.last_sent_at
                            ? new Date(r.last_sent_at).toLocaleDateString("vi-VN")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Thanh hành động ── */}
          {rows.length > 0 && (
            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3">
              <div className="text-sm text-muted-foreground flex-1 min-w-[180px]">
                Đã chọn <strong>{selected.size}</strong> khách
                {meta?.unitPrice ? (
                  <> — ước tính {(selectedZalo.length * meta.unitPrice).toLocaleString("vi-VN")}đ nếu gửi Zalo</>
                ) : null}
              </div>
              <Button
                onClick={() => doSend("zalo")}
                disabled={
                  !canSend || !!meta?.zaloBlockReason || sending !== null || selectedZalo.length === 0
                }
                title={
                  !canSend
                    ? 'Bạn không có quyền "Gửi tin chăm sóc KH"'
                    : meta?.zaloBlockReason || undefined
                }
              >
                <MessageCircle className="h-4 w-4 mr-1" />
                {sending === "zalo" ? "Đang gửi..." : `Gửi Zalo (${selectedZalo.length})`}
              </Button>
              <Button
                variant="outline"
                onClick={() => doSend("email")}
                disabled={
                  !canSend || !meta?.emailReady || sending !== null || selectedEmail.length === 0
                }
                title={!canSend ? 'Bạn không có quyền "Gửi tin chăm sóc KH"' : undefined}
              >
                <Mail className="h-4 w-4 mr-1" />
                {sending === "email" ? "Đang gửi..." : `Gửi Email (${selectedEmail.length})`}
              </Button>
            </div>
          )}

          {!canSend && rows.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Bạn xem được danh sách nhưng chưa có quyền gửi. Nhờ quản trị viên cấp quyền
              <strong> "Gửi tin chăm sóc KH"</strong> trong trang Nhân viên.
            </div>
          )}
        </Card>
      )}

      {/* ── Kết quả gửi ── */}
      {results && (
        <Card className="mb-6">
          <div className="font-medium mb-3">Kết quả gửi</div>
          <div className="space-y-1.5 text-sm">
            {results.map((r: any) => (
              <div key={r.customerId} className="flex items-start gap-2 border-b last:border-0 pb-1.5">
                {r.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <span className="font-medium">{r.name}</span>
                  {!r.ok && <span className="text-muted-foreground"> — {r.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Sinh nhật nhân viên: CHỈ hiển thị, không gửi tin ── */}
      {isBirthday && (
        <Card>
          <div className="font-medium mb-1 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Nhân viên sinh nhật hôm nay
            <span className="text-muted-foreground font-normal">
              ({(data?.employees ?? []).length})
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            Chỉ để quản lý nắm thông tin — hệ thống không gửi Zalo cho nhân viên.
          </div>
          {(data?.employees ?? []).length === 0 ? (
            <div className="py-4 text-center text-muted-foreground text-sm">
              Hôm nay không có nhân viên nào sinh nhật.
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.employees ?? []).map((e: any) => (
                <div
                  key={e.user_id}
                  className="flex items-center justify-between border-b last:border-0 pb-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{e.full_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {e.username}
                      {e.phone ? ` · ${e.phone}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateVN(e.birthday)}
                    {e.age != null && ` (${e.age} tuổi)`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </AppShell>
  );
}
