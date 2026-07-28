import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X, Loader2 } from "lucide-react";
import type { SelectOption } from "./SearchableSelect";

type Props = {
  value: string;
  onChange: (value: string) => void;
  fetchOptions: (q: string) => Promise<SelectOption[]>;
  resolveSelected?: (id: string) => Promise<SelectOption | null>;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  debounceMs?: number;
};

export function AsyncSearchableSelect({
  value,
  onChange,
  fetchOptions,
  resolveSelected,
  placeholder = "Tìm kiếm...",
  emptyLabel,
  className = "",
  disabled = false,
  debounceMs = 300,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SelectOption | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  // Resolve selected option label
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!value) { setSelected(null); return; }
      if (selected?.value === value) return;
      if (resolveSelected) {
        try {
          const r = await resolveSelected(value);
          if (!cancelled) setSelected(r);
        } catch { /* ignore */ }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [value]);

  // Debounced fetch
  useEffect(() => {
    if (!open) return;
    const id = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchOptions(search);
        if (reqIdRef.current === id) setResults(r);
      } catch {
        if (reqIdRef.current === id) setResults([]);
      } finally {
        if (reqIdRef.current === id) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [search, open]);

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
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  function select(opt: SelectOption | null) {
    onChange(opt?.value ?? "");
    setSelected(opt);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={`mt-1 flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm
          ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-ring"}
          ${open ? "border-ring ring-1 ring-ring" : "border-input"}`}
      >
        <span className={`min-w-0 flex-1 truncate text-left ${selected || (emptyLabel && !value) ? "text-foreground" : "text-muted-foreground"}`}>
          {selected ? selected.label : (emptyLabel && !value ? emptyLabel : placeholder)}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && emptyLabel && (
            <span
              onMouseDown={(e) => { e.stopPropagation(); select(null); }}
              className="p-0.5 rounded hover:bg-muted cursor-pointer text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!loading && search && (
              <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground ml-1">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {emptyLabel && (
              <div
                onClick={() => select(null)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-accent text-muted-foreground italic
                  ${!value ? "bg-accent/60 font-medium" : ""}`}
              >
                {emptyLabel}
              </div>
            )}
            {loading && results.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Đang tải…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {search ? "Không tìm thấy kết quả" : "Nhập để tìm kiếm…"}
              </div>
            ) : (
              results.map((o) => (
                <div
                  key={o.value}
                  onClick={() => { if (!o.disabled) select(o); }}
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
