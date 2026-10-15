# Mr.Vũ SEO Studio — hướng dẫn sử dụng

Công cụ tra cứu Search Volume, CPC, độ cạnh tranh và xu hướng 12 tháng của từ khóa, chạy trên máy tính của bạn. Dữ liệu lấy từ Google Ads thông qua DataForSEO.

> **Nâng cấp từ bản cũ "Kho Từ Khóa":** giải nén thư mục `mrvu-seo-studio` vào **cùng chỗ** với thư mục `kho-tu-khoa` cũ (hai thư mục nằm cạnh nhau), rồi mở `MO_CONG_CU.bat` trong thư mục mới. Lần chạy đầu, công cụ tự chép lịch sử, cấu hình, khóa Google và thư viện ảnh sang. Kiểm tra mọi thứ đầy đủ rồi mới xóa thư mục cũ. Nếu đã cài plugin WordPress bản cũ thì cứ giữ, không cần cài lại.

> **Dùng online tại seo.ttv.vn (có đăng nhập Google):** xem file `TRIEN_KHAI.md`.

## 1. Cài Python (một lần)

1. Tải Python tại https://www.python.org/downloads/
2. Khi cài, **tick ô "Add Python to PATH"**.

Không cần cài thêm thư viện nào.

## 2. Mở công cụ

- Windows: bấm đúp file `MO_CONG_CU.bat`.
- macOS / Linux: mở Terminal trong thư mục này, gõ `python3 app.py`.

Trình duyệt tự mở trang http://127.0.0.1:8686. Giữ cửa sổ đen (cửa sổ lệnh) mở trong lúc dùng.

Chưa có tài khoản API thì công cụ chạy bằng **dữ liệu mẫu** để bạn làm quen giao diện.

## 3. Kết nối dữ liệu thật

1. Đăng ký tài khoản tại https://app.dataforseo.com/ và nạp tiền (trả theo lượt dùng).
2. Vào mục **API Access** lấy *API login* và *API password* (khác mật khẩu đăng nhập web).
3. Mở file `config.json` (tự tạo sau lần chạy đầu) bằng Notepad, điền:

```json
{
  "login": "email-api-cua-ban@gmail.com",
  "password": "mat-khau-api",
  "usd_vnd": 26000
}
```

4. Tắt cửa sổ lệnh, mở lại `MO_CONG_CU.bat`. Góc phải trên sẽ báo **Đã kết nối DataForSEO**.

## 4. Cách dùng

- Dán từ khóa, mỗi dòng một từ, tối đa 1.000 từ/lần. Từ trùng tự gộp; từ dài quá 80 ký tự hoặc quá 10 chữ bị bỏ qua (giới hạn của Google Ads).
- Chọn thị trường (mặc định Việt Nam, tiếng Việt) rồi bấm **Tra cứu volume**.
- Lọc theo khoảng volume, mức cạnh tranh, từ phải chứa, từ loại trừ. Bấm tiêu đề cột để sắp xếp.
- **Copy sang Sheets**: copy bảng đang lọc, dán thẳng vào Google Sheets/Excel.
- **Xuất CSV**: tải file mở được bằng Excel (đã xử lý tiếng Việt có dấu).
- Mỗi lần tra được lưu vào **Lịch sử kiểm tra** (file `kho-tu-khoa.db`), mở lại không tốn tiền.

## 5. Rank Tracker (Google)

