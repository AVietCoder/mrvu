// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { dispatch } from "@/lib/seo-studio/app";

/**
 * SEO Studio (chỉ admin): toàn bộ /seo-studio/* là HTTP route thật — trang HTML của công cụ,
 * API của các tab, đăng nhập Google và /seo-studio/cron (pg_cron gọi để tự đăng bài).
 * Cửa chặn thật nằm trong dispatch(): phiên đăng nhập Google + danh sách SEO_ALLOWED_EMAILS.
 * Thời gian chạy tối đa của nhóm đường dẫn này đặt trong vite.config.ts (nitro functionRules).
 */
// Handler viết trực tiếp trong `server` để trình biên dịch TanStack bỏ hẳn khỏi bản build trình duyệt.
export const Route = createFileRoute("/seo-studio/$")({
  server: {
    handlers: {
      GET: async ({ request }) => dispatch(request),
      HEAD: async ({ request }) => dispatch(request),
      POST: async ({ request }) => dispatch(request),
      DELETE: async ({ request }) => dispatch(request),
    },
  },
});
