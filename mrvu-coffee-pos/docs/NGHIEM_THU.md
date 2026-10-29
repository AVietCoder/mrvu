# Nghiệm thu: đã kiểm chứng gì, cần bạn thử gì

## A. Đã kiểm chứng tự động (chạy lại bằng lệnh ghi bên phải)
| Hạng mục | Cách kiểm chứng | Lệnh |
|---|---|---|
| Mã nguồn biên dịch, lint sạch, build được | typecheck, eslint, vite build | `npm run verify` |
| Logic giỏ hàng, định dạng tiền/ngày, CSV, bố cục bill 58/80 mm, PrintService (chặn in trùng, timeout thành "không rõ", thử lại có xác nhận), tồn kho | test đơn vị | `npm test` |
| Phân quyền RLS: ai thấy/ghi được bảng nào | test trên PostgreSQL thật | `npm run test:db` |
| Giá lấy từ danh mục, không tin client; tổng tiền tính trong DB | test DB | `npm run test:db` |
| Thanh toán: chạy đồng thời, phát lại cùng khóa trả cùng hóa đơn, trừ kho theo công thức đúng một lần | test DB | `npm run test:db` |
| Hủy, hoàn tiền một phần/toàn bộ (chỉ hoàn toàn bộ mới hoàn kho), chuyển/gộp bàn | test DB | `npm run test:db` |
| Kho: nhận hàng đồng thời chỉ cộng một lần, hao hụt không vượt tồn, kiểm kho, công thức, sổ kho bất biến | test DB | `npm run test:db` |
| Ca: tiền dự kiến = đầu ca + bán tiền mặt + thu − chi − hoàn; lệch bắt buộc ghi lý do; thu chi gắn đúng ca | test DB | `npm run test:db` |
| Báo cáo: doanh thu theo ngày/giờ đúng múi giờ Việt Nam, hoàn tiền, giảm giá, giá vốn ẩn nếu thiếu quyền | test DB | `npm run test:db` |
| Gói cài đặt `setup_all.sql` cho kết quả giống chạy từng migration; dữ liệu mẫu chạy lại không nhân đôi | test DB | `npm run test:db` |
| 17 màn hình mở được ở 1366×768 và tablet, không lỗi console, không tràn ngang | Playwright, REST giả lập | `npm run test:e2e` |
| Bán mang đi nhanh trên trình duyệt: một ly = 2 thao tác; thêm món liên tục không hộp thoại; bấm/phím F3 nhiều lần chỉ thu 1 lần; chuyển khoản; máy in lỗi vẫn bán tiếp; mất phản hồi khi thu không thu lại mù quáng; màn hình pha chế | Playwright, REST giả lập có trạng thái (28 kiểm tra) | `npm run test:e2e` |
| Trạng thái pha chế (chờ/đang pha/xong/đã giao), không làm tăng version đơn, chỉ đơn hợp lệ, phiếu bếp một phiếu mỗi đơn | test DB | `npm run test:db` |

## B. Chưa kiểm chứng: cần bạn thử trên môi trường thật
Các mục này mình **không thể** thử trong môi trường phát triển (không có Supabase thật, máy in, thiết bị của quán). Đừng bán thật cho tới khi bạn đánh dấu xong.

