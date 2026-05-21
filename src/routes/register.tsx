// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { registerFn } from "@/lib/auth.functions";
import { getSettings } from "@/lib/settings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const doRegister = useServerFn(registerFn);
  const getSettingsFn = useServerFn(getSettings);

  const [settings, setSettings] = useState<any>(null);
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    confirmPassword: "",
    phone: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSettingsFn().then(setSettings);
  }, []);

  const brandName = settings?.site_name?.trim() || "Mr.Vũ";
  const logoUrl = settings?.logo_url || "";
  const primaryColor = settings?.primary_color || "#3b82f6";

  useEffect(() => {
    document.title = `Đăng ký — ${brandName}`;
  }, [brandName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) return toast.error("Mật khẩu xác nhận không khớp");
    if (!form.full_name || !form.username || !form.password || !form.phone) {
      return toast.error("Vui lòng điền đầy đủ thông tin");
    }

    setLoading(true);
    try {
      await doRegister({ data: {
        full_name: form.full_name,
        username: form.username,
        password: form.password,
        phone: form.phone,
      }});
      toast.success("Đăng ký thành công! Vui lòng đăng nhập.");
      navigate({ to: "/login" });
    } catch (err: any) {
      toast.error(err?.message ?? "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12" style={{ '--primary': primaryColor } as any}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          {logoUrl ? (
            <img src={logoUrl} alt={brandName} className="h-16 w-auto mb-4 object-contain" />
          ) : (
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-3xl">🌀</span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight">{brandName}</h1>
          <p className="text-muted-foreground mt-1">Tạo tài khoản mới</p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="full_name">Họ và tên *</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Nguyễn Văn A" required />
            </div>

            <div>
              <Label htmlFor="username">Tên đăng nhập *</Label>
              <Input id="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" required />
            </div>

            <div>
              <Label htmlFor="phone">Số điện thoại *</Label>
              <Input id="phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0901234567" required />
            </div>

            <div>
              <Label htmlFor="password">Mật khẩu *</Label>
              <div className="relative">
                <Input id="password" type={showPw ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirmPassword">Xác nhận mật khẩu *</Label>
              <div className="relative">
                <Input id="confirmPassword" type={showConfirmPw ? "text" : "password"} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowConfirmPw(!showConfirmPw)}>
                  {showConfirmPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Đang xử lý..." : "Đăng ký"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            Đã có tài khoản?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">Đăng nhập</Link>
          </div>
        </div>
      </div>
    </div>
  );
}