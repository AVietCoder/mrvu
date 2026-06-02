import { useRouterState } from "@tanstack/react-router";
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={"h-5 w-5 animate-spin " + className} />;
}

export function PageLoader({ label = "Đang tải dữ liệu…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="text-sm">{label}</div>
    </div>
  );
}

/**
 * Thanh tiến trình ở đầu trang — hiện TRÊN MỌI TRANG bất cứ khi nào:
 *  • đang điều hướng route (useRouterState), HOẶC
 *  • có bất kỳ query React Query nào đang tải/refetch (useIsFetching).
 *
 * Nhờ vậy người dùng luôn thấy phản hồi "đang tải" — cả lần tải đầu lẫn khi
 * revalidate ngầm — mà không phải sửa từng trang. Thanh chạy "trickle" tăng dần
 * tới 90% rồi nhảy 100% khi xong (kiểu NProgress), không phụ thuộc thư viện ngoài.
 */
export function RouterProgressBar() {
  const navLoading = useRouterState({ select: (s) => s.isLoading || s.isTransitioning });
  const fetching = useIsFetching();
  const active = navLoading || fetching > 0;

  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const finishTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Dọn timer "kết thúc" còn sót lại
    finishTimers.current.forEach(clearTimeout);
    finishTimers.current = [];

    let trickle: ReturnType<typeof setInterval> | undefined;

    if (active) {
      setVisible(true);
      setWidth((w) => (w < 8 ? 8 : w));
      // Tăng dần tới 90% (chậm lại khi gần 90% cho cảm giác "thật")
      trickle = setInterval(() => {
        setWidth((w) => {
          if (w >= 90) return w;
          const remaining = 90 - w;
          return Math.min(90, w + Math.max(0.5, remaining * 0.08));
        });
      }, 200);
    } else {
      // Hoàn tất: nhảy 100% rồi mờ dần và reset
      setWidth(100);
      finishTimers.current.push(setTimeout(() => setVisible(false), 280));
      finishTimers.current.push(setTimeout(() => setWidth(0), 520));
    }

    return () => {
      if (trickle) clearInterval(trickle);
    };
  }, [active]);

  return (
    <div
      aria-hidden
      className={[
        "fixed top-0 left-0 right-0 z-[200] h-1 pointer-events-none",
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        className="h-full rounded-r-full bg-primary shadow-[0_0_10px_1px] shadow-primary/60 transition-[width] duration-200 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
