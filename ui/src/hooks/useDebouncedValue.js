import { useState, useEffect, useRef } from "react";

/**
 * Returns a value that updates only after `delayMs` has passed since the last update to `value`.
 */
export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, delayMs]);

  return debounced;
}
