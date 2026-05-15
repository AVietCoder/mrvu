import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listInventory, createMovement, createTransfer, confirmTransfer, cancelTransfer } from "@/lib/inventory.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Repeat, Plus, Trash2, FileText, ShieldOff, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { hasPermission } from "@/lib/types";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Tồn kho — QuatTran POS" }] }),
  component: Page,
});

type MultiItem = { product_id: string; qty: number; unit_cost: number };

function Page() {
  const { user, isAdmin } = useAuth();
  const list = useServerFn(listInventory);
  const move = useServerFn(createMovement);
  const createTrf = useServerFn(createTransfer);
  const confirmTrf = useServerFn(confirmTransfer);
  const cancelTrf = useServerFn(cancelTransfer);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["inventory"], queryFn: () => list() });

  const canIn       = !!user && (isAdmin || hasPermission(user, "stock_in"));
  const canOut      = !!user && (isAdmin || hasPermission(user, "stock_out"));
  const canTransfer = !!user && (isAdmin || hasPermission(user, "stock_transfer"));
  const canAnyMove  = canIn || canOut || canTransfer;

  const [type, setType] = useState<"in" | "out" | "transfer">("in");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState(user?.branch_ids?.[0] ?? "");
  const [sortBy, setSortBy] = useState("name");
  const [stockBy, setStockBy] = useState("stock_desc");

  // Form nhập kho multi-item
  const [inBranch, setInBranch] = useState("");
  const [inNote, setInNote] = useState("");
  const [inItems, setInItems] = useState<MultiItem[]>([{ product_id: "", qty: 1, unit_cost: 0 }]);

  // Form xuất kho (single)
  const [outForm, setOutForm] = useState({ product_id: "", branch: "", qty: "1", note: "" });

  // Form chuyển kho
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferItems, setTransferItems] = useState<{ product_id: string; qty: number }[]>([{ product_id: "", qty: 1 }]);

  function startAction(t: "in" | "out" | "transfer") {
    if (t === "in" && !canIn) return toast.error("Bạn không có quyền nhập kho");
    if (t === "out" && !canOut) return toast.error("Bạn không có quyền xuất kho");
    if (t === "transfer" && !canTransfer) return toast.error("Bạn không có quyền chuyển kho");

    setType(t);
    const p0 = data?.products[0]?.id ?? "";
    const b0 = data?.branches[0]?.id ?? "";
    const b1 = data?.branches[1]?.id ?? b0;

    setInBranch(b0); setInNote("");
    setInItems([{ product_id: p0, qty: 1, unit_cost: 0 }]);

    setOutForm({ product_id: p0, branch: b0, qty: "1", note: "" });

    setTransferFrom(b0); setTransferTo(b1); setTransferNote("");
    setTransferItems([{ product_id: p0, qty: 1 }]);

    setOpen(true);
  }

  // Submit nhập kho — multi-item, tạo từng movement
  async function submitIn() {
    const valid = inItems.filter((i) => i.product_id && i.qty > 0);
    if (valid.length === 0) return toast.error("Vui lòng chọn ít nhất 1 sản phẩm");
    if (!inBranch) return toast.error("Chọn chi nhánh nhập hàng về");
    try {
      await Promise.all(valid.map((item) =>
        move({ data: {
          type: "in",
          product_id: item.product_id,
          branch_id: inBranch,
          qty: item.qty,
          unit_cost: item.unit_cost || undefined,
          note: inNote || undefined,
          created_by: user?.id,
        }})
      ));
      toast.success(`Đã nhập ${valid.length} mặt hàng vào kho`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  // Submit xuất kho — single
  async function submitOut() {
    if (!outForm.product_id) return toast.error("Chọn sản phẩm");
    if (!outForm.branch) return toast.error("Chọn chi nhánh");
    try {
      await move({ data: {
        type: "out",
        product_id: outForm.product_id,
        branch_id: outForm.branch,
        qty: Number(outForm.qty),
        note: outForm.note || undefined,
        created_by: user?.id,
      }});
      toast.success("Đã ghi nhận phiếu xuất kho");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  // Submit chuyển kho
  async function submitTransfer() {
    const validItems = transferItems.filter((i) => i.product_id && i.qty > 0);
    if (validItems.length === 0) return toast.error("Vui lòng chọn ít nhất 1 sản phẩm");
    if (transferFrom === transferTo) return toast.error("Chi nhánh nguồn và đích không được giống nhau");
    try {
      await createTrf({ data: {
        from_branch: transferFrom,
        to_branch: transferTo,
        items: validItems,
        note: transferNote || undefined,
        created_by: user?.id,
      }});
      toast.success(`Đã tạo phiếu chuyển ${validItems.length} sản phẩm (chờ chi nhánh nhận xác nhận)`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  function exportTransferTxt() {
    const validItems = transferItems.filter((i) => i.product_id && i.qty > 0);
    const fromName = data?.branches.find((b) => b.id === transferFrom)?.name ?? transferFrom;
    const toName = data?.branches.find((b) => b.id === transferTo)?.name ?? transferTo;
    const lines = validItems.map((item) => {
      const p = data?.products.find((x) => x.id === item.product_id);
      return `- ${p?.name ?? item.product_id} (SKU: ${p?.sku ?? ""}): ${item.qty} cái`;
    });
    const content = [
      "PHIẾU CHUYỂN KHO",
      `Từ: ${fromName}  →  Đến: ${toName}`,
      `Ngày: ${new Date().toLocaleDateString("vi-VN")}`,
      `Ghi chú: ${transferNote || "—"}`,
      "",
      "Danh sách sản phẩm:",
      ...lines,
      "",
      "Người lập phiếu: _______________    Người nhận: _______________",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `phieu-chuyen-kho-${Date.now()}.txt`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Đã xuất phiếu chuyển kho");
  }

  const products = data?.products ?? [];
  const branches = data?.branches ?? [];
  const pendingTransfers = (data?.transfers ?? []).filter((t: any) => t.status === "pending");

  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "sku") return a.sku.localeCompare(b.sku);
        const stockA = (data?.stock ?? []).filter((s) => s.product_id === a.id).reduce((x, y) => x + y.qty, 0);
        const stockB = (data?.stock ?? []).filter((s) => s.product_id === b.id).reduce((x, y) => x + y.qty, 0);
        return stockBy === "stock_asc" ? stockA - stockB : stockB - stockA;
      });
  }, [products, search, sortBy, stockBy, data?.stock]);

  const visibleBranches = filterBranch ? branches.filter((b) => b.id === filterBranch) : branches;

  return (
    <AppShell title="Quản lý tồn kho">
      {/* Nút hành động */}
      {canAnyMove ? (
        <div className="flex flex-wrap gap-2 mb-4">
          {canIn && (
            <Button onClick={() => startAction("in")}>
              <ArrowDownToLine className="h-4 w-4 mr-1" />Nhập kho
            </Button>
          )}
          {canOut && (
            <Button variant="secondary" onClick={() => startAction("out")}>
              <ArrowUpFromLine className="h-4 w-4 mr-1" />Xuất kho
            </Button>
          )}
          {canTransfer && (
            <Button variant="outline" onClick={() => startAction("transfer")}>
              <Repeat className="h-4 w-4 mr-1" />Chuyển kho
            </Button>
          )}
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <ShieldOff className="h-4 w-4" />
          Bạn chỉ có quyền xem tồn kho. Liên hệ quản trị viên để được cấp quyền nhập/xuất/chuyển kho.
        </div>
      )}

      {/* Phiếu chuyển kho đang chờ xác nhận */}
      {pendingTransfers.length > 0 && (
        <Card className="mb-4 border-yellow-200 bg-yellow-50/50">
          <div className="font-medium mb-2 text-yellow-800">Phiếu chuyển kho chờ xác nhận ({pendingTransfers.length})</div>
          <div className="space-y-2">
            {pendingTransfers.map((t: any) => {
              const fromName = branches.find((b) => b.id === t.from_branch)?.name ?? t.from_branch;
              const toName = branches.find((b) => b.id === t.to_branch)?.name ?? t.to_branch;
              const tItems = (data?.transfer_items ?? []).filter((i: any) => i.transfer_id === t.id);
              return (
                <div key={t.id} className="flex items-center gap-3 rounded border bg-white px-3 py-2 text-sm">
                  <div className="flex-1">
                    <span className="font-medium">{fromName}</span> → <span className="font-medium">{toName}</span>
                    <span className="ml-2 text-muted-foreground text-xs">({tItems.length} mặt hàng)</span>
                    {t.note && <span className="ml-2 text-muted-foreground text-xs">— {t.note}</span>}
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(t.created_at).toLocaleString("vi-VN")}</div>
                  </div>
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300"
                    onClick={async () => {
                      await confirmTrf({ data: { transfer_id: t.id } });
                      toast.success("Đã xác nhận nhận hàng");
                      qc.invalidateQueries({ queryKey: ["inventory"] });
                    }}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Xác nhận nhận
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30"
                    onClick={async () => {
                      await cancelTrf({ data: { transfer_id: t.id } });
                      toast.success("Đã hủy phiếu");
                      qc.invalidateQueries({ queryKey: ["inventory"] });
                    }}>
                    <XCircle className="h-4 w-4 mr-1" /> Hủy
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Bảng tồn kho */}
      <Card className="mb-6">
        <div className="font-medium mb-3">Tồn kho theo sản phẩm × chi nhánh</div>
        <SearchFilter
          search={search} onSearch={setSearch}
          placeholder="Tìm SKU, tên sản phẩm..."
          sortOptions={[
            { value: "name", label: "Tên A→Z" },
            { value: "sku", label: "SKU" },
            { value: "stock_desc", label: "Tồn nhiều nhất" },
            { value: "stock_asc", label: "Tồn ít nhất" },
          ]}
          sortValue={sortBy} onSort={setSortBy}
          filterSlot={
            <select className="h-9 rounded-md border bg-background px-2 text-sm"
              value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="">Tất cả chi nhánh</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          }
          total={filteredProducts.length} totalLabel="sản phẩm"
        />
        {isLoading ? (
          <div className="text-muted-foreground">Đang tải...</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="pr-3">Tên hàng</th>
                  {visibleBranches.map((b) => <th key={b.id} className="text-right pr-3">{b.name}</th>)}
                  <th className="text-right">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const cells = visibleBranches.map((b) =>
                    data?.stock.find((s) => s.product_id === p.id && s.branch_id === b.id)?.qty ?? 0
                  );
                  const total = cells.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-mono text-xs">{p.sku}</td>
                      <td className="pr-3 font-medium">{p.name}</td>
                      {cells.map((c, i) => (
                        <td key={i} className={`text-right pr-3 ${c <= p.min_stock ? "text-destructive font-medium" : ""}`}>{c}</td>
                      ))}
                      <td className="text-right font-semibold">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lịch sử phiếu */}
      <Card>
        <div className="font-medium mb-3">Lịch sử phiếu kho gần đây</div>
        {data && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">Thời gian</th>
                  <th className="pr-3">Loại</th>
                  <th className="pr-3">Sản phẩm</th>
                  <th className="pr-3">Từ → Đến</th>
                  <th className="text-right pr-3">SL</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m: any) => {
                  const p = data.products.find((x) => x.id === m.product_id);
                  const fr = data.branches.find((b) => b.id === m.from_branch)?.name ?? "—";
                  const to = data.branches.find((b) => b.id === m.to_branch)?.name ?? "—";
                  const labels: Record<string, string> = { in: "Nhập", out: "Xuất", transfer: "Chuyển" };
                  const colors: Record<string, string> = { in: "text-green-600", out: "text-red-600", transfer: "text-blue-600" };
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs">{new Date(m.created_at).toLocaleString("vi-VN")}</td>
                      <td className={`pr-3 font-medium ${colors[m.type]}`}>{labels[m.type]}</td>
                      <td className="pr-3">{p?.name}</td>
                      <td className="pr-3 text-xs">{fr} → {to}</td>
                      <td className="text-right pr-3">{m.qty}</td>
                      <td className="text-xs text-muted-foreground">{m.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Dialog nhập/xuất/chuyển kho */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {type === "in" ? "Phiếu nhập hàng" : type === "out" ? "Phiếu xuất kho" : "Phiếu chuyển kho"}
            </DialogTitle>
          </DialogHeader>

          {/* NHẬP KHO — multi-item */}
          {type === "in" && (
            <div className="space-y-3">
              <div>
                <Label>Chi nhánh nhập hàng về</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={inBranch} onChange={(e) => setInBranch(e.target.value)}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Danh sách mặt hàng nhập</Label>
                  <Button size="sm" variant="outline"
                    onClick={() => setInItems([...inItems, { product_id: products[0]?.id ?? "", qty: 1, unit_cost: 0 }])}>
                    <Plus className="h-3 w-3 mr-1" /> Thêm hàng
                  </Button>
                </div>
                {inItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <select className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                      value={item.product_id}
                      onChange={(e) => {
                        const n = [...inItems]; n[idx] = { ...item, product_id: e.target.value }; setInItems(n);
                      }}>
                      <option value="">— Chọn sản phẩm —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                    <Input type="number" className="w-16" placeholder="SL" value={item.qty}
                      onChange={(e) => {
                        const n = [...inItems]; n[idx] = { ...item, qty: Number(e.target.value) }; setInItems(n);
                      }} />
                    <Input type="number" className="w-24" placeholder="Đơn giá" value={item.unit_cost || ""}
                      onChange={(e) => {
                        const n = [...inItems]; n[idx] = { ...item, unit_cost: Number(e.target.value) }; setInItems(n);
                      }} />
                    <button className="p-1 hover:text-destructive" onClick={() => setInItems(inItems.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground mt-1">Cột: Sản phẩm — Số lượng — Đơn giá nhập</div>
              </div>

              <div>
                <Label>Ghi chú</Label>
                <Input className="mt-1" value={inNote} onChange={(e) => setInNote(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                <Button onClick={submitIn}>Xác nhận nhập kho</Button>
              </DialogFooter>
            </div>
          )}

          {/* XUẤT KHO — single (giữ nguyên) */}
          {type === "out" && (
            <div className="space-y-3">
              <div><Label>Sản phẩm</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={outForm.product_id} onChange={(e) => setOutForm({ ...outForm, product_id: e.target.value })}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select></div>
              <div><Label>Chi nhánh</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={outForm.branch} onChange={(e) => setOutForm({ ...outForm, branch: e.target.value })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <div><Label>Số lượng</Label><Input type="number" className="mt-1" value={outForm.qty} onChange={(e) => setOutForm({ ...outForm, qty: e.target.value })} /></div>
              <div><Label>Ghi chú</Label><Input className="mt-1" value={outForm.note} onChange={(e) => setOutForm({ ...outForm, note: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                <Button onClick={submitOut}>Xác nhận xuất kho</Button>
              </DialogFooter>
            </div>
          )}

          {/* CHUYỂN KHO — multi-item + pending */}
          {type === "transfer" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Từ chi nhánh</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></div>
                <div><Label>Đến chi nhánh</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Danh sách sản phẩm</Label>
                  <Button size="sm" variant="outline"
                    onClick={() => setTransferItems([...transferItems, { product_id: products[0]?.id ?? "", qty: 1 }])}>
                    <Plus className="h-3 w-3 mr-1" /> Thêm SP
                  </Button>
                </div>
                {transferItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <select className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                      value={item.product_id}
                      onChange={(e) => {
                        const n = [...transferItems]; n[idx] = { ...item, product_id: e.target.value }; setTransferItems(n);
                      }}>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                    <Input type="number" className="w-20" value={item.qty}
                      onChange={(e) => {
                        const n = [...transferItems]; n[idx] = { ...item, qty: Number(e.target.value) }; setTransferItems(n);
                      }} />
                    <button className="p-1 hover:text-destructive" onClick={() => setTransferItems(transferItems.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div><Label>Ghi chú</Label><Input className="mt-1" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} /></div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" size="sm" onClick={exportTransferTxt} className="flex items-center gap-1">
                  <FileText className="h-4 w-4" /> Xuất phiếu .txt
                </Button>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                  <Button onClick={submitTransfer}>Tạo phiếu chuyển</Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
