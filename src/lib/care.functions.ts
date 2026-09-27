// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./zalo/admin-client";
import { enqueueCareZns, loadCareContext, type CareKind } from "./zalo/enqueue-care";
import { joinClamp } from "./zalo/template-data";
import { normalizeVnPhone } from "./zalo/phone";
import { sendEmail, renderTemplate, baseEmailHtml, escapeHtml } from "./email";
import { todayVN, formatDateVN } from "./date-vn";
import { fetchRows, logActivity } from "./supabase";

/**
 * Chăm sóc khách hàng: sinh nhật hôm nay + nhắc bảo dưỡng định kỳ.
 *
 * Nguồn dữ liệu là 3 RPC trong migration v11. Chúng đã REVOKE khỏi anon nên
 * bắt buộc đi qua getSupabaseAdmin() (service role, server-only).
 *
 * ⚠️ NHÂN VIÊN CHỈ ĐỂ HIỂN THỊ. Danh sách nhân viên lấy từ một RPC RIÊNG
 * (care_employee_birthdays_today) và KHÔNG có đường nào dẫn từ đó sang luồng
 * gửi Zalo — tách hàm để không thể lẫn hai tập dữ liệu vào nhau.
 */

const MAX_BATCH = 100;

// ── Phân quyền ────────────────────────────────────────────────────────────
/**
 * Kiểm quyền ở SERVER, không tin client.
 * Theo đúng mẫu resetPasswordFn: nhận actorId rồi tự truy DB.
 *
 * Hạn chế đã biết của repo: chưa có session phía server nên actorId vẫn có
 * thể bị giả mạo — giống toàn bộ các server function còn lại. Việc này chặn
 * được thao tác vô ý, không chặn được kẻ cố ý.
 */
async function assertCanSend(actorId?: string) {
  if (!actorId) throw new Error("Thiếu thông tin người thực hiện");

  const rows = await fetchRows<any>("users", {
    eq: { id: actorId },
    select: "id, is_admin",
    limit: 1,
  });
  const actor = rows[0];
  if (!actor) throw new Error("Người dùng không tồn tại");
  if (Number(actor.is_admin) === 1) return;

  const perms = await fetchRows<any>("user_permissions", {
    eq: { user_id: actorId },
    select: "permission",
  });
  if (!perms.some((p: any) => p.permission === "customer_care")) {
    throw new Error('Bạn không có quyền "Gửi tin chăm sóc KH"');
  }
}

// ── Cấu hình chung ────────────────────────────────────────────────────────
async function getSiteInfo() {
  const rows = await fetchRows<any>("site_settings", { select: "key, value" });
  const map: Record<string, string> = {};
  for (const r of rows ?? []) map[r.key] = r.value;
  return {
    siteName: map.site_name?.trim() || "Mr.Vũ",
    phone: map.phone?.trim() || "",
    address: map.address?.trim() || "",
    adminEmail: map.admin_email?.trim() || "",
    printTemplates: (() => {
      try {
        return JSON.parse(map.print_templates || "{}");
      } catch {
        return {};
      }
    })(),
  };
}

