# QuatTran POS — Phần mềm quản lý bán quạt trần

Phần mềm gồm đủ 7 module theo yêu cầu: **Hàng hóa, Tồn kho, Bán hàng, Khách hàng, Nhân viên, Báo cáo, Đa chi nhánh.**
Built với **TanStack Start (React 19) + TypeScript + TailwindCSS + Postgres**.

> Khi chạy lần đầu (chưa cấu hình database), app dùng **dữ liệu mẫu trong RAM** để bạn xem ngay UI.
> Khi cấu hình `DATABASE_URL` (Vercel Postgres / Neon / Supabase Postgres / bất kỳ Postgres nào), dữ liệu sẽ persist thật.

---

## 1. Tải mã nguồn về máy

Trong giao diện Lovable, bấm nút **GitHub → Connect to GitHub** ở góc trên bên phải để đẩy project sang GitHub của bạn. Sau đó:

```bash
git clone https://github.com/<username>/<repo>.git quattran-pos
cd quattran-pos
```

Hoặc dùng **Download ZIP** từ menu nếu đã bật, giải nén rồi `cd` vào thư mục.

## 2. Chạy ở máy local (development)

Yêu cầu: **Node.js >= 20** và **bun** (`npm i -g bun`) hoặc dùng `npm`.

```bash
bun install        # hoặc: npm install
bun run dev        # hoặc: npm run dev
```

Mở trình duyệt: **http://localhost:8080**

Tài khoản / dữ liệu mẫu đã được seed sẵn (sản phẩm Mitsubishi, Panasonic, KDK; 4 khách; 4 nhân viên; 2 chi nhánh).

## 3. Build cho production

```bash
bun run build
bun run preview    # chạy thử bản production tại http://localhost:8080
```

## 4. Cấu hình database thật (Vercel Postgres)

> Bước này bắt buộc nếu bạn deploy lên server thật, vì serverless không giữ RAM giữa các request.

### 4.1. Tạo database trên Vercel
1. Vào https://vercel.com → **Storage → Create Database → Postgres** (Neon-powered, miễn phí 256MB).
2. Sau khi tạo xong, vào tab **`.env.local`** sao chép biến `DATABASE_URL` (hoặc `POSTGRES_URL`).

### 4.2. Tạo schema
Mở Vercel Postgres → tab **Query**, dán nội dung file [`db/schema.sql`](./db/schema.sql) và chạy.
Hoặc dùng `psql`:
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

### 4.3. Cắm DATABASE_URL vào project
Tạo file `.env.local` ở thư mục gốc:
```
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
```

> Khi bật biến này, hãy thay file `src/server/store.server.ts` bằng adapter thật. Mẫu adapter rất đơn giản:
> ```ts
> import postgres from "postgres";
> const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });
> // ví dụ: const products = await sql<Product[]>`SELECT * FROM products`;
> ```
> Bạn có thể thay thế dần từng server function (file `src/lib/*.functions.ts`) — interface giữ nguyên nên UI không cần sửa.

## 5. Deploy lên Vercel

### 5.1. Đổi adapter sang Vercel
Trong `vite.config.ts` đổi target sang `vercel`:
```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
export default defineConfig({
  tanstackStart: { server: { entry: "server" }, target: "vercel" },
});
```
Xóa hoặc bỏ qua file `wrangler.jsonc` (chỉ dùng cho Cloudflare).

### 5.2. Push code lên GitHub
```bash
git add . && git commit -m "deploy" && git push
```

### 5.3. Import vào Vercel
1. Vào https://vercel.com/new → chọn repo vừa push.
2. Framework preset: **Other** (Vercel tự nhận TanStack Start qua Vite).
3. Build command: `bun run build` — Output: `.output` (mặc định).
4. Environment variables → thêm `DATABASE_URL`.
5. Bấm **Deploy**. Sau ~1 phút bạn có URL `https://<ten-du-an>.vercel.app`.

### 5.4. (Tuỳ chọn) gắn domain riêng
Vercel → Project → **Settings → Domains** → thêm tên miền của bạn.

---

## 6. Cấu trúc thư mục

```
src/
  routes/                 # các trang (file-based routing)
    index.tsx             # Tổng quan
    products.tsx          # Hàng hóa
    inventory.tsx         # Tồn kho (nhập/xuất/chuyển)
    orders.tsx            # Bán hàng
    customers.tsx         # Khách hàng + công nợ
    employees.tsx         # Nhân viên + nhật ký
    reports.tsx           # Báo cáo + xuất CSV
    branches.tsx          # Chi nhánh
  lib/                    # server functions (RPC) cho từng module
  server/store.server.ts  # in-memory store / chỗ thay Postgres adapter
  components/AppShell.tsx # layout sidebar
db/schema.sql             # schema PostgreSQL đầy đủ 11 bảng
```

## 7. Tính năng đã có (theo file yêu cầu)

| Module | Tính năng |
|---|---|
| 1. Hàng hóa | Danh mục, SKU, thuộc tính (thương hiệu, công suất, màu, size cánh), giá vốn/giá bán |
| 2. Tồn kho | Tồn theo (sản phẩm × chi nhánh), nhập/xuất/chuyển kho, cảnh báo dưới mức tối thiểu |
| 3. Bán hàng | Tạo đơn, chiết khấu hóa đơn / dòng, đặt cọc, đặt trước, hoàn tất → trừ kho + ghi công nợ |
| 4. Khách hàng | CRUD, phân nhóm (lẻ/đại lý/VIP/công trình), công nợ, ghi nhận thanh toán, lịch sử mua |
| 5. Nhân viên | CRUD, phân quyền 4 vai trò (admin/manager/cashier/warehouse), nhật ký hành động |
| 6. Báo cáo | Doanh thu 14 ngày, top sản phẩm, tồn kho thấp, công nợ, theo NV/chi nhánh, xuất CSV |
| 7. Chi nhánh | CRUD, so sánh hiệu quả các chi nhánh, chuyển hàng giữa kho |

## 8. Câu hỏi thường gặp

- **Mất dữ liệu sau khi deploy?** Đúng vì serverless không giữ RAM. Hãy gắn `DATABASE_URL` (mục 4).
- **Có thể chạy offline trong cửa hàng?** Có — chạy `bun run dev` trên 1 PC trong mạng LAN, các máy khác truy cập qua IP.
- **Có thể tự host trên VPS?** Có. Cài Node 20, `bun run build`, rồi chạy `node .output/server/index.mjs` (đặt sau Nginx + PM2).
