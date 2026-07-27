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
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
      {FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={() => onFilterChange(filter.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeFilter === filter.key
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
