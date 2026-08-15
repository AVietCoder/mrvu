import { getSupabaseAdmin } from "./admin-client";
import { loadConnection, sendZns, type ZaloConnection } from "./client";
import { uid, now } from "../supabase";

/**
 * Rút hàng đợi và gửi tin.
 *
 * Chạy trên serverless nên không có worker thường trú: pg_cron gọi endpoint
 * /api/jobs/drain mỗi phút, mỗi lần xử lý một lô nhỏ rồi thoát. Vì vậy:
 *
 *  • Lô nhỏ (mặc định 50) để không chạm giới hạn thời gian của serverless.
 *  • Giành job qua RPC claim_message_jobs — dùng FOR UPDATE SKIP LOCKED nên
 *    hai lần cron chồng nhau không xử lý trùng một job.
 *  • Thất bại thì lùi theo cấp số nhân (1, 2, 4, 8... phút), hết lượt thì
 *    đánh FAILED để người dùng thấy trên lịch sử thay vì lặp vô hạn.
 */

const BATCH = 50;

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  retrying: number;
  skipped: string[];
}

/** Lùi lịch theo cấp số nhân, chặn trần 60 phút. */
function backoffMinutes(attempts: number): number {
  return Math.min(60, Math.pow(2, Math.max(0, attempts - 1)));
}

export async function drainMessageJobs(limit = BATCH): Promise<DrainResult> {
  const db = getSupabaseAdmin();
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, retrying: 0, skipped: [] };

  const { data: claimed, error } = await db.rpc("claim_message_jobs", { p_limit: limit });
  if (error) throw new Error(`Không giành được job: ${error.message}`);

  const jobs = (claimed ?? []) as any[];
  result.claimed = jobs.length;
  if (!jobs.length) return result;

  // Kết nối OA dùng chung cho cả lô — tránh giải mã + refresh token 50 lần.
  let conn: ZaloConnection | null = null;
  try {
    conn = await loadConnection();
  } catch (e: any) {
    conn = null;
    result.skipped.push(String(e?.message ?? e));
  }

  for (const job of jobs) {
    // Không có kết nối thì trả job về hàng đợi, đừng đốt lượt thử.
    if (!conn) {
      await db
        .from("message_jobs")
        .update({
          status: "RETRYING",
          attempts: Math.max(0, Number(job.attempts) - 1),
          last_error: "Chưa nối Zalo OA",
          scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        })
        .eq("id", job.id);
      result.retrying++;
      continue;
    }

    const payload = (job.payload ?? {}) as any;
    const templateId = String(payload.zalo_template_id ?? "");
    const templateData = (payload.template_data ?? {}) as Record<string, string>;

    let res;
    try {
      res = await sendZns(conn, {
        phone: job.recipient_phone,
        templateId,
        templateData,
        // tracking_id để đối chiếu khi cần tra với Zalo.
        trackingId: job.id,
      });
    } catch (e: any) {
      res = { ok: false, errorCode: -1, errorMessage: String(e?.message ?? e), billable: false };
    }

    // Ghi lịch sử TRƯỚC khi đổi trạng thái job: nếu tiến trình chết giữa
    // chừng, thà có log thừa còn hơn gửi rồi mà không có dấu vết.
    await db.from("message_logs").insert({
      id: uid(),
      job_id: job.id,
      connection_id: job.connection_id,
      customer_id: job.customer_id,
      order_id: job.order_id,
      template_id: job.template_id,
      recipient_phone: job.recipient_phone,
      content: JSON.stringify(templateData),
      provider_message_id: res.ok ? res.msgId ?? null : null,
      status: res.ok ? "SENT" : "FAILED",
      billable: res.billable,
      error_code: res.ok ? null : String(res.errorCode ?? ""),
      error_message: res.ok ? null : res.errorMessage ?? null,
      sent_at: res.ok ? now() : null,
      failed_at: res.ok ? null : now(),
      created_at: now(),
    });

    if (res.ok) {
      await db
        .from("message_jobs")
        .update({ status: "SENT", last_error: null, locked_at: null })
        .eq("id", job.id);
      result.sent++;
      continue;
    }

    const attempts = Number(job.attempts ?? 1);
    const maxAttempts = Number(job.max_attempts ?? 5);
    const errText = `${res.errorCode}: ${res.errorMessage}`;

    if (attempts >= maxAttempts) {
      await db
        .from("message_jobs")
        .update({ status: "FAILED", last_error: errText, locked_at: null })
        .eq("id", job.id);
      result.failed++;
    } else {
      await db
        .from("message_jobs")
        .update({
          status: "RETRYING",
          last_error: errText,
          locked_at: null,
          scheduled_at: new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
        })
        .eq("id", job.id);
      result.retrying++;
    }
  }

  return result;
}
