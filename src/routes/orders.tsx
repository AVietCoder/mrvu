
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listOrders, createOrder, updateOrderStatus } from "@/lib/orders.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/orders")({
  head: () => ({ meta: [{ title: "Bán hàng — QuatTran POS" }] }),
  component: Page,
});

type LineItem = { product_id: string; qty: number; unit_price: number; discount: number };

function Page() {
  const list = useServerFn(listOrders);
  const create = useServerFn(createOrder);
  const updateStatus = useServerFn(updateOrderStatus);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["orders"], queryFn: () => list() });

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LineItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [branch, setBranch] = useState("");
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState<"completed" | "reserved" | "draft">("completed");
  const [discount, setDiscount] = useState("0");
  const [deposit, setDeposit] = useState("0");
  const [paid, setPaid] = useState("0");
  const [note, setNote] = useState("");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterBranch, setFilterBranch] = useState("");

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0), [items]);
  const total = Math.max(0, subtotal - (Number(discount) || 0));

  const filteredOrders = useMemo(() => {
    const orders = data?.orders ?? [];

    return orders
      .filter((o) => {
        const customerName = data?.customers.find((c) => c.id === o.customer_id)?.name ?? "";
        const q = search.toLowerCase();

        const matchSearch =
          o.code.toLowerCase().includes(q) ||
          customerName.toLowerCase().includes(q);

        const matchStatus = !filterStatus || o.status === filterStatus;
        const matchBranch = !filterBranch || o.branch_id === filterBranch;

        return matchSearch && matchStatus && matchBranch;
      })
      .sort((a, b) => {
        if (sortBy === "total_desc") return b.total - a.total;
        if (sortBy === "total_asc") return a.total - b.total;
        if (sortBy === "oldest") {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }

        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [data, search, sortBy, filterStatus, filterBranch]);

  function reset() {
    setItems([]);
    setCustomer("");
    setBranch(data?.branches[0]?.id ?? "");
    setEmployee("");
    setStatus("completed");
    setDiscount("0");
    setDeposit("0");
    setPaid(String(0));
    setNote("");
  }

  function addItem() {
    const p = data?.products[0];
    if (!p) return;
    setItems([...items, { product_id: p.id, qty: 1, unit_price: p.sale_price, discount: 0 }]);
  }

  async function submit() {
    if (items.length === 0) return toast.error("Đơn chưa có sản phẩm");
    if (!branch) return toast.error("Chọn chi nhánh");

    try {
      const r = await create({
        data: {
          customer_id: customer || undefined,
          branch_id: branch,
          employee_id: employee || undefined,
          status,
          discount: Number(discount) || 0,
          deposit: Number(deposit) || 0,
          paid: status === "completed" ? Number(paid) || 0 : 0,
          note: note || undefined,
          items,
        },
      });

      toast.success("Tạo đơn " + r.code);
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    }
  }

  return (
    <AppShell title="Bán hàng">
      <div className="mb-4">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" />Tạo đơn hàng</Button>
          </DialogTrigger>
        </Dialog>
      </div>

      <Card>
        <SearchFilter
          search={search}
          onSearch={setSearch}
          placeholder="Tìm mã đơn, khách hàng..."
          sortOptions={[
            { value: "newest", label: "Mới nhất" },
            { value: "oldest", label: "Cũ nhất" },
            { value: "total_desc", label: "Giá trị cao nhất" },
            { value: "total_asc", label: "Giá trị thấp nhất" },
          ]}
          sortValue={sortBy}
          onSort={setSortBy}
          filterSlot={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="completed">Hoàn tất</option>
                <option value="reserved">Đặt trước</option>
                <option value="draft">Nháp</option>
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
          total={filteredOrders.length}
          totalLabel="đơn hàng"
        />

        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2">Mã đơn</th>
              <th>Ngày</th>
              <th>Khách hàng</th>
              <th>Chi nhánh</th>
              <th>NV</th>
              <th className="text-right">Tổng</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filteredOrders.map((o) => {
              const cust = data?.customers.find((c) => c.id === o.customer_id)?.name ?? "Khách lẻ";
              const br = data?.branches.find((b) => b.id === o.branch_id)?.name ?? "—";
              const emp = data?.employees.find((e) => e.id === o.employee_id)?.name ?? "—";

              const labels: Record<string, string> = {
                completed: "Hoàn tất",
                reserved: "Đặt trước",
                draft: "Nháp",
                cancelled: "Hủy",
              };

              return (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{o.code}</td>
                  <td className="text-xs">{new Date(o.created_at).toLocaleString("vi-VN")}</td>
                  <td>{cust}</td>
                  <td>{br}</td>
                  <td>{emp}</td>
                  <td className="text-right font-medium">{fmt(o.total)}</td>
                  <td>
                    <span className="inline-block rounded px-2 py-0.5 text-xs bg-secondary">
                      {labels[o.status]}
                    </span>
                  </td>
                  <td className="text-right">
                    {o.status !== "completed" && o.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await updateStatus({ data: { id: o.id, status: "completed" } });
                          qc.invalidateQueries({ queryKey: ["orders"] });
                        }}
                      >
                        Hoàn tất
                      </Button>
                    )}
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