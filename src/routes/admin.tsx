// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { getSettings, updateSettings } from "@/lib/settings.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  ImagePlus, Palette, Building2, Phone, Mail,
  FileText, Save, CheckCircle2, Trash2,
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
  }, [settings]);

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
          <div className="grid grid-cols-4 gap-2 mb-4">
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
              <div key={idx} className="grid grid-cols-2 gap-2 rounded-lg border p-3 bg-muted/20 relative">
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
