const ExcelJS = require("exceljs");
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  for (const ws of wb.worksheets) {
    if (process.argv[3] && !ws.name.includes(process.argv[3])) continue;
    console.log("=== SHEET", ws.name, ws.rowCount, ws.columnCount);
    ws.eachRow((row, r) => {
      if (r > Number(process.argv[4] || 60)) return;
      const out = [];
      row.eachCell((c, col) => {
        const v = c.value;
        let s;
        if (v && typeof v === "object" && v.formula) s = "=" + v.formula + " ->" + JSON.stringify(v.result);
        else if (v && typeof v === "object" && v.sharedFormula) s = "=~" + v.sharedFormula + " ->" + JSON.stringify(v.result);
        else if (v && typeof v === "object" && v.richText) s = v.richText.map((t) => t.text).join("");
        else s = JSON.stringify(v);
        out.push(`${c.address}:${s}`);
      });
      if (out.length) console.log(out.join(" | "));
    });
  }
})();
