import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  listUsersFn,
  registerFn,
  deleteUserFn,
  updateUserPermsFn,
  getFormOptionsFn,
} from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  ShieldOff,
  Plus,
  Trash2,
  Users,
  Building2,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { ALL_PERMISSIONS, type Permission } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Quản trị — QuatTran POS" }] }),
  component: AdminPage,
});

// ── helpers ────────────────────────────────────────────────────
const permColor: Record<string, string> = {
  stock_in:        "bg-blue-100 text-blue-700",
  stock_out:       "bg-orange-100 text-orange-700",
  stock_transfer:  "bg-purple-100 text-purple-700",
  view_all_debt:   "bg-red-100 text-red-700",
  manage_branches: "bg-yellow-100 text-yellow-700",
  create_order:    "bg-green-100 text-green-700",
  manage_products: "bg-teal-100 text-teal-700",
  view_reports:    "bg-indigo-100 text-indigo-700",
  manage_users:    "bg-gray-100 text-gray-700",
};

function PermBadge({ perm }: { perm: string }) {
  const def = ALL_PERMISSIONS.find((x) => x.key === perm);
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${permColor[perm] ?? "bg-muted text-muted-foreground"}`}>
      {def?.label ?? perm}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────
function AdminPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const listUsers   = useServerFn(listUsersFn);
  const doRegister  = useServerFn(registerFn);
  const doDelete    = useServerFn(deleteUserFn);
  const doUpdatePerms = useServerFn(updateUserPermsFn);
  const getOptions  = useServerFn(getFormOptionsFn);
  const qc = useQueryClient();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsers(),
  });
  const { data: opts } = useQuery({
    queryKey: ["form-options"],
    queryFn: () => getOptions(),
  });

  // ── search / sort / filter ─────────────────────────────────
  const [search, setSearch]     = useState("");
  const [sortBy, setSortBy]     = useState("name");
  const [filterPerm, setFilterPerm] = useState("");

  // ── bulk select ────────────────────────────────────────────
  const [bulkSelect, setBulkSelect] = useState<string[]>([]);

  // ── dialog: thêm tài khoản ─────────────────────────────────
  const [addOpen, setAddOpen]     = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    full_name: "", phone: "", username: "", password: "123456",
    branch_ids: [] as string[],
  });

  // ── dialog: cấp quyền ─────────────────────────────────────
  const [permOpen, setPermOpen]     = useState(false);
  const [permLoading, setPermLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [grantPerms,    setGrantPerms]    = useState<Permission[]>([]);
  const [grantBranches, setGrantBranches] = useState<string[]>([]);

  // Redirect nếu không phải admin (client-side guard)
  useEffect(() => {
    if (mounted && !isAdmin) navigate({ to: "/" });
  }, [mounted, isAdmin]);

  // ── derived data ───────────────────────────────────────────
  const staffList = useMemo(() => {
    return (users ?? []).filter((u) => !u.is_admin);
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return staffList
      .filter((u) => {
        const matchSearch =
          u.full_name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.phone ?? "").includes(q);
        const matchPerm =
          !filterPerm ||
          (filterPerm === "__none__"
            ? u.permissions.length === 0
            : u.permissions.includes(filterPerm as Permission));
        return matchSearch && matchPerm;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
        if (sortBy === "perm_desc") return b.permissions.length - a.permissions.length;
        if (sortBy === "perm_asc")  return a.permissions.length - b.permissions.length;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [staffList, search, sortBy, filterPerm]);

  // ── actions ────────────────────────────────────────────────
  function toggleBulk(id: string) {
    setBulkSelect((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    );
  }

  function toggleAllBulk() {
    setBulkSelect((p) =>
      p.length === filtered.length ? [] : filtered.map((u) => u.id)
    );
  }

  function openPermDialog(userIds: string[]) {
    setSelectedUsers(userIds);
    if (userIds.length === 1) {
      const u = users?.find((x) => x.id === userIds[0]);
      setGrantPerms(u?.permissions ?? []);
      setGrantBranches(u?.branch_ids ?? []);
    } else {
      // Bulk: khởi đầu từ intersection (quyền ai cũng có)
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

  function toggleGrantBranch(bid: string) {
    setGrantBranches((prev) =>
      prev.includes(bid) ? prev.filter((x) => x !== bid) : [...prev, bid]
    );
  }

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
      return toast.error("Vui lòng điền đủ thông tin bắt buộc");
    setAddLoading(true);
    try {
      await doRegister({ data: addForm });
      toast.success("Đã tạo tài khoản nhân viên");
      setAddOpen(false);
      setAddForm({ full_name: "", phone: "", username: "", password: "123456", branch_ids: [] });
      setBulkSelect([]);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setAddLoading(false);
    }
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
      setBulkSelect([]);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setPermLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa tài khoản "${name}"?\nHành động này không thể hoàn tác.`)) return;
    try {
      await doDelete({ data: { id } });
      toast.success("Đã xóa tài khoản");
      setBulkSelect((p) => p.filter((x) => x !== id));
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  if (!mounted) return null;

  // ── render ─────────────────────────────────────────────────
  return (
    <AppShell title="Quản trị hệ thống">

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Tổng nhân viên</div>
          <div className="text-2xl font-semibold mt-1">{staffList.length}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Đã cấp quyền</div>
          <div className="text-2xl font-semibold mt-1 text-primary">
            {staffList.filter((u) => u.permissions.length > 0).length}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Chưa cấp quyền</div>
          <div className="text-2xl font-semibold mt-1 text-muted-foreground">
            {staffList.filter((u) => u.permissions.length === 0).length}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground uppercase">Chi nhánh</div>
          <div className="text-2xl font-semibold mt-1">
            {(opts?.branches ?? []).length}
          </div>
        </Card>
      </div>

      {/* Danh sách nhân viên */}
      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="font-medium flex items-center gap-2 flex-1">
            <Users className="h-4 w-4" />
            Tài khoản nhân viên
          </div>

          {/* Bulk action */}
          {bulkSelect.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openPermDialog(bulkSelect)}
            >
              <KeyRound className="h-4 w-4 mr-1" />
              Cấp quyền {bulkSelect.length} người
            </Button>
          )}

          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Thêm nhân viên
          </Button>
        </div>

        {/* Search + filter */}
        <SearchFilter
          search={search}
          onSearch={setSearch}
          placeholder="Tìm tên, username, SĐT..."
          sortOptions={[
            { value: "name",      label: "Tên A→Z" },
            { value: "perm_desc", label: "Nhiều quyền nhất" },
            { value: "perm_asc",  label: "Ít quyền nhất" },
            { value: "date",      label: "Mới nhất" },
          ]}
          sortValue={sortBy}
          onSort={setSortBy}
          filterSlot={
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={filterPerm}
              onChange={(e) => setFilterPerm(e.target.value)}
            >
              <option value="">Tất cả</option>
              <option value="__none__">Chưa có quyền</option>
              {ALL_PERMISSIONS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          }
          total={filtered.length}
          totalLabel="nhân viên"
        />

        {/* Table */}
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={bulkSelect.length === filtered.length && filtered.length > 0}
                    onChange={toggleAllBulk}
                  />
                </th>
                <th className="pr-3">Họ và tên</th>
                <th className="pr-3">Username</th>
                <th className="pr-3 hidden md:table-cell">SĐT</th>
                <th className="pr-3 hidden md:table-cell">Chi nhánh</th>
                <th className="pr-3">Quyền</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const branchNames =
                  u.branch_ids.length === 0
                    ? "Tất cả"
                    : u.branch_ids
                        .map(
                          (bid) =>
                            (opts?.branches as any[] ?? []).find(
                              (b) => b.id === bid
                            )?.name ?? bid
                        )
                        .join(", ");

                return (
                  <tr
                    key={u.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    {/* Checkbox */}
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={bulkSelect.includes(u.id)}
                        onChange={() => toggleBulk(u.id)}
                      />
                    </td>

                    {/* Tên */}
                    <td className="pr-3 font-medium">{u.full_name}</td>

                    {/* Username */}
                    <td className="pr-3">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {u.username}
                      </code>
                    </td>

                    {/* SĐT */}
                    <td className="pr-3 text-muted-foreground hidden md:table-cell">
                      {u.phone ?? "—"}
                    </td>

                    {/* Chi nhánh */}
                    <td className="pr-3 hidden md:table-cell">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{branchNames}</span>
                      </span>
                    </td>

                    {/* Quyền */}
                    <td className="pr-3">
                      {u.permissions.length === 0 ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ShieldOff className="h-3 w-3" /> Cơ bản
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.permissions.slice(0, 2).map((p) => (
                            <PermBadge key={p} perm={p} />
                          ))}
                          {u.permissions.length > 2 && (
                            <span
                              className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 cursor-pointer"
                              onClick={() => openPermDialog([u.id])}
                            >
                              +{u.permissions.length - 2} nữa
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openPermDialog([u.id])}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Quyền
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(u.id, u.full_name)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {search ? "Không tìm thấy kết quả" : "Chưa có nhân viên nào"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ══ Dialog: Thêm nhân viên ══════════════════════════════ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Thêm nhân viên mới
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <Label>Họ và tên <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                placeholder="Nguyễn Văn A"
                value={addForm.full_name}
                onChange={(e) => setAddForm({ ...addForm, full_name: e.target.value })}
              />
            </div>

            <div>
              <Label>Số điện thoại</Label>
              <Input
                className="mt-1"
                placeholder="0901234567"
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
              />
            </div>

            <div>
              <Label>Chi nhánh hoạt động</Label>
              <div className="mt-1 border rounded-md p-2 space-y-1 text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={addForm.branch_ids.length === 0}
                    onChange={() => setAddForm({ ...addForm, branch_ids: [] })}
                  />
                  <span className="font-medium">Tất cả chi nhánh (mặc định)</span>
                </label>
                <hr className="border-border" />
                {(opts?.branches as any[] ?? []).map((b) => (
                  <label key={b.id} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={addForm.branch_ids.includes(b.id)}
                      onChange={() => toggleAddBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Bỏ chọn tất cả = hoạt động ở mọi chi nhánh
              </p>
            </div>

            <hr className="border-border" />

            <div>
              <Label>Username <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                placeholder="ten_dang_nhap"
                value={addForm.username}
                onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
              />
            </div>

            <div>
              <Label>Mật khẩu mặc định</Label>
              <Input
                className="mt-1"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Nhân viên có thể đổi mật khẩu sau khi đăng nhập
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={addLoading}>
                {addLoading ? "Đang tạo..." : "Tạo tài khoản"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ══ Dialog: Cấp quyền ══════════════════════════════════ */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {selectedUsers.length > 1
                ? `Cấp quyền cho ${selectedUsers.length} nhân viên`
                : `Cấp quyền — ${users?.find((u) => u.id === selectedUsers[0])?.full_name ?? ""}`}
            </DialogTitle>
          </DialogHeader>

          {selectedUsers.length > 1 && (
            <div className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-md p-2 mb-2">
              ⚠️ Quyền bạn chọn sẽ <strong>thay thế toàn bộ</strong> quyền hiện tại của{" "}
              {selectedUsers.length} nhân viên được chọn.
            </div>
          )}

          {/* Chọn tất cả / bỏ tất cả */}
          <div className="flex gap-2 mb-3">
            <Button
              size="sm" variant="outline"
              onClick={() => setGrantPerms(ALL_PERMISSIONS.filter((p) => p.key !== "manage_users").map((p) => p.key))}
            >
              Chọn tất cả
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => setGrantPerms([])}
            >
              Bỏ tất cả
            </Button>
          </div>

          {/* Danh sách quyền */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Quyền thực hiện
            </div>
            {ALL_PERMISSIONS.filter((p) => p.key !== "manage_users").map((p) => (
              <label
                key={p.key}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={grantPerms.includes(p.key)}
                  onChange={() => togglePerm(p.key)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.label}</span>
                    <PermBadge perm={p.key} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Chi nhánh */}
          <div className="mt-4 space-y-2">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Building2 className="h-4 w-4" /> Chi nhánh hoạt động
            </div>
            <div className="border rounded-md p-2 space-y-1 text-sm">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={grantBranches.length === 0}
                  onChange={() => setGrantBranches([])}
                />
                <span className="font-medium">Tất cả chi nhánh</span>
              </label>
              <hr className="border-border" />
              {(opts?.branches as any[] ?? []).map((b) => (
                <label key={b.id} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={grantBranches.includes(b.id)}
                    onChange={() => toggleGrantBranch(b.id)}
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPermOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleSavePerms} disabled={permLoading}>
              {permLoading ? "Đang lưu..." : "Lưu quyền"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}