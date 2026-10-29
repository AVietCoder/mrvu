import {
  BarChart3, Boxes, ChefHat, ClipboardList, Coffee, FileClock, LayoutDashboard, LayoutGrid, ListPlus, Printer,
  ShoppingCart, Tags, Truck, UserCog, Users, UsersRound, Wallet, type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

export interface ModuleDef {
  path: string
  label: string
  icon: LucideIcon
  /** Quyền tối thiểu để thấy mục này. Quyền thật vẫn do RLS kiểm tra. */
  permission?: Permission
  /** Giai đoạn triển khai chức năng. */
  phase: number
}

export const MODULES: ModuleDef[] = [
  { path: '/', label: 'Tổng quan', icon: LayoutDashboard, permission: 'reports.view', phase: 5 },
  { path: '/pos', label: 'Bán hàng', icon: ShoppingCart, permission: 'order.create', phase: 3 },
  { path: '/pha-che', label: 'Pha chế', icon: ChefHat, permission: 'order.create', phase: 8 },
  { path: '/ban', label: 'Quản lý bàn', icon: LayoutGrid, permission: 'order.create', phase: 3 },
  { path: '/don-hang', label: 'Đơn hàng', icon: ClipboardList, permission: 'order.create', phase: 3 },
  { path: '/thuc-don', label: 'Thực đơn', icon: Coffee, permission: 'menu.manage', phase: 3 },
  { path: '/danh-muc', label: 'Danh mục', icon: Tags, permission: 'menu.manage', phase: 3 },
  { path: '/topping', label: 'Topping & tùy chọn', icon: ListPlus, permission: 'menu.manage', phase: 3 },
  { path: '/khach-hang', label: 'Khách hàng', icon: Users, permission: 'customers.manage', phase: 5 },
  { path: '/kho', label: 'Kho nguyên liệu', icon: Boxes, permission: 'inventory.view', phase: 5 },
  { path: '/nhap-hang', label: 'Nhập hàng', icon: Truck, permission: 'inventory.view', phase: 5 },
  { path: '/nhan-vien', label: 'Nhân viên & ca', icon: UsersRound, permission: 'shift.manage', phase: 5 },
  { path: '/thu-chi', label: 'Thu chi', icon: Wallet, permission: 'cash.manage', phase: 5 },
  { path: '/bao-cao', label: 'Báo cáo', icon: BarChart3, permission: 'reports.view', phase: 5 },
  { path: '/may-in', label: 'Máy in & cửa hàng', icon: Printer, permission: 'settings.manage', phase: 4 },
  { path: '/tai-khoan', label: 'Tài khoản & quyền', icon: UserCog, permission: 'users.manage', phase: 2 },
  { path: '/nhat-ky', label: 'Nhật ký', icon: FileClock, permission: 'audit.view', phase: 5 },
]
