'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface ResponsiveTableWrapperProps {
  children: React.ReactNode
  className?: string
}

export function ResponsiveTableWrapper({
  children,
  className,
}: ResponsiveTableWrapperProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let cancelled = false

    function check(): void {
      if (!el || cancelled) return
      setHasOverflow(el.scrollWidth > el.clientWidth)
    }

    check()

    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        className="overflow-x-auto rounded-lg border border-slate-200"
        role="region"
        aria-label="Scrollable table"
        tabIndex={0}
      >
        {children}
      </div>
      {hasOverflow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-slate-50 to-transparent md:hidden"
        />
      )}
    </div>
  )
}
