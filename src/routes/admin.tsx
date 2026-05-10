import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listUsersFn, registerFn } from "@/lib/auth.functions";
import { getFormOptionsFn } from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, Plus, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Quản trị — QuatTran POS" }] }),
  component: AdminPage,
});

const roleLabel: Record<string, string> = {
  admin: "Quản trị viên", manager: "Quản lý",
  cashier: "Thu ngân", warehouse: "Thủ kho",
};
const roleBadge: Record<string, string> = {
  admin: "bg-destructive/10 text-destructive",
  manager: "bg-blue-100 text-blue-700",
  cashier: "bg-green-100 text-green-700",
  warehouse: "bg-orange-100 text-orange-700",
};

function AdminPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const listUsers = useServerFn(listUsersFn);
  const doRegister = useServerFn(registerFn);
  const getOptions = useServerFn(getFormOptionsFn);
  const qc = useQueryClient();

  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const { data: opts } = useQuery({ queryKey: ["form-options"], queryFn: () => getOptions() });

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [filterRole, setFilterRole] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    full_name: "", phone: "", username: "", password: "123456",
    role: "cashier", branch_id: "",
  });

  // Redirect if not admin
  if (!isAdmin) {
    navigate({ to: "/" });
    return null;
  }

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const filtered = (users ?? [])
    .filter((u) => {
      const q = search.toLowerCase();
      const matchSearch = u.full_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
      const matchRole = !filterRole || u.role === filterRole;
      return matchSearch && matchRole;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
      if (sortBy === "role") return a.role.localeCompare(b.role);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await doRegister({ data: { ...form, branch_id: form.branch_id || undefined } });
      toast.success("Tạo tài khoản thành công");
      setOpenAdd(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Quản trị hệ thống">
      <div className="flex items-center gap-2 mb-6">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="text-sm text-muted-foreground">Chỉ Admin mới truy cập được trang này</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {["admin","manager","cashier","warehouse"].map((role) => (
          <Card key={role}>
            <div className="text-xs text-muted-foreground uppercase">{roleLabel[role]}</div>
            <div className="text-2xl font-semibold mt-1">
              {(users ?? []).filter((u) => u.role === role).length}
            </div>
          </Card>
        ))}
      </div>

      {/* Users table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium flex items-center gap-2">
            <Users className="h-4 w-4" /> Danh sách tài khoản
          </div>
          <Button size="sm" onClick={() => setOpenAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Thêm tài khoản
          </Button>
        </div>

        <SearchFilter
          search={search} onSearch={setSearch}
          placeholder="Tìm tên, username..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "role", label: "Theo vai trò" },
            { value: "date", label: "Mới nhất" },
          ]}
          sortValue={sortBy} onSort={setSortBy}
          filterSlot={
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
            >
              <option value="">Tất cả vai trò</option>
              {opts?.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          }
          total={filtered.length} totalLabel="tài khoản"
        />

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-4">Họ tên</th>
                <th className="pr-4">Username</th>
                <th className="pr-4">SĐT</th>
                <th className="pr-4">Vai trò</th>
                <th className="pr-4">Chi nhánh</th>
                <th>Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">{u.full_name}</td>
                  <td className="pr-4 font-mono text-xs">{u.username}</td>
                  <td className="pr-4 text-muted-foreground">{u.phone ?? "—"}</td>
                  <td className="pr-4">
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${roleBadge[u.role]}`}>
                      {roleLabel[u.role]}
                    </span>
                  </td>
                  <td className="pr-4 text-muted-foreground">{u.branch_name}</td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("vi-VN")}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Không có kết quả</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add user dialog */}
      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Thêm tài khoản mới</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div><Label>Họ tên *</Label>
              <Input className="mt-1" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} /></div>
            <div><Label>Số điện thoại</Label>
              <Input className="mt-1" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            <div><Label>Vai trò *</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.role} onChange={(e) => set("role", e.target.value)}>
                {opts?.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select></div>
            <div><Label>Chi nhánh *</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
                <option value="">-- Chọn chi nhánh --</option>
                {opts?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div><Label>Username *</Label>
              <Input className="mt-1" value={form.username} onChange={(e) => set("username", e.target.value)} /></div>
            <div><Label>Mật khẩu mặc định</Label>
              <Input className="mt-1" value={form.password} onChange={(e) => set("password", e.target.value)} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenAdd(false)}>Hủy</Button>
              <Button type="submit" disabled={loading}>{loading ? "Đang tạo..." : "Tạo tài khoản"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}