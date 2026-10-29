export type AppRole = 'owner' | 'manager' | 'cashier' | 'staff'

export const ROLE_LABEL: Record<AppRole, string> = {
  owner: 'Chủ cửa hàng',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  staff: 'Nhân viên phục vụ',
}

/** Mã quyền, khớp bảng role_permissions trong database. */
export type Permission =
  | 'order.create' | 'order.pay' | 'discount.apply' | 'price.edit' | 'order.cancel' | 'order.refund'
  | 'drawer.open' | 'reports.view' | 'costs.view' | 'menu.manage' | 'inventory.view' | 'inventory.manage'
  | 'stock.adjust' | 'purchase.manage' | 'customers.manage' | 'shift.manage' | 'cash.manage'
  | 'settings.manage' | 'audit.view' | 'users.manage' | 'order.reprint'
