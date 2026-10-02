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

// Mã nhóm khách — danh sách nằm trong bảng customer_groups (migration v12),
// không còn cố định 4 giá trị. "le" / "dai_ly" / "vip" / "cong_trinh" là 4 mã gốc.
export type CustomerGroup = string;
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
  payment_method?: "tien_mat" | "ngan_hang";
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
  | "technician"          // Kỹ thuật viên: xem lịch được giao + tiền công
  | "view_cash_branch"    // Xem sổ quỹ chi nhánh của mình
  | "view_cash_all"       // Xem sổ quỹ toàn bộ chi nhánh
  | "customer_care"       // Gửi Zalo/Email chăm sóc KH (danh sách thì ai cũng xem được)
  | "manage_roster"       // Quản lý lịch trực — chỉ chi nhánh mình quản lý (xem thì ai cũng xem được)
  | "manage_payroll"      // Quản lý lương nhân sự — chỉ NV admin phân ở tab "Phân việc"
  | "self_attendance";    // (không còn dùng — mọi nhân viên đều tự chấm công được; giữ để dữ liệu cũ hợp lệ)

export const ALL_PERMISSIONS: { key: Permission; label: string; desc: string }[] = [
  { key: "stock_in",          label: "Nhập kho",                  desc: "Tạo phiếu nhập hàng vào kho" },
  { key: "stock_out",         label: "Xuất kho",                  desc: "Tạo phiếu xuất hàng khỏi kho" },
  { key: "stock_transfer",    label: "Chuyển kho",                desc: "Chuyển hàng giữa các chi nhánh" },
  { key: "view_all_debt",     label: "Xem công nợ tất cả",        desc: "Xem công nợ KH do nhân viên khác tạo" },
  { key: "manage_branches",   label: "Quản lý chi nhánh",         desc: "Thêm, sửa, xóa chi nhánh" },
  { key: "create_order",      label: "Tạo đơn hàng",              desc: "Tạo và xác nhận đơn bán hàng" },
  { key: "manage_products",   label: "Quản lý hàng hóa",          desc: "Thêm, sửa, xóa sản phẩm" },
  { key: "view_reports",      label: "Xem báo cáo doanh thu",     desc: "Truy cập trang báo cáo & thống kê" },
  { key: "create_schedule",   label: "Tạo lịch làm việc",         desc: "Tạo lịch lắp đặt, bảo hành,... (không phân công)" },
  { key: "approve_schedule",  label: "Duyệt & phân công",         desc: "Duyệt lịch và chọn kỹ thuật viên thực hiện" },
  { key: "technician",        label: "Kỹ thuật viên",             desc: "Xem lịch được giao và tiền công" },
  { key: "view_cash_branch",  label: "Xem sổ quỹ chi nhánh",      desc: "Xem & tạo phiếu thu/chi của chi nhánh mình" },
  { key: "view_cash_all",     label: "Xem sổ quỹ toàn bộ",        desc: "Xem & tạo phiếu thu/chi của tất cả chi nhánh" },
  { key: "customer_care",     label: "Gửi tin chăm sóc KH",       desc: "Gửi Zalo/Email sinh nhật & nhắc bảo dưỡng (tin Zalo tốn phí)" },
  { key: "manage_roster",     label: "Quản lý lịch trực",         desc: "Xếp ca, đánh dấu nghỉ cho các chi nhánh mình được gán" },
  { key: "manage_payroll",    label: "Quản lý lương nhân sự",     desc: "Sửa lương cơ bản, DS bán hàng, ngân hàng, chấm công, chốt & chi lương — của chính mình + những NV admin phân cho ở Bảng lương → Phân việc" },
];

