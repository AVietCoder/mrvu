import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  label?: string;
};

export function Pagination({ page, pageSize, total, onPageChange, label = "kết quả" }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageNumbers = useMemo(() => {
    const max = 5;
    if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
    let start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + max - 1);
    start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [page, totalPages]);

  if (totalPages <= 1 && total <= pageSize) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        {total} {label}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div>
        {from}–{to} / {total} {label}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Trang trước"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pageNumbers[0] > 1 && <span className="px-1">…</span>}
        {pageNumbers.map((n) => (
          <Button
            key={n}
            size="sm"
            variant={n === page ? "default" : "outline"}
            className="h-7 min-w-7 px-2"
            onClick={() => onPageChange(n)}
          >
            {n}
          </Button>
        ))}
        {pageNumbers[pageNumbers.length - 1] < totalPages && <span className="px-1">…</span>}
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Trang sau"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export const DEFAULT_PAGE_SIZE = 20;
