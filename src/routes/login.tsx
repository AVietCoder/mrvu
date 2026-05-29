// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loginFn, getFormOptionsFn } from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Fan, Eye, EyeOff, ArrowLeft, KeyRound, Building2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Đăng nhập — Mr.Vũ" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { login, setActiveBranchId } = useAuth();
  const navigate = useNavigate();
  const doLogin = useServerFn(loginFn);
  const getOptions = useServerFn(getFormOptionsFn);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Quên mật khẩu
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");

  // ── Chọn chi nhánh sau đăng nhập ──────────────────────────────────────
  const [branchPickMode, setBranchPickMode] = useState(false);
  const [branchOptions, setBranchOptions] = useState<{ id: string; name: string }[]>([]);
  const [pendingSession, setPendingSession] = useState<any>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return toast.error("Vui lòng nhập đủ thông tin");
    setLoading(true);
    try {
      const session = await doLogin({ data: { username, password } });

      // Nếu user có ≥2 chi nhánh → hiện màn hình chọn chi nhánh mặc định
      if (!session.user.is_admin && session.user.branch_ids.length >= 2) {
        // Lấy tên chi nhánh từ server
        const opts = await getOptions();
        const userBranches = (opts.branches as any[]).filter((b) =>
          session.user.branch_ids.includes(b.id)
        );
        setPendingSession(session);
        setBranchOptions(userBranches);
        setBranchPickMode(true);
      } else {
        // Admin hoặc 0-1 CN → đăng nhập thẳng
        login(session);
        toast.success("Đăng nhập thành công!");
        navigate({ to: session.user.is_admin ? "/admin" : "/" });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  function handlePickBranch(branchId: string) {
    if (!pendingSession) return;
    login(pendingSession);
    setActiveBranchId(branchId);
    toast.success("Đăng nhập thành công!");
    navigate({ to: "/" });
  }

  function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotUsername.trim()) return toast.error("Vui lòng nhập tên đăng nhập");
    toast.info(
      `Vui lòng liên hệ quản trị viên để đặt lại mật khẩu cho tài khoản "${forgotUsername}".`,
      { duration: 6000 }
    );
    setForgotMode(false);
    setForgotUsername("");
  }

  // ── Màn hình chọn chi nhánh ────────────────────────────────────────────
  if (branchPickMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mb-3">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Chọn chi nhánh</h1>
            <p className="text-sm text-muted-foreground mt-1 text-center">
              Chọn chi nhánh làm việc mặc định khi đăng nhập
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-3">
            {branchOptions.map((b) => (
              <button
                key={b.id}
                onClick={() => handlePickBranch(b.id)}
                className="w-full flex items-center gap-3 rounded-xl border bg-background hover:bg-primary/5 hover:border-primary/40 transition-colors px-4 py-3.5 text-left group"
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <span className="font-medium flex-1">{b.name}</span>
                <CheckCircle2 className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}

            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mt-2 mx-auto"
              onClick={() => { setBranchPickMode(false); setPendingSession(null); }}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Đăng nhập lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Màn hình quên mật khẩu ─────────────────────────────────────────────
  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mb-3">
              <KeyRound className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Quên mật khẩu</h1>
            <p className="text-sm text-muted-foreground mt-1 text-center">
              Nhập username để yêu cầu đặt lại mật khẩu
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-8 shadow-sm">
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <Label htmlFor="forgot-username">Tên đăng nhập</Label>
                <Input
                  id="forgot-username"
                  placeholder="Nhập username của bạn..."
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(e.target.value)}
                  className="mt-1"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleForgot(e as any); }}
                />
              </div>

              <div className="rounded-lg bg-muted/50 border p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Hướng dẫn</p>
                <p>Vì lý do bảo mật, mật khẩu cần được đặt lại bởi quản trị viên hệ thống. Sau khi gửi yêu cầu, hãy liên hệ admin để được cấp mật khẩu mới.</p>
              </div>

              <Button type="submit" className="w-full">
                Gửi yêu cầu đặt lại mật khẩu
              </Button>
            </form>

            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mt-4 mx-auto"
              onClick={() => setForgotMode(false)}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Quay lại đăng nhập
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Màn hình đăng nhập chính ────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mb-3">
            <Fan className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Mr.Vũ</h1>
          <p className="text-sm text-muted-foreground mt-1">Đăng nhập để tiếp tục</p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username">Tên đăng nhập</Label>
              <Input
                id="username"
                placeholder="Nhập username..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Mật khẩu</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setForgotMode(true)}
                >
                  Quên mật khẩu?
                </button>
              </div>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  placeholder="Nhập mật khẩu..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPw(!showPw)}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-4">
            Chưa có tài khoản?{" "}
            <Link to="/register" className="text-primary hover:underline font-medium">
              Đăng ký
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
