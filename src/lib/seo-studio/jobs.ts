// @ts-nocheck
/**
 * Tác vụ dài — thay cho JOBS (dict trong bộ nhớ) + threading.Thread của bản Python.
 *
 * Vercel không giữ tiến trình chạy nền, nên tác vụ được chia thành BƯỚC: mỗi lần
 * trình duyệt hỏi GET .../job/<id> (giao diện cũ vẫn hỏi 1–1,5 giây/lần) thì server
 * chạy một bước rồi lưu trạng thái vào bảng seo_jobs. Đóng trang thì tác vụ dừng;
 * mở lại trang và hỏi tiếp thì chạy tiếp từ chỗ dừng.
 *
 * Hợp đồng trả về giữ nguyên bản gốc: {status: running|done|error, message, result?, ...extra}.
 */
import { SeoError, hex, one, run } from "./core";

/** Thời gian tối đa cho các vòng lặp nhỏ (crawl, đồng bộ…) trong một bước. */
export const STEP_BUDGET_MS = 40_000;
/** Khóa một tác vụ trong lúc đang chạy bước (lớn hơn thời gian chạy tối đa của hàm). */
const LOCK_SECONDS = 310;

type Step = (job: any, ctx: { deadline: number; progress: (m: string) => void; extra: any }) => Promise<{ done?: any } | void>;
const STEPS: Record<string, Step> = {};

export function registerStep(kind: string, fn: Step) {
  STEPS[kind] = fn;
}

export async function startJob(kind: string, state: any, message = "Đang bắt đầu…", extra: any = {}, auto = false): Promise<string> {
  const id = hex(10);
  await run("INSERT INTO seo_jobs(id, kind, status, message, state, extra, auto) VALUES (?,?,'running',?,?::text::jsonb,?::text::jsonb,?)",
    [id, kind, message, JSON.stringify(state), JSON.stringify(extra), auto]);
  return id;
}

function view(row: any) {
  if (!row) return { status: "error", message: "Không tìm thấy tác vụ" };
  const out: any = { ...(row.extra || {}), status: row.status, message: row.message || "" };
  if (row.result !== null && row.result !== undefined) out.result = row.result;
  return out;
}

export async function jobView(id: string) {
  return view(await one("SELECT * FROM seo_jobs WHERE id=?", [id]));
}

/** Chạy MỘT bước của tác vụ (nếu chưa có ai đang chạy) rồi trả trạng thái mới. */
export async function advance(id: string) {
  const claimed = await one(
    `UPDATE seo_jobs SET locked_until = now() + interval '${LOCK_SECONDS} seconds', updated_at = now()
     WHERE id=? AND status='running' AND (locked_until IS NULL OR locked_until < now()) RETURNING *`,
    [id],
  );
  if (!claimed) return jobView(id);
  const job = { ...claimed, state: claimed.state || {}, extra: claimed.extra || {} };
  const fn = STEPS[job.kind];
  let status = "running", message = job.message, result = null, extra = job.extra;
  try {
    if (!fn) throw new SeoError("Loại tác vụ không hợp lệ");
    const ctx = { deadline: Date.now() + STEP_BUDGET_MS, progress: (m: string) => (message = m), extra };
    const r = await fn(job, ctx);
    if (r && "done" in r) {
      status = "done";
      result = r.done ?? null;
      if (message === job.message || !message) message = "Xong";
    }
  } catch (e: any) {
    status = "error";
    message = String(e?.message || e);
    if (!(e instanceof SeoError)) console.error("[seo job]", job.kind, e);
  }
  await run(
    "UPDATE seo_jobs SET status=?, message=?, result=?::text::jsonb, state=?::text::jsonb, extra=?::text::jsonb, locked_until=NULL, attempts=attempts+1, updated_at=now() WHERE id=?",
    [status, message, result === null ? null : JSON.stringify(result), JSON.stringify(job.state), JSON.stringify(extra), id],
  );
  return jobView(id);
}

/** Dọn tác vụ cũ (gọi thỉnh thoảng). */
export async function cleanupJobs() {
  await run("DELETE FROM seo_jobs WHERE updated_at < now() - interval '3 days'");
}