Mở tab **Rank Tracker** ở đầu trang (hoặc http://127.0.0.1:8686/rank.html).

1. Chọn website đã lưu, hoặc nhập tên miền mới (gõ `mrvu.vn` là đủ; có `https://`, `www.` hay đường dẫn cũng được, công cụ tự làm gọn).
2. Dán từ khóa cần theo dõi, chọn thị trường, bấm **Thêm vào danh sách**.
3. Chọn độ sâu quét (mặc định Top 10; có Top 30/50/100), bấm **Quét mục đã chọn**.

Kết quả:
- Vị trí trên từng công cụ, URL nào của bạn đang lên top, mũi tên ▲▼ so với lần quét trước, "Mới vào top" hoặc "Rớt khỏi top".
- Tính cả subdomain (blog.mrvu.vn cũng tính là mrvu.vn).
- Bấm **Lịch sử** ở một dòng để xem biểu đồ thứ hạng qua các lần quét.
- Copy sang Sheets / Xuất CSV giống trang tra volume.

**Chi phí quét:** DataForSEO tính tiền theo *mỗi trang 10 kết quả*. Quét Top 30 cho 1 từ = tối đa 3 lượt tính phí. Công cụ hiện ước tính số lượt trước mỗi lần quét. Mẹo tiết kiệm: từ đã ở top 10 thì quét Top 10; chỉ quét sâu với từ còn xa.

**Khác với công cụ dùng Chrome Extension:** công cụ này lấy thứ hạng qua API của DataForSEO nên không cần cài extension, không bị Google bắt giải CAPTCHA và không làm chậm trình duyệt của bạn. Kết quả là thứ hạng phổ thông (không cá nhân hóa theo lịch sử tìm kiếm của bạn), chuẩn hơn tự tìm trên máy.


## 6. Audit On-page

Mở tab **Audit On-page** (hoặc http://127.0.0.1:8686/audit.html). Tính năng này **không cần tài khoản DataForSEO** và miễn phí, trừ phần gợi ý AI.

**Bước 1 – Quét & phân loại.** Nhập tên miền, bấm **Quét website & phân loại**. Công cụ đọc `robots.txt` và sitemap (kể cả sitemap của Yoast/Rank Math). Nếu website không có sitemap, nó bò theo liên kết (tối đa 300 trang). Trang được xếp vào Trang chủ / Danh mục / Sản phẩm / Bài viết / Khác dựa trên đường dẫn và tên sitemap. Khi audit, loại trang được chỉnh lại theo schema thật của trang.

**Bước 2 – Audit từng URL.** Bấm **Audit** ở một dòng. Báo cáo chấm điểm /100 và chia lỗi theo nhóm: Kỹ thuật, Tiêu đề & heading, Nội dung & từ khóa, Hình ảnh, Liên kết, Dữ liệu cấu trúc, Chia sẻ mạng xã hội. **Mỗi mục lỗi đều có dòng "Cách sửa".**
- Nhập **từ khóa chính** rồi bấm **Audit lại** để kiểm tra thêm: từ khóa trong title, H1, meta, URL, đoạn mở đầu, H2 và mật độ từ khóa.
- **Schema mẫu** tạo sẵn theo loại trang (Product, BlogPosting, Organization, BreadcrumbList…). Thay các chỗ VIẾT_HOA bằng thông tin thật rồi dán vào trang.
- **Copy báo cáo** để gửi cho người sửa web/viết bài qua Zalo hoặc Docs.
- **Audit các trang đang lọc chưa audit**: chạy tối đa 50 trang một lượt (bỏ qua kiểm tra link hỏng cho nhanh). Lọc "Sản phẩm" rồi bấm là audit cả nhóm sản phẩm.

**Bước 3 – Gợi ý bằng AI (tùy chọn).** Cần khóa Claude API:
1. Tạo khóa tại https://console.anthropic.com/ (mục API Keys) và nạp tiền.
2. Điền vào `config.json`: `"anthropic_api_key": "sk-ant-..."`. Mục `anthropic_model` để mặc định là được.
3. Mở lại công cụ. Trong báo cáo, bấm **Gợi ý tối ưu bằng AI** để nhận 3 phương án title, meta description, H1, dàn ý, nội dung còn thiếu, FAQ kèm schema FAQ, và danh sách việc nên làm trước.

Mỗi lần gợi ý AI tốn khoảng vài trăm đồng đến hơn một nghìn đồng tùy độ dài trang.

Lưu ý: công cụ tải trang từ máy của bạn, mỗi trang một lần, nên không gây tải cho website. Nếu website chặn bot (Cloudflare), một số trang có thể báo lỗi 403.

## 7. Autopost (AI viết bài & tự đăng)

Mở tab **Autopost** (hoặc http://127.0.0.1:8686/autopost.html).

**Chuẩn bị (một lần)**
1. Tab **Cài đặt AI & biến**: nhập Claude API key. Nếu muốn ảnh minh họa miễn phí bản quyền, nhập thêm Pexels API key (đăng ký miễn phí tại pexels.com/api).
2. Điền **biến dùng chung**: thương hiệu, hotline, khu vực, chính sách bảo hành… AI chỉ dùng thông tin có ở đây, không tự bịa.
3. Muốn dùng ảnh thật của mình: chép ảnh vào thư mục `anh-thu-vien`, đặt tên file không dấu theo nội dung (ví dụ `quat-tran-go-phong-khach.jpg`).

**Kết nối website** (tab Websites → + Thêm website)
- **WordPress**: nhập địa chỉ, tên đăng nhập và *Application Password*. Tạo mật khẩu này trong WordPress ở *Thành viên → Hồ sơ → Application Passwords*. Bấm **Kiểm tra kết nối** để tải danh mục.
  - Muốn công cụ ghi luôn meta title/description vào Yoast hoặc Rank Math: tải file `wordpress-plugin/mrvu-seo-studio-seo-meta.php` lên thư mục `wp-content/plugins/` rồi kích hoạt (hoặc chép vào `wp-content/mu-plugins/`), sau đó chọn đúng plugin SEO trong cấu hình website.
- **Website riêng (mrvu.vn chạy ASP.NET)**: chọn *Custom API*. Gửi file `HUONG_DAN_CUSTOM_API.md` cho người làm web để họ tạo địa chỉ nhận bài, rồi nhập địa chỉ đó và mã bảo mật vào đây.

**Viết & đăng**
1. Tab **Bộ từ khóa**: chọn website, dán từ khóa (mỗi dòng một bài), bấm *Thêm vào hàng chờ*.
2. Bấm **Viết thử** để AI viết bài và mở ra cho bạn đọc lại. Trong đó có bản xem trước trên Google, đếm ký tự meta, số chữ và link nội bộ. Bấm **Sửa** nếu cần, rồi **Đăng lên website**.
   Bấm **Viết & đăng** để làm cả hai bước một lần.
3. Mỗi bài AI tự lập dàn ý theo ý định tìm kiếm, viết khoảng 800–2.500 chữ, có bảng/danh sách, mục FAQ, lời kêu gọi kèm hotline. Nếu bạn đã quét website ở tab Audit On-page, AI chèn 2–4 **link nội bộ** tới đúng trang có thật.
4. **Lịch tự động**: bật trong cấu hình website, chọn số bài/ngày và khung giờ. Công cụ rải bài đều trong khung giờ và chỉ chạy khi cửa sổ công cụ đang mở.
5. Tab **Nhật ký** ghi mọi lần viết, đăng, lỗi (kèm số token AI đã dùng).

**Khuyến nghị:** để chế độ *Lưu nháp trên website*, đọc lại, thêm ảnh thực tế và kinh nghiệm riêng rồi mới xuất bản. Google hạ hạng các website đăng hàng loạt nội dung tự động mà không có giá trị riêng. 1–3 bài chất lượng mỗi ngày an toàn và hiệu quả hơn hàng chục bài.

## 8. Tối ưu AI Overview (GEO)

Mở tab **AI Overview (GEO)** (hoặc http://127.0.0.1:8686/geo.html). Cần tài khoản DataForSEO; khóa Claude để có phần đề xuất sửa.

1. Nhập **URL bài viết** và **từ khóa mục tiêu**, bấm **Phân tích GEO** (khoảng 30–60 giây).
2. Công cụ lấy **AI Overview thật của Google** qua DataForSEO (không cần extension), kèm các nguồn đang được trích, câu hỏi "Mọi người cũng hỏi" và top 10.
3. Đọc trang của bạn và các trang đang được trích, rồi cho ra:
   - **Điểm GEO /100**: được trích dẫn (30) + độ phủ ý so với AI Overview (40) + cấu trúc nội dung (30). Trang có noindex/nosnippet bị giới hạn 10 điểm vì Google không thể trích.
   - **Đoạn trả lời mẫu** 40–60 chữ để đặt ngay dưới H1.
   - **Việc cần làm** sắp theo mức ảnh hưởng, mỗi việc ghi rõ vị trí chèn và nội dung viết sẵn (bảng, đoạn văn, heading). Chỗ nào cần số liệu thật, AI ghi [CẦN ĐIỀN: …] thay vì bịa.
   - **Bảng độ phủ ý**: từng ý AI Overview đang nêu, trang bạn đã có, có một phần hay chưa có.
   - **FAQ + schema FAQPage** để dán vào trang.
4. Sửa bài xong, đợi Google cập nhật (vài ngày tới vài tuần) rồi bấm **Kiểm tra lại**. Lịch sử giữ lại để so điểm trước và sau.

Chi phí mỗi lần: khoảng 0,005 USD cho DataForSEO (AI Overview + mở rộng câu hỏi) cộng một lần gọi Claude. Nếu từ khóa không có AI Overview, công cụ không gọi Claude và gợi ý các câu hỏi liên quan để thử, vì từ khóa mua hàng ("quạt trần", "giá quạt trần") hiếm khi có AI Overview.

## 9. Backlink

Mở tab **Backlink** (hoặc http://127.0.0.1:8686/backlinks.html).

**Thêm website**: nhập tên miền của bạn và 2–5 đối thủ (lấy từ các website hay đứng trên bạn ở tab Rank Tracker).

**Nguồn dữ liệu — chọn một:**
- **DataForSEO Backlinks API (đầy đủ nhất)**: bấm *Cập nhật backlink*. Có uy tín tên miền, anchor, trang đích, dofollow/nofollow, link mất. Tài khoản cần **kích hoạt Backlinks API: nạp tối thiểu 100 USD/tháng** (tiền vẫn nằm trong số dư, dùng được cho mọi API). Mỗi lần cập nhật khoảng 0,1 USD.
- **Google Search Console (miễn phí)**: vào Search Console → *Liên kết* → *Trang web liên kết hàng đầu* → *Xuất* → *Tải xuống CSV*, rồi bấm *Nhập file Search Console*. Chỉ có tên miền và số link, đủ để theo dõi tăng/giảm.

Mỗi lần cập nhật được lưu lại, nên tab **Tổng quan** cho thấy website mới trỏ link, website đã mất link, biểu đồ tăng trưởng và nguồn link theo loại (báo, diễn đàn, danh bạ, mạng xã hội…). Nên cập nhật mỗi tuần hoặc mỗi tháng.

**Cơ hội từ đối thủ** (cần DataForSEO): bấm *Tìm cơ hội từ đối thủ*. Công cụ liệt kê những website đang đặt link cho đối thủ nhưng chưa có bạn; website link cho nhiều đối thủ được xếp trước, nguồn spam được ẩn sẵn. Mở một website để:
1. Xem đối thủ được đặt link ở bài nào, anchor gì.
2. Bấm *Soạn tin bằng AI*: AI đọc bài đó, chọn trang phù hợp trên website bạn (dùng dữ liệu tab Audit) và soạn email + tin Zalo dùng thông tin ở *Autopost → Cài đặt → Biến dùng chung*.
3. Tự gửi tin, rồi cập nhật trạng thái (Đã liên hệ, Đang chờ, Đã có link…) và ghi chú. Tab **Theo dõi liên hệ** gom toàn bộ tiến độ.

**Nguyên tắc an toàn:** xin link bằng giá trị thật. Không mua link dofollow, không trao đổi link qua lại hàng loạt, không dùng hệ thống đặt link tự động. Google xếp các cách đó vào "link spam" và có thể phạt cả website. Bài PR trả phí cần gắn rel="sponsored".

## 10. Search Console & GA4

Mở tab **Search Console & GA4** (hoặc http://127.0.0.1:8686/gsc.html). Miễn phí, dữ liệu thật của chính website bạn. Không cần cài thêm thư viện.

### Kết nối (làm một lần, khoảng 15 phút)
1. Vào **console.cloud.google.com**, tạo project (ví dụ "MrVu SEO Studio").
2. *APIs & Services → Library*: bật **Google Search Console API** và **Google Analytics Data API**.
3. *IAM & Admin → Service Accounts → Create*. Mở tài khoản vừa tạo → *Keys → Add key → Create new key → JSON* → tải file về.
4. Trong công cụ, thẻ **Kết nối** → *Chọn file khóa JSON*. Công cụ hiện email dạng `...@...iam.gserviceaccount.com`, bấm *Copy email*.
5. **Search Console** → Cài đặt → Người dùng và quyền → Thêm người dùng → dán email → quyền **Hạn chế**.
6. **GA4** → Quản trị → Quản lý quyền truy cập thuộc tính → **+** → dán email → vai trò **Người xem**.
7. Quay lại công cụ: *Tải danh sách* → chọn website, nhập **GA4 Property ID** (dãy số trong GA4 → Quản trị → Cài đặt thuộc tính, không phải mã G-XXXX) → *Lưu & kiểm tra*.
8. Bấm **Đồng bộ dữ liệu**. Nên đồng bộ mỗi tuần (dữ liệu Google chậm khoảng 3 ngày).

File khóa được lưu tại `google-service-account.json` trong thư mục công cụ. **Giữ kín file này**; muốn thu hồi quyền, xóa khóa trong Google Cloud hoặc gỡ email khỏi Search Console/GA4.

### Các thẻ
- **Tổng quan**: click, hiển thị, CTR, vị trí trung bình 28 ngày so với kỳ trước; phiên và chuyển đổi từ Google (GA4); biểu đồ 4 tháng; trang tăng/giảm click; từ khóa mang nhiều click.
- **Cơ hội từ khóa**:
  - *Sắp lên top*: từ khóa vị trí 4–20 nhiều hiển thị, kèm số click ước tính có thêm. Chọn rồi bấm *Theo dõi trong Rank Tracker* hoặc *Tối ưu GEO*.
  - *CTR thấp*: trang top 10 nhưng ít người bấm. Bấm *AI viết lại title* để có 3 title + 2 meta mới.
  - *Trang tranh từ khóa*: một từ khóa có nhiều trang thay nhau xếp hạng, kèm gợi ý giữ trang nào.
  - *Bài đang tụt*: mất ≥30% click so với 3 tháng trước.
  - *Chưa có bài tốt*: từ khóa/câu hỏi Google đã hiển thị bạn nhưng ở vị trí kém. Chọn rồi *Gửi sang Autopost*.
- **Kế hoạch nội dung**: AI lập kế hoạch 6 tuần (bài mới, cập nhật, gộp/tách) từ dữ liệu thật và volume đã tra; bài mới gửi thẳng sang Autopost.
- **Thứ hạng**: so vị trí Rank Tracker (chính xác lúc quét) với vị trí trung bình Search Console; gợi ý từ khóa nên theo dõi thêm.
- **Chất lượng trang** (cần GA4): trang tương tác thấp, trang có lượt xem nhưng không ra chuyển đổi, trang chuyển đổi tốt. Cần đánh dấu *sự kiện chính* (gọi, form, Zalo) trong GA4 thì cột chuyển đổi mới có số.
- **Index**: kiểm tra trang đã được Google lập chỉ mục chưa, Google có chọn trang khác làm bản chính không (tối đa khoảng 2.000 URL/ngày). Nút *trang chưa có hiển thị* dùng danh sách trang từ tab Audit.
- **Báo cáo tư vấn**: AI đọc dữ liệu mọi tab và viết báo cáo tháng: điểm sức khỏe, điểm tốt, vấn đề, 6–10 việc ưu tiên (mỗi việc có nút mở đúng tab), mục tiêu tháng tới. Các báo cáo cũ được lưu để so sánh.

Phần AI (title, kế hoạch, báo cáo) dùng khóa Claude ở tab Autopost → Cài đặt.

## 11. Kiểm soát chi phí

Ở góc phải thanh menu mọi trang có huy hiệu **"Chi phí tháng: … / …"**. Xanh là bình thường, vàng là đã dùng nhiều, đỏ là vượt ngân sách. Bấm vào để xem chi tiêu theo từng công cụ, các lần dùng gần đây, dự kiến cả tháng, và chỉnh cài đặt.

**Trước mỗi lần dùng tốn phí** (tra volume, quét thứ hạng, phân tích GEO, AI viết bài, gợi ý AI, cập nhật/so sánh backlink, kế hoạch và báo cáo AI):
- Lần dùng **dưới ngưỡng hỏi trước** (mặc định 5.000 đ): chỉ hiện giá ước tính ở góc màn hình rồi chạy luôn.
- Lần dùng **từ ngưỡng trở lên**, hoặc có cảnh báo: hiện hộp xác nhận gồm giá ước tính, chi tiết từng khoản, thanh ngân sách trước/sau, cảnh báo và mẹo. Bấm *Tiếp tục* hoặc *Hủy*.
- Cảnh báo đỏ khi: lần này làm vượt ngân sách tháng, hoặc lớn gấp 4 lần ngưỡng hỏi trước.

**Chi phí thật** của từng lần gọi DataForSEO (theo hóa đơn API trả về) và Claude (theo số token thực tế) được ghi vào sổ, cộng dồn theo tháng.

**Cài đặt mặc định (chỉnh trong bảng chi phí):**

| Cài đặt | Mặc định |
|---|---|
| Ngân sách mỗi tháng | 300.000 đ |
| Hỏi trước khi một lần dùng từ | 5.000 đ |
| Cảnh báo khi dùng đến | 80% ngân sách |
| Tự dừng lịch Autopost khi vượt ngân sách | Bật |
| Bỏ qua từ khóa vừa quét trong | 6 ngày |
| Cảnh báo phân tích GEO trùng trong | 7 ngày |
| Cảnh báo cập nhật backlink dày hơn | 7 ngày |

**Mẹo tiết kiệm đã cài sẵn:**
1. Rank Tracker mặc định **Top 10, chỉ Google** (rẻ hơn 3–5 lần so với Top 30–50).
2. Khi quét lại, công cụ đề nghị **bỏ qua từ đã quét trong 6 ngày** (tick sẵn).
3. Khi tra volume ít từ, nhắc **gom thêm từ** vì giá tính theo lần tra (tối đa 1.000 từ), không theo số từ.
4. Cảnh báo **phân tích GEO trùng**; từ khóa không có AI Overview thì không gọi AI.
5. Cảnh báo **cập nhật backlink quá dày**, gợi ý dùng file Search Console miễn phí.
6. Viết bài dài 2.500 chữ được nhắc là tốn gấp đôi bài 1.200 chữ.
7. Mọi kết quả AI (title, báo cáo, GEO, tin xin link) đều lưu lại; xem lại không tốn phí.

**Bảng giá** (đã tra ngày 15/10/2026) nằm trong mục *Bảng giá đang dùng*. Khi nhà cung cấp đổi giá, hoặc bạn đổi model AI (ví dụ sang Claude Haiku 5.5 rẻ hơn khoảng 20 lần), hãy sửa giá ở đó để ước tính và sổ chi phí luôn đúng.

Lưu ý: giá phần AI trước khi chạy là **ước tính** (độ dài bài thực tế có thể khác). Sổ chi phí luôn ghi **số thật** sau khi chạy.

## Ghi chú

- CPC từ Google Ads tính bằng USD; công cụ đổi sang VND theo tỷ giá bạn nhập.
- Chi phí API của từng phiên hiện trong ô "chi phí API phiên này" và trong lịch sử. Một lần gọi tính cho cả lô tới 1.000 từ, nên gom đủ từ rồi tra một lần sẽ rẻ hơn tra lẻ.
- DataForSEO giới hạn 12 lần tra/phút cho mỗi tài khoản.
- Muốn dùng chung cho cả nhóm trong mạng LAN: sửa `HOST` trong `app.py` thành `"0.0.0.0"`, người khác mở `http://<IP máy bạn>:8686`. Không mở ra Internet vì công cụ không có đăng nhập.
- Sao lưu dữ liệu: copy file `kho-tu-khoa.db`, `config.json` và `google-service-account.json`.
