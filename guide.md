# Hướng dẫn lấy key cho SEO Studio

Lấy đủ các key bên dưới, rồi dán vào **Vercel → Project → Settings → Environment Variables** (chọn Production, và Preview nếu cần), sau đó **Redeploy**. Chạy thử trên máy thì dán vào file `.env`.

> ⚠️ Không gửi key qua chat/Zalo, không commit file `.env`.

---

## 1. `SEO_DATABASE_URL`: kết nối Postgres (Supabase)

1. Vào https://supabase.com/dashboard → mở project của POS.
2. Bấm nút **Connect** ở thanh trên cùng.
3. Chọn tab **Connection string** → loại **URI** → mục **Transaction pooler** (cổng **6543**).
4. Copy chuỗi dạng:
   
   ```
   postgresql://postgres.xxxxxxxx:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
5. Thay `[YOUR-PASSWORD]` bằng mật khẩu database:
   - quên mật khẩu thì vào **Project Settings → Database → Reset database password**;
   - nếu mật khẩu có ký tự đặc biệt (`@ # / ?`…), nên đặt lại mật khẩu chỉ gồm chữ và số cho dễ dùng.

Trước khi dùng: chạy file `sql_migration_v25_seo_studio.sql` trong **SQL Editor** của Supabase.

---

## 2. `SEO_SECRET_KEY` và `SEO_JOB_SECRET`: tự tạo

Mở terminal trong thư mục dự án, chạy lệnh **2 lần** (mỗi lần ra một chuỗi khác nhau):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Chuỗi thứ nhất dán vào `SEO_SECRET_KEY`. Dùng để mã hóa mật khẩu WordPress và file khóa Google. **Không được đổi sau này**, nếu đổi thì phải nhập lại mật khẩu các website.
- Chuỗi thứ hai dán vào `SEO_JOB_SECRET`. Dùng cho lịch tự đăng bài (pg_cron), xem mục 7.

---

## 3. Đăng nhập Google: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`

1. Vào https://console.cloud.google.com → chọn (hoặc tạo) một project.
2. **APIs & Services → OAuth consent screen** (hoặc **Google Auth Platform**):
   - User type: **External** → điền tên app (vd. "Mr.Vũ SEO Studio"), email hỗ trợ → Lưu;
   - mục **Audience / Test users**: thêm các email admin sẽ đăng nhập. Hoặc bấm **Publish app**; chỉ dùng scope email/profile nên không cần Google duyệt.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**;
   - **Authorized redirect URIs**: thêm đúng địa chỉ sau (thay tên miền POS):
     
     ```
     https://ten-mien-cua-ban/seo-studio/auth/callback
     ```
4. Bấm **Create** → copy:
   - **Client ID** → `GOOGLE_OAUTH_CLIENT_ID`;
   - **Client secret** → `GOOGLE_OAUTH_CLIENT_SECRET`.

## 4. `SEO_PUBLIC_URL` và `SEO_ALLOWED_EMAILS`: tự điền

- `SEO_PUBLIC_URL`: địa chỉ gốc của POS, **không có dấu `/` cuối**, phải khớp tên miền ở redirect URI bên trên. Ví dụ:
  
  ```
  https://pos.mrvu.vn
  ```
- `SEO_ALLOWED_EMAILS`: các email Google được vào SEO Studio, cách nhau bằng dấu phẩy. Ví dụ:
  
  ```
  vuviet.thd@gmail.com,admin2@gmail.com
  ```

---

## 5. DataForSEO: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`

Dùng cho Tra cứu Volume, Rank Tracker, AI Overview, Backlink.

1. Đăng ký tại https://app.dataforseo.com/register và xác nhận email.
2. Nạp tiền: **Billing → Add funds** (tối thiểu khoảng 50 USD; tài khoản mới thường được tặng ít tiền dùng thử).
3. Vào **API Access** (https://app.dataforseo.com/api-access):
   - **API login** (thường là email) → `DATAFORSEO_LOGIN`;
   - **API password** (khác mật khẩu đăng nhập web, bấm hiện/tạo lại nếu cần) → `DATAFORSEO_PASSWORD`.

> Tab Backlink dùng Backlinks API thì phải **kích hoạt riêng gói Backlinks** (tối thiểu 100 USD/tháng). Chưa kích hoạt thì vẫn nhập được file CSV từ Search Console miễn phí.

---

## 6. Claude: `ANTHROPIC_API_KEY`

Dùng để viết bài Autopost và các gợi ý AI.

1. Đăng nhập https://console.anthropic.com.
2. **Settings → Billing**: thêm thẻ và nạp credit (vd. 10–20 USD để bắt đầu).
3. **Settings → API Keys → Create Key** → đặt tên (vd. `mrvu-seo-studio`) → copy key dạng `sk-ant-...` → `ANTHROPIC_API_KEY`.
   Key chỉ hiện **một lần**, nhớ lưu lại.

---

## 7. Sau khi đã có đủ key

1. Dán tất cả vào Vercel Environment Variables → **Redeploy**.
2. Kiểm tra **Vercel → Settings → Functions → Fluid Compute** đang **bật**. Nếu tắt: thêm biến `SEO_MAX_DURATION=60`.
3. Bật lịch tự đăng bài. Trong Supabase SQL Editor, chạy đoạn sau (thay tên miền và `SEO_JOB_SECRET`):
   
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   SELECT cron.schedule('seo-autopost', '* * * * *', $$
     SELECT net.http_post(
       url     := 'https://ten-mien-cua-ban/seo-studio/cron',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-job-secret', 'DÁN_SEO_JOB_SECRET_VÀO_ĐÂY'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 300000
     );
   $$);
   ```
4. Mở POS bằng tài khoản admin → menu **SEO Studio** → đăng nhập Google.

---

## Key không bắt buộc (khi cần mới lấy)

| Biến                          | Dùng cho                  | Lấy ở đâu                                                                                                               |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PEXELS_API_KEY`              | Ảnh miễn phí cho Autopost | https://www.pexels.com/api → Your API Key                                                                               |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Tab Search Console + GA4  | Có hướng dẫn từng bước trong tab Search Console → Kết nối. Có thể bỏ trống biến này và tải file JSON lên ngay trong tab |
| `SEO_ANTHROPIC_MODEL`         | Đổi mô hình Claude        | Để trống = `claude-sonnet-5-5`                                                                                          |
| `GOOGLE_PSI_API_KEY`          | Tab Bản đồ website (đo tốc độ) | console.cloud.google.com (project của Search Console) → APIs & Services → Library → **PageSpeed Insights API** → Enable → Credentials → Create credentials → API key → Restrict key: chỉ PageSpeed Insights API. Có thể bỏ trống biến này và dán khóa trong Bản đồ website → Cài đặt |

## Bảng kiểm nhanh

- [ ] `SEO_DATABASE_URL` (đã chạy migration v25, rồi v27 cho Bản đồ website + Câu hỏi AI)
- [ ] `SEO_SECRET_KEY`
- [ ] `SEO_JOB_SECRET`
- [ ] `GOOGLE_OAUTH_CLIENT_ID`
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET`
- [ ] `SEO_PUBLIC_URL`
- [ ] `SEO_ALLOWED_EMAILS`
- [ ] `DATAFORSEO_LOGIN`
- [ ] `DATAFORSEO_PASSWORD`
- [ ] `ANTHROPIC_API_KEY`
- [ ] Redeploy + Fluid Compute + pg_cron
