# MR.VŨ COFFEE POS

Phần mềm bán hàng cho quán cà phê: giao diện tiếng Việt, tiền VND, giờ Asia/Ho_Chi_Minh. Ứng dụng web chạy trên Chrome/Edge (Windows), dữ liệu trên Supabase.

**Chạy thử nhanh:** làm theo [docs/HUONG_DAN_CAI_DAT.md](docs/HUONG_DAN_CAI_DAT.md) (khoảng 15 phút: tạo Supabase, chạy một tệp SQL, điền hai biến môi trường, `npm run dev`).

## Chức năng
| Nhóm | Có |
|---|---|
| Bán hàng | POS, tại bàn / mang đi, topping, size, ghi chú, giảm giá, phụ thu, chia nhiều phương thức thanh toán, chống thanh toán trùng |
| Bàn & đơn | Sơ đồ bàn, chuyển bàn, gộp đơn, tách món, lịch sử hóa đơn, hủy, hoàn tiền (một phần/toàn bộ), xuất CSV |
| In | PrintService với QZ Tray và máy in giả lập, bill 58/80 mm, in lại có lý do ("BẢN SAO"), chặn in trùng, trạng thái "không rõ" khi mất phản hồi |
| Kho | Nguyên liệu, công thức món (tự trừ kho khi bán), nhập hàng, hao hụt, kiểm kho, cảnh báo sắp hết |
| Ca & tiền | Mở/đóng ca, đối chiếu tiền mặt, thu chi |
| Khách & báo cáo | Khách hàng, lịch sử mua, báo cáo doanh thu/món/giờ/phương thức/thu ngân, lợi nhuận (chỉ người có quyền xem giá vốn), nhật ký hoạt động |
| Bán mang đi nhanh | Chạm món là thêm ngay (size mặc định), thu tiền mặt một chạm (F3), chuyển khoản (F6), số gọi ngắn `#12`, in bill + phiếu pha chế chạy nền, màn hình pha chế `/pha-che`. Chi tiết: docs/BAN_MANG_DI_NHANH.md |
| Phân quyền | Chủ, quản lý, thu ngân, phục vụ; kiểm soát bằng RLS ở database |

## Lệnh
```
npm run dev        # chạy local
npm run verify     # typecheck + lint + test đơn vị + build
npm run test:db    # 58 test trên PostgreSQL thật (RLS, thanh toán, kho, ca, báo cáo...). Không chạy bằng root.
npm run test:e2e   # smoke test 17 màn hình + 7 kịch bản bán mang đi nhanh (Playwright, REST giả lập), cần `vite preview` đang chạy
npm run setup:sql  # tạo lại supabase/setup_all.sql từ các migration
```

## Cấu trúc
```
supabase/migrations/   0001..0011: schema, RLS, RPC nghiệp vụ (mọi thao tác tiền/kho đi qua RPC)
supabase/setup_all.sql tất cả migration gộp một tệp (dán vào SQL Editor)
supabase/seed_demo.sql dữ liệu mẫu để chạy thử (tùy chọn)
(tài khoản tạo ngay trong ứng dụng bằng tên đăng nhập: migration 0011, không cần Edge Function)
src/features/          pos, tables, orders, menu, inventory, shifts, cash, customers, reports, printer, audit
src/services/print/    PrintService, adapter QZ Tray / giả lập / trình duyệt, bố cục bill
tests/db, tests/e2e    test database và smoke test giao diện
docs/                  hướng dẫn cài đặt, máy in, backup, nghiệm thu
```

## Nguyên tắc an toàn
- Frontend chỉ dùng anon key. Giá, tổng tiền, tồn kho, hóa đơn do database tính, client không tự ghi.
- Thanh toán, hoàn tiền, nhận hàng, đóng ca đều idempotent: bấm đúp hoặc gửi lại không tạo giao dịch thứ hai.
- Hóa đơn, sổ kho, thu chi, nhật ký không sửa/xóa được; sai sót sửa bằng bút toán bù.

Xem [docs/NGHIEM_THU.md](docs/NGHIEM_THU.md) để biết chính xác phần nào đã được kiểm chứng tự động và phần nào cần bạn thử trên thiết bị thật.
