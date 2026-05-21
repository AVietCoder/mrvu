import { useRouterState } from "@tanstack/react-router";
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

/** Thanh tiến trình mảnh ở đầu trang, hiện khi đang điều hướng route. */
export function RouterProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.isLoading || s.isTransitioning });
  return (
    <div
      aria-hidden
      className={[
        "fixed top-0 left-0 right-0 z-[100] h-0.5 bg-transparent pointer-events-none",
        "transition-opacity duration-200",
        isLoading ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        className={[
          "h-full bg-primary",
          isLoading ? "animate-[loadbar_1.2s_ease-in-out_infinite]" : "",
        ].join(" ")}
        style={{ width: "40%" }}
      />
      <style>{`
        @keyframes loadbar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
