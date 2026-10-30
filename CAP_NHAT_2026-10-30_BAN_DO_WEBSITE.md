# Cập nhật 30/10/2026: tab "Bản đồ website"

## Mục tiêu
Phân tích **toàn bộ URL của mrvu.vn** trong một bảng, rồi lặp lại định kỳ để mỗi trang mang về nhiều khách hàng tiềm năng nhất từ Google (SEO) và AI (GEO):
1. URL nào nhắm **từ khóa** gì và trả lời **câu hỏi AI** nào.
2. Đã tối ưu chưa: **SEO on-page, cấu trúc GEO, tốc độ di động, index**.
3. **Liên kết nội bộ** đặt theo cấu trúc nhóm chủ đề và từ khóa ở bước 1.
4. **Theo dõi → so sánh → tư vấn lại** sau mỗi chu kỳ.

## Dữ liệu dùng (phần lớn miễn phí)

| Nguồn | Dùng để | Chi phí |
|---|---|---|
| Quét website (sitemap + liên kết) | Danh sách URL, tiêu đề, H1, liên kết nội bộ, link hỏng | Miễn phí |
| **Google Search Console** (đã kết nối) | Từ khóa thật của từng URL, click, hiển thị, vị trí, so với 28 ngày trước; kiểm tra index | Miễn phí |
| **GA4** (đã kết nối) | Phiên truy cập, chuyển đổi theo trang | Miễn phí |
| **Google PageSpeed Insights API** (khóa mới) | Điểm tốc độ di động, LCP/TBT/CLS, dữ liệu người dùng thật, cách sửa | Miễn phí (khoảng 25.000 lượt/ngày) |
| DataForSEO Labs | Từ khóa mrvu.vn đang có thứ hạng theo URL | Khoảng 3.000 đ/lần |
| Câu hỏi AI (tab có sẵn) | Câu hỏi AI đã giao cho từng trang, mức hiện diện trên AI | Đã tính ở tab đó |
| Claude | Gán từ khóa/nhóm/vai trò, báo cáo, tư vấn trang, tìm vị trí đặt link | Theo lượng dùng |

## Tính năng

### Phân tích toàn website (một nút bấm, hoặc tự chạy mỗi 30 ngày)
- Quét mọi URL, đọc liên kết nội bộ.
- Lấy số liệu Search Console và GA4 theo từng URL.
- **AI gán cho mỗi URL:** từ khóa chính, từ phụ, câu hỏi AI cần trả lời, ý định (mua / so sánh / giá / hướng dẫn…), nhóm chủ đề, vai trò (trụ cột / danh mục / sản phẩm / bài viết).
- **Chấm điểm:** SEO on-page (khoảng 30 tiêu chí), cấu trúc GEO, tốc độ di động, trạng thái index.
- Phát hiện **trùng từ khóa** (2 trang tự tranh nhau), **trang mồ côi**, **trang nằm sâu**, **link hỏng**, **trang thiếu trong sitemap**.
- **So sánh với lần trước:** click giảm, tụt hạng, chậm đi, trang lỗi, mất liên kết, trang mới.
- **AI viết báo cáo và việc cần làm**, xếp theo tác động tới khách hàng tiềm năng (tác động / công sức / ai phụ trách).

### Thẻ Trang
- Bảng tất cả URL: từ khóa chính, click và vị trí (có so sánh), điểm SEO, GEO, tốc độ, số link trỏ tới, việc cần làm.
- **Lọc:** loại trang, nhóm, vấn đề (cơ hội lên top, tốc độ, GEO, liên kết, trùng từ khóa, index…).
- **Sắp xếp** theo *giá trị khách hàng*: trang có ý định mua và nhiều hiển thị đứng đầu.
- **Chi tiết từng trang:**
  - **sửa và chốt từ khóa** (AI không đổi từ khóa đã chốt);
  - từ khóa Google thật, việc cần làm, lỗi SEO/GEO kèm cách sửa;
  - tốc độ kèm gợi ý tiếng Việt;
  - link nên thêm tới/từ trang;
  - lịch sử qua các lần phân tích.
- **Tư vấn trang (AI):** title, meta, H1 đề xuất, đoạn trả lời 40–60 chữ cho AI, mục nội dung cần thêm, cách tăng chuyển đổi, việc kỹ thuật, thứ tự làm.
- **Nút đi kèm:** đo lại tốc độ, theo dõi thứ hạng (Rank Tracker), phân tích GEO, mở Audit.

### Thẻ Từ khóa
- **Trùng từ khóa** và cách xử lý (chọn trang chính, đổi hoặc gộp trang phụ, link về trang chính).
- **Câu hỏi AI chưa có trang trả lời**: gửi một lần sang Autopost để viết bài.
- **Bản đồ từ khóa theo nhóm:** mỗi trang một từ khóa chính; trang trụ cột/danh mục đứng đầu nhóm.

