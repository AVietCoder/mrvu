import { createServer } from "vite";
import path from "path";
const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const m = await server.ssrLoadModule("/src/lib/schedule.functions.ts");
for (const [from, next] of [["2026-08-01","2026-09-01"],["2026-09-01","2026-10-01"]]) {
  const r = await m.computeTechPay({ from, next, statuses: ["done"] });
  console.log(from, r.rows.filter(x=>/Giang|Đức/.test(x.full_name)).map(x=>[x.full_name, x.total_money, x.schedule_count]));
}
await server.close();
