# Hướng dẫn cài đặt và chạy thử

Cần: Node.js 20 trở lên, tài khoản Supabase (gói miễn phí đủ để thử), Chrome hoặc Edge.

## 1. Tạo dự án Supabase (chỉ 2 bước)
1. Vào supabase.com, tạo project mới (vùng gần Việt Nam, ví dụ Singapore). Ghi lại mật khẩu database.
2. **SQL Editor:** mở tệp `supabase/setup_all.sql`, dán toàn bộ nội dung và bấm Run. Chỉ chạy **một lần** trên project mới.

Xong. **Không** cần tạo user trong dashboard, không cần Supabase CLI hay Edge Function: mọi tài khoản (chủ quán, nhân viên) tạo ngay trong ứng dụng, đăng nhập bằng **tên đăng nhập + mật khẩu**.

(Tùy chọn, an toàn hơn: **Authentication → Sign In / Providers → Email** tắt "Allow new users to sign up". Ứng dụng không dùng chức năng tự đăng ký này.)

## 2. Cấu hình ứng dụng
```
cp .env.example .env
```
Điền hai giá trị từ **Project Settings → API**:
- `VITE_CAFE_SUPABASE_URL`: Project URL
- `VITE_CAFE_SUPABASE_ANON_KEY`: khóa `anon` / `public`

Chỉ dùng anon key. Không đưa service role key vào `.env`.

## 3. Chạy
```
npm install
npm run dev
```
Mở http://localhost:5173 (hoặc `https://<miền>/cafe` khi đã deploy). Lần đầu, màn hình đăng nhập hiện **Cài đặt lần đầu**: nhập tên, địa chỉ, số điện thoại của quán và tạo tài khoản chủ cửa hàng (tên đăng nhập + mật khẩu). Làm ngay sau khi chạy SQL: form này chỉ dùng được một lần, ai mở trang trước sẽ thành chủ.

Tạo nhân viên: **Tài khoản & quyền → Thêm nhân viên** (họ tên, tên đăng nhập, mật khẩu, vai trò). Quên mật khẩu: bấm nút chìa khóa cạnh tên người đó để đặt mật khẩu mới.

## 4. Dữ liệu mẫu (tùy chọn)
Muốn thử ngay mà chưa nhập thực đơn: mở `supabase/seed_demo.sql`, dán vào SQL Editor, Run. Tệp thêm vài món, bàn, nguyên liệu và công thức **minh họa** (không phải thực đơn thật). Chạy lại không nhân đôi. Trước khi bán thật hãy xóa hoặc sửa trong ứng dụng.

## 5. Thử một vòng bán hàng
1. **Nhân viên & ca:** mở ca với tiền đầu ca.
2. **Bán hàng:** chọn món → Thanh toán → Tiền mặt → Xác nhận. Cài đặt máy in mặc định là "Giả lập" nên bill được tạo nhưng không in ra giấy (xem bản in ở **Máy in & cửa hàng**).
3. **Đơn hàng:** mở đơn vừa bán, thử In lại và Hoàn tiền.
4. **Kho:** nếu đã chạy dữ liệu mẫu, tồn kho giảm theo công thức.
5. **Nhân viên & ca:** đóng ca, nhập số tiền đếm thực tế, xem chênh lệch.
6. **Báo cáo:** xem doanh thu hôm nay.

## 6. In bill thật
Xem [MAY_IN.md](MAY_IN.md).

## 7. Đưa lên dùng thật
**Đang dùng cách này:** POS được gắn vào web Mr.Vũ (thư mục cha), chạy ở `https://<miền>/cafe`. Chỉ cần thêm `VITE_CAFE_SUPABASE_URL`, `VITE_CAFE_SUPABASE_ANON_KEY` vào biến môi trường Vercel của web Mr.Vũ rồi Redeploy; `npm run build` của web chính tự build POS (xem `scripts/build-cafe.mjs` ở thư mục cha). Phần dưới chỉ dùng khi muốn deploy POS thành web riêng.

```
npm run build
```
Thư mục `dist` là website tĩnh; đưa lên bất kỳ dịch vụ nào (Cloudflare Pages, Netlify, Vercel hoặc máy chủ web riêng) và đặt hai biến môi trường `VITE_CAFE_SUPABASE_URL`, `VITE_CAFE_SUPABASE_ANON_KEY` **trước khi build** (Vite nhúng chúng vào bản build). Ứng dụng dùng địa chỉ dạng `/#/pos` nên không cần cấu hình rewrite. Nên dùng HTTPS.

Trước khi bán thật: đọc [BACKUP.md](BACKUP.md) và chạy qua danh sách trong [NGHIEM_THU.md](NGHIEM_THU.md) trên thiết bị thật của quán.

## 8. Kiểm tra mã nguồn (cho người phát triển)
```
npm run verify     # typecheck, lint, test đơn vị, build
npm run test:db    # chạy bằng người dùng thường: runuser -u <user> -- npm run test:db
```
`test:db` dùng PostgreSQL nhúng sẵn nên không cần cài gì thêm, nhưng PostgreSQL từ chối chạy bằng root.
