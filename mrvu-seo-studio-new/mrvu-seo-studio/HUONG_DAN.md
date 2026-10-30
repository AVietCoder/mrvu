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

## 6b. Bản đồ website (phân tích toàn bộ URL, lặp lại định kỳ)

Mở tab **Bản đồ website**. Mục tiêu: mỗi URL của mrvu.vn có một từ khóa và vai trò rõ ràng, được tối ưu đủ SEO, GEO, tốc độ, liên kết nội bộ đúng cấu trúc, và được theo dõi định kỳ.

**Cài đặt (một lần)**
1. Tab **Cài đặt**: nhập tên miền `mrvu.vn` và **khóa PageSpeed Insights API**. Cách tạo khóa có ngay trong trang, khoảng 2 phút, miễn phí.
2. Chọn cách đo tốc độ:
   - *Thông minh*: 40 trang quan trọng nhất + 3 trang mỗi loại; nhanh và đủ để thấy lỗi theo mẫu giao diện.
   - *Tất cả trang*.
3. Chọn website Autopost để gửi các chủ đề còn thiếu sang viết bài.
4. Bật **Tự phân tích lại mỗi 30 ngày** nếu muốn vòng lặp chạy tự động.

**Phân tích toàn website (Tổng quan → Phân tích ngay)**

Lần đầu khoảng 20.000–40.000 đ cho khoảng 500 trang. Các lần sau rẻ hơn nhiều vì chỉ gán từ khóa cho trang mới. Công cụ chạy 6 bước:
1. Quét mọi URL (sitemap, các trang có trên Google, link nội bộ), đọc tiêu đề, H1, liên kết.
2. Lấy dữ liệu Search Console và GA4 theo từng URL (từ khóa thật, click, vị trí, chuyển đổi), cộng với từ khóa đang có thứ hạng.
3. **AI gán cho mỗi URL**: từ khóa chính, từ phụ, câu hỏi AI cần trả lời, ý định, nhóm chủ đề, vai trò (trụ cột / danh mục / sản phẩm / bài viết).
4. Chấm **SEO on-page**, **cấu trúc GEO**, **tốc độ di động** (PageSpeed: LCP, TBT, CLS và dữ liệu người dùng thật), **trạng thái index**.
5. Dựng **bản đồ liên kết nội bộ** và đề xuất link cần thêm theo cấu trúc nhóm chủ đề.
6. So với lần trước, rồi AI viết **báo cáo và việc cần làm**, xếp theo tác động tới khách hàng tiềm năng.

**Các thẻ**
- **Tổng quan:**
  - số liệu tổng (trang, click, chuyển đổi, điểm SEO, tốc độ, hiện diện trên AI);
  - báo cáo AI kèm danh sách việc cần làm;
  - **biến động so với lần trước**: click giảm, tụt hạng, chậm đi, trang lỗi, trang mới…;
  - xu hướng qua các lần phân tích.
- **Trang:** bảng tất cả URL, có lọc theo loại trang, nhóm, vấn đề (cơ hội lên top, tốc độ, GEO, liên kết, trùng từ khóa…) và sắp xếp theo *giá trị khách hàng*. Bấm một trang để:
  - **sửa và chốt từ khóa**: AI sẽ không đổi từ khóa đã chốt;
  - xem từ khóa Google thật, việc cần làm, lỗi SEO/GEO, tốc độ kèm cách sửa, link nên thêm tới/từ trang, lịch sử;
  - bấm **Tư vấn trang**: AI viết title, meta, H1, đoạn trả lời cho AI, mục cần thêm, cách tăng chuyển đổi;
  - đo lại tốc độ, theo dõi thứ hạng, phân tích GEO.
- **Từ khóa:**
  - **trùng từ khóa** (2 trang tranh nhau một từ) và cách xử lý;
  - câu hỏi AI chưa có trang trả lời (gửi sang Autopost);
  - bản đồ từ khóa theo nhóm.
