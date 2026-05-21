// @ts-nocheck
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { changePasswordFn } from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/change-password")({
  head: () => ({ meta: [{ title: "Đổi mật khẩu — Mr.Vũ" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { user } = useAuth();
  const doChange = useServerFn(changePasswordFn);
  const [form, setForm] = useState({ old_password: "", new_password: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (form.new_password !== form.confirm) return toast.error("Mật khẩu xác nhận không khớp");
    if (form.new_password.length < 6) return toast.error("Mật khẩu mới phải ít nhất 6 ký tự");
    setLoading(true);
    try {
      await doChange({ data: { user_id: user.id, old_password: form.old_password, new_password: form.new_password } });
      toast.success("Đổi mật khẩu thành công!");
      setForm({ old_password: "", new_password: "", confirm: "" });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Đổi mật khẩu">
      <div className="max-w-md">
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Mật khẩu hiện tại</Label>
              <Input className="mt-1" type="password" value={form.old_password}
                onChange={(e) => setForm({ ...form, old_password: e.target.value })} />
            </div>
            <div>
              <Label>Mật khẩu mới</Label>
              <Input className="mt-1" type="password" value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })} />
            </div>
            <div>
              <Label>Xác nhận mật khẩu mới</Label>
              <Input className="mt-1" type="password" value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : "Đổi mật khẩu"}
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}