| # | Việc cần thử | Đạt khi |
|---|---|---|
| 1 | Chạy `setup_all.sql` trên project Supabase thật | Không báo lỗi; đăng nhập và tạo cửa hàng được |
| 2 | Một vòng bán hàng thật qua trình duyệt (mục 5 trong hướng dẫn cài đặt) | Mọi bước chạy; số liệu khớp |
| 3 | Cài đặt lần đầu trên màn hình đăng nhập, rồi tạo nhân viên bằng tên đăng nhập ở Tài khoản & quyền | Chủ và nhân viên đăng nhập được với đúng vai trò. Đã test trên PostgreSQL (tests/db/login.test.mjs) nhưng chưa thử với Supabase Auth thật |
| 4 | Ảnh món: tải lên và hiển thị | Ảnh hiện trong thực đơn và POS (cần Storage bucket do migration 0005 tạo) |
| 5 | In thử và in bill thật bằng QZ Tray trên Xprinter 58IIH, khổ 58 mm | Chữ có dấu rõ, không lệch lề, không cắt chữ |
| 6 | Rút dây/tắt máy in rồi thanh toán | Thanh toán vẫn thành công; lệnh in hiện "In lỗi" và in lại được |
| 7 | Tắt Internet giữa lúc bấm Thanh toán | Hiện "chưa nhận được phản hồi"; sau khi có mạng, "Kiểm tra trạng thái" không tạo giao dịch trùng |
| 8 | Đăng nhập bằng từng vai trò (thu ngân, phục vụ, quản lý) | Chỉ thấy và làm được đúng quyền: phục vụ không hoàn tiền/xem báo cáo; thu ngân không xem giá vốn |
| 9 | Hai máy cùng sửa một đơn | Máy sau nhận thông báo xung đột, không ghi đè |
| 10 | Sao lưu bằng `pg_dump` và thử khôi phục vào project phụ | Dữ liệu khôi phục đủ |
| 11a | Bán mang đi nhanh với người thật: đo thời gian từ lúc khách gọi đến lúc đưa ly, gọi theo số | Thu ngân thấy thuận tay; chỉnh thực đơn (size mặc định, nhóm đường/đá) cho đúng thói quen quán |
| 11b | Phiếu pha chế in tự động ra đúng máy ở khu pha chế (bật ở Máy in & cửa hàng) | Phiếu có số gọi lớn, món, size, topping, ghi chú, không có giá |
| 11 | Dùng trên máy thu ngân thực tế (độ phân giải, màn hình cảm ứng nếu có, máy quét/ngăn kéo nếu dùng) | Thao tác thuận tay. Ngăn kéo tiền và máy quét mã vạch chưa được hỗ trợ |

## C. Chưa làm / giới hạn đã biết
- **Hóa đơn điện tử/hóa đơn theo quy định thuế KHÔNG được tích hợp.** Phần mềm chỉ ghi nhận giao dịch nội bộ và in bill thanh toán. Việc xuất hóa đơn theo quy định áp dụng cho cửa hàng cần hỏi kế toán/cơ quan thuế; không tắt hay bỏ qua nghĩa vụ này chỉ vì không nhập tên khách.
- Phiếu pha chế tự động chỉ áp dụng cho đơn mang đi lúc thanh toán. Đơn tại bàn: món gọi thêm sau khi đã phục vụ không tự xếp lại hàng pha chế, chưa có phiếu bếp tự động (in phiếu thủ công chưa có nút).
- Thêm món một chạm dùng size mặc định (size đang bán đầu tiên theo thứ tự); muốn size/đường/đá/topping khác bấm nút Tùy chọn trên thẻ món. Đây là lựa chọn nghiệp vụ, đổi được bằng thứ tự size trong Thực đơn.
- Chưa có chương trình điểm thưởng, giao hàng, thanh toán thẻ/QR tích hợp (chuyển khoản chỉ ghi nhận thủ công, không đối soát ngân hàng).
- Chưa tích hợp ký chứng chỉ QZ Tray (xem MAY_IN.md), nên QZ Tray sẽ hỏi xác nhận.
- Chưa có chế độ bán khi mất mạng: mất mạng thì giỏ hàng được giữ trên máy nhưng chưa lưu/thanh toán được.
- Chưa có logo trên bill; thông tin cửa hàng nhập ở Máy in & cửa hàng.
- Ảnh trong Storage không nằm trong `pg_dump`.
- Báo cáo "theo món/danh mục" là doanh số trước giảm giá toàn đơn (ghi chú ngay trong báo cáo).
