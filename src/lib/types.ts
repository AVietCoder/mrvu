// Domain types dùng chung client + server
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

export type Role = "admin" | "manager" | "cashier" | "warehouse";
export type Employee = {
  id: ID; name: string; phone?: string; role: Role;
  branch_id?: ID; created_at: string;
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

// ── Auth / User ──────────────────────────────────────────────
export type UserRole = "admin" | "manager" | "cashier" | "warehouse";

export type User = {
  id: ID;
  full_name: string;
  username: string;
  phone?: string;
  role: UserRole;
  branch_id?: ID;   // undefined = admin toàn hệ thống
  created_at: string;
};

// runtime session (không lưu password)
export type AuthSession = {
  user: User;
  token: string;
};