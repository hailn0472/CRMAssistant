'use client'

import type { WidgetResultData } from '@/services/dashboard.service'

export function BarChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const points = data.series.flatMap((series) =>
    series.points.map((point) => ({ ...point, series })),
  )
  const max = Math.max(1, ...points.map((point) => point.value))
  if (!points.length) return <p className="text-sm text-slate-500">No data available</p>
  return (
    <div className="space-y-2" role="img" aria-label="Bar chart">
      {points.map(({ key, label, value, series }) => (
        <div
          key={`${series.key}-${key}`}
          className="grid grid-cols-[minmax(0,1fr)_42px] items-center gap-2 text-xs"
        >
          <div className="min-w-0">
            <div className="mb-1 truncate text-slate-600">{label}</div>
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded bg-indigo-500"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="text-right tabular-nums text-slate-700">{value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
