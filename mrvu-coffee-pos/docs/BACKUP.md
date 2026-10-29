# Sao lưu và khôi phục

Dữ liệu tiền bạc của quán nằm trong database Supabase, nên cần có bản sao lưu bạn kiểm soát được.

## Sao lưu của Supabase
Gói trả phí có sao lưu hằng ngày; gói miễn phí **không** có. Xem mục Database → Backups trong dashboard để biết gói của bạn có gì.

## Tự sao lưu bằng pg_dump (khuyến nghị)
1. Lấy chuỗi kết nối: Project Settings → Database → Connection string (URI), thay `[YOUR-PASSWORD]` bằng mật khẩu database.
2. Cài công cụ PostgreSQL client (có `pg_dump`), rồi chạy:
   ```
   pg_dump "postgresql://postgres:[MẬT-KHẨU]@db.<project>.supabase.co:5432/postgres" -Fc -f mrvu-backup-AAAA-MM-DD.dump
   ```
3. Chép tệp `.dump` sang nơi khác (ổ ngoài hoặc kho lưu trữ đám mây riêng). Không để chung với mã nguồn. Tệp chứa toàn bộ dữ liệu bán hàng.
4. Tần suất đề xuất: mỗi ngày sau khi đóng cửa; giữ ít nhất 30 bản.

Không đưa mật khẩu database vào mã nguồn hoặc tệp `.env` của ứng dụng.

## Khôi phục
Khôi phục vào một project Supabase **mới**, không ghi đè lên project đang chạy:
```
pg_restore --no-owner --clean --if-exists -d "postgresql://postgres:[MẬT-KHẨU-MỚI]@db.<project-mới>.supabase.co:5432/postgres" mrvu-backup-AAAA-MM-DD.dump
```
Sau đó trỏ `VITE_CAFE_SUPABASE_URL` / `VITE_CAFE_SUPABASE_ANON_KEY` sang project mới và build lại. Ảnh món (Storage) không nằm trong `pg_dump`; sao lưu riêng nếu cần.

## Hãy thử khôi phục một lần
Một bản sao lưu chưa từng thử khôi phục thì chưa chắc dùng được. Làm thử vào project phụ trước khi bán thật. Lệnh trên theo cách dùng chuẩn của pg_dump/pg_restore nhưng chưa được chạy trên project Supabase của bạn trong quá trình phát triển.
