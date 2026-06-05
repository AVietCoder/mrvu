// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { getSettings, updateSettings } from "@/lib/settings.functions";
import { buildInvoiceHtml } from "@/lib/print-invoice";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ImagePlus, Palette, Building2, Phone, Mail,
  FileText, Save, CheckCircle2, Trash2, Printer, Eye,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Cài đặt — Mr.Vũ" }] }),
  component: AdminPage,
});

const PRESET_COLORS = [
  { label: "Xanh dương", value: "#2563eb", bg: "#eff6ff" },
  { label: "Xanh lá",   value: "#16a34a", bg: "#f0fdf4" },
  { label: "Đỏ",        value: "#dc2626", bg: "#fef2f2" },
  { label: "Cam",        value: "#ea580c", bg: "#fff7ed" },
  { label: "Tím",        value: "#7c3aed", bg: "#f5f3ff" },
  { label: "Hồng",       value: "#db2777", bg: "#fdf2f8" },
  { label: "Xám đậm",   value: "#374151", bg: "#f9fafb" },
  { label: "Đen",        value: "#111827", bg: "#f3f4f6" },
];

function SectionCard({
  icon, title, subtitle, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b bg-muted/30 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0 text-primary">
          {icon}
        </div>
        <div>
          <div className="font-semibold text-base">{title}</div>
          <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function AdminPage() {
  const { isAdmin } = useAuth();
  const getSettingsFn = useServerFn(getSettings);
  const updateSettingsFn = useServerFn(updateSettings);
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["site_settings"],
    queryFn: () => getSettingsFn(),
  });

  const [siteName, setSiteName]       = useState("");
  const [logoUrl, setLogoUrl]         = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [address, setAddress]         = useState("");
  const [phone, setPhone]             = useState("");
  const [email, setEmail]             = useState("");
  const [taxCode, setTaxCode]         = useState("");
  const [adminEmail, setAdminEmail]   = useState("");
  const [bankAccounts, setBankAccounts] = useState<{bank:string;account_number:string;account_name:string;note:string}[]>([]);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  // ── Print / Email Templates ─────────────────────────────────
  // ── 4 template keys ─────────────────────────────────────────────────────
  type TplKey = "order_invoice" | "import_slip" | "transfer_slip" | "email_order";
  const TEMPLATE_META: Record<TplKey, { label: string; icon: string; desc: string }> = {
    order_invoice: { label: "Hóa đơn bán hàng", icon: "🧾", desc: "In khi tạo/hoàn tất đơn hàng" },
    import_slip:   { label: "Phiếu nhập kho",    icon: "📦", desc: "In khi nhập hàng vào kho" },
    transfer_slip: { label: "Phiếu chuyển kho",  icon: "🔄", desc: "In khi chuyển hàng giữa kho" },
    email_order:   { label: "Email thông báo",   icon: "✉️",  desc: "Nội dung gửi email cho khách & admin" },
  };
  const TEMPLATE_DEFAULTS: Record<TplKey, { header: string; footer: string; warranty: string; showWarranty: boolean; emailSubject?: string }> = {
    order_invoice: {
      header: "PHIẾU XUẤT KHO KIỂM BẢO HÀNH",
      footer: "Quạt trần {Ten_Cua_Hang} chân thành cảm ơn sự tin tưởng của Quý khách hàng!",
      warranty: "LƯU Ý: {Ten_Cua_Hang} KHUYẾN CÁO CẦN KIỂM TRA QUẠT ĐỊNH KỲ ÍT NHẤT 6 THÁNG/LẦN ĐỂ ĐẢM BẢO AN TOÀN TRONG QUÁ TRÌNH SỬ DỤNG.",
      showWarranty: true,
    },
    import_slip: {
      header: "PHIẾU NHẬP KHO",
      footer: "",
      warranty: "Hàng hoá được kiểm tra đầy đủ trước khi nhập kho. Mọi khiếu nại về số lượng/chất lượng vui lòng phản hồi trong vòng 24 giờ.",
      showWarranty: true,
    },
    transfer_slip: {
      header: "PHIẾU CHUYỂN KHO",
      footer: "",
      warranty: "Hàng hoá đã được kiểm tra đầy đủ trước khi bàn giao. Người nhận ký xác nhận chịu trách nhiệm sau khi nhận hàng.",
      showWarranty: true,
    },
    email_order: {
      header: "",
      footer: "Email tự động từ {Ten_Cua_Hang} — Vui lòng không trả lời email này.",
      warranty: "",
      showWarranty: false,
      emailSubject: "[{Ten_Cua_Hang}] Đơn hàng {Ma_Don_Hang} — {Khach_Hang}",
    },
  };

  const [printTpl, setPrintTpl] = useState<Record<string, any>>({});
  const [activeTpl, setActiveTpl] = useState<TplKey>("order_invoice");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [previewTpl, setPreviewTpl] = useState(false);

  // Sync server settings -> local form state whenever settings load/refetch
  useEffect(() => {
    if (!settings) return;
    setSiteName(settings.site_name ?? "");
    setLogoUrl(settings.logo_url ?? "");
    setPrimaryColor(settings.primary_color || "#2563eb");
    setAddress(settings.address ?? "");
    setPhone(settings.phone ?? "");
    setEmail(settings.email ?? "");
    setTaxCode(settings.tax_code ?? "");
    setAdminEmail(settings.admin_email ?? "");
    try { setBankAccounts(JSON.parse(settings.bank_accounts || "[]")); } catch { setBankAccounts([]); }
    // Load print templates
    try {
      const saved = JSON.parse((settings as any).print_templates || "{}");
      setPrintTpl(saved);
    } catch { setPrintTpl({}); }
  }, [settings]);

  async function savePrintTemplates() {
    setTemplateSaving(true);
    try {
      await updateSettingsFn({ data: { print_templates: JSON.stringify(printTpl) } });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2500);
      toast.success("Đã lưu mẫu in!");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu mẫu in");
    } finally {
      setTemplateSaving(false);
    }
  }

  function getTplField(key: TplKey, field: string): string {
    return printTpl[key]?.[field] ?? (TEMPLATE_DEFAULTS[key] as any)[field] ?? "";
  }
  function setTplField(key: TplKey, field: string, val: any) {
    setPrintTpl((prev: any) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [field]: val } }));
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ảnh quá lớn, vui lòng chọn ảnh dưới 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      await updateSettingsFn({
        data: { site_name: siteName, logo_url: logoUrl, primary_color: primaryColor, address, phone, email, tax_code: taxCode, admin_email: adminEmail, bank_accounts: JSON.stringify(bankAccounts) },
      });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast.success("Đã lưu cài đặt!");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu cài đặt");
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <AppShell title="Cài đặt">
        <div className="text-center py-20 text-muted-foreground">Bạn không có quyền truy cập trang này.</div>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell title="Cài đặt website">
        <div className="text-center py-20 text-muted-foreground text-sm">Đang tải...</div>
      </AppShell>
    );
  }

  const selectedPreset = PRESET_COLORS.find((c) => c.value === primaryColor);

  return (
    <AppShell title="Cài đặt website">
      <div className="space-y-5">

        {/* ── Logo & Tên ───────────────────────────────── */}
        <SectionCard
          icon={<ImagePlus className="h-5 w-5" />}
          title="Logo & Tên thương hiệu"
          subtitle="Hiển thị trên sidebar, phiếu in và tiêu đề trang"
        >
          <div className="flex items-start gap-5">
            {/* Logo drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 h-24 w-24 rounded-2xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/60 hover:bg-primary/5 transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5 overflow-hidden group"
              title="Bấm để chọn logo"
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
              ) : (
                <>
                  <ImagePlus className="h-7 w-7 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  <span className="text-[11px] text-muted-foreground/50 group-hover:text-primary/60 transition-colors font-medium">
                    Chọn ảnh
                  </span>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

            <div className="flex-1 space-y-3">
              <div>
                <Label className="text-sm font-medium">Tên website / thương hiệu</Label>
                <Input
                  className="mt-1.5"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Mr.Vũ"
                />
              </div>

              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl("")}
                  className="inline-flex items-center gap-1.5 text-xs text-destructive/70 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Xóa logo
                </button>
              )}

              <p className="text-xs text-muted-foreground">Định dạng PNG, JPG, SVG. Tối đa 2MB.</p>
            </div>
          </div>

          {/* Live preview */}
          {(logoUrl || siteName) && (
            <div className="mt-5 pt-5 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Xem trước trên sidebar</p>
              <div className="inline-flex items-center gap-2.5 px-4 py-3 rounded-xl border bg-muted/20">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-9 w-9 object-contain rounded-lg" />
                ) : (
                  <div
                    className="h-9 w-9 rounded-lg grid place-items-center text-sm font-bold"
                    style={{ backgroundColor: primaryColor + "22", color: primaryColor }}
                  >
                    {siteName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="text-sm font-semibold leading-tight">{siteName || "Tên website"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Hệ thống</div>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Màu sắc ──────────────────────────────────── */}
        <SectionCard
          icon={<Palette className="h-5 w-5" />}
          title="Màu sắc chủ đạo"
          subtitle="Tông màu chính hiển thị xuyên suốt giao diện"
        >
          {/* Preset swatches */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {PRESET_COLORS.map((c) => {
              const active = primaryColor === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setPrimaryColor(c.value)}
                  className={[
                    "relative h-12 rounded-xl flex items-center justify-center text-white text-xs font-semibold transition-all",
                    active ? "ring-2 ring-offset-2 scale-105 shadow-md" : "opacity-75 hover:opacity-100 hover:scale-102",
                  ].join(" ")}
                  style={{ backgroundColor: c.value, ["--tw-ring-color" as any]: c.value }}
                >
                  {c.label}
                  {active && (
                    <CheckCircle2 className="absolute top-1.5 right-1.5 h-3.5 w-3.5 drop-shadow" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom picker row */}
          <div className="flex items-center gap-3 pt-3 border-t">
            <span className="text-sm text-muted-foreground shrink-0">Màu tùy chỉnh:</span>
            <div className="relative">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-9 rounded-lg border cursor-pointer p-0.5 bg-background"
              />
            </div>
            <code className="text-sm font-mono bg-muted px-2 py-1 rounded-md">{primaryColor}</code>
            <div
              className="h-9 flex-1 rounded-lg border"
              style={{ background: `linear-gradient(135deg, ${primaryColor}33, ${primaryColor}88)` }}
            />
          </div>
        </SectionCard>

        {/* ── Thông tin doanh nghiệp ────────────────────── */}
        <SectionCard
          icon={<Building2 className="h-5 w-5" />}
          title="Thông tin doanh nghiệp"
          subtitle="Hiển thị trên phiếu in xuất/nhập kho và phiếu đặt hàng"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Địa chỉ
              </Label>
              <Input
                className="mt-1.5"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Đường ABC, Quận 1, TP. Hồ Chí Minh"
              />
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Số điện thoại
              </Label>
              <Input
                className="mt-1.5"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0909 000 001"
              />
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
              </Label>
              <Input
                className="mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@quatran.vn"
              />
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Mã số thuế
              </Label>
              <Input
                className="mt-1.5"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
                placeholder="0123456789"
              />
            </div>
          </div>

          {/* Print preview card */}
          {(siteName || phone || address) && (
            <div className="mt-5 pt-5 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Xem trước tiêu đề phiếu in</p>
              <div className="rounded-xl border p-4 bg-white text-center font-[Arial] text-sm space-y-1 shadow-sm">
                {logoUrl && <img src={logoUrl} alt="" className="h-12 object-contain mx-auto mb-2" />}
                {siteName && <div className="font-bold text-base">{siteName.toUpperCase()}</div>}
                {address && <div className="text-gray-500 text-xs">{address}</div>}
                <div className="text-gray-500 text-xs flex items-center justify-center gap-3 flex-wrap">
                  {phone && <span>ĐT: {phone}</span>}
                  {email && <span>{email}</span>}
                  {taxCode && <span>MST: {taxCode}</span>}
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Email thông báo Admin ──────────────────── */}
        <SectionCard
          icon={<Mail className="h-5 w-5" />}
          title="Email thông báo Admin"
          subtitle="Nhận email tự động khi có đơn hàng mới"
        >
          <div>
            <Label className="text-sm font-medium">Email nhận thông báo đơn hàng</Label>
            <Input
              className="mt-1.5"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@example.com"
              type="email"
            />
            <p className="text-xs text-muted-foreground mt-1">Email này nhận thông báo khi có đơn đặt hàng mới hoặc hoàn thành.</p>
          </div>
        </SectionCard>

        {/* ── Tài khoản ngân hàng ───────────────────── */}
        <SectionCard
          icon={<FileText className="h-5 w-5" />}
          title="Tài khoản ngân hàng"
          subtitle="Danh sách STK để khách chọn khi thanh toán chuyển khoản"
        >
          <div className="space-y-3">
            {bankAccounts.map((ba, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border p-3 bg-muted/20 relative">
                <button
                  type="button"
                  className="absolute top-2 right-2 p-1 hover:text-destructive text-muted-foreground"
                  onClick={() => setBankAccounts(bankAccounts.filter((_, i) => i !== idx))}
                  title="Xóa"
                ><Trash2 className="h-3.5 w-3.5" /></button>
                <div>
                  <Label className="text-xs">Tên ngân hàng</Label>
                  <Input className="mt-1 h-8 text-sm" value={ba.bank}
                    onChange={e => { const a = [...bankAccounts]; a[idx] = {...a[idx], bank: e.target.value}; setBankAccounts(a); }}
                    placeholder="VD: Vietcombank" />
                </div>
                <div>
                  <Label className="text-xs">Số tài khoản</Label>
                  <Input className="mt-1 h-8 text-sm" value={ba.account_number}
                    onChange={e => { const a = [...bankAccounts]; a[idx] = {...a[idx], account_number: e.target.value}; setBankAccounts(a); }}
                    placeholder="0123456789" />
                </div>
                <div>
                  <Label className="text-xs">Tên chủ tài khoản</Label>
                  <Input className="mt-1 h-8 text-sm" value={ba.account_name}
                    onChange={e => { const a = [...bankAccounts]; a[idx] = {...a[idx], account_name: e.target.value}; setBankAccounts(a); }}
                    placeholder="NGUYEN VAN A" />
                </div>
                <div>
                  <Label className="text-xs">Ghi chú</Label>
                  <Input className="mt-1 h-8 text-sm" value={ba.note}
                    onChange={e => { const a = [...bankAccounts]; a[idx] = {...a[idx], note: e.target.value}; setBankAccounts(a); }}
                    placeholder="Chi nhánh HCM..." />
                </div>
              </div>
            ))}
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={() => setBankAccounts([...bankAccounts, {bank:"",account_number:"",account_name:"",note:""}])}
            >
              <span className="text-lg leading-none">+</span> Thêm tài khoản ngân hàng
            </button>
          </div>
        </SectionCard>

        {/* ── Mẫu in & Email ──────────────────────────── */}
        <SectionCard
          icon={<Printer className="h-5 w-5" />}
          title="Mẫu in & Email"
          subtitle="Tùy chỉnh nội dung phiếu in và email gửi khách — chỉ Admin"
        >
          {/* Tab selector */}
          <div className="flex flex-wrap gap-2 mb-5">
            {(Object.entries(TEMPLATE_META) as [TplKey, any][]).map(([key, m]) => (
              <button key={key} type="button"
                onClick={() => setActiveTpl(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  activeTpl === key
                    ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                    : "border-border bg-background hover:bg-muted"
                }`}>
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Active template editor */}
          {(Object.keys(TEMPLATE_META) as TplKey[]).map((key) => activeTpl !== key ? null : (
            <div key={key} className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{TEMPLATE_META[key].icon} {TEMPLATE_META[key].label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{TEMPLATE_META[key].desc}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" type="button"
                    onClick={() => setPrintTpl((p: any) => { const n = {...p}; delete n[key]; return n; })}>
                    Khôi phục mặc định
                  </Button>
                  <Button size="sm" variant="outline" type="button"
                    onClick={() => setPreviewTpl(!previewTpl)}>
                    <Eye className="h-3.5 w-3.5 mr-1" /> {previewTpl ? "Ẩn xem trước" : "Xem trước"}
                  </Button>
                </div>
              </div>

              <div className={`grid gap-4 ${previewTpl ? "lg:grid-cols-2" : "grid-cols-1"}`}>
                {/* LEFT: form fields */}
                <div className="space-y-3">
                  {key !== "email_order" ? (
                    <>
                      <div>
                        <Label className="text-xs mb-1">Tiêu đề phiếu</Label>
                        <Input value={getTplField(key, "header")}
                          onChange={(e) => setTplField(key, "header", e.target.value)}
                          placeholder={TEMPLATE_DEFAULTS[key].header} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Chân trang</Label>
                        <Input value={getTplField(key, "footer")}
                          onChange={(e) => setTplField(key, "footer", e.target.value)}
                          placeholder={TEMPLATE_DEFAULTS[key].footer || "Để trống nếu không cần"} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-xs">Hiển thị chính sách bảo hành / lưu ý</Label>
                          <button type="button"
                            onClick={() => setTplField(key, "showWarranty", !getTplField(key, "showWarranty") )}
                            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${getTplField(key,"showWarranty") ? "bg-primary" : "bg-muted-foreground/30"}`}>
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${getTplField(key,"showWarranty") ? "translate-x-4" : "translate-x-0.5"}`} />
                          </button>
                        </div>
                        {getTplField(key, "showWarranty") && (
                          <Textarea value={getTplField(key, "warranty")}
                            onChange={(e) => setTplField(key, "warranty", e.target.value)}
                            className="min-h-[80px] text-sm"
                            placeholder={TEMPLATE_DEFAULTS[key].warranty} />
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <Label className="text-xs mb-1">Tiêu đề email (Subject)</Label>
                        <Input value={getTplField(key, "emailSubject")}
                          onChange={(e) => setTplField(key, "emailSubject", e.target.value)}
                          placeholder={TEMPLATE_DEFAULTS[key].emailSubject} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Chân trang email</Label>
                        <Input value={getTplField(key, "footer")}
                          onChange={(e) => setTplField(key, "footer", e.target.value)}
                          placeholder={TEMPLATE_DEFAULTS[key].footer} />
                      </div>
                    </>
                  )}
                  <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                    <div className="font-semibold text-foreground mb-1.5">Biến tự động (sẽ thay bằng dữ liệu thật khi in):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {["{Ten_Cua_Hang}","{Ma_Don_Hang}","{Khach_Hang}","{Dia_Chi}","{So_Dien_Thoai}","{Ngay}","{Thang}","{Nam}","{Tong_Tien}","{Nguoi_Lap}"].map(v => (
                        <code key={v} className="rounded bg-background border px-1.5 py-0.5 font-mono text-[11px] text-foreground">{v}</code>
                      ))}
                    </div>
                  </div>
                </div>

                {/* RIGHT: live preview — matches actual print output */}
                {previewTpl && (
                  <div className="rounded-xl border bg-white shadow overflow-hidden" style={{minHeight:420}}>
                    {key !== "email_order" ? (
                      /* ── Xem trước phiếu in thực tế — dùng buildInvoiceHtml để đồng bộ 100% ── */
                      <iframe
                        title={`preview-${key}`}
                        style={{width:"100%",minHeight:420,border:"none",display:"block"}}
                        srcDoc={buildInvoiceHtml({
                          order: {
                            code: "HD000001",
                            created_at: new Date().toISOString(),
                            status: key === "order_invoice" ? "completed" : "draft",
                            payment_method: "tien_mat",
                            subtotal: 4550000,
                            discount: 0,
                            discount_type: "fixed",
                            discount_pct: 0,
                            vat_rate: 0,
                            vat_amount: 0,
                            total: 4550000,
                            deposit: 0,
                            paid: 0,
                            note: "",
                          },
                          custName: "Nguyễn Văn A",
                          custPhone: "0909 123 456",
                          custAddress: "",
                          branchName: "Cửa hàng chính",
                          empName: "Nhân viên A",
                          items: [
                            { product_id: "__p1", qty: 2, unit_price: 1800000, discount: 0 },
                            { product_id: "__p2", qty: 1, unit_price: 950000,  discount: 0 },
                          ],
                          products: [
                            { id: "__p1", name: "Quạt trần MR.VŨ 120cm" },
                            { id: "__p2", name: "Quạt đứng MR.VŨ Pro" },
                          ],
                          moneyFmt: (n) => new Intl.NumberFormat("vi-VN").format(n) + " ₫",
                          ss: {
                            site_name: siteName || "Mr.Vũ",
                            logo_url: logoUrl || "",
                            address,
                            phone,
                            email,
                            tax_code: taxCode,
                            primary_color: primaryColor,
                            print_templates: JSON.stringify(printTpl),
                          },
                          tplOverride: {
                            header:      getTplField(key, "header")      || TEMPLATE_DEFAULTS[key].header,
                            footer:      getTplField(key, "footer")      || TEMPLATE_DEFAULTS[key].footer,
                            warranty:    getTplField(key, "warranty")    || TEMPLATE_DEFAULTS[key].warranty,
                            showWarranty: getTplField(key, "showWarranty") !== "" ? getTplField(key, "showWarranty") : TEMPLATE_DEFAULTS[key].showWarranty,
                          },
                          docLabel: key === "import_slip" ? "Phiếu nhập kho" : key === "transfer_slip" ? "Phiếu chuyển kho" : "Hóa đơn bán hàng",
                        })}
                      />
                    ) : (
                      /* Email preview */
                      <div style={{padding:20}}>
                        <div style={{background:"#f3f4f6",borderRadius:5,padding:"8px 12px",marginBottom:12,fontSize:11}}>
                          <strong>Tiêu đề:</strong> {(getTplField(key,"emailSubject")||TEMPLATE_DEFAULTS[key].emailSubject||"").replace("{Ten_Cua_Hang}", siteName||"Mr.Vũ").replace("{Ma_Don_Hang}","HD000001").replace("{Khach_Hang}","Nguyễn Văn A")}
                        </div>
                        <div style={{border:"1px solid #e5e7eb",borderRadius:5,padding:16}}>
                          <div style={{marginBottom:8}}>Kính gửi: <strong>Nguyễn Văn A</strong>,</div>
                          <div style={{marginBottom:8,lineHeight:1.7}}>Đơn hàng <strong>HD000001</strong> của bạn đã được ghi nhận.</div>
                          <div style={{background:"#f9fafb",borderRadius:4,padding:"8px 12px",marginBottom:8,fontSize:11}}>
                            <div>Sản phẩm: Quạt trần MR.VŨ 120cm x2 — 3.600.000 ₫</div>
                            <div style={{fontWeight:700,marginTop:4}}>Tổng: 4.550.000 ₫</div>
                          </div>
                          {(getTplField(key,"footer")||TEMPLATE_DEFAULTS[key].footer) && (
                            <div style={{borderTop:"1px solid #e5e7eb",paddingTop:8,fontSize:10,color:"#9ca3af"}}>
                              {(getTplField(key,"footer")||TEMPLATE_DEFAULTS[key].footer).replace("{Ten_Cua_Hang}", siteName||"Mr.Vũ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="flex justify-end mt-5 pt-4 border-t">
            <Button onClick={savePrintTemplates} disabled={templateSaving}
              className="h-9 px-6 text-sm gap-2"
              style={templateSaved ? { backgroundColor: "#16a34a" } : {}}>
              {templateSaved ? <><CheckCircle2 className="h-4 w-4" /> Đã lưu!</> : templateSaving ? "Đang lưu..." : <><Save className="h-4 w-4" /> Lưu mẫu in</>}
            </Button>
          </div>
        </SectionCard>

        {/* ── Save button ──────────────────────────────── */}
        <div className="flex justify-end pb-4">
          <Button
            onClick={save}
            disabled={saving}
            className="h-11 px-8 text-sm font-semibold gap-2 transition-all"
            style={saved ? { backgroundColor: "#16a34a" } : {}}
          >
            {saved ? (
              <><CheckCircle2 className="h-4 w-4" /> Đã lưu!</>
            ) : saving ? (
              "Đang lưu..."
            ) : (
              <><Save className="h-4 w-4" /> Lưu cài đặt</>
            )}
          </Button>
        </div>

      </div>
    </AppShell>
  );
}
