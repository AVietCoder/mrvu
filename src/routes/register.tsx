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

  const [opts, setOpts] = useState<{ branches: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    full_name: "", phone: "", username: "", password: "",
    branch_ids: [] as string[],
  });

  useEffect(() => { getOptions().then(setOpts); }, []);

  function toggleBranch(bid: string) {
    setForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(bid)
        ? f.branch_ids.filter((x) => x !== bid)
        : [...f.branch_ids, bid],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name || !form.username || !form.password)
      return toast.error("Vui lòng điền đủ thông tin bắt buộc");
    setLoading(true);
    try {
      await doRegister({ data: form });
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
          <p className="text-xs text-muted-foreground mt-1">
            Sau khi đăng ký, admin sẽ cấp quyền cho bạn
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Họ và tên <span className="text-destructive">*</span></Label>
              <Input className="mt-1" placeholder="Nguyễn Văn A"
                value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <Label>Số điện thoại</Label>
              <Input className="mt-1" placeholder="0901234567" type="tel"
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>Chi nhánh hoạt động</Label>
              <div className="mt-1 space-y-1 border rounded-md p-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={form.branch_ids.length === 0}
                    onChange={() => setForm({ ...form, branch_ids: [] })}
                  />
                  <span className="font-medium">Tất cả chi nhánh</span>
                </label>
                <hr />
                {opts?.branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox"
                      checked={form.branch_ids.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <hr />
            <div>
              <Label>Tên đăng nhập <span className="text-destructive">*</span></Label>
              <Input className="mt-1" placeholder="username"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <Label>Mật khẩu <span className="text-destructive">*</span></Label>
              <Input className="mt-1" type="password" placeholder="Tối thiểu 6 ký tự"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Đang tạo..." : "Đăng ký"}
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