import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import {
  listUsersFn,
  registerFn,
  deleteUserFn,
  updateUserPermsFn,
  getFormOptionsFn,
  resetPasswordFn,
} from "@/lib/auth.functions";
import { useAuth } from "@/context/AuthContext";
import { AppShell, Card } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  ShieldCheck,
  ShieldOff,
  Building2,
  Users,
  Eye,
  KeyRound,
  Phone,
  Calendar,
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
  const doResetPw = useServerFn(resetPasswordFn);
  const getOptions = useServerFn(getFormOptionsFn);

  const qc = useQueryClient();

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsers(),
  });

  const { data: opts } = useQuery({
    queryKey: ["form-options"],
    queryFn: () => getOptions(),
  });

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    full_name: "",
    phone: "",
    username: "",
    password: "123456",
    branch_ids: [] as string[],
  });

  const [viewId, setViewId] = useState<string | null>(null);

  const [resetPwId, setResetPwId] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("123456");
  const [resetLoading, setResetLoading] = useState(false);

  const [permOpen, setPermOpen] = useState(false);
  const [permLoading, setPermLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [grantPerms, setGrantPerms] = useState<Permission[]>([]);
  const [grantBranches, setGrantBranches] = useState<string[]>([]);

  const [bulkSelect, setBulkSelect] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (users ?? [])
      .filter((u) => !u.is_admin)
      .filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
        if (sortBy === "perm") return b.permissions.length - a.permissions.length;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [users, search, sortBy]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [filtered, page]
  );

  function toggleAddBranch(bid: string) {
    setAddForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(bid)
        ? f.branch_ids.filter((x) => x !== bid)
        : [...f.branch_ids, bid],
    }));
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!addForm.full_name || !addForm.username || !addForm.password) {
      toast.error("Vui lòng điền đủ thông tin");
      return;
    }

    setAddLoading(true);
    try {
      await doRegister({ data: addForm });
      toast.success("Đã tạo tài khoản nhân viên");
      setAddOpen(false);
      setAddForm({
        full_name: "",
        phone: "",
        username: "",
        password: "123456",
        branch_ids: [],
      });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setAddLoading(false);
    }
  }

  function openPermDialog(userIds: string[]) {
    setSelectedUsers(userIds);

    if (userIds.length === 1) {
      const u = users?.find((x) => x.id === userIds[0]);
      setGrantPerms((u?.permissions ?? []) as Permission[]);
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

  async function handleResetPw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resetPwId || !newPw) return;

    setResetLoading(true);
    try {
      await doResetPw({
        data: { user_id: resetPwId, new_password: newPw, admin_id: me!.id },
      });
      toast.success("Đã đặt lại mật khẩu thành công");
      setResetPwId(null);
      setNewPw("123456");
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    } finally {
      setResetLoading(false);
    }
  }

  function toggleBulk(id: string) {
    setBulkSelect((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const viewUser = viewId ? users?.find((u) => u.id === viewId) : null;

  return (
    <AppShell title="Quản lý nhân viên">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="text-xs text-muted-foreground uppercase">Tổng nhân viên</div>
          </div>
          <div className="text-2xl font-semibold">{filtered.length}</div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div className="text-xs text-muted-foreground uppercase">Đã cấp quyền</div>
          </div>
          <div className="text-2xl font-semibold">
            {filtered.filter((u) => u.permissions.length > 0).length}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-1">
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
            <div className="text-xs text-muted-foreground uppercase">Chưa cấp quyền</div>
          </div>
          <div className="text-2xl font-semibold">
            {filtered.filter((u) => u.permissions.length === 0).length}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="font-medium flex items-center gap-2 flex-1">
            <Users className="h-4 w-4" /> Danh sách nhân viên
          </div>

          {bulkSelect.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => openPermDialog(bulkSelect)}>
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
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Tìm tên, username..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "perm", label: "Nhiều quyền nhất" },
            { value: "date", label: "Mới nhất" },
          ]}
          sortValue={sortBy}
          onSort={(v) => {
            setSortBy(v);
            setPage(1);
          }}
          total={filtered.length}
          totalLabel="nhân viên"
        />

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                {isAdmin && (
                  <th className="py-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      checked={bulkSelect.length === filtered.length && filtered.length > 0}
                      onChange={(e) =>
                        setBulkSelect(e.target.checked ? filtered.map((u) => u.id) : [])
                      }
                    />
                  </th>
                )}
                <th className="py-2 pr-3">Họ tên</th>
                <th className="pr-3">Username</th>
                <th className="pr-3">SĐT</th>
                <th className="pr-3">Chi nhánh</th>
                <th className="pr-3">Quyền được cấp</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {paginated.map((u) => {
                const branchNames =
                  u.branch_ids.length === 0
                    ? "Tất cả chi nhánh"
                    : u.branch_ids
                        .map(
                          (bid) => opts?.branches.find((b: any) => b.id === bid)?.name ?? bid
                        )
                        .join(", ");

                return (
                  <tr
                    key={u.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setViewId(u.id)}
                  >
                    {isAdmin && (
                      <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
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
                          {u.permissions.slice(0, 2).map((p) => {
                            const def = ALL_PERMISSIONS.find((x) => x.key === p);
                            return (
                              <span
                                key={p}
                                className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5"
                              >
                                {def?.label ?? p}
                              </span>
                            );
                          })}
                          {u.permissions.length > 2 && (
                            <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                              +{u.permissions.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="p-1 hover:text-blue-600"
                        title="Xem chi tiết"
                        onClick={() => setViewId(u.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {isAdmin && (
                        <>
                          <button
                            className="p-1 hover:text-primary"
                            title="Cấp quyền"
                            onClick={() => openPermDialog([u.id])}
                          >
                            <ShieldCheck className="h-4 w-4" />
                          </button>
                          <button
                            className="p-1 hover:text-orange-600"
                            title="Reset mật khẩu"
                            onClick={() => {
                              setResetPwId(u.id);
                              setNewPw("123456");
                            }}
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            className="p-1 hover:text-destructive"
                            title="Xóa"
                            onClick={() => handleDelete(u.id, u.full_name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </td>
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

      <Pagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={filtered.length}
        onPageChange={setPage}
        label="nhân viên"
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Thêm nhân viên mới</DialogTitle>
            <DialogDescription>
              Tạo tài khoản nhân viên và phân quyền chi nhánh hoạt động.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <Label>Họ và tên *</Label>
              <Input
                className="mt-1"
                autoFocus
                placeholder="Nguyễn Văn A"
                value={addForm.full_name}
                onChange={(e) =>
                  setAddForm({ ...addForm, full_name: e.target.value })
                }
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
              <Label>Username *</Label>
              <Input
                className="mt-1"
                placeholder="username_nhanvien"
                value={addForm.username}
                onChange={(e) =>
                  setAddForm({ ...addForm, username: e.target.value })
                }
              />
            </div>

            <div>
              <Label>Mật khẩu mặc định</Label>
              <Input
                className="mt-1"
                value={addForm.password}
                onChange={(e) =>
                  setAddForm({ ...addForm, password: e.target.value })
                }
              />
            </div>

            <div>
              <Label>Chi nhánh hoạt động</Label>
              <div className="mt-1 space-y-1 border rounded-md p-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addForm.branch_ids.length === 0}
                    onChange={() => setAddForm({ ...addForm, branch_ids: [] })}
                  />
                  <span className="font-medium">Tất cả chi nhánh (mặc định)</span>
                </label>

                <hr className="border-border" />

                {opts?.branches.map((b: any) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.branch_ids.includes(b.id)}
                      onChange={() => toggleAddBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={addLoading}>
                {addLoading ? "Đang tạo..." : "Tạo tài khoản"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewId}
        onOpenChange={(o) => {
          if (!o) setViewId(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {viewUser && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{viewUser.full_name}</DialogTitle>
                <DialogDescription>
                  Thông tin chi tiết và quyền hạn của nhân viên.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Username</div>
                    <div className="font-mono font-medium">{viewUser.username}</div>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Phone className="h-3 w-3" /> SĐT
                    </div>
                    <div className="font-medium">{viewUser.phone ?? "Chưa có"}</div>
                  </div>

                  <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Building2 className="h-3 w-3" /> Chi nhánh
                    </div>
                    <div className="font-medium">
                      {viewUser.branch_ids.length === 0
                        ? "Tất cả chi nhánh"
                        : viewUser.branch_ids
                            .map(
                              (bid) => opts?.branches.find((b: any) => b.id === bid)?.name ?? bid
                            )
                            .join(", ")}
                    </div>
                  </div>

                  <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Calendar className="h-3 w-3" /> Ngày tạo
                    </div>
                    <div className="font-medium">
                      {new Date(viewUser.created_at).toLocaleDateString("vi-VN")}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-medium text-sm mb-2">
                    Quyền được cấp ({viewUser.permissions.length})
                  </div>

                  {viewUser.permissions.length === 0 ? (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground flex items-center gap-2">
                      <ShieldOff className="h-4 w-4" /> Chưa có quyền nào được cấp — chỉ xem cơ bản
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-1.5">
                      {viewUser.permissions.map((p) => {
                        const def = ALL_PERMISSIONS.find((x) => x.key === p);
                        return (
                          <div
                            key={p}
                            className="flex items-start gap-2 rounded-lg border bg-primary/5 border-primary/20 px-3 py-2"
                          >
                            <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <div>
                              <div className="text-sm font-medium">{def?.label ?? p}</div>
                              <div className="text-xs text-muted-foreground">{def?.desc}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {isAdmin && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setViewId(null);
                        openPermDialog([viewUser.id]);
                      }}
                    >
                      <ShieldCheck className="h-4 w-4 mr-1" /> Cấp quyền
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setViewId(null);
                        setResetPwId(viewUser.id);
                        setNewPw("123456");
                      }}
                    >
                      <KeyRound className="h-4 w-4 mr-1" /> Reset mật khẩu
                    </Button>
                  </>
                )}
                <Button onClick={() => setViewId(null)}>Đóng</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!resetPwId}
        onOpenChange={(o) => {
          if (!o) setResetPwId(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Đặt lại mật khẩu</DialogTitle>
            <DialogDescription>
              Đặt mật khẩu mới cho tài khoản nhân viên được chọn.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPw} className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Nhân viên:{" "}
              <span className="font-medium text-foreground">
                {users?.find((u) => u.id === resetPwId)?.full_name}
              </span>
            </div>

            <div>
              <Label>Mật khẩu mới *</Label>
              <Input
                className="mt-1"
                autoFocus
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Nhập mật khẩu mới..."
              />
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              Nhân viên sẽ cần dùng mật khẩu này để đăng nhập. Hãy thông báo cho họ.
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetPwId(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={resetLoading}>
                {resetLoading ? "Đang lưu..." : "Đặt lại"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="w-[92vw] sm:w-[85vw] max-w-2xl p-0 overflow-hidden rounded-xl gap-0">
          <DialogHeader className="px-4 sm:px-6 py-4 border-b bg-background">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
              <span className="truncate">
                {selectedUsers.length > 1
                  ? `Cấp quyền cho ${selectedUsers.length} nhân viên`
                  : `Cấp quyền — ${
                      users?.find((u) => u.id === selectedUsers[0])?.full_name ?? ""
                    }`}
              </span>
            </DialogTitle>
            <DialogDescription>
              Chọn quyền thao tác và chi nhánh hoạt động cho nhân viên.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[calc(85vh-130px)] px-4 sm:px-6 py-4 space-y-5">
            {selectedUsers.length > 1 && (
              <div className="rounded-lg border border-yellow-400/40 bg-yellow-50 p-3 text-sm">
                <div className="font-medium text-yellow-700">⚠️ Cập nhật hàng loạt</div>
                <div className="text-yellow-600 mt-0.5 text-xs">
                  Quyền bạn chọn sẽ thay thế hoàn toàn quyền hiện tại của tất cả nhân viên được chọn.
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <div className="font-medium text-sm">Quyền thực hiện</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_PERMISSIONS.filter(
                  (p) => p.key !== "manage_users" && p.key !== "view_reports"
                ).map((p) => {
                  const checked = grantPerms.includes(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-all hover:border-primary/40 hover:bg-muted/40 ${
                        checked ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0"
                        checked={checked}
                        onChange={() => togglePerm(p.key)}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-snug">{p.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {p.desc}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-primary" />
                <div className="font-medium text-sm">Chi nhánh hoạt động</div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <label className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={grantBranches.length === 0}
                    onChange={() => setGrantBranches([])}
                  />
                  <div>
                    <div className="text-sm font-medium">Tất cả chi nhánh</div>
                    <div className="text-xs text-muted-foreground">
                      Nhân viên có thể hoạt động ở mọi chi nhánh
                    </div>
                  </div>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {opts?.branches.map((b: any) => {
                    const checked = grantBranches.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all hover:bg-muted/40 ${
                          checked ? "border-primary bg-primary/5" : "bg-background"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBranch(b.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{b.name}</div>
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

          <div className="border-t bg-background px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground hidden sm:block">
              {grantPerms.length} quyền •{" "}
              {grantBranches.length === 0 ? "Tất cả chi nhánh" : `${grantBranches.length} chi nhánh`}
            </div>

            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => setPermOpen(false)}>
                Hủy
              </Button>
              <Button
                size="sm"
                onClick={handleSavePerms}
                disabled={permLoading}
                className="min-w-[100px]"
              >
                {permLoading ? "Đang lưu..." : "Lưu quyền"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}