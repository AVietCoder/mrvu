// @ts-nocheck
/**
 * Hai điểm DUY NHẤT gọi dịch vụ tốn tiền (giống bản Python): dfsPost (DataForSEO,
 * app.dfs_post) và claude (Anthropic, autopost.claude). Cả hai tự ghi chi phí.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SeoError } from "./core";
import { recordClaude, recordDfs } from "./costs";

// ---------------------------------------------------------------- DataForSEO
/** Gọi một endpoint DataForSEO, trả về [task, cost] hoặc ném SeoError có thông báo tiếng Việt. */
export async function dfsPost(cfg: any, path: string, payload: any, timeout = 180): Promise<[any, number]> {
  const token = Buffer.from(`${cfg.login}:${cfg.password}`).toString("base64");
  let res: Response;
  try {
    res = await fetch("https://api.dataforseo.com" + path, {
      method: path.includes("/task_get/") ? "GET" : "POST",
      headers: { Authorization: "Basic " + token, "Content-Type": "application/json" },
      body: path.includes("/task_get/") ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout * 1000),
    });
  } catch (e: any) {
    throw new SeoError(`Không kết nối được DataForSEO: ${e?.name === "TimeoutError" ? "hết thời gian chờ" : e?.cause?.code || e?.message}`);
  }
  if (res.status === 401) throw new SeoError("Sai tài khoản hoặc mật khẩu API DataForSEO. Kiểm tra DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.");
  if (!res.ok) throw new SeoError(`DataForSEO trả lỗi HTTP ${res.status}.`);
  const data: any = await res.json();
  if (data.status_code !== 20000) throw new SeoError(`DataForSEO: ${data.status_message || "lỗi không xác định"}`);
  const task = (data.tasks || [{}])[0] || {};
  if (task.status_code !== 20000) {
    let msg = task.status_message || "lỗi không xác định";
    if (task.status_code === 40200) msg = "Tài khoản DataForSEO đã hết tiền. Nạp thêm số dư rồi thử lại.";
    const err: any = new SeoError(`DataForSEO (${task.status_code}): ${msg}`);
    err.code = task.status_code;
    throw err;
  }
  const cost = Number(task.cost || data.cost || 0);
  await recordDfs(path, cost);
  return [task, cost];
}

// ---------------------------------------------------------------- Claude
let _client: any = null;
function client(key: string) {
  if (!_client || _client.apiKey !== key) {
    // Một lần gọi viết bài có thể mất vài phút; thử lại tối đa 1 lần để không vượt giới hạn thời gian của Vercel.
    // authToken: null → không để biến ANTHROPIC_AUTH_TOKEN (nếu có trên máy) gửi kèm header lạ.
    _client = new Anthropic({ apiKey: key, authToken: null, timeout: 280_000, maxRetries: 1 });
  }
  return _client;
}
// Chuyển sang mô hình dự phòng khi Claude từ chối vì bộ lọc an toàn (server-side fallback).
let fallbackOk = true;

/**
 * Giống autopost.claude(cfg, prompt, max_tokens, system, tag): trả về [text, usage, stop_reason].
 * Dùng streaming để các bài dài không bị ngắt kết nối giữa chừng.
 */
export async function claude(cfg: any, prompt: string, maxTokens = 4000, system: string | null = null, tag: string | null = null): Promise<[string, any, string]> {
  const key = String(cfg.anthropic_api_key || "").trim();
  if (!key) throw new SeoError("Chưa có khóa Claude API. Đặt ANTHROPIC_API_KEY trong biến môi trường (xem .env.example).");
  const body: any = {
    model: cfg.anthropic_model || "claude-sonnet-5-5",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;
  const c = client(key);
  let msg: any;
  try {
    try {
      msg = fallbackOk
        ? await c.beta.messages.stream({ ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage()
        : await c.messages.stream(body).finalMessage();
    } catch (e: any) {
      // Mô hình / tài khoản không hỗ trợ fallback → gọi lại kiểu thường.
      if (fallbackOk && e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message))) {
        fallbackOk = false;
        msg = await c.messages.stream(body).finalMessage();
      } else throw e;
    }
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new SeoError(`Anthropic từ chối khóa Claude máy chủ đang dùng (ANTHROPIC_API_KEY …${key.slice(-4)}). Đối chiếu 4 ký tự cuối với khóa trong console.anthropic.com → API Keys; sửa biến môi trường trên Vercel rồi Redeploy (chạy trên máy thì khởi động lại npm run dev).`);
    }
    if (e instanceof Anthropic.APIError && /credit balance/i.test(String(e.message))) {
      throw new SeoError("Tài khoản Claude (Anthropic) đã hết credit. Vào console.anthropic.com → Settings → Billing để nạp thêm (đúng tổ chức chứa ANTHROPIC_API_KEY), đợi vài phút rồi thử lại.");
    }
    if (e instanceof Anthropic.APIError && e.status) throw new SeoError(`Claude API lỗi ${e.status}: ${e.error?.error?.message || e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new SeoError("Không kết nối được Claude API.");
    throw e;
  }
  const usage = { input_tokens: msg.usage?.input_tokens || 0, output_tokens: msg.usage?.output_tokens || 0 };
  await recordClaude(tag, usage);
  if (msg.stop_reason === "refusal") throw new SeoError("Claude từ chối xử lý yêu cầu này. Hãy sửa nội dung rồi thử lại.");
  const text = (msg.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return [text, usage, msg.stop_reason];
}
