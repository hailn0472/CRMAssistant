'use client'

import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { trendLabel } from '@/lib/widget-format'
import type { WidgetResultData } from '@/services/dashboard.service'

export function MetricCardWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { metric } = data
  if (!metric) return <p className="text-sm text-slate-500">No data available</p>

  return (
    <div className="space-y-1">
      <p className="text-3xl font-semibold tracking-tight text-slate-950">
        {metric.value.toLocaleString()}
        {metric.unit ? (
          <span className="ml-1 text-sm font-normal text-slate-500">{metric.unit}</span>
        ) : null}
      </p>
      <p className="text-xs text-slate-500">{metric.label}</p>
      {metric.trendDirection && metric.trendPercent !== null && (
        <p className="flex items-center gap-1 text-xs font-medium">
          {metric.trendDirection === 'UP' && (
            <TrendingUp className="h-3 w-3 text-emerald-600" aria-hidden="true" />
          )}
          {metric.trendDirection === 'DOWN' && (
            <TrendingDown className="h-3 w-3 text-red-600" aria-hidden="true" />
          )}
          {metric.trendDirection === 'FLAT' && (
            <Minus className="h-3 w-3 text-slate-400" aria-hidden="true" />
          )}
          <span
            className={
              metric.trendDirection === 'UP'
                ? 'text-emerald-600'
                : metric.trendDirection === 'DOWN'
                  ? 'text-red-600'
                  : 'text-slate-500'
            }
          >
            {trendLabel(metric.trendDirection, metric.trendPercent)}
          </span>
        </p>
      )}
    </div>
  )
}
