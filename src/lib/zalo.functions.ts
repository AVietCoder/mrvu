// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { encryptToken } from "./zalo/crypto";
import {
  exchangeCodeForToken,
  getTemplateInfo,
  listTemplates,
  loadConnection,
} from "./zalo/client";
import { uid, now } from "./supabase";

/**
 * Server functions cho phần kết nối Zalo OA và tra cứu template ZNS.
 *
 * ⚠️ GHI CHÚ VỀ PHÂN QUYỀN: codebase hiện chưa có session phía server (token
 * đăng nhập không được verify ở đâu cả), nên các hàm này KHÔNG tự kiểm tra
 * được người gọi là ai — giống hệt 98 server function còn lại. Khi làm Phase 0
 * (hash mật khẩu + bảng sessions + requireAuth) thì phải bọc lại các hàm dưới
 * đây TRƯỚC TIÊN, vì chúng đụng tới token gửi tin tốn tiền.
 */

// ─── PKCE ─────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Tạo URL cho người dùng bấm vào để cấp quyền OA.
 *
 * code_verifier được trả về cho client giữ tạm trong sessionStorage rồi gửi
 * lại ở bước callback. Làm vậy để khỏi thêm một bảng chỉ để giữ state sống
 * vài chục giây. An toàn vì app_secret vẫn nằm hoàn toàn ở server — PKCE ở
 * đây là lớp bảo vệ bổ sung, không phải lớp duy nhất.
 */
export const getZaloAuthUrlFn = createServerFn({ method: "GET" }).handler(async () => {
  const appId = process.env.ZALO_APP_ID;
  const redirectUri = process.env.ZALO_REDIRECT_URI;
  if (!appId || !redirectUri) {
    throw new Error("Chưa cấu hình ZALO_APP_ID / ZALO_REDIRECT_URI trong .env");
  }

  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  const url =
    "https://oauth.zaloapp.com/v4/oa/permission?" +
    new URLSearchParams({
      app_id: appId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state,
    });

  return { url, codeVerifier, state, redirectUri };
});

/**
 * Trả về cấu hình Zalo mà SERVER đang thực sự dùng, để trang cài đặt hiển thị.
 *
 * Có hàm này vì .env ở máy dev và Environment Variables trên Vercel là hai nơi
 * khác nhau — sửa một bên rồi tưởng bên kia cũng đổi là lỗi rất hay gặp, mà
 * triệu chứng lại là "Invalid redirect uri" chung chung. Cho hiện thẳng giá trị
 * production để đối chiếu với chỗ đăng ký bên Zalo, khỏi đoán.
 *
 * KHÔNG trả app_secret hay bất kỳ khoá nào — app_id và redirect_uri không bí mật,
 * chúng vốn nằm công khai trong URL cấp quyền.
 */
export const getZaloConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  const redirectUri = process.env.ZALO_REDIRECT_URI ?? null;
  return {
    appId: process.env.ZALO_APP_ID ?? null,
    redirectUri,
    // Chỉ báo có/không, không lộ giá trị.
    hasAppSecret: Boolean(process.env.ZALO_APP_SECRET),
    hasTokenSecret: Boolean(process.env.ZALO_TOKEN_SECRET),
    hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Host suy ra từ redirect_uri — phải TRÙNG domain đã xác thực bên Zalo.
    host: redirectUri ? (() => { try { return new URL(redirectUri).host; } catch { return null; } })() : null,
  };
});

/** Đổi code lấy token và lưu kết nối. Gọi từ trang /zalo/callback. */
export const connectZaloOaFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { code: string; codeVerifier: string; oaId?: string } }) => {
    if (!data?.code || !data?.codeVerifier) throw new Error("Thiếu code hoặc code_verifier");

    const t = await exchangeCodeForToken(data.code, data.codeVerifier);
    const db = getSupabaseAdmin();

    // OA dùng chung cho mọi chi nhánh → branch_id = NULL, chỉ giữ 1 dòng.
    const { data: existing } = await db
      .from("zalo_connections")
      .select("id")
      .is("branch_id", null)
      .limit(1);

    const row = {
      access_token_enc: encryptToken(t.accessToken),
      refresh_token_enc: encryptToken(t.refreshToken),
      token_expires_at: new Date(Date.now() + t.expiresInSec * 1000).toISOString(),
      refresh_lock_at: null,
      status: "connected",
      connected_at: now(),
      last_error: null,
    };

    const prev = (existing ?? [])[0] as any;
    if (prev) {
      // Dùng update thẳng, KHÔNG dùng updateWhereSafe: nếu cột token chưa tồn
      // tại thì phải nổ lỗi, không được im lặng bỏ qua.
      const { error } = await db.from("zalo_connections").update(row).eq("id", prev.id);
      if (error) throw new Error(error.message);
      return { id: prev.id as string, reconnected: true };
    }

    const id = uid();
    const { error } = await db.from("zalo_connections").insert({
      id,
      branch_id: null,
      oa_id: data.oaId || "pending",
      ...row,
      created_at: now(),
    });
    if (error) throw new Error(error.message);
    return { id, reconnected: false };
  },
);