### Thẻ Liên kết nội bộ
- **Gợi ý link theo cấu trúc cụm chủ đề:**
  - bài con → trang trung tâm của nhóm;
  - trang trung tâm → bài con;
  - bài viết → sản phẩm (tăng chuyển đổi);
  - bài cùng nhóm liên kết qua lại;
  - cứu trang mồ côi, rút ngắn độ sâu.

  Chữ neo là từ khóa chính của trang đích.
- **AI tìm vị trí:** chỉ ra câu cụ thể trên trang nguồn để gắn link, hoặc viết câu mới.
- Đánh dấu *Đã làm / Bỏ qua*. Lần phân tích sau, link đã xuất hiện trên website tự được đánh dấu *Đã làm*.
- **Tải CSV** danh sách link cho người quản trị mrvu.vn.
- Trang mồ côi, link hỏng, cấu trúc từng nhóm (trang nào chưa trỏ về trang trung tâm).

## Chi phí ước tính
| Việc | Chi phí |
|---|---|
| Phân tích lần đầu (khoảng 500 trang) | khoảng 20.000–40.000 đ |
| Phân tích hằng tháng (chỉ gán từ khóa cho trang mới) | khoảng 5.000–10.000 đ |
| Tư vấn 1 trang | khoảng 800 đ |
| AI tìm vị trí đặt 1 link | khoảng 300 đ |
| Đo tốc độ, Search Console, GA4, kiểm tra index | Miễn phí |

## Tạo khóa PageSpeed Insights API (khoảng 2 phút)
1. Vào **console.cloud.google.com**, chọn project đã dùng cho Search Console.
2. **APIs & Services → Library** → tìm **PageSpeed Insights API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**, copy khóa (bắt đầu bằng `AIza`).
4. Bấm vào khóa → **API restrictions → Restrict key** → chọn **PageSpeed Insights API** → Save.
5. Dán vào **Bản đồ website → Cài đặt → Khóa PageSpeed Insights API** → **Lưu**.

## Cách dùng hằng tháng
1. **Phân tích ngay**, hoặc để lịch tự chạy.
2. Đọc **Báo cáo và việc cần làm**, làm các việc *tác động cao* trước.
3. Xử lý **trùng từ khóa** và các link *Cần làm* (tải CSV cho người làm web).
4. Mở các trang giá trị nhất, bấm **Tư vấn trang**, sửa title, nội dung, tốc độ.
5. Lần sau xem **Biến động** để biết việc nào đã có hiệu quả.

## Thay đổi kỹ thuật
| Tệp | Thay đổi |
|---|---|
| `smap.py` (mới) | Toàn bộ xử lý Bản đồ website, lịch định kỳ |
| `smap.html` (mới) | Trang Bản đồ website (5 thẻ), có dữ liệu mẫu |
| `app.py` | Định tuyến `/api/smap/*`, trang `/smap` |
| `audit.py`, `geo.py` | Cho phép dùng lại trang đã tải (mỗi trang chỉ tải 1 lần khi chấm điểm) |
| `costs.py`, `costguard.js` | Thao tác `smap_cycle`, `smap_page`, `smap_place`, `smap_report`; cài đặt `smap_recent_days` |
| 8 trang còn lại | Thêm tab "Bản đồ website" vào menu |
| `HUONG_DAN.md`, `TAI_LIEU_SAN_PHAM.md` | Mục 6b, tài liệu API `/api/smap/` và bảng dữ liệu |

Dữ liệu mới (tự tạo khi khởi động): `smap_sites`, `smap_pages`, `smap_cycles`, `smap_snaps`, `smap_links`. Khóa PageSpeed lưu trong `config.json` (`psi_api_key`).

## Cách cập nhật
1. Tắt công cụ, chép các tệp trong `mrvu-seo-studio.zip` đè lên thư mục đang dùng. **Giữ nguyên** `kho-tu-khoa.db`, `config.json`, `google-service-account.json`, `anh-thu-vien/`.
2. Mở lại công cụ → **Bản đồ website → Cài đặt**: nhập `mrvu.vn` và khóa PageSpeed → Lưu.
3. **Tổng quan → Phân tích ngay.** Lần đầu với vài trăm trang mất khoảng 20–60 phút, chạy nền; có thể đóng trang và quay lại sau.

## Lưu ý
- Tính năng mới được kiểm thử bằng dữ liệu giả lập. Lần chạy thật đầu tiên nên xem kỹ phần *Ghi chú* trong Tổng quan.
- Từ khóa AI gán là đề xuất: hãy duyệt các trang quan trọng (danh mục, sản phẩm chủ lực) và **chốt** từ khóa theo chiến lược kinh doanh.
- Gợi ý liên kết nội bộ nên được người quản trị duyệt trước khi chèn; mỗi trang không nên thêm quá nhiều link một lúc.
- Dữ liệu người dùng thật về tốc độ (Chrome) chỉ có với trang đủ lượt truy cập; các trang khác dùng số đo thử nghiệm.