// ── Nguồn khách "Biết Mr.Vũ qua đâu?" (v20, mở rộng v22) ─────
// Dùng chung cho khách hàng và khách tiềm năng. legacy = chỉ để hiển thị dữ
// liệu cũ, không còn trong ô chọn ("Facebook" đã tách thành Group / Fanpage).
export const CUSTOMER_SOURCES: { key: string; label: string; legacy?: boolean }[] = [
  { key: "showroom", label: "Showroom (khách tự ghé)" },
  { key: "fb_group", label: "Group Facebook" },
  { key: "fb_page",  label: "Fanpage Facebook" },
  { key: "zalo",     label: "Zalo" },
  { key: "tiktok",   label: "Tiktok" },
  { key: "google",   label: "Google" },
  { key: "web",      label: "Website" },
  { key: "thiet_ke", label: "Thiết kế" },
  { key: "ban_be",   label: "Bạn bè / người quen" },
  { key: "khach_cu", label: "Khách cũ mua lại" },
  { key: "noi_bo",   label: "Nội bộ chuyển (sếp / đồng nghiệp / chi nhánh khác)" },
  { key: "khac",     label: "Khác" },
  { key: "facebook", label: "Facebook", legacy: true },
];

// ── Khách tiềm năng (v22) ────────────────────────────────────
export const LEAD_STAGES: { key: string; label: string; tone: string }[] = [
  { key: "new",         label: "Mới",            tone: "bg-slate-100 text-slate-700 border-slate-200" },
  { key: "consulting",  label: "Đang tư vấn",    tone: "bg-sky-100 text-sky-800 border-sky-200" },
  { key: "appointment", label: "Hẹn ra showroom", tone: "bg-violet-100 text-violet-800 border-violet-200" },
  { key: "quoted",      label: "Đã báo giá",     tone: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "won",         label: "Đã chốt",        tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { key: "lost",        label: "Không chốt",     tone: "bg-rose-100 text-rose-800 border-rose-200" },
];
export const OPEN_LEAD_STAGES = ["new", "consulting", "appointment", "quoted"];
export const LEAD_LOST_REASONS: { key: string; label: string }[] = [
  { key: "gia_cao",     label: "Giá cao" },
  { key: "chua_xay",    label: "Nhà chưa xây / chưa hoàn thiện" },
  { key: "mua_noi_khac", label: "Mua hãng khác / nơi khác" },
  { key: "ko_phan_hoi", label: "Không phản hồi" },
  { key: "ko_dung_nhu_cau", label: "Không đúng nhu cầu" },
  { key: "khac",        label: "Khác (ghi rõ)" },
];
export const LEAD_ACTIVITY_KINDS: { key: string; label: string }[] = [
  { key: "call",  label: "Gọi điện" },
  { key: "zalo",  label: "Nhắn Zalo" },
  { key: "quote", label: "Gửi báo giá" },
  { key: "visit", label: "Khách ra showroom" },
  { key: "note",  label: "Ghi chú" },
];
export const leadStageOf = (k?: string | null) => LEAD_STAGES.find((s) => s.key === k) ?? LEAD_STAGES[0];

// ── Bảo hành (v23) ───────────────────────────────────────────
// Phiếu bảo hành khách lẻ (retail) / đại lý (dealer) và yêu cầu gửi nhà máy.
export const WARRANTY_KINDS: { key: string; label: string }[] = [
  { key: "retail", label: "Khách lẻ" },
  { key: "dealer", label: "Đại lý" },
];
export const WARRANTY_STAGES: { key: string; label: string; tone: string }[] = [
  { key: "new",          label: "Mới tiếp nhận", tone: "bg-sky-100 text-sky-800 border-sky-200" },
  { key: "processing",   label: "Đang xử lý",    tone: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "waiting_part", label: "Chờ linh kiện", tone: "bg-violet-100 text-violet-800 border-violet-200" },
  { key: "done",         label: "Hoàn tất",      tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { key: "closed",       label: "Đóng",          tone: "bg-slate-200 text-slate-700 border-slate-300" },
];
export const OPEN_WARRANTY_STAGES = ["new", "processing", "waiting_part"];
export const warrantyStageOf = (k?: string | null) => WARRANTY_STAGES.find((s) => s.key === k) ?? WARRANTY_STAGES[0];
export const WARRANTY_FINAL_ACTIONS: { key: string; label: string }[] = [
  { key: "buy_part",     label: "Mua linh kiện mới" },
  { key: "free_support", label: "Hỗ trợ miễn phí" },
  { key: "replace_new",  label: "Thay mới" },
  { key: "repair",       label: "Sửa chữa" },
];
// Bộ phận lỗi (v24) — quyết định tính theo hạn bảo hành ĐỘNG CƠ hay PHỤ KIỆN. Chưa chọn = chưa xác định.
export const WARRANTY_FAULT_PARTS: { key: string; label: string }[] = [
  { key: "motor",     label: "Động cơ" },
  { key: "accessory", label: "Phụ kiện / linh kiện khác" },
];
// Loại lỗi — để thống kê "lỗi phổ biến nhất" (mô tả chi tiết vẫn ghi ở ô tình trạng).
export const WARRANTY_ISSUE_TYPES: { key: string; label: string }[] = [
  { key: "khong_chay",  label: "Không chạy / không lên nguồn" },
  { key: "keu_rung",    label: "Kêu / rung lắc" },
  { key: "remote",      label: "Remote / điều khiển" },
  { key: "den",         label: "Đèn LED" },
  { key: "mach",        label: "Hộp điều khiển / mạch" },
  { key: "dong_co",     label: "Động cơ" },
  { key: "canh",        label: "Cánh quạt" },
  { key: "ngoai_quan",  label: "Ngoại quan (trầy, móp, thiếu phụ kiện)" },
  { key: "khac",        label: "Khác" },
];
export const FACTORY_SOLUTIONS: { key: string; label: string; accept: boolean }[] = [
  { key: "replace_part",      label: "Đổi mới linh kiện / phụ kiện", accept: true },
  { key: "replace_motor",     label: "Đổi mới động cơ",              accept: true },
  { key: "reject_expired",    label: "Không BH do quá hạn",          accept: false },
  { key: "reject_user_fault", label: "Không BH do lỗi người dùng",   accept: false },
];
export const FACTORY_RETURN_STATUSES: { key: string; label: string; tone: string }[] = [
  { key: "waiting",  label: "Chờ NM gửi trả", tone: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "returned", label: "NM đã gửi trả",  tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { key: "rejected", label: "Từ chối / Đóng", tone: "bg-slate-200 text-slate-700 border-slate-300" },
];
const labelIn = (list: { key: string; label: string }[], k?: string | null) => list.find((x) => x.key === k)?.label ?? (k || "");
export const warrantyActionLabel = (k?: string | null) => labelIn(WARRANTY_FINAL_ACTIONS, k);
export const warrantyIssueLabel = (k?: string | null) => labelIn(WARRANTY_ISSUE_TYPES, k);
export const factorySolutionLabel = (k?: string | null) => labelIn(FACTORY_SOLUTIONS, k);

/** "Facebook" / "Khác — hội chợ" / "" (khách cũ chưa có). */
export function customerSourceLabel(source?: string | null, note?: string | null): string {
  if (!source) return "";
  const label = CUSTOMER_SOURCES.find((s) => s.key === source)?.label ?? source;
  return source === "khac" && note ? `${label} — ${note}` : label;
}

// ── User ─────────────────────────────────────────────────────
export type User = {
  id: ID; full_name: string; username: string; phone?: string;
  birthday?: string;      // yyyy-mm-dd — chỉ để nhắc sinh nhật nội bộ
  position_id?: string;   // chức vụ (bảng positions, migration v18)
  is_admin: number; branch_ids: ID[]; permissions: Permission[];
  created_at: string;
};

export type AuthSession = { user: User; token: string };

export function hasPermission(user: User, perm: Permission): boolean {
  if (user.is_admin == 1) return true; // <-- Sửa từ user.is_admin thành user.is_admin == 1
  return user.permissions.includes(perm);
}

export function canViewBranch(user: User, branchId: ID): boolean {
  if (user.is_admin == 1) return true; // <-- Sửa từ user.is_admin thành user.is_admin == 1
  if (user.branch_ids.length === 0) return false;
  return user.branch_ids.includes(branchId);
}

// ── Format tiền ──────────────────────────────────────────────
export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";