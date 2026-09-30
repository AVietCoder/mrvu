# PROGRESS — Mr.Vũ POS (www.ttv.vn)

> Tài liệu bàn giao cho kỹ sư / AI tiếp theo. Cập nhật lần cuối: **30/09/2026**.
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

## 3. Trạng thái migration (đã kiểm 30/09/2026: TẤT CẢ ĐÃ CHẠY tới v22)

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

Migration tiếp theo đặt tên **v23**.

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
- Báo cáo: `src/lib/reports.functions.ts` (`fetchAllPaged` dùng chung để đọc > 1000 dòng).

---

## 5. Cách kiểm thử đã dùng (không có test tự động)

- **Gọi hàm server ngoài runtime**: handler `createServerFn` không gọi được trực tiếp (thiếu Start context). Cách làm: tạo file tạm `src/lib/.xxtest.ts` = nội dung file gốc + `export { hamNoiBo as __x }` (hoặc thay `createServerFn(...).handler(` bằng `(`), nạp bằng `vite.createServer({ configFile:false, resolve:{alias:{"@":"src"}}, server:{middlewareMode:true}, appType:"custom" })` + `ssrLoadModule`, đọc `.env` vào `process.env`. Nhớ xoá file tạm.
- Các hàm tự chấm công đã được tách thân (`getMyAttendance`, `setMyAttendance`) để test được.
- Dữ liệu thật: nếu phải ghi thử, **chụp lại trạng thái trước và khôi phục** (bản ghi, quyền, activity_logs).
- Excel: xuất file trong script (giả lập `document` / `URL.createObjectURL`), đọc lại bằng exceljs + HyperFormula để so từng công thức với số app tính.

---

## 6. Việc còn dở / ý tưởng đã bàn

1. **Messenger hàng loạt**: chủ dự án muốn gửi Messenger cho khách. Đã tư vấn **KHÔNG dùng Bombot** (tự quảng cáo lách phát hiện của Facebook → rủi ro khoá fanpage, không có API). Hướng chính thức: **Marketing Message API for Messenger** (Meta, hỗ trợ Việt Nam; opt-in qua quảng cáo Click-to-Messenger / tải danh sách CRM bằng SĐT-email / lời mời khi đang chat; trả tiền theo tin đã giao qua tài khoản quảng cáo; 1 tin marketing / khách / ngày; cần Meta App Review `ads_management`, `pages_messaging`, `paid_marketing_messages`). Đã chốt: **tự tích hợp**, gửi cho khách đã mua + lead + người đã inbox page, **nhân viên soạn – admin duyệt**. Mr.Vũ đã có Business Manager xác minh + nhiều fanpage, **chưa có tài khoản quảng cáo gắn thẻ**. Kế hoạch chi tiết CHƯA viết xong (bị dừng) — tái dùng mẫu Zalo (`src/lib/zalo/*`: token mã hoá, hàng đợi, drain, webhook).
2. Lỗi `upsertProduct` xoá mô tả khi sửa (mục 4.5) — chờ đồng ý sửa.
3. Hàng ẩn vẫn chọn được khi tạo đơn — có thể chặn nếu chủ dự án muốn.
4. Hồ sơ lương có ô "Chức vụ / bộ phận" gõ tay riêng, chưa liên kết với `users.position_id`.
5. Tạo tài khoản cho "Ani", "My" rồi gắn lại lead cũ nếu muốn.
6. Bảo mật: session phía server thay cho `actorId` (ưu tiên trước cho dữ liệu lương).

---

## 7. Mẹo làm việc với repo này

- Sửa file lớn: ưu tiên công cụ Edit, hoặc script node đọc → `replace` chuỗi chính xác → ghi. Heredoc bash có template literal chứa `\` / backtick hay bị hỏng — viết script ra file trong thư mục tạm rồi chạy.
- Sau mỗi thay đổi: đếm lỗi `tsc` (so baseline mục 2.10) + `npm run build`.
- Chủ dự án giao tiếp tiếng Việt, thích câu hỏi làm rõ có phương án đề xuất; tự commit / push. Báo cáo kết quả trung thực (đã kiểm gì, chưa kiểm gì).
