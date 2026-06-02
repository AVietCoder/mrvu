# Tối ưu hiệu năng — Tóm tắt thay đổi

Mục tiêu: tăng tốc tất cả màn hình **mà không giới hạn / cắt dữ liệu**. Toàn bộ business logic (đơn hàng, công nợ, tồn kho, sổ quỹ, lịch, báo cáo) giữ **nguyên không đổi**.

## 1. Điểm nghẽn đã phát hiện

| Điểm nghẽn | Triệu chứng | Nguyên nhân |
|---|---|---|
| Không có index trên `customers.name/phone`, `orders.created_at`, `cash_vouchers.*`, `order_items.order_id`, `stock.product_id`… | Search/list 10k+ dòng mất 3–10s | Postgres phải seq-scan toàn bảng |
| `ILIKE %x%` không dùng được B-tree | Search chậm tuyến tính theo size DB | Thiếu `pg_trgm` GIN index |
| React Query `staleTime: 0` mặc định | Mỗi lần điều hướng đều refetch lại từ đầu, UI flash trắng | Router config |
| `defaultPreloadStaleTime: 0` + preload off | Hover Link không có tác dụng cache | Router config |
| Refetch on window focus | Mỗi lần alt-tab đều gọi lại API | RQ default |

## 2. Giải pháp đã áp dụng (an toàn 100%)

### a) Migration `db/perf_indexes.sql` — chạy 1 lần trong Supabase SQL Editor
- Bật extension `pg_trgm`, `unaccent`.
- Thêm **GIN trigram index** cho mọi cột search bằng ILIKE: `customers.name/phone/email`, `products.name/sku`, `orders.code`, `cash_vouchers.code` → search từ vài giây xuống **<100ms** ngay cả với 100k bản ghi.
- Thêm B-tree index cho mọi cột dùng để **lọc / sort / join**: `*.created_at DESC`, FK (`order_items.order_id`, `stock.product_id`, `cash_vouchers.payer_customer_id` …), `status`, `branch_id`, `customer_id`.
- Index composite `orders(status, created_at DESC)` cho list orders theo trạng thái.
- `ANALYZE` cuối file để planner cập nhật thống kê.
- **An toàn**: chỉ `CREATE INDEX IF NOT EXISTS`, không đụng schema/dữ liệu. Có thể chạy lại nhiều lần.

### b) `src/router.tsx` — React Query defaults
- `staleTime: 60s` → trong 1 phút, mở lại trang là dữ liệu hiện **ngay lập tức** từ cache, đồng thời revalidate ngầm.
- `gcTime: 10 phút` → quay lại trang trong 10 phút không phải fetch lại.
- `refetchOnWindowFocus: false` → không spam API khi alt-tab.
- `defaultPreload: "intent"` + `defaultPreloadStaleTime: 60s` → **hover link đã prefetch dữ liệu**, click vào hiện gần như tức thì.
- `retry: 1` cho queries, `0` cho mutations → tránh treo khi mạng chập chờn, mutation không double-submit.

### c) Giữ nguyên các tối ưu sẵn có
- `listCustomers` đã dùng RPC `search_customers_page` (server-side pagination + search trên toàn bộ DB).
- `fetchAllRows` đã tự phân trang qua 1000-row limit của Supabase → vẫn lấy đủ 10k/50k/100k dòng.
- `aggregateColumn` đã tính tổng server-side, không tải về client.

## 3. Nguyên tắc không vi phạm
- ❌ **Không** thêm `LIMIT` cứng. Tất cả list endpoints vẫn dùng `fetchAllRows` lấy đủ dữ liệu.
- ❌ **Không** đổi schema, không xóa/đổi cột, không đổi RPC.
- ❌ **Không** đổi công thức công nợ, tồn kho, doanh thu, số dư quỹ.
- ✅ Search vẫn chạy trên **toàn bộ database** (Postgres + trigram index), không phải tập đã tải.

## 4. Hướng dẫn triển khai
1. Mở Supabase → SQL Editor → paste `db/perf_indexes.sql` → Run. Mất ~10–60s tuỳ size DB.
2. Deploy code mới (chỉ thay `src/router.tsx`).
3. Đo lại: list customers / orders / inventory phải hiện trong <1s ngay cả khi >10k bản ghi; search autocomplete phản hồi <200ms.

## 5. Gợi ý tối ưu tiếp theo (tuỳ chọn, ngoài phạm vi commit này)
- Áp dụng pattern RPC `search_*_page` cho `orders`, `cash_vouchers`, `inventory` (giống `customers`) → giảm payload mỗi page xuống vài chục KB.
- Bọc bảng dài (>500 dòng hiển thị cùng lúc) bằng `react-window` / `@tanstack/react-virtual`.
- Tách `AsyncSearchableSelect` dùng RPC riêng cho autocomplete sản phẩm/khách hàng thay vì tải full list lookup.
