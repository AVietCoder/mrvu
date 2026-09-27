import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  listUsersFn,
  registerFn,
  deleteUserFn,
  updateUserPermsFn,
  getFormOptionsFn,
  resetPasswordFn,
  updateUserProfileFn,
  upsertPositionFn,
  deletePositionFn,
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
  Cake,
  Briefcase,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { ALL_PERMISSIONS, type Permission } from "@/lib/types";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Nhân viên — Mr.Vũ" }] }),
  component: Page,
});

// Màu cố định theo thứ tự chức vụ — cùng chức vụ luôn cùng màu ở mọi nơi.
const POSITION_COLORS = [
  "border-sky-200 bg-sky-50 text-sky-800",
  "border-emerald-200 bg-emerald-50 text-emerald-800",
  "border-violet-200 bg-violet-50 text-violet-800",
  "border-amber-200 bg-amber-50 text-amber-800",
  "border-rose-200 bg-rose-50 text-rose-800",
  "border-teal-200 bg-teal-50 text-teal-800",
  "border-indigo-200 bg-indigo-50 text-indigo-800",
];
const AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];

/** Ảnh đại diện chữ cái: 2 chữ đầu của tên (vd "Vũ Văn Giang" → "VG"). */
function Avatar({ name, tone }: { name: string; tone: string }) {
  const parts = String(name || "?").trim().split(/\s+/);
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  return <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${tone}`}>{initials}</div>;
}

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
  // Debounce tìm kiếm nhân viên: lọc lại sau khi ngừng gõ, kết quả không đổi.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [sortBy, setSortBy] = useState("name");
  const [page, setPage] = useState(1);
  // "" = tất cả, "__none" = chưa có chức vụ, còn lại = id chức vụ
  const [filterPosition, setFilterPosition] = useState("");
  const [posOpen, setPosOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    full_name: "",
    phone: "",
    birthday: "",
    username: "",
    password: "123456",
    is_admin: Number(0),
    branch_ids: [] as string[],
    position_id: "",
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

  const staff = useMemo(() => (users ?? []).filter((u) => Number(u.is_admin) !== 1), [users]);
  const posOrder = useMemo(
    () => new Map<string, number>(((opts as any)?.positions ?? []).map((p: any, i: number) => [p.id, i] as [string, number])),
    [opts],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return staff
      .filter((u) => {
        if (!filterPosition) return true;
        const has = u.position_id && posOrder.has(u.position_id);
        return filterPosition === "__none" ? !has : u.position_id === filterPosition;
      })
      .filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          String(u.phone ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))
      )
      .sort((a, b) => {
        if (sortBy === "name") return a.full_name.localeCompare(b.full_name, "vi");
        if (sortBy === "position") {
          const pa = posOrder.get(a.position_id ?? "") ?? 999;
          const pb = posOrder.get(b.position_id ?? "") ?? 999;
          return pa - pb || a.full_name.localeCompare(b.full_name, "vi");
        }
        if (sortBy === "perm") return b.permissions.length - a.permissions.length;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [staff, debouncedSearch, sortBy, filterPosition, posOrder]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [filtered, page]
  );

  function toggleAddBranch(bid: string) {
    setAddForm((f) => {
      const isSelected = f.branch_ids.includes(bid);
      return {
        ...f,
        branch_ids: isSelected
          ? f.branch_ids.filter((x) => x !== bid)
          : [...f.branch_ids, bid],
      };
    });
  }

  function toggleAddAllBranches() {
    setAddForm((f) => {
      const allIds = opts?.branches.map((b: any) => b.id || b.name) || [];
      const isAllSelected = f.branch_ids.length === allIds.length;
      return {
        ...f,
        branch_ids: isAllSelected ? [] : allIds,
      };
    });
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!addForm.full_name || !addForm.username || !addForm.password) {
      toast.error("Vui lòng điền đủ thông tin");
      return;
    }

    setAddLoading(true);
    try {
      let finalBranches = addForm.branch_ids;
      if (finalBranches.length === 0 && opts?.branches) {
        finalBranches = opts.branches.map((b: any) => b.id || b.name);
      }

      await doRegister({
        data: {
          ...addForm,
          branch_ids: finalBranches,
          actor_id: me?.id,
        },
      });
      
      toast.success("Đã tạo tài khoản nhân viên");
      setAddOpen(false);
      setAddForm({
        full_name: "",
        phone: "",
        birthday: "",
        username: "",
        password: "123456",
        is_admin: Number(0),
        branch_ids: [],
        position_id: "",
      });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi tạo tài khoản");
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

  function toggleAllGrantBranches() {
    const allIds = opts?.branches.map((b: any) => b.id || b.name) || [];
    setGrantBranches((prev) => (prev.length === allIds.length ? [] : allIds));
  }

  async function handleSavePerms() {
    setPermLoading(true);
    try {
      let finalBranches = grantBranches;
      if (finalBranches.length === 0 && opts?.branches) {
        finalBranches = opts.branches.map((b: any) => b.id || b.name);
      }

      await doUpdatePerms({
        data: {
          user_ids: selectedUsers,
          permissions: grantPerms,
          branch_ids: finalBranches,
        },
      });

      toast.success(
        selectedUsers.length > 1
          ? `Đã cập nhật quyền cho ${selectedUsers.length} nhân viên`
          : "Đã cập nhật quyền thành công"
      );

      setPermOpen(false);
      setBulkSelect([]);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi lưu quyền");
    } finally {
      setPermLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa tài khoản "${name}"? Hành động này không thể hoàn tác.`)) return;

    try {
      await doDelete({ data: { id, actor_id: me?.id } });
      toast.success("Đã xóa tài khoản");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi khi xóa");
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
      toast.error(err?.message ?? "Lỗi đổi mật khẩu");
    } finally {
      setResetLoading(false);
    }
  }

  function toggleBulk(id: string) {
    setBulkSelect((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const viewUser = viewId ? users?.find((u) => u.id === viewId) : null;

  // Ô sửa ngày sinh trong dialog xem nhân viên.
  const updateProfileFn = useServerFn(updateUserProfileFn);
  const [birthdayDraft, setBirthdayDraft] = useState("");
  const [savingBirthday, setSavingBirthday] = useState(false);
  const [savingPosition, setSavingPosition] = useState(false);
  // Mở nhân viên khác thì nạp lại giá trị của người đó, không giữ lại bản nháp cũ.
  useEffect(() => {
    setBirthdayDraft(viewUser?.birthday ? String(viewUser.birthday).slice(0, 10) : "");
  }, [viewId, viewUser?.birthday]);
  const allBranchesCount = opts?.branches?.length || 0;

  // ── Chức vụ ──
  const positions: any[] = opts?.positions ?? [];
  const positionById = useMemo(() => new Map(positions.map((p: any, i: number) => [p.id, { ...p, idx: i }])), [positions]);
  const positionCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of staff) {
      const k = u.position_id && positionById.has(u.position_id) ? u.position_id : "__none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [staff, positionById]);

  const branchNamesOf = (u: any): string[] => {
    const isAll = u.branch_ids.length === 0 || u.branch_ids.length === allBranchesCount;
    if (isAll) return ["Tất cả chi nhánh"];
    return u.branch_ids.map((bid: string) => opts?.branches.find((b: any) => b.id === bid || b.name === bid)?.name ?? bid);
  };

  const PositionBadge = ({ id, size = "sm" }: { id?: string; size?: "sm" | "md" }) => {
    const p = id ? positionById.get(id) : null;
    if (!p) return <span className={`text-muted-foreground/70 ${size === "md" ? "text-sm" : "text-xs"}`}>Chưa có chức vụ</span>;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border font-medium ${size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"} ${POSITION_COLORS[p.idx % POSITION_COLORS.length]}`}>
        <Briefcase className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
        {p.name}
      </span>
    );
  };

  const PermChips = ({ perms }: { perms: string[] }) =>
    perms.length === 0 ? (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <ShieldOff className="h-3 w-3" /> Chỉ xem cơ bản
      </span>
    ) : (
      <div className="flex flex-wrap gap-1">
        {perms.slice(0, 2).map((p) => (
          <span key={p} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {ALL_PERMISSIONS.find((x) => x.key === p)?.label ?? p}
          </span>
        ))}
        {perms.length > 2 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={perms.slice(2).map((p) => ALL_PERMISSIONS.find((x) => x.key === p)?.label ?? p).join(", ")}>
            +{perms.length - 2}
          </span>
        )}
      </div>
    );

  const ActionButtons = ({ u }: { u: any }) => (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button className="rounded-md p-1.5 hover:bg-muted hover:text-blue-600" title="Xem chi tiết" onClick={() => setViewId(u.id)}>
        <Eye className="h-4 w-4" />
      </button>
      {isAdmin && (
        <>
          <button className="rounded-md p-1.5 hover:bg-muted hover:text-primary" title="Cấp quyền" onClick={() => openPermDialog([u.id])}>
            <ShieldCheck className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-1.5 hover:bg-muted hover:text-orange-600"
            title="Reset mật khẩu"
            onClick={() => {
              setResetPwId(u.id);
              setNewPw("123456");
            }}
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button className="rounded-md p-1.5 hover:bg-muted hover:text-destructive" title="Xóa" onClick={() => handleDelete(u.id, u.full_name)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <AppShell title="Quản lý nhân viên" loading={!users}>
      {/* ── Thống kê ── */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Tổng nhân viên", value: staff.length, Icon: Users, tone: "bg-slate-100 text-slate-700" },
          { label: "Đã cấp quyền", value: staff.filter((u) => u.permissions.length > 0).length, Icon: ShieldCheck, tone: "bg-primary/10 text-primary" },
          { label: "Chưa có chức vụ", value: positionCount.get("__none") ?? 0, Icon: Briefcase, tone: "bg-amber-100 text-amber-700" },
        ].map(({ label, value, Icon, tone }) => (
          <Card key={label} className="flex items-center gap-3">
            <div className={`grid h-10 w-10 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
            <div>
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="text-2xl font-bold tabular-nums">{value}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {/* ── Tiêu đề + thao tác ── */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="mr-auto flex items-center gap-2 text-base font-semibold">
            <Users className="h-5 w-5 text-primary" /> Danh sách nhân viên
          </div>
          {bulkSelect.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => openPermDialog(bulkSelect)}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              Cấp quyền cho {bulkSelect.length} người
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setPosOpen(true)}>
              <Briefcase className="mr-1 h-4 w-4" /> Chức vụ
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Thêm nhân viên
            </Button>
          )}
        </div>

        {/* ── Lọc theo chức vụ ── */}
        <div className="flex flex-wrap gap-1.5 border-b bg-slate-50/60 px-4 py-2.5">
          {[
            { key: "", label: "Tất cả", n: staff.length },
            ...positions.map((p: any) => ({ key: p.id, label: p.name, n: positionCount.get(p.id) ?? 0 })),
            { key: "__none", label: "Chưa có chức vụ", n: positionCount.get("__none") ?? 0 },
          ].map((c) => (
            <button
              key={c.key || "all"}
              onClick={() => {
                setFilterPosition(c.key);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                filterPosition === c.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {c.label} <span className={filterPosition === c.key ? "opacity-80" : "text-muted-foreground"}>{c.n}</span>
            </button>
          ))}
        </div>

        <div className="px-4 pt-3">
          <SearchFilter
            search={search}
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Tìm tên, username, SĐT..."
            sortOptions={[
              { value: "name", label: "Tên A→Z" },
              { value: "position", label: "Theo chức vụ" },
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
        </div>

        {/* ── Bảng (màn hình vừa trở lên) ── */}
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-y bg-slate-50 text-left text-[13px] text-slate-600">
              {isAdmin && (
                <th className="w-10 py-2.5 pl-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={bulkSelect.length === filtered.length && filtered.length > 0}
                    onChange={(e) => setBulkSelect(e.target.checked ? filtered.map((u) => u.id) : [])}
                  />
                </th>
              )}
              <th className="py-2.5 pl-4 font-semibold">Nhân viên</th>
              <th className="px-3 font-semibold">Chức vụ</th>
              <th className="px-3 font-semibold">Liên hệ</th>
              <th className="px-3 font-semibold">Chi nhánh</th>
              <th className="px-3 font-semibold">Quyền được cấp</th>
              <th className="pr-4" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((u) => {
              const branches = branchNamesOf(u);
              return (
                <tr key={u.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/30" onClick={() => setViewId(u.id)}>
                  {isAdmin && (
                    <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4" checked={bulkSelect.includes(u.id)} onChange={() => toggleBulk(u.id)} />
                    </td>
                  )}
                  <td className="py-3 pl-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.full_name} tone={u.position_id && positionById.has(u.position_id) ? AVATAR_TONES[positionById.get(u.position_id).idx % AVATAR_TONES.length] : "bg-slate-200 text-slate-600"} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-800">{u.full_name}</div>
                        <div className="font-mono text-xs text-muted-foreground">@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3"><PositionBadge id={u.position_id} /></td>
                  <td className="px-3">
                    {u.phone ? (
                      <span className="flex items-center gap-1.5 tabular-nums text-slate-700"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{u.phone}</span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="max-w-[220px] px-3">
                    <div className="flex flex-wrap gap-1">
                      {branches.slice(0, 2).map((b) => (
                        <span key={b} className="max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{b}</span>
                      ))}
                      {branches.length > 2 && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-muted-foreground" title={branches.slice(2).join(", ")}>+{branches.length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3"><PermChips perms={u.permissions} /></td>
                  <td className="pr-4"><ActionButtons u={u} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Thẻ (điện thoại) ── */}
        <div className="divide-y md:hidden">
          {paginated.map((u) => {
            const branches = branchNamesOf(u);
            return (
              <div key={u.id} className="flex gap-3 px-4 py-3 active:bg-muted/40" onClick={() => setViewId(u.id)}>
                <Avatar name={u.full_name} tone={u.position_id && positionById.has(u.position_id) ? AVATAR_TONES[positionById.get(u.position_id).idx % AVATAR_TONES.length] : "bg-slate-200 text-slate-600"} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{u.full_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">@{u.username}{u.phone ? ` · ${u.phone}` : ""}</div>
                    </div>
                    <ActionButtons u={u} />
                  </div>
                  <PositionBadge id={u.position_id} />
                  <div className="truncate text-xs text-muted-foreground"><Building2 className="mr-1 inline h-3 w-3" />{branches.join(", ")}</div>
                  <PermChips perms={u.permissions} />
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && <div className="py-10 text-center text-muted-foreground">Không có nhân viên phù hợp</div>}
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
              <Label>Chức vụ</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={addForm.position_id}
                onChange={(e) => setAddForm({ ...addForm, position_id: e.target.value })}
              >
                <option value="">— Chưa chọn —</option>
                {((opts as any)?.positions ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
              <Label>Ngày sinh</Label>
              <Input
                type="date"
                className="mt-1"
                value={addForm.birthday}
                onChange={(e) => setAddForm({ ...addForm, birthday: e.target.value })}
              />
              <div className="text-xs text-muted-foreground mt-1">
                Chỉ dùng để nhắc sinh nhật nội bộ trong trang Chăm sóc KH. Không gửi tin cho nhân viên.
              </div>
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
              <div className="mt-1 space-y-1 border rounded-md p-2 max-h-[200px] overflow-y-auto">
                <label className="flex items-center gap-2 text-sm cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={addForm.branch_ids.length === allBranchesCount || addForm.branch_ids.length === 0}
                    onChange={toggleAddAllBranches}
                  />
                  <span className="font-medium">Tất cả chi nhánh</span>
                </label>

                <hr className="border-border my-1" />

                {opts?.branches.map((b: any) => {
                  const targetId = b.id || b.name;
                  return (
                    <label key={targetId} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={addForm.branch_ids.includes(targetId)}
                        onChange={() => toggleAddBranch(targetId)}
                      />
                      {b.name}
                    </label>
                  );
                })}
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
                <div className="flex items-center gap-3">
                  <Avatar
                    name={viewUser.full_name}
                    tone={viewUser.position_id && positionById.has(viewUser.position_id) ? AVATAR_TONES[positionById.get(viewUser.position_id).idx % AVATAR_TONES.length] : "bg-slate-200 text-slate-600"}
                  />
                  <div className="min-w-0">
                    <DialogTitle className="text-lg">{viewUser.full_name}</DialogTitle>
                    <DialogDescription className="mt-0.5">
                      <PositionBadge id={viewUser.position_id} />
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {isAdmin && (
                    <div className="col-span-2 rounded-lg border p-3">
                      <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Briefcase className="h-3 w-3" /> Chức vụ
                      </div>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={viewUser.position_id ?? ""}
                        disabled={savingPosition}
                        onChange={async (e) => {
                          setSavingPosition(true);
                          try {
                            await (updateProfileFn as any)({ data: { user_id: viewUser.id, position_id: e.target.value || null, admin_id: me?.id } });
                            toast.success("Đã lưu chức vụ");
                            qc.invalidateQueries({ queryKey: ["users"] });
                          } catch (err: any) {
                            toast.error(err?.message ?? "Lỗi lưu chức vụ");
                          } finally {
                            setSavingPosition(false);
                          }
                        }}
                      >
                        <option value="">— Chưa có chức vụ —</option>
                        {positions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
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
                      {(viewUser.branch_ids.length === 0 || viewUser.branch_ids.length === allBranchesCount)
                        ? "Tất cả chi nhánh"
                        : viewUser.branch_ids
                            .map(
                              (bid) => opts?.branches.find((b: any) => (b.id === bid || b.name === bid))?.name ?? bid
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

                  {/* Ngày sinh sửa được ngay tại đây — nhân viên tạo trước
                      migration v11 đều chưa có, cần chỗ điền bổ sung. */}
                  <div className="col-span-2 rounded-lg border p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Cake className="h-3 w-3" /> Ngày sinh
                    </div>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="date"
                        className="h-9"
                        value={birthdayDraft}
                        onChange={(e) => setBirthdayDraft(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingBirthday || birthdayDraft === (viewUser.birthday ?? "")}
                        onClick={async () => {
                          setSavingBirthday(true);
                          try {
                            await updateProfileFn({
                              data: {
                                user_id: viewUser.id,
                                birthday: birthdayDraft || null,
                                admin_id: me?.id,
                              },
                            });
                            toast.success("Đã lưu ngày sinh");
                            qc.invalidateQueries({ queryKey: ["users"] });
                          } catch (e: any) {
                            toast.error(e?.message ?? "Lỗi lưu ngày sinh");
                          } finally {
                            setSavingBirthday(false);
                          }
                        }}
                      >
                        {savingBirthday ? "Đang lưu..." : "Lưu"}
                      </Button>
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
                    checked={grantBranches.length === allBranchesCount || grantBranches.length === 0}
                    onChange={toggleAllGrantBranches}
                  />
                  <div>
                    <div className="text-sm font-medium">Tất cả chi nhánh</div>
                    <div className="text-xs text-muted-foreground">
                      Nhân viên có thể hoạt động ở mọi chi nhánh
                    </div>
                  </div>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-[160px] overflow-y-auto">
                  {opts?.branches.map((b: any) => {
                    const targetId = b.id || b.name;
                    const checked = grantBranches.includes(targetId);
                    return (
                      <label
                        key={targetId}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all hover:bg-muted/40 ${
                          checked ? "border-primary bg-primary/5" : "bg-background"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBranch(targetId)}
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
              {(grantBranches.length === 0 || grantBranches.length === allBranchesCount) ? "Tất cả chi nhánh" : `${grantBranches.length} chi nhánh`}
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
      <PositionManager
        open={posOpen}
        onOpenChange={setPosOpen}
        positions={positions}
        counts={positionCount}
        adminId={me?.id}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["form-options"] });
          qc.invalidateQueries({ queryKey: ["users"] });
        }}
      />
    </AppShell>
  );
}

/** Thêm / đổi tên / xoá chức vụ (chỉ admin). */
function PositionManager({ open, onOpenChange, positions, counts, adminId, onChanged }: any) {
  const upsert = useServerFn(upsertPositionFn) as any;
  const del = useServerFn(deletePositionFn) as any;
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-primary" />Chức vụ</DialogTitle>
          <DialogDescription>Xoá một chức vụ thì nhân viên đang giữ chức vụ đó chuyển về "Chưa có chức vụ".</DialogDescription>
        </DialogHeader>
        {positions.length === 0 && (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Chưa có chức vụ nào. Nếu vừa cập nhật phần mềm, cần chạy <span className="font-mono">sql_migration_v18_positions.sql</span> trước.
          </div>
        )}
        <div className="divide-y rounded-lg border">
          {positions.map((p: any, i: number) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2">
              {editId === p.id ? (
                <>
                  <Input className="h-8" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && (await run(p.id, () => upsert({ data: { id: p.id, name: editName, admin_id: adminId } }), "Đã đổi tên"))) setEditId(null);
                      if (e.key === "Escape") setEditId(null);
                    }} />
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy === p.id}
                    onClick={async () => { if (await run(p.id, () => upsert({ data: { id: p.id, name: editName, admin_id: adminId } }), "Đã đổi tên")) setEditId(null); }}>
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-600" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium ${POSITION_COLORS[i % POSITION_COLORS.length]}`}>{p.name}</span>
                  <span className="mr-auto text-xs text-muted-foreground">{counts.get(p.id) ?? 0} người</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Đổi tên" onClick={() => { setEditId(p.id); setEditName(p.name); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Xoá" disabled={busy === p.id}
                    onClick={() => {
                      const n = counts.get(p.id) ?? 0;
                      if (!confirm(`Xoá chức vụ "${p.name}"?${n ? ` ${n} nhân viên sẽ về "Chưa có chức vụ".` : ""}`)) return;
                      run(p.id, () => del({ data: { id: p.id, admin_id: adminId } }), "Đã xoá chức vụ");
                    }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("new", () => upsert({ data: { name: newName, admin_id: adminId } }), "Đã thêm chức vụ")) setNewName("");
          }}
        >
          <Input placeholder="Tên chức vụ mới…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" disabled={!newName.trim() || busy === "new"}>
            {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Thêm
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
