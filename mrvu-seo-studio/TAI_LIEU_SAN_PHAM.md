# Mr.Vũ SEO Studio: tài liệu sản phẩm và tích hợp

> Phiên bản tài liệu: 15/10/2026 · Dành cho người lập trình muốn tích hợp công cụ vào ứng dụng khác (ASP.NET, PHP, Node…), hoặc bảo trì và mở rộng công cụ.
> Hướng dẫn cho người dùng cuối: `HUONG_DAN.md`. Triển khai lên seo.ttv.vn: `TRIEN_KHAI.md`. Đặc tả nhận bài của Autopost: `HUONG_DAN_CUSTOM_API.md`.

---

## Mục lục

1. [Tổng quan sản phẩm](#1-tổng-quan-sản-phẩm)
2. [Tính năng theo từng tab](#2-tính-năng-theo-từng-tab)
3. [Kiến trúc và sơ đồ thư mục](#3-kiến-trúc-và-sơ-đồ-thư-mục)
4. [Chạy công cụ](#4-chạy-công-cụ)
5. [Cấu hình `config.json`](#5-cấu-hình-configjson)
6. [Cơ sở dữ liệu SQLite](#6-cơ-sở-dữ-liệu-sqlite)
7. [Tham chiếu HTTP API](#7-tham-chiếu-http-api)
8. [Dịch vụ bên ngoài và đơn giá](#8-dịch-vụ-bên-ngoài-và-đơn-giá)
9. [Hệ thống kiểm soát chi phí](#9-hệ-thống-kiểm-soát-chi-phí)
10. [Đăng nhập Google (OAuth)](#10-đăng-nhập-google-oauth)
11. [Quy ước giao diện (frontend)](#11-quy-ước-giao-diện-frontend)
12. [Các cách tích hợp vào ứng dụng của bạn](#12-các-cách-tích-hợp-vào-ứng-dụng-của-bạn)
13. [Triển khai và vận hành](#13-triển-khai-và-vận-hành)
14. [Bảo mật](#14-bảo-mật)
15. [Giới hạn đã biết và hướng mở rộng](#15-giới-hạn-đã-biết-và-hướng-mở-rộng)

---

## 1. Tổng quan sản phẩm

**Mr.Vũ SEO Studio** là bộ công cụ SEO nội bộ cho website mrvu.vn (và các website khác của chủ sở hữu), tập trung vào **Google** tại thị trường Việt Nam. Công cụ gồm 7 tab:

| # | Tab | Trang | Mục đích |
|---|---|---|---|
| 1 | Tra cứu Volume | `/` (`index.html`) | Tra lượng tìm kiếm, CPC, cạnh tranh, xu hướng 12 tháng cho tối đa 1.000 từ khóa/lần |
| 2 | Rank Tracker | `/rank` | Theo dõi thứ hạng Google của từ khóa theo tên miền, lưu lịch sử |
| 3 | Audit On-page | `/audit` | Quét toàn bộ website, chấm điểm khoảng 30 tiêu chí cho từng URL, kèm cách sửa và gợi ý AI |
| 4 | Autopost | `/autopost` | AI viết bài chuẩn SEO, chèn ảnh, đăng lên WordPress hoặc website riêng (Custom API), có lịch tự động |
| 5 | AI Overview (GEO) | `/geo` | Phân tích trang có được Google AI Overview trích dẫn không và cách tối ưu |
| 6 | Backlink | `/backlinks` | Theo dõi backlink (mới/mất), tìm cơ hội từ đối thủ, AI soạn thư xin link |
| 7 | Search Console | `/gsc` | Kết nối Google Search Console và GA4: tổng quan, cơ hội từ khóa, kế hoạch nội dung, thứ hạng, chất lượng trang, kiểm tra index, báo cáo tư vấn AI |

Các tính năng dùng chung:
- **Ước tính chi phí trước mỗi thao tác tốn tiền**, ngân sách tháng, cảnh báo và mặc định tiết kiệm.
- **Đăng nhập bằng tài khoản Google**, chỉ email nằm trong danh sách cho phép mới vào được.
- **Chế độ dữ liệu mẫu (demo)**: khi giao diện không gọi được máy chủ, mọi trang vẫn chạy với dữ liệu giả để xem thử.

Nguyên tắc thiết kế:
- **Không cần cài thư viện.** Máy chủ chỉ dùng thư viện chuẩn của Python 3 (kể cả phần ký JWT RS256 cho Google).
- **Một tệp CSDL SQLite** (`kho-tu-khoa.db`) và một tệp cấu hình (`config.json`).
- **Giao diện là HTML tĩnh** (CSS/JS viết sẵn trong từng trang, không framework, không bước build).
- **Mọi thông báo bằng tiếng Việt**, kể cả lỗi từ API bên ngoài.
- **Chỉ làm SEO "mũ trắng".** Công cụ không trao đổi link tự động hay mua link dofollow; link PR trả phí phải gắn `rel="sponsored"`.

---

## 2. Tính năng theo từng tab

### 2.1 Tra cứu Volume
- **Nhập liệu:** dán danh sách từ khóa, mỗi dòng một từ. Công cụ chuẩn hóa (viết thường, gộp khoảng trắng), bỏ trùng và tách các từ không hợp lệ ra (trả về trong `skipped`).
- **Dữ liệu trả về:** gọi DataForSEO *Google Ads Search Volume Live*; mỗi lần gọi tối đa 1.000 từ và tốn 1 task (khoảng $0,09). Mỗi từ có volume, CPC, mức cạnh tranh (`comp`, `compIndex`) và 12 tháng (`months`).
- **Lọc và xuất:** lọc theo volume, CPC, độ dài từ; xuất CSV.
- **Lịch sử:** mỗi lần tra được lưu thành một phiên (bảng `sessions`) để mở lại miễn phí.
- **Khu vực mặc định:** `location_code` 2704 (Việt Nam), `language_code` `vi`.

### 2.2 Rank Tracker (chỉ Google)
- **Thêm từ khóa:** nhập theo tên miền (bảng `tracked`, không trùng theo `domain + keyword + location`).
- **Quét thứ hạng:** dùng DataForSEO *SERP Google Organic Live Regular* với độ sâu 10–100. Mỗi trang 10 kết quả tốn $0,002; mặc định chỉ quét Top 10 để rẻ nhất. Mỗi lần quét tối đa 50 từ, chạy song song 6 luồng.
- **Kết quả:** khớp tên miền cả với tên miền con. Lưu vị trí, URL xếp hạng và chi phí vào bảng `ranks`, kèm biểu đồ lịch sử.
- **Tiết kiệm:** mặc định bỏ qua các từ đã quét trong `rank_recent_days` (6) ngày gần đây.

### 2.3 Audit On-page
1. **Quét website (crawl):** đọc `robots.txt` và sitemap (kể cả sitemap index). Nếu website không có sitemap thì bò theo liên kết nội bộ (BFS). Giới hạn 10–5.000 trang, mặc định 1.000. User-Agent `MrVuSEOStudio/1.0`.
2. **Phân loại trang:** trang chủ, danh mục, sản phẩm, bài viết, trang tĩnh…
3. **Audit từng URL:** khoảng 30 tiêu chí, gồm:
   - title, meta description, H1/H2, độ dài nội dung, từ khóa;
   - ảnh và thuộc tính alt, link nội bộ/ngoài, link hỏng;
   - canonical, robots/noindex, Open Graph;
   - schema JSON-LD (đề xuất schema mẫu theo loại trang);
   - tốc độ phản hồi, HTTPS;
   - trùng title với trang khác cùng website.

   Mỗi lỗi có **hướng dẫn sửa bằng tiếng Việt**; trang được chấm điểm 0–100.
4. **Gợi ý AI** (tốn phí Claude): viết lại title, meta và đoạn mở bài, đề xuất thêm mục và FAQ.

### 2.4 Autopost
- **Website đích:** quản lý nhiều website, mỗi website thuộc một trong hai loại:
  - `wordpress`: dùng REST API và Application Password. Tự tải ảnh lên Media, tạo tag, ghi meta cho Yoast hoặc RankMath (cần plugin nhỏ trong `wordpress-plugin/`).
  - `custom`: gửi JSON POST kèm Bearer token tới endpoint của bạn. Đặc tả ở `HUONG_DAN_CUSTOM_API.md`, có ví dụ C#.
- **Hàng đợi từ khóa** (`ap_keywords`): trạng thái `pending`, `writing`, `written`, `published`, `error`.
- **Quy trình viết:**
  1. AI lập dàn ý.
  2. AI viết bài HTML (không có H1; H1 là `title`).
  3. Làm sạch HTML (chỉ giữ thẻ an toàn).
  4. Chèn **link nội bộ có thật**, chỉ lấy từ trang đã quét ở tab Audit hoặc bài đã đăng.
  5. Chèn ảnh từ thư viện `anh-thu-vien/` (lấy theo tên file khớp từ khóa) hoặc từ Pexels.
- **Biến dùng chung** (`ap_variables`): ví dụ hotline, tên thương hiệu. Chèn vào prompt và nội dung qua `{{ten_bien}}`.
- **Lịch tự động:** theo từng website, gồm số bài/ngày và khung giờ, các bài cách đều nhau (tối thiểu 20 phút). Luồng nền kiểm tra mỗi phút. **Tự dừng khi vượt ngân sách tháng** nếu bật `auto_stop`.
- **Trước khi đăng:** sửa bài (title, meta, slug, HTML), đăng lại, xem nhật ký.

### 2.5 AI Overview (GEO)
- **Đầu vào:** URL trang và từ khóa mục tiêu.
- **Dữ liệu Google:** SERP Advanced, có tải AI Overview bất đồng bộ và mở rộng People Also Ask.
  - Lấy nội dung AI Overview và các nguồn được trích dẫn.
  - Lấy PAA và các tìm kiếm liên quan.
- **Đọc trang** và kiểm tra cấu trúc: định nghĩa ngắn đầu bài, H2 dạng câu hỏi, danh sách, bảng, FAQ schema, tác giả, ngày cập nhật, noindex…
- **Điểm 0–100:** được trích dẫn (30) + mức bao phủ các ý của AI Overview (40) + cấu trúc (30). Trang bị noindex bị giới hạn tối đa 10 điểm.
- **AI phân tích** (Claude): các ý còn thiếu, đoạn văn mẫu để được trích dẫn, danh sách việc cần làm.
- **Liên kết từ tab khác:** mở được bằng `geo.html?url=…&kw=…`.

### 2.6 Backlink
- **Nguồn dữ liệu:**
  - DataForSEO Backlinks API (cần nạp tối thiểu $100/tháng cho gói Backlinks).
  - **Miễn phí:** nhập file CSV "Liên kết" xuất từ Search Console.
- **Theo dõi:** mỗi lần cập nhật là một ảnh chụp (`bl_snapshots`); so sánh để phát hiện domain mới và link bị mất.
- **Cơ hội từ đối thủ (gap):** những domain trỏ link về đối thủ nhưng chưa trỏ về bạn, phân nhóm (báo, diễn đàn, danh bạ, blog…).
- **Quản lý từng cơ hội:** trạng thái `new`, `contacted`, `waiting`, `won`, `rejected`, `skip`, kèm ghi chú.
- **Hỗ trợ xin link:** xem link mẫu của đối thủ; AI soạn thư xin link (outreach).

### 2.7 Search Console và GA4
- **Kết nối:** service account (tệp JSON). Thêm email của service account vào Search Console (quyền *Restricted* là đủ) và GA4 (*Viewer*).
- **Đồng bộ dữ liệu:** 3 kỳ 28 ngày (`cur`, `prev`, `old`), kết thúc ở ngày hôm nay trừ 3 vì Search Console có độ trễ. Lưu theo truy vấn+trang, theo trang, theo ngày; GA4 chỉ lấy kênh *Organic Search*.
- **Các phân tích:**
  - Tổng quan: click, hiển thị, CTR, vị trí; so kỳ trước; phiên và chuyển đổi từ GA4.
  - Cơ hội từ khóa:
    - `striking`: vị trí 4–20, nhiều hiển thị.
    - `lowctr`: CTR thấp so với vị trí.
    - `cannibal`: nhiều URL cùng tranh một truy vấn.
    - `decay`: đang giảm click.
    - `gaps`: truy vấn có hiển thị nhưng chưa có trang riêng.
  - **AI viết lại title/meta** cho từng trang.
  - **AI lập kế hoạch nội dung** (cụm chủ đề, bài cần viết, bài cần cập nhật).
  - Thứ hạng: gộp dữ liệu Search Console với Rank Tracker.
  - Chất lượng trang: kết hợp GSC, GA4 và điểm Audit.
  - Kiểm tra index qua URL Inspection API (tối đa 200 URL/lần; Google giới hạn khoảng 2.000 URL/ngày).
- **Báo cáo tư vấn AI tổng thể:** gom dữ liệu GSC, GA4, Rank, Audit và Backlink thành một báo cáo, lưu lịch sử.
- **Gửi sang tab khác:** đưa từ khóa sang Rank Tracker hoặc hàng đợi Autopost bằng một nút bấm.

---

## 3. Kiến trúc và sơ đồ thư mục

```
Trình duyệt (7 trang HTML + costguard.js)
        │  fetch('api/...')  (đường dẫn tương đối, cookie phiên)
        ▼
app.py  ── ThreadingHTTPServer (127.0.0.1:8686)
   ├─ /auth/*        → auth.py      (đăng nhập Google, phiên)
   ├─ auth.guard()   → chặn mọi trang/API nếu chưa đăng nhập (khi đã bật)
   ├─ /api/volume, /api/history*, /api/rank/*, /api/audit/*  (xử lý ngay trong app.py, audit dùng audit.py)
   ├─ /api/ap/*      → autopost.py  (+ luồng lịch tự động)
   ├─ /api/geo/*     → geo.py
   ├─ /api/bl/*      → backlinks.py
   ├─ /api/gsc/*     → gsc.py
   └─ /api/cost/*    → costs.py
        │
        ├─ SQLite: kho-tu-khoa.db
        ├─ config.json
        └─ Dịch vụ ngoài: DataForSEO · Anthropic (Claude) · Google (OAuth, Search Console, GA4) · Pexels · WordPress/Custom API
```

### Sơ đồ tệp

| Tệp | Vai trò |
|---|---|
| `app.py` | Máy chủ chính: đọc cấu hình, khởi tạo CSDL, định tuyến, xử lý Volume, Rank và Audit. Định nghĩa `dfs_post()`, nơi duy nhất gọi DataForSEO (tự ghi chi phí). Ngoài ra chép dữ liệu từ thư mục cũ `kho-tu-khoa` nếu có. |
| `auth.py` | Đăng nhập Google OpenID Connect, phiên cookie, danh sách email được phép, trang đăng nhập. |
| `costs.py` | Sổ chi phí (`spend`), bảng giá, ngân sách, hàm `estimate()` ước tính trước khi chạy, tổng hợp theo tháng. |
| `audit.py` | Crawler (robots, sitemap, BFS), bộ phân tích HTML, khoảng 30 kiểm tra on-page, tạo schema mẫu, gợi ý AI. |
| `autopost.py` | Hàm `claude()` (nơi duy nhất gọi Claude, tự ghi chi phí), viết bài, ảnh, đăng WordPress/Custom, lịch tự động. |
| `geo.py` | Lấy SERP và AI Overview, đọc trang, kiểm tra cấu trúc, chấm điểm, AI phân tích. |
| `backlinks.py` | Backlinks API, nhập CSV, phát hiện mới/mất, gap đối thủ, link mẫu, AI outreach. |
| `gsc.py` | Ký JWT RS256 (Python thuần), gọi Search Console và GA4, đồng bộ, phân tích, URL Inspection, AI title/kế hoạch/báo cáo. |
| `costguard.js` | Thư viện giao diện dùng chung: hộp ước tính chi phí, ô ngân sách trên menu, bảng cài đặt chi phí, chip người dùng và Đăng xuất, xử lý hết phiên. |
| `index.html`, `rank.html`, `audit.html`, `autopost.html`, `geo.html`, `backlinks.html`, `gsc.html` | 7 trang giao diện. |
| `deploy/cai-dat.sh` | Script cài đặt lên VPS Ubuntu (nginx, HTTPS, systemd, sao lưu). |
| `deploy/mrvu-seo-studio.service` | Dịch vụ systemd. |
| `deploy/nginx-seo.ttv.vn.conf` | Cấu hình reverse proxy nginx. |
| `wordpress-plugin/mrvu-seo-studio-seo-meta.php` | Plugin WordPress cho phép REST API ghi meta Yoast/RankMath. |
| `MO_CONG_CU.bat` | Mở công cụ trên Windows (bấm đúp). |
| `HUONG_DAN.md`, `HUONG_DAN_CUSTOM_API.md`, `TRIEN_KHAI.md`, `TAI_LIEU_SAN_PHAM.md` | Tài liệu. |

Các tệp **sinh ra khi chạy** (không có trong gói zip, phải sao lưu):

| Tệp/thư mục | Nội dung |
|---|---|
| `kho-tu-khoa.db` | Toàn bộ dữ liệu (tên tệp giữ nguyên từ bản đầu để không mất dữ liệu cũ) |
| `config.json` | Khóa API, cấu hình (bí mật) |
| `google-service-account.json` | Khóa service account Google (bí mật) |
| `anh-thu-vien/` | Thư viện ảnh của bạn cho Autopost |

### Cách các module được nối với nhau
`app.main()` gọi `setup()` của từng module theo thứ tự và truyền vào các hàm dùng chung (tiêm phụ thuộc, không import vòng):

```python
costs.setup(db, _db_lock, load_config, autopost.save_config)
auth.setup(db, _db_lock, load_config)
autopost.setup(db, _db_lock, load_config, CONFIG_PATH, BASE)          # khởi động luồng lịch
geo.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
backlinks.setup(db, _db_lock, load_config, dfs_post, autopost.claude)
gsc.setup(db, _db_lock, load_config, autopost.claude, autopost.save_config, BASE)
```

Mỗi module có hàm `handle(h, method, path)`. Trong đó `h` là đối tượng request của `http.server`, có thêm hai hàm `h.read_json()` và `h.send_json(obj, code=200)`.

---

## 4. Chạy công cụ

Yêu cầu: **Python 3.9 trở lên**, không cần `pip install`.

| Cách chạy | Lệnh | Ghi chú |
|---|---|---|
| Máy cá nhân | `python app.py` hoặc bấm đúp `MO_CONG_CU.bat` | Nghe `127.0.0.1:8686`, tự mở trình duyệt; không cần đăng nhập nếu chưa cấu hình Google |
| Không mở trình duyệt | `python app.py --no-browser` | |
| Máy chủ | `python app.py --server` | Dùng `bind_host`/`port` trong config. **Từ chối chạy** nếu chưa cấu hình đủ đăng nhập Google |
| Đổi cổng | biến môi trường `PORT=9000` hoặc `"port"` trong config | |

Biến môi trường `DATAFORSEO_LOGIN` và `DATAFORSEO_PASSWORD` (nếu có) ghi đè giá trị trong config.

Công cụ **không bao giờ mở ra mạng ngoài khi chưa bật đăng nhập**: nếu `bind_host` không phải `127.0.0.1`/`localhost`/`::1` mà chưa có cấu hình đăng nhập, công cụ tự chuyển về `127.0.0.1`.

---

## 5. Cấu hình `config.json`

Lần chạy đầu, công cụ tự tạo tệp mẫu. Toàn bộ các khóa:

| Khóa | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `login`, `password` | string | `""` | Tài khoản API DataForSEO |
| `usd_vnd` | number | `26000` | Tỷ giá quy đổi chi phí |
| `anthropic_api_key` | string | `""` | Khóa API Claude |
| `anthropic_model` | string | `claude-sonnet-5-5` | Mô hình AI |
| `pexels_api_key` | string | `""` | Khóa Pexels (ảnh miễn phí cho Autopost) |
| `ap_variables` | array `[{name, value}]` | `[]` | Biến dùng trong prompt/bài viết |
| `gsc_site` | string | | Thuộc tính Search Console, ví dụ `sc-domain:mrvu.vn` hoặc `https://mrvu.vn/` |
| `ga_property` | string (số) | | Mã thuộc tính GA4, ví dụ `412345678` |
| `cost_budget` | object | xem §9 | Ngân sách và ngưỡng cảnh báo |
| `cost_prices` | object | xem §8 | Đơn giá (sửa được khi nhà cung cấp đổi giá) |
| `google_client_id`, `google_client_secret` | string | | OAuth client cho đăng nhập |
| `public_url` | string | | Ví dụ `https://seo.ttv.vn` (không có `/` cuối) |
| `allowed_emails` | array string | | Email được phép vào (không phân biệt hoa thường) |
| `bind_host` | string | `127.0.0.1` | Địa chỉ nghe ở chế độ `--server` |
| `port` | number | `8686` | Cổng |

Ví dụ đầy đủ:

```json
{
  "login": "email@dataforseo", "password": "api-password", "usd_vnd": 26000,
  "anthropic_api_key": "sk-ant-...", "anthropic_model": "claude-sonnet-5-5",
  "pexels_api_key": "", "ap_variables": [{"name": "hotline", "value": "0900 000 000"}],
  "gsc_site": "sc-domain:mrvu.vn", "ga_property": "412345678",
  "cost_budget": {"budget_month_vnd": 300000, "confirm_over_vnd": 5000, "warn_pct": 80, "auto_stop": true,
                  "rank_recent_days": 6, "geo_recent_days": 7, "bl_recent_days": 7},
  "google_client_id": "xxx.apps.googleusercontent.com", "google_client_secret": "GOCSPX-...",
  "public_url": "https://seo.ttv.vn", "allowed_emails": ["vuviet.thd@gmail.com"],
  "bind_host": "127.0.0.1", "port": 8686
}
```

Cấu hình được **đọc lại ở mỗi request**, nên sửa `allowed_emails`, ngân sách, khóa API… có hiệu lực ngay mà không cần khởi động lại. Riêng `bind_host` và `port` cần khởi động lại.

---

## 6. Cơ sở dữ liệu SQLite

Tệp `kho-tu-khoa.db`. Bảng được tạo tự động (`CREATE TABLE IF NOT EXISTS`). Thời gian lưu dạng chuỗi ISO 8601; riêng `auth_sessions` lưu Unix timestamp. Các cột `*_json` chứa JSON dạng văn bản.

### Volume
| Bảng | Cột |
|---|---|
| `sessions` | `id` TEXT PK, `created_at`, `location`, `language`, `count` INT, `total_volume` INT, `cost` REAL, `rows_json` (mảng `{keyword, volume, cpc, comp, compIndex, months[]}`) |

### Rank Tracker
| Bảng | Cột |
|---|---|
| `tracked` | `id` PK, `domain`, `keyword`, `location`, `language`, `created_at`, UNIQUE(`domain`,`keyword`,`location`) |
| `ranks` | `id` PK, `tracked_id`, `engine` (`google`), `checked_at`, `position` (NULL = ngoài độ sâu quét), `url`, `depth`, `cost` |

### Audit
| Bảng | Cột |
|---|---|
| `audit_sites` | `id` PK, `domain` UNIQUE, `start_url`, `crawled_at`, `method` (`sitemap`/`crawl`), `count` |
| `audit_pages` | `id` PK, `site_id`, `url`, `type`, `source`, UNIQUE(`site_id`,`url`) |
| `audit_results` | `id` PK, `page_id`, `audited_at`, `score`, `keyword`, `report_json`, `ai_json` |

### Đăng nhập
| Bảng | Cột |
|---|---|
| `auth_sessions` | `token_hash` PK (sha256 của token cookie), `email`, `name`, `picture`, `created`, `expires`, `ua` |

### Autopost
| Bảng | Cột |
|---|---|
| `ap_sites` | `id`, `name`, `kind` (`wordpress`/`custom`), `url`, `username`, `secret`, `category_id`, `category_name`, `post_status` (`draft`/`publish`), `seo_plugin` (`none`/`yoast`/`rankmath`), `image_mode` (`none`/`library`/`pexels`), `images_per_post`, `word_target`, `extra_prompt`, `auto_enabled`, `per_day`, `hour_from`, `hour_to`, `created_at` |
| `ap_keywords` | `id`, `site_id`, `keyword`, `status`, `post_id`, `error`, `created_at`, `updated_at`, UNIQUE(`site_id`,`keyword`) |
| `ap_posts` | `id`, `site_id`, `keyword_id`, `keyword`, `title`, `slug`, `meta_title`, `meta_description`, `excerpt`, `tags_json`, `html`, `images_json`, `status`, `remote_id`, `remote_url`, `remote_status`, `usage_json`, `created_at`, `published_at` |
| `ap_logs` | `id`, `at`, `site_id`, `level` (`info`/`warn`/`error`), `message` |

### GEO
| Bảng | Cột |
|---|---|
| `geo_checks` | `id`, `created_at`, `url`, `keyword`, `location`, `score`, `has_aio`, `cited`, `report_json` |

### Backlink
| Bảng | Cột |
|---|---|
| `bl_sites` | `id`, `domain` UNIQUE, `competitors_json`, `gap_json`, `gap_at`, `created_at` |
| `bl_snapshots` | `id`, `site_id`, `at`, `source` (`api` = Backlinks API, `gsc` = CSV Search Console), `summary_json`, `domains_json`, `links_json`, `lost_json`, `cost` |
| `bl_opps` | `site_id`, `domain`, `status`, `note`, `examples_json`, `draft_json`, `updated_at`, PK(`site_id`,`domain`) |

### Search Console và GA4
| Bảng | Cột |
|---|---|
| `gsc_rows` | `period` (`cur`/`prev`/`old`), `query`, `page`, `clicks`, `impressions`, `ctr`, `position` |
| `gsc_pages` | `period`, `page`, `clicks`, `impressions`, `ctr`, `position` |
| `gsc_daily` | `date` PK, `clicks`, `impressions`, `ctr`, `position` |
| `ga_pages` | `period`, `path`, `sessions`, `engaged`, `engagement_rate`, `key_events`, `avg_duration` |
| `ga_daily` | `date` PK, `sessions`, `key_events` |
| `gsc_inspect` | `url` PK, `at`, `verdict`, `coverage`, `indexing`, `robots`, `fetch`, `google_canonical`, `user_canonical`, `last_crawl`, `mobile` |
| `gsc_ai` | `id`, `kind` (`title`/`plan`/`report`), `ref`, `at`, `data_json` |
| `gsc_meta` | `key` PK, `value` (ví dụ `last_sync`, các mốc thời gian kỳ dữ liệu) |

### Chi phí
| Bảng | Cột |
|---|---|
| `spend` | `id`, `at`, `month` (`YYYY-MM`), `module`, `action`, `usd`, `detail` |

Bạn có thể đọc CSDL trực tiếp từ ứng dụng khác (ví dụ báo cáo trong ASP.NET qua `System.Data.SQLite`), nhưng **chỉ nên đọc**. Mọi thao tác ghi nên đi qua HTTP API để giữ đúng logic và khóa ghi.

---

## 7. Tham chiếu HTTP API

### 7.1 Quy ước chung
- **Gốc:** `http://127.0.0.1:8686` (máy cá nhân) hoặc `https://seo.ttv.vn` (máy chủ).
- **Định dạng:** request và response là JSON UTF-8. POST gửi `Content-Type: application/json`.
- **Lỗi:** HTTP `4xx/5xx` kèm `{"error": "thông báo tiếng Việt"}`.
  - `400`: dữ liệu sai.
  - `401`: chưa đăng nhập, kèm `"login": true`.
  - `404`: không tìm thấy.
  - `409`: đang chạy trùng.
  - `502`: lỗi từ dịch vụ ngoài, ví dụ `DataForSEO (40200): ...` hoặc `Claude API lỗi 429: ...`.
- **Xác thực:** khi đã bật đăng nhập, mọi `/api/*` cần cookie `mvs_session` (xem §10 và §12).
- **Tác vụ dài (job):** các thao tác lâu trả về ngay `{"job_id": "a1b2c3d4e5"}`. Client gọi `GET .../job/<id>` khoảng 1–2 giây một lần cho đến khi `status` khác `running`:

```json
{"status": "running", "message": "Đang viết bài…"}
{"status": "done", "message": "Xong", "result": { ... }}
{"status": "error", "message": "Mô tả lỗi"}
```

  Job lưu trong bộ nhớ và **mất khi khởi động lại** máy chủ; kết quả quan trọng đã được lưu vào CSDL. Riêng job crawl của Audit không có `result` mà có `found` và `site_id`.
- **Tham số địa lý dùng chung:** `location_code` (mặc định `2704` = Việt Nam), `language_code` (mặc định `vi`).

### 7.2 Hệ thống
| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/health` | `{ok, configured (đã có DataForSEO), usd_vnd, ai (đã có khóa Claude)}` |

### 7.3 Volume
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| POST | `/api/volume` | `{keywords: [..], location_code?, language_code?}` (tối đa 1.000) | `{id, created_at, location, language, count, total_volume, cost, rows: [{keyword, volume, cpc, comp, compIndex, months:[{year,month,volume}]}], skipped: [..]}` |
| GET | `/api/history` | | `{items: [{id, created_at, location, count, total_volume, cost}]}` (200 gần nhất) |
| GET | `/api/history/<id>` | | Phiên đầy đủ kèm `rows` |
| DELETE | `/api/history/<id>` | | `{ok}` |

### 7.4 Rank Tracker
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| GET | `/api/rank/sites` | | `{items: [{domain, n}]}` |
| GET | `/api/rank/list?domain=mrvu.vn` | | `{items: [...]}`: mỗi từ có `id, keyword, location`, vị trí và URL mới nhất, vị trí lần trước, thời điểm kiểm tra |
| GET | `/api/rank/history/<tracked_id>` | | `{items: [{engine, checked_at, position, url}]}` |
| POST | `/api/rank/add` | `{domain, keywords: [..], location_code?, language_code?}` | `{added, domain, items}` |
| POST | `/api/rank/check` | `{ids: [..] (≤50), depth: 10–100}` | `{items, cost, errors: [..]}` (chạy đồng bộ, có thể mất 10–60 giây) |
| DELETE | `/api/rank/tracked/<id>` | | `{ok}` (xóa cả lịch sử) |

### 7.5 Audit On-page
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| POST | `/api/audit/crawl` | `{url, max_pages?: 10–5000}` | `{job_id}` |
| GET | `/api/audit/job/<id>` | | `{status, message, found, site_id?}` |
| GET | `/api/audit/sites` | | `{items: [audit_sites]}` |
| GET | `/api/audit/pages?site_id=` | | `{site, items: [{id, url, type, source, score, audited_at}]}` |
| POST | `/api/audit/run` | `{page_id, keyword?, check_links?: true}` | Báo cáo: `{score, page_type, keyword, extract{title,…}, checks:[{id, label, status, detail, fix}], schema…, page_id, result_id, audited_at}` |
| GET | `/api/audit/report/<page_id>` | | Báo cáo mới nhất kèm `ai` (404 nếu chưa audit) |
| POST | `/api/audit/ai` | `{page_id}` | Gợi ý AI (JSON), đồng thời lưu vào `audit_results.ai_json` |

### 7.6 Autopost (`/api/ap/`)
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| GET | `sites` | | `{items}`: website, `secret` đã che, kèm `pending` và `published` |
| POST | `sites` | Các trường `SITE_FIELDS` (xem bảng `ap_sites`); có `id` thì là sửa. Gửi `secret` rỗng hoặc chuỗi đã che thì giữ mã cũ | Website vừa lưu (`secret` đã che) |
| POST | `sites/<id>/test` | (tùy chọn) các trường để thử trước khi lưu | WordPress: `{user, roles, categories…}`; Custom: `{user: "Custom API", categories: []}` |
| DELETE | `sites/<id>` | | `{ok}` |
| GET | `keywords?site_id=` | | `{items}` |
| POST | `keywords` | `{site_id, keywords: [..]}` | `{added}` |
| POST | `keywords/<id>/reset` | | Đưa về `pending` |
| DELETE | `keywords/<id>` | | `{ok}` |
| POST | `write` | `{keyword_id, publish: bool}` | `{job_id}` (409 nếu từ đang được viết) |
| GET | `job/<id>` | | Job; `result` có `post_id` (và `url` khi đã đăng) |
| GET | `posts?site_id=` | | `{items}` (300 gần nhất) |
| GET | `posts/<id>` | | Bài đầy đủ: `html, tags, extra, usage…` |
| POST | `posts/<id>` | `{title, meta_title, meta_description, slug, html}` | `{ok}` (HTML được làm sạch lại) |
| POST | `posts/<id>/publish` | | `{job_id}` |
| DELETE | `posts/<id>` | | `{ok}` (từ khóa trở về `pending` nếu bài chưa đăng) |
| GET | `settings` | | `{anthropic_api_key (che), anthropic_model, pexels_api_key (che), ap_variables, library_count, library_path}` |
| POST | `settings` | `{anthropic_api_key?, anthropic_model?, pexels_api_key?, ap_variables}` | `{ok}` |
| GET | `logs` | | `{items}` (300 gần nhất) |

**Gói tin Custom API** mà công cụ gửi tới website của bạn: `{title, slug, content_html, excerpt, meta_title, meta_description, keyword, tags[], status, category, images:[{filename, mime, alt, credit, base64}]}` kèm header `Authorization: Bearer <secret>`. Website trả `200/201 {id, url}`. Khi kiểm tra kết nối, công cụ gửi `{"test": true}`. Chi tiết và ví dụ C# ở `HUONG_DAN_CUSTOM_API.md`.

### 7.7 AI Overview (`/api/geo/`)
| Method | Đường dẫn | Body | Trả về |
|---|---|---|---|
| POST | `analyze` | `{url, keyword, location_code?, language_code?}` | `{job_id}` |
| GET | `job/<id>` | | `result`: báo cáo `{id, score, has_aio, cited, aio{text, references[]}, paa[], related[], page{…}, structure[…], coverage, ai{…}}` |
| GET | `history` | | `{items: [{id, created_at, url, keyword, score, has_aio, cited}]}` |
| GET | `report/<id>` | | Báo cáo đã lưu |
| DELETE | `report/<id>` | | `{ok}` |

### 7.8 Backlink (`/api/bl/`)
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| GET | `sites` | | `{items}` |
| POST | `sites` | `{id?, domain, competitors: [..≤10]}` | `{ok, id}` |
| DELETE | `sites/<id>` | | `{ok}` |
| GET | `overview?site_id=` | | Tổng số liên kết và domain, các domain mới/mất, lịch sử snapshot |
| POST | `refresh` | `{site_id}` | `{job_id}` (Backlinks API, tốn phí) |
| POST | `import` | `{site_id, text: "<nội dung CSV Search Console>"}` | Kết quả nhập (miễn phí) |
| POST | `gap` | `{site_id}` | `{job_id}` |
| GET | `gap?site_id=` | | `{items: [{domain, category, links_to:[đối thủ], rank, status, note, has_ex, has_draft}], at, competitors}` |
| POST | `examples` | `{site_id, domain}` | `{items}`: link mẫu của đối thủ trên domain đó |
| POST | `outreach` | `{site_id, domain}` | Thư AI `{subject, body, …}` |
| GET | `opp?site_id=&domain=` | | `{status, note, examples, draft}` |
| POST | `opp` | `{site_id, domain, status?, note?}` | `{ok}` |

### 7.9 Search Console và GA4 (`/api/gsc/`)
| Method | Đường dẫn | Body / Query | Trả về |
|---|---|---|---|
| GET | `status` | | `{key, client_email, site, ga_property, last_sync, ai}` |
| POST | `key` | `{text: "<nội dung JSON service account>"}` | `{client_email}` |
| GET | `sites` | | `{items: [{site, permission}]}` |
| POST | `config` | `{site, ga_property}` | `{ok}` |
| POST | `test` | | `{gsc:{ok,message}, ga?:{ok,message}}` |
| POST | `sync` | | `{job_id}` (miễn phí, thường mất 30 giây đến 3 phút) |
| GET | `job/<id>` | | Job |
| GET | `overview` | | Chỉ số kỳ này và kỳ trước, chuỗi theo ngày, top truy vấn và trang, GA4 |
| GET | `opps?kind=striking\|lowctr\|cannibal\|decay\|gaps&min=` | | `{items}` |
| POST | `ai-title` | `{page}` | `{title, meta_description, reason…}` |
| GET | `ai-title?page=` | | Kết quả đã lưu |
| POST | `plan` | | `{job_id}` (AI lập kế hoạch nội dung) |
| GET | `plan` | | Kế hoạch mới nhất |
| GET | `ranks` | | Thứ hạng gộp GSC và Rank Tracker |
| GET | `quality` | | Chất lượng trang (GSC, GA4, Audit) |
| POST | `inspect` | `{urls?: [..≤200]}` hoặc `{mode: "top"\|"zero", limit?}` | `{job_id}` |
| GET | `inspect` | | `{items: [gsc_inspect], zero_count}` |
| POST | `report` | | `{job_id}` (báo cáo tư vấn AI) |
| GET | `reports` | | `{items: [{id, at, headline, health}]}` |
| GET | `report/<id>` | | Báo cáo đầy đủ |
| POST | `send-rank` | `{keywords: [..]}` | Thêm vào Rank Tracker |
| POST | `send-autopost` | `{site_id, keywords: [..]}` | Thêm vào hàng đợi Autopost |

### 7.10 Chi phí (`/api/cost/`)
| Method | Đường dẫn | Body | Trả về |
|---|---|---|---|
| GET | `summary` | | `{month, spent_usd, spent_vnd, budget_vnd, pct, forecast_vnd, over, by_module[], recent[], months[], settings, prices, rate}` |
| POST | `estimate` | `{action, params}` | Xem §9 |
| POST | `settings` | Bất kỳ khóa ngân sách nào, `prices:{…}`, `usd_vnd` | `summary` mới |

### 7.11 Đăng nhập (`/auth/`)
| Đường dẫn | Mô tả |
|---|---|
| `GET /auth/login?next=/rank&m=expired` | Trang đăng nhập |
| `GET /auth/google?next=` | Chuyển sang Google |
| `GET /auth/callback` | Google trả về; tạo phiên rồi chuyển tới `next` |
| `GET /auth/logout` | Xóa phiên |
| `GET /auth/me` | `{enabled, user: {email, name, picture} \| null}` |

---

## 8. Dịch vụ bên ngoài và đơn giá

Đơn giá mặc định nằm trong `costs.DEFAULT_PRICES` và sửa được qua `cost_prices`:

| Khóa giá | USD | Dùng cho |
|---|---|---|
| `dfs_volume_task` | 0,09 / lần (≤1.000 từ) | DataForSEO `keywords_data/google_ads/search_volume/live` |
| `dfs_serp_page` | 0,002 / trang 10 kết quả | `serp/google/organic/live/regular` (Rank), `live/advanced` (GEO) |
| `dfs_aio_extra` | 0,002 | Tải AI Overview (`load_async_ai_overview`) |
| `dfs_paa_click` | 0,00015 | Mở rộng People Also Ask |
| `dfs_bl_request` | 0,02 / request | Backlinks API |
| `dfs_bl_row` | 0,00003 / dòng | Backlinks API |
| `claude_in` | 2,0 / 1 triệu token | Claude đầu vào |
| `claude_out` | 10,0 / 1 triệu token | Claude đầu ra |

Các dịch vụ khác:

| Dịch vụ | Endpoint | Xác thực | Chi phí |
|---|---|---|---|
| Anthropic Claude | `POST https://api.anthropic.com/v1/messages` | `x-api-key`, `anthropic-version: 2023-06-01` | Theo token (bảng trên) |
| Google OAuth | `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token` | Client ID và secret | Miễn phí |
| Search Console | `searchconsole.googleapis.com` (Search Analytics, Sites, URL Inspection) | Service account JWT, scope `webmasters.readonly` | Miễn phí (có hạn mức) |
| GA4 Data API | `analyticsdata.googleapis.com/v1beta/properties/<id>:runReport` | Service account, scope `analytics.readonly` | Miễn phí (có hạn mức) |
| Pexels | `api.pexels.com/v1/search` | Header `Authorization` | Miễn phí |
| WordPress | `<site>/wp-json/wp/v2/...` | Basic, Application Password | |

**Chi phí tham khảo hàng tháng cho mrvu.vn:** khoảng 150.000–400.000 đ khi dùng vừa phải với các mặc định tiết kiệm, chưa tính gói Backlinks API ($100/tháng). Tiền phát sinh chủ yếu từ AI viết bài: mỗi bài khoảng 1.000–2.500 đ.

---

## 9. Hệ thống kiểm soát chi phí

### 9.1 Ghi sổ tự động
Mọi chi phí thật được ghi vào bảng `spend` tại ba điểm:
- `app.dfs_post()`: gọi `costs.record_dfs(path, cost)` với số tiền thật DataForSEO trả về.
- `autopost.claude(..., tag=...)`: gọi `costs.record_claude(tag, usage)` theo token thật.
- `audit.ai_suggest`: ghi vào `audit_ai`.

Khi viết tính năng mới, **hãy gọi qua `dfs_post` và `claude(tag=...)`** để chi phí tự được ghi.

### 9.2 Ngân sách (`cost_budget`)
| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `budget_month_vnd` | 300.000 | Ngân sách mỗi tháng |
| `confirm_over_vnd` | 5.000 | Một thao tác từ mức này trở lên thì hiện hộp xác nhận |
| `warn_pct` | 80 | Cảnh báo khi đã dùng quá % ngân sách |
| `auto_stop` | true | Dừng lịch Autopost khi vượt ngân sách |
| `rank_recent_days` | 6 | Bỏ qua từ khóa vừa quét trong N ngày |
| `geo_recent_days` | 7 | Cảnh báo phân tích GEO trùng |
| `bl_recent_days` | 7 | Cảnh báo cập nhật backlink quá dày |

### 9.3 Ước tính: `POST /api/cost/estimate`
`action` và `params`:

| action | params |
|---|---|
| `volume` | `count`, `dupes` |
| `rank` | `count`, `depth`, `recent` |
| `geo` | `ai` (bool), `recent_days` |
| `autopost_write` | `words`, `images` (`pexels`/…) |
| `bl_refresh` | `days_since` |
| `bl_gap` | `competitors`, `no_snapshot` |
| `bl_examples` | `competitors` |
| `ai_outreach`, `gsc_title`, `gsc_plan`, `gsc_report`, `audit_ai` | Không cần; ước tính theo lượng token trung bình `AI_TOKENS` |

Ví dụ kết quả:

```json
{
  "action": "rank", "label": "Quét thứ hạng", "usd": 0.06, "vnd": 1560, "rate": 26000,
  "parts": [{"label": "30 từ × 1 trang Google", "usd": 0.06}],
  "warnings": [{"level": "warn|bad|info", "text": "..."}],
  "tips": ["..."],
  "options": [{"id": "skip_recent", "checked": true, "saving_usd": 0.02, "label": "Bỏ qua 10 từ vừa quét trong 6 ngày"}],
  "need_confirm": false,
  "month": {"spent_vnd": 52000, "budget_vnd": 300000, "after_vnd": 53560, "pct_after": 17.9}
}
```

`need_confirm` là true khi chi phí ≥ `confirm_over_vnd`, khi có cảnh báo mức `warn`/`bad` (vượt ngân sách, vượt `warn_pct`, quét trùng…), hoặc khi có lựa chọn tiết kiệm để người dùng chọn.

---

## 10. Đăng nhập Google (OAuth)

**Bật** khi `config.json` có đủ `google_client_id`, `google_client_secret`, `public_url`, `allowed_emails`. Nếu thiếu thì không có đăng nhập; trường hợp này chỉ an toàn khi công cụ nghe ở 127.0.0.1.

Luồng đăng nhập (OpenID Connect, Authorization Code):
1. Người dùng chưa có phiên mở một trang: chuyển `302` về `/auth/login?next=<trang>`. Gọi API thì nhận `401 {"error": "...", "login": true}`.
2. `/auth/google`:
   - Tạo `state` và `nonce` ngẫu nhiên, lưu vào cookie tạm `mvs_oauth`.
   - Chuyển sang Google với `scope=openid email profile` và `prompt=select_account`.
   - redirect_uri = `<public_url>/auth/callback`.
3. `/auth/callback`:
   - Kiểm tra `state`, đổi `code` lấy `id_token` qua kênh HTTPS trực tiếp với Google.
   - Kiểm tra `iss`, `aud` (= client_id), `exp`, `nonce`, `email_verified`.
   - Kiểm tra email có trong `allowed_emails`; nếu không, hiện trang từ chối (đã chống XSS).
4. Tạo token ngẫu nhiên 32 byte, đặt cookie `mvs_session`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=30 ngày`, thêm `Secure` khi `public_url` là https. CSDL chỉ lưu **sha256** của token.
5. Mỗi request kiểm tra lại phiên còn hạn **và** email còn trong danh sách. Gỡ email khỏi danh sách thì người đó mất quyền ngay.
6. `next` chỉ nhận đường dẫn nội bộ bắt đầu bằng `/` (không phải `//`), để chống open redirect.

Lưu ý khi tích hợp:
- Redirect URI trong Google Cloud phải khớp chính xác `<public_url>/auth/callback`.
- Phiên là cookie riêng của tên miền công cụ. Ứng dụng khác **không dùng chung** đăng nhập này (xem §12).

---

## 11. Quy ước giao diện (frontend)

- **Trang:** mỗi trang là một tệp HTML tự chứa (CSS và JS viết sẵn bên trong), cùng nạp `<script src="costguard.js">`. Đường dẫn API là **tương đối** (`fetch('api/...')`), nên đặt công cụ dưới một thư mục con vẫn chạy được.
- **Menu:** `.nav` gồm thương hiệu "Mr.Vũ SEO Studio" và 7 tab. `costguard.js` tự chèn vào đó ô ngân sách và chip người dùng (ảnh, email, Đăng xuất).
- **Giao diện sáng/tối:**
  - Màu khai báo bằng biến CSS trên `:root` (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`…).
  - Có bản tối theo `prefers-color-scheme`.
  - Phông chữ **Be Vietnam Pro** (Google Fonts) cho cả số liệu, vì phông monospace hay thiếu dấu tiếng Việt.
- **Chế độ demo:** khi tải trang, gọi `api/health` với thời gian chờ 1,5 giây.
  - Không phản hồi: trang chuyển sang dữ liệu mẫu (lưu `localStorage`), và hộp chi phí dùng bộ ước tính demo có công thức giống máy chủ.
  - Nhờ vậy có thể mở tệp HTML trực tiếp hoặc xem trước dạng artifact.
- **Đáp ứng điện thoại:** bảng rộng nằm trong khung cuộn ngang; lưới 2 cột tự xếp 1 cột.

### API `window.CostGuard`
```js
await CostGuard.quote(action, params)        // → kết quả estimate
const r = await CostGuard.check(action, params, {always?:bool})
if (!r.ok) return;                           // người dùng bấm Hủy
// r.options: {skip_recent: true, ...} — các lựa chọn tiết kiệm người dùng giữ lại
CostGuard.label(button, action, params, 'Quét ngay')  // gắn "· ~1.560 đ" vào nút
CostGuard.after()                            // gọi sau khi thao tác tốn phí xong → cập nhật ô ngân sách
await CostGuard.summary(); await CostGuard.settings();
CostGuard.openPanel()                        // mở bảng Chi phí & ngân sách
CostGuard.vnd(12345)                         // "12.345 đ"
```
`costguard.js` cũng bọc `fetch`: khi nhận `401` có `login: true`, trình duyệt tự chuyển tới `/auth/login?m=expired`.

---

## 12. Các cách tích hợp vào ứng dụng của bạn

### Cách A: chạy riêng và đặt liên kết (khuyên dùng, ít việc nhất)
Chạy công cụ tại `https://seo.ttv.vn` như `TRIEN_KHAI.md`. Trong ứng dụng quản trị của bạn, thêm menu "SEO Studio" mở sang `https://seo.ttv.vn/` hoặc trực tiếp từng tab (`/rank`, `/audit`, `/gsc`…). Có thể mở GEO với dữ liệu điền sẵn: `/geo?url=https://mrvu.vn/...&kw=quạt trần`.

### Cách B: nhúng bằng iframe
Cấu hình nginx mẫu có `X-Frame-Options: DENY` (chống clickjacking). Muốn nhúng thì đổi dòng đó thành:
```nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://admin.mrvu.vn" always;
```
Cookie phiên dùng `SameSite=Lax`, nên **trong iframe khác tên miền, trình duyệt sẽ không gửi cookie**. Cần chọn một trong hai cách:
- Đặt ứng dụng của bạn và công cụ chung tên miền gốc (ví dụ `admin.ttv.vn` và `seo.ttv.vn` là cùng site `ttv.vn`, nên Lax vẫn gửi cookie).
- Hoặc đổi sang `SameSite=None; Secure` trong `auth._set_cookie`.

Riêng trang đăng nhập Google không mở được trong iframe, nên hãy đăng nhập ở tab mới trước.

### Cách C: gọi HTTP API từ máy chủ ứng dụng của bạn
Toàn bộ chức năng đều là API JSON (§7). Phiên bản hiện tại **chưa có API token cho máy-với-máy**. Có hai cách:
1. **Gọi qua localhost:** ứng dụng chạy cùng VPS gọi `http://127.0.0.1:8686`. Để bỏ qua đăng nhập cho kết nối nội bộ, thêm vào đầu `auth.guard()`:
   ```python
   if h.client_address[0] == "127.0.0.1" and h.headers.get("X-Internal-Token") == load_config().get("internal_token"):
       return False
   ```
   Thêm `"internal_token": "<chuỗi ngẫu nhiên dài>"` vào config. **Bắt buộc** kiểm tra cả token, vì nginx cũng kết nối từ 127.0.0.1.
2. **Thêm API key qua HTTPS:** cùng cách trên nhưng bỏ điều kiện IP, kiểm tra header `Authorization: Bearer <api_key>`. Dùng khóa dài, chỉ qua HTTPS.

Ví dụ C# (HttpClient) tra volume và chờ một job Autopost:
```csharp
var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:8686/") };
http.DefaultRequestHeaders.Add("X-Internal-Token", token);

// 1. Tra volume (đồng bộ)
var res = await http.PostAsJsonAsync("api/volume", new { keywords = new[] { "quạt trần", "quạt trần đèn" } });
var vol = await res.Content.ReadFromJsonAsync<JsonElement>();

// 2. Viết bài (job)
var start = await (await http.PostAsJsonAsync("api/ap/write", new { keyword_id = 12, publish = false }))
                  .Content.ReadFromJsonAsync<JsonElement>();
string jobId = start.GetProperty("job_id").GetString();
JsonElement job;
do {
    await Task.Delay(2000);
    job = await http.GetFromJsonAsync<JsonElement>($"api/ap/job/{jobId}");
} while (job.GetProperty("status").GetString() == "running");
```

Nên gọi `POST /api/cost/estimate` trước mỗi thao tác tốn phí để hiển thị chi phí trong ứng dụng của bạn, giống giao diện gốc.

### Cách D: nhận bài Autopost vào website ASP.NET
Không cần sửa công cụ. Viết một endpoint theo `HUONG_DAN_CUSTOM_API.md`, rồi trong tab Autopost thêm website loại **Custom API** với URL endpoint và mã bảo mật.

### Cách E: đọc dữ liệu trực tiếp
Đọc `kho-tu-khoa.db` bằng SQLite (chế độ chỉ đọc) để làm báo cáo riêng, ví dụ:
```sql
-- Thứ hạng mới nhất của mỗi từ khóa
SELECT t.keyword, r.position, r.url, r.checked_at
FROM tracked t JOIN ranks r ON r.id = (SELECT MAX(id) FROM ranks WHERE tracked_id = t.id)
WHERE t.domain = 'mrvu.vn';

-- Chi phí tháng này theo module (USD)
SELECT module, SUM(usd) FROM spend WHERE month = strftime('%Y-%m','now','localtime') GROUP BY module;
```

### Cách F: chuyển (port) sang ngôn ngữ khác
Mỗi module độc lập, logic nằm trong các hàm thuần, nên có thể dịch sang C#. Thứ tự gợi ý:
1. `costs.py`
2. `dfs_post` và `claude()`
3. Volume và Rank
4. `audit.py`
5. `autopost.py`
6. `geo.py`
7. `backlinks.py`
8. `gsc.py`, trong đó phần JWT có thể thay bằng thư viện `Google.Apis.Auth`.

Giao diện HTML giữ nguyên được, chỉ cần máy chủ mới trả đúng các API ở §7.

---

## 13. Triển khai và vận hành

Chi tiết từng bước ở `TRIEN_KHAI.md`. Tóm tắt:

1. VPS Ubuntu 22.04/24.04, 1 CPU, 1 GB RAM. **Hosting cPanel thường không chạy được**, vì công cụ là tiến trình chạy liên tục và có lịch tự động.
2. Bản ghi DNS `A seo → IP VPS`.
3. Tạo OAuth client (Web application), redirect `https://seo.ttv.vn/auth/callback`.
4. Điền `config.json`, chép thư mục lên VPS, chạy `sudo bash deploy/cai-dat.sh`. Script sẽ:
   - Cài Python, nginx, certbot; đặt múi giờ `Asia/Ho_Chi_Minh`.
   - Tạo người dùng hệ thống `mrvu`; cài vào `/opt/mrvu-seo-studio` mà không ghi đè dữ liệu đã có.
   - Đặt quyền `600` cho khóa.
   - Cài dịch vụ systemd `mrvu-seo-studio` (có giới hạn quyền, tự khởi động lại).
   - Cấu hình nginx proxy tới `127.0.0.1:8686`:
     - timeout 300 giây;
     - nhận tệp tối đa 20 MB;
     - header `X-Robots-Tag: noindex`, `X-Frame-Options DENY`, `nosniff`.
   - Cấp HTTPS Let's Encrypt.
   - Sao lưu mỗi đêm vào `/var/backups/mrvu-seo-studio/` (giữ 14 bản).

Vận hành:

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `systemctl status mrvu-seo-studio` |
| Xem nhật ký | `journalctl -u mrvu-seo-studio -f` |
| Khởi động lại | `sudo systemctl restart mrvu-seo-studio` |

**Cập nhật bản mới:** chép các tệp `.py`, `.html`, `.js` mới vào `/opt/mrvu-seo-studio` rồi khởi động lại. CSDL tự thêm bảng mới nếu có, không mất dữ liệu.

---

## 14. Bảo mật

- **Bí mật:** `config.json` và `google-service-account.json` chứa khóa. Không commit lên Git, không gửi qua chat; trên VPS đặt quyền `600`.
- **Không mở công cụ ra Internet khi chưa có đăng nhập.** Mã nguồn đã tự chặn, đừng gỡ phần chặn này.
- **Service account** chỉ cần quyền đọc (Restricted trong Search Console, Viewer trong GA4).
- **Khóa đã che trên giao diện:** API trả `secret` và khóa API ở dạng che (`abcd…wxyz`). Gửi lại chuỗi đã che thì giữ nguyên khóa cũ.
- **Nội dung AI:** HTML do AI viết được làm sạch theo danh sách thẻ cho phép trước khi lưu và đăng. Website nhận bài vẫn nên kiểm tra lại.
- **Crawler** tôn trọng `robots.txt`; tốc độ quét vừa phải.
- **Công cụ nội bộ:** trang công cụ gắn `noindex` để Google không lập chỉ mục.
- **Chính sách link:** không trao đổi link tự động; link trả phí phải `rel="sponsored"`, theo chính sách spam liên kết của Google.

---

## 15. Giới hạn đã biết và hướng mở rộng

### Giới hạn
- Job lưu trong bộ nhớ, khởi động lại thì mất trạng thái job đang chạy (dữ liệu đã lưu không mất).
- Chỉ một tiến trình máy chủ, SQLite có khóa ghi; đủ cho vài người dùng nội bộ, không thiết kế cho hàng trăm người dùng đồng thời.
- Chưa phân quyền theo vai trò: mọi email được phép đều có toàn quyền. Dữ liệu dùng chung, không tách theo người.
- Chưa có API token máy-với-máy (xem §12, cách C).
- Rank Tracker và GEO chỉ dùng Google; Bing đã được gỡ.
- Kết nối thật tới DataForSEO, Claude và Google mới được kiểm thử bằng dữ liệu giả lập. Lần chạy thật đầu tiên nên thử với lượng nhỏ.
- Search Console có độ trễ khoảng 2–3 ngày. URL Inspection giới hạn khoảng 2.000 URL/ngày cho mỗi thuộc tính.

### Hướng mở rộng gợi ý
| Nhu cầu | Cách làm |
|---|---|
| Thêm tab mới | Tạo `tenmodule.py` có `setup()` và `handle(h, method, path)`; thêm tiền tố `/api/<x>/` vào 3 hàm `do_GET/do_POST/do_DELETE` của `app.py`; thêm trang vào bảng `pages`; thêm tab vào `.nav` của 7 trang |
| Thao tác tốn phí mới | Gọi qua `dfs_post`/`claude(tag=...)`; thêm `action` vào `costs.estimate`, `MODULE`, `LABEL` và bộ ước tính demo trong `costguard.js`; trên giao diện gọi `CostGuard.check()` trước khi chạy và `CostGuard.after()` sau khi xong |
| Quét Rank theo lịch | Thêm luồng nền giống `autopost.scheduler_loop`, kiểm tra `costs.over_budget()` trước khi chạy |
| Gửi báo cáo qua email hoặc Zalo | Lấy dữ liệu từ `GET /api/gsc/report/<id>`, gửi bằng SMTP hoặc Zalo OA |
| Phân quyền | Thêm cột `role` vào cấu hình (`allowed_emails` dạng `{email, role}`); kiểm tra trong `auth.guard()` theo tiền tố đường dẫn |
| Nhiều người dùng đồng thời | Chuyển job sang hàng đợi bền (bảng `jobs` trong SQLite), chạy sau gunicorn/uvicorn, hoặc port sang ASP.NET Core |

---

*Mr.Vũ SEO Studio · công cụ nội bộ của mrvu.vn · dùng thư viện chuẩn Python, không phụ thuộc bên thứ ba.*
