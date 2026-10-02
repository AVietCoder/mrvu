// Nhập các đơn "Bảo hành VIP" gần đây thành PHIẾU BẢO HÀNH khách lẻ (migration v23).
//
// Trước khi có trang Bảo hành, showroom ghi bảo hành khách lẻ bằng một đơn bán có
// dịch vụ "Bảo hành VIP" + linh kiện, tình trạng ghi ở ghi chú đơn. Script này tạo
// phiếu cho từng đơn: khách, ghi chú tình trạng, NV bán = NV tiếp nhận, gắn đơn làm
// "đơn bán linh kiện", gắn lịch kỹ thuật của đơn.
//
//   node scripts/import-warranty-vip-orders.mjs            → xem trước (không ghi)
//   node scripts/import-warranty-vip-orders.mjs --commit   → ghi
//
// Chạy lại an toàn: đơn đã có phiếu thì bỏ qua. Phiếu để trạng thái "Đang xử lý",
// CHƯA có kết quả xử lý / ngày mua — nhân viên bổ sung trên phiếu.
import fs from "fs";
import path from "path";
import { createServer } from "vite";

const COMMIT = process.argv.includes("--commit");
// Mẫu quạt lấy từ ghi chú của từng đơn (đơn chỉ có dòng dịch vụ + linh kiện).
const ORDERS = {
  HD009939: "Lotus DC, HERO 345 (đời đầu), Legend 4L",
  HD009931: "Solid AC, Can",
  HD009911: "Fino Hồng",
  HD009909: "SKY MP LED, MELODY",
  HD009837: "Halo đen (12 chiếc)",
};

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
// Handler createServerFn không gọi được ngoài runtime → nạp bản đã bóc vỏ (xem progress.md mục 5).
const TMP = "src/lib/.xximport.ts";
fs.writeFileSync(TMP, fs.readFileSync("src/lib/warranty.functions.ts", "utf8").replace(/createServerFn\(\{ method: "(GET|POST)" \}\)\s*\.handler\(/g, "("));
const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const W = await vite.ssrLoadModule("/" + TMP);
  const db = (await vite.ssrLoadModule("/src/lib/zalo/admin-client.ts")).getSupabaseAdmin();
  const { data: admins } = await db.from("users").select("id").eq("is_admin", 1).order("created_at").limit(1);
  const admin = admins[0].id;

  let created = 0;
  for (const [code, model] of Object.entries(ORDERS)) {
    const { data: os } = await db.from("orders").select("id, code, status, created_at").eq("code", code).limit(1);
    const o = (os ?? [])[0];
    if (!o) { console.log(`${code}: không tìm thấy đơn — bỏ qua`); continue; }
    const pf = await W.ticketPrefillFromOrderFn({ data: { actorId: admin, orderId: o.id } });
    if (pf.tickets.length) { console.log(`${code}: đã có phiếu ${pf.tickets.map((t) => t.code).join(", ")} — bỏ qua`); continue; }

    // Kỹ thuật: chỉ gán khi lịch của đơn có đúng 1 người thực hiện.
    let technician = null;
    if (pf.prefill.schedule_id) {
      const { data: as } = await db.from("schedule_assignments").select("*").eq("schedule_id", pf.prefill.schedule_id);
      const ids = [...new Set((as ?? []).map((a) => a.user_id ?? a.employee_id).filter(Boolean))];
      if (ids.length === 1) technician = ids[0];
    }
    const { kind, order_code, ...fields } = pf.prefill;
    console.log(`${code} (${o.status}, ${o.created_at.slice(0, 10)}): ${fields.customer_name} · ${model} · lịch ${fields.schedule_id ? "có" : "không"} · kỹ thuật ${technician ? "1 người" : "chưa gán"}`);
    console.log(`    tình trạng: ${fields.issue_note.slice(0, 140)}${fields.issue_note.length > 140 ? "…" : ""}`);
    if (!COMMIT) continue;
    const r = await W.upsertTicketFn({
      data: {
        ...fields, kind, actorId: admin, product_model: model,
        sent_date: o.created_at, response_date: o.created_at, // đã xếp lịch kỹ thuật ngay khi nhận
        stage: "processing", technician_id: technician,
      },
    });
    await W.addTicketNoteFn({ data: { actorId: admin, id: r.id, content: `Nhập từ đơn ${code} (trước đây ghi bảo hành bằng đơn "Bảo hành VIP"). Cần bổ sung: ngày mua, bộ phận lỗi, kết quả xử lý.` } });
    console.log(`    → đã tạo phiếu ${r.code}`);
    created++;
  }
  console.log(COMMIT ? `\nĐã tạo ${created} phiếu.` : "\nXem trước — chưa ghi gì. Thêm --commit để ghi.");
} finally {
  await vite.close();
  fs.existsSync(TMP) && fs.unlinkSync(TMP);
}
