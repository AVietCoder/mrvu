import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Vùng cuộn ngang cho bảng rộng. Thanh cuộn bị ẩn toàn app (styles.css) nên
 * người dùng không biết còn cột bên phải — component này bù lại bằng:
 *  - bóng mờ + nút mũi tên ở mép còn nội dung,
 *  - kéo chuột để cuộn (như kéo bản đồ), lăn chuột + Shift cũng cuộn ngang,
 *  - cảm ứng thì vuốt như bình thường.
 * Kéo không làm "click nhầm" vào ô: nếu chuột đã di chuyển thì nuốt cú click.
 */
export function ScrollX({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const suppressClick = useRef(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [update, children]);

  function onMouseDown(e: React.MouseEvent) {
    const el = ref.current;
    if (!el || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    if ((e.target as HTMLElement).closest("input, select, textarea, button, a, label, [contenteditable]")) return;
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    let moved = false;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      el.style.cursor = "";
      el.style.userSelect = "";
      if (moved) suppressClick.current = true;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const by = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        className="overflow-x-auto"
        onScroll={update}
        onMouseDown={onMouseDown}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
      </div>
      {edge.left && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/10 to-transparent" />
          <button
            type="button"
            aria-label="Cuộn sang trái"
            onClick={() => by(-1)}
            className="absolute left-1.5 top-2 z-30 grid h-8 w-8 place-items-center rounded-full border bg-background/95 shadow-md hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}
      {edge.right && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/10 to-transparent" />
          <button
            type="button"
            aria-label="Cuộn sang phải"
            onClick={() => by(1)}
            className="absolute right-1.5 top-2 z-30 grid h-8 w-8 place-items-center rounded-full border bg-background/95 shadow-md hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
