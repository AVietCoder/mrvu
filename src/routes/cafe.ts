// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";

/**
 * MR.VŨ COFFEE POS ở /cafe — ứng dụng RIÊNG (Supabase / đăng nhập / database riêng), chỉ ở chung domain.
 * Mã nguồn: mrvu-coffee-pos/. `npm run build` chạy scripts/build-cafe.mjs → public/cafe/ (index.html + assets/).
 * Route này chỉ trả index.html của POS cho /cafe và /cafe/; assets do public/ phục vụ,
 * các màn hình bên trong nằm sau dấu # (/cafe#/pos) nên không cần route con.
 */
// Handler viết trực tiếp trong `server` để trình biên dịch TanStack bỏ hẳn khỏi bản build trình duyệt.
export const Route = createFileRoute("/cafe")({
  server: {
    handlers: {
      GET: async () => {
        const html = Object.values(
          import.meta.glob("../../public/cafe/index.html", { query: "?raw", import: "default", eager: true }),
        )[0];
        if (!html) {
          return new Response("Chưa build POS: chạy `node scripts/build-cafe.mjs` rồi tải lại trang.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // Mỗi lần build tên tệp assets đổi → luôn lấy index.html mới.
            "cache-control": "no-cache",
            "x-robots-tag": "noindex, nofollow",
          },
        });
      },
    },
  },
});
