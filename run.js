import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import stringSimilarity from "string-similarity";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const cleanStr = (val) => (val === undefined || val === null ? "" : String(val).trim());
const cleanNum = (val) => {
  if (val === undefined || val === null) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};
const genRandomId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const cleanPhone = (phone) => cleanStr(phone).replace(/[^0-9]/g, "");

async function run() {
  try {
    const excelFilePath = path.resolve(process.cwd(), "orders.xlsx");
    if (!fs.existsSync(excelFilePath)) {
      console.error(`❌ Không tìm thấy file: ${excelFilePath}`);
      return;
    }

    // 1. TẢI DỮ LIỆU NỀN
    console.log("📥 Đang tải dữ liệu từ Database...");
    const { data: dbBranches } = await supabase.from("branches").select("id, name");
    const { data: dbCustomers } = await supabase.from("customers").select("id, name, phone, address");
    const { data: dbProducts } = await supabase.from("products").select("id, sku");

    // 2. ĐỌC EXCEL
    console.log("🔄 Đang đọc file Excel...");
    const workbook = xlsx.readFile(excelFilePath, { cellDates: true });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

    const ordersMap = new Map();
    for (const row of rows) {
      const orderCode = cleanStr(row["Mã hóa đơn"] || row["Mã đặt hàng"]);
      if (!orderCode) continue;
      if (!ordersMap.has(orderCode)) ordersMap.set(orderCode, { excelRow: row, items: [] });
      ordersMap.get(orderCode).items.push(row);
    }

    // 3. XỬ LÝ VÀ ĐẨY LÊN SUPABASE
    for (const [orderCode, orderGroup] of ordersMap.entries()) {
      const mainRow = orderGroup.excelRow;
      console.log(`\n⚙️ Đang xử lý: [${orderCode}]`);

      // --- MATCH KHÁCH HÀNG (3 Lớp) ---
      let customerId = null;
      const exCustName = cleanStr(mainRow["Tên khách hàng"]).toLowerCase();
      const exCustPhone = cleanPhone(mainRow["Điện thoại"]);
      
      if (dbCustomers) {
        let bestScore = 0;
        let bestCust = null;
        for (const cust of dbCustomers) {
          let score = 0;
          const dbName = cleanStr(cust.name).toLowerCase();
          const dbPhone = cleanPhone(cust.phone);

          if (exCustPhone && dbPhone === exCustPhone) score += 20; // Khớp SĐT tuyệt đối
          if (exCustName === dbName) score += 20; // Khớp tên tuyệt đối
          
          const nameSim = stringSimilarity.compareTwoStrings(exCustName, dbName);
          if (nameSim > 0.6) score += (nameSim * 15);

          if (score > bestScore) { bestScore = score; bestCust = cust; }
        }
        if (bestScore >= 10) {
          customerId = bestCust.id;
          console.log(`🎯 KH: "${exCustName}" -> "${bestCust.name}" (Score: ${bestScore.toFixed(1)})`);
        } else {
          console.log(`⚠️ KH: Không tìm thấy khớp cho "${exCustName}"`);
        }
      }

      // --- MATCH SẢN PHẨM & TÍNH TOÁN ---
      let orderItemsToInsert = [];
      let totalSubtotal = 0;
      for (const itemRow of orderGroup.items) {
        const itemSku = cleanStr(itemRow["Mã hàng"]);
        // Ưu tiên khớp ID trước, sau đó tới SKU
        const matchedProduct = dbProducts?.find(p => p.id === itemSku || p.sku === itemSku);
        
        if (!matchedProduct) {
          console.log(`❌ SP: [${itemSku}] không tồn tại trong DB!`);
          continue;
        }

        const qty = cleanNum(itemRow["Số lượng"]);
        const unitPrice = cleanNum(itemRow["Đơn giá"]);
        const itemTotal = qty * unitPrice;
        totalSubtotal += itemTotal;

        orderItemsToInsert.push({
          id: `OI_${genRandomId()}`,
          order_id: orderCode,
          product_id: matchedProduct.id,
          qty,
          unit_price: unitPrice,
          total: itemTotal
        });
      }

      if (orderItemsToInsert.length === 0) {
        console.log(`❌ Bỏ qua đơn [${orderCode}] vì không có sản phẩm hợp lệ.`);
        continue;
      }

      // --- ĐẨY LÊN DATABASE ---
      const orderData = {
        id: orderCode,
        code: orderCode,
        customer_id: customerId,
        branch_id: dbBranches?.[0]?.id, // Mặc định lấy chi nhánh đầu tiên nếu chưa khớp branch
        status: cleanStr(mainRow["Trạng thái"]).toLowerCase().includes("hoàn thành") ? "completed" : "draft",
        subtotal: totalSubtotal,
        total: cleanNum(mainRow["Khách cần trả"]) || totalSubtotal,
        created_at: mainRow["Thời gian tạo"] || new Date()
      };

      const { error: errOrd } = await supabase.from("orders").upsert(orderData);
      const { error: errItem } = await supabase.from("order_items").upsert(orderItemsToInsert);

      if (!errOrd && !errItem) {
        console.log(`✅ Đã lưu đơn [${orderCode}] & ${orderItemsToInsert.length} sản phẩm.`);
      } else {
        console.error(`❌ Lỗi DB:`, errOrd || errItem);
      }
    }

    console.log("\n🎉 TIẾN TRÌNH HOÀN TẤT!");
  } catch (err) {
    console.error("❌ Lỗi nghiêm trọng:", err.message);
  }
}

run();