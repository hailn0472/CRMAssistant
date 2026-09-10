'use client'

import type { WidgetResultData } from '@/services/dashboard.service'

const COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500']

export function PieChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const points = data.series[0]?.points ?? []
  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (!points.length) return <p className="text-sm text-slate-500">No data available</p>
  return (
    <div className="space-y-2" role="img" aria-label="Lead distribution">
      {points.map((point, index) => {
        const percentage = total ? Math.round((point.value / total) * 100) : 0
        return (
          <div key={point.key} className="flex items-center gap-2 text-xs text-slate-700">
            <span className={`h-2.5 w-2.5 rounded-full ${COLORS[index % COLORS.length]}`} />
            <span className="min-w-0 flex-1 truncate">{point.label}</span>
            <span className="tabular-nums">
              {point.value.toLocaleString()} ({percentage}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}
