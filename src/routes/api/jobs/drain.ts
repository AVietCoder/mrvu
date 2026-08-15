// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { drainMessageJobs } from "@/lib/zalo/drain";

/**
 * So sánh hằng thời gian. Băm cả hai về 32 byte trước để timingSafeEqual
 * không ném lỗi khi độ dài khác nhau — và để chính độ dài cũng không rò rỉ.
 */
function secretMatches(got: string, expected: string): boolean {
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Endpoint để pg_cron rút hàng đợi gửi tin (mỗi phút một lần).
 *
 * Đây là một trong hai chỗ BẮT BUỘC phải là HTTP route thật thay vì
 * createServerFn: pg_net gọi vào từ ngoài, không đi qua RPC của TanStack.
 *
 * ⚠️ BẢO VỆ: endpoint này gửi tin tốn tiền thật. Ai gọi được là ép hệ thống
 * gửi sạch hàng đợi bất cứ lúc nào. Bắt buộc có header x-job-secret khớp
 * JOB_DRAIN_SECRET, và so sánh theo kiểu không rò rỉ thời gian.
 */
export const Route = createFileRoute("/api/jobs/drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.JOB_DRAIN_SECRET;
        if (!expected) {
          return Response.json(
            { ok: false, error: "Chưa cấu hình JOB_DRAIN_SECRET" },
            { status: 500 },
          );
        }

        const got = request.headers.get("x-job-secret") ?? "";
        if (!secretMatches(got, expected)) {
          return Response.json({ ok: false, error: "Sai secret" }, { status: 401 });
        }

        try {
          const result = await drainMessageJobs();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json(
            { ok: false, error: String(e?.message ?? e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
