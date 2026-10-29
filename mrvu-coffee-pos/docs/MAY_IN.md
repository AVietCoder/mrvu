# In bill

Ứng dụng là web nên trình duyệt không tự in im lặng ra máy in bill. Có ba cách, chọn ở **Máy in & cửa hàng → Cách in**:

| Cách in | Dùng khi | Ghi chú |
|---|---|---|
| Giả lập | Chạy thử, phát triển | Không in ra giấy; bản in xem ngay trong trang |
| QZ Tray | Dùng thật, in im lặng ra máy in Windows | Cần cài QZ Tray trên máy thu ngân |
| Hộp thoại trình duyệt | Dự phòng | Hiện hộp thoại in mỗi lần, không biết kết quả |

## Cài QZ Tray
1. Tải và cài QZ Tray từ https://qz.io/download trên máy thu ngân, để nó chạy cùng Windows.
2. Cài máy in bill bằng driver Windows của hãng, in thử một trang từ Windows để chắc máy in chạy.
3. Trong ứng dụng: Máy in & cửa hàng → Cách in = QZ Tray → bấm "Kiểm tra lại". Khi QZ Tray hỏi cho phép trang web này, chọn cho phép (và chọn nhớ lựa chọn nếu muốn bớt hỏi).
4. Chọn máy in trong danh sách, chọn đúng khổ giấy (58 hoặc 80 mm), bấm **In thử**, kiểm tra chữ tiếng Việt có dấu và lề.

Lưu ý về chứng chỉ: QZ Tray chỉ in hoàn toàn im lặng khi trang web được ký bằng chứng chỉ mà QZ Tray tin cậy; nếu không, nó hỏi xác nhận. Cách tạo chứng chỉ và ký theo tài liệu của QZ Tray (https://qz.io/docs). Ứng dụng này chưa tích hợp bước ký, nên mặc định bạn sẽ thấy hộp thoại xác nhận của QZ Tray.

## Máy Xprinter 58IIH (máy của quán)
Thông tin lấy từ trang bán hàng của nhà cung cấp, **chưa kiểm chứng trên máy thật**. Trang này ghi khổ giấy không thống nhất (58 mm ở bảng cấu hình, 57 mm ở phần đánh giá), nên hãy kiểm tra cuộn giấy bạn mua.

| Thông tin | Giá trị | Ứng dụng xử lý |
|---|---|---|
| Khổ giấy | 58 mm (cuộn 57 mm) | Chọn khổ giấy **58 mm** |
| Độ phân giải | 384 chấm/dòng (≈ 48 mm vùng in) | Bill 32 ký tự/dòng, chữ tự co để vừa 48 mm, không bị cắt mép |
| Kết nối | USB (một số bản có Bluetooth; trang không nói LAN) | Dùng qua driver Windows + QZ Tray |
| Dao cắt | Không có, xé tay | Cuối bill chừa 4 dòng trống để xé |
| Ngăn kéo tiền | Có cổng RJ11, trang nói tự mở khi in | Ứng dụng **chưa hỗ trợ** mở ngăn kéo; nếu máy tự mở khi in bill thì do máy |
| Driver | Trang không nêu | Cài driver từ nhà cung cấp/hãng Xprinter, kiểm tra in thử trang Windows trước |

Các bước: cắm USB, cài driver, in thử trang kiểm tra trong Windows, rồi làm theo mục "Cài QZ Tray" ở trên với khổ giấy 58 mm. Nếu chữ lệch hoặc bị cắt, giảm "Cỡ chữ" hoặc đổi "Lề" rồi in thử lại, và báo lại kết quả để mình chỉnh.

## Trạng thái lệnh in
| Trạng thái | Ý nghĩa | Làm gì |
|---|---|---|
| In thành công / Đã gửi tới máy in | Lệnh đã chuyển cho máy in / hàng đợi Windows | QZ Tray chỉ xác nhận chuyển lệnh, không xác nhận giấy đã ra |
| In lỗi | Chắc chắn chưa in (máy in tắt, không kết nối...) | Bấm "In lại" |
| Không rõ kết quả | Quá thời gian chờ, có thể đã in | Nhìn máy in. Nếu chưa thấy bill, bấm "Chưa thấy bill, in lại". Hệ thống không tự in lại để tránh in trùng |

Thanh toán không bao giờ bị hủy vì lỗi in. Mỗi hóa đơn chỉ có một lệnh in tự động; in lại tạo lệnh riêng, ghi lý do, bill có dòng "BẢN SAO".

## Chưa kiểm chứng
Chưa thử trên máy in thật nào, nên chưa khẳng định hỗ trợ model cụ thể. Hãy ghi lại model máy in và kết quả in thử của bạn; nếu lệch lề, sai khổ hoặc lỗi dấu, báo lại để chỉnh.
