import { getSupabaseAdmin } from "./admin-client";
import { buildIdempotencyKey, orderSetScope } from "./crypto";
import { normalizeVnPhone } from "./phone";
import { buildTemplateData } from "./template-data";
import { uid, now } from "../supabase";
import { todayVN } from "../date-vn";

/**
 * Đẩy tin CHĂM SÓC KHÁCH HÀNG (sinh nhật / nhắc bảo dưỡng) vào hàng đợi ZNS.
 *
 * Khác `enqueueOrderCompletedZns` ở hai điểm cố ý:
 *
 * 1. KHÔNG nuốt lỗi. Bên kia chạy ngầm sau khi hoàn tất đơn nên phải im lặng;
 *    ở đây người dùng đang đứng bấm nút và cần biết chính xác vì sao không
 *    gửi được cho từng khách.
 * 2. KHÔNG áp hai cổng `orders.zalo_notify` và `zalo_settings.min_order_total`.
 *    Cả hai thuộc nghiệp vụ bán hàng; áp vào tin sinh nhật là chặn nhầm.
 *
 * Giữ nguyên các cổng an toàn còn lại: template phải đang bật, OA phải còn
 * kết nối, khách phải chưa từ chối nhận tin, SĐT phải hợp lệ, và đủ biến bắt
 * buộc của mẫu. Cổng `test_mode` nằm ở tầng gửi (drain.ts) nên tự động áp
 * dụng cho cả tin loại này.
 */

export type CareKind = "birthday" | "maintenance";

export interface CareEnqueueResult {
  queued: boolean;
  jobId?: string;
  reason?: string;
}

export interface CareEnqueueInput {
  kind: CareKind;
  customerId: string;
  /** Dữ liệu thô theo tên trường nội bộ; param_map sẽ ánh xạ sang biến Zalo. */
  values: Record<string, string>;
  /** Chỉ dùng cho bảo dưỡng — quyết định phạm vi chống gửi trùng. */
  orderIds?: string[];
  actorId?: string;
}

/**
 * Nạp sẵn template + kết nối OA một lần cho cả lô, thay vì mỗi khách một lượt
 * truy vấn. Gửi 100 khách mà không có bước này là 200 round-trip thừa.
 */
export async function loadCareContext(kind: CareKind) {
  const db = getSupabaseAdmin();

  const [tplRes, connRes] = await Promise.all([
    db.from("zns_templates").select("*").eq("code", kind).limit(1),
    db.from("zalo_connections").select("id, status").eq("status", "connected").limit(1),
  ]);

  const tpl = ((tplRes.data ?? [])[0] ?? null) as any;
  const conn = ((connRes.data ?? [])[0] ?? null) as any;

  return {
    tpl,
    conn,
    /** Lý do KHÔNG thể gửi loại tin này, dùng để vô hiệu hoá nút và giải thích. */
    blockReason: !conn
      ? "Chưa nối Zalo OA"
      : !tpl
        ? `Chưa cấu hình mẫu ZNS mã "${kind}" — vào trang Zalo OA để thêm`
        : !tpl.is_active
          ? `Mẫu "${tpl.name}" đang tắt`
          : tpl.zalo_status === "REJECT"
            ? `Mẫu "${tpl.name}" đang bị Zalo từ chối (REJECT), chưa gửi được`
            : null,
  };
}

export async function enqueueCareZns(
  input: CareEnqueueInput,
  ctx?: { tpl: any; conn: any },
): Promise<CareEnqueueResult> {
  try {
    const db = getSupabaseAdmin();
    const { tpl, conn } = ctx ?? (await loadCareContext(input.kind));

    if (!conn) return { queued: false, reason: "Chưa nối Zalo OA" };
    if (!tpl) return { queued: false, reason: `Chưa cấu hình mẫu "${input.kind}"` };
    if (!tpl.is_active) return { queued: false, reason: "Mẫu đang tắt" };

    const { data: custs } = await db
      .from("customers")
      .select("id, name, phone, zalo_opt_out_at")
      .eq("id", input.customerId)
      .limit(1);
    const cust = (custs ?? [])[0] as any;
    if (!cust) return { queued: false, reason: "Không tìm thấy khách" };

    // Khách đã từ chối nhận tin → dừng. Gửi tiếp sẽ bị report và tụt hạng OA.
    if (cust.zalo_opt_out_at) return { queued: false, reason: "Khách đã từ chối nhận tin" };

    const phone = normalizeVnPhone(cust.phone);
    if (!phone) {
      return { queued: false, reason: `SĐT không hợp lệ: ${cust.phone || "chưa có"}` };
    }

    const { templateData, missing } = buildTemplateData(tpl, input.values);
    if (missing.length) {
      return { queued: false, reason: `Thiếu dữ liệu cho biến: ${missing.join(", ")}` };
    }

    const orderIds = (input.orderIds ?? []).filter(Boolean);

    // Sinh nhật: chống trùng theo NGÀY (giờ VN) — bấm lại trong ngày không gửi thêm.
    // Bảo dưỡng: chống trùng theo BỘ ĐƠN đến hạn — xem chú thích ở crypto.ts.
    const scope =
      input.kind === "birthday" ? `d:${todayVN()}` : orderSetScope(orderIds);

    const jobId = uid();
    const { error } = await db.from("message_jobs").insert({
      id: jobId,
      connection_id: conn.id,
      customer_id: cust.id,
      // Sinh nhật không gắn đơn nào (cột này nullable từ migration v8).
      // Bảo dưỡng lấy đơn đầu tiên làm đại diện để bảng lịch sử ở trang Zalo
      // vẫn hiện được mã đơn; danh sách đầy đủ nằm trong payload.order_ids.
      order_id: orderIds[0] ?? null,
      template_id: tpl.id,
      recipient_phone: phone,
      payload: {
        zalo_template_id: tpl.zalo_template_id,
        template_data: templateData,
        kind: input.kind,
        order_ids: orderIds,
        sent_by: input.actorId ?? null,
        source: "care_page",
      },
      idempotency_key: buildIdempotencyKey({
        connectionId: conn.id,
        templateCode: tpl.code,
        customerId: cust.id,
        scope,
      }),
      status: "PENDING",
      scheduled_at: now(),
      created_at: now(),
    });

    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        return {
          queued: false,
          reason:
            input.kind === "birthday"
              ? "Hôm nay đã gửi cho khách này rồi"
              : "Đã gửi nhắc cho đúng nhóm đơn này rồi",
        };
      }
      return { queued: false, reason: error.message };
    }

    return { queued: true, jobId };
  } catch (e: any) {
    return { queued: false, reason: String(e?.message ?? e) };
  }
}
