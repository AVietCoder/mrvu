import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const cleanStr = (val) => {
  if (val === undefined || val === null) return "";
  return String(val).trim();
};

const cleanNum = (val) => {
  if (val === undefined || val === null) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

async function run() {
  try {
    const excelFilePath = path.resolve(process.cwd(), "customers.xlsx");

    if (!fs.existsSync(excelFilePath)) {
      console.error(`❌ Không tìm thấy file: ${excelFilePath}`);
      return;
    }

    console.log("🔄 Đang đọc cấu trúc file Excel...");

    const workbook = xlsx.readFile(excelFilePath, {
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

    console.log(`📊 Tổng dữ liệu quét được: ${rows.length} khách hàng`);

    const batchSize = 500;
    let successCount = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);

      const customers = chunk.map((row) => {
        let rawId = cleanStr(row["Mã khách hàng"]);
        if (!rawId) {
          rawId = `KH_AUTO_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        }

        return {
          id: rawId,
          name: cleanStr(row["Tên khách hàng"]) || "Khách hàng không tên",
          phone: cleanStr(row["Điện thoại"]),
          address: cleanStr(row["Địa chỉ"]),
          province: cleanStr(row["Khu vực giao hàng"]),
          group_name: cleanStr(row["Nhóm khách hàng"]) || "le",
          debt: cleanNum(row["Nợ cần thu hiện tại"]),
          total_buy: cleanNum(row["Tổng bán"]),
          type: cleanStr(row["Loại khách"]),
          email: cleanStr(row["Email"]),
          gender: cleanStr(row["Giới tính"])
        };
      });

      console.log(`🚀 Đang đồng bộ batch ${Math.floor(i / batchSize) + 1} (${customers.length} khách hàng)...`);

      const { error } = await supabase
        .from("customers")
        .upsert(customers, { onConflict: "id" });

      if (error) {
        console.error(`❌ Thất bại tại batch ${Math.floor(i / batchSize) + 1}:`, error.message);
        continue;
      }

      successCount += customers.length;
      console.log(`✅ Tiến độ: ${successCount}/${rows.length} khách hàng`);
    }

    console.log("\n🎉 TIẾN TRÌNH IMPORT HOÀN TẤT");
    console.log(`📦 Tổng số bản ghi thực tế trong cơ sở dữ liệu: ${successCount}`);
  } catch (err) {
    console.error("❌ Hệ thống gặp sự cố:", err.message);
  }
}

run();