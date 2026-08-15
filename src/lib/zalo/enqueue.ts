import { getSupabaseAdmin } from "./admin-client";
import { buildIdempotencyKey } from "./crypto";
import { normalizeVnPhone } from "./phone";
import { uid, now } from "../supabase";

/**
 * Đẩy job gửi ZNS "đơn hoàn tất" vào hàng đợi.
 *
 * NGUYÊN TẮC QUAN TRỌNG NHẤT: hàm này KHÔNG BAO GIỜ được ném lỗi ra ngoài.
 * Bán hàng là nghiệp vụ chính, nhắn tin là phụ — Zalo hỏng thì đơn vẫn phải
 * lưu bình thường. Mọi lỗi đều nuốt lại và trả về lý do để ghi log.
 *
 * Gọi được nhiều lần cho cùng một đơn: idempotency_key có UNIQUE ở DB nên lần
 * thứ hai bị Postgres chặn, khách không nhận hai tin.
 */

type EnqueueResult =
  | { queued: true; jobId: string }
  | { queued: false; reason: string };

/** Định dạng tiền kiểu Việt Nam, không kèm ký hiệu để vừa maxLength. */
function fmtMoney(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
}

function fmtDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("vi-VN");
}

/** Cắt chuỗi theo maxLength Zalo khai báo — vượt quá là Zalo từ chối cả tin. */
function clamp(value: string, maxLength?: number): string {
  if (!maxLength || maxLength <= 0) return value;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export async function enqueueOrderCompletedZns(orderId: string): Promise<EnqueueResult> {
  try {
    const db = getSupabaseAdmin();

    // 1) Template phải đang bật. Chưa cấu hình thì im lặng bỏ qua — đây là
    //    trạng thái bình thường khi chưa dựng xong Zalo, không phải lỗi.
    const { data: tpls } = await db
      .from("zns_templates")
      .select("*")
      .eq("code", "order_completed")
      .eq("is_active", true)
      .limit(1);
    const tpl = (tpls ?? [])[0] as any;
    if (!tpl) return { queued: false, reason: "Chưa bật template order_completed" };

    // 2) Kết nối OA còn sống
    const { data: conns } = await db
      .from("zalo_connections")
      .select("id, status")
      .eq("status", "connected")
      .limit(1);
    const conn = (conns ?? [])[0] as any;
    if (!conn) return { queued: false, reason: "Chưa nối Zalo OA" };

    // 3) Đơn + khách
    const { data: orders } = await db
      .from("orders")
      .select("id, code, customer_id, branch_id, total, paid, deposit, created_at, zalo_notify")
      .eq("id", orderId)
      .limit(1);
    const order = (orders ?? [])[0] as any;
    if (!order) return { queued: false, reason: "Không tìm thấy đơn" };

    // ★ Quyết định nằm ở chính đơn hàng: nhân viên tick "Gửi thông báo Zalo"
    // trên form. NULL = đơn tạo trước khi có tính năng → không gửi.
    if (order.zalo_notify !== true) {
      return { queued: false, reason: "Đơn không chọn gửi thông báo Zalo" };
    }

    if (!order.customer_id) return { queued: false, reason: "Đơn khách lẻ, không có SĐT" };

    // Ngưỡng giá trị đơn — 0 nghĩa là không chặn.
    const { data: settingsRows } = await db
      .from("zalo_settings")
      .select("min_order_total")
      .eq("id", "default")
      .limit(1);
    const minTotal = Number((settingsRows ?? [])[0]?.min_order_total ?? 0);
    if (minTotal > 0 && Number(order.total || 0) < minTotal) {
      return {
        queued: false,
        reason: `Đơn ${Number(order.total || 0).toLocaleString("vi-VN")}đ dưới ngưỡng ${minTotal.toLocaleString("vi-VN")}đ`,
      };
    }

    const { data: custs } = await db
      .from("customers")
      .select("id, name, phone, zalo_opt_out_at")
      .eq("id", order.customer_id)
      .limit(1);
    const cust = (custs ?? [])[0] as any;
    if (!cust) return { queued: false, reason: "Không tìm thấy khách" };

    // Khách đã từ chối nhận tin → dừng. Gửi tiếp sẽ bị report và tụt hạng OA.
    if (cust.zalo_opt_out_at) return { queued: false, reason: "Khách đã từ chối nhận tin" };

    const phone = normalizeVnPhone(cust.phone);
    if (!phone) return { queued: false, reason: `SĐT không hợp lệ: ${cust.phone ?? "trống"}` };

    // 4) Dựng dữ liệu điền vào template
    let branchName = "";
    if (order.branch_id) {
      const { data: brs } = await db
        .from("branches")
        .select("name")
        .eq("id", order.branch_id)
        .limit(1);
      branchName = (brs ?? [])[0]?.name ?? "";
    }

    const total = Number(order.total || 0);
    const paid = Number(order.paid || 0);
    const values: Record<string, string> = {
      order_code: String(order.code ?? ""),
      customer_name: String(cust.name ?? ""),
      total_amount: fmtMoney(total),
      paid_amount: fmtMoney(paid),
      debt_amount: fmtMoney(Math.max(0, total - paid - Number(order.deposit || 0))),
      branch_name: branchName,
      order_date: fmtDate(order.created_at),
    };

    // param_map: { tên param của Zalo -> tên trường nội bộ }
    const paramMap = (tpl.param_map ?? {}) as Record<string, string>;
    const listParams = (tpl.list_params ?? []) as Array<{
      name: string;
      require?: boolean;
      maxLength?: number;
    }>;
    const maxLenByName = new Map(listParams.map((p) => [p.name, p.maxLength]));

    const templateData: Record<string, string> = {};
    for (const [zaloParam, internalKey] of Object.entries(paramMap)) {
      if (!internalKey) continue;
      templateData[zaloParam] = clamp(values[internalKey] ?? "", maxLenByName.get(zaloParam));
    }

    // Thiếu biến bắt buộc thì đừng gửi — chắc chắn Zalo từ chối, gửi chỉ tổ
    // tốn một lượt gọi và làm bẩn log.
    const missing = listParams
      .filter((p) => p.require && !templateData[p.name])
      .map((p) => p.name);
    if (missing.length) {
      return { queued: false, reason: `Thiếu biến bắt buộc: ${missing.join(", ")}` };
    }

    // 5) Đẩy vào hàng đợi
    const jobId = uid();
    const { error } = await db.from("message_jobs").insert({
      id: jobId,
      connection_id: conn.id,
      customer_id: cust.id,
      order_id: order.id,
      template_id: tpl.id,
      recipient_phone: phone,
      payload: { template_data: templateData, zalo_template_id: tpl.zalo_template_id },
      idempotency_key: buildIdempotencyKey({
        connectionId: conn.id,
        orderId: order.id,
        templateCode: tpl.code,
      }),
      status: "PENDING",
      scheduled_at: now(),
      created_at: now(),
    });

    if (error) {
      // 23505 = trùng UNIQUE → đã có job cho đơn này. Đúng như thiết kế.
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        return { queued: false, reason: "Đã có job cho đơn này (chống gửi trùng)" };
      }
      return { queued: false, reason: error.message };
    }

    return { queued: true, jobId };
  } catch (e: any) {
    return { queued: false, reason: String(e?.message ?? e) };
  }
}
