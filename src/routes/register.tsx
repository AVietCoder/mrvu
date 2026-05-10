import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { registerFn, getFormOptionsFn } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Fan } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Đăng ký — QuatTran POS" }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const doRegister = useServerFn(registerFn);
  const getOptions = useServerFn(getFormOptionsFn);

  const [opts, setOpts] = useState<{ branches: any[]; roles: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    full_name: "", phone: "", username: "", password: "",
    role: "cashier", branch_id: "",
  });

  useEffect(() => {
    getOptions().then(setOpts);
  }, []);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name || !form.username || !form.password)
      return toast.error("Vui lòng điền đủ thông tin bắt buộc");
    setLoading(true);
    try {
      await doRegister({ data: { ...form, branch_id: form.branch_id || undefined } });
      toast.success("Đăng ký thành công! Hãy đăng nhập.");
      navigate({ to: "/login" });
    } catch (err: any) {
      toast.error(err?.message ?? "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mb-3">
            <Fan className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Tạo tài khoản</h1>
          <p className="text-sm text-muted-foreground mt-1">QuatTran POS</p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Họ và tên — text input */}
            <div>
              <Label>Họ và tên <span className="text-destructive">*</span></Label>
              <Input className="mt-1" placeholder="Nguyễn Văn A"
                value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </div>

            {/* Số điện thoại — text input */}
            <div>
              <Label>Số điện thoại</Label>
              <Input className="mt-1" placeholder="0901234567" type="tel"
                value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>

            {/* Vai trò — chọn từ database */}
            <div>
              <Label>Vai trò <span className="text-destructive">*</span></Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
              >
                {opts?.roles.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Chi nhánh — chọn từ database */}
            <div>
              <Label>Chi nhánh <span className="text-destructive">*</span></Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.branch_id}
                onChange={(e) => set("branch_id", e.target.value)}
              >
                <option value="">-- Chọn chi nhánh --</option>
                {opts?.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <hr className="border-border" />

            {/* Username — text input */}
            <div>
              <Label>Tên đăng nhập <span className="text-destructive">*</span></Label>
              <Input className="mt-1" placeholder="username"
                value={form.username} onChange={(e) => set("username", e.target.value)} />
            </div>

            {/* Password */}
            <div>
              <Label>Mật khẩu <span className="text-destructive">*</span></Label>
              <Input className="mt-1" type="password" placeholder="Tối thiểu 6 ký tự"
                value={form.password} onChange={(e) => set("password", e.target.value)} />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Đang tạo tài khoản..." : "Đăng ký"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-4">
            Đã có tài khoản?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">Đăng nhập</Link>
          </p>
        </div>
      </div>
    </div>
  );
}