- **Liên kết nội bộ:**
  - danh sách link cần thêm (từ trang nào, tới trang nào, chữ neo gì, vì sao);
  - nút **AI tìm vị trí** chỉ ra câu cụ thể để gắn link;
  - đánh dấu *Đã làm / Bỏ qua*; tải CSV cho người quản trị web;
  - trang mồ côi, link hỏng, cấu trúc từng nhóm (trang nào chưa trỏ về trang trung tâm).

**Vòng lặp nên làm mỗi tháng**
1. Phân tích (tự động hoặc bấm tay).
2. Làm các việc *tác động cao* trong báo cáo, cùng các link *Cần làm*.
3. Sửa nội dung theo *Tư vấn trang* cho các trang giá trị nhất.
4. Lần phân tích sau, xem mục *Biến động* để biết việc nào đã có hiệu quả.

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

**Gợi ý chủ đề từ đối thủ** (tab Bộ từ khóa, khung trên cùng)

Dùng khung này khi chưa biết nên viết gì.
1. Chọn website, nhập **chủ đề muốn phát triển** (ví dụ `quạt trần`) và tối đa **3 tên miền đối thủ**.
2. Chọn chế độ:
   - **Đầy đủ** (khoảng 5.000–8.000 đ/lần với 1–3 đối thủ): có volume, độ khó, từ khóa đối thủ đang lên Top Google.
   - **Tiết kiệm** (khoảng 2.000 đ/lần): chỉ đọc sitemap đối thủ và Search Console, không có volume.
3. Bấm **Phân tích chủ đề**. Công cụ sẽ:
   - đọc các bài đối thủ đã đăng (qua sitemap) và nội dung website của bạn (bài đã viết, hàng chờ, Search Console, thứ hạng);
   - để AI gom các từ khóa cùng ý định thành **một bài**, chấm điểm ưu tiên 0–100, đánh dấu bài **Trụ cột** và **Vệ tinh**, gợi ý góc viết và trang sản phẩm/danh mục nên gắn link.
4. Bảng kết quả có 3 bộ lọc:
   - **Khoảng trống**: đối thủ có, bạn chưa có, nên viết.
   - **Đã có bài**: bạn đã có bài cùng ý định, để tránh viết trùng.
   - **Tất cả**.
5. Tick các chủ đề muốn viết rồi bấm **Thêm vào hàng chờ**. Hoặc bật **Tự thêm N chủ đề điểm cao nhất** trước khi phân tích: công cụ tự thêm các chủ đề từ 50 điểm, chưa có bài.
6. Chủ đề thêm từ đây mang theo **định hướng viết** (từ khóa phụ, góc viết, bài trụ cột, link cần gắn). AI sẽ bám theo khi viết; trong hàng chờ có dòng chữ xanh "Từ Gợi ý chủ đề".

Mọi lần phân tích được lưu ở **Lần phân tích trước**, mở lại miễn phí. Phân tích lại cùng chủ đề và đối thủ trong 30 ngày sẽ có cảnh báo.

**Cảnh báo lệch chủ đề:** khi bạn tự nhập từ khóa mà phần lớn không khớp nội dung hiện có của website đang chọn (ví dụ từ khóa quạt trần cho website làm mát công nghiệp), công cụ hỏi lại trước khi thêm. Phân tích chủ đề cũng nhận xét chủ đề có hợp với website không; nếu không hợp thì không tự thêm vào hàng chờ.

**Viết & đăng**
1. Tab **Bộ từ khóa**: chọn website, dán từ khóa (mỗi dòng một bài), bấm *Thêm vào hàng chờ*. Hoặc dùng *Gợi ý chủ đề* ở trên.
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

## 8b. Câu hỏi AI (được ChatGPT, Gemini, Perplexity, Google AI gợi ý)

Mở tab **Câu hỏi AI**. Mục tiêu: khi khách hỏi AI về lĩnh vực của bạn (quạt trần, quạt công nghiệp…), câu trả lời **nhắc và trích link mrvu.vn**.

