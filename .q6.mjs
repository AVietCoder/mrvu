import { createServer } from "vite";
import fs from "fs";
import path from "path";
for (const l of fs.readFileSync(".env","utf8").split(/\r?\n/)) { const i=l.indexOf("="); if (i>0 && !l.startsWith("#")) process.env[l.slice(0,i).trim()] ||= l.slice(i+1).trim().replace(/^["']|["']$/g,""); }
const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const src = fs.readFileSync("src/lib/hr.functions.ts","utf8");
fs.writeFileSync("src/lib/.hrtest.ts", src + "\nexport { computePayroll as __cp };\n");
try {
  const m = await server.ssrLoadModule("/src/lib/.hrtest.ts");
  const r = await m.__cp("2026-09", { actorId: null, isAdmin: true, branchIds: new Set() });
  for (const mo of ["2026-07","2026-08","2026-09","2026-10"]) { const q = await m.__cp(mo, { actorId: null, isAdmin: true, branchIds: new Set() }); console.log(mo, JSON.stringify(q.rows.map(x=>({n:x.full_name,tech:x.tech_revenue,adv:x.advance,advv:x.advance_vouchers?.map(v=>[v.code,v.amount,v.note]),bh:x.social_insurance,gross:x.gross,net:x.net_pay})))); }
} catch (e) { console.log("ERR", e.message); }
fs.unlinkSync("src/lib/.hrtest.ts");
await server.close();
