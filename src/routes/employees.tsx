import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listUsersFn, registerFn, deleteUserFn,
  updateUserPermsFn, getFormOptionsFn,
} from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Trash2, ShieldCheck, ShieldOff,
  Building2, Users, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { ALL_PERMISSIONS, type Permission } from "@/lib/types";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Nhân viên — QuatTran POS" }] }),
  component: Page,
});

function Page() {
  const { user: me, isAdmin } = useAuth();
  const listUsers = useServerFn(listUsersFn);
  const doRegister = useServerFn(registerFn);
  const doDelete = useServerFn(deleteUserFn);
  const doUpdatePerms = useServerFn(updateUserPermsFn);
  const getOptions = useServerFn(getFormOptionsFn);
  const qc = useQueryClient();

  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const { data: opts } = useQuery({ queryKey: ["form-options"], queryFn: () => getOptions() });

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");

  // ── Dialog thêm nhân viên ──────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    full_name: "", phone: "", username: "", password: "123456",
    branch_ids: [] as string[],
  });

  // ── Dialog cấp quyền (có thể chọn nhiều user) ─────────────
  const [permOpen, setPermOpen] = useState(false);
  const [permLoading, setPermLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [grantPerms, setGrantPerms] = useState<Permission[]>([]);
  const [grantBranches, setGrantBranches] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (users ?? [])
      .filter((u) => !u.is_admin) // admin không hiển thị ở đây
      .filter((u) =>
        u.full_name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
        if (sortBy === "perm") return b.permissions.length - a.permissions.length;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [users, search, sortBy]);

  // Toggle branch trong form thêm nhân viên
  function toggleAddBranch(bid: string) {
    setAddForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(bid)
        ? f.branch_ids.filter((x) => x !== bid)
        : [...f.branch_ids, bid],
    }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.full_name || !addForm.username || !addForm.password)
      return toast.error("Vui lòng điền đủ thông tin");
    setAddLoading(true);
    try {
      await doRegister({ data: addForm });
      toast.success("Đã tạo tài khoản nhân viên");
      setAddOpen(false);
      setAddForm({ full_name: "", phone: "", username: "", password: "123456", branch_ids: [] });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setAddLoading(false);
    }
  }

  // Mở dialog cấp quyền (1 hoặc nhiều user)
  function openPermDialog(userIds: string[]) {
    setSelectedUsers(userIds);
    // Nếu chỉ 1 user → load quyền hiện tại của họ
    if (userIds.length === 1) {
      const u = users?.find((x) => x.id === userIds[0]);
      setGrantPerms(u?.permissions ?? []);
      setGrantBranches(u?.branch_ids ?? []);
    } else {
      setGrantPerms([]);
      setGrantBranches([]);
    }
    setPermOpen(true);
  }

  function togglePerm(p: Permission) {
    setGrantPerms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function toggleBranch(bid: string) {
    setGrantBranches((prev) =>
      prev.includes(bid) ? prev.filter((x) => x !== bid) : [...prev, bid]
    );
  }

  async function handleSavePerms() {
    setPermLoading(true);
    try {
      await doUpdatePerms({
        data: {
          user_ids: selectedUsers,
          permissions: grantPerms,
          branch_ids: grantBranches,
        },
      });
      toast.success(
        selectedUsers.length > 1
          ? `Đã cập nhật quyền cho ${selectedUsers.length} nhân viên`
          : "Đã cập nhật quyền"
      );
      setPermOpen(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setPermLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa tài khoản "${name}"? Hành động này không thể hoàn tác.`)) return;
    try {
      await doDelete({ data: { id } });
      toast.success("Đã xóa tài khoản");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  // Chọn tất cả để cấp quyền hàng loạt
  const [bulkSelect, setBulkSelect] = useState<string[]>([]);
  function toggleBulk(id: string) {
    setBulkSelect((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  return (
    <AppShell title="Quản lý nhân viên">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Tổng nhân viên</div>
          <div className="text-2xl font-semibold mt-1">{filtered.length}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Đã cấp quyền</div>
          <div className="text-2xl font-semibold mt-1">
            {filtered.filter((u) => u.permissions.length > 0).length}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Chưa cấp quyền</div>
          <div className="text-2xl font-semibold mt-1">
            {filtered.filter((u) => u.permissions.length === 0).length}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="font-medium flex items-center gap-2 flex-1">
            <Users className="h-4 w-4" /> Danh sách nhân viên
          </div>
          {/* Cấp quyền hàng loạt */}
          {bulkSelect.length > 0 && (
            <Button
              size="sm" variant="secondary"
              onClick={() => openPermDialog(bulkSelect)}
            >
              <ShieldCheck className="h-4 w-4 mr-1" />
              Cấp quyền cho {bulkSelect.length} người
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Thêm nhân viên
            </Button>
          )}
        </div>

        <SearchFilter
          search={search} onSearch={setSearch}
          placeholder="Tìm tên, username..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "perm", label: "Nhiều quyền nhất" },
            { value: "date", label: "Mới nhất" },
          ]}
          sortValue={sortBy} onSort={setSortBy}
          total={filtered.length} totalLabel="nhân viên"
        />

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                {isAdmin && <th className="py-2 pr-3 w-8">
                  <input type="checkbox"
                    checked={bulkSelect.length === filtered.length && filtered.length > 0}
                    onChange={(e) => setBulkSelect(e.target.checked ? filtered.map((u) => u.id) : [])}
                  />
                </th>}
                <th className="py-2 pr-3">Họ tên</th>
                <th className="pr-3">Username</th>
                <th className="pr-3">SĐT</th>
                <th className="pr-3">Chi nhánh</th>
                <th className="pr-3">Quyền được cấp</th>
                {isAdmin && <th className="text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const branchNames = u.branch_ids.length === 0
                  ? "Tất cả chi nhánh"
                  : u.branch_ids
                      .map((bid) => opts?.branches.find((b: any) => b.id === bid)?.name ?? bid)
                      .join(", ");

                return (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                    {isAdmin && (
                      <td className="py-2 pr-3">
                        <input type="checkbox"
                          checked={bulkSelect.includes(u.id)}
                          onChange={() => toggleBulk(u.id)}
                        />
                      </td>
                    )}
                    <td className="py-2 pr-3 font-medium">{u.full_name}</td>
                    <td className="pr-3 font-mono text-xs">{u.username}</td>
                    <td className="pr-3 text-muted-foreground">{u.phone ?? "—"}</td>
                    <td className="pr-3 text-xs text-muted-foreground max-w-[140px] truncate">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3 shrink-0" /> {branchNames}
                      </span>
                    </td>
                    <td className="pr-3">
                      {u.permissions.length === 0 ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <ShieldOff className="h-3 w-3" /> Chỉ xem cơ bản
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.permissions.slice(0, 3).map((p) => {
                            const def = ALL_PERMISSIONS.find((x) => x.key === p);
                            return (
                              <span key={p} className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                                {def?.label ?? p}
                              </span>
                            );
                          })}
                          {u.permissions.length > 3 && (
                            <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                              +{u.permissions.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="text-right">
                        <Button
                          size="sm" variant="outline"
                          className="mr-1"
                          onClick={() => openPermDialog([u.id])}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" /> Cấp quyền
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          onClick={() => handleDelete(u.id, u.full_name)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    Chưa có nhân viên nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Dialog thêm nhân viên ─────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm nhân viên mới</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <Label>Họ và tên *</Label>
              <Input className="mt-1" placeholder="Nguyễn Văn A"
                value={addForm.full_name}
                onChange={(e) => setAddForm({ ...addForm, full_name: e.target.value })} />
            </div>
            <div>
              <Label>Số điện thoại</Label>
              <Input className="mt-1" placeholder="0901234567"
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
            </div>
            <div>
              <Label>Username *</Label>
              <Input className="mt-1" placeholder="username_nhanvien"
                value={addForm.username}
                onChange={(e) => setAddForm({ ...addForm, username: e.target.value })} />
            </div>
            <div>
              <Label>Mật khẩu mặc định</Label>
              <Input className="mt-1"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
            </div>
            <div>
              <Label>Chi nhánh hoạt động</Label>
              <div className="mt-1 space-y-1 border rounded-md p-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                    checked={addForm.branch_ids.length === 0}
                    onChange={() => setAddForm({ ...addForm, branch_ids: [] })}
                  />
                  <span className="font-medium">Tất cả chi nhánh (mặc định)</span>
                </label>
                <hr className="border-border" />
                {opts?.branches.map((b: any) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={addForm.branch_ids.includes(b.id)}
                      onChange={() => toggleAddBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Bỏ chọn tất cả = nhân viên hoạt động ở mọi chi nhánh
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Hủy</Button>
              <Button type="submit" disabled={addLoading}>
                {addLoading ? "Đang tạo..." : "Tạo tài khoản"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Dialog cấp quyền ─────────────────────────────────── */}
<Dialog open={permOpen} onOpenChange={setPermOpen}>
  <DialogContent
    className="
      w-[95vw]
      max-w-3xl
      max-h-[90vh]
      p-0
      overflow-hidden
      rounded-2xl
    "
  >
    <div className="flex flex-col max-h-[90vh]">

      {/* Header */}
      <DialogHeader className="px-6 py-4 border-b bg-background sticky top-0 z-10">
        <DialogTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-primary" />

          {selectedUsers.length > 1
            ? `Cấp quyền cho ${selectedUsers.length} nhân viên`
            : `Cấp quyền — ${
                users?.find((u) => u.id === selectedUsers[0])?.full_name
              }`}
        </DialogTitle>

        <p className="text-sm text-muted-foreground mt-1">
          Quản lý quyền thao tác và chi nhánh hoạt động của nhân viên.
        </p>
      </DialogHeader>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Warning */}
        {selectedUsers.length > 1 && (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm">
            <div className="font-medium text-yellow-700 dark:text-yellow-400">
              ⚠️ Cập nhật hàng loạt
            </div>

            <div className="text-muted-foreground mt-1">
              Quyền bạn chọn sẽ thay thế hoàn toàn quyền hiện tại
              của tất cả nhân viên được chọn.
            </div>
          </div>
        )}

        {/* Permissions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div className="font-medium">
              Quyền thực hiện
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {ALL_PERMISSIONS
              .filter(
                (p) =>
                  p.key !== "manage_users" &&
                  p.key !== "view_reports"
              )
              .map((p) => {

                const checked = grantPerms.includes(p.key);

                return (
                  <label
                    key={p.key}
                    className={`
                      group
                      relative
                      flex gap-3
                      rounded-xl
                      border
                      p-4
                      cursor-pointer
                      transition-all
                      hover:border-primary/40
                      hover:bg-muted/40
                      hover:shadow-sm
                      ${checked
                        ? "border-primary bg-primary/5"
                        : "border-border"
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={checked}
                      onChange={() => togglePerm(p.key)}
                    />

                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {p.label}
                      </div>

                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {p.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
          </div>
        </div>

        {/* Branches */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-primary" />

            <div className="font-medium">
              Chi nhánh hoạt động
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4 space-y-2">

            {/* All branches */}
            <label
              className="
                flex items-center gap-3
                rounded-lg
                border
                bg-background
                px-3 py-2
                cursor-pointer
                hover:bg-muted/40
                transition-colors
              "
            >
              <input
                type="checkbox"
                checked={grantBranches.length === 0}
                onChange={() => setGrantBranches([])}
              />

              <div>
                <div className="text-sm font-medium">
                  Tất cả chi nhánh
                </div>

                <div className="text-xs text-muted-foreground">
                  Nhân viên có thể hoạt động ở mọi chi nhánh
                </div>
              </div>
            </label>

            {/* Branch list */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">

              {opts?.branches.map((b: any) => {

                const checked = grantBranches.includes(b.id);

                return (
                  <label
                    key={b.id}
                    className={`
                      flex items-center gap-3
                      rounded-lg
                      border
                      px-3 py-2
                      cursor-pointer
                      transition-all
                      hover:bg-muted/40
                      ${checked
                        ? "border-primary bg-primary/5"
                        : "bg-background"
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBranch(b.id)}
                    />

                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.name}
                      </div>

                      {b.address && (
                        <div className="text-xs text-muted-foreground truncate">
                          {b.address}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <DialogFooter
        className="
          border-t
          bg-background
          px-6 py-4
          sticky bottom-0
          flex-row
          justify-between
        "
      >
        <div className="text-xs text-muted-foreground hidden md:block">
          {grantPerms.length} quyền •{" "}
          {grantBranches.length === 0
            ? "Tất cả chi nhánh"
            : `${grantBranches.length} chi nhánh`}
        </div>

        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            onClick={() => setPermOpen(false)}
          >
            Hủy
          </Button>

          <Button
            onClick={handleSavePerms}
            disabled={permLoading}
            className="min-w-[120px]"
          >
            {permLoading
              ? "Đang lưu..."
              : "Lưu quyền"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
    </AppShell>
  );
}