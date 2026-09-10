'use client'

import type { ActivityFilterType } from '@/types/activity.types'

type TimelineFilterProps = {
  activeFilter: ActivityFilterType
  onFilterChange: (filter: ActivityFilterType) => void
}

const FILTERS: Array<{ key: ActivityFilterType; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'SALES', label: 'Sales' },
  { key: 'SYSTEM', label: 'System' },
]

export function TimelineFilter({
  activeFilter,
  onFilterChange,
}: TimelineFilterProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-[6px]">
      {FILTERS.map((filter) => {
        const isActive = activeFilter === filter.key
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onFilterChange(filter.key)}
            className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${
              isActive
                ? 'border-[#e6e6eb] bg-white text-[#1b1b1f]'
                : 'border-transparent bg-transparent text-[#8c8c96] hover:border-[#e6e6eb]'
            }`}
          >
            {filter.label}
          </button>
        )
      })}
    </div>
  )
}
