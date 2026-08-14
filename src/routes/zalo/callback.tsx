// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { connectZaloOaFn } from "@/lib/zalo.functions";
import { AppShell, Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Zalo chuyển hướng về đây sau khi người dùng bấm đồng ý cấp quyền.
 * URL có dạng: /zalo/callback?code=...&state=...&oa_id=...
 *
 * ⚠️ Đường dẫn này phải TRÙNG TUYỆT ĐỐI với Redirect URI khai trong app Zalo
 * và với ZALO_REDIRECT_URI trong .env, sai một dấu / là Zalo từ chối.
 */
export const Route = createFileRoute("/zalo/callback")({
  head: () => ({ meta: [{ title: "Đang nối Zalo OA..." }] }),
  component: Page,
});

function Page() {
  const connect = useServerFn(connectZaloOaFn);
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Đang trao đổi mã cấp quyền với Zalo...");
  // React StrictMode gọi effect 2 lần ở dev. Authorization code chỉ dùng được
  // MỘT lần — chạy lại sẽ nhận lỗi "code đã dùng" gây hiểu nhầm là hỏng.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const oaId = params.get("oa_id") || undefined;

    const verifier = sessionStorage.getItem("zalo_pkce_verifier");
    const savedState = sessionStorage.getItem("zalo_oauth_state");

    if (!code) {
      setState("error");
      setMessage(
        params.get("error_description") ||
          params.get("error") ||
          "Zalo không trả về mã cấp quyền. Có thể bạn đã bấm Từ chối.",
      );
      return;
    }
    if (!verifier) {
      setState("error");
      setMessage(
        "Không tìm thấy mã xác thực tạm trong trình duyệt. Hãy bấm 'Nối Zalo OA' lại từ đầu, " +
          "và đừng đóng tab giữa chừng.",
      );
      return;
    }
    if (savedState && returnedState && savedState !== returnedState) {
      setState("error");
      setMessage("State không khớp — nghi ngờ request giả mạo. Đã dừng để an toàn.");
      return;
    }

    connect({ data: { code, codeVerifier: verifier, oaId } })
      .then((r) => {
        sessionStorage.removeItem("zalo_pkce_verifier");
        sessionStorage.removeItem("zalo_oauth_state");
        setState("ok");
        setMessage(r.reconnected ? "Đã nối lại OA thành công." : "Đã nối OA thành công.");
      })
      .catch((e: any) => {
        setState("error");
        setMessage(e?.message ?? "Nối OA thất bại");
      });
  }, [connect]);

  return (
    <AppShell title="Kết nối Zalo OA">
      <Card>
        <div className="flex items-start gap-3">
          {state === "working" && <Loader2 className="h-5 w-5 animate-spin mt-0.5" />}
          {state === "ok" && <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />}
          {state === "error" && <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />}
          <div className="flex-1">
            <div className="font-medium mb-1">
              {state === "working" && "Đang xử lý"}
              {state === "ok" && "Thành công"}
              {state === "error" && "Không nối được"}
            </div>
            <div className="text-sm text-muted-foreground">{message}</div>
            {state !== "working" && (
              <Button className="mt-4" onClick={() => navigate({ to: "/zalo" })}>
                Về trang cài đặt Zalo
              </Button>
            )}
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
