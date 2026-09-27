import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo } from "react";
import { listCustomerGroups } from "@/lib/customers.functions";

export interface CustomerGroup {
  code: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  customer_count?: number | null;
}

/**
 * Bảng màu cố định cho nhóm khách. Phải là chuỗi class viết ĐẦY ĐỦ (không
 * ghép động kiểu `bg-${color}-100`) vì Tailwind chỉ sinh CSS cho class nó
 * nhìn thấy nguyên văn trong mã nguồn.
 */
export const GROUP_COLOR_CLASS: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-yellow-100 text-yellow-700",
  purple: "bg-purple-100 text-purple-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  pink: "bg-pink-100 text-pink-700",
  teal: "bg-teal-100 text-teal-700",
};

export const GROUP_COLOR_LABEL: Record<string, string> = {
  gray: "Xám",
  blue: "Xanh dương",
  amber: "Vàng",
  purple: "Tím",
  green: "Xanh lá",
  red: "Đỏ",
  pink: "Hồng",
  teal: "Xanh ngọc",
};

/**
 * Danh sách nhóm khách hàng — nguồn sự thật là bảng customer_groups.
 * Thay cho các bảng `groupLabel` hardcode rải rác trước đây.
 */
export function useCustomerGroups(opts?: { withCounts?: boolean }) {
  const fn = useServerFn(listCustomerGroups);
  const withCounts = Boolean(opts?.withCounts);

  const query = useQuery({
    queryKey: ["customerGroups", withCounts],
    // Ép kiểu: typing tham số `data` của createServerFn bị suy ra `undefined`
    // trên toàn repo (xem các file *.functions.ts đều dùng @ts-nocheck).
    queryFn: () => (fn as any)({ data: { withCounts } }),
    staleTime: 5 * 60_000,
  });

  const all = (query.data?.groups ?? []) as CustomerGroup[];

  const byCode = useMemo(() => new Map(all.map((g) => [g.code, g])), [all]);

  /** Nhóm đang bật — dùng cho ô chọn khi tạo/sửa khách. */
  const active = useMemo(() => all.filter((g) => g.is_active), [all]);

  /**
   * Nhóm cho ô chọn khi SỬA một khách: gồm các nhóm đang bật, cộng thêm nhóm
   * hiện tại của khách dù nhóm đó đã bị tắt — nếu không, mở form sửa khách
   * thuộc nhóm đã tắt sẽ hiện ô trống và vô tình bị đổi nhóm.
   */
  const optionsFor = useCallback(
    (currentCode?: string | null) => {
      if (!currentCode || active.some((g) => g.code === currentCode)) return active;
      const cur = byCode.get(currentCode);
      return cur ? [...active, cur] : active;
    },
    [active, byCode],
  );

  const labelOf = useCallback(
    (code?: string | null) => (code ? byCode.get(code)?.name ?? code : "—"),
    [byCode],
  );

  const colorClassOf = useCallback(
    (code?: string | null) =>
      GROUP_COLOR_CLASS[byCode.get(code ?? "")?.color ?? "gray"] ?? GROUP_COLOR_CLASS.gray,
    [byCode],
  );

  return {
    groups: all,
    active,
    optionsFor,
    labelOf,
    colorClassOf,
    /** true = DB chưa chạy migration v12, đang dùng 4 nhóm mặc định. */
    fallback: Boolean(query.data?.fallback),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
