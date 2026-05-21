import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Thanh tiến trình "fake" mượt mắt khi đang fetch dữ liệu lớn (15k+ khách).
 * Tăng dần tới 90% theo thời gian, đến khi `done=true` thì nhảy lên 100%.
 *
 * Cách dùng:
 *   <LoadingProgress label="Đang tải khách hàng..." done={!isLoading} />
 */
export function LoadingProgress({
  label = "Đang tải dữ liệu…",
  done = false,
  className = "",
}: {
  label?: string;
  done?: boolean;
  className?: string;
}) {
  const [pct, setPct] = useState(8);

  useEffect(() => {
    if (done) {
      setPct(100);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setPct((p) => {
        if (p >= 90) return p; // dừng ở 90% cho tới khi xong
        // Tốc độ giảm dần khi gần 90% — cảm giác "thật"
        const remaining = 90 - p;
        const inc = Math.max(0.5, remaining * 0.06);
        return Math.min(90, p + inc);
      });
    };
    const id = setInterval(tick, 180);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [done]);

  return (
    <div className={"w-full max-w-md mx-auto py-16 " + className}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>{label}</span>
        <span className="ml-auto font-mono text-xs tabular-nums">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Đang đồng bộ toàn bộ dữ liệu từ Lovable Cloud — vui lòng chờ trong giây lát.
      </div>
    </div>
  );
}
