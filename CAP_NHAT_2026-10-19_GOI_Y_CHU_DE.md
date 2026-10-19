# Cập nhật 19/10/2026: Gợi ý chủ đề từ đối thủ (Autopost)

## Tóm tắt
Tab **Autopost → Bộ từ khóa** có thêm khung **"Gợi ý chủ đề từ đối thủ"**. Bạn nhập chủ đề, website của mình và tối đa 3 website đối thủ. Hệ thống tìm chủ đề đối thủ đã có mà bạn chưa có, gom thành từng bài, chấm điểm ưu tiên rồi đưa vào hàng chờ viết bài kèm định hướng cho AI.

## Tính năng mới

### 1. Phân tích chủ đề
- **Đầu vào:** chủ đề (ví dụ `quạt trần`), website đang chọn, tối đa 3 tên miền đối thủ.
- **Hai chế độ:**

  | Chế độ | Dữ liệu | Chi phí ước tính/lần |
  |---|---|---|
  | Đầy đủ | Volume, độ khó, từ khóa đối thủ đang lên Top Google (DataForSEO Labs) và AI | Khoảng 5.000–8.000 đ (1–3 đối thủ) |
  | Tiết kiệm | Chỉ sitemap đối thủ, Search Console và AI; không có volume | Khoảng 2.000 đ |

- **Nguồn miễn phí luôn dùng:**
  - sitemap đối thủ;
  - các trang của website bạn (dữ liệu tab Audit; nếu chưa có thì tự đọc sitemap và lưu vào Audit);
  - bài đã viết, hàng chờ;
  - Search Console.
- **Dự phòng:** nếu DataForSEO Labs không hỗ trợ Việt Nam, hệ thống tự chuyển sang dữ liệu Google Ads và ghi chú trong kết quả.
- **Lọc nhiễu:** tự bỏ từ khóa chứa tên thương hiệu đối thủ và từ khóa không liên quan tới chủ đề.

### 2. Bảng kết quả
- Mỗi dòng là **một bài viết**: từ khóa chính và các từ phụ cùng ý định.
- **Điểm ưu tiên 0–100**, kèm mức *Viết ngay / Nên viết / Viết sau*.
- Nhãn **Trụ cột / Vệ tinh**; bài vệ tinh ghi rõ trỏ về bài trụ cột nào.
- Volume, độ khó, ý định tìm kiếm, đối thủ đã viết, góc viết, trang sản phẩm hoặc danh mục nên gắn link.
- **Bộ lọc:** Khoảng trống / Đã có bài / Tất cả. Chủ đề đã có bài được đánh dấu để tránh viết trùng.
- Nhận xét chủ đề **có hợp với website không**.

### 3. Đưa vào hàng chờ (2 cách)
- **Tự chọn:** tick chủ đề rồi bấm *Thêm vào hàng chờ*.
- **Tự động:** bật *Tự thêm N chủ đề điểm cao nhất* trước khi phân tích. Công cụ chỉ thêm chủ đề từ 50 điểm và chưa có bài, và không tự thêm nếu chủ đề lệch website.

### 4. AI viết bài theo định hướng
Chủ đề thêm từ phân tích mang theo một bản định hướng: từ khóa phụ, tiêu đề tham khảo, góc viết, vai trò trụ cột/vệ tinh, đối thủ đã viết, link bắt buộc tới trang sản phẩm. AI bám theo bản này khi lập dàn ý và viết bài. Trong hàng chờ, các từ khóa này có dòng chữ xanh *"Từ Gợi ý chủ đề"*.

### 5. Cảnh báo lệch chủ đề (miễn phí)
Khi tự nhập từ khóa mà từ một nửa trở lên không khớp nội dung website đang chọn, công cụ hiện cảnh báo với 2 lựa chọn *Vẫn thêm* / *Hủy*. Ví dụ: từ khóa quạt trần cho website làm mát công nghiệp.

### 6. Lịch sử và chi phí
- Mọi lần phân tích lưu ở **Lần phân tích trước**, mở lại miễn phí.
- Hộp ước tính chi phí hiện trước khi chạy, có ô chọn nhanh *Chế độ tiết kiệm*.
- Phân tích lại cùng chủ đề và đối thủ trong **30 ngày** sẽ có cảnh báo (chỉnh được trong bảng Chi phí).
- Chi phí thật được ghi vào sổ, nhóm **"Gợi ý chủ đề"**.

## Thay đổi kỹ thuật

| Tệp | Thay đổi |
|---|---|
| `topics.py` (mới) | Toàn bộ logic phân tích, chấm điểm, thêm hàng chờ, kiểm tra lệch chủ đề |
| `app.py` | Định tuyến `/api/tp/*`, gọi `topics.setup()` |
| `autopost.py` | Cột `brief_json` cho hàng chờ; `write_article()` dùng định hướng khi viết |
| `costs.py`, `costguard.js` | Thao tác `topics`, giá `dfs_labs_task` (0,01 USD) và `dfs_labs_item` (0,0001 USD), cài đặt `tp_recent_days` |
| `autopost.html` | Khung Gợi ý chủ đề, bảng kết quả, cảnh báo lệch chủ đề, dữ liệu mẫu |
| `HUONG_DAN.md`, `TAI_LIEU_SAN_PHAM.md` | Bổ sung hướng dẫn và tài liệu API |

**Cơ sở dữ liệu** (tự tạo khi khởi động, không mất dữ liệu cũ):
- Bảng mới `tp_runs`: lưu các lần phân tích.
- Cột mới `ap_keywords.brief_json`: định hướng viết của từng từ khóa.

**API mới** `/api/tp/`:

| Method | Đường dẫn | Việc |
|---|---|---|
| POST | `analyze` | Bắt đầu phân tích, trả `job_id` |
| GET | `job/<id>` | Theo dõi tiến trình và nhận kết quả |
| GET | `runs?site_id=` | Danh sách lần phân tích |
| GET / DELETE | `run/<id>` | Xem / xóa một lần phân tích |
| POST | `add` | Thêm chủ đề đã chọn vào hàng chờ |
| POST | `fit` | Kiểm tra từ khóa có lệch chủ đề website không |

## Cách cập nhật
1. Tắt công cụ.
2. Chép các tệp mới trong `mrvu-seo-studio.zip` đè lên thư mục đang dùng. **Giữ nguyên** `kho-tu-khoa.db`, `config.json`, `google-service-account.json`, `anh-thu-vien/`.
3. Mở lại công cụ. Bảng và cột mới tự được thêm.

## Lưu ý lần chạy đầu
- Tính năng mới được kiểm thử bằng dữ liệu giả lập. Nên chạy thử **1 chủ đề với 1 đối thủ** ở chế độ đầy đủ trước để kiểm tra dữ liệu thật.
- Đối thủ không có sitemap thì công cụ phải bò theo liên kết, nên chậm hơn.
- Nên quét website của bạn ở tab **Audit** trước. Như vậy phần chống trùng, gắn link nội bộ và cảnh báo lệch chủ đề sẽ chính xác hơn.