// ── Danh sách ─────────────────────────────────────────────────────────────
export const getCareListFn = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { kind?: CareKind; date?: string; windowDays?: number } }) => {
    const kind: CareKind = data?.kind === "maintenance" ? "maintenance" : "birthday";
    const date = data?.date || todayVN();
    const windowDays = Math.max(0, Math.min(30, Number(data?.windowDays ?? 0)));

    const db = getSupabaseAdmin();

    const [listRes, empRes, ctx, settingsRes, site] = await Promise.all([
      kind === "birthday"
        ? db.rpc("care_birthdays_today", { p_date: date, p_template_code: "birthday" })
        : db.rpc("care_maintenance_due", {
            p_date: date,
            p_months: 6,
            p_window_days: windowDays,
            p_template_code: "maintenance",
          }),
      // Nhân viên chỉ hiện ở tab sinh nhật, và chỉ để xem.
      kind === "birthday"
        ? db.rpc("care_employee_birthdays_today", { p_date: date })
        : Promise.resolve({ data: [] }),
      loadCareContext(kind),
      db.from("zalo_settings").select("test_mode, test_phones").eq("id", "default").limit(1),
      getSiteInfo(),
    ]);

    if ((listRes as any).error) {
      throw new Error(
        `Không đọc được danh sách: ${(listRes as any).error.message}. ` +
          `Nếu báo "Could not find the function" thì chưa chạy sql_migration_v11_care.sql.`,
      );
    }

    const st = ((settingsRes as any).data ?? [])[0] as any;
    const testPhones: string[] = Array.isArray(st?.test_phones) ? st.test_phones : [];

    const rows = ((listRes as any).data ?? []).map((r: any) => {
      const phoneOk = Boolean(normalizeVnPhone(r.phone));
      const emailOk = Boolean(String(r.email || "").trim());
      return {
        ...r,
        // Tính sẵn ở server để UI không phải lặp lại logic chuẩn hoá SĐT.
        can_zalo: phoneOk,
        can_email: emailOk,
        blocked_reason: !phoneOk && !emailOk ? "Không có SĐT lẫn email hợp lệ" : null,
      };
    });

    return {
      kind,
      date,
      windowDays,
      rows,
      employees: ((empRes as any).data ?? []),
      meta: {
        zaloBlockReason: ctx.blockReason,
        templateName: ctx.tpl?.name ?? null,
        templateCode: kind,
        zaloStatus: ctx.tpl?.zalo_status ?? null,
        unitPrice: ctx.tpl?.price != null ? Number(ctx.tpl.price) : null,
        testMode: st?.test_mode !== false,
        testPhonesCount: testPhones.length,
        emailReady: Boolean(process.env.RESEND_API_KEY),
        siteName: site.siteName,
        maxBatch: MAX_BATCH,
      },
    };
  },
);

// ── Gửi Zalo ──────────────────────────────────────────────────────────────
export const sendCareZaloFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { kind: CareKind; date?: string; windowDays?: number; customerIds: string[]; actorId?: string };
  }) => {
    await assertCanSend(data?.actorId);

    const kind: CareKind = data.kind === "maintenance" ? "maintenance" : "birthday";
    const ids = [...new Set((data.customerIds ?? []).filter(Boolean))];
    if (!ids.length) throw new Error("Chưa chọn khách nào");
    if (ids.length > MAX_BATCH) {
      throw new Error(`Mỗi lần gửi tối đa ${MAX_BATCH} khách (đang chọn ${ids.length})`);
    }

    const ctx = await loadCareContext(kind);
    if (ctx.blockReason) throw new Error(ctx.blockReason);

    const db = getSupabaseAdmin();
    const date = data.date || todayVN();
    const windowDays = Math.max(0, Math.min(30, Number(data.windowDays ?? 0)));

    // Lấy LẠI dữ liệu từ RPC thay vì tin số liệu client gửi lên — tránh
    // trường hợp trang mở từ sáng, dữ liệu đã đổi, mà vẫn gửi theo bản cũ.
    const listRes =
      kind === "birthday"
        ? await db.rpc("care_birthdays_today", { p_date: date, p_template_code: "birthday" })
        : await db.rpc("care_maintenance_due", {
            p_date: date,
            p_months: 6,
            p_window_days: windowDays,
            p_template_code: "maintenance",
          });
    if ((listRes as any).error) throw new Error((listRes as any).error.message);

    const byId = new Map<string, any>();
    for (const r of ((listRes as any).data ?? [])) byId.set(r.customer_id, r);

    const site = await getSiteInfo();
    const results: Array<{ customerId: string; name: string; ok: boolean; reason?: string }> = [];

    // Tuần tự: 100 khách mà bắn song song là 100 lượt ghi cùng lúc vào cùng
    // một bảng, chưa kể mỗi lỗi lại khó truy về đúng khách nào.
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        results.push({ customerId: id, name: "—", ok: false, reason: "Khách không còn trong danh sách hôm nay" });
        continue;
      }

      const values: Record<string, string> =
        kind === "birthday"
          ? {
              customer_name: String(row.customer_name ?? ""),
              customer_code: String(row.customer_code ?? ""),
              shop_name: site.siteName,
              shop_phone: site.phone,
            }
          : {
              customer_name: String(row.customer_name ?? ""),
              customer_code: String(row.customer_code ?? ""),
              // Gộp nhiều sản phẩm vào 1 biến, cắt theo ranh giới tên chứ
              // không cắt cụt giữa chừng.
              product_name: joinClamp(row.product_names ?? [], 200),
              order_code: (row.order_codes ?? [])[0] ?? "",
              shipped_date: row.last_shipped_at ? formatDateVN(String(row.last_shipped_at).slice(0, 10)) : "",
              due_date: formatDateVN(row.first_due_date),
              shop_name: site.siteName,
              shop_phone: site.phone,
            };

      const r = await enqueueCareZns(
        {
          kind,
          customerId: id,
          values,
          orderIds: kind === "maintenance" ? (row.order_ids ?? []) : [],
          actorId: data.actorId,
        },
        { tpl: ctx.tpl, conn: ctx.conn },
      );

      results.push({
        customerId: id,
        name: String(row.customer_name ?? ""),
        ok: r.queued,
        reason: r.reason,
      });
    }

    const okCount = results.filter((r) => r.ok).length;
    await logActivity({
      action: "care_send_zalo",
      detail: `Gửi Zalo ${kind === "birthday" ? "sinh nhật" : "nhắc bảo dưỡng"}: ${okCount}/${ids.length} khách`,
      employee_id: data.actorId ?? null,
    });

    return { results, queued: okCount, total: ids.length };
  },
);

