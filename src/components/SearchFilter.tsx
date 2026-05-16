import { Search, SlidersHorizontal, ArrowUpDown, X as XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SortOption = { value: string; label: string };

type Props = {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  sortOptions?: SortOption[];
  sortValue?: string;
  onSort?: (v: string) => void;
  filterSlot?: React.ReactNode;
  total?: number;
  totalLabel?: string;
};

export function SearchFilter({
  search, onSearch, placeholder = "Tìm kiếm…",
  sortOptions, sortValue, onSort,
  filterSlot, total, totalLabel,
}: Props) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:max-w-xs sm:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9 pr-9"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
            aria-label="Xóa tìm kiếm"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {sortOptions && onSort && (
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={sortValue}
            onChange={(e) => onSort(e.target.value)}
            aria-label="Sắp xếp"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {filterSlot && <div className="flex flex-wrap items-center gap-2">{filterSlot}</div>}

      {total !== undefined && (
        <div className="flex items-center gap-1 self-center whitespace-nowrap text-xs text-muted-foreground sm:ml-auto">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {total} {totalLabel ?? "kết quả"}
        </div>
      )}
    </div>
  );
}
