import { useEffect, useState } from 'react'

/** Returns `value`, but only after it has stopped changing for `delay` ms — used to avoid firing a search query on every keystroke. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}
