// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "./supabase";

export type ActivityEntry = {
  id: string;
  employee_id?: string;
  employee_name?: string;
  action: string;
  detail?: string;
  created_at: string;
};

export const listActivityLogs = createServerFn({ method: "GET" })
  .handler(async ({ data }: { data?: { page?: number; search?: string } | undefined }) => {
    const page = data?.page ?? 1;
    const pageSize = 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Fetch activity logs with pagination
    let query = supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (data?.search) {
      const q = `%${data.search}%`;
      query = query.or(`action.ilike.${q},detail.ilike.${q}`);
    }

    const { data: logs, count, error } = await query.range(from, to);
    if (error) throw new Error(error.message);

    // Fetch employee names
    const empIds = [...new Set((logs ?? []).map((l: any) => l.employee_id).filter(Boolean))];
    let empMap: Record<string, string> = {};
    if (empIds.length) {
      const { data: emps } = await supabase
        .from("employees")
        .select("id, name")
        .in("id", empIds);
      for (const e of emps ?? []) {
        empMap[e.id] = e.name;
      }
    }

    const enriched = (logs ?? []).map((l: any) => ({
      ...l,
      employee_name: l.employee_id ? (empMap[l.employee_id] ?? l.employee_id) : "—",
    }));

    return { logs: enriched, total: count ?? 0 };
  });
