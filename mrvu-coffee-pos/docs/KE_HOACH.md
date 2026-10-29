# MR.VŨ COFFEE POS: Kế hoạch thực hiện (Giai đoạn 1)

Ngày lập: 28/10/2026

## 1. Kết quả khảo sát

| Hạng mục | Hiện trạng |
|---|---|
| Thư mục làm việc | `/home/claude`, trống, chưa có repository hay `package.json` |
| Git | Chưa khởi tạo |
| Node / npm | v22.23.4 / 10.9.9 |
| Python | 3.13 (chỉ dùng cho công cụ phụ trợ) |
| Supabase | Chưa có URL, anon key hay tệp `.env` |
| Máy in thật | Chưa biết model, chưa thể kiểm tra phần cứng |
| Tài liệu Project `TAI_LIEU_SAN_PHAM.md` | Mô tả sản phẩm khác (Mr.Vũ SEO Studio), không liên quan POS, không dùng làm căn cứ |

Kết luận: dự án mới hoàn toàn, dùng kiến trúc đề xuất trong đặc tả.

## 2. Kiến trúc đề xuất

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, TanStack Query, React Router, Zustand cho giỏ hàng cục bộ, Recharts, Zod kiểm tra dữ liệu.
- **Backend:** Supabase (PostgreSQL, Auth, RLS, Storage cho ảnh món và chứng từ).
- **Nghiệp vụ quan trọng nằm trong RPC PostgreSQL (SECURITY DEFINER, có kiểm tra quyền):**
  `rpc_pay_order` (thanh toán, idempotency key, trừ kho, tạo receipt, ghi audit trong một transaction), `rpc_cancel_order`, `rpc_refund_order`, `rpc_move_table`, `rpc_merge_tables`, `rpc_split_order`, `rpc_open_shift`, `rpc_close_shift`, `rpc_adjust_stock`.
- **Nền tảng:** web app chạy trên Chrome/Edge (Windows). Không dùng Electron. In bill đi qua `PrintService` với adapter QZ Tray và adapter giả lập (Giai đoạn 3).
- **Không có service role key ở frontend.** Chỉ dùng anon key. Việc tạo tài khoản nhân viên đi qua Supabase Edge Function (chạy phía máy chủ, kiểm tra người gọi là Owner).

## 3. Phương án in bill (chọn: web + QZ Tray)

Trình duyệt không tự gửi được lệnh in im lặng tới máy in bill, nên dùng **QZ Tray** (ứng dụng nhỏ cài trên máy thu ngân) làm cầu nối, đặt sau giao diện `PrintService`.

| Adapter | Cách hoạt động | Ghi chú |
|---|---|---|
| `QzTrayAdapter` | Kết nối WebSocket tới QZ Tray, in qua driver Windows hoặc ESC/POS | Cần cài QZ Tray và chứng chỉ ký; chưa kiểm chứng trên máy in thật |
| `SimulatorAdapter` | Không in thật, tạo bản xem trước và job giả lập | Dùng để phát triển và kiểm thử |

`PrintService`: `getConnectionStatus`, `listPrinters`, `getPrinterStatus`, `testPrint`, `printReceipt`, `printKitchenTicket`, `getPrintJobStatus`, `retryPrint`. Mỗi lần in tạo một dòng `receipt_print_jobs` (queued, processing, submitted, success, failed, retry_pending, unknown). Hóa đơn được lưu trong DB trước khi in; in lỗi hoặc không rõ kết quả chỉ để lại job để xử lý, không tạo giao dịch mới và không in trùng. Bản in lại ghi "BẢN SAO".

Sẽ không tuyên bố hỗ trợ model nào cho đến khi thử trên máy in thật.

## 4. Mặc định đã chọn cho các điểm còn thiếu

- Một cửa hàng ở bản đầu, nhưng mọi bảng đều có `store_id` để mở rộng chi nhánh.
- Tiền lưu dạng `numeric(14,0)` (VND không có số lẻ).
- Mã đơn dạng `YYMMDD-0001`, sinh trong DB, duy nhất theo cửa hàng và ngày.
- Chống thanh toán trùng bằng `idempotency_key` UNIQUE trên `payments`/`receipts`.
- Vai trò: owner, manager, cashier, staff, quyền chi tiết trong bảng `role_permissions`, RLS kiểm tra qua hàm `has_permission()`.
- Chế độ offline: không có. Mất mạng thì POS báo rõ, giữ giỏ hàng trong bộ nhớ cục bộ (chưa lưu đơn) và cho thử lại. Chưa làm đồng bộ offline đầy đủ.
- Dữ liệu mẫu nằm riêng ở `supabase/seed.dev.sql`, không chạy trên production.

## 5. Cấu trúc thư mục dự kiến

```
mrvu-coffee-pos/
├─ docs/                  KE_HOACH.md, HUONG_DAN_CAI_DAT.md, BACKUP.md
├─ supabase/
│  ├─ migrations/         0001_core.sql, 0002_rls.sql, 0003_rpc_*.sql ...
│  ├─ functions/          create-staff (Edge Function)
│  └─ seed.dev.sql
├─ src/
│  ├─ app/                router, layout, providers
│  ├─ components/ui/      Button, Modal, Table, Card...
│  ├─ features/           pos, tables, orders, menu, inventory, customers, staff, reports, printer, settings
│  ├─ services/           PrintService, supabase client
│  └─ lib/                format tiền/ngày, zod schemas
└─ tests/                 unit (Vitest), integration (SQL/RPC), e2e (Playwright)
```

## 6. Các giai đoạn

| GĐ | Nội dung | Kiểm chứng |
|---|---|---|
| 1 | Nền tảng: Vite, Tailwind, đăng nhập, phân quyền, schema, migration, RLS (xong) | typecheck, lint, build, test RLS |
| 2 | Thực đơn, POS, bàn, đơn hàng, thanh toán (RPC), lịch sử hóa đơn (xong, chờ thử trên Supabase thật) | test RPC thanh toán, bấm trùng, hoàn tiền; smoke giao diện |
| 3 | PrintService (QZ Tray + giả lập), cài đặt máy in, xem trước, in lại | test bố cục bill; in thật chờ thiết bị |
| 4 | Kho và nhập hàng | đối chiếu tồn kho với phiếu |
| 5 | Nhân viên, ca, thu chi | đối chiếu quỹ với hóa đơn |
| 6 | Khách hàng và báo cáo, xuất CSV | đối chiếu báo cáo với hóa đơn |
| 7 | Kiểm thử tổng, triển khai, backup | báo cáo kiểm thử, nghiệm thu |

Cuối mỗi giai đoạn có báo cáo: chức năng xong, file và migration, lệnh chạy, biến môi trường, kết quả kiểm thử, vấn đề tồn tại.

## 7. Cần từ bạn (không chặn Giai đoạn 2)

1. URL và anon key của dự án Supabase (hoặc xác nhận để mình hướng dẫn tạo). Sẽ đặt trong `.env`, không commit.
2. Model máy in bill, khổ giấy 58 hay 80 mm, kết nối USB hay LAN (cần cho Giai đoạn 4).
3. File logo MR.VŨ COFFEE (SVG hoặc PNG nền trong), nếu có.
4. Thông tin cửa hàng in trên bill: tên, địa chỉ, số điện thoại, chân bill.
