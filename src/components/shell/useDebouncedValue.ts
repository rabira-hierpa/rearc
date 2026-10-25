"use client";

import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delay` ms.
 *
 * This is not `useDeferredValue`. That hook keeps renders responsive by
 * letting React finish the urgent one first — it still gives you *every*
 * value, just later. A search box needs the opposite: values that were
 * superseded should never be used at all, because each one costs a request
 * per layer plus a geocode. Only a timer can throw them away.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
