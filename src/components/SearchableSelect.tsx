import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  sub?: string;       // optional subtitle (e.g. phone number)
  disabled?: boolean; // ✅ per-option disabled
};

type Props = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string; // shown as first "none" option
  className?: string;
  disabled?: boolean;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Tìm kiếm...",
  emptyLabel,
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = options.filter((o) => {
    const q = search.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) ||
      (o.sub?.toLowerCase().includes(q) ?? false)
    );
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  function select(val: string) {
    onChange(val);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={`mt-1 flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm 
          ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-ring"}
          ${open ? "border-ring ring-1 ring-ring" : "border-input"}`}
      >
        <span className={`min-w-0 flex-1 truncate text-left ${selected || (emptyLabel && !value) ? "text-foreground" : "text-muted-foreground"}`}>
          {selected
            ? selected.label
            : emptyLabel && !value
            ? emptyLabel
            : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && emptyLabel && (
            <span
              onMouseDown={(e) => { e.stopPropagation(); select(""); }}
              className="p-0.5 rounded hover:bg-muted cursor-pointer text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          {/* Search input */}
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground ml-1">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto py-1">
            {emptyLabel && (
              <div
                onClick={() => select("")}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-accent text-muted-foreground italic
                  ${!value ? "bg-accent/60 font-medium" : ""}`}
              >
                {emptyLabel}
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                Không tìm thấy kết quả
              </div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.value}
                  onClick={() => { if (!o.disabled) select(o.value); }}
                  className={`px-3 py-2 text-sm
                    ${o.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-accent"}
                    ${o.value === value ? "bg-accent/60 font-medium" : ""}`}
                >
                  <div>{o.label}</div>
                  {o.sub && <div className="text-xs text-muted-foreground">{o.sub}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
