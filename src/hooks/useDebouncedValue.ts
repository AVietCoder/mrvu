import { useEffect, useState } from "react";

/**
 * Trả về giá trị `value` sau khi đã debounce `delay` ms.
 * Dùng để tránh gọi server mỗi lần user gõ phím trong ô search.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
