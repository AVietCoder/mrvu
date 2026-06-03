import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Caching mặc định cho React Query (an toàn 100% — KHÔNG đổi dữ liệu, chỉ
  // đổi thời điểm refetch). Mọi mutation trong app đều đã gọi invalidateQueries
  // cho key liên quan nên dữ liệu vẫn refresh ngay sau khi ghi.
  // Các route nhạy cảm về độ mới (activity realtime, orders/$id, customers)
  // đã set staleTime/refetch riêng nên sẽ GHI ĐÈ các giá trị mặc định này.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 phút: mở lại trang hiện ngay từ cache, revalidate ngầm
        gcTime: 10 * 60_000, // giữ cache 10 phút (quay lại không phải fetch lại)
        refetchOnWindowFocus: false, // không spam API khi alt-tab
        retry: 1, // thử lại tối đa 1 lần khi mạng chập chờn
      },
      mutations: {
        retry: 0, // không double-submit mutation
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent", // hover vào Link là đã prefetch dữ liệu
    defaultPreloadStaleTime: 60_000, // prefetch cache 1 phút, click mở gần như tức thì
  });

  return router;
};
