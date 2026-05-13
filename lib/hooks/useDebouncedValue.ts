// lib/hooks/useDebouncedValue.ts
import { useEffect, useState } from 'react'

/**
 * Returns `value` delayed by `delayMs`. While the input changes rapidly,
 * the returned value stays at its previous setting until the input stops
 * changing for `delayMs`. Typical use: debouncing a search input before
 * writing to the URL or firing a network request.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return debounced
}
