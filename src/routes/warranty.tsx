// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Card } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { useWarrantyMeta } from "@/components/warranty/shared";
import { TicketsTab } from "@/components/warranty/TicketsTab";
import { ClaimsTab } from "@/components/warranty/ClaimsTab";
import { WarrantyReport } from "@/components/warranty/WarrantyReport";
import { WarrantySettings } from "@/components/warranty/WarrantySettings";
import { User, Store, Factory, Hourglass, BarChart3, Settings } from "lucide-react";

const TABS = [
  { key: "retail", label: "Khách lẻ", icon: User, admin: false },
  { key: "dealer", label: "Đại lý", icon: Store, admin: false },
  { key: "factory", label: "Nhà máy", icon: Factory, admin: true },
  { key: "awaiting", label: "Chờ NM trả hàng", icon: Hourglass, admin: true },
  { key: "report", label: "Báo cáo", icon: BarChart3, admin: false },
  { key: "settings", label: "Cài đặt", icon: Settings, admin: true },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const Route = createFileRoute("/warranty")({
  // ?tab=dealer|factory|awaiting|report|settings (mặc định: khách lẻ); &ticket=<id> → mở sẵn phiếu
  validateSearch: (s: Record<string, unknown>): { tab?: TabKey; ticket?: string } => ({
    ...(TABS.some((t) => t.key === s.tab) && s.tab !== "retail" ? { tab: s.tab as TabKey } : {}),
    ...(typeof s.ticket === "string" && s.ticket ? { ticket: s.ticket } : {}),
  }),
  component: WarrantyPage,
});

/**
 * Quản lý bảo hành: phiếu của khách lẻ / đại lý (theo chi nhánh được gán) và
 * hàng lỗi gửi nhà máy (chỉ admin).
 */
function WarrantyPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { isAdmin } = useAuth();
  const metaHook = useWarrantyMeta();
  // Phiếu vừa bấm "Gửi nhà máy" → chuyển sang tab Nhà máy và mở form điền sẵn.
  const [factoryFrom, setFactoryFrom] = useState<any>(null);

  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const tab: TabKey = tabs.some((t) => t.key === search.tab) ? (search.tab as TabKey) : "retail";
  const go = (key: TabKey) => navigate({ search: key === "retail" ? {} : { tab: key } });

  return (
    <AppShell title="Bảo hành">
      <div className="mb-4 flex w-full flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 sm:w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => go(key)}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium sm:flex-none ${tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {metaHook.meta && metaHook.meta.migrated === false && (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          Chưa chạy <strong>sql_migration_v23_warranty.sql</strong> trong Supabase — các bảng bảo hành chưa có nên chưa lưu được phiếu.
        </Card>
      )}

      {metaHook.meta && metaHook.meta.migrated !== false && metaHook.meta.migratedV24 === false && (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          Chưa chạy <strong>sql_migration_v24_warranty_two_tier.sql</strong> — hạn bảo hành động cơ đang tạm tính 120 tháng cho mọi mẫu và chưa lưu được "bộ phận lỗi" trên phiếu.
        </Card>
      )}

      {(tab === "retail" || tab === "dealer") && (
        <TicketsTab
          key={tab}
          kind={tab}
          metaHook={metaHook}
          openTicketId={search.ticket}
          onSendFactory={isAdmin ? (t: any) => { setFactoryFrom(t); go("factory"); } : undefined}
        />
      )}
      {(tab === "factory" || tab === "awaiting") && isAdmin && (
        <ClaimsTab
          key={tab}
          mode={tab === "awaiting" ? "awaiting" : "all"}
          metaHook={metaHook}
          fromTicket={tab === "factory" ? factoryFrom : undefined}
          onFromTicketDone={() => setFactoryFrom(null)}
        />
      )}
      {tab === "report" && <WarrantyReport metaHook={metaHook} />}
      {tab === "settings" && isAdmin && <WarrantySettings />}
    </AppShell>
  );
}
