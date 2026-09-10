'use client'

import type { WidgetResultData } from '@/services/dashboard.service'

export function FunnelWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const points = data.series[0]?.points ?? []
  const max = Math.max(1, ...points.map((point) => point.value))
  if (!points.length) return <p className="text-sm text-slate-500">No data available</p>
  return (
    <div className="space-y-3" role="img" aria-label="Lead funnel">
      <p className="text-[12px] leading-relaxed text-[#777781]">Contacts by qualification status</p>
      <div className="space-y-2.5">
        {points.map((point) => {
          const width = Math.max(18, (point.value / max) * 100)
          return (
            <div
              key={point.key}
              className="grid grid-cols-[minmax(84px,0.7fr)_minmax(90px,1.3fr)_auto] items-center gap-3"
            >
              <span className="truncate text-[12px] font-medium text-[#4e4e58]">{point.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-[#efeff3]">
                <span
                  className="block h-full rounded-full bg-[#5b50d6]"
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="min-w-5 text-right text-[12px] font-semibold tabular-nums text-[#24242a]">
                {point.value.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
