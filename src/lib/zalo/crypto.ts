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
 * Khoá chống gửi trùng. Cùng một đơn + cùng một loại tin → luôn ra cùng một
 * khoá, nên lần enqueue thứ hai bị UNIQUE constraint của DB chặn lại.
 */
export function buildIdempotencyKey(parts: {
  connectionId: string;
  orderId: string;
  templateCode: string;
}): string {
  return createHash("sha256")
    .update([parts.connectionId, parts.orderId, parts.templateCode].join("|"))
    .digest("hex");
}
