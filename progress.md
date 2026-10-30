# PROGRESS — Mr.Vũ POS (www.ttv.vn)

> Tài liệu bàn giao cho kỹ sư / AI tiếp theo. Cập nhật lần cuối: **08/10/2026**.
> Đọc file này TRƯỚC khi sửa code. `README.md` và `PERFORMANCE.md` là tài liệu cũ (thời Lovable / Vercel Postgres, dữ liệu mẫu trong RAM) — **không còn đúng** về hạ tầng; tin file này.

---

## 1. Tổng quan

Phần mềm quản lý bán hàng + nhân sự cho chuỗi showroom quạt trần **Mr.Vũ** (HCM, Hà Nội, Đà Nẵng, Hải Phòng…). Người dùng là chủ doanh nghiệp (admin) và nhân viên bán hàng / kỹ thuật / kho. Giao diện và dữ liệu hoàn toàn tiếng Việt.

| Hạng mục | Công nghệ |
|---|---|
| Framework | **TanStack Start v1.168** (React 19, file routes trong `src/routes`), Vite, TailwindCSS, shadcn/ui (`src/components/ui`), lucide-react, recharts, Font Awesome (chỉ trang Admin) |
| Server logic | `createServerFn` trong `src/lib/*.functions.ts` (gọi từ client qua `useServerFn`) |
| Database | **Supabase Postgres** qua PostgREST (`@supabase/supabase-js`) |
| Deploy | **Vercel** (domain www.ttv.vn). Commit / push do chủ dự án tự làm |
| Tích hợp | Zalo OA + ZNS (tin nhắn theo SĐT), Resend (email), Cloudinary (ảnh), exceljs (xuất Excel) |

Lệnh: `npm run dev` · `npm run build` · kiểm kiểu `npx tsc --noEmit -p tsconfig.json`.

Biến môi trường (tên, KHÔNG đọc / in giá trị): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_REDIRECT_URI`, `ZALO_TOKEN_SECRET`, `JOB_DRAIN_SECRET`, `RESEND_API_KEY`, `CLOUDINARY_*`. Không dán secret vào chat / log.

---

## 2. Quy ước code BẮT BUỘC

1. **Server function**: `export const xFn = createServerFn({ method }).handler(async ({ data }) => …)`. Hầu hết file `*.functions.ts` có `// @ts-nocheck` vì kiểu tham số `data` bị suy ra `undefined` trên toàn repo — đây là lỗi có sẵn, đừng cố sửa hàng loạt.
2. **Hai Supabase client**:
   - `supabase` (`src/lib/supabase.ts`, anon key, **bị bundle ra trình duyệt**) — cho bảng công khai cũ (products, orders, customers…).
   - `getSupabaseAdmin()` (`src/lib/zalo/admin-client.ts`, service role, chỉ server) — cho mọi bảng nhạy cảm bật **RLS deny-all** (lương, chấm công, lead, zalo, phân việc…). Luôn **kiểm quyền trước** rồi mới dùng.
