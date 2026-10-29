import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/app/AuthProvider'
import { MODULES } from '@/app/modules'
import { isSupabaseConfigured } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import ConfigMissingPage from '@/pages/ConfigMissingPage'
import LoginPage from '@/pages/LoginPage'
import ModulePage from '@/pages/ModulePage'
import SetupPage from '@/pages/SetupPage'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

// Mỗi màn hình tải khi cần để bản đầu tiên nhẹ.
const AccountsPage = lazy(() => import('@/pages/AccountsPage'))
const CategoriesPage = lazy(() => import('@/features/menu/CategoriesPage'))
const ModifiersPage = lazy(() => import('@/features/menu/ModifiersPage'))
const ProductsPage = lazy(() => import('@/features/menu/ProductsPage'))
const OrdersPage = lazy(() => import('@/features/orders/OrdersPage'))
const PrinterPage = lazy(() => import('@/features/printer/PrinterPage'))
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'))
const PurchasesPage = lazy(() => import('@/features/inventory/PurchasesPage'))
const ShiftsPage = lazy(() => import('@/features/shifts/ShiftsPage'))
const CashPage = lazy(() => import('@/features/cash/CashPage'))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const DashboardPage = lazy(() => import('@/features/reports/DashboardPage'))
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'))
const AuditPage = lazy(() => import('@/features/audit/AuditPage'))
const PosPage = lazy(() => import('@/features/pos/PosPage'))
const PrepPage = lazy(() => import('@/features/prep/PrepPage'))
const TablesPage = lazy(() => import('@/features/tables/TablesPage'))

const PAGES: Record<string, JSX.Element> = {
  '/pos': <PosPage />, '/ban': <TablesPage />, '/pha-che': <PrepPage />, '/don-hang': <OrdersPage />, '/thuc-don': <ProductsPage />,
  '/danh-muc': <CategoriesPage />, '/topping': <ModifiersPage />, '/tai-khoan': <AccountsPage />, '/may-in': <PrinterPage />, '/kho': <InventoryPage />, '/': <DashboardPage />, '/bao-cao': <ReportsPage />, '/khach-hang': <CustomersPage />, '/nhat-ky': <AuditPage />, '/nhan-vien': <ShiftsPage />, '/thu-chi': <CashPage />, '/nhap-hang': <PurchasesPage />,
}

function FullScreenMessage({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-neutral-500">{text}</div>
}

export default function App() {
  const { loading, session, membership, can } = useAuth()

  if (!isSupabaseConfigured) return <ConfigMissingPage />
  if (loading) return <FullScreenMessage text="Đang tải…" />
  if (!session) return <LoginPage />
  if (!membership?.store) return <SetupPage />
  if (!membership.active) {
    return <FullScreenMessage text="Tài khoản của bạn đã bị khóa. Vui lòng liên hệ chủ cửa hàng." />
  }

  const allowed = MODULES.filter((m) => !m.permission || can(m.permission))
  const home = allowed[0]?.path ?? '/'

  return (
    <Routes>
      <Route element={<AppLayout />}>
        {MODULES.map((m) => {
          const ok = !m.permission || can(m.permission)
          const element = !ok ? <Navigate to={home} replace /> : (PAGES[m.path] ?? <ModulePage />)
          return <Route key={m.path} path={m.path} element={<ErrorBoundary><Suspense fallback={<FullScreenMessage text="Đang tải…" />}>{element}</Suspense></ErrorBoundary>} />
        })}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}