// ── Gửi Email ─────────────────────────────────────────────────────────────
function buildCareEmail(
  kind: CareKind,
  row: any,
  site: { siteName: string; phone: string; address: string; printTemplates: any },
) {
  const tplKey = kind === "birthday" ? "email_birthday" : "email_maintenance";
  const tpl = site.printTemplates?.[tplKey] ?? {};

  const vars: Record<string, string> = {
    Ten_Cua_Hang: site.siteName,
    Khach_Hang: String(row.customer_name ?? ""),
    Ma_Khach_Hang: String(row.customer_code ?? ""),
    So_Dien_Thoai_CH: site.phone,
    Dia_Chi_CH: site.address,
    San_Pham: (row.product_names ?? []).join(", "),
    Ma_Don_Hang: (row.order_codes ?? []).join(", "),
    So_Don: String(row.order_count ?? ""),
    Ngay_Xuat_Kho: row.last_shipped_at ? formatDateVN(String(row.last_shipped_at).slice(0, 10)) : "",
    Ngay_Den_Han: formatDateVN(row.first_due_date),
    Tuoi: row.age != null ? String(row.age) : "",
  };

  const defaultSubject =
    kind === "birthday"
      ? "[{Ten_Cua_Hang}] Chúc mừng sinh nhật {Khach_Hang}!"
      : "[{Ten_Cua_Hang}] Đã đến kỳ bảo dưỡng định kỳ — {Khach_Hang}";

  const defaultBody =
    kind === "birthday"
      ? "Kính gửi {Khach_Hang},\n\n{Ten_Cua_Hang} xin gửi lời chúc mừng sinh nhật tới Quý khách. " +
        "Chúc Quý khách và gia đình thật nhiều sức khoẻ và niềm vui.\n\n" +
        "Trân trọng cảm ơn Quý khách đã tin tưởng đồng hành cùng chúng tôi."
      : "Kính gửi {Khach_Hang},\n\n" +
        "Theo ghi nhận của {Ten_Cua_Hang}, sản phẩm Quý khách đã mua đã đến kỳ bảo dưỡng định kỳ 6 tháng.\n\n" +
        "• Sản phẩm: {San_Pham}\n" +
        "• Mã đơn: {Ma_Don_Hang}\n" +
        "• Ngày xuất kho: {Ngay_Xuat_Kho}\n" +
        "• Ngày đến hạn: {Ngay_Den_Han}\n\n" +
        "Việc kiểm tra định kỳ giúp thiết bị vận hành an toàn và bền hơn. " +
        "Quý khách vui lòng liên hệ {So_Dien_Thoai_CH} để đặt lịch.";

  const subject = renderTemplate(tpl.emailSubject || defaultSubject, vars);
  const bodyText = renderTemplate(tpl.body || defaultBody, vars);
  const footer = renderTemplate(
    tpl.footer || "Email tự động từ {Ten_Cua_Hang} — Vui lòng không trả lời email này.",
    vars,
  );

  // Giữ xuống dòng mà người dùng gõ trong ô soạn thảo.
  const bodyHtml = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return {
    subject,
    html: baseEmailHtml({
      siteName: site.siteName,
      title: kind === "birthday" ? "Chúc mừng sinh nhật" : "Nhắc bảo dưỡng định kỳ",
      subtitle: kind === "maintenance" ? `Đến hạn: ${vars.Ngay_Den_Han}` : undefined,
      bodyHtml,
      footer,
    }),
  };
}

