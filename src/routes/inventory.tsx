import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listInventory, createMovement } from "@/lib/inventory.functions";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Repeat, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Tồn kho — QuatTran POS" }] }),
  component: Page,
});

type TransferItem = { product_id: string; qty: number };

function Page() {
  const { user } = useAuth();
  const list = useServerFn(listInventory);
  const move = useServerFn(createMovement);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["inventory"], queryFn: () => list() });

  const [type, setType] = useState<"in" | "out" | "transfer">("in");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState(user?.branch_id ?? "");
  const [sortBy, setSortBy] = useState("name");

  // Single-product form (in/out)
  const [singleForm, setSingleForm] = useState({ product_id: "", branch: "", qty: "1", unit_cost: "0", note: "" });

  // Multi-product transfer form
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([{ product_id: "", qty: 1 }]);

  function startAction(t: "in" | "out" | "transfer") {
    setType(t);
    const p0 = data?.products[0]?.id ?? "";
    const b0 = data?.branches[0]?.id ?? "";
    const b1 = data?.branches[1]?.id ?? b0;
    setSingleForm({ product_id: p0, branch: b0, qty: "1", unit_cost: "0", note: "" });
    setTransferFrom(b0); setTransferTo(b1); setTransferNote("");
    setTransferItems([{ product_id: p0, qty: 1 }]);
    setOpen(true);
  }

  async function submitSingle() {
    try {
      await move({ data: {
        type,
        product_id: singleForm.product_id,
        from_branch: type === "in" ? undefined : singleForm.branch,
        to_branch: type === "out" ? undefined : singleForm.branch,
        qty: Number(singleForm.qty),
        unit_cost: Number(singleForm.unit_cost) || undefined,
        note: singleForm.note || undefined,
      }});
      toast.success("Đã ghi nhận phiếu kho");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  async function submitTransfer() {
    const validItems = transferItems.filter((i) => i.product_id && i.qty > 0);
    if (validItems.length === 0) return toast.error("Vui lòng chọn ít nhất 1 sản phẩm");
    if (transferFrom === transferTo) return toast.error("Chi nhánh nguồn và đích không được giống nhau");
    try {
      // Tạo từng movement cho mỗi sản phẩm
      await Promise.all(validItems.map((item) =>
        move({ data: {
          type: "transfer",
          product_id: item.product_id,
          from_branch: transferFrom,
          to_branch: transferTo,
          qty: item.qty,
          note: transferNote || undefined,
        }})
      ));
      toast.success(`Đã chuyển ${validItems.length} sản phẩm`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e: any) { toast.error(e?.message ?? "Lỗi"); }
  }

  // Xuất phiếu chuyển kho .docx (plain text fallback)
  function exportTransferDocx() {
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

    // Tạo file .txt (để xem nội dung; nếu cần .docx thật cần thêm thư viện docx)
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `phieu-chuyen-kho-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất phiếu chuyển kho");
  }

  // Filter inventory table
  const products = data?.products ?? [];
  const branches = data?.branches ?? [];

  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "sku") return a.sku.localeCompare(b.sku);
        // sort by total stock descending
        const stockA = (data?.stock ?? []).filter((s) => s.product_id === a.id).reduce((x, y) => x + y.qty, 0);
        const stockB = (data?.stock ?? []).filter((s) => s.product_id === b.id).reduce((x, y) => x + y.qty, 0);
        return stockBy === "stock_asc" ? stockA - stockB : stockB - stockA;
      });
  }, [products, search, sortBy, data?.stock]);

  const [stockBy, setStockBy] = useState("stock_desc");

  // Branch filter for columns
  const visibleBranches = filterBranch
    ? branches.filter((b) => b.id === filterBranch)
    : branches;

  return (
    <AppShell title="Quản lý tồn kho">
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={() => startAction("in")}><ArrowDownToLine className="h-4 w-4 mr-1" />Nhập kho</Button>
        <Button variant="secondary" onClick={() => startAction("out")}><ArrowUpFromLine className="h-4 w-4 mr-1" />Xuất kho</Button>
        <Button variant="outline" onClick={() => startAction("transfer")}><Repeat className="h-4 w-4 mr-1" />Chuyển kho</Button>
      </div>

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
                  <th className="text-right pr-3">Đã đặt</th>
                  <th className="text-right">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const cells = visibleBranches.map((b) =>
                    data?.stock.find((s) => s.product_id === p.id && s.branch_id === b.id)?.qty ?? 0
                  );
                  const reserved = (data?.stock ?? [])
                    .filter((s) => s.product_id === p.id)
                    .reduce((a, s) => a + 0, 0); // placeholder — reserved từ orders
                  const total = cells.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-mono text-xs">{p.sku}</td>
                      <td className="pr-3 font-medium">{p.name}</td>
                      {cells.map((c, i) => (
                        <td key={i} className={`text-right pr-3 ${c <= p.min_stock ? "text-destructive font-medium" : ""}`}>{c}</td>
                      ))}
                      <td className="text-right pr-3 text-muted-foreground">{reserved}</td>
                      <td className="text-right font-semibold">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lịch sử */}
      <Card>
        <div className="font-medium mb-3">Lịch sử phiếu kho gần đây</div>
        {data && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2 pr-3">Thời gian</th><th className="pr-3">Loại</th><th className="pr-3">Sản phẩm</th><th className="pr-3">Từ → Đến</th><th className="text-right pr-3">SL</th><th>Ghi chú</th></tr>
              </thead>
              <tbody>
                {data.movements.map((m) => {
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

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {type === "in" ? "Phiếu nhập kho" : type === "out" ? "Phiếu xuất kho" : "Phiếu chuyển kho (nhiều sản phẩm)"}
            </DialogTitle>
          </DialogHeader>

          {type !== "transfer" ? (
            /* Single product: in / out */
            <div className="space-y-3">
              <div><Label>Sản phẩm</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={singleForm.product_id} onChange={(e) => setSingleForm({ ...singleForm, product_id: e.target.value })}>
                  {data?.products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select></div>
              <div><Label>Chi nhánh</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={singleForm.branch} onChange={(e) => setSingleForm({ ...singleForm, branch: e.target.value })}>
                  {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <div><Label>Số lượng</Label><Input type="number" className="mt-1" value={singleForm.qty} onChange={(e) => setSingleForm({ ...singleForm, qty: e.target.value })} /></div>
              {type === "in" && <div><Label>Đơn giá nhập</Label><Input type="number" className="mt-1" value={singleForm.unit_cost} onChange={(e) => setSingleForm({ ...singleForm, unit_cost: e.target.value })} /></div>}
              <div><Label>Ghi chú</Label><Input className="mt-1" value={singleForm.note} onChange={(e) => setSingleForm({ ...singleForm, note: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                <Button onClick={submitSingle}>Xác nhận</Button>
              </DialogFooter>
            </div>
          ) : (
            /* Multi-product transfer */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Từ chi nhánh</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                    {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></div>
                <div><Label>Đến chi nhánh</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                    {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select></div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Danh sách sản phẩm</Label>
                  <Button size="sm" variant="outline" onClick={() => setTransferItems([...transferItems, { product_id: data?.products[0]?.id ?? "", qty: 1 }])}>
                    <Plus className="h-3 w-3 mr-1" /> Thêm SP
                  </Button>
                </div>
                {transferItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <select className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                      value={item.product_id}
                      onChange={(e) => {
                        const newItems = [...transferItems];
                        newItems[idx] = { ...item, product_id: e.target.value };
                        setTransferItems(newItems);
                      }}>
                      {data?.products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                    <Input type="number" className="w-20" value={item.qty}
                      onChange={(e) => {
                        const newItems = [...transferItems];
                        newItems[idx] = { ...item, qty: Number(e.target.value) };
                        setTransferItems(newItems);
                      }} />
                    <button className="p-1 hover:text-destructive" onClick={() => setTransferItems(transferItems.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div><Label>Ghi chú</Label><Input className="mt-1" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} /></div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" size="sm" onClick={exportTransferDocx} className="flex items-center gap-1">
                  <FileText className="h-4 w-4" /> Xuất phiếu .txt
                </Button>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button>
                  <Button onClick={submitTransfer}>Xác nhận chuyển</Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}