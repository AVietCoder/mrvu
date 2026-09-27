import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: wt } = await anon.from("work_types").select("name, price");
console.log("work_types", wt);
const { data: wd } = await anon.from("work_difficulties").select("name, bonus");
console.log("diffs", wd);
for (const [from,next] of [["2026-08-01","2026-09-01"],["2026-09-01","2026-10-01"]]) {
  const { data: s, error } = await anon.from("schedules").select("id, work_type_id, status").gte("scheduled_date", from).lt("scheduled_date", next).in("status", ["done"]);
  const noType = s?.filter(x=>!x.work_type_id).length;
  console.log(from, "done (anon)", s?.length, "no work_type", noType, error?.message);
  const { data: as } = await anon.from("schedule_assignments").select("schedule_id").in("schedule_id", (s??[]).map(x=>x.id));
  console.log(" assignments visible anon", as?.length);
}
