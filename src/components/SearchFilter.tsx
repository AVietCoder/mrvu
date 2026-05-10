import { Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type SortOption = { value: string; label: string };

type Props = {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  sortOptions?: SortOption[];
  sortValue?: string;
  onSort?: (v: string) => void;
  filterSlot?: React.ReactNode;   // extra filter dropdowns
  total?: number;
  totalLabel?: string;
};

export function SearchFilter({
  search, onSearch, placeholder = "Tìm kiếm...",
  sortOptions, sortValue, onSort,
  filterSlot, total, totalLabel,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {/* Sort */}
      {sortOptions && onSort && (
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={sortValue}
            onChange={(e) => onSort(e.target.value)}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Extra filters */}
      {filterSlot}

      {/* Total count */}
      {total !== undefined && (
        <div className="flex items-center text-sm text-muted-foreground whitespace-nowrap self-center">
          <SlidersHorizontal className="h-4 w-4 mr-1" />
          {total} {totalLabel ?? "kết quả"}
        </div>
      )}
    </div>
  );
}