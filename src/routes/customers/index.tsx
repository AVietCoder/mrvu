import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listCustomers,
  upsertCustomer,
  deleteCustomer,
} from "@/lib/customers.functions";

import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import {
  Pagination,
  DEFAULT_PAGE_SIZE,
} from "@/components/Pagination";

import { useAuth } from "@/context/AuthContext";

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
  Plus,
  ExternalLink,
  Pencil,
  Trash2,
  TrendingDown,
  TrendingUp,
  Eye,
  Phone,
  MapPin,
  Users,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { toast } from "sonner";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [{ title: "Khách hàng — QuatTran POS" }],
  }),
  component: CustomersPage,
});

const groupLabel: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};

const groupColor: Record<string, string> = {
  le: "bg-gray-100 text-gray-700",
  dai_ly: "bg-blue-100 text-blue-700",
  vip: "bg-yellow-100 text-yellow-700",
  cong_trinh: "bg-purple-100 text-purple-700",
};

const PROVINCES = [
  "An Giang",
  "Bà Rịa - Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

type FormState = {
  id?: string;
  name: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  address: string;
  group_name: string;
  debt: string;
};

const empty: FormState = {
  name: "",
  phone: "",
  province: "",
  district: "",
  ward: "",
  address: "",
  group_name: "le",
  debt: "0",
};

function CustomersPage() {
  const { user } = useAuth();

  const qc = useQueryClient();

  const list = useServerFn(listCustomers);
  const upsert = useServerFn(upsertCustomer);
  const del = useServerFn(deleteCustomer);

  const [form, setForm] = useState<FormState>(empty);

  const [open, setOpen] = useState(false);

  const [viewId, setViewId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [page, setPage] = useState(1);

  const [filterGroup, setFilterGroup] = useState("");
  const [filterDebt, setFilterDebt] = useState("all");
  const [filterTotalBuy, setFilterTotalBuy] = useState("all");

  const {
    data,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: [
      "customers",
      page,
      search,
      sortBy,
      filterGroup,
      filterDebt,
      filterTotalBuy,
    ],

    queryFn: () =>
      list({
        data: {
          page,
          pageSize: DEFAULT_PAGE_SIZE,
          search,
          group: filterGroup,
          debtFilter: filterDebt,
          totalBuyFilter: filterTotalBuy,
          sortBy,
        },
      }),

    placeholderData: (prev) => prev,

    staleTime: 1000 * 30,
  });

  const customers = data?.customers ?? [];
  const orders = data?.orders ?? [];

  const totalAllCustomers =
    data?.meta?.totalAllCustomers ?? 0;

  const totalDebtorCount =
    data?.meta?.totalDebtorCount ?? 0;

  const totalAllDebt =
    data?.meta?.totalAllDebt ?? 0;

  const totalFilteredCount =
    data?.meta?.totalFiltered ?? 0;

  const totalSales = useMemo(() => {
    return orders
      .filter((o) => o.status === "completed")
      .reduce((s, o) => s + o.total, 0);
  }, [orders]);

  function startEdit(id: string) {
    const c = customers.find((x) => x.id === id);

    if (!c) return;

    setForm({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      province: c.province ?? "",
      district: c.district ?? "",
      ward: c.ward ?? "",
      address: c.address ?? "",
      group_name: c.group_name,
      debt: String(c.debt),
    });

    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    try {
      await upsert({
        data: {
          ...form,
          debt: Number(form.debt) || 0,
        },
      });

      toast.success(
        form.id
          ? "Đã cập nhật khách hàng thành công!"
          : "Đã thêm khách hàng thành công!"
      );

      setOpen(false);

      setForm(empty);

      qc.invalidateQueries({
        queryKey: ["customers"],
      });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  async function handleDelete(
    id: string,
    name: string
  ) {
    if (!confirm(`Xóa khách hàng "${name}"?`)) return;

    try {
      await del({
        data: { id },
      });

      toast.success("Đã xóa");

      qc.invalidateQueries({
        queryKey: ["customers"],
      });
    } catch (err: any) {
      toast.error(err?.message ?? "Lỗi");
    }
  }

  const viewCustomer = viewId
    ? customers.find((c) => c.id === viewId)
    : null;

  const customerOrders = viewId
    ? orders.filter((o) => o.customer_id === viewId)
    : [];

  const completedOrders = customerOrders.filter(
    (o) => o.status === "completed"
  );

  const pendingOrders = customerOrders.filter(
    (o) =>
      o.status !== "completed" &&
      o.status !== "cancelled"
  );

  const totalSpent = completedOrders.reduce(
    (s, o) => s + o.total,
    0
  );

  return (
    <AppShell title="Khách hàng">

      {/* LOADING PROGRESS */}
      {(isLoading || isFetching) && (
        <div className="fixed left-0 right-0 top-0 z-[9999]">
          <div className="h-1 w-full overflow-hidden bg-primary/10">
            <div className="loading-bar h-full bg-primary" />
          </div>

          <div className="absolute right-4 top-3 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1 shadow-sm backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />

            <span className="text-xs font-medium text-muted-foreground">
              Đang tải dữ liệu khách hàng...
            </span>
          </div>
        </div>
      )}

      {/* STATS */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />

            <div className="text-xs uppercase text-muted-foreground">
              Tổng khách
            </div>
          </div>

          <div className="text-2xl font-semibold">
            {totalFilteredCount}
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />

            <div className="text-xs uppercase text-muted-foreground">
              Còn công nợ
            </div>
          </div>

          <div className="text-2xl font-semibold text-destructive">
            {totalDebtorCount}
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />

            <div className="text-xs uppercase text-muted-foreground">
              Tổng bán
            </div>
          </div>

          <div className="text-2xl font-semibold text-green-600">
            {fmt(totalSales)}
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-destructive" />

            <div className="text-xs uppercase text-muted-foreground">
              Tổng công nợ
            </div>
          </div>

          <div className="text-2xl font-semibold text-destructive">
            {fmt(totalAllDebt)}
          </div>
        </Card>
      </div>

      {/* TABLE */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="font-medium">
            Danh sách khách hàng
          </div>

          <Button
            size="sm"
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Thêm khách
          </Button>
        </div>

        <SearchFilter
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Tìm tên, số điện thoại..."
          sortOptions={[
            {
              value: "name",
              label: "Tên A→Z",
            },
            {
              value: "debt_desc",
              label: "Nợ nhiều nhất",
            },
            {
              value: "debt_asc",
              label: "Nợ ít nhất",
            },
            {
              value: "date",
              label: "Mới nhất",
            },
          ]}
          sortValue={sortBy}
          onSort={(v) => {
            setSortBy(v);
            setPage(1);
          }}
          filterSlot={
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterGroup}
                onChange={(e) => {
                  setFilterGroup(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">
                  Tất cả nhóm
                </option>

                {Object.entries(groupLabel).map(
                  ([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  )
                )}
              </select>

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterDebt}
                onChange={(e) => {
                  setFilterDebt(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">
                  Tất cả
                </option>

                <option value="debt">
                  Có công nợ
                </option>

                <option value="no_debt">
                  Không nợ
                </option>
              </select>
            </div>
          }
          total={totalFilteredCount}
          totalLabel="khách"
        />

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">
                  Tên khách hàng
                </th>

                <th className="pr-3">
                  SĐT
                </th>

                <th className="pr-3">
                  Địa chỉ
                </th>

                <th className="pr-3 text-right">
                  Tổng bán
                </th>

                <th className="pr-3 text-right">
                  Công nợ
                </th>

                <th className="text-right">
                  Thao tác
                </th>
              </tr>
            </thead>

            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => setViewId(c.id)}
                >
                  <td className="py-2 pr-3 font-medium">
                    <Link
                      to="/customers/$id"
                      params={{ id: c.id }}
                      className="hover:text-primary hover:underline"
                      onClick={(e) =>
                        e.stopPropagation()
                      }
                    >
                      {c.name}
                    </Link>
                  </td>

                  <td className="pr-3 text-muted-foreground">
                    {c.phone ?? "—"}
                  </td>

                  <td className="max-w-[150px] truncate pr-3 text-xs text-muted-foreground">
                    {[c.district, c.province]
                      .filter(Boolean)
                      .join(", ") ||
                      c.address ||
                      "—"}
                  </td>

                  <td className="pr-3 text-right font-medium text-green-600">
                    {fmt(c.total_buy || 0)}
                  </td>

                  <td
                    className={`pr-3 text-right font-medium ${
                      c.debt > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {c.debt > 0
                      ? fmt(c.debt)
                      : "—"}
                  </td>

                  <td
                    className="text-right"
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                  >
                    <Link
                      to="/customers/$id"
                      params={{ id: c.id }}
                      className="inline-flex p-1 hover:text-blue-600"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>

                    <button
                      className="p-1 hover:text-primary"
                      onClick={() =>
                        startEdit(c.id)
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      className="p-1 hover:text-destructive"
                      onClick={() =>
                        handleDelete(
                          c.id,
                          c.name
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {customers.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Không có kết quả
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
        total={totalFilteredCount}
        onPageChange={setPage}
        label="khách hàng"
      />

      {/* ADD / EDIT DIALOG */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id
                ? "Sửa khách hàng"
                : "Thêm khách hàng"}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={handleSave}
            className="space-y-3"
          >
            <div>
              <Label>Tên *</Label>

              <Input
                className="mt-1"
                value={form.name}
                required
                autoFocus
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: e.target.value,
                  })
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Hủy
              </Button>

              <Button type="submit">
                Lưu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <style>{`
        .loading-bar {
          animation: loading 1.2s ease-in-out infinite;
        }

        @keyframes loading {
          0% {
            transform: translateX(-100%);
            width: 40%;
          }

          50% {
            width: 60%;
          }

          100% {
            transform: translateX(250%);
            width: 40%;
          }
        }
      `}</style>
    </AppShell>
  );
}