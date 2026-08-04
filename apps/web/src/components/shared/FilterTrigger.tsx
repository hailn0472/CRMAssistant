'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type FilterTriggerProps = {
  label: string
  value?: string
  active: boolean
  children: React.ReactNode
  /** Popover content width class — filter bars vary in how much room their controls need. */
  contentClassName?: string
}

export function FilterTrigger({
  label,
  value,
  active,
  children,
  contentClassName = 'w-56',
}: FilterTriggerProps): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors',
          active
            ? 'border-[#1b1b1f] bg-[#fafafb] text-[#1b1b1f]'
            : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
        )}
      >
        {active && value ? `${label}: ${value}` : label}
        <span className="text-[9px] text-[#b4b4bd]">▾</span>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(contentClassName, 'p-3')}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
