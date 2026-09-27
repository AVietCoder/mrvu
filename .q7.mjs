import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: t } = await db.from("cash_voucher_types").select("*");
console.log(t?.map(x=>[x.id.slice(0,8), x.name, x.kind ?? x.type]));
const { data: v } = await db.from("cash_vouchers").select("code, voucher_type_id, note, amount").in("code", ["PC000241","PC000622","PC000520","PC000496","PC000689"]);
console.log(v?.map(x=>[x.code, x.voucher_type_id?.slice(0,8), x.note]));