**1. Cài đặt (một lần):** nhập
- tên miền và tên thương hiệu (ví dụ `Mr.Vũ, MrVu, mrvu.vn`);
- lĩnh vực, mỗi dòng một lĩnh vực;
- đối thủ, mỗi dòng `Tên | tên miền` (tên miền có thể bỏ trống);
- các AI cần kiểm tra và website Autopost nhận bài;
- tùy chọn **tự kiểm tra định kỳ** (mặc định 30 ngày).

**2. Bộ câu hỏi → Tìm câu hỏi mới** (khoảng 15.000–25.000 đ cho 3 lĩnh vực):
- **Nguồn câu hỏi:**
  - truy vấn dạng câu hỏi trong Search Console (miễn phí);
  - People Also Ask và tìm kiếm liên quan của Google;
  - gợi ý tìm kiếm dạng câu hỏi;
  - dữ liệu câu hỏi trên AI (LLM Mentions);
  - AI bổ sung câu hỏi theo từng kiểu khách (hộ gia đình, chủ nhà xưởng, kiến trúc sư, người đang so sánh giá, người gặp sự cố).
- AI gom nhóm, chấm ưu tiên và gợi ý trang trên website sẽ trả lời. Câu ưu tiên cao tự được **Theo dõi**.
- Cột *Phổ biến* gồm lượng tìm kiếm trên AI (ước tính) và lượt hiển thị Search Console.

**3. Kiểm tra AI** (khoảng 300–600 đ mỗi câu cho 4 AI):
- Công cụ hỏi thẳng **ChatGPT, Gemini, Perplexity** bằng tiếng Việt và xem **Google AI Overview**, rồi ghi lại câu trả lời có nhắc thương hiệu, có trích link website không, đối thủ nào được nhắc, nguồn nào được trích.
- Ở Bộ câu hỏi, mỗi câu có 4 ô C/G/P/O:
  - xanh đậm: trích link website;
  - xanh nhạt: có nhắc thương hiệu;
  - đỏ: không nhắc;
  - xám: chưa kiểm tra hoặc không có câu trả lời.

**4. Tư vấn tối ưu** (khoảng 1.000 đ mỗi câu): bấm *Tư vấn* ở từng câu, hoặc chọn nhiều câu rồi bấm *Tư vấn tối ưu*. AI đọc câu trả lời của các AI và trang của bạn, rồi đưa ra:
- nên **sửa trang có sẵn** hay **viết bài mới**;
- **đoạn trả lời mẫu 40–60 chữ** đặt ngay dưới heading (bấm *Copy HTML*);
- số liệu cần bổ sung, việc sửa trên trang, câu hỏi liên quan (FAQ), **schema FAQPage** (*Copy JSON-LD*);
- tín hiệu thương hiệu cần có, các website AI hay trích nên xuất hiện, đối thủ đang hơn ở đâu.

Các nút đi kèm:
- *Gửi sang Autopost* (cho bài mới): đưa câu hỏi vào hàng chờ kèm đoạn trả lời và yêu cầu số liệu.
- *Phân tích GEO trang này*.
- *Xuất bộ FAQ*: chọn nhiều câu, nhận HTML + JSON-LD để dán vào trang Hỏi đáp hoặc cuối bài.

**5. Tổng quan:** mức hiện diện trên AI (% câu trả lời có nhắc website) theo từng AI, xu hướng theo tháng, thương hiệu được nhắc (bạn và đối thủ), website AI hay trích, theo nhóm câu hỏi, kỹ thuật.
- **Kỹ thuật** (miễn phí) kiểm tra robots.txt có chặn bot AI không (OAI-SearchBot, PerplexityBot, Bingbot, Googlebot…), sitemap, schema thương hiệu ở trang chủ, llms.txt.

**6. Kế hoạch GEO:** AI lập kế hoạch 90 ngày gồm các trang trung tâm (hub), lộ trình theo tuần, việc củng cố thương hiệu, nơi nên xuất hiện và chỉ số theo dõi.