3. **Xác thực**: KHÔNG có session phía server. Client gửi `actorId` (id người dùng) lên, server tự tra `users` / `user_permissions` / `user_branches`. Đây là **hạn chế đã biết** (giả mạo được actorId) — chủ dự án chọn để phần bảo mật (session thật) làm sau. Đừng xoá các bước kiểm quyền hiện có.
4. **Migration = file SQL chạy tay** trong Supabase SQL Editor (`sql_migration_vN_*.sql`, idempotent: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, kết thúc bằng `NOTIFY pgrst, 'reload schema'`). Tạo file mới, báo chủ dự án chạy. Code phải **chịu được khi migration chưa chạy** nếu có thể (ghi cột mới RIÊNG sau insert chính, `.catch` / fallback select) — đừng để thiếu cột làm hỏng tạo đơn / tạo khách.
5. **Giờ Việt Nam**: dùng `src/lib/date-vn.ts` (`todayVN`, …) hoặc `new Date(Date.now()+7h)`. So sánh mốc thời gian bằng `Date.parse`, KHÔNG so chuỗi ISO khác múi giờ.
6. **SĐT**: lưu bằng `normalizePhoneForStorage` (`src/lib/zalo/phone.ts`); kiểm tra hợp lệ để gửi Zalo bằng `normalizeVnPhone`.
7. **Không hiện thanh cuộn**: `src/styles.css` ẩn scrollbar toàn app. Bảng rộng dùng `src/components/ScrollX.tsx` (kéo chuột + mũi tên) hoặc bố cục vừa khít.
8. **Quyền**: `Permission` + `ALL_PERMISSIONS` trong `src/lib/types.ts`; `hasPermission(user, perm)` (admin luôn true). Nav trong `src/components/AppShell.tsx`.
9. **Chức vụ** (bảng `positions`, id cố định): `pos_sales_manager` (Quản lý bán hàng), `pos_sales` (NV bán hàng), `pos_technician` (Kỹ thuật), `pos_business` (Kinh doanh). Logic lương dựa vào **id**, không dựa vào tên.
10. **Baseline lỗi `tsc`** — mọi thay đổi phải giữ nguyên số lỗi mỗi file (đây là lỗi cũ, không phải của bạn):
    `schedule.tsx 21 · orders/index.tsx 14 · orders/$id.tsx 7 · employees.tsx 6 · customers/index.tsx 6 · DuplicateCustomerAlert.tsx 1`.
    Lệnh đếm: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -oE "^src/[^(]+" | sort | uniq -c`.
11. **File có CRLF**: nhiều file Windows dùng `\r\n`. Script sửa file nên chuẩn hoá `\n` rồi ghi lại đúng kiểu cũ. Tên file tiếng Việt có emoji có thể ở dạng Unicode NFD — tìm bằng phần không dấu (vd `"HCM - 2026"`).

---

## 3. Trạng thái migration (đã kiểm 02/10/2026: đã chạy tới v23 · **v24 CHỜ chủ dự án chạy**)

| File | Nội dung |
|---|---|
| v5–v7, `sql_updates*.sql` | Nền tảng cũ: tài khoản NH, công nợ / trả hàng / lịch sử kho, index |
| v8, v9, v10 | Zalo OA + ZNS (kết nối, hàng đợi `message_jobs`, log, bộ lọc gửi) |
| v11 | Chăm sóc KH: RPC `care_birthdays_today`, `care_maintenance_due` (hạn = ngày xuất kho + 6 tháng), `users.birthday`, RPC `products_with_stock` |
| v12 | `customer_groups` (nhóm khách quản lý được, bắt buộc khi tạo khách) |
| v13 | Nhân sự: `duty_shifts`, `duty_entries` (lịch trực), `pay_profiles`, `attendance_days`, `payroll_periods`, `payroll_items` |
| v14 | Chốt lương theo TỪNG NGƯỜI (`payroll_items.status`) |
| v15 | `products.count_in_total` (false = phụ kiện, không tính thống kê số hàng) |
| v16 | `payroll_assignments` (admin phân ai quản lý lương ai) |
| v17 | `products.is_hidden` (ẩn hàng không kinh doanh) |
| v18 | `positions` + `users.position_id` |
| v19 | `sales_settings` (hệ số % QLBH), `sales_kpis` (KPI theo tháng), `payroll_items.business_revenue / business_override` |
| v20 | `customers.source / source_note` ("Biết Mr.Vũ qua đâu?") |
| v21 | `attendance_days.self_marked` (nhân viên tự chấm) |
| v22 | `customer_leads`, `lead_activities` (khách tiềm năng) |
| v23 | Bảo hành: `products.warranty_months`, `factories`, `warranty_tickets`, `factory_claims`, `warranty_activities` (RLS deny-all). |

| **v24** ⏳ | Bảo hành hai mức: `products.warranty_motor_months` (120), `warranty_tickets.warranty_motor_months`, `warranty_tickets.fault_part`. **Chưa chạy lúc viết** — code chịu được (đọc / ghi cột v24 riêng, `getWarrantyMetaFn().migratedV24`) |
| **v25** ⏳ | SEO Studio: 28 bảng `seo_*` (RLS deny-all, server đọc/ghi qua `SEO_DATABASE_URL`), bucket Storage `seo-images`; phần pg_cron `seo-autopost` ở cuối file chạy riêng sau khi deploy. **Chưa chạy lúc viết** (đã chạy thử 2 lần liên tiếp trên Postgres 18 cục bộ). |

| **v26** ⏳ (`sql_migration_v26.sql`) | `user_sessions` (phiên đăng nhập + thiết bị, RLS deny-all); `warranty_tickets.final_action` thêm `customer_declined`; nếu đã có bảng SEO: `seo_ap_keywords.brief_json` + `seo_tp_runs`. **Chưa chạy lúc viết** (đã chạy thử 2 lần trên Postgres cục bộ). Trước v26: ghi kết quả "Khách không đồng ý" báo lỗi rõ, thẻ thiết bị đăng nhập hiện nhắc chạy v26, đăng nhập vẫn bình thường. |

| **v27** ⏳ (`sql_migration_v27_seo_ban_do_website.sql`) | SEO Studio — Câu hỏi AI (`seo_aiq_projects/questions/runs/checks/advice`) + Bản đồ website (`seo_smap_sites/pages/cycles/snaps/links` + `seo_smap_stage` dữ liệu tạm khi quét), RLS deny-all. Cần v25 trước. **Chưa chạy lúc viết** (đã chạy thử 2 lần liên tiếp trên Postgres 18 cục bộ). Trước v27: 2 tab mới báo "Chưa chạy sql_migration_v27…", các tab khác và cron vẫn chạy. |

Migration tiếp theo đặt tên **v28**.

---

## 4. Các module & nghiệp vụ chính

### 4.1 Bán hàng / đơn hàng — `src/lib/orders.functions.ts`, `src/routes/orders/*`
- Trạng thái đơn: `draft`, `reserved` (đặt cọc), `completed`, `cancelled`, `returned` (phiếu trả hàng là 1 đơn riêng).
- Phiếu thu tại đơn tự tạo trong Sổ quỹ với nội dung `"Thanh toán đơn <mã>" / "Đặt cọc đơn <mã>"`; hoàn tiền trả hàng `"… (đơn gốc <mã>)"`. Các chuỗi này được **parse** ở `sales-collections.ts` — đổi format là hỏng DS bán hàng.
- `createOrder` cuối hàm gọi `enqueueOrderCompletedZns` (Zalo) và `syncLeadWins` (tự chốt lead) — cả hai không được làm hỏng việc tạo đơn.
- Trang đơn nhận `?newFor=<customerId>` → mở sẵn form tạo đơn cho khách đó.

### 4.2 Khách hàng — `src/lib/customers.functions.ts`, `src/routes/customers/*`
- Danh sách dùng RPC `search_customers_page` (chỉ trả cột hiển thị) → `listCustomers` **nạp đủ cột** cho các khách trong trang rồi ghép vào (trước đây form "Sửa" từ danh sách xoá mất giới tính / CCCD / ngân hàng / ghi chú).
- Nhóm khách bắt buộc khi tạo. **Nguồn khách bắt buộc khi tạo** (`CUSTOMER_SOURCES` trong `types.ts`, component `CustomerSourceField`); sửa khách cũ không bắt buộc; giá trị rỗng không bao giờ xoá nguồn cũ. `facebook` là nguồn legacy (ẩn khỏi ô chọn).
- **Ngày sinh khách chỉ ngày + tháng**: lưu năm giữ chỗ **1904** (`src/components/BirthdayDayMonth.tsx`: `formatBirthday`, `hasRealBirthYear`). Khách cũ có năm thật giữ nguyên. Không hiển thị tuổi khi năm = 1904.
- Trang có 2 tab: **Khách hàng | Khách tiềm năng** (`?tab=leads&lead=<id>`).
- **Tên công ty hiện DƯỚI tên khách** ở mọi nơi (khách có `company_name`, không cần là "tổ chức"): component `src/components/CustomerName.tsx`. Các RPC không trả cột này nên server gắn thêm bằng `attachCompany` / `companyNamesOf` (`src/lib/customer-company.ts`) → field `customer_company`. Đã áp dụng: danh sách + chi tiết đơn, phiếu in (`buildInvoiceHtml({ custCompany })`), CSKH, lịch làm việc, sổ quỹ, báo cáo theo khách, Zalo log, Excel bán hàng. Tin Zalo / email gửi khách KHÔNG đổi (vẫn chỉ tên).
- Trang chi tiết khách có mục "Lịch sử tư vấn" (các lead của khách).
- Báo cáo "Đơn hàng bán theo khách": `src/components/SalesByCustomer.tsx` trong trang Báo cáo (admin).

### 4.3 Khách tiềm năng (lead) — `src/lib/leads.functions.ts`, `src/components/leads/*`
- Thay file Excel `🌷QUẢN LÝ KHÁCH HÀNG HCM - 2026 🍀.xlsx` (3 sheet SHR T3 / ĐBP / UT). **Đã nhập 757 lead** bằng `scripts/import-leads-2026.mjs` (có dry-run; `--commit` để ghi; idempotent qua `import_ref`, không đè sửa đổi của nhân viên). T3 = "Mr.Vũ - Số 2 TTT", ĐBP = "Mr.Vũ - 451 ĐBP", UT = "Mr.Vũ - 84/8 TĐX - Q1".
- Trạng thái: `new → consulting → appointment → quoted → won | lost` (`LEAD_STAGES`, `LEAD_LOST_REASONS`, `LEAD_ACTIVITY_KINDS` trong `types.ts`). "Không chốt" bắt buộc lý do.
- **Tự chốt**: `syncLeadWins` — lead đang mở có khách (nối theo SĐT) mà khách có đơn completed/reserved trong [ngày lead, +180 ngày] → `won`, ghi mã đơn + doanh thu. Chạy mỗi lần mở danh sách / báo cáo và sau `createOrder`.
- Quyền (lọc ở server: `canSee` / `canEdit` / `applyScope`):
  - Nhân viên **CHỈ xem / thêm lead thuộc chi nhánh được gán** (`user_branches`), kể cả lead mình phụ trách nhưng nằm ở chi nhánh khác. Admin thấy hết. Áp dụng cho danh sách, Kanban, báo cáo, xuất Excel, "Cần chăm hôm nay", "Lịch sử tư vấn" ở trang khách.
  - Chưa gán chi nhánh nào → không thấy lead nào; `listLeadsFn` trả `noBranch`, giao diện nhắc nhờ admin gán.
  - Sửa: admin; hoặc thuộc chi nhánh của lead VÀ (người phụ trách / hỗ trợ / QLBH). Đổi phụ trách + xoá: admin / QLBH.
  - Cảnh báo trùng SĐT (`findLeadDuplicatesFn`): lead ngoài phạm vi chỉ báo `otherBranchLeads: [{branch_name, count}]`, không lộ tên khách / người phụ trách.
- Form "Thêm khách tiềm năng" có ô **chọn nhu cầu**: "Quan tâm mua quạt mới" (lead như cũ) / "Liên hệ bảo hành" → thân form đổi thành `TicketFormBody` và lưu thành **phiếu bảo hành khách lẻ** (mục 4.9), không tạo lead.
- Giao diện: Danh sách (nhóm theo tháng, tô xanh / đỏ / vàng), Kanban kéo thả, Báo cáo (theo showroom / NV / nguồn / mẫu / lý do / tháng), Xuất Excel đúng bố cục file cũ (`src/lib/export-leads.ts`). Khung "Cần chăm hôm nay" ở trang Tổng quan (`FollowUpCard`).
- Nhân viên "Ani" (44 lead) và "My" (5 lead) chưa có tài khoản → tên gốc nằm ở `legacy_staff`.

### 4.4 Chăm sóc KH (sinh nhật + bảo dưỡng) — `src/lib/care.functions.ts`, `src/routes/care.tsx`, `src/lib/zalo/*`, `src/lib/email.ts`
- Gửi Zalo ZNS (có chế độ thử, danh sách SĐT thử) và email (Resend). Quyền `customer_care`.
- Danh sách bảo dưỡng có cột **"NV tạo đơn"** (tên `orders.employee_id` của các đơn đến hạn).
- Hàng đợi tin: `message_jobs` + `src/lib/zalo/drain.ts`, route `src/routes/api/jobs/drain.ts` (bảo vệ bằng `JOB_DRAIN_SECRET`).

### 4.5 Hàng hóa / tồn kho — `src/lib/products.functions.ts`, `src/routes/products.tsx`, `src/routes/inventory.tsx`
- Tổng tồn lấy từ RPC `products_with_stock` (gộp ở Postgres).
- `count_in_total=false` = phụ kiện đi kèm: không tính vào Tổng hàng tồn / Tổng sản phẩm / Top sản phẩm bán / Tổng SL bán.
- `is_hidden=true` = ngừng kinh doanh: ẩn khỏi danh sách (lọc "Cả hàng ẩn" để xem) và khỏi Top 10 tồn kho. Vẫn chọn được khi tạo đơn (chưa chặn).
- ⚠️ **Lỗi có sẵn chưa sửa**: `upsertProduct` khi SỬA ghi đè `description / power / color / blade_size / tech_fee` thành rỗng vì form không gửi các trường này (29 sản phẩm đang có mô tả sẽ mất nếu bị sửa). Đã báo chủ dự án, chờ đồng ý.

### 4.6 Nhân sự: lịch trực, chấm công, bảng lương — `src/lib/hr.functions.ts`, `src/routes/roster.tsx`, `src/routes/payroll.tsx`
- **Lịch trực** (`/roster`): xem Tuần (7 ngày từ hôm nay) / Tháng (lịch 7 cột) / danh sách ngày trên điện thoại. **Chỉ hiện chi nhánh người xem được gán** (admin thấy hết) — lọc ở server trong `getRosterMonthFn` (cần `actorId`). Sửa lịch: quyền `manage_roster` + chi nhánh được gán.
- **Chấm công**: mã `X` (cả ngày) / `N` (nửa) / `L` (nghỉ có lương) / `K` (nghỉ không lương); công = X + N/2 + L. Ghi chú từng ngày (chuột phải / ✎). `setAttendanceFn` chỉ ghi `note` khi client gửi key `note` (đổi mã không xoá ghi chú).
  - **Mọi nhân viên (trừ admin) tự chấm được NGÀY HÔM NAY** ở trang Tổng quan (`MyAttendanceCard`, `getMyAttendance` / `setMyAttendance` — server tự lấy ngày VN). Ngày quản lý đã chấm → nhân viên chỉ thêm ghi chú. Tháng đã chốt lương → khoá. Quyền `self_attendance` không còn dùng (giữ trong type cho dữ liệu cũ).
- **Bảng lương** (quyền `manage_payroll`): người quản lý lương thấy **bản thân + những người admin phân ở tab "Phân việc"**; admin thấy hết. Chốt / mở / chi lương theo từng người; chi lương tạo phiếu "Chi Lương" trong Sổ quỹ (không trùng). Bộ lọc admin (chi nhánh, chức vụ, quản lý, tình trạng chấm công, trạng thái lương…) — mọi tổng và thao tác áp dụng cho các hàng đang lọc.
- **Công thức lương** (khớp file Excel "BẢNG LƯƠNG KT HCM"): Lương TN = ROUND(LCB / công chuẩn × công); Tăng ca = ROUND(LCB / công chuẩn / 8 × (giờ×1,5 + giờ×2)); Tổng = Lương TN + DS kỹ thuật + DS bán hàng + DS kinh doanh + tăng ca + xăng xe + thưởng + phụ cấp; Khấu trừ = tạm ứng + BHXH + công đoàn + trừ khác; Thực lĩnh = Tổng − Khấu trừ. Tháng chưa có ngày công → không trừ BHXH / công đoàn.
  - **Tạm ứng** chỉ tính phiếu loại "Chi tạm ứng lương" (loại "Tạm ứng" là tạm ứng công tác, KHÔNG trừ lương).
  - **DS kỹ thuật**: `computeTechPay` (`schedule.functions.ts`), chỉ lịch `done`, theo ô tick "tính DS kỹ thuật" trong hồ sơ lương.
  - **DS bán hàng / kinh doanh** (doanh thu = **tiền thực thu trong tháng** theo người bán, `src/lib/sales-collections.ts`: thu tại đơn → người bán đơn; khách trả nợ → FIFO vào đơn còn nợ cũ nhất; hoàn tiền trả hàng → trừ; phần không gán được báo riêng cho admin):
    - QLBH: `SUM × hệ số%` (SUM = thực thu bản thân + mọi người được phân; hệ số mặc định 0,5%).
    - NVBH: `x / SUM × 1% × max(0, SUM − KPI)` theo QLBH đang quản lý mình (KPI theo tháng, tháng chưa đặt dùng KPI tháng trước; chưa có KPI → 0; bị 2 QLBH cùng tick → cảnh báo, tính theo 1 người).
    - Kinh doanh: `1% × thực thu bản thân`.
    - Ghi đè DS: **chỉ admin** (server chặn).
  - "Lương của tôi" ở Tổng quan (`MySalaryCard`, mọi nhân viên trừ admin): QLBH / NVBH **không thấy DS bán hàng của tháng chưa kết thúc** (server ẩn và trừ khỏi thực lĩnh).
- **Xuất Excel bảng lương** (`src/lib/export-hr.ts`): workbook nối công thức như file gốc (BẢNG CHẤM CÔNG với COUNTIF + comment ghi chú, DOANH THU KỸ THUẬT, TỔNG LƯƠNG theo khoá cột `TL_COLS`, PHIẾU LƯƠNG). Đã kiểm bằng HyperFormula: 0 ô lệch.

### 4.7 Nhân viên — `src/routes/employees.tsx`, `src/lib/auth.functions.ts`
- Chức vụ quản lý được (thêm / đổi tên / xoá), lọc theo chức vụ, cấp quyền + chi nhánh hàng loạt.

### 4.8 Khác
- Trang Admin: mẫu in (hoá đơn, phiếu nhập / chuyển kho) + mẫu email (thông báo, bảo dưỡng, sinh nhật).
- Báo cáo (`/reports`, chỉ admin) có 2 tab: **Báo cáo ngày** (mặc định) và **Doanh thu theo kỳ** (`?tab=period`, trang cũ). `src/lib/reports.functions.ts` (`fetchAllPaged` dùng chung để đọc > 1000 dòng).
- **Báo cáo ngày** — `src/lib/daily-report.functions.ts` (`getDailyReportFn`, `buildDailyReport` tách thân để test), `src/components/DailyReport.tsx`. Mọi chỉ số của 1 ngày (giờ VN), lọc theo chi nhánh. Cách tính cố ý GIỮ ĐÚNG như trang gốc để số khớp nhau (đã đối chiếu 3 ngày thật):
  - Doanh thu / đơn bán hàng = đơn `completed` theo `completed_at` (thiếu → `created_at`) − phiếu `returned` tạo trong ngày (= `getReports`).
  - Đơn đặt hàng = đơn đang `reserved` TẠO trong ngày (không có lịch sử trạng thái: đặt hôm nay, hoàn tất hôm sau thì chuyển sang đơn bán của ngày hoàn tất).
  - Quạt / phụ kiện bán ra = số lượng trên đơn hoàn tất; quạt = `count_in_total !== false`, nhóm hàng "DỊCH VỤ" tách riêng, còn lại là phụ kiện.
  - Tiền thu / chi = phiếu `active` trong `cash_vouchers` tạo trong ngày, tách `fund_type` (`tien_mat` / `ngan_hang`); dùng chung `src/lib/cash-math.ts` với Sổ quỹ: lọc chi nhánh → `branchDelta`, không lọc → `systemDelta`. Chuyển quỹ nội bộ vẫn nằm trong tổng nhưng nêu riêng.
  - **Sổ quỹ "Tất cả" (sửa 16/10/2026)**: trước đây cộng mọi phiếu theo loại thu/chi, nên phiếu chuyển tiền giữa hai chi nhánh (Bên A và Bên B đều là chi nhánh: 39 phiếu thu 149.780.000đ + 3 phiếu chi 16.006.685đ ở quỹ tiền mặt) bị tính như tiền vào/ra thật → tồn tiền mặt "Tất cả" 151.872.846đ, trong khi cộng các chi nhánh chỉ 18.099.531đ. Nay "Tất cả" dùng `systemDelta` = tổng tác động lên mọi chi nhánh (chuyển giữa chi nhánh = 0; phiếu không gắn chi nhánh tính theo loại) → luôn bằng tổng các chi nhánh. Hệ quả: Tổng thu / Tổng chi ở "Tất cả" nhỏ hơn tổng thu / chi cộng từng chi nhánh, vì tiền chuyển nội bộ không còn tính là thu / chi của công ty.
  - Khách mới = `customers.created_at` (khách không gắn chi nhánh → lọc chi nhánh vẫn là số toàn hệ thống). Ca bảo hành mới = `warranty_tickets.sent_date`. Lịch = `schedules.scheduled_date`, bỏ lịch đã huỷ.

### 4.9 Bảo hành (khách lẻ · đại lý · nhà máy) — `src/lib/warranty.functions.ts`, `src/lib/warranty-rules.ts`, `src/routes/warranty.tsx`, `src/components/warranty/*` (migration v23)
- Trang `/warranty` (menu "Bảo hành", ai cũng vào được). Tab: **Khách lẻ · Đại lý · Nhà máy · Chờ NM trả hàng · Báo cáo · Cài đặt** (`?tab=…&ticket=<id>`).
- **Quyền** (lọc ở server): phiếu khách lẻ / đại lý — nhân viên CHỈ xem / xử lý phiếu của chi nhánh được gán (`warrantyScope`, `applyScope`, cờ `noBranch`, giống lead); admin thấy hết; xoá phiếu chỉ admin. **Nhà máy + Cài đặt: chỉ admin** (`assertAdmin`).
- **Phiếu** `warranty_tickets` (`kind` = `retail` | `dealer`; đại lý = khách nhóm `dai_ly`), mã `BH-YYYYMMDD-NNN` (lấy số lớn nhất + 1, trùng `code` thì thử lại). Trạng thái `new → processing → waiting_part → done → closed`.
  - **Hạn bảo hành HAI MỨC theo từng mẫu** (thực tế "động cơ 10 năm, phụ kiện 12 tháng"): `products.warranty_motor_months` (động cơ, mặc định 120 — v24) và `products.warranty_months` (phụ kiện, mặc định 12), chụp vào phiếu. Phiếu có `fault_part` (`motor` | `accessory` | null — `WARRANTY_FAULT_PARTS`); form tự gợi ý từ loại lỗi. Còn hạn / hết hạn KHÔNG lưu — `warrantyState()` trong `warranty-rules.ts` so với **ngày gửi bảo hành** (giờ VN): đã chọn bộ phận → tính theo mức đó; chưa chọn → `in` nếu cả hai còn, `out` nếu cả hai hết, còn lại `partial` (nhãn 🟡 "Còn hạn động cơ"). Đổi số tháng ở Cài đặt → phiếu đang mở cập nhật theo, phiếu đã xong giữ nguyên. Đặt qua `setProductWarrantyMonthsFn` (KHÔNG đi qua `upsertProduct`).
  - Ô chọn đại lý (`searchDealersFn`): không gõ → nhóm `dai_ly`; gõ tìm → MỌI khách khớp, nhóm Đại lý lên đầu, kèm nhãn nhóm (281 đại lý cũ đang nằm ở nhóm `le`).
  - **Tự tìm ngày mua**: `lookupPurchaseFn` — đơn `completed` của khách (theo id hoặc SĐT) kèm mẫu đã mua; form tự điền đơn gần nhất, sửa tay được.
  - Quy tắc: `free_support` ép giá linh kiện = 0; `buy_part` bắt buộc giá > 0; "Hoàn tất" bắt buộc có kết quả xử lý. `response_date` tự ghi khi có tư vấn / ghi chú / rời trạng thái "Mới tiếp nhận". **SLA 24h**: quá 24h chưa phản hồi → cờ `overdue`.
  - **Tiền linh kiện chỉ ghi trên phiếu để thống kê** (không tạo phiếu thu). Có thể gắn `part_order_id` = đơn bán linh kiện (`linkTicketOrderFn`; nút mở `/orders?newFor=`).
  - Loại lỗi `issue_type` (`WARRANTY_ISSUE_TYPES`) để thống kê "lỗi phổ biến"; mô tả chi tiết ở `issue_note`. Đính kèm ảnh / video (Cloudinary `/auto/upload`, `uploadFileToCloudinary`) hoặc dán link → `attachments` jsonb `[{url, kind, name}]`.
  - **Tạo phiếu từ đơn hàng**: trang chi tiết đơn có `OrderWarrantyButton` (`ticketPrefillFromOrderFn`) — điền sẵn khách, ghi chú đơn → tình trạng, NV bán → NV tiếp nhận, gắn đơn làm `part_order_id` và lịch của đơn làm `schedule_id`; đơn đã có phiếu thì hiện mã phiếu. Nối với cách làm cũ của showroom (đơn có dịch vụ "Bảo hành VIP" SP000460 + linh kiện + lịch loại `install`). 5 đơn gần nhất đã nhập bằng `scripts/import-warranty-vip-orders.mjs` (`--commit`, chạy lại bỏ qua đơn đã có phiếu) → BH-20261002-001…005, trạng thái "Đang xử lý", **chưa có ngày mua / bộ phận lỗi / kết quả** — nhân viên bổ sung.
  - "Tạo lịch bảo hành" → thêm dòng `schedules` loại `warranty` (cần quyền `create_schedule` / `approve_schedule`), lưu `schedule_id`.
- **Nhà máy** `factory_claims`, mã `NM-YYYYMM-NNN`; danh mục `factories` (kèm `sla_days`, mặc định 14). Đặt `factory_solution` → ghi `solution_at`; "Không BH…" → `rejected`; "Đổi mới…" mà còn `waiting` → `awaiting` (⚠️ Chờ nhà máy trả hàng); quá `sla_days` kể từ `solution_at` → `overdue`. `confirmClaimReturnedFn` = nút "Đã nhận hàng". Từ phiếu khách lẻ / đại lý có nút "Gửi nhà máy" (lưu `ticket_id`).
- **Cảnh báo** ở Tổng quan: `WarrantyAlertCard` (`warrantyAlerts`) — phiếu quá 24h (theo chi nhánh) + hàng nhà máy quá hạn (admin). Chưa chạy v23 → ẩn, không lỗi.
- **Báo cáo**: `warrantyReportFn` (tổng ca, còn / hết hạn, tiền linh kiện, top mẫu, loại lỗi, đại lý, kết quả, hiệu suất kỹ thuật) và `factoryReportFn` (tỷ lệ hướng xử lý, nợ chưa trả, TB ngày trả, mẫu lỗi nhiều). Số liệu "tính ra" (còn hạn, quá hạn) nên server đọc hết theo bộ lọc rồi lọc / phân trang trong bộ nhớ.
- Trang chi tiết khách có mục "Lịch sử bảo hành" (`WarrantyHistory`).
- Hằng số nhãn: `WARRANTY_STAGES`, `WARRANTY_FINAL_ACTIONS`, `WARRANTY_ISSUE_TYPES`, `FACTORY_SOLUTIONS`, `FACTORY_RETURN_STATUSES` trong `types.ts`.

### 4.10 SEO Studio (chỉ admin) — `src/lib/seo-studio/*`, `src/routes/seo-studio/$.ts`, `src/routes/seo.tsx` (migration v25)
- Chuyển từ công cụ Python `mrvu-seo-studio/` (tài liệu `TAI_LIEU_SAN_PHAM.md`): 7 tab Volume · Rank · Audit · Autopost · AI Overview (GEO) · Backlink · Search Console + GA4, cùng chi phí / ngân sách. **Giữ nguyên hợp đồng API** của bản Python nên 7 trang HTML gốc chạy gần như nguyên vẹn: bản chép đã chỉnh nằm ở `src/lib/seo-studio/pages/` (sửa ở đây, KHÔNG sửa `mrvu-seo-studio/`), nạp bằng `?raw`.
- **Đường đi**: menu "SEO Studio" (`/seo`, `permission: "admin"`) = khung iframe tới `/seo-studio/` (`?p=` mở đúng tab). `/seo-studio/*` là HTTP route thật → `dispatch()` trong `app.ts`: bỏ tiền tố → `/cron` (secret) → `/auth/*` → `auth.guard` → chia cho module như `do_GET/POST/DELETE` của `app.py`. Mỗi module có `handle(h, method, path)`, `h.query / h.read_json() / h.send_json()`.
- **Bảo vệ**: cửa thật là **đăng nhập Google** (`auth.ts`, OIDC, cookie `mvs_session` Path=/seo-studio, bảng `seo_auth_sessions` chỉ lưu sha256; mỗi request kiểm lại email còn trong `SEO_ALLOWED_EMAILS`). Chưa cấu hình Google → chặn hết (trừ `SEO_DEV_NO_AUTH=1` trên localhost). Trang đăng nhập nằm trong iframe sẽ mở Google ở cửa sổ chính rồi quay về `/seo?p=…`.
- **CSDL**: `core.ts` dùng `postgres` (Supabase pooler, `prepare:false`); SQL giữ gần nguyên bản (`?` → `$n`, mảng → danh sách cho `IN (?)`). Tham số jsonb phải viết `?::text::jsonb` (viết `?::jsonb` thì postgres.js mã hoá JSON hai lần). Tên cột `"fetch"` (từ khoá Postgres) phải để trong ngoặc kép. `config.json` cũ → dòng `seo_config` key `config` (jsonb).
- **Khoá API chỉ lấy từ env** (`loadConfig`); giao diện không lưu khoá. Mật khẩu WordPress / token Custom API và file khoá Google tải lên được **mã hoá AES-GCM** bằng `SEO_SECRET_KEY`.
- **Tác vụ dài trên Vercel** (`jobs.ts`): thay luồng nền bằng bảng `seo_jobs`; mỗi lần trang hỏi `…/job/<id>` server chạy MỘT bước (~40 giây với vòng lặp, khoá `locked_until` chống chạy trùng). Đóng trang thì tác vụ dừng, mở lại chạy tiếp. Các bước: crawl Audit (init → sitemaps → crawl → save), viết bài (plan → article → publish), GEO (serp → page → comps → ai → save), Backlink (4 lệnh gọi; gap theo nhóm 4 đối thủ), Search Console sync (mỗi truy vấn một bước, ghi `seo_gsc_stage`, bước `commit` thay dữ liệu trong 1 giao dịch), kiểm index (theo thời gian).
- `vite.config.ts`: `nitro({ vercel: { functionRules: { "/seo-studio/**": { maxDuration: SEO_MAX_DURATION || 300 } } } })` → Vercel tạo hàm riêng `seo-studio/[...].func` (đã kiểm bằng `NITRO_PRESET=vercel`). Cần **Fluid Compute** (mặc định dự án mới) cho 300 giây ở gói Hobby; tắt thì đặt `SEO_MAX_DURATION=60`. Thêm alias `fs → node:fs` vì dự án có gói npm giả tên `fs` làm hỏng `postgres`.
- **Lịch tự đăng bài**: pg_cron gọi `POST /seo-studio/cron` (header `x-job-secret` = `SEO_JOB_SECRET`) mỗi phút → `autopost.schedulerTick()` chạy MỘT bước: ưu tiên tác vụ tự động dở dang, không thì chọn website đến lượt (khung giờ VN, số bài/ngày, giãn cách ≥ 20 phút). **Giới hạn admin** (Cài đặt chi phí): `autopost_daily_max` (tổng bài lịch/ngày, mặc định 10), `crawl_max_pages` (mặc định 2000, tối thiểu 10), tự dừng khi vượt ngân sách. Từ khoá kẹt "Đang viết" > 30 phút tự chuyển lỗi.
- **Claude**: `apis.ts` dùng `@anthropic-ai/sdk`, luôn streaming, mô hình `claude-sonnet-5-5` (env `SEO_ANTHROPIC_MODEL`), thử refusal fallback (`server-side-fallback-2026-07-01`) và tự bỏ nếu bị từ chối; ghi chi phí theo token thật vào `seo_spend`.
- Thư viện ảnh Autopost: Supabase Storage bucket `seo-images` + bảng `seo_ap_library` (tải lên / xoá trong tab Cài đặt AI & biến, tối đa 3,5 MB/ảnh).
- Khác bản Python có chủ đích: crawl tôn trọng `Disallow` của robots.txt; nhập CSV backlink báo đúng khi lỡ chọn file "Trang được liên kết hàng đầu"; khoá service account từ env `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON hoặc base64) hoặc tải lên (mã hoá).

### 4.11 Cập nhật 19/10/2026 (superupdate.docx + Gợi ý chủ đề)
- **Bảo hành**: kết quả cuối thêm "Khách không đồng ý thay / sửa chữa" (`customer_declined`, cùng nhóm không thu tiền với `free_support` — `WARRANTY_NO_PRICE_ACTIONS`). Quyền mới **`warranty_factory` "Bảo hành nhà máy"**: tạo / xem / cập nhật phiếu nhà máy + tab Nhà máy, Chờ NM trả hàng, nút "Gửi nhà máy" (`canFactory` / `assertFactory`). Xoá phiếu NM, danh mục nhà máy, cài đặt, báo cáo NM vẫn chỉ admin. (Lỗi "không chọn được nhà máy" là do tài khoản Hồng Nga không phải admin → danh sách nhà máy trả rỗng; cần admin tick quyền mới cho Nga.)
- **Chăm sóc KH → Sinh nhật**: cột "NV tạo khách" (`customers.created_by_name`, thiếu thì tra `users`).
- **Tổng quan**: `StaffBirthdayCard` (sinh nhật nhân viên hôm nay + trong tháng, `getStaffBirthdaysFn` — lúc viết CHƯA nhân viên nào có ngày sinh nên chỉ admin thấy lời nhắc nhập ở trang Nhân viên); admin: `ActiveSessionsCard` — tài khoản đang online (hoạt động ≤ 5 phút) / mọi phiên, thiết bị (trình duyệt, HĐH, IP), "Đăng xuất thiết bị này".
- **Phiên đăng nhập** (`src/lib/server/sessions.ts`, `team.functions.ts`): `loginFn` ghi `user_sessions` (sha256 token, UA, IP); `AuthContext` gửi nhịp 2 phút / lần + khi quay lại tab (`sessionHeartbeatFn`), phiên cũ tự có bản ghi ở nhịp đầu; admin thu hồi → nhịp kế tiếp trả `revoked` → client đăng xuất. Đây chỉ là theo dõi / thu hồi; xác thực vẫn là `actorId` như cũ (mục 6.6).
- **Báo cáo ngày**: bấm nhóm thu / chi → danh sách phiếu; bấm mã phiếu → `/cash?q=<mã>&fund=…&date=…` (Sổ quỹ nhận `validateSearch` q / fund / date).
- **Doanh thu theo kỳ → Báo cáo hàng bán** (`SalesQtyReport`): số lượng thuần theo Tuần / Tháng / Quý / Năm trong khoảng đang chọn + theo mặt hàng, CSV; thêm preset "Tháng này", "Quý này". "Phụ kiện & dịch vụ" = hàng `count_in_total = false` (gồm Công lắp đặt, Phụ thu, Bảo hành VIP).
- **Lịch làm việc**: cột "Hàng hóa" (Danh sách), dòng 📦 (Thời khóa biểu), thẻ điện thoại và nội dung Copy đều có hàng — `getScheduleProducts` (dòng hàng của đơn gắn lịch, hoặc mẫu quạt của phiếu bảo hành có `schedule_id`; tải riêng ~2,5 giây, ~100 KB).
- **SEO Studio — Gợi ý chủ đề** (`topics.ts`, từ `topics.py` trong `mrvu-seo-studio.zip` 19/10): API `/api/tp/*` (analyze / job / runs / run / add / fit). Tác vụ nhiều bước: website mình (dữ liệu Audit, không có thì quét bằng `crawlStep` tách ra từ `audit.ts` rồi lưu lại) → từng đối thủ → DataForSEO Labs (đầy đủ) → Claude → chấm điểm (khớp Python) → lưu `seo_tp_runs`, tự thêm hàng chờ kèm `brief_json`. `autopost.ts` đưa brief vào prompt dàn ý + bài (`briefText`). Chi phí: `dfs_labs_task/item`, `tp_recent_days`, nhóm "Gợi ý chủ đề". Trang `autopost.html` / `costguard.js` mới đã gộp 3 chiều (git merge-file) với bản chỉnh POS.
- Mật khẩu website Autopost không giải mã được (đổi `SEO_SECRET_KEY`) → không còn làm hỏng danh sách, hiện "cần nhập lại".

---

### 4.13 SEO Studio — Bản đồ website + Câu hỏi AI (30/10/2026) — `src/lib/seo-studio/smap.ts`, `aiq.ts` (migration v27)
- Nguồn: `mrvu-seo-studio-new/mrvu-seo-studio/` (`smap.py`, `aiq.py`, `CAP_NHAT_2026-10-30_BAN_DO_WEBSITE.md` ở thư mục gốc). So với bản 19/10 (`mrvu-seo-studio.zip` trong git): thêm 2 module này; `audit.py`/`geo.py` cho dùng lại trang đã tải; `geo.fetch_serp` thêm độ sâu PAA; `costs.py` thêm giá/ước tính/`module_as`; 8 trang thêm 2 tab menu (gộp 3 chiều vào `pages/`, không xung đột). `autopost.py`, `gsc.py` không đổi.
- **Câu hỏi AI** (`/api/aiq/*`, `pages/aiq.html`): dự án (tên miền, thương hiệu, lĩnh vực, đối thủ) → tìm câu hỏi (GSC + People Also Ask + Labs + LLM Mentions + Claude) → kiểm tra ChatGPT/Gemini (LLM Scraper), Perplexity (LLM Responses), Google AI Overview (SERP) có nhắc / trích website → tư vấn từng câu (đoạn trả lời, FAQ + JSON-LD) → kế hoạch 90 ngày, kiểm tra kỹ thuật (robots.txt cho bot AI, llms.txt, schema trang chủ), gửi sang Autopost.
- **Bản đồ website** (`/api/smap/*`, `pages/smap.html`): mỗi chu kỳ là tác vụ `smap_cycle` nhiều bước `init → crawl → fetch → extra → gsync → ranks → write → ai → score → psi → inspect → links → report`; trang đọc được lưu tạm ở `seo_smap_stage` (không nhét vào `seo_jobs.state`), xóa ở bước `write`. Dùng lại `crawlStep` (Audit), `syncStep`/`inspectStep` (gsc.ts, tách ra từ registerStep), `auditPage(…, res)`, `readPage(…, res)`, `rankedKeywords` (topics.ts). Kết quả chấm điểm cũng ghi vào `seo_audit_*` như bản gốc. Số trang bị giới hạn thêm bởi `crawl_max_pages`.
- **Chi phí theo thao tác**: `costs.moduleAs(action, fn)` (AsyncLocalStorage, thay `threading.local`) — mọi lệnh DataForSEO/Claude trong khối ghi vào module đó; đường dẫn `/ai_optimization/` mặc định là "Câu hỏi AI".
- **Lịch định kỳ**: `/seo-studio/cron` → nếu Autopost không chạy gì (`skipped`) thì `periodicTick()` (app.ts): chạy tiếp một bước của tác vụ tự động `aiq_check`/`smap_cycle` đang dở; phút %15 == 7 thì xem dự án/website đến hạn (`auto_check`/`auto` + `auto_days`, không vượt ngân sách) để bắt đầu. "Đang chạy" = tác vụ running cập nhật ≤ 10 phút.
- **Khóa PageSpeed**: env `GOOGLE_PSI_API_KEY`, hoặc nhập ở Bản đồ website → Cài đặt (lưu **mã hóa** `seo_config.psi_api_key_enc`, bản gốc lưu thô `psi_api_key`). Không có khóa vẫn đo được nhưng chậm, dễ bị 429.
- Khác bản gốc có chủ đích: PageSpeed chờ tối đa 60 giây/lần (bản gốc 120) để bước không vượt giới hạn Vercel; kế hoạch GEO không lỗi khi chưa có lần kiểm tra nào (bản gốc lỗi `NoneType`).
- Đã kiểm (30/10/2026, Postgres 18 cục bộ + fetch giả lập website/DataForSEO/PageSpeed/Claude SSE; tất cả mục kiểm đạt): toàn bộ API 2 tab, 2 chu kỳ liên tiếp (biến động, link đã chèn tự "Đã làm", từ khóa đã chốt giữ nguyên, chỉ gán AI cho trang mới), cron chạy hết chu kỳ tự động, chi phí ghi đúng module, ước tính chi phí. **Chưa gọi API thật và chưa mở giao diện trên trình duyệt.**

### 4.12 MR.VŨ COFFEE POS ở `/cafe` — `mrvu-coffee-pos/`, `src/routes/cafe.ts`, `scripts/build-cafe.mjs` (28/10/2026)
- **Ứng dụng RIÊNG**, chỉ chung domain: Supabase project riêng (đăng nhập, database, RLS, Storage, Edge Function `create-staff`), không đụng bảng / user / quyền của web chính. Đọc `mrvu-coffee-pos/README.md` + `docs/` để biết nghiệp vụ và cách cài Supabase cho POS.
- POS là SPA Vite (React 18, Tailwind 3, HashRouter → màn hình nằm sau `#`, vd `/cafe#/pos`). `npm run build` chạy `scripts/build-cafe.mjs` trước: `npm ci` trong `mrvu-coffee-pos/` (khi cần), `tsc -b`, rồi `vite build --base /cafe/` ra `public/cafe/` (gitignore, không commit). Build riêng: `npm run build:cafe`.
- `src/routes/cafe.ts` trả `public/cafe/index.html` cho `/cafe` và `/cafe/` (nhúng lúc build, `no-cache`, `noindex`); assets `/cafe/assets/*` phục vụ tĩnh. Ở `npm run dev` Vite tự phục vụ `public/cafe/` → phải build POS ít nhất 1 lần.
- Biến env của POS là **`VITE_CAFE_SUPABASE_URL` / `VITE_CAFE_SUPABASE_ANON_KEY`** (đã đổi tên từ `VITE_SUPABASE_*` để không dùng nhầm Supabase của web chính). Script gỡ mọi `VITE_*` khác khỏi môi trường build POS. Thiếu biến thì vẫn build được, `/cafe` hiện "Chưa cấu hình Supabase".
- Sửa POS: làm trong `mrvu-coffee-pos/` theo quy ước của nó (`npm run verify` trong thư mục đó). eslint / prettier của web chính bỏ qua thư mục này.

## 5. Cách kiểm thử đã dùng (không có test tự động)

- **Gọi hàm server ngoài runtime**: handler `createServerFn` không gọi được trực tiếp (thiếu Start context). Cách làm: tạo file tạm `src/lib/.xxtest.ts` = nội dung file gốc + `export { hamNoiBo as __x }` (hoặc thay `createServerFn(...).handler(` bằng `(`), nạp bằng `vite.createServer({ configFile:false, resolve:{alias:{"@":"src"}}, server:{middlewareMode:true}, appType:"custom" })` + `ssrLoadModule`, đọc `.env` vào `process.env`. Nhớ xoá file tạm.
- **Bắt lỗi "quên import" trong file `@ts-nocheck`**: chép file thành `*.zzchk.ts(x)` bỏ dòng `// @ts-nocheck`, chạy `tsc`, lọc `zzchk` + `TS2304|TS2552|TS2305|TS2307` (tên chưa khai báo / import sai), rồi xoá bản chép. Đã từng bắt được 1 lỗi thật (thiếu import trong `care.functions.ts`).
- **Xem giao diện thật không cần mật khẩu**: chạy `npx vite dev --port 4180`, mở Chrome headless (`--remote-debugging-port`) và điều khiển qua CDP bằng `WebSocket` có sẵn của Node 22; đặt phiên vào `localStorage["qt_session"] = { session: { user, token }, saved_at }` bằng `Page.addScriptToEvaluateOnNewDocument` rồi `Page.captureScreenshot`. Trong Git Bash phải đặt `MSYS_NO_PATHCONV=1` khi truyền tham số dạng `/reports` (nếu không bị đổi thành đường dẫn Windows). Lỗi "Hydration failed" hiện ở MỌI trang (server không có phiên, client có) — có sẵn, React tự dựng lại.
- Các hàm tự chấm công đã được tách thân (`getMyAttendance`, `setMyAttendance`) để test được.
- Dữ liệu thật: nếu phải ghi thử, **chụp lại trạng thái trước và khôi phục** (bản ghi, quyền, activity_logs).
- **SEO Studio** (15/10/2026): Postgres 18 có sẵn trên máy (`C:/Program Files/PostgreSQL/18/bin`) → `initdb` cụm tạm ở cổng 55432 (tạo role `anon`, `authenticated` + bảng `storage.buckets` giả để chạy v25 nguyên văn), website / WordPress / Custom API / Google token / Claude (SSE, qua `ANTHROPIC_BASE_URL`) giả lập bằng `http.createServer`, gọi thẳng `dispatch(new Request(...))`. 113 mục đạt, gồm so khớp với bản Python (`py -3.11`, đặt `PYTHONIOENCODING=utf-8`): crawl, điểm + từng tiêu chí Audit, 5 loại cơ hội + tổng quan Search Console, đọc trang + kiểm cấu trúc GEO. **Chưa gọi API trả phí thật** (chưa có khoá).
- Excel: xuất file trong script (giả lập `document` / `URL.createObjectURL`), đọc lại bằng exceljs + HyperFormula để so từng công thức với số app tính.

---

## 6. Việc còn dở / ý tưởng đã bàn

1. **Messenger hàng loạt**: chủ dự án muốn gửi Messenger cho khách. Đã tư vấn **KHÔNG dùng Bombot** (tự quảng cáo lách phát hiện của Facebook → rủi ro khoá fanpage, không có API). Hướng chính thức: **Marketing Message API for Messenger** (Meta, hỗ trợ Việt Nam; opt-in qua quảng cáo Click-to-Messenger / tải danh sách CRM bằng SĐT-email / lời mời khi đang chat; trả tiền theo tin đã giao qua tài khoản quảng cáo; 1 tin marketing / khách / ngày; cần Meta App Review `ads_management`, `pages_messaging`, `paid_marketing_messages`). Đã chốt: **tự tích hợp**, gửi cho khách đã mua + lead + người đã inbox page, **nhân viên soạn – admin duyệt**. Mr.Vũ đã có Business Manager xác minh + nhiều fanpage, **chưa có tài khoản quảng cáo gắn thẻ**. Kế hoạch chi tiết CHƯA viết xong (bị dừng) — tái dùng mẫu Zalo (`src/lib/zalo/*`: token mã hoá, hàng đợi, drain, webhook).
2. Lỗi `upsertProduct` xoá mô tả khi sửa (mục 4.5) — chờ đồng ý sửa.
3. Hàng ẩn vẫn chọn được khi tạo đơn — có thể chặn nếu chủ dự án muốn.
4. Hồ sơ lương có ô "Chức vụ / bộ phận" gõ tay riêng, chưa liên kết với `users.position_id`.
5. Tạo tài khoản cho "Ani", "My" rồi gắn lại lead cũ nếu muốn.
6. Bảo mật: session phía server thay cho `actorId` (ưu tiên trước cho dữ liệu lương).
7b. **Bản đồ website + Câu hỏi AI (4.13)** — chủ dự án cần: chạy v27; (tùy chọn) đặt `GOOGLE_PSI_API_KEY` hoặc nhập khóa ở tab; thử lần đầu với website nhỏ / số trang tối đa thấp và đọc phần Ghi chú trong Tổng quan.
7. **SEO Studio (4.10)** — chủ dự án cần: chạy v25; đặt biến env (mẫu ở `.env.example`); tạo OAuth client Google (redirect `https://<miền>/seo-studio/auth/callback`); kiểm Fluid Compute đang bật; deploy rồi chạy phần pg_cron cuối v25. Sau đó thử với lượng nhỏ (3 từ volume, 2 từ rank, 1 GEO, 1 bài nháp). Thư mục `mrvu-seo-studio/` chỉ còn là bản tham khảo (không được build).
8. **Bảo hành (4.9)** — còn lại:
   - Đã kiểm trên dữ liệu thật 02/10/2026 (50 mục, dữ liệu thử đã xoá): mã phiếu / mã yêu cầu tăng và không trùng khi tạo song song, hạn BH theo mẫu, quy tắc tiền linh kiện, SLA 24h, phân quyền theo chi nhánh, đại lý, gắn đơn, tạo lịch, nhà máy, báo cáo. **Chưa mở giao diện trên trình duyệt.**
   - **Chủ dự án chạy `sql_migration_v24_warranty_two_tier.sql`**, rồi kiểm phần ghi của hai mức (lưu `fault_part`, đặt hạn động cơ ở Cài đặt). Trước v24 đã kiểm: quy tắc hai mức, ô chọn đại lý, điền sẵn từ đơn, và việc lưu phiếu không hỏng khi thiếu cột.
   - Zalo cho bảo hành: **chủ dự án chọn CHƯA làm**. OA có 3 mẫu ZNS bật (mua hàng 622226, sinh nhật 642321, "Thông báo nhắc đến lịch hẹn" 642205); mẫu 642205 lời văn cố định là nhắc **bảo trì định kỳ** (CSKH → Bảo dưỡng) nên không dùng cho phiếu bảo hành. Khi cần: đăng ký mẫu mới, thêm loại vào `TEMPLATE_KINDS` (`src/routes/zalo/index.tsx`) + hàm enqueue kiểu `enqueue-care.ts`.
   - 281 khách tên có "Đại lý / ĐL" vẫn ở nhóm `le` (chưa chuyển nhóm — chỉ nới ô chọn). Các mã cũ "HÀNG TẠM ỨNG BẢO HÀNH" / "HÀNG TRẢ BẢO HÀNH" (chủ yếu đơn 2024 đã huỷ) không nhập lại.
   - Thử tải video lên Cloudinary (preset unsigned có thể chỉ nhận ảnh) — nếu không được thì dùng dán link.
   - Chưa có tự gửi email / thông báo nhắc quá hạn (dự án chưa có tác vụ định kỳ) — mới có khung cảnh báo ở Tổng quan.
   - Đại lý chưa tự đăng nhập tạo phiếu (nhân viên tạo thay). Danh mục nhà máy admin tự nhập ở tab Cài đặt.

---

## 7. Mẹo làm việc với repo này

- Sửa file lớn: ưu tiên công cụ Edit, hoặc script node đọc → `replace` chuỗi chính xác → ghi. Heredoc bash có template literal chứa `\` / backtick hay bị hỏng — viết script ra file trong thư mục tạm rồi chạy.
- Sau mỗi thay đổi: đếm lỗi `tsc` (so baseline mục 2.10) + `npm run build`.
- Chủ dự án giao tiếp tiếng Việt, thích câu hỏi làm rõ có phương án đề xuất; tự commit / push. Báo cáo kết quả trung thực (đã kiểm gì, chưa kiểm gì).
