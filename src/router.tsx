import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * ⚡ Cấu hình hiệu năng React Query + Router.
 *
 * KHÔNG đổi business logic, KHÔNG đổi dữ liệu — chỉ thay đổi *thời điểm*
 * dữ liệu được fetch/refetch. Mọi mutation trong app đã gọi
 * `queryClient.invalidateQueries(...)` nên dữ liệu luôn cập nhật ngay sau
 * khi thêm/sửa/xoá; các giá trị dưới đây chỉ giúp tránh fetch lại thừa.
 */
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 60s: trong cùng phiên làm việc, mở lại 1 trang vừa xem sẽ hiển thị
        // NGAY từ cache rồi mới revalidate ngầm (không nháy trắng, không chờ).
        staleTime: 60_000,
        // Giữ cache 10 phút sau khi rời trang → quay lại không phải fetch lại.
        gcTime: 10 * 60_000,
        // Không refetch ồ ạt mỗi lần alt-tab/đổi cửa sổ.
        refetchOnWindowFocus: false,
        // (Giữ mặc định refetchOnMount: chỉ refetch khi dữ liệu đã quá staleTime
        //  → trong 60s mở lại trang là tức thì, sau 60s tự lấy dữ liệu mới khi
        //  quay lại. Đảm bảo dữ liệu không bao giờ cũ quá 60s giữa các thiết bị.)
        // Mạng chập chờn: thử lại 1 lần thay vì treo.
        retry: 1,
      },
      mutations: {
        // Mutation (tạo đơn, thu/chi, nhập kho…) KHÔNG retry tự động để
        // tránh double-submit (tạo trùng phiếu/đơn).
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hover/touch vào link là đã prefetch route + loader → click vào mở gần
    // như tức thì.
    defaultPreload: "intent",
    // Dữ liệu prefetch coi như còn "tươi" trong 60s, khớp staleTime ở trên.
    defaultPreloadStaleTime: 60_000,
  });

  return router;
};
