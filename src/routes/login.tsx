// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loginFn } from "@/lib/auth.functions";
import { getSettings } from "@/lib/settings.functions";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const doLogin = useServerFn(loginFn);
  const getSettingsFn = useServerFn(getSettings);

  const [settings, setSettings] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");

  useEffect(() => {
    getSettingsFn().then(setSettings);
  }, []);

  const brandName = settings?.site_name?.trim() || "Mr.Vũ";
  const logoUrl = settings?.logo_url || "";
  const primaryColor = settings?.primary_color || "#3b82f6";

  useEffect(() => {
    document.title = forgotMode 
      ? `Quên mật khẩu — ${brandName}` 
      : `Đăng nhập — ${brandName}`;
  }, [brandName, forgotMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      return toast.error("Vui lòng nhập tên đăng nhập và mật khẩu");
    }

    setLoading(true);
    try {
      const session = await doLogin({ data: { username, password } });
      login(session);
      toast.success("Đăng nhập thành công!");
      if (session.user.is_admin) {
        navigate({ to: "/admin" });
      } else {
        navigate({ to: "/" });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4" style={{ '--primary': primaryColor } as any}>
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            {logoUrl ? (
              <img src={logoUrl} alt={brandName} className="h-16 w-auto mb-4" />
            ) : (
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <span className="text-3xl">🔑</span>
              </div>
            )}
            <h1 className="text-2xl font-bold">{brandName}</h1>
            <p className="text-muted-foreground mt-1">Quên mật khẩu</p>
          </div>

          <div className="rounded-2xl border bg-card p-8 shadow">
            <form onSubmit={(e) => { e.preventDefault(); toast.info("Chức năng đang phát triển"); }} className="space-y-5">
              <div>
                <Label>Tên đăng nhập</Label>
                <Input value={forgotUsername} onChange={(e) => setForgotUsername(e.target.value)} placeholder="Nhập tên đăng nhập" />
              </div>
              <Button type="submit" className="w-full">Gửi yêu cầu khôi phục</Button>
            </form>

            <button onClick={() => setForgotMode(false)} className="mt-6 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto">
              <ArrowLeft size={16} /> Quay lại đăng nhập
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12" style={{ '--primary': primaryColor } as any}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          {logoUrl ? (
            <img src={logoUrl} alt={brandName} className="h-16 w-auto mb-4 object-contain rounded-lg" />
          ) : (
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-4xl">🌀</span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight">{brandName}</h1>
          <p className="text-muted-foreground mt-1">Đăng nhập để tiếp tục</p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <Label htmlFor="username">Tên đăng nhập</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" required autoFocus />
            </div>

            <div>
              <Label htmlFor="password">Mật khẩu</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={() => setForgotMode(true)} className="text-sm text-primary hover:underline">
                Quên mật khẩu?
              </button>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            Chưa có tài khoản?{" "}
            <Link to="/register" className="text-primary hover:underline font-medium">Đăng ký ngay</Link>
          </div>
        </div>
      </div>
    </div>
  );
}