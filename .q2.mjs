import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: pr } = await db.from("pay_profiles").select("user_id");
const ids = pr.map(p=>p.user_id);
const { data: us } = await db.from("users").select("id, full_name").in("id", ids);
console.log(us);
const { data: as } = await db.from("schedule_assignments").select("schedule_id, user_id").in("user_id", ids);
const sids = as.map(a=>a.schedule_id);
const { data: sc } = await db.from("schedules").select("id, scheduled_date, status").in("id", sids.slice(0,900)).gte("scheduled_date","2026-07-01");
const agg = {};
for (const s of sc) { const k = s.scheduled_date.slice(0,7)+" "+s.status; agg[k]=(agg[k]||0)+1; }
console.log(agg);
const { data: att } = await db.from("attendance_days").select("user_id, work_date, code").gte("work_date","2026-06-01");
const a2 = {}; for (const a of att) { const k=a.user_id.slice(0,8)+" "+a.work_date.slice(0,7); a2[k]=(a2[k]||0)+1;} console.log(a2);
