# Đưa Mr.Vũ SEO Studio lên seo.ttv.vn

Sau khi làm xong, bạn mở **https://seo.ttv.vn** trên bất kỳ máy nào (máy tính, điện thoại), bấm **Đăng nhập bằng Google** bằng email đã được cho phép là dùng được. Lịch Autopost chạy 24/7 trên máy chủ, không cần để máy tính mở.

## 0. Cần chuẩn bị

- **Một VPS Linux (Ubuntu 22.04 hoặc 24.04)**, cấu hình 1 CPU, 1 GB RAM là đủ. Giá thường khoảng 100.000–200.000 đ/tháng ở các nhà cung cấp Việt Nam.
  Công cụ là một chương trình chạy liên tục (có lịch tự động), nên **hosting chia sẻ kiểu cPanel thường không chạy được**. Nếu bạn chỉ có hosting cPanel, hãy báo lại để điều chỉnh cách triển khai.
- Quyền quản lý DNS tên miền **ttv.vn**.

## 1. Trỏ tên miền

Trong trang quản lý DNS của ttv.vn, thêm bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `seo` | Địa chỉ IP của VPS |

Đợi 5–30 phút để bản ghi có hiệu lực.

## 2. Tạo "OAuth client" để đăng nhập bằng Google (khoảng 5 phút)

Dùng luôn project Google Cloud đã tạo cho Search Console.

1. Vào **console.cloud.google.com** → chọn project → **APIs & Services → OAuth consent screen** (màn hình xin quyền).
   - Loại người dùng: **External**. Tên ứng dụng: `Mr.Vũ SEO Studio`. Email hỗ trợ: email của bạn.
   - Authorized domain: `ttv.vn`.
   - Scopes: chỉ cần **email, profile, openid** (mặc định, không phải xin Google duyệt).
   - Bấm **Publish app** để chuyển sang *In production*. Với 3 quyền cơ bản này Google không yêu cầu xét duyệt.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**. Tên: `seo.ttv.vn`.
   - **Authorized redirect URIs**: `https://seo.ttv.vn/auth/callback`
   - Bấm Create, copy **Client ID** và **Client secret**.

## 3. Điền cấu hình

Mở `config.json` (của bản bạn đang dùng trên máy, để giữ nguyên các khóa API đã nhập) và thêm:

```json
{
  "google_client_id": "1234567890-xxxx.apps.googleusercontent.com",
  "google_client_secret": "GOCSPX-xxxx",
  "public_url": "https://seo.ttv.vn",
  "allowed_emails": ["vuviet.thd@gmail.com"],
  "bind_host": "127.0.0.1",
  "port": 8686
}
```

- `allowed_emails`: danh sách email được phép vào, viết thường. Muốn thêm người, thêm email vào danh sách, **không cần khởi động lại**. Gỡ email ra thì người đó **mất quyền ngay**, kể cả đang đăng nhập.
- Giữ `bind_host` là `127.0.0.1`: công cụ chỉ nhận kết nối qua nginx (có HTTPS), không mở cổng ra Internet.

## 4. Tải lên VPS và cài đặt

Trên máy tính, chép **cả thư mục `mrvu-seo-studio`** (đã có dữ liệu: `kho-tu-khoa.db`, `config.json`, `google-service-account.json`, `anh-thu-vien/`) lên VPS, ví dụ bằng WinSCP hoặc lệnh:

```bash
scp -r mrvu-seo-studio root@IP_VPS:/root/
```

Đăng nhập VPS rồi chạy:

```bash
cd /root/mrvu-seo-studio
sudo bash deploy/cai-dat.sh
```

Script tự làm các việc sau:
1. Cài Python, nginx, chứng chỉ HTTPS miễn phí (Let's Encrypt).
2. Đặt múi giờ Việt Nam, để lịch Autopost chạy đúng giờ.
3. Chép công cụ vào `/opt/mrvu-seo-studio` mà không ghi đè dữ liệu đã có.
4. Chạy công cụ như một dịch vụ, tự khởi động lại khi lỗi hoặc khi VPS khởi động lại.
5. Cấu hình `seo.ttv.vn`, chặn Google index trang công cụ.
6. **Sao lưu dữ liệu mỗi đêm** vào `/var/backups/mrvu-seo-studio/`, giữ 14 bản gần nhất.

Mở **https://seo.ttv.vn** → trang đăng nhập → **Đăng nhập bằng Google**.

## 5. Vận hành

| Việc | Lệnh trên VPS |
|---|---|
| Xem trạng thái | `systemctl status mrvu-seo-studio` |
| Xem nhật ký (ai đăng nhập, lỗi) | `journalctl -u mrvu-seo-studio -f` |
| Khởi động lại | `sudo systemctl restart mrvu-seo-studio` |
| Cập nhật bản mới | Chép các file mới (không cần chép `.db`, `config.json`, khóa) vào `/opt/mrvu-seo-studio`, rồi khởi động lại |
| Lấy bản sao lưu về máy | Tải file trong `/var/backups/mrvu-seo-studio/` |

## Bảo mật

- Mọi trang và mọi API đều yêu cầu đăng nhập. Chưa đăng nhập thì chỉ thấy trang đăng nhập.
- Công cụ chỉ nhận email **đã được Google xác minh** và nằm trong `allowed_emails`.
- Phiên đăng nhập giữ **30 ngày** trên mỗi trình duyệt (cookie HttpOnly, Secure). Bấm **Đăng xuất** ở góc phải menu để thoát.
- Nếu `config.json` thiếu cấu hình đăng nhập, công cụ **từ chối chạy ở chế độ máy chủ** để không lộ dữ liệu.
- File `config.json` và `google-service-account.json` chứa khóa API: script đặt quyền chỉ chủ dịch vụ đọc được. Không chia sẻ các file này.

## Vẫn dùng được trên máy tính

Bấm `MO_CONG_CU.bat` như trước: công cụ chạy ở `http://127.0.0.1:8686`, chỉ máy đó vào được. Không cần đăng nhập nếu không điền cấu hình Google; nếu đã điền thì cũng phải đăng nhập.
Lưu ý: dùng song song hai nơi thì **dữ liệu tách riêng**. Nên chọn một nơi làm chính (khuyên dùng seo.ttv.vn).
