// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getZaloAuthUrlFn,
  getZaloConfigFn,
  getZaloDashboardFn,
  getZaloStatusFn,
  listZaloTemplatesFn,
  getZaloTemplateInfoFn,
  saveZnsTemplateFn,
  listZnsTemplatesFn,
} from "@/lib/zalo.functions";
import { AppShell, Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle, Link2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/zalo/")({
  head: () => ({ meta: [{ title: "Zalo OA — Mr.Vũ" }] }),
  component: Page,
});

/** Các biến của đơn hàng mà app có thể điền vào template ZNS. */
const AVAILABLE_VARS = [
  { key: "order_code", label: "Mã đơn hàng", sample: "HD009274" },
  { key: "customer_name", label: "Tên khách hàng", sample: "Lê Lan Hương" },
  { key: "total_amount", label: "Tổng tiền", sample: "1.250.000" },
  { key: "paid_amount", label: "Khách đã trả", sample: "1.000.000" },
  { key: "debt_amount", label: "Còn nợ", sample: "250.000" },
  { key: "branch_name", label: "Chi nhánh", sample: "Mr.VU OFFICE" },
  { key: "order_date", label: "Ngày đặt", sample: "14/08/2026" },
];

function Page() {
  const authUrlFn = useServerFn(getZaloAuthUrlFn);
  const statusFn = useServerFn(getZaloStatusFn);
  const listZaloFn = useServerFn(listZaloTemplatesFn);
  const infoFn = useServerFn(getZaloTemplateInfoFn);
  const saveFn = useServerFn(saveZnsTemplateFn);
  const listSavedFn = useServerFn(listZnsTemplatesFn);
  const configFn = useServerFn(getZaloConfigFn);
  const qc = useQueryClient();

  const dashFn = useServerFn(getZaloDashboardFn);

  const { data: cfg } = useQuery({
    queryKey: ["zaloConfig"],
    queryFn: () => configFn(),
    retry: false,
  });
  const { data: dash } = useQuery({
    queryKey: ["zaloDashboard"],
    queryFn: () => dashFn(),
    retry: false,
    refetchInterval: 30_000,
  });

  const { data: status, isLoading } = useQuery({
    queryKey: ["zaloStatus"],
    queryFn: () => statusFn(),
    retry: false,
  });
  const { data: saved } = useQuery({
    queryKey: ["znsTemplates"],
    queryFn: () => listSavedFn(),
    retry: false,
  });

  const connected = status?.connected === true;

  // ── Nối OA ──────────────────────────────────────────────────────────────
  const [connecting, setConnecting] = useState(false);
  async function connect() {
    setConnecting(true);
    try {
      const { url, codeVerifier, state } = await authUrlFn();
      // Giữ tạm để bước /zalo/callback dùng lại. sessionStorage tự mất khi
      // đóng tab, đúng vòng đời của một lần cấp quyền.
      sessionStorage.setItem("zalo_pkce_verifier", codeVerifier);
      sessionStorage.setItem("zalo_oauth_state", state);
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message ?? "Không tạo được link cấp quyền");
      setConnecting(false);
    }
  }

  // ── Tra template ────────────────────────────────────────────────────────
  const [templateId, setTemplateId] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [paramMap, setParamMap] = useState<Record<string, string>>({});

  async function inspect() {
    if (!templateId.trim()) return toast.error("Nhập Template ID");
    setChecking(true);
    setInfo(null);
    try {
      const r = await infoFn({ data: { templateId: templateId.trim() } });
      setInfo(r);
      // Đoán sẵn ánh xạ khi tên biến trùng nhau, còn lại để trống cho người
      // dùng tự chọn — KHÔNG tự map bừa vì gửi sai nội dung là mất tiền thật.
      const guess: Record<string, string> = {};
      for (const p of r.listParams ?? []) {
        const hit = AVAILABLE_VARS.find((v) => v.key === p.name);
        if (hit) guess[p.name] = hit.key;
      }
      setParamMap(guess);
      toast.success(`Đọc được template: ${r.templateName}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Không đọc được template");
    } finally {
      setChecking(false);
    }
  }

  async function loadList() {
    try {
      const rows = await listZaloFn();
      if (!rows.length) return toast.info("OA chưa có template ZNS nào được duyệt");
      toast.success(`OA có ${rows.length} template. Xem console để lấy ID.`);
      console.table(rows);
    } catch (e: any) {
      toast.error(e?.message ?? "Không lấy được danh sách");
    }
  }

  async function save() {
    if (!info) return;
    const missing = (info.listParams ?? []).filter((p: any) => p.require && !paramMap[p.name]);
    if (missing.length) {
      return toast.error(
        `Còn biến bắt buộc chưa gán: ${missing.map((p: any) => p.name).join(", ")}`,
      );
    }
    try {
      await saveFn({
        data: {
          code: "order_completed",
          name: info.templateName || "Thông báo mua hàng thành công",
          zaloTemplateId: String(info.templateId || templateId.trim()),
          paramMap,
          isActive: true,
          listParams: info.listParams ?? [],
          templateTag: info.templateTag,
          price: info.price,
        },
      });
      toast.success("Đã lưu cấu hình template");
      qc.invalidateQueries({ queryKey: ["znsTemplates"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu");
    }
  }

  return (
    <AppShell title="Zalo OA — Chăm sóc khách hàng" loading={isLoading}>
      {/* ── Trạng thái kết nối ── */}
      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-medium mb-1 flex items-center gap-2">
              {connected ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Đã kết nối OA
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  Chưa kết nối
                </>
              )}
            </div>
            {connected ? (
              <div className="text-sm text-muted-foreground space-y-0.5">
                <div>OA: {status?.oa_name || status?.oa_id}</div>
                <div>
                  Token hết hạn:{" "}
                  {status?.token_expires_at
                    ? new Date(status.token_expires_at).toLocaleString("vi-VN")
                    : "—"}{" "}
                  <span className="text-xs">(tự động gia hạn)</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground max-w-xl">
                Bấm nối để cấp quyền cho app gửi tin thay mặt OA.
                {status?.last_error && (
                  <div className="mt-1 text-destructive">Lỗi lần trước: {status.last_error}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {connected && (
              <Button variant="outline" onClick={loadList}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Danh sách template
              </Button>
            )}
            <Button onClick={connect} disabled={connecting}>
              <Link2 className="h-4 w-4 mr-1" />
              {connected ? "Nối lại OA" : "Nối Zalo OA"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Cấu hình server đang dùng ── */}
      <Card className="mb-6">
        <div className="font-medium mb-1">Cấu hình server đang dùng</div>
        <div className="text-sm text-muted-foreground mb-3">
          Đây là giá trị <strong>server production</strong> thực sự gửi cho Zalo. Redirect URI dưới
          đây phải trùng <em>từng ký tự</em> với chỗ đăng ký trong app Zalo, và domain của nó phải
          nằm trong danh sách domain <strong>đã xác thực</strong>.
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-muted-foreground min-w-[110px]">Redirect URI:</span>
            <code className="bg-muted px-2 py-1 rounded break-all">{cfg?.redirectUri ?? "— chưa cấu hình —"}</code>
            {cfg?.redirectUri && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(cfg.redirectUri);
                  toast.success("Đã copy — dán vào ô Redirect URI bên Zalo");
                }}
              >
                Copy
              </Button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-muted-foreground min-w-[110px]">Domain:</span>
            <code className="bg-muted px-2 py-1 rounded">{cfg?.host ?? "—"}</code>
            <span className="text-xs text-muted-foreground">
              ← domain này phải được xác thực bên Zalo (bản có <code>www</code> và không{" "}
              <code>www</code> là hai domain khác nhau)
            </span>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-muted-foreground min-w-[110px]">App ID:</span>
            <code className="bg-muted px-2 py-1 rounded">{cfg?.appId ?? "—"}</code>
          </div>
        </div>

        {cfg && (
          <div className="mt-3 flex gap-3 flex-wrap text-xs">
            {[
              ["App Secret", cfg.hasAppSecret],
              ["Token Secret", cfg.hasTokenSecret],
              ["Service Role Key", cfg.hasServiceRole],
            ].map(([label, ok]) => (
              <span
                key={label as string}
                className={
                  ok
                    ? "text-green-700 bg-green-50 px-2 py-1 rounded"
                    : "text-destructive bg-destructive/10 px-2 py-1 rounded"
                }
              >
                {ok ? "✓" : "✗"} {label}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ── Cấu hình template ── */}
      <Card className="mb-6">
        <div className="font-medium mb-1">Mẫu tin "Mua hàng thành công"</div>
        <div className="text-sm text-muted-foreground mb-4">
          Dán Template ID mà Zalo đã duyệt, bấm Đọc template để app lấy đúng danh sách biến của
          mẫu tin đó, rồi gán mỗi biến với một trường của đơn hàng.
        </div>

        <div className="flex gap-2 items-end flex-wrap mb-4">
          <div className="flex-1 min-w-[240px]">
            <Label>Template ID</Label>
            <Input
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="VD: 123456"
            />
          </div>
          <Button onClick={inspect} disabled={checking || !connected}>
            <Search className="h-4 w-4 mr-1" />
            {checking ? "Đang đọc..." : "Đọc template"}
          </Button>
        </div>

        {!connected && (
          <div className="text-sm text-orange-600">Phải nối OA trước mới đọc được template.</div>
        )}

        {info && (
          <div className="border rounded-lg p-4 space-y-3">
            <div className="text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Tên mẫu: </span>
                <strong>{info.templateName}</strong>
                <span className="text-muted-foreground ml-3">Trạng thái: </span>
                <strong className={info.status === "ENABLE" ? "text-green-700" : "text-destructive"}>
                  {info.status}
                </strong>
              </div>
              <div className="flex gap-4 flex-wrap">
                {info.price && (
                  <span>
                    <span className="text-muted-foreground">Giá mỗi tin: </span>
                    <strong>{Number(info.price).toLocaleString("vi-VN")} đ</strong>
                  </span>
                )}
                {info.templateTag && (
                  <span>
                    <span className="text-muted-foreground">Loại tin: </span>
                    <strong>{info.templateTag}</strong>
                  </span>
                )}
                {info.previewUrl && (
                  <a
                    href={info.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Xem thử mẫu tin
                  </a>
                )}
              </div>
              {/* Tin PROMOTION (hậu mãi) đắt hơn và bị ràng buộc chặt hơn tin
                  giao dịch — nói rõ để không vỡ chi phí khi chạy thật. */}
              {info.templateTag === "PROMOTION" && (
                <div className="text-orange-600 text-xs">
                  Đây là mẫu <strong>tin hậu mãi (PROMOTION)</strong>, không phải tin giao dịch.
                  Giá cao hơn và Zalo giới hạn tần suất gửi chặt hơn.
                </div>
              )}
            </div>

            <div className="text-sm font-medium">Gán biến</div>
            <div className="space-y-2">
              {(info.listParams ?? []).map((p: any) => (
                <div key={p.name} className="flex items-center gap-3 flex-wrap">
                  <code className="text-xs bg-muted px-2 py-1 rounded min-w-[160px]">
                    {p.name}
                    {p.require && <span className="text-destructive ml-1">*</span>}
                  </code>
                  <span className="text-xs text-muted-foreground">←</span>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={paramMap[p.name] ?? ""}
                    onChange={(e) => setParamMap({ ...paramMap, [p.name]: e.target.value })}
                  >
                    <option value="">— chọn trường —</option>
                    {AVAILABLE_VARS.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label} ({v.sample})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <Button onClick={save}>Lưu cấu hình</Button>
          </div>
        )}
      </Card>

      {/* ── Hàng đợi + lịch sử gửi ── */}
      {dash && (
        <Card className="mb-6">
          <div className="font-medium mb-3">Hàng đợi gửi tin</div>
          <div className="flex gap-2 flex-wrap mb-4 text-sm">
            {[
              ["Chờ gửi", dash.queue.pending, "bg-blue-50 text-blue-700"],
              ["Đang gửi", dash.queue.sending, "bg-yellow-50 text-yellow-700"],
              ["Thử lại", dash.queue.retrying, "bg-orange-50 text-orange-700"],
              ["Đã gửi", dash.queue.sent, "bg-green-50 text-green-700"],
              ["Thất bại", dash.queue.failed, "bg-destructive/10 text-destructive"],
            ].map(([label, n, cls]) => (
              <span key={label as string} className={`px-3 py-1.5 rounded ${cls}`}>
                {label}: <strong>{n as number}</strong>
              </span>
            ))}
          </div>

          <div className="font-medium mb-2">50 tin gần nhất</div>
          {dash.logs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Chưa gửi tin nào. Tin sẽ tự vào hàng đợi khi có đơn chuyển sang hoàn tất.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Thời điểm</th>
                    <th className="py-2 pr-3">Đơn</th>
                    <th className="py-2 pr-3">SĐT</th>
                    <th className="py-2 pr-3">Trạng thái</th>
                    <th className="py-2">Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.logs.map((l: any) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(l.sent_at || l.created_at).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.order_code ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.recipient_phone}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            l.status === "SENT"
                              ? "text-green-700 bg-green-50 px-2 py-0.5 rounded text-xs"
                              : "text-destructive bg-destructive/10 px-2 py-0.5 rounded text-xs"
                          }
                        >
                          {l.status === "SENT" ? "Đã gửi" : "Thất bại"}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {l.error_message ? `${l.error_code}: ${l.error_message}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Đã cấu hình ── */}
      {saved && saved.length > 0 && (
        <Card>
          <div className="font-medium mb-3">Template đã cấu hình</div>
          <div className="space-y-2 text-sm">
            {saved.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {t.code} → Zalo ID {t.zalo_template_id}
                  </div>
                </div>
                <span
                  className={
                    t.is_active
                      ? "text-xs text-green-700 bg-green-50 px-2 py-1 rounded"
                      : "text-xs text-muted-foreground bg-muted px-2 py-1 rounded"
                  }
                >
                  {t.is_active ? "Đang bật" : "Tắt"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </AppShell>
  );
}
