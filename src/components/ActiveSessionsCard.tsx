// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Laptop, LogOut, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import { Card } from "@/components/AppShell";
import { listSessionsFn, revokeSessionFn } from "@/lib/team.functions";

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
const DeviceIcon = ({ kind }: { kind: string }) =>
  kind === "mobile" ? <Smartphone className="h-4 w-4" /> : kind === "tablet" ? <Tablet className="h-4 w-4" /> : <Laptop className="h-4 w-4" />;

/**
 * Admin: tài khoản đang đăng nhập + thiết bị (migration v26, bảng user_sessions).
 * "Đang online" = có hoạt động trong vài phút gần nhất. Đăng xuất từ xa: thiết bị kia
 * bị thoát ở nhịp kế tiếp (tối đa ~2 phút, hoặc ngay khi mở lại tab).
 */
export function ActiveSessionsCard({ userId }: { userId: string }) {
  const fn = useServerFn(listSessionsFn);
  const revokeFn = useServerFn(revokeSessionFn);
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["activeSessions", userId],
    queryFn: () => fn({ data: { actorId: userId } }),
    refetchInterval: 60_000,
  });
  if (!data) return null;
  if (data.migrated === false) {
    return (
      <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
        Chưa chạy <strong>sql_migration_v26.sql</strong> — chưa xem được tài khoản đang đăng nhập / thiết bị.
      </Card>
    );
  }
  const users = (data.users ?? []) as any[];
  const online = users.filter((u) => u.online);
  const list = showAll ? users : online;

  async function revoke(d: any, name: string) {
    if (!window.confirm(`Đăng xuất ${name} trên ${d.browser} · ${d.os}?`)) return;
    setBusy(d.token_hash);
    try {
      await revokeFn({ data: { actorId: userId, tokenHash: d.token_hash } });
      toast.success("Đã đăng xuất thiết bị");
      qc.invalidateQueries({ queryKey: ["activeSessions"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Không đăng xuất được");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-700"><MonitorSmartphone className="h-5 w-5" /></div>
        <div className="mr-auto">
          <div className="font-semibold">Tài khoản đang đăng nhập</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-emerald-600">{online.length} đang online</span> (hoạt động ≤ {data.onlineMinutes} phút) · {users.length} tài khoản còn phiên đăng nhập
          </div>
        </div>
        <div className="flex rounded-md border p-0.5 text-xs">
          <button className={`rounded px-2.5 py-1 ${!showAll ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} onClick={() => setShowAll(false)}>Đang online</button>
          <button className={`rounded px-2.5 py-1 ${showAll ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} onClick={() => setShowAll(true)}>Tất cả phiên</button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">{showAll ? "Chưa có phiên nào được ghi." : "Không có ai online lúc này."}</div>
      ) : (
        <div className="divide-y">
          {list.map((u) => (
            <div key={u.user_id}>
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40" onClick={() => setOpen(open === u.user_id ? null : u.user_id)}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${u.online ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{u.full_name}{u.is_admin && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Admin</span>}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {u.devices.length} thiết bị · {u.online ? "đang online" : `hoạt động ${ago(u.last_seen_at)}`}
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open === u.user_id ? "rotate-180" : ""}`} />
              </button>
              {open === u.user_id && (
                <div className="space-y-1.5 bg-muted/30 px-4 py-2.5">
                  {u.devices.map((d: any) => (
                    <div key={d.token_hash} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm">
                      <span className="text-muted-foreground"><DeviceIcon kind={d.kind} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{d.browser} · {d.os}{d.online && <span className="ml-1.5 text-xs font-semibold text-emerald-600">● online</span>}</div>
                        <div className="text-xs text-muted-foreground">
                          IP {d.ip || "—"} · đăng nhập {new Date(d.created_at).toLocaleString("vi-VN")} · hoạt động {ago(d.last_seen_at)}
                        </div>
                      </div>
                      {d.token_hash !== undefined && (
                        <button
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          disabled={busy === d.token_hash}
                          onClick={() => revoke(d, u.full_name)}
                        >
                          <LogOut className="h-3.5 w-3.5" />Đăng xuất thiết bị này
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
