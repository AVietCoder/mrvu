// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { fetchRow, fetchRows, supabase } from "./supabase";

export const getCustomerDetail = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { id: string } }) => {
    const customer = await fetchRow<any>("customers", { eq: { id: data.id } });
    if (!customer) throw new Error("Không tìm thấy khách hàng");

    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("customer_id", data.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const branches = await fetchRows("branches", { orderBy: "name" });
    return { customer, orders: orders ?? [], branches };
  },
);

export const getEmployeeDetail = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { id: string } }) => {
    const user = await fetchRow<any>("users", {
      eq: { id: data.id },
      select: "id, full_name, username, phone, is_admin, created_at",
    });
    if (!user) throw new Error("Không tìm thấy nhân viên");

    const [branchRows, permRows, branches] = await Promise.all([
      fetchRows<any>("user_branches", { eq: { user_id: data.id }, select: "branch_id" }),
      fetchRows<any>("user_permissions", { eq: { user_id: data.id }, select: "permission" }),
      fetchRows("branches", { orderBy: "name" }),
    ]);

    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("employee_id", data.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      user: {
        ...user,
        branch_ids: branchRows.map((r: any) => r.branch_id),
        permissions: permRows.map((r: any) => r.permission),
      },
      orders: orders ?? [],
      branches,
    };
  },
);
