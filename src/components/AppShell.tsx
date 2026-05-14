import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, UserCog,
  BarChart3, Building2, Fan, LogOut, Settings, ShieldCheck, ChevronDown,
  CalendarDays,
} from "lucide-react";
import { type ReactNode, useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import type { Permission } from "@/lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: any;
  // undefined = tất cả đều thấy, string = cần quyền này hoặc admin
  permission?: Permission | "admin";
};

const nav: NavItem[] = [
  { to: "/",          label: "Tổng quan",   icon: LayoutDashboard },
  { to: "/products",  label: "Hàng hóa",    icon: Package },
  { to: "/inventory", label: "Tồn kho",     icon: Boxes },
  { to: "/orders",    label: "Bán hàng",    icon: ShoppingCart,  permission: "create_order" },
  { to: "/customers", label: "Khách hàng",  icon: Users },
  { to: "/employees", label: "Nhân viên",   icon: UserCog,       permission: "admin" }, // ✏️ chỉ admin
  { to: "/reports",   label: "Báo cáo",     icon: BarChart3,     permission: "admin" }, // ✏️ doanh thu = admin-only
  { to: "/branches",  label: "Chi nhánh",   icon: Building2,     permission: "manage_branches" },
  { to: "/schedule", label: "Lịch làm việc", icon: CalendarDays, permission: "create_schedule" as Permission },
];


export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const loc = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // ← Fix hydration: chỉ render user-dependent UI sau khi mount ở client
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function handleLogout() {
    logout();
    navigate({ to: "/login" });
  }

  function canSeeNav(item: NavItem): boolean {
    if (!mounted) return true; // SSR: show all để tránh mismatch
    if (!user) return false;
    if (isAdmin) return true;
    if (!item.permission) return true; // không yêu cầu quyền = ai cũng thấy
    return user.permissions.includes(item.permission as Permission);
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={[
        "fixed md:static z-30 top-0 left-0 h-full w-60 shrink-0",
        "border-r bg-card flex flex-col",
        "transform transition-transform duration-200",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      ].join(" ")}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b">
          <div className="h-9 w-9 rounded-lg bg-primary/10 grid place-items-center">
            <Fan className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold leading-tight">QuatTran POS</div>
            <div className="text-xs text-muted-foreground">
              {mounted && user
                ? (user.branch_ids.length === 0 ? "Tất cả chi nhánh" : `${user.branch_ids.length} chi nhánh`)
                : "Hệ thống"}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="p-2 flex-1 overflow-y-auto">
          {nav.filter(canSeeNav).map((item) => {
            const active = loc.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={[
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  mounted && active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-secondary",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}

          {/* Admin panel */}
          {mounted && isAdmin && (
            <Link
              to="/admin"
              onClick={() => setSidebarOpen(false)}
              className={[
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                "mt-2 border-t border-border pt-3",
              mounted && loc.pathname === "/admin"
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-secondary",
              ].join(" ")}
            >
              <ShieldCheck className="h-4 w-4" />
              Quản trị (Admin)
            </Link>
          )}
        </nav>

        {/* User info */}
        {mounted && user && (
          <div className="border-t p-3">
            <button
              className="w-full flex items-center gap-2 rounded-md px-2 py-2 hover:bg-secondary transition-colors text-left"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <div className="h-8 w-8 rounded-full bg-primary/20 grid place-items-center text-xs font-bold text-primary shrink-0">
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {isAdmin ? "Quản trị viên" : "Nhân viên"}
                </div>
              </div>
              <ChevronDown
                className={[
                  "h-4 w-4 text-muted-foreground transition-transform",
                  userMenuOpen ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>

            {userMenuOpen && (
              <div className="mt-1 rounded-md border bg-background shadow-sm overflow-hidden">
                <Link
                  to="/change-password"
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary"
                  onClick={() => { setUserMenuOpen(false); setSidebarOpen(false); }}
                >
                  <Settings className="h-4 w-4" /> Đổi mật khẩu
                </Link>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-destructive/10 text-destructive"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur px-4 md:px-6 py-3 flex items-center gap-3">
          {/* Hamburger mobile */}
          <button
            className="md:hidden p-1 rounded hover:bg-secondary"
            onClick={() => setSidebarOpen(true)}
          >
            <div className="space-y-1">
              <span className="block h-0.5 w-5 bg-foreground" />
              <span className="block h-0.5 w-5 bg-foreground" />
              <span className="block h-0.5 w-5 bg-foreground" />
            </div>
          </button>
          <h1 className="text-lg font-semibold flex-1">{title}</h1>
          {mounted && user && !isAdmin && user.branch_ids.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
              {user.branch_ids.length} chi nhánh
            </span>
          )}
        </header>
        <div className="p-4 md:p-6 flex-1">{children}</div>
      </main>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={"rounded-xl border bg-card p-5 shadow-sm " + className}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export const fmt = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";