/** Trạng thái kết nối để hiển thị ở trang cài đặt. Không trả token ra ngoài. */
export const getZaloStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const conn = await loadConnection().catch(() => null);
  if (!conn) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("zalo_connections")
      .select("id, oa_id, oa_name, status, last_error, token_expires_at, connected_at")
      .limit(1);
    const any = (data ?? [])[0] as any;
    return any
      ? { connected: false, ...any }
      : { connected: false, id: null, status: "disconnected" as const };
  }

  return {
    connected: true,
    id: conn.id,
    oa_id: conn.oa_id,
    oa_name: conn.oa_name,
    status: conn.status,
    token_expires_at: conn.token_expires_at,
  };
});

/**
 * Đọc danh sách template ZNS trực tiếp từ Zalo.
 * Đây cũng là phép thử kết nối: gọi được nghĩa là token sống và OA đúng.
 */
export const listZaloTemplatesFn = createServerFn({ method: "GET" }).handler(async () => {
  const conn = await loadConnection();
  if (!conn) throw new Error("Chưa nối Zalo OA");
  return await listTemplates(conn);
});

/**
 * Đọc chi tiết 1 template — QUAN TRỌNG NHẤT ở bước cấu hình.
 * Trả về đúng danh sách biến Zalo yêu cầu, để map với dữ liệu đơn hàng.
 */
export const getZaloTemplateInfoFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { templateId: string } }) => {
    if (!data?.templateId) throw new Error("Thiếu templateId");
    const conn = await loadConnection();
    if (!conn) throw new Error("Chưa nối Zalo OA");
    return await getTemplateInfo(conn, data.templateId);
  },
);

/** Lưu cấu hình template + ánh xạ biến vào DB. */
export const saveZnsTemplateFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: {
      code: string;
      name: string;
      zaloTemplateId: string;
      paramMap: Record<string, string>;
      isActive: boolean;
      /** Nguyên listParams từ Zalo — giữ maxLength để cắt chuỗi trước khi gửi. */
      listParams?: any[];
      templateTag?: string;
      price?: string | number;
    };
  }) => {
    const db = getSupabaseAdmin();
    const { data: existing } = await db
      .from("zns_templates")
      .select("id")
      .eq("code", data.code)
      .limit(1);

    const row = {
      code: data.code,
      name: data.name,
      zalo_template_id: data.zaloTemplateId,
      param_map: data.paramMap,
      is_active: data.isActive,
      list_params: data.listParams ?? [],
      template_tag: data.templateTag ?? null,
      price: data.price != null ? Number(data.price) : null,
    };

    const prev = (existing ?? [])[0] as any;
    if (prev) {
      const { error } = await db.from("zns_templates").update(row).eq("id", prev.id);
      if (error) throw new Error(error.message);
      return { id: prev.id as string };
    }

    const id = uid();
    const { error } = await db.from("zns_templates").insert({ id, ...row, created_at: now() });
    if (error) throw new Error(error.message);
    return { id };
  },
);

/**
 * Lịch sử gửi tin + tình trạng hàng đợi.
 * Đây là chỗ duy nhất người dùng thấy được tin nào đã đi, tin nào hỏng và
 * hỏng vì sao — nếu không có thì mọi lỗi gửi đều im lặng.
 */
export const getZaloDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const db = getSupabaseAdmin();

  const [logsRes, jobsRes] = await Promise.all([
    db
      .from("message_logs")
      .select("id, order_id, recipient_phone, status, error_code, error_message, sent_at, created_at, billable")
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("message_jobs").select("status"),
  ]);

  const jobs = (jobsRes.data ?? []) as any[];
  const countBy = (s: string) => jobs.filter((j) => j.status === s).length;

  // Ghép mã đơn để hiển thị cho người dùng hiểu, thay vì phơi id thô.
  const logs = (logsRes.data ?? []) as any[];
  const orderIds = [...new Set(logs.map((l) => l.order_id).filter(Boolean))];
  const codeById = new Map<string, string>();
  if (orderIds.length) {
    const { data: orders } = await db.from("orders").select("id, code").in("id", orderIds);
    for (const o of (orders ?? []) as any[]) codeById.set(o.id, o.code);
  }

  return {
    queue: {
      pending: countBy("PENDING"),
      retrying: countBy("RETRYING"),
      sending: countBy("SENDING"),
      sent: countBy("SENT"),
      failed: countBy("FAILED"),
    },
    logs: logs.map((l) => ({ ...l, order_code: l.order_id ? codeById.get(l.order_id) ?? null : null })),
  };
});

/** Danh sách template đã cấu hình trong app. */
export const listZnsTemplatesFn = createServerFn({ method: "GET" }).handler(async () => {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("zns_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});
