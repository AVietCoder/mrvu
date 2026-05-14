export type ID = string;

export type Branch = {
  id: ID; name: string; address?: string; phone?: string; created_at: string;
};

export type Category = { id: ID; name: string };
export type Brand = { id: ID; name: string };

export type Product = {
  id: ID; sku: string; name: string;
  category_id?: ID; brand_id?: ID;
  power?: string; color?: string; blade_size?: string;
  image_url?: string; description?: string;
  cost_price: number; sale_price: number; min_stock: number;
  created_at: string;
};

export type Stock = { product_id: ID; branch_id: ID; qty: number };

export type StockMovement = {
  id: ID; type: "in" | "out" | "transfer";
  product_id: ID; from_branch?: ID; to_branch?: ID;
  qty: number; unit_cost?: number; note?: string;
  created_at: string; created_by?: string;
};

// Phiếu chuyển kho — chờ xác nhận
export type StockTransfer = {
  id: ID; from_branch: ID; to_branch: ID;
  status: "pending" | "confirmed" | "cancelled";
  note?: string; created_by?: string;
  created_at: string; confirmed_at?: string;
};

export type StockTransferItem = {
  id: ID; transfer_id: ID; product_id: ID; qty: number;
};

export type CustomerGroup = "le" | "dai_ly" | "vip" | "cong_trinh";
export type Customer = {
  id: ID; name: string; phone?: string;
  ward?: string; district?: string; province?: string; address?: string;
  group_name: CustomerGroup; debt: number;
  created_by?: string; created_at: string;
};

export type OrderStatus = "draft" | "reserved" | "completed" | "cancelled";
export type Order = {
  id: ID; code: string;
  customer_id?: ID; branch_id?: ID; employee_id?: ID;
  status: OrderStatus;
  subtotal: number; discount: number; total: number;
  deposit: number; paid: number;
  note?: string; created_at: string;
};

export type OrderItem = {
  id: ID; order_id: ID; product_id: ID;
  qty: number; unit_price: number; discount: number; total: number;
};

export type ActivityLog = {
  id: ID; employee_id?: ID; action: string; detail?: string; created_at: string;
};

// ── Lịch làm việc ─────────────────────────────────────────────
export type ScheduleType = "install" | "warranty" | "delivery" | "survey";
export const SCHEDULE_TYPES: { value: ScheduleType; label: string; color: string }[] = [
  { value: "install",  label: "Lắp đặt",   color: "bg-blue-100 text-blue-700" },
  { value: "warranty", label: "Bảo hành",  color: "bg-orange-100 text-orange-700" },
  { value: "delivery", label: "Giao hàng", color: "bg-green-100 text-green-700" },
  { value: "survey",   label: "Khảo sát",  color: "bg-purple-100 text-purple-700" },
];

export type ScheduleStatus = "pending" | "approved" | "in_progress" | "done" | "cancelled";

export type Schedule = {
  id: ID; title: string;
  type: ScheduleType;
  status: ScheduleStatus;
  scheduled_date: string;    // ISO date string
  scheduled_time?: string;   // HH:MM
  customer_id?: ID;
  branch_id?: ID;
  order_id?: ID;
  address?: string;
  note?: string;
  created_by: ID;
  created_at: string;
};

export type ScheduleAssignment = {
  schedule_id: ID; user_id: ID;
};

// Tính chất công việc (độ khó, địa hình,...)
export type WorkDifficulty = {
  id: ID; name: string; description?: string;
  bonus: number;    // tiền thưởng thêm (VNĐ)
};

// Tiền công kỹ thuật viên / lịch
export type TechFee = {
  schedule_id: ID; product_id: ID; qty: number; unit_fee: number;
};

// ── Quyền hạn ────────────────────────────────────────────────
export type Permission =
  | "stock_in"
  | "stock_out"
  | "stock_transfer"
  | "view_all_debt"
  | "manage_branches"
  | "create_order"
  | "manage_products"
  | "view_reports"
  | "create_schedule"     // Tạo lịch (không phân công người)
  | "approve_schedule"    // Duyệt lịch + phân công người
  | "technician";         // Kỹ thuật viên: xem lịch được giao + tiền công

export const ALL_PERMISSIONS: { key: Permission; label: string; desc: string }[] = [
  { key: "stock_in",        label: "Nhập kho",              desc: "Tạo phiếu nhập hàng vào kho" },
  { key: "stock_out",       label: "Xuất kho",              desc: "Tạo phiếu xuất hàng khỏi kho" },
  { key: "stock_transfer",  label: "Chuyển kho",            desc: "Chuyển hàng giữa các chi nhánh" },
  { key: "view_all_debt",   label: "Xem công nợ tất cả",    desc: "Xem công nợ KH do nhân viên khác tạo" },
  { key: "manage_branches", label: "Quản lý chi nhánh",     desc: "Thêm, sửa, xóa chi nhánh" },
  { key: "create_order",    label: "Tạo đơn hàng",          desc: "Tạo và xác nhận đơn bán hàng" },
  { key: "manage_products", label: "Quản lý hàng hóa",      desc: "Thêm, sửa, xóa sản phẩm" },
  { key: "view_reports",    label: "Xem báo cáo doanh thu", desc: "Truy cập trang báo cáo & thống kê" },
  { key: "create_schedule", label: "Tạo lịch làm việc",     desc: "Tạo lịch lắp đặt, bảo hành,... (không phân công)" },
  { key: "approve_schedule",label: "Duyệt & phân công",     desc: "Duyệt lịch và chọn kỹ thuật viên thực hiện" },
  { key: "technician",      label: "Kỹ thuật viên",         desc: "Xem lịch được giao và tiền công" },
];

// ── User ─────────────────────────────────────────────────────
export type User = {
  id: ID; full_name: string; username: string; phone?: string;
  is_admin: boolean; branch_ids: ID[]; permissions: Permission[];
  created_at: string;
};

export type AuthSession = { user: User; token: string };

export function hasPermission(user: User, perm: Permission): boolean {
  if (user.is_admin) return true;
  return user.permissions.includes(perm);
}

export function canViewBranch(user: User, branchId: ID): boolean {
  if (user.is_admin) return true;
  if (user.branch_ids.length === 0) return true;
  return user.branch_ids.includes(branchId);
}

// ── Format tiền ──────────────────────────────────────────────
export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";