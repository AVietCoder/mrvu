import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * QueryClient với defaults tối ưu trải nghiệm:
 * - staleTime 60s: trong 1 phút không refetch lại khi remount component / đổi tab.
 * - gcTime 10 phút: giữ cache lâu hơn → quay lại trang là thấy data ngay,
 *   trong khi vẫn background-refetch nếu đã stale.
 * - refetchOnWindowFocus tắt: hạn chế refetch dồn dập khi alt-tab.
 * - retry 1: tránh treo UI khi mạng chập chờn.
 * KHÔNG ảnh hưởng dữ liệu: mọi mutation vẫn invalidate đúng query keys.
 */
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload dùng cùng staleTime → tận dụng cache khi hover Link.
    defaultPreloadStaleTime: 60 * 1000,
    defaultPreload: "intent",
  });

  return router;
};
