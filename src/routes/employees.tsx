
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listEmployees, upsertEmployee, deleteEmployee } from "@/lib/staff.functions";
import { AppShell, Card } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Nhân viên — QuatTran POS" }] }),
  component: Page,
});

const roleLabel: Record<string, string> = {
  admin: "Quản trị",
  manager: "Quản lý CH",
  cashier: "Thu ngân",
  warehouse: "Nhân viên kho",
};

type Form = {
  id?: string;
  name: string;
  phone: string;
  role: "admin" | "manager" | "cashier" | "warehouse";
  branch_id: string;
};

const empty: Form = {
  name: "",
  phone: "",
  role: "cashier",
  branch_id: "",
};

function Page() {
  const list = useServerFn(listEmployees);
  const upsert = useServerFn(upsertEmployee);
  const del = useServerFn(deleteEmployee);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["employees"], queryFn: () => list() });

  const [form, setForm] = useState<Form>(empty);
  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [filterRole, setFilterRole] = useState("");
  const [filterBranch, setFilterBranch] = useState("");

  const filteredEmployees = useMemo(() => {
    const employees = data?.employees ?? [];

    return employees
      .filter((e) => {
        const branchName = data?.branches.find((b) => b.id === e.branch_id)?.name ?? "";
        const q = search.toLowerCase();

        const matchSearch =
          e.name.toLowerCase().includes(q) ||
          (e.phone ?? "").includes(q) ||
          branchName.toLowerCase().includes(q);

        const matchRole = !filterRole || e.role === filterRole;
        const matchBranch = !filterBranch || e.branch_id === filterBranch;

        return matchSearch && matchRole && matchBranch;
      })
      .sort((a, b) => {
        if (sortBy === "role") return a.role.localeCompare(b.role);
        return a.name.localeCompare(b.name);
      });
  }, [data, search, sortBy, filterRole, filterBranch]);

  async function save() {
    try {
      await upsert({
        data: {
          id: form.id,
          name: form.name.trim(),
          phone: form.phone || undefined,
          role: form.role,
          branch_id: form.branch_id || undefined,
        },
      });

      toast.success("Đã lưu");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  return (
    <AppShell title="Quản lý nhân viên">
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">
            {filteredEmployees.length} nhân viên
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setForm(empty)}>
                <Plus className="h-4 w-4 mr-1" />
                Thêm nhân viên
              </Button>
            </DialogTrigger>
          </Dialog>
        </div>

        <SearchFilter
          search={search}
          onSearch={setSearch}
          placeholder="Tìm tên, SĐT, chi nhánh..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "role", label: "Vai trò" },
          ]}
          sortValue={sortBy}
          onSort={setSortBy}
          filterSlot={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
              >
                <option value="">Tất cả vai trò</option>
                {Object.entries(roleLabel).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
              >
                <option value="">Tất cả chi nhánh</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          }
          total={filteredEmployees.length}
          totalLabel="nhân viên"
        />

        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2">Tên</th>
              <th>SĐT</th>
              <th>Vai trò</th>
              <th>Chi nhánh</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filteredEmployees.map((e) => {
              const br = data?.branches.find((b) => b.id === e.branch_id)?.name ?? "—";

              return (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{e.name}</td>
                  <td>{e.phone}</td>
                  <td>
                    <span className="rounded px-2 py-0.5 text-xs bg-secondary">
                      {roleLabel[e.role]}
                    </span>
                  </td>
                  <td>{br}</td>
                  <td className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setForm({
                          id: e.id,
                          name: e.name,
                          phone: e.phone ?? "",
                          role: e.role,
                          branch_id: e.branch_id ?? "",
                        });

                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        if (confirm("Xóa?")) {
                          await del({ data: { id: e.id } });
                          qc.invalidateQueries({ queryKey: ["employees"] });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}