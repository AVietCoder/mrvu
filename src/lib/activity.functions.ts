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
  .handler(async ({ data }: {
    data?: {
      page?: number;
      search?: string;
      user_id?: string;
      action?: string;
      date_from?: string;
      date_to?: string;
    } | undefined
  }) => {
    const page = data?.page ?? 1;
    const pageSize = 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    // Lọc theo từ khoá (hành động hoặc chi tiết)
    if (data?.search?.trim()) {
      const q = `%${data.search.trim()}%`;
      query = query.or(`action.ilike.${q},detail.ilike.${q}`);
    }

    // Lọc theo người dùng
    if (data?.user_id) {
      query = query.eq("employee_id", data.user_id);
    }

    // Lọc theo loại hành động
    if (data?.action) {
      query = query.eq("action", data.action);
    }

    // Lọc từ ngày
    if (data?.date_from) {
      query = query.gte("created_at", data.date_from);
    }

    // Lọc đến ngày
    if (data?.date_to) {
      // +1 ngày để include cả ngày cuối
      const endDate = new Date(data.date_to);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt("created_at", endDate.toISOString().split("T")[0]);
    }

    const { data: logs, count, error } = await query.range(from, to);
    if (error) throw new Error(error.message);

    // Fetch employee names
    const empIds = [...new Set((logs ?? []).map((l: any) => l.employee_id).filter(Boolean))];
    let empMap: Record<string, string> = {};
    if (empIds.length) {
      const { data: emps } = await supabase
        .from("users")
        .select("id, full_name, username")
        .in("id", empIds);
      for (const e of emps ?? []) {
        empMap[e.id] = e.full_name || e.username || e.id;
      }

      // Fallback sang bảng employees nếu không tìm được trong users
      const missing = empIds.filter((id) => !empMap[id]);
      if (missing.length) {
        const { data: empsFromEmp } = await supabase
          .from("employees")
          .select("id, name")
          .in("id", missing);
        for (const e of empsFromEmp ?? []) {
          empMap[e.id] = e.name;
        }
      }
    }

    const enriched = (logs ?? []).map((l: any) => ({
      ...l,
      employee_name: l.employee_id ? (empMap[l.employee_id] ?? l.employee_id) : null,
    }));

    return { logs: enriched, total: count ?? 0 };
  });
