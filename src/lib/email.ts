/**
 * Tầng gửi email dùng chung — CHỖ DUY NHẤT trong repo gọi Resend.
 *
 * Trước đây việc gửi mail nằm gọn trong `sendOrderNotificationEmail` của
 * orders.functions.ts: HTML hardcode, chỉ gửi cho admin, và `fetch` xong thì
 * VỨT LUÔN kết quả — Resend trả 422 (domain chưa xác thực, địa chỉ sai) mà hệ
 * thống vẫn coi như đã gửi thành công. Module này giữ nguyên cách gửi đó
 * nhưng kiểm tra phản hồi và cho tái sử dụng ở nơi khác.
 *
 * ⚠️ SERVER-ONLY. Không import từ file .tsx — RESEND_API_KEY không có tiền tố
 * VITE_ nên ở client sẽ là undefined.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailResult {
  ok: boolean;
  /** Có lý do ở đây nghĩa là KHÔNG gửi, và cũng không phải lỗi hệ thống. */
  skipped?: string;
  error?: string;
  id?: string;
}

/**
 * Gửi một email. Không bao giờ ném lỗi — trả kết quả để nơi gọi quyết định.
 *
 * Địa chỉ người gửi giữ nguyên hành vi cũ: `${siteName} <noreply@ttv.vn>`,
 * cho phép đổi qua biến môi trường EMAIL_FROM mà không phải sửa code.
 */
export async function sendEmail(params: {
  to: string[];
  subject: string;
  html: string;
  siteName: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, skipped: "Chưa cấu hình RESEND_API_KEY" };

  const to = params.to.map((t) => String(t || "").trim()).filter(Boolean);
  if (!to.length) return { ok: false, skipped: "Không có địa chỉ nhận" };

  const fromAddress = process.env.EMAIL_FROM || "noreply@ttv.vn";

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${params.siteName} <${fromAddress}>`,
        to,
        subject: params.subject,
        html: params.html,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    const body: any = await res.json().catch(() => ({}));

    // Đây là phần code cũ thiếu. Resend trả 4xx kèm message rất rõ ràng
    // (domain chưa verify, địa chỉ không hợp lệ...) — không đọc thì mọi lỗi
    // gửi mail đều im lặng.
    if (!res.ok) {
      return {
        ok: false,
        error: body?.message || body?.error?.message || `Resend trả HTTP ${res.status}`,
      };
    }

    return { ok: true, id: body?.id };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * Thay biến dạng {Ten_Bien} trong chuỗi template.
 * Giữ đúng cú pháp mà `print_templates` trong trang Quản trị đang dùng, để
 * người dùng không phải học thêm kiểu viết thứ hai.
 * Biến không có dữ liệu → thay bằng chuỗi rỗng, không để lộ "{Ten_Bien}" ra
 * email gửi cho khách.
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key) => vars[key] ?? "");
}

/** Escape HTML cho dữ liệu do người dùng nhập, tránh vỡ layout hoặc chèn thẻ. */
export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Khung email chuẩn — bóc từ HTML sẵn có của email đơn hàng để email mới
 * trông đồng bộ với email cũ, thay vì mỗi nơi một kiểu.
 */
export function baseEmailHtml(params: {
  siteName: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  footer?: string;
}): string {
  const footer =
    params.footer?.trim() ||
    `Email tự động từ ${escapeHtml(params.siteName)} — Không trả lời email này`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(params.title)}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <tr><td style="background:#111;padding:24px 32px;color:#fff">
          <div style="font-size:13px;opacity:0.85;margin-bottom:4px">${escapeHtml(params.siteName)}</div>
          <div style="font-size:22px;font-weight:700">${escapeHtml(params.title)}</div>
          ${params.subtitle ? `<div style="font-size:13px;opacity:0.85;margin-top:6px">${escapeHtml(params.subtitle)}</div>` : ""}
        </td></tr>
        <tr><td style="padding:24px 32px;font-size:15px;color:#111;line-height:1.6">${params.bodyHtml}</td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
          <div style="font-size:12px;color:#9ca3af;text-align:center">${footer}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
