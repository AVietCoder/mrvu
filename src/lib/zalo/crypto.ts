import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Mã hoá access/refresh token của Zalo trước khi lưu DB.
 *
 * Lý do: token Zalo cho phép gửi tin thay mặt doanh nghiệp và TỐN TIỀN THẬT
 * theo từng tin. Bảng zalo_connections đã bật RLS deny-all, nhưng mã hoá là
 * lớp thứ hai — nếu service role key rò rỉ hoặc ai đó dump được DB thì thứ
 * họ đọc được vẫn chỉ là ciphertext.
 *
 * Khoá nằm ở ZALO_TOKEN_SECRET (server-only, KHÔNG có tiền tố VITE_).
 * Sinh khoá: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM chuẩn dùng nonce 12 byte

function getKey(): Buffer {
  const raw = process.env.ZALO_TOKEN_SECRET;
  if (!raw) {
    throw new Error(
      "Thiếu ZALO_TOKEN_SECRET. Sinh khoá bằng: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  // Chấp nhận hex 64 ký tự (đúng 32 byte). Chuỗi khác độ dài thì băm về 32 byte
  // để không vỡ, nhưng khuyến nghị dùng đúng hex 32 byte.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

/**
 * Trả về chuỗi base64 gói gọn iv + authTag + ciphertext, để lưu vừa 1 cột text.
 * Không dùng BYTEA vì PostgREST trả BYTEA về dạng hex `\x...`, phải giải mã
 * thêm một lớp ở client — text base64 gọn hơn và không mất mát.
 */
export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const enc = buf.subarray(IV_LEN + 16);

  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  // Sai khoá hoặc dữ liệu bị sửa → final() ném lỗi. Đó là hành vi mong muốn:
  // thà hỏng to còn hơn im lặng gửi tin bằng token rác.
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Khoá chống gửi trùng. Cùng một đối tượng + cùng một loại tin → luôn ra cùng
 * một khoá, nên lần enqueue thứ hai bị UNIQUE constraint của DB chặn lại.
 *
 * ⚠️ NHÁNH CŨ PHẢI BẤT BIẾN TỪNG BYTE.
 * Các job `order_completed` đã nằm sẵn trong DB với khoá sha256(conn|order|code).
 * Đổi công thức → enqueue lại một đơn cũ sẽ sinh khoá khác → UNIQUE không chặn
 * được nữa → KHÁCH NHẬN TIN LẦN HAI và mất tiền thật. Vì vậy nhánh cũ giữ
 * nguyên, tin kiểu mới đi qua nhánh "v2" tách biệt.
 *
 * Phạm vi chống trùng (`scope`) theo từng loại tin:
 *
 *   order_completed → nhánh cũ, 1 tin / đơn / vĩnh viễn.
 *   birthday        → scope "d:<ngày VN>"  — 1 tin / khách / ngày.
 *                     Bấm gửi 5 lần trong ngày vẫn chỉ ra 1 tin.
 *   maintenance     → scope "o:<hash danh sách đơn>" — 1 tin / BỘ ĐƠN đến hạn.
 *                     Không dùng scope theo ngày: khi quét bù (p_window_days),
 *                     khách đã nhắc hôm qua vẫn còn trong danh sách hôm nay,
 *                     scope-ngày sẽ cho gửi lại. Sang kỳ sau có đơn mới đến
 *                     hạn → bộ đơn đổi → khoá đổi → gửi được.
 */
export function buildIdempotencyKey(parts: {
  connectionId: string;
  templateCode: string;
  orderId?: string | null;
  customerId?: string | null;
  scope?: string | null;
}): string {
  // ── Nhánh cũ (order_completed): KHÔNG ĐƯỢC SỬA ──
  if (parts.orderId && !parts.customerId && !parts.scope) {
    return createHash("sha256")
      .update([parts.connectionId, parts.orderId, parts.templateCode].join("|"))
      .digest("hex");
  }

  return createHash("sha256")
    .update(
      [
        "v2",
        parts.connectionId,
        parts.templateCode,
        parts.customerId ?? "",
        parts.orderId ?? "",
        parts.scope ?? "",
      ].join("|"),
    )
    .digest("hex");
}

/**
 * Rút gọn danh sách id đơn thành một chuỗi ổn định để làm scope.
 * Sắp xếp trước để thứ tự trả về từ DB không làm đổi khoá.
 */
export function orderSetScope(orderIds: string[]): string {
  const sorted = [...new Set(orderIds.filter(Boolean))].sort();
  return "o:" + createHash("sha1").update(sorted.join(",")).digest("hex").slice(0, 16);
}
