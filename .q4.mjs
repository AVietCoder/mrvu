import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const U = {"66d94135-41e4-492f-99a3-99e3f7f6ec88":"Giang","aa4a426a-bf23-51c5-2555-8daad8925fd3":"Đức"};
for (const [from,next] of [["2026-08-01","2026-09-01"],["2026-09-01","2026-10-01"]]) {
  const { data: s } = await sb.from("schedules").select("id, work_type_id, work_type_qty").gte("scheduled_date", from).lt("scheduled_date", next).in("status", ["done"]);
  const ids = s.map(x=>x.id);
  const { data: as } = await sb.from("schedule_assignments").select("schedule_id, user_id").in("schedule_id", ids);
  const { data: wt } = await sb.from("work_types").select("id, price");
  const wtm = Object.fromEntries(wt.map(w=>[w.id,w.price]));
  const by = {};
  for (const a of as) (by[a.schedule_id] ||= []).push(a.user_id);
  const tot = {};
  for (const x of s) { const p = by[x.id]||[]; for (const u of p) if (U[u]) tot[U[u]] = (tot[U[u]]||0) + (wtm[x.work_type_id]||0)*Math.max(1,x.work_type_qty||1)/p.length; }
  console.log(from, tot, "ids", ids.length, "assign", as.length);
}
