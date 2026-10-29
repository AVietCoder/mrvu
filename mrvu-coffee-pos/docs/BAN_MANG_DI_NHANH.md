# Bán mang đi nhanh (Fast Takeaway)

Mục tiêu: khách gọi, thu ngân chạm món, thu tiền, đưa số gọi; không hỏi tên/số điện thoại, không đợi máy in.

## Quy trình thu ngân
1. Mở **Bán hàng**: mặc định đơn **Mang đi**, không chọn bàn, không nhập khách.
2. **Chạm thẻ món** để thêm (size đầu tiên, không tùy chọn). Chạm lại để tăng số lượng. Cần size/đường/đá/topping khác: bấm nút thanh trượt ở góc thẻ món (hộp **Tùy chọn**). Món có nhóm tùy chọn *bắt buộc* sẽ tự mở hộp chọn.
3. Thu tiền:
   - **Tiền mặt (F3)**: khách đưa đủ, chốt đơn ngay, không hộp thoại.
   - **Chuyển khoản (F6)**: mở sẵn Chuyển khoản; xác nhận sau khi bạn tự kiểm tra tiền đã về (phần mềm không đối soát ngân hàng).
   - **F4**: thanh toán đầy đủ (nhập tiền khách đưa để tính tiền thừa, chia nhiều phương thức).
4. Sau khi server xác nhận: giỏ hàng được dọn, hiện thanh xanh với **số gọi lớn** (`#12`, lấy từ số thứ tự trong ngày của mã đơn) và tiền thừa. Bán đơn kế tiếp ngay, thanh này không chặn.
5. In chạy nền: bill khách (nếu bật *Tự động in bill*) và phiếu pha chế (nếu bật *Phiếu bếp*, chỉ đơn mang đi). Lỗi in chỉ hiện trên thanh xanh; đơn đã thanh toán được giữ nguyên, bấm **In lại** (không tạo hóa đơn mới).

## Màn hình pha chế (`/pha-che`)
Ba cột Chờ pha → Đang pha → Xong, chờ giao; tự làm mới mỗi 5 giây. Nhân viên bấm Bắt đầu pha / Pha xong / Đã giao khách. Gọi khách theo số gọi. Trạng thái này **không** đổi doanh thu, kho, hóa đơn.

## Phím tắt
F2 tìm món · F3 tiền mặt đủ · F4 thanh toán đầy đủ · F6 chuyển khoản · F8 lưu tạm · F9 đơn đang mở.

## An toàn
- Giá và tổng tiền tính lại trong database khi lưu đơn; màn hình chỉ hiển thị.
- Thu tiền có khóa chống trùng: bấm nhiều lần hay F3 liên tiếp chỉ ghi một giao dịch.
- Mất phản hồi khi thu: hiện "Kiểm tra trạng thái giao dịch", không tự thu lại.
- Mỗi hóa đơn có một lệnh in tự động, mỗi đơn có một phiếu pha chế tự động.

## Giới hạn
Xem mục C trong NGHIEM_THU.md (hóa đơn điện tử chưa tích hợp; đơn tại bàn chưa có phiếu bếp tự động).
