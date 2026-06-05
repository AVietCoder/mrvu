import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  searchOrdersPage,
  getOrderStats,
  getOrderFormRefs,
  createOrder,
} from "@/lib/orders.functions";
import { createSchedule, listWorkTypes } from "@/lib/schedule.functions";
import { upsertCustomer, listCustomers, getCustomerLite } from "@/lib/customers.functions";
import { buildInvoiceHtml } from "@/lib/print-invoice";
import { AppShell, Card, fmt } from "@/components/AppShell";
import { SearchFilter } from "@/components/SearchFilter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { AsyncSearchableSelect } from "@/components/AsyncSearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  X,
  ShoppingBag,
  Clock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Minus,
  Loader2,
  UserPlus,
  MapPin,
  Landmark,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { getSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "Bán hàng — Mr.Vũ" }] }),
  component: Page,
});

type LineItem = {
  product_id: string;
  qty: number;
  unit_price: number;
  discount: number;
};

function fmtInput(val: string): string {
  const num = val.replace(/\D/g, "");
  if (!num) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(num));
}

function parseInput(val: string): number {
  return Number(val.replace(/\D/g, "")) || 0;
}

// ── Lưu lại cài đặt VAT người dùng nhập gần nhất (ghi nhớ giữa các đơn) ──
type VatMode = "8" | "10" | "custom" | "amount";
const VAT_PREF_KEY = "mrvu_vat_pref";
function loadVatPref(): { includeVat: boolean; vatMode: VatMode; vatCustomPercent: string; vatAmountRaw: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(localStorage.getItem(VAT_PREF_KEY) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const PAGE_SIZE = 20;

const PROVINCES = [
  "An Giang","Bà Rịa - Vũng Tàu","Bắc Giang","Bắc Kạn","Bạc Liêu","Bắc Ninh","Bến Tre",
  "Bình Định","Bình Dương","Bình Phước","Bình Thuận","Cà Mau","Cần Thơ","Cao Bằng","Đà Nẵng",
  "Đắk Lắk","Đắk Nông","Điện Biên","Đồng Nai","Đồng Tháp","Gia Lai","Hà Giang","Hà Nam",
  "Hà Nội","Hà Tĩnh","Hải Dương","Hải Phòng","Hậu Giang","Hòa Bình","Hưng Yên","Khánh Hòa",
  "Kiên Giang","Kon Tum","Lai Châu","Lâm Đồng","Lạng Sơn","Lào Cai","Long An","Nam Định",
  "Nghệ An","Ninh Bình","Ninh Thuận","Phú Thọ","Phú Yên","Quảng Bình","Quảng Nam","Quảng Ngãi",
  "Quảng Ninh","Quảng Trị","Sóc Trăng","Sơn La","Tây Ninh","Thái Bình","Thái Nguyên","Thanh Hóa",
  "Thừa Thiên Huế","Tiền Giang","TP. Hồ Chí Minh","Trà Vinh","Tuyên Quang","Vĩnh Long","Vĩnh Phúc","Yên Bái",
];

const GROUP_LABEL: Record<string, string> = {
  le: "Khách lẻ",
  dai_ly: "Đại lý",
  vip: "VIP",
  cong_trinh: "Công trình",
};
// Thêm 2 status này vào dòng 48 (ngay dưới cancelled):
const STATUS_LABEL: Record<string, string> = {
  completed: "Hoàn tất",
  reserved: "Đặt hàng",
  draft: "Nháp",
  cancelled: "Hủy",
  returned: "Đã trả hàng",
  partially_returned: "Trả hàng 1 phần",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  reserved: "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-100 text-red-700",
  returned: "bg-purple-100 text-purple-700",
  partially_returned: "bg-purple-50 text-purple-600 border border-purple-200",
};

// Bên dưới hàm Page() -> Filter Slot (Dòng ~550) thêm tùy chọn lọc:


function printOrderSlip({
  items,
  customer,
  branch,
  employee,
  status,
  paymentMethod,
  discountAmt,
  vatAmt,
  deposit,
  note,
  subtotal,
  total,
  data,
  siteSettings,
  tpl,
  code,
  createdAt,
  vatRate,
  discountType,
  discountPct,
  customerObj,
}: any) {
  const moneyFmt = (n: number) =>
    new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " \u20ab";

  const custObj = customerObj ?? null;
  const branchObj = branch
    ? (data?.branches ?? []).find((b: any) => b.id === branch)
    : null;
  const empObj = employee
    ? (data?.employees ?? []).find((e: any) => e.id === employee)
    : null;

  const custAddress = custObj
    ? [custObj.address, custObj.ward, custObj.district, custObj.province]
        .filter(Boolean)
        .join(", ")
    : "";

  const pw = window.open("", "_blank");
  if (!pw) return;

  pw.document.write(
    buildInvoiceHtml({
      order: {
        code: code ?? "",
        created_at: createdAt ?? new Date().toISOString(),
        status,
        payment_method: paymentMethod,
        subtotal,
        discount: discountAmt,
        discount_type: discountType,
        discount_pct: discountPct,
        vat_rate: vatRate,
        vat_amount: vatAmt,
        total,
        deposit,
        paid: 0,
        note,
      },
      custName: custObj?.name,
      custPhone: custObj?.phone,
      custAddress,
      branchName: branchObj?.name,
      empName: empObj?.name,
      items,
      products: data?.products ?? [],
      moneyFmt,
      ss: siteSettings,
      tplOverride: tpl,
    }),
  );

  pw.document.close();
  setTimeout(() => pw.print(), 300);
}

function Page() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const refsFn = useServerFn(getOrderFormRefs);
  const ordersFn = useServerFn(searchOrdersPage);
  const orderStatsFn = useServerFn(getOrderStats);
  const listCustomersFn = useServerFn(listCustomers);
  const custLiteFn = useServerFn(getCustomerLite);
  const create = useServerFn(createOrder);
  const createScheduleFn = useServerFn(createSchedule);
  const listWorkTypesFn = useServerFn(listWorkTypes);
  const upsertCustomerFn = useServerFn(upsertCustomer);
  const qc = useQueryClient();

  // Form tạo đơn mở/đóng — refs nặng chỉ tải khi form mở (xem dưới).
  const [open, setOpen] = useState(false);

  // Dữ liệu cho FORM tạo đơn (sản phẩm, tồn kho, NV). CHỈ tải khi mở form
  // → lúc vào trang danh sách không tốn request nào cho phần này.
  const { data } = useQuery({
    queryKey: ["orderRefs"],
    queryFn: () => refsFn(),
    enabled: open,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const getSettingsFn = useServerFn(getSettings);
  const { data: siteSettings } = useQuery({
    queryKey: ["site_settings"],
    queryFn: () => getSettingsFn(),
    enabled: open,
  });

  const { data: workTypes = [] } = useQuery({
    queryKey: ["workTypes"],
    queryFn: () => listWorkTypesFn(),
    enabled: open,
  });

  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "reserved">("orders");
  const [page, setPage] = useState(1);

  const [receiptOrder, setReceiptOrder] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Quick create customer state
  const [quickCustOpen, setQuickCustOpen] = useState(false);
  const [quickCustName, setQuickCustName] = useState("");
  const [quickCustPhone, setQuickCustPhone] = useState("");
  const [quickCustEmail, setQuickCustEmail] = useState("");
  const [quickCustGroup, setQuickCustGroup] = useState("le");
  const [quickCustType, setQuickCustType] = useState<"ca_nhan"|"to_chuc">("ca_nhan");
  const [quickCustNote, setQuickCustNote] = useState("");
  const [quickCustGender, setQuickCustGender] = useState("");
  const [quickCustBirthday, setQuickCustBirthday] = useState("");
  const [quickCustProvince, setQuickCustProvince] = useState("");
  const [quickCustWard, setQuickCustWard] = useState("");
  const [quickCustAddress, setQuickCustAddress] = useState("");
  const [quickCustCccd, setQuickCustCccd] = useState("");
  const [quickCustPassport, setQuickCustPassport] = useState("");
  const [quickCustCompany, setQuickCustCompany] = useState("");
  const [quickCustTaxCode, setQuickCustTaxCode] = useState("");
  const [quickCustBankName, setQuickCustBankName] = useState("");
  const [quickCustBankAccount, setQuickCustBankAccount] = useState("");
  const [quickCustDebt, setQuickCustDebt] = useState("0");
  const [savingCust, setSavingCust] = useState(false);

  const [items, setItems] = useState<LineItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [branch, setBranch] = useState("");
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState<"completed" | "reserved" | "draft">(
    "reserved",
  );
  const [paymentMethod, setPaymentMethod] = useState<
    "tien_mat" | "ngan_hang"
  >("tien_mat");
  const [bankAccountIdx, setBankAccountIdx] = useState<string>("");
  const [bankContent, setBankContent] = useState("");
  const [discountRaw, setDiscountRaw] = useState("0");
  const [discountPct, setDiscountPct] = useState("0");
  const [useDiscountPct, setUseDiscountPct] = useState(false);
  const [includeVat, setIncludeVat] = useState<boolean>(() => loadVatPref()?.includeVat ?? false);
  const [vatMode, setVatMode] = useState<VatMode>(() => loadVatPref()?.vatMode ?? "10");
  const [vatCustomPercent, setVatCustomPercent] = useState<string>(() => loadVatPref()?.vatCustomPercent ?? "");
  const [vatAmountRaw, setVatAmountRaw] = useState<string>(() => loadVatPref()?.vatAmountRaw ?? "0");
  // Ghi nhớ cài đặt VAT người dùng nhập (theo % hay theo số tiền) cho các đơn sau
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        VAT_PREF_KEY,
        JSON.stringify({ includeVat, vatMode, vatCustomPercent, vatAmountRaw }),
      );
    } catch { /* ignore */ }
  }, [includeVat, vatMode, vatCustomPercent, vatAmountRaw]);
  const [depositRaw, setDepositRaw] = useState("0");
  const [khachThanhToanRaw, setKhachThanhToanRaw] = useState("");  // Số tiền khách trả thực tế
  const [note, setNote] = useState("");

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5);
  const [createScheduleOnOrder, setCreateScheduleOnOrder] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    work_type_id: "",
    scheduled_date: todayStr,
    scheduled_time: nowTimeStr,
    address: "",
    note: "",
  });

  const [search, setSearch] = useState("");
  // Debounce ô tìm kiếm: input vẫn cập nhật tức thì (value=search), nhưng việc
  // lọc/sắp xếp toàn bộ danh sách chỉ chạy lại sau khi ngừng gõ → giảm tải CPU
  // khi có hàng nghìn đơn. KẾT QUẢ lọc cuối cùng GIỐNG HỆT trước.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [sortBy, setSortBy] = useState("newest");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  // ✨ Bộ lọc mới: khách hàng, nhân viên (chỉ admin), khoảng ngày.
  // Ngày lọc: đơn hoàn tất theo ngày hoàn tất, còn lại theo ngày tạo (xử lý ở RPC).
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Phạm vi chi nhánh theo quyền: NV không phải admin chỉ thấy chi nhánh được gán.
  // GIỮ NGUYÊN logic cũ (trước đây lọc ở client trong allOrders).
  const branchScope = useMemo(
    () =>
      !isAdmin && user && user.branch_ids?.length ? user.branch_ids : null,
    [isAdmin, user],
  );

  // ✅ Danh sách đơn lấy theo TRANG từ server (RPC search_orders_page).
  //    Tìm kiếm (mã đơn / tên khách), lọc trạng thái + chi nhánh, sort đều chạy
  //    ở Postgres. Mỗi lần chỉ tải PAGE_SIZE dòng kèm sẵn tên KH / chi nhánh /
  //    số lịch lắp. placeholderData: giữ trang cũ trong lúc tải → không nháy.
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: [
      "orders",
      "page",
      activeTab,
      page,
      debouncedSearch,
      sortBy,
      filterStatus,
      filterBranch,
      filterCustomer,
      filterEmployee,
      filterFrom,
      filterTo,
      branchScope,
    ],
    queryFn: () =>
      ordersFn({
        data: {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          status: activeTab === "orders" ? filterStatus : "",
          branch: filterBranch,
          tab: activeTab,
          sortBy,
          branchIds: branchScope,
          customer: filterCustomer,
          // Chỉ admin được lọc theo nhân viên.
          employee: isAdmin ? filterEmployee : "",
          fromDate: filterFrom,
          toDate: filterTo,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  // Số đơn đặt hàng đang chờ (badge) — query riêng, cache lâu, không phụ thuộc trang.
  const { data: stats } = useQuery({
    queryKey: ["orders", "stats", branchScope],
    queryFn: () => orderStatsFn({ data: { branchIds: branchScope } }),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  // Đổi tab/tìm kiếm/sort/bộ lọc → quay về trang 1.
  useEffect(() => {
    setPage(1);
  }, [activeTab, debouncedSearch, sortBy, filterStatus, filterBranch, filterCustomer, filterEmployee, filterFrom, filterTo]);

  // Khách đang chọn — resolve gọn (1 dòng) để dựng tiêu đề/địa chỉ lịch tự động.
  // Không còn tải toàn bộ danh sách khách về client.
  const [selectedCustomerObj, setSelectedCustomerObj] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    if (!customer) {
      setSelectedCustomerObj(null);
      return;
    }
    custLiteFn({ data: { id: customer } })
      .then((c) => {
        if (!cancelled) setSelectedCustomerObj(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [customer]);

  useEffect(() => {
    if (createScheduleOnOrder) {
      const cust = selectedCustomerObj;
      const currentType = workTypes.find((t: any) => t.id === scheduleForm.work_type_id);
      const currentTypeLabel = currentType?.name ?? "Công việc";
      
      const autoTitle = cust 
        ? `${currentTypeLabel} — ${cust.name}` 
        : `${currentTypeLabel} — Khách lẻ`;

      const autoAddress = cust
        ? [cust.address, cust.ward, cust.province].filter(Boolean).join(", ")
        : "";

      setScheduleForm(f => ({
        ...f,
        title: autoTitle,
        address: f.address || autoAddress,
      }));
    }
  }, [customer, scheduleForm.work_type_id, createScheduleOnOrder, selectedCustomerObj, workTypes]);

  const discount = useDiscountPct ? 0 : parseInput(discountRaw);
  const deposit = parseInput(depositRaw);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.qty * i.unit_price - i.discount, 0),
    [items],
  );

  const discountAmt = useDiscountPct
    ? Math.round(subtotal * (Math.min(100, Math.max(0, parseFloat(discountPct) || 0)) / 100))
    : parseInput(discountRaw);
  const afterDiscount = Math.max(0, subtotal - discountAmt);

  const customVatRate = Math.min(100, Math.max(0, parseFloat(vatCustomPercent) || 0)) / 100;
  const vatRate =
    vatMode === "8" ? 0.08
    : vatMode === "10" ? 0.1
    : vatMode === "custom" ? customVatRate
    : 0; // mode "amount" → không theo %, nhập số tiền trực tiếp
  const vatAmt = !includeVat
    ? 0
    : vatMode === "amount"
    ? parseInput(vatAmountRaw)
    : Math.round(afterDiscount * vatRate);
  const total = afterDiscount + vatAmt;
  const khachCanThanhToan = Math.max(0, total - deposit);

  // Payment panel calculations
  const khachThanhToan = khachThanhToanRaw === "" ? 0 : parseInput(khachThanhToanRaw);
  const congNo = Math.max(0, khachCanThanhToan - khachThanhToan);    // phần tính vào công nợ
  const tienThua = Math.max(0, khachThanhToan - khachCanThanhToan);  // tiền thừa trả lại

  // Tồn kho theo sản phẩm cho CHI NHÁNH đang chọn (lấy từ bảng stock).
  // Sản phẩm KHÔNG có cột stock, nên phải tra từ data.stock, nếu không form luôn hiện Kho 0.
  // Chưa chọn chi nhánh -> cộng tổng tất cả chi nhánh để không hiển thị nhầm 0.
  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of (data?.stock ?? []) as any[]) {
      if (branch && row.branch_id !== branch) continue;
      map.set(row.product_id, (map.get(row.product_id) ?? 0) + Number(row.qty || 0));
    }
    return map;
  }, [data?.stock, branch]);

  // ✅ Danh sách + phân trang lấy thẳng từ server. Tab Hóa đơn/Đặt hàng, lọc,
  //    sort, phạm vi chi nhánh đều do RPC xử lý — logic GIỮ NGUYÊN.
  const pagedOrders = ordersData?.orders ?? [];
  const totalFiltered = ordersData?.meta?.totalFiltered ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const reservedCount = stats?.reservedCount ?? 0;

  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleSort(v: string) {
    setSortBy(v);
    setPage(1);
  }

  function handleTab(t: "orders" | "reserved") {
    handleTabExecute(t);
  }

  function handleTabExecute(t: "orders" | "reserved") {
    setActiveTab(t);
    setPage(1);
    setSearch("");
    setFilterStatus("");
  }

  function resetQuickCustForm() {
    setQuickCustName(""); setQuickCustPhone(""); setQuickCustEmail("");
    setQuickCustGroup("le"); setQuickCustType("ca_nhan"); setQuickCustNote("");
    setQuickCustGender(""); setQuickCustBirthday(""); setQuickCustProvince("");
    setQuickCustWard(""); setQuickCustAddress(""); setQuickCustCccd("");
    setQuickCustPassport(""); setQuickCustCompany(""); setQuickCustTaxCode("");
    setQuickCustBankName(""); setQuickCustBankAccount(""); setQuickCustDebt("0");
  }

  async function handleQuickCreateCustomer() {
    if (!quickCustName.trim()) return toast.error("Nhập tên khách hàng");
    setSavingCust(true);
    try {
      await upsertCustomerFn({
        data: {
          name: quickCustName.trim(),
          phone: quickCustPhone.trim() || undefined,
          email: quickCustEmail.trim() || undefined,
          gender: quickCustGender || undefined,
          birthday: quickCustBirthday || undefined,
          province: quickCustProvince || undefined,
          ward: quickCustWard || undefined,
          address: quickCustAddress.trim() || undefined,
          group_name: quickCustGroup,
          customer_type: quickCustType,
          company_name: quickCustCompany.trim() || undefined,
          tax_code: quickCustTaxCode.trim() || undefined,
          cccd: quickCustCccd.trim() || undefined,
          passport_no: quickCustPassport.trim() || undefined,
          bank_name: quickCustBankName.trim() || undefined,
          bank_account: quickCustBankAccount.trim() || undefined,
          note: quickCustNote.trim() || undefined,
          debt: Number(quickCustDebt) || 0,
          _actor_id: user?.id,
        },
      });
      toast.success(`Đã tạo khách hàng: ${quickCustName.trim()}`);
      setQuickCustOpen(false);
      const savedName = quickCustName.trim();
      const savedPhone = quickCustPhone.trim();
      resetQuickCustForm();
      // Tìm lại khách vừa tạo qua tìm-kiếm-server rồi tự chọn.
      setTimeout(async () => {
        try {
          const r = await listCustomersFn({
            data: { search: savedName, page: 1, pageSize: 20 },
          });
          const newCust = (r?.customers ?? []).find(
            (c: any) =>
              c.name === savedName && (!savedPhone || c.phone === savedPhone),
          );
          if (newCust) setCustomer(newCust.id);
        } catch {
          /* ignore */
        }
      }, 400);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tạo khách hàng");
    } finally {
      setSavingCust(false);
    }
  }

  function reset() {
    const allowedBranches = (stats?.branches ?? []).filter(
      (b: any) => isAdmin || !user || user.branch_ids.length === 0 || user.branch_ids.includes(b.id),
    );

    setItems([]);
    setCustomer("");
    setBranch(allowedBranches[0]?.id ?? "");
    setEmployee(user?.id ?? "");
    setStatus("reserved");
    setPaymentMethod("tien_mat");
    setBankAccountIdx("");
    setBankContent("");
    setDiscountRaw("0");
    setDiscountPct("0");
    setUseDiscountPct(false);
    // Giữ lại cài đặt VAT người dùng đã nhập trước đó (đã lưu)
    const _vp = loadVatPref();
    setIncludeVat(_vp?.includeVat ?? false);
    setVatMode(_vp?.vatMode ?? "10");
    setVatCustomPercent(_vp?.vatCustomPercent ?? "");
    setVatAmountRaw(_vp?.vatAmountRaw ?? "0");
    setDepositRaw("0");
    setKhachThanhToanRaw("");
    setNote("");
    setCreateScheduleOnOrder(false);
    setScheduleForm({
      title: "",
      work_type_id: workTypes?.[0]?.id || "",
      scheduled_date: new Date().toISOString().slice(0, 10),
      scheduled_time: new Date().toTimeString().slice(0, 5),
      address: "",
      note: "",
    });
  }

  function addItem() {
    const p = data?.products?.[0];
    if (!p) return;
    setItems([
      ...items,
      {
        product_id: p.id,
        qty: 1,
        unit_price: (p as any).sale_price ?? 0,
        discount: 0,
      },
    ]);
  }

  async function submit() {
    if (items.length === 0) return toast.error("Đơn chưa có sản phẩm");
    if (!branch) return toast.error("Chọn chi nhánh");

    if (createScheduleOnOrder && !scheduleForm.title) {
      return toast.error("Vui lòng nhập tiêu đề lịch làm việc");
    }

    // Nếu khách trả đủ hoặc thừa → completed; ngược lại giữ status đã chọn
    const finalStatus = khachThanhToan >= khachCanThanhToan && khachCanThanhToan > 0
      ? "completed"
      : khachThanhToan > 0 && khachCanThanhToan > 0
      ? "completed"    // trả 1 phần cũng ghi completed, phần còn lại tính công nợ
      : status;

    // ✅ Điều kiện đơn HOÀN TẤT: bắt buộc phải có khách hàng.
    //    (Đơn "Đặt hàng (chưa giao)" / "Nháp" vẫn cho phép Khách lẻ — để trống khách.)
    if (finalStatus === "completed" && !customer) {
      return toast.error("Đơn hoàn tất phải có khách hàng. Vui lòng chọn khách hàng, hoặc lưu ở trạng thái Đặt hàng (chưa giao).");
    }

    setSubmitting(true);
    try {
      const r = await create({
        data: {
          customer_id: customer || undefined,
          branch_id: branch,
          employee_id: employee || undefined,
          status: finalStatus,
          payment_method: paymentMethod,
          discount: discountAmt,
          discount_type: useDiscountPct ? "percent" : "amount",
          discount_pct: useDiscountPct ? parseFloat(discountPct) || 0 : 0,
          vat_rate: includeVat ? vatRate : 0,
          vat_amount: vatAmt,
          deposit,
          paid: khachThanhToan,
          note: note || undefined,
          items,
        },
      });

      if (createScheduleOnOrder && scheduleForm.title && user) {
        try {
          await createScheduleFn({
            data: {
              ...scheduleForm,
              order_id: r.id,
              customer_id: customer || undefined,
              branch_id: branch,
              created_by: user.id,
              assigned_by: undefined,
            },
          });
        } catch (se: any) {
          toast.warning("Đơn đã tạo nhưng lịch làm việc lỗi: " + (se?.message ?? ""));
        }
      }

      setReceiptOrder({
        ...r,
        subtotal,
        discountAmt,
        vatAmt,
        total,
        deposit,
        khachCanThanhToan,
        khachThanhToan,
        congNo,
        items,
        customer,
        customerName: selectedCustomerObj?.name ?? "Khách lẻ",
        customerObj: selectedCustomerObj ?? null,
        branch,
        employee,
        paymentMethod,
        note,
        includeVat,
        vatRate: includeVat ? vatRate : 0,
        discountType: useDiscountPct ? "percent" : "amount",
        discountPct: useDiscountPct ? parseFloat(discountPct) || 0 : 0,
      });

      toast.success("Tạo đơn " + r.code);
      reset();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["orderRefs"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setReceiptOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi");
    } finally {
      setSubmitting(false);
    }
  }

  function OrderTable({ rows }: { rows: any[] }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2 pr-2 w-8 text-center">STT</th>
              <th className="pr-2">Mã đơn</th>
              <th className="pr-2">Ngày tạo / HT</th>
              <th className="pr-2">Khách hàng</th>
              <th className="pr-2">Chi nhánh</th>
              <th className="text-right pr-2">Tổng</th>
              <th className="pr-2">Trạng thái</th>
              <th className="pr-2">Lịch lắp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, idx) => {
              const cust = o.customer_name ?? "Khách lẻ";
              const br = o.branch_name ?? "—";
              const linkedCount = Number(o.schedule_count ?? 0);
              const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;

              return (
                <tr
                  key={o.id}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => navigate({ to: "/orders/$id", params: { id: o.id } })}
                >
                  <td className="py-2 text-center text-xs text-muted-foreground pr-2">
                    {globalIdx}
                  </td>
                  <td className="font-mono text-xs pr-2 font-medium">{o.code}</td>
                  <td className="text-xs text-muted-foreground pr-2 whitespace-nowrap">
                    {new Date(o.status === "completed" && o.completed_at ? o.completed_at : o.created_at).toLocaleString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="pr-2 max-w-[140px] truncate">{cust}</td>
                  <td className="pr-2 text-xs text-muted-foreground">{br}</td>
                  <td className="text-right font-medium pr-2 whitespace-nowrap">
                    {fmt(o.total)}
                  </td>
                  <td className="pr-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? "bg-secondary"}`}
                    >
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="pr-2" onClick={(e) => e.stopPropagation()}>
                    {linkedCount === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Link
                        to="/schedule"
                        className="inline-flex items-center gap-1 text-xs rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 hover:bg-blue-100"
                      >
                        <CalendarDays className="h-3 w-3" /> {linkedCount} lịch
                      </Link>
                    )}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Link
                      to="/orders/$id"
                      params={{ id: o.id }}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      title="Xem chi tiết"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  Không có đơn nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AppShell title="Bán hàng" loading={ordersLoading}>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              Tạo đơn hàng
            </Button>
          </DialogTrigger>

          <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Tạo đơn hàng</DialogTitle>
              <DialogDescription>
                Tạo hóa đơn bán hàng hoặc đơn đặt hàng cho khách.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Khách hàng</Label>
                    <button
                      type="button"
                      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                      onClick={() => { resetQuickCustForm(); setQuickCustOpen(true); }}
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Tạo mới
                    </button>
                  </div>
                  <AsyncSearchableSelect
                    value={customer}
                    onChange={setCustomer}
                    emptyLabel="Khách lẻ"
                    placeholder="Tìm khách hàng..."
                    fetchOptions={async (q) => {
                      const r = await listCustomersFn({
                        data: { search: q, page: 1, pageSize: 20 },
                      });
                      return (r?.customers ?? []).map((c: any) => ({
                        value: c.id,
                        label: c.name,
                        sub: c.phone ?? undefined,
                      }));
                    }}
                    resolveSelected={async (idv) => {
                      const c = await custLiteFn({ data: { id: idv } });
                      return c
                        ? { value: c.id, label: c.name, sub: c.phone ?? undefined }
                        : null;
                    }}
                  />
                </div>

                <div>
                  <Label>Chi nhánh</Label>
                  <SearchableSelect
                    value={branch}
                    onChange={setBranch}
                    placeholder="Tìm chi nhánh..."
                    options={(stats?.branches ?? [])
                      .filter((b: any) => isAdmin || !user || user.branch_ids.length === 0 || user.branch_ids.includes(b.id))
                      .map((b: any) => ({ value: b.id, label: b.name }))}
                  />
                </div>

                <div>
                  <Label>Nhân viên</Label>
                  <SearchableSelect
                    value={employee}
                    onChange={setEmployee}
                    emptyLabel="---"
                    placeholder="Tìm nhân viên..."
                    options={(data?.employees ?? []).map((e: any) => ({
                      value: e.id,
                      label: e.name,
                    }))}
                  />
                </div>

                <div>
                  <Label>Trạng thái</Label>
                  <SearchableSelect
                    value={status}
                    onChange={(v) => setStatus(v as any)}
                    placeholder="Chọn trạng thái..."
                    options={[
                      { value: "reserved", label: "Đặt hàng (chưa giao)" },
                      { value: "draft", label: "Nháp" },
                    ]}
                  />
                </div>

                <div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Sản phẩm</Label>
                  <Button size="sm" type="button" variant="outline" onClick={addItem}>
                    <Plus className="h-4 w-4 mr-1" /> Thêm SP
                  </Button>
                </div>

                <div className="space-y-2">
                  {items.length === 0 && (
                    <div className="text-muted-foreground text-sm py-2">
                      Chưa có sản phẩm. Bấm "Thêm SP".
                    </div>
                  )}

                  {items.map((item, idx) => {
                    const currentProd = (data?.products ?? []).find((x: any) => x.id === item.product_id);
                    const currentStock = stockByProduct.get(item.product_id) ?? 0;
                    const lineTotal = item.qty * item.unit_price - item.discount;
                    
                    return (
                      <div key={idx} className="flex flex-col gap-1.5 rounded-lg border p-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <SearchableSelect
                            className="flex-1"
                            value={item.product_id}
                            onChange={(val) => {
                              const p = (data?.products ?? []).find((x: any) => x.id === val);
                              const next = [...items];
                              next[idx] = {
                                ...next[idx],
                                product_id: val,
                                unit_price: (p as any)?.sale_price ?? 0,
                              };
                              setItems(next);
                            }}
                            placeholder="Chọn sản phẩm..."
                            options={(data?.products ?? []).map((p: any) => {
                              const st = stockByProduct.get(p.id) ?? 0;
                              return {
                                value: p.id,
                                label: p.name,
                                sub: p.sku ? `SKU: ${p.sku} | Tồn: ${st}` : `Tồn: ${st}`,
                              };
                            })}
                          />
                          <button
                            type="button"
                            className="flex items-center justify-center rounded-md border hover:text-destructive p-1.5 shrink-0"
                            onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center border rounded-md overflow-hidden shrink-0">
                            <button
                              type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-r text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const n = [...items];
                                n[idx].qty = Math.max(1, n[idx].qty - 1);
                                setItems(n);
                              }}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              className="w-12 text-center text-sm py-1.5 bg-background border-0 outline-none [appearance:textfield]"
                              value={item.qty}
                              min={1}
                              onChange={(e) => {
                                const n = [...items];
                                n[idx].qty = Math.max(1, Number(e.target.value) || 1);
                                setItems(n);
                              }}
                            />
                            <button
                              type="button"
                              className="px-2 py-1.5 hover:bg-muted transition-colors border-l text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const n = [...items];
                                n[idx].qty = n[idx].qty + 1;
                                setItems(n);
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input
                            className="flex-1"
                            placeholder="Đơn giá"
                            value={item.unit_price === 0 ? "" : new Intl.NumberFormat("vi-VN").format(item.unit_price)}
                            onChange={(e) => {
                              const n = [...items];
                              n[idx].unit_price = parseInput(e.target.value);
                              setItems(n);
                            }}
                          />
                          <div className="flex flex-col justify-center text-right shrink-0 min-w-[100px]">
                            <span className="text-sm font-semibold text-primary">{fmt(lineTotal)}</span>
                            <span className={`text-[11px] font-medium ${currentStock < item.qty ? "text-destructive" : "text-muted-foreground"}`}>
                              Kho: {currentStock}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>Giảm giá</Label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={useDiscountPct}
                        onCheckedChange={(v) => setUseDiscountPct(!!v)}
                        id="use-pct"
                      />
                      Theo %
                    </label>
                  </div>
                  {useDiscountPct ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="flex-1"
                        placeholder="0"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  ) : (
                    <Input
                      className="mt-1"
                      value={discountRaw}
                      onChange={(e) => setDiscountRaw(fmtInput(e.target.value))}
                      onFocus={(e) => e.target.select()}
                    />
                  )}
                </div>

                <div>
                  <Label>Đặt cọc (₫)</Label>
                  <Input
                    className="mt-1"
                    value={depositRaw}
                    onChange={(e) => setDepositRaw(fmtInput(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              {/* ── Hình thức thanh toán (áp dụng cho tiền cọc & tiền khách trả) ── */}
              <div className="rounded-lg border bg-background p-3 space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hình thức thanh toán</Label>
                <div className="flex flex-wrap gap-4 mt-1">
                  {([
                    { value: "tien_mat", label: "Tiền mặt" },
                    { value: "ngan_hang", label: "Chuyển khoản" },
                  ] as const).map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="order_payment_method"
                        value={opt.value}
                        checked={paymentMethod === opt.value}
                        onChange={() => {
                          setPaymentMethod(opt.value);
                          setBankAccountIdx("");
                          setBankContent("");
                        }}
                        className="accent-neutral-900"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {paymentMethod === "ngan_hang" && (() => {
                  const bankList: any[] = (() => {
                    try { return JSON.parse(siteSettings?.bank_accounts || "[]"); }
                    catch { return []; }
                  })();
                  return (
                    <div className="mt-1 space-y-2">
                      {bankList.length > 0 && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Chọn tài khoản nhận tiền</Label>
                          <select
                            className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                            value={bankAccountIdx}
                            onChange={e => {
                              const idx = e.target.value;
                              setBankAccountIdx(idx);
                              if (idx !== "") {
                                const ba = bankList[parseInt(idx)];
                                if (ba && !bankContent) {
                                  setBankContent(`${siteSettings?.site_name ?? "CK"} ${ba.account_number}`);
                                }
                              }
                            }}
                          >
                            <option value="">— Chọn STK —</option>
                            {bankList.map((ba: any, i: number) => (
                              <option key={i} value={String(i)}>
                                {ba.bank} - {ba.account_number} ({ba.account_name})
                              </option>
                            ))}
                          </select>
                          {bankAccountIdx !== "" && (() => {
                            const ba = bankList[parseInt(bankAccountIdx)];
                            return ba ? (
                              <div className="mt-1.5 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-foreground space-y-0.5">
                                <div className="font-semibold text-sm">{ba.bank}</div>
                                <div>STK: <span className="font-mono font-bold tracking-wide">{ba.account_number}</span></div>
                                <div>Chủ TK: {ba.account_name}</div>
                                {ba.note && <div className="text-muted-foreground">{ba.note}</div>}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="rounded-lg border overflow-hidden">
                <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2.5 hover:bg-muted/30 transition-colors">
                  <Checkbox checked={includeVat} onCheckedChange={(v) => setIncludeVat(!!v)} id="vat" />
                  <span className="text-sm font-medium">Thu thuế VAT</span>
                  {includeVat && <span className="ml-auto text-sm font-semibold text-orange-600">+ {fmt(vatAmt)}</span>}
                </label>
                {includeVat && (
                  <div className="border-t px-3 py-2.5 bg-orange-50/40 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground font-medium">Thuế suất:</span>
                    {(["8", "10"] as const).map(rate => (
                      <label key={rate} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="vat-rate"
                          value={rate}
                          checked={vatMode === rate}
                          onChange={() => setVatMode(rate)}
                          className="accent-primary"
                        />
                        {rate}%
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="vat-rate"
                        value="custom"
                        checked={vatMode === "custom"}
                        onChange={() => setVatMode("custom")}
                        className="accent-primary"
                      />
                      Tự nhập %
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="vat-rate"
                        value="amount"
                        checked={vatMode === "amount"}
                        onChange={() => setVatMode("amount")}
                        className="accent-primary"
                      />
                      Số tiền
                    </label>
                    {vatMode === "custom" && (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="w-24 h-7 text-sm"
                          placeholder="% VAT"
                          value={vatCustomPercent}
                          onChange={(e) => setVatCustomPercent(e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    )}
                    {vatMode === "amount" && (
                      <div className="flex items-center gap-1">
                        <Input
                          className="w-32 h-7 text-sm"
                          placeholder="Số tiền VAT"
                          value={vatAmountRaw === "0" || vatAmountRaw === "" ? "" : fmtInput(vatAmountRaw)}
                          onChange={(e) => setVatAmountRaw(String(parseInput(e.target.value)))}
                          onFocus={(e) => e.target.select()}
                        />
                        <span className="text-sm text-muted-foreground">₫</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Label>Ghi chú đơn hàng</Label>
                <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <div className="rounded-lg border overflow-hidden">
                <label className="flex items-center gap-2 cursor-pointer select-none bg-blue-50/60 px-3 py-2.5 hover:bg-blue-100/60 transition-colors">
                  <Checkbox
                    checked={createScheduleOnOrder}
                    onCheckedChange={(v) => setCreateScheduleOnOrder(!!v)}
                    id="create-schedule"
                  />
                  <CalendarDays className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Tạo lịch làm việc đi kèm luôn</span>
                </label>
                {createScheduleOnOrder && (
                  <div className="p-3 space-y-3 bg-blue-50/20 border-t">
                    <div>
                      <Label className="text-xs font-semibold">Tiêu đề lịch làm việc *</Label>
                      <Input
                        className="mt-1 h-9 text-sm font-medium"
                        value={scheduleForm.title}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                        placeholder="Tiêu đề tự động tạo ra hoặc nhập mới..."
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold">Loại hình công việc</Label>
                        <select
                          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={scheduleForm.work_type_id}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, work_type_id: e.target.value })}
                        >
                          <option value="">-- Chọn loại công việc --</option>
                          {workTypes?.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name} {t.price ? `(${fmt(t.price)})` : ""}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Ngày thực hiện</Label>
                        <Input
                          type="date"
                          className="mt-1 h-9 text-sm"
                          value={scheduleForm.scheduled_date}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_date: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Giờ thực hiện</Label>
                      <Input
                        type="time"
                        className="mt-1 h-9 text-sm"
                        value={scheduleForm.scheduled_time}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_time: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Địa chỉ lắp đặt</Label>
                      <Input
                        className="mt-1 h-9 text-sm"
                        value={scheduleForm.address}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, address: e.target.value })}
                        placeholder="Địa chỉ lắp đặt (tự động lấy từ khách hàng)..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Ghi chú công việc</Label>
                      <Input
                        className="mt-1 h-9 text-sm"
                        value={scheduleForm.note}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, note: e.target.value })}
                        placeholder="Nội dung nhắc nhở thêm cho kỹ thuật..."
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-4 bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span>Tổng tiền hàng ({items.length})</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {discountAmt > 0 && (
                  <div className="flex justify-between text-sm mt-1 text-green-700">
                    <span>Giảm giá{useDiscountPct ? ` (${discountPct}%)` : ""}</span>
                    <span>- {fmt(discountAmt)}</span>
                  </div>
                )}
                {includeVat && (
                  <div className="flex justify-between text-sm mt-1 text-orange-600">
                    <span>Thuế VAT ({vatMode === "amount" ? "số tiền" : vatMode === "custom" ? `${vatCustomPercent || 0}%` : `${vatMode}%`})</span>
                    <span>+ {fmt(vatAmt)}</span>
                  </div>
                )}
                {deposit > 0 && (
                  <div className="flex justify-between text-sm mt-1 text-yellow-700">
                    <span>Đặt cọc</span>
                    <span>- {fmt(deposit)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t text-primary">
                  <span>Khách cần trả</span>
                  <span className="text-blue-600">{fmt(khachCanThanhToan)}</span>
                </div>
              </div>

              {/* Đã bỏ khối "Khách thanh toán" ở form tạo đơn theo yêu cầu.
                  Tạo đơn xong, việc thanh toán được thực hiện ở trang chi tiết đơn. */}

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
                  Hủy
                </Button>
                <Button
                  className="w-full sm:w-auto font-bold text-base h-12 bg-primary text-primary-foreground"
                  onClick={submit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang xử lý...</>
                  ) : "Tạo đơn"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Quick Create Customer Dialog — Full form đồng bộ với trang Khách hàng */}
        <Dialog open={quickCustOpen} onOpenChange={setQuickCustOpen}>
          <DialogContent style={{ padding: 0 }} className="max-h-[92vh] max-w-2xl overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
            <DialogHeader className="px-6 pt-6 pb-4 bg-muted/40 border-b">
              <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
                <div className="p-1.5 bg-primary/10 text-primary rounded-lg">
                  <UserPlus className="h-5 w-5" />
                </div>
                Thêm khách hàng mới
              </DialogTitle>
            </DialogHeader>

            <div className="p-4 space-y-5">
              {/* PHẦN 1: THÔNG TIN CƠ BẢN */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <UserPlus className="h-4 w-4" /> Thông tin cơ bản
                </div>
                <div className="flex gap-4">
                  {(["ca_nhan", "to_chuc"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="radio" name="qc_cust_type" value={t}
                        checked={quickCustType === t}
                        onChange={() => setQuickCustType(t)}
                        className="accent-primary" />
                      {t === "ca_nhan" ? "Cá nhân" : "Tổ chức / Hộ kinh doanh"}
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs font-medium">
                      {quickCustType === "to_chuc" ? "Tên người mua" : "Họ và tên"} <span className="text-destructive">*</span>
                    </Label>
                    <Input className="bg-background mt-1" placeholder="Nhập tên đầy đủ"
                      value={quickCustName} autoFocus
                      onChange={(e) => setQuickCustName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số điện thoại</Label>
                    <Input className="bg-background mt-1" placeholder="0912xxxxxx"
                      value={quickCustPhone} onChange={(e) => setQuickCustPhone(e.target.value)} />
                  </div>
                </div>
                {quickCustType === "ca_nhan" && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Email</Label>
                        <Input className="bg-background mt-1" placeholder="email@gmail.com"
                          value={quickCustEmail} onChange={(e) => setQuickCustEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Giới tính</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGender} onChange={(e) => setQuickCustGender(e.target.value)}>
                          <option value="">-- Chọn --</option>
                          <option value="nam">Nam</option>
                          <option value="nu">Nữ</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Ngày sinh</Label>
                        <Input type="date" className="bg-background mt-1"
                          value={quickCustBirthday} onChange={(e) => setQuickCustBirthday(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Nhóm đối tác</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGroup} onChange={(e) => setQuickCustGroup(e.target.value)}>
                          {Object.entries(GROUP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Số CCCD / CMND</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập số CCCD/CMND"
                          value={quickCustCccd} onChange={(e) => setQuickCustCccd(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Số hộ chiếu</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập số hộ chiếu"
                          value={quickCustPassport} onChange={(e) => setQuickCustPassport(e.target.value)} />
                      </div>
                    </div>
                  </>
                )}
                {quickCustType === "to_chuc" && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Tên công ty / Hộ kinh doanh</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập tên công ty"
                          value={quickCustCompany} onChange={(e) => setQuickCustCompany(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Mã số thuế</Label>
                        <Input className="bg-background mt-1" placeholder="Nhập mã số thuế"
                          value={quickCustTaxCode} onChange={(e) => setQuickCustTaxCode(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Email</Label>
                        <Input className="bg-background mt-1" placeholder="email@company.com"
                          value={quickCustEmail} onChange={(e) => setQuickCustEmail(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Nhóm đối tác</Label>
                        <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={quickCustGroup} onChange={(e) => setQuickCustGroup(e.target.value)}>
                          {Object.entries(GROUP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Ghi chú</Label>
                  <Input className="bg-background mt-1" placeholder="Ghi chú thêm về khách hàng..."
                    value={quickCustNote} onChange={(e) => setQuickCustNote(e.target.value)} />
                </div>
              </div>

              {/* PHẦN 2: ĐỊA CHỈ */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <MapPin className="h-4 w-4" /> Địa chỉ liên hệ
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Tỉnh / Thành phố</Label>
                    <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={quickCustProvince} onChange={(e) => setQuickCustProvince(e.target.value)}>
                      <option value="">-- Chọn tỉnh thành --</option>
                      {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Phường / Xã</Label>
                    <Input className="bg-background mt-1" placeholder="Nhập phường/xã"
                      value={quickCustWard} onChange={(e) => setQuickCustWard(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Số nhà, tên đường</Label>
                  <Input className="bg-background mt-1" placeholder="Ví dụ: Số 123, đường Trần Hưng Đạo"
                    value={quickCustAddress} onChange={(e) => setQuickCustAddress(e.target.value)} />
                </div>
              </div>

              {/* PHẦN 3: NGÂN HÀNG */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <Landmark className="h-4 w-4" /> Thông tin ngân hàng
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Ngân hàng</Label>
                    <Input className="bg-background mt-1" placeholder="VD: Vietcombank, Techcombank..."
                      value={quickCustBankName} onChange={(e) => setQuickCustBankName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Số tài khoản ngân hàng</Label>
                    <Input className="bg-background mt-1 font-mono" placeholder="Nhập số tài khoản"
                      value={quickCustBankAccount} onChange={(e) => setQuickCustBankAccount(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* PHẦN 4: CÔNG NỢ */}
              <div className="space-y-4 p-5 bg-muted/30 rounded-xl border border-border/70">
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                  <Wallet className="h-4 w-4" /> Thiết lập tài chính
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Dư nợ công nợ đầu kỳ (nếu có)</Label>
                    <div className="relative mt-1">
                      <Input className="pl-8 bg-background font-medium text-destructive"
                        inputMode="numeric" placeholder="0"
                        value={quickCustDebt}
                        onChange={(e) => setQuickCustDebt(e.target.value.replace(/[^\d.]/g, ""))} />
                      <div className="absolute left-3 top-2.5 text-xs text-muted-foreground font-semibold">đ</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground pt-0 md:pt-6">
                    Khoản tiền khách đang nợ cửa hàng tính tới thời điểm tạo tài khoản.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setQuickCustOpen(false)}>Hủy bỏ</Button>
                <Button type="button" className="px-6" onClick={handleQuickCreateCustomer} disabled={savingCust}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {savingCust ? "Đang tạo..." : "Lưu thông tin"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
          <DialogContent className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-green-700 flex items-center gap-2">
                <span className="text-xl">✅</span> Đơn hàng đã tạo thành công!
              </DialogTitle>
              <DialogDescription>
                Phiếu thu dưới đây để truy thu số tiền còn nợ. In hoặc đóng để tiếp tục.
              </DialogDescription>
            </DialogHeader>
            {receiptOrder && (() => {
              const moneyFmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
              const custName = receiptOrder.customerName ?? "Khách lẻ";
              const branchName = receiptOrder.branch
                ? (data?.branches ?? []).find((b: any) => b.id === receiptOrder.branch)?.name ?? "—"
                : "—";
              const empName = receiptOrder.employee
                ? (data?.employees ?? []).find((e: any) => e.id === receiptOrder.employee)?.name ?? "—"
                : "—";
              return (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3">
                    <div><span className="text-muted-foreground">Mã đơn: </span><strong className="font-mono">{receiptOrder.code}</strong></div>
                    <div><span className="text-muted-foreground">Khách: </span>{custName}</div>
                    <div><span className="text-muted-foreground">Chi nhánh: </span>{branchName}</div>
                    <div><span className="text-muted-foreground">Nhân viên: </span>{empName}</div>
                    <div><span className="text-muted-foreground">Thanh toán: </span>{receiptOrder.paymentMethod === "ngan_hang" ? "Chuyển khoản" : "Tiền mặt"}</div>
                  </div>

                  <div className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tạm tính</span>
                      <span>{moneyFmt(receiptOrder.subtotal)}</span>
                    </div>
                    {receiptOrder.discountAmt > 0 && (
                      <div className="flex justify-between text-green-700">
                        <span>Giảm giá</span>
                        <span>- {moneyFmt(receiptOrder.discountAmt)}</span>
                      </div>
                    )}
                    {receiptOrder.includeVat && (
                      <div className="flex justify-between text-orange-600">
                        <span>Thuế VAT</span>
                        <span>+ {moneyFmt(receiptOrder.vatAmt)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium border-t pt-1.5">
                      <span>Tổng tiền</span>
                      <span>{moneyFmt(receiptOrder.total)}</span>
                    </div>
                    {receiptOrder.deposit > 0 && (
                      <div className="flex justify-between text-yellow-700">
                        <span>Đặt cọc</span>
                        <span>- {moneyFmt(receiptOrder.deposit)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg pt-1 border-t text-green-700">
                      <span>Còn phải thu</span>
                      <span>{moneyFmt(receiptOrder.khachCanThanhToan)}</span>
                    </div>
                  </div>

                  {receiptOrder.note && <div className="text-muted-foreground text-xs">Ghi chú: {receiptOrder.note}</div>}
                </div>
              );
            })()}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (receiptOrder && data && siteSettings) {
                    printOrderSlip({
                      items: receiptOrder.items,
                      customer: receiptOrder.customer,
                      branch: receiptOrder.branch,
                      employee: receiptOrder.employee,
                      status: receiptOrder.status,
                      paymentMethod: receiptOrder.paymentMethod,
                      discount: receiptOrder.discountAmt,
                      discountAmt: receiptOrder.discountAmt,
                      vatAmt: receiptOrder.vatAmt,
                      deposit: receiptOrder.deposit,
                      note: receiptOrder.note,
                      subtotal: receiptOrder.subtotal,
                      total: receiptOrder.total,
                      includeVat: receiptOrder.includeVat,
                      data,
                      siteSettings,
                      code: receiptOrder.code,
                      createdAt: receiptOrder.created_at,
                      vatRate: receiptOrder.vatRate,
                      discountType: receiptOrder.discountType,
                      discountPct: receiptOrder.discountPct,
                      customerObj: receiptOrder.customerObj,
                      tpl: (() => { try { return JSON.parse(siteSettings?.print_templates || "{}").order_invoice; } catch { return {}; } })(),
                    });
                  }
                }}
              >
                🖨️ In phiếu
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => setReceiptOpen(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {reservedCount > 0 && (
          <span className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1 flex items-center gap-1">
            <Clock className="h-3 w-3" /> {reservedCount} đơn đặt hàng chờ giao
          </span>
        )}
      </div>

      <div className="flex gap-1 mb-3 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === "orders" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("orders")}
        >
          <ShoppingBag className="h-4 w-4 inline mr-1" /> Hóa đơn bán hàng
        </button>

        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeTab === "reserved" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => handleTab("reserved")}
        >
          <Clock className="h-4 w-4 inline mr-1" /> Đơn đặt hàng
          {reservedCount > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5">
              {reservedCount}
            </span>
          )}
        </button>
      </div>

      <Card>
        <SearchFilter
          search={search}
          onSearch={handleSearch}
          placeholder="Tìm mã đơn, khách hàng..."
          sortOptions={[
            { value: "newest", label: "Mới nhất" },
            { value: "oldest", label: "Cũ nhất" },
            { value: "total_desc", label: "Giá trị cao nhất" },
            { value: "total_asc", label: "Giá trị thấp nhất" },
          ]}
          sortValue={sortBy}
          onSort={handleSort}
          filterSlot={
            <div className="flex flex-wrap items-center gap-2">
              {activeTab === "orders" && (
<select
  className="h-9 rounded-md border bg-background px-2 text-sm"
  value={filterStatus}
  onChange={(e) => {
    setFilterStatus(e.target.value);
    setPage(1);
  }}
>
  <option value="">Tất cả trạng thái</option>
  <option value="completed">Hoàn tất</option>
  <option value="partially_returned">Trả hàng 1 phần</option>
  <option value="returned">Đã trả hàng</option>
  <option value="draft">Nháp</option>
  <option value="cancelled">Hủy</option>
</select>
              )}

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filterBranch}
                onChange={(e) => {
                  setFilterBranch(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả chi nhánh</option>
                {(stats?.branches ?? []).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {/* Lọc theo khách hàng */}
              <div className="w-full sm:w-44">
                <AsyncSearchableSelect
                  value={filterCustomer}
                  onChange={(v) => { setFilterCustomer(v); setPage(1); }}
                  emptyLabel="Tất cả khách"
                  placeholder="Lọc khách hàng..."
                  fetchOptions={async (q) => {
                    const r = await listCustomersFn({ data: { search: q, page: 1, pageSize: 20 } });
                    return (r?.customers ?? []).map((c: any) => ({
                      value: c.id, label: c.name, sub: c.phone ?? undefined,
                    }));
                  }}
                  resolveSelected={async (idv) => {
                    const c = await custLiteFn({ data: { id: idv } });
                    return c ? { value: c.id, label: c.name, sub: c.phone ?? undefined } : null;
                  }}
                />
              </div>

              {/* Lọc theo nhân viên — CHỈ admin */}
              {isAdmin && (
                <div className="w-full sm:w-40">
                  <SearchableSelect
                    value={filterEmployee}
                    onChange={(v) => { setFilterEmployee(v); setPage(1); }}
                    emptyLabel="Tất cả NV"
                    placeholder="Lọc nhân viên..."
                    options={(stats?.employees ?? []).map((e: any) => ({ value: e.id, label: e.name }))}
                  />
                </div>
              )}

              {/* Lọc theo khoảng ngày (đơn hoàn tất: ngày HT; còn lại: ngày tạo) */}
              <div className="flex items-center gap-1">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  type="date"
                  className="h-9 w-[140px] rounded-md border bg-background px-2 text-sm"
                  value={filterFrom}
                  max={filterTo || undefined}
                  onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                  aria-label="Từ ngày"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <input
                  type="date"
                  className="h-9 w-[140px] rounded-md border bg-background px-2 text-sm"
                  value={filterTo}
                  min={filterFrom || undefined}
                  onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                  aria-label="Đến ngày"
                />
              </div>

              {(filterCustomer || (isAdmin && filterEmployee) || filterFrom || filterTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs text-muted-foreground"
                  onClick={() => {
                    setFilterCustomer("");
                    setFilterEmployee("");
                    setFilterFrom("");
                    setFilterTo("");
                    setPage(1);
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Xóa lọc
                </Button>
              )}
            </div>
          }
          total={totalFiltered}
          totalLabel={activeTab === "reserved" ? "đơn đặt hàng" : "đơn hàng"}
        />

        <OrderTable rows={pagedOrders} />

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm flex-wrap gap-2">
            <span className="text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalFiltered)} / {totalFiltered}
            </span>

            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((n) => (
                <Button key={n} size="sm" variant={n === page ? "default" : "outline"} className="w-8 h-8 p-0" onClick={() => setPage(n)}>
                  {n}
                </Button>
              ))}
              <Button size="icon" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
}