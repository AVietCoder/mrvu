// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listOrders, createOrder, updateOrderStatus } from "@/lib/orders.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, X, ShoppingBag, Clock, CalendarDays,
  ChevronLeft, ChevronRight, ExternalLink, Minus, Printer,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "Bán hàng — QuatTran POS" }] }),
  component: Page,
});

type LineItem = { product_id: string; qty: number; unit_price: number; discount: number };

function fmtInput(val: string): string {
  const num = val.replace(/\D/g, "");
  if (!num) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(num));
}
function parseInput(val: string): number {
  return Number(val.replace(/\D/g, "")) || 0;
}

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất", reserved: "Đặt trước", draft: "Nháp", cancelled: "Hủy",
};
const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  reserved: "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-100 text-red-700",
};

function printOrderSlip({ items, customer, branch, employee, status, discount, deposit, paid, note, subtotal, total, data, siteSettings }: any) {
  const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
  console.log(data);
  const custName = customer ? (data?.customers ?? []).find((c: any) => c.id === customer)?.name ?? "Khách lẻ" : "Khách lẻ";
  const branchName = branch ? (data?.branches ?? []).find((b: any) => b.id === branch)?.name ?? "—" : "—";
  const empName = employee ? (data?.employees ?? []).find((e: any) => e.id === employee)?.name ?? "—" : "—";
  const statusLabels: Record<string,string> = { completed: "Hoàn tất", reserved: "Đặt trước", draft: "Nháp" };
  const rows = items.map((item: any, i: number) => {
    const prod = (data?.products ?? []).find((p: any) => p.id === item.product_id);
    const lineTotal = item.qty * item.unit_price - (item.discount ?? 0);
    return `<tr>
      <td style="text-align:center;padding:8px;border:1px solid #ddd">${i+1}</td>
      <td style="padding:8px;border:1px solid #ddd">${prod?.name ?? item.product_id}</td>
      <td style="text-align:center;padding:8px;border:1px solid #ddd">${item.qty}</td>
      <td style="text-align:right;padding:8px;border:1px solid #ddd">${moneyFmt(item.unit_price)}</td>
      <td style="text-align:right;padding:8px;border:1px solid #ddd">${moneyFmt(lineTotal)}</td>
    </tr>`;
  }).join("");
  const pw = window.open("", "_blank");
  if (!pw) return;
  pw.document.write(`<!DOCTYPE html><html><head><title>Phiếu đặt hàng</title>
  <style>*{box-sizing:border-box;font-family:Arial,sans-serif}body{padding:40px;color:#111}
  .header{text-align:center;margin-bottom:28px}.title{font-size:26px;font-weight:700;margin-bottom:6px}
  .sub{color:#666;font-size:13px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:9px;font-size:14px}
  th{background:#f5f5f5;text-align:left}.total-box{margin-top:18px;text-align:right;font-size:14px}
  .total-main{font-size:22px;font-weight:700;margin-top:4px}.sign{margin-top:60px;display:grid;grid-template-columns:1fr 1fr;gap:40px;text-align:center}
  .sign-box{padding-top:10px}@media print{body{padding:0}}</style></head><body>
  <div class="header">
  ${siteSettings?.logo_url ? `<img src="${siteSettings.logo_url}" alt="Logo" style="height:60px;object-fit:contain;margin-bottom:8px" />` : ""}
  ${siteSettings?.site_name ? `<div style="font-size:15px;font-weight:600;color:#444;margin-bottom:4px">${siteSettings.site_name}</div>` : ""}
  <div class="title">PHIẾU ĐẶT HÀNG</div>
  <div class="sub">Ngày: ${new Date().toLocaleDateString("vi-VN")} &nbsp;|&nbsp; Trạng thái: ${statusLabels[status] ?? status}${siteSettings?.phone ? ` &nbsp;|&nbsp; ĐT: ${siteSettings.phone}` : ""}</div></div>
  <div class="info-grid">
    <div><strong>Khách hàng:</strong> ${custName}</div>
    <div><strong>Chi nhánh:</strong> ${branchName}</div>
    <div><strong>Nhân viên:</strong> ${empName}</div>
    <div><strong>Mã phiếu:</strong> #${Date.now().toString().slice(-6)}</div>
  </div>
  <table><thead><tr>
    <th style="width:50px;text-align:center">STT</th>
    <th>Sản phẩm</th>
    <th style="width:70px;text-align:center">SL</th>
    <th style="width:130px;text-align:right">Đơn giá</th>
    <th style="width:140px;text-align:right">Thành tiền</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="total-box">
    <div>Tạm tính: ${moneyFmt(subtotal)}</div>
    ${discount > 0 ? `<div>Giảm giá: - ${moneyFmt(discount)}</div>` : ""}
    <div class="total-main">Tổng cộng: ${moneyFmt(total)}</div>
    ${deposit > 0 ? `<div style="color:#b45309;margin-top:4px">Đặt cọc: ${moneyFmt(deposit)}</div>` : ""}
    ${paid > 0 ? `<div style="color:#15803d;margin-top:4px">Đã thanh toán: ${moneyFmt(paid)}</div>` : ""}
  </div>
  ${note ? `<div style="margin-top:20px;font-size:14px"><strong>Ghi chú:</strong> ${note}</div>` : ""}
  <div class="sign">
    <div class="sign-box"><div>Người lập phiếu</div><div style="margin-top:60px;font-weight:600">....................</div></div>
    <div class="sign-box"><div>Khách hàng xác nhận</div><div style="margin-top:60px">....................</div></div>
  </div>
  </body></html>`);
  pw.document.close();
  setTimeout(() => pw.print(), 300);
}

function Page() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listOrders);
  const create = useServerFn(createOrder);
  const updateStatus = useServerFn(updateOrderStatus);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["orders"], queryFn: () => listFn() });
  const getSettingsFn = useServerFn(getSettings);
  const { data: siteSettings } = useQuery({ queryKey: ["site_settings"], queryFn: () => getSettingsFn() });

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "reserved">("orders");
  const [page, setPage] = useState(1);

  // Form tạo đơn
  const [items, setItems] = useState<LineItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [branch, setBranch] = useState("");
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState<"completed" | "reserved" | "draft">("completed");
  const [discountRaw, setDiscountRaw] = useState("0");
  const [depositRaw, setDepositRaw] = useState("0");
  const [paidRaw, setPaidRaw] = useState("0");
  const [note, setNote] = useState("");

  // Filter / sort
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterBranch, setFilterBranch] = useState("");

  const discount = parseInput(discountRaw);
  const deposit  = parseInput(depositRaw);
  const paid     = parseInput(paidRaw);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [items],
  );
  const total = Math.max(0, subtotal - discount);

  const allOrders    = data?.orders ?? [];
  const invoiceOrders = useMemo(() => allOrders.filter((o) => o.status !== "reserved"), [allOrders]);
  const reservedOrders = useMemo(() => allOrders.filter((o) => o.status === "reserved"), [allOrders]);

  function applyFilter(list: typeof allOrders) {
    return list
      .filter((o) => {
        const custName = (data?.customers ?? []).find((c: any) => c.id === o.customer_id)?.name ?? "";
        const q = search.toLowerCase();
        return (
          (o.code.toLowerCase().includes(q) || custName.toLowerCase().includes(q)) &&
          (!filterStatus || o.status === filterStatus) &&
          (!filterBranch || o.branch_id === filterBranch)
        );
      })
      .sort((a, b) => {
        if (sortBy === "total_desc") return b.total - a.total;
        if (sortBy === "total_asc")  return a.total - b.total;
        if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }

  const filteredOrders = useMemo(
    () => applyFilter(activeTab === "reserved" ? reservedOrders : invoiceOrders),
    [data, search, sortBy, filterStatus, filterBranch, activeTab],
  );

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSearch(v: string) { setSearch(v); setPage(1); }
  function handleSort(v: string)   { setSortBy(v); setPage(1); }
  function handleTab(t: "orders" | "reserved") { setActiveTab(t); setPage(1); setSearch(""); setFilterStatus(""); }

  function reset() {
    setItems([]);
    setCustomer("");
    setBranch(data?.branches[0]?.id ?? "");
    // Mặc định nhân viên là người đang đăng nhập
    setEmployee(user?.id ?? "");
    setStatus("completed");
    setDiscountRaw("0");
    setDepositRaw("0");
    setPaidRaw("0");
    setNote("");
  }

  function addItem() {
    const p = data?.products[0];
    if (!p) return;
    setItems([...items, { product_id: p.id, qty: 1, unit_price: (p as any).sale_price, discount: 0 }]);
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
          discount,
          deposit,
          paid: status === "completed" ? paid : 0,
          note: note || undefined,
          items,
        },
      });
      toast.success("Tạo đơn " + r.code);
      reset();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  function OrderTable({ rows }: { rows: typeof allOrders }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2 pr-2 w-8 text-center">STT</th>
              <th className="pr-2">Mã đơn</th>
              <th className="pr-2">Ngày</th>
              <th className="pr-2">Khách hàng</th>
              <th className="pr-2">Chi nhánh</th>
              <th className="text-right pr-2">Tổng</th>
              <th className="pr-2">Trạng thái</th>
              <th className="pr-2">Lịch lắp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, idx) => {
              const customerMap = useMemo(() => {
                return new Map((data?.customers ?? []).map((c: any) => [c.id, c]));
              }, [data?.customers]);

              console.log(customerMap.size); // ✅ đúng
              const cust = customerMap.get(o.customer_id)?.name ?? "Khách lẻ";
              const br   = (data?.branches ?? []).find((b: any) => b.id === o.branch_id)?.name ?? "—";
              const linked = (data?.schedules ?? []).filter((s: any) => s.order_id === o.id);
              const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;
              return (
                <tr
                  key={o.id}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => navigate({ to: "/orders/$id", params: { id: o.id } })}
                >
                  <td className="py-2 text-center text-xs text-muted-foreground pr-2">{globalIdx}</td>
                  <td className="font-mono text-xs pr-2 font-medium">{o.code}</td>
                  <td className="text-xs text-muted-foreground pr-2 whitespace-nowrap">
                    {new Date(o.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="pr-2 max-w-[140px] truncate">{cust}</td>
                  <td className="pr-2 text-xs text-muted-foreground">{br}</td>
                  <td className="text-right font-medium pr-2 whitespace-nowrap">{fmt(o.total)}</td>
                  <td className="pr-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? "bg-secondary"}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="pr-2" onClick={(e) => e.stopPropagation()}>
                    {linked.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Link
                        to="/schedule"
                        className="inline-flex items-center gap-1 text-xs rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 hover:bg-blue-100"
                      >
                        <CalendarDays className="h-3 w-3" /> {linked.length} lịch
                      </Link>
                    )}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to="/orders/$id"
                      params={{ id: o.id }}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      title="Xem chi tiết"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Không có đơn nào</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AppShell title="Bán hàng" loading={!data}>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        {/* Dialog tạo đơn */}
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" />Tạo đơn hàng</Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Tạo đơn hàng</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Khách hàng</Label>
                  <SearchableSelect
                    value={customer}
                    onChange={setCustomer}
                    emptyLabel="Khách lẻ"
                    placeholder="Tìm khách hàng..."
                    options={(data?.customers ?? []).map((c: any) => ({
                      value: c.id,
                      label: c.name,
                      sub: c.phone ?? undefined,
                    }))}
                  />
                </div>
                <div>
                  <Label>Chi nhánh</Label>
                  <SearchableSelect
                    value={branch}
                    onChange={setBranch}
                    placeholder="Tìm chi nhánh..."
                    options={(data?.branches ?? []).map((b: any) => ({ value: b.id, label: b.name }))}
                  />
                </div>
                <div>
                  <Label>Nhân viên</Label>
                  <SearchableSelect
                    value={employee}
                    onChange={setEmployee}
                    emptyLabel="---"
                    placeholder="Tìm nhân viên..."
                    options={(data?.employees ?? []).map((e: any) => ({ value: e.id, label: e.name }))}
                  />
                </div>
                <div>
                  <Label>Trạng thái</Label>
                  <SearchableSelect
                    value={status}
                    onChange={(v) => setStatus(v as any)}
                    placeholder="Chọn trạng thái..."
                    options={[
                      { value: "completed", label: "Hoàn tất" },
                      { value: "reserved", label: "Đặt trước (chưa giao)" },
                      { value: "draft", label: "Nháp" },
                    ]}
                  />
                </div>
              </div>

              {/* Sản phẩm */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Sản phẩm</Label>
                  <Button size="sm" type="button" variant="outline" onClick={addItem}>
                    <Plus className="h-4 w-4 mr-1" />Thêm SP
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.length === 0 && <div className="text-muted-foreground text-sm py-2">Chưa có sản phẩm. Bấm "Thêm SP".</div>}
                  {items.map((item, idx) => {
                    const lineTotal = item.qty * item.unit_price - item.discount;
                    return (
                      <div key={idx} className="flex flex-col gap-1.5 rounded-lg border p-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <SearchableSelect
                            className="flex-1"
                            value={item.product_id}
                            onChange={(val) => {
                              const p = (data?.products ?? []).find((x: any) => x.id === val);
                              const next = [...items];
                              next[idx] = { ...next[idx], product_id: val, unit_price: (p as any)?.sale_price ?? 0 };
                              setItems(next);
                            }}
                            placeholder="Chọn sản phẩm..."
                            options={(data?.products ?? []).map((p: any) => ({
                              value: p.id,
                              label: p.name,
                              sub: p.sku ?? undefined,
                            }))}
                          />
                          <button type="button" className="flex items-center justify-center rounded-md border hover:text-destructive p-1.5 shrink-0"
                            onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center border rounded-md overflow-hidden shrink-0">
                            <button type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-r text-muted-foreground hover:text-foreground"
                              onClick={() => { const n = [...items]; n[idx].qty = Math.max(1, n[idx].qty - 1); setItems(n); }}>
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              className="w-12 text-center text-sm py-1.5 bg-background border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              value={item.qty}
                              min={1}
                              onChange={(e) => { const n = [...items]; n[idx].qty = Math.max(1, Number(e.target.value) || 1); setItems(n); }}
                            />
                            <button type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-l text-muted-foreground hover:text-foreground"
                              onClick={() => { const n = [...items]; n[idx].qty = n[idx].qty + 1; setItems(n); }}>
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input className="flex-1" placeholder="Đơn giá"
                            value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                            onChange={(e) => { const n = [...items]; n[idx].unit_price = parseInput(e.target.value); setItems(n); }} />
                          <div className="text-right text-sm font-semibold text-primary shrink-0 min-w-[80px]">{fmt(lineTotal)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Giảm giá (₫)</Label>
                  <Input className="mt-1" value={discountRaw} onChange={(e) => setDiscountRaw(fmtInput(e.target.value))} onFocus={(e) => e.target.select()} />
                </div>
                <div>
                  <Label>Đặt cọc (₫)</Label>
                  <Input className="mt-1" value={depositRaw} onChange={(e) => setDepositRaw(fmtInput(e.target.value))} onFocus={(e) => e.target.select()} />
                </div>
                <div>
                  <Label>Đã thanh toán (₫)</Label>
                  <Input className="mt-1" value={paidRaw} onChange={(e) => setPaidRaw(fmtInput(e.target.value))} onFocus={(e) => e.target.select()} />
                </div>
              </div>

              <div><Label>Ghi chú</Label><Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} /></div>

              <div className="rounded-lg border p-4 bg-muted/30">
                <div className="flex justify-between text-sm"><span>Tạm tính</span><span>{fmt(subtotal)}</span></div>
                <div className="flex justify-between text-sm mt-1"><span>Giảm giá</span><span>- {fmt(discount)}</span></div>
                <div className="flex justify-between font-semibold text-lg mt-2 pt-2 border-t">
                  <span>Tổng cộng</span><span>{fmt(total)}</span>
                </div>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)}>Hủy</Button>
                {items.length > 0 && (
                  <Button variant="outline" className="w-full sm:w-auto" type="button" onClick={() => printOrderSlip({ items, customer, branch, employee, status, discount, deposit, paid, note, subtotal, total, data, siteSettings })}>
                    <Printer className="h-4 w-4 mr-1" />In phiếu đặt hàng
                  </Button>
                )}
                <Button className="w-full sm:w-auto" onClick={submit}>Tạo đơn</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {reservedOrders.length > 0 && (
          <span className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />{reservedOrders.length} đơn đặt trước chờ giao
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "orders" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("orders")}
        >
          <ShoppingBag className="h-4 w-4 inline mr-1" />Hóa đơn bán hàng
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeTab === "reserved" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("reserved")}
        >
          <Clock className="h-4 w-4 inline mr-1" />Đơn đặt hàng
          {reservedOrders.length > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5">{reservedOrders.length}</span>
          )}
        </button>
      </div>

      <Card>
        <SearchFilter
          search={search} onSearch={handleSearch}
          placeholder="Tìm mã đơn, khách hàng..."
          sortOptions={[
            { value: "newest",     label: "Mới nhất" },
            { value: "oldest",     label: "Cũ nhất" },
            { value: "total_desc", label: "Giá trị cao nhất" },
            { value: "total_asc",  label: "Giá trị thấp nhất" },
          ]}
          sortValue={sortBy} onSort={handleSort}
          filterSlot={
            <div className="flex flex-wrap gap-2">
              {activeTab === "orders" && (
                <select className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
                  <option value="">Tất cả trạng thái</option>
                  <option value="completed">Hoàn tất</option>
                  <option value="draft">Nháp</option>
                  <option value="cancelled">Hủy</option>
                </select>
              )}
              <select className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}>
                <option value="">Tất cả chi nhánh</option>
                {(data?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          }
          total={filteredOrders.length}
          totalLabel={activeTab === "reserved" ? "đơn đặt hàng" : "đơn hàng"}
        />

        <OrderTable rows={pagedOrders} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm flex-wrap gap-2">
            <span className="text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredOrders.length)} / {filteredOrders.length}
            </span>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((n) => (
                <Button key={n} size="sm" variant={n === page ? "default" : "outline"} className="w-8 h-8 p-0" onClick={() => setPage(n)}>
                  {n}
                </Button>
              ))}
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