export const sendCareEmailFn = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { kind: CareKind; date?: string; windowDays?: number; customerIds: string[]; actorId?: string };
  }) => {
    await assertCanSend(data?.actorId);

    const kind: CareKind = data.kind === "maintenance" ? "maintenance" : "birthday";
    const ids = [...new Set((data.customerIds ?? []).filter(Boolean))];
    if (!ids.length) throw new Error("Chưa chọn khách nào");
    if (ids.length > MAX_BATCH) {
      throw new Error(`Mỗi lần gửi tối đa ${MAX_BATCH} khách (đang chọn ${ids.length})`);
    }
    if (!process.env.RESEND_API_KEY) throw new Error("Chưa cấu hình RESEND_API_KEY trên máy chủ");

    const db = getSupabaseAdmin();
    const date = data.date || todayVN();
    const windowDays = Math.max(0, Math.min(30, Number(data.windowDays ?? 0)));

    const listRes =
      kind === "birthday"
        ? await db.rpc("care_birthdays_today", { p_date: date, p_template_code: "birthday" })
        : await db.rpc("care_maintenance_due", {
            p_date: date,
            p_months: 6,
            p_window_days: windowDays,
            p_template_code: "maintenance",
          });
    if ((listRes as any).error) throw new Error((listRes as any).error.message);

    const byId = new Map<string, any>();
    for (const r of ((listRes as any).data ?? [])) byId.set(r.customer_id, r);

    const site = await getSiteInfo();
    const results: Array<{ customerId: string; name: string; ok: boolean; reason?: string }> = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        results.push({ customerId: id, name: "—", ok: false, reason: "Khách không còn trong danh sách" });
        continue;
      }
      const to = String(row.email || "").trim();
      if (!to) {
        results.push({ customerId: id, name: row.customer_name, ok: false, reason: "Khách chưa có email" });
        continue;
      }

      const { subject, html } = buildCareEmail(kind, row, site);
      const res = await sendEmail({ to: [to], subject, html, siteName: site.siteName });

      results.push({
        customerId: id,
        name: String(row.customer_name ?? ""),
        ok: res.ok,
        reason: res.ok ? undefined : res.error || res.skipped,
      });
    }

    const okCount = results.filter((r) => r.ok).length;
    await logActivity({
      action: "care_send_email",
      detail: `Gửi Email ${kind === "birthday" ? "sinh nhật" : "nhắc bảo dưỡng"}: ${okCount}/${ids.length} khách`,
      employee_id: data.actorId ?? null,
    });

    return { results, sent: okCount, total: ids.length };
  },
);