**Lưu ý quan trọng**
- Không công cụ nào **bảo đảm** AI sẽ nhắc website. Công cụ giúp biết AI đang trả lời gì và làm đúng những việc làm tăng khả năng được chọn. Hiệu quả thường thấy sau 1–3 tháng, đo bằng cách kiểm tra lại cùng bộ câu hỏi.
- Không ai có dữ liệu thật về những gì người dùng gõ vào ChatGPT. Bộ câu hỏi là tổng hợp từ dữ liệu tìm kiếm thật cộng với ước tính.
- DataForSEO có thể chưa hỗ trợ khu vực Việt Nam cho ChatGPT/Gemini và LLM Mentions. Khi đó công cụ vẫn hỏi bằng tiếng Việt với khu vực mặc định và ghi chú rõ trong kết quả.
- ChatGPT tìm kiếm dựa nhiều vào chỉ mục **Bing**: nên khai báo website trên Bing Webmaster Tools (miễn phí) và gửi sitemap.

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

**Trước mỗi lần dùng tốn phí** (tra volume, quét thứ hạng, phân tích GEO, gợi ý chủ đề, AI viết bài, gợi ý AI, cập nhật/so sánh backlink, kế hoạch và báo cáo AI):
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
| Cảnh báo phân tích gợi ý chủ đề trùng trong | 30 ngày |
| Cảnh báo kiểm tra câu trả lời AI lặp lại trong | 14 ngày |
| Cảnh báo phân tích toàn website lặp lại trong | 7 ngày |

**Mẹo tiết kiệm đã cài sẵn:**
1. Rank Tracker mặc định **Top 10, chỉ Google** (rẻ hơn 3–5 lần so với Top 30–50).
2. Khi quét lại, công cụ đề nghị **bỏ qua từ đã quét trong 6 ngày** (tick sẵn).
3. Khi tra volume ít từ, nhắc **gom thêm từ** vì giá tính theo lần tra (tối đa 1.000 từ), không theo số từ.
4. Cảnh báo **phân tích GEO trùng**; từ khóa không có AI Overview thì không gọi AI.
5. Cảnh báo **cập nhật backlink quá dày**, gợi ý dùng file Search Console miễn phí.
6. Viết bài dài 2.500 chữ được nhắc là tốn gấp đôi bài 1.200 chữ.
7. Mọi kết quả AI (title, báo cáo, GEO, tin xin link, gợi ý chủ đề) đều lưu lại; xem lại không tốn phí.
8. Gợi ý chủ đề có **Chế độ tiết kiệm** (bỏ dữ liệu volume) ngay trong hộp xác nhận chi phí.

**Bảng giá** (đã tra ngày 15/10/2026) nằm trong mục *Bảng giá đang dùng*. Khi nhà cung cấp đổi giá, hoặc bạn đổi model AI (ví dụ sang Claude Haiku 5.5 rẻ hơn khoảng 20 lần), hãy sửa giá ở đó để ước tính và sổ chi phí luôn đúng.

Lưu ý: giá phần AI trước khi chạy là **ước tính** (độ dài bài thực tế có thể khác). Sổ chi phí luôn ghi **số thật** sau khi chạy.

## Ghi chú

- CPC từ Google Ads tính bằng USD; công cụ đổi sang VND theo tỷ giá bạn nhập.
- Chi phí API của từng phiên hiện trong ô "chi phí API phiên này" và trong lịch sử. Một lần gọi tính cho cả lô tới 1.000 từ, nên gom đủ từ rồi tra một lần sẽ rẻ hơn tra lẻ.
- DataForSEO giới hạn 12 lần tra/phút cho mỗi tài khoản.
- Muốn dùng chung cho cả nhóm trong mạng LAN: sửa `HOST` trong `app.py` thành `"0.0.0.0"`, người khác mở `http://<IP máy bạn>:8686`. Không mở ra Internet vì công cụ không có đăng nhập.
- Sao lưu dữ liệu: copy file `kho-tu-khoa.db`, `config.json` và `google-service-account.json`.
