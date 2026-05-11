export type ID = string;

export type Branch = {
  id: ID; name: string; address?: string; phone?: string; created_at: string;
};

export type Category = { id: ID; name: string };

export type Product = {
  id: ID; sku: string; name: string;
  category_id?: ID;
  brand?: string; power?: string; color?: string; blade_size?: string;
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

export type CustomerGroup = "le" | "dai_ly" | "vip" | "cong_trinh";
export type Customer = {
  id: ID; name: string; phone?: string; address?: string;
  group_name: CustomerGroup; debt: number; created_at: string;
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

// ── Quyền hạn (permissions) ──────────────────────────────────
export type Permission =
  | "stock_in"           // Nhập kho
  | "stock_out"          // Xuất kho
  | "stock_transfer"     // Chuyển kho
  | "view_all_debt"      // Xem công nợ của nhân viên khác
  | "manage_branches"    // Thêm/xóa chi nhánh
  | "create_order"       // Tạo đơn hàng
  | "manage_products"    // Thêm/sửa/xóa hàng hóa
  | "view_reports"       // Xem báo cáo doanh thu
  | "manage_users";      // Quản lý tài khoản (chỉ admin)

// Quyền mặc định tất cả nhân viên đều có (không cần cấp)
export const DEFAULT_PERMISSIONS: Permission[] = [
  // view products, view customers, add customers, view stock — luôn có
];
export const ALL_PERMISSIONS: { key: Permission; label: string; desc: string }[] = [
  { key: "stock_in",        label: "Nhập kho",              desc: "Tạo phiếu nhập hàng vào kho" },
  { key: "stock_out",       label: "Xuất kho",              desc: "Tạo phiếu xuất hàng khỏi kho" },
  { key: "stock_transfer",  label: "Chuyển kho",            desc: "Chuyển hàng giữa các chi nhánh" },
  { key: "view_all_debt",   label: "Xem công nợ tất cả",    desc: "Xem công nợ KH do nhân viên khác tạo" },
  { key: "manage_branches", label: "Quản lý chi nhánh",     desc: "Thêm, sửa, xóa chi nhánh" },
  { key: "create_order",    label: "Tạo đơn hàng",          desc: "Tạo và xác nhận đơn bán hàng" },
  { key: "manage_products", label: "Quản lý hàng hóa",      desc: "Thêm, sửa, xóa sản phẩm" },
  // ❌ Bỏ "view_reports" và "manage_users" — báo cáo doanh thu & quản lý user chỉ admin
];


// ── User / Auth ──────────────────────────────────────────────
// Không còn role cứng — chỉ dùng is_admin + permissions
export type User = {
  id: ID;
  full_name: string;
  username: string;
  phone?: string;
  is_admin: boolean;
  branch_ids: ID[];        // [] = hoạt động tất cả chi nhánh
  permissions: Permission[];
  created_at: string;
};

export type AuthSession = {
  user: User;
  token: string;
};

// Helper: kiểm tra quyền
export function hasPermission(user: User, perm: Permission): boolean {
  if (user.is_admin) return true;
  return user.permissions.includes(perm);
}

export function canViewBranch(user: User, branchId: ID): boolean {
  if (user.is_admin) return true;
  if (user.branch_ids.length === 0) return true; // hoạt động tất cả
  return user.branch_ids.includes(branchId);
}