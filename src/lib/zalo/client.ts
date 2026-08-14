import { getSupabaseAdmin } from "./admin-client";
import { decryptToken, encryptToken } from "./crypto";

/**
 * Tầng giao tiếp với Zalo OA OpenAPI.
 *
 * Hai thứ nguy hiểm nhất được xử lý ở đây:
 *
 * 1) REFRESH TOKEN XOAY VÒNG. Mỗi lần refresh, Zalo trả refresh token MỚI và
 *    vô hiệu cái cũ. Hai request refresh chạy song song → cái chậm hơn dùng
 *    refresh token đã chết → ĐỨT KẾT NỐI VĨNH VIỄN, phải vào nối lại OA bằng
 *    tay. Vì vậy mọi lần refresh đều phải qua khoá phân tán (refresh_lock_at).
 *
 * 2) TOKEN KHÔNG BAO GIỜ Ở DẠNG PLAINTEXT TRONG DB. Đọc ra thì giải mã trong
 *    bộ nhớ, ghi xuống thì mã hoá lại.
 *
 * ⚠️ File này CHỈ chạy phía server. Không import từ .tsx.
 */

const OAUTH_BASE = "https://oauth.zaloapp.com/v4/oa";
const API_BASE = "https://business.openapi.zalo.me";

/** Refresh sớm 10 phút trước khi hết hạn, đừng đợi tới lúc token chết. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
/** Khoá refresh coi như treo sau 60s (tiến trình cũ đã chết giữa chừng). */
const LOCK_TTL_MS = 60 * 1000;

export interface ZaloConnection {
  id: string;
  oa_id: string;
  oa_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  refresh_lock_at: string | null;
  status: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── OAuth ────────────────────────────────────────────────────────────────

/**
 * Đổi authorization code lấy token lần đầu (lúc nối OA).
 * Zalo v4 dùng PKCE nên phải kèm code_verifier đúng với code_challenge đã gửi.
 */
export async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    code,
    app_id: requireEnv("ZALO_APP_ID"),
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${OAUTH_BASE}/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      secret_key: requireEnv("ZALO_APP_SECRET"),
    },
    body,
  });

  const json: any = await res.json().catch(() => ({}));
  if (!json?.access_token) {
    throw new Error(
      `Zalo từ chối cấp token: ${json?.error_name || json?.error_description || JSON.stringify(json)}`,
    );
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

async function callRefresh(refreshToken: string) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    app_id: requireEnv("ZALO_APP_ID"),
    grant_type: "refresh_token",
  });

  const res = await fetch(`${OAUTH_BASE}/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      secret_key: requireEnv("ZALO_APP_SECRET"),
    },
    body,
  });

  const json: any = await res.json().catch(() => ({}));
  if (!json?.access_token) {
    throw new Error(
      `Refresh token thất bại: ${json?.error_name || json?.error_description || JSON.stringify(json)}`,
    );
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

// ─── Token lifecycle ──────────────────────────────────────────────────────

export async function loadConnection(connectionId?: string): Promise<ZaloConnection | null> {
  const db = getSupabaseAdmin();
  let q = db.from("zalo_connections").select("*").eq("status", "connected").limit(1);
  if (connectionId) q = db.from("zalo_connections").select("*").eq("id", connectionId).limit(1);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as any) ?? null;
}

/**
 * Trả access token còn hạn. Tự refresh khi sắp hết hạn, có khoá chống race.
 */
export async function getValidAccessToken(conn: ZaloConnection): Promise<string> {
  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return decryptToken(conn.access_token_enc);
  }

  const db = getSupabaseAdmin();
  const lockCutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();

  // Giành khoá bằng UPDATE có điều kiện — Postgres đảm bảo chỉ 1 request thắng.
  const { data: locked, error: lockErr } = await db
    .from("zalo_connections")
    .update({ refresh_lock_at: new Date().toISOString() })
    .eq("id", conn.id)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${lockCutoff}`)
    .select("*");

  if (lockErr) throw new Error(lockErr.message);

  if (!locked || locked.length === 0) {
    // Request khác đang refresh. Chờ nó xong rồi đọc lại, TUYỆT ĐỐI không tự
    // refresh song song — làm thế là mất refresh token.
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      const fresh = await loadConnection(conn.id);
      if (fresh && new Date(fresh.token_expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) {
        return decryptToken(fresh.access_token_enc);
      }
    }
    throw new Error("Chờ refresh token quá lâu, thử lại sau.");
  }

  const current = locked[0] as any as ZaloConnection;

  try {
    const t = await callRefresh(decryptToken(current.refresh_token_enc));
    const { error: upErr } = await db
      .from("zalo_connections")
      .update({
        access_token_enc: encryptToken(t.accessToken),
        refresh_token_enc: encryptToken(t.refreshToken),
        token_expires_at: new Date(Date.now() + t.expiresInSec * 1000).toISOString(),
        refresh_lock_at: null,
        status: "connected",
        last_error: null,
        last_sync_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    if (upErr) throw new Error(upErr.message);

    return t.accessToken;
  } catch (e: any) {
    // Refresh hỏng = kết nối coi như đứt. Ghi rõ lỗi để trang cài đặt hiển thị
    // cho người dùng biết phải nối lại OA, thay vì âm thầm không gửi được tin.
    await db
      .from("zalo_connections")
      .update({
        refresh_lock_at: null,
        status: "error",
        last_error: String(e?.message ?? e),
      })
      .eq("id", conn.id);
    throw e;
  }
}

// ─── Gọi API ──────────────────────────────────────────────────────────────

async function apiGet(conn: ZaloConnection, path: string, params: Record<string, string>) {
  const token = await getValidAccessToken(conn);
  const url = `${API_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { access_token: token } });
  return (await res.json().catch(() => ({}))) as any;
}

/**
 * Đọc thông tin 1 template ZNS — trả về danh sách biến mà template khai báo.
 * Đây là cách DUY NHẤT để biết chắc template cần những param nào; đoán tên
 * biến rồi gửi sẽ bị Zalo từ chối.
 */
export async function getTemplateInfo(conn: ZaloConnection, templateId: string) {
  // Đường dẫn ĐÚNG là /template/info/v2. Bản không có /v2 trả lỗi -106
  // "Method unsupported" với cả GET lẫn POST — đã dò trực tiếp trên API thật
  // để xác định, đừng đổi lại.
  const json = await apiGet(conn, "/template/info/v2", { template_id: templateId });
  if (json?.error !== 0) {
    throw new Error(`Zalo trả lỗi ${json?.error}: ${json?.message ?? "không rõ"}`);
  }
  return json.data as {
    templateId: number;
    templateName: string;
    status: string;
    /** TRANSACTION | PROMOTION | OTP... — quyết định luật gửi và giá tin. */
    templateTag?: string;
    /** Giá mỗi tin (VNĐ), Zalo trả về dạng chuỗi. */
    price?: string;
    previewUrl?: string;
    reason?: string;
    timeout?: number;
    listParams: Array<{
      name: string;
      require: boolean;
      type: string;
      maxLength?: number;
      minLength?: number;
      acceptNull?: boolean;
    }>;
  };
}

/** Liệt kê các template ZNS của OA (để chọn trong UI thay vì gõ tay ID). */
export async function listTemplates(conn: ZaloConnection) {
  const json = await apiGet(conn, "/template/all", { offset: "0", limit: "100" });
  if (json?.error !== 0) {
    throw new Error(`Zalo trả lỗi ${json?.error}: ${json?.message ?? "không rõ"}`);
  }
  return (json.data ?? []) as Array<{
    templateId: string;
    templateName: string;
    status: string;
  }>;
}

export interface SendZnsResult {
  ok: boolean;
  msgId?: string;
  errorCode?: number;
  errorMessage?: string;
  /** Zalo có tính phí tin này không — dùng để đối soát chi phí. */
  billable: boolean;
}

/**
 * Gửi 1 tin ZNS tới số điện thoại.
 * phone: dạng 84xxxxxxxxx (đã qua normalizeVnPhone).
 */
export async function sendZns(
  conn: ZaloConnection,
  args: { phone: string; templateId: string; templateData: Record<string, string>; trackingId: string },
): Promise<SendZnsResult> {
  const token = await getValidAccessToken(conn);

  const res = await fetch(`${API_BASE}/message/template`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: token },
    body: JSON.stringify({
      phone: args.phone,
      template_id: args.templateId,
      template_data: args.templateData,
      tracking_id: args.trackingId,
    }),
  });

  const json: any = await res.json().catch(() => ({}));

  if (json?.error === 0) {
    return { ok: true, msgId: String(json?.data?.msg_id ?? ""), billable: true };
  }

  return {
    ok: false,
    errorCode: Number(json?.error ?? -1),
    errorMessage: String(json?.message ?? "Không rõ lỗi"),
    // Tin bị từ chối trước khi gửi thì không mất tiền. Đánh dấu false để báo
    // cáo chi phí không bị thổi phồng.
    billable: false,
  };
}
