'use client'

import { WIDGET_SERIES_COLORS } from '@/lib/widget-format'
import type { WidgetResultData } from '@/services/dashboard.service'

export function FunnelWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data
  if (!series.length) return <p className="text-sm text-slate-500">No data available</p>

  const firstSeries = series[0]
  const maxValue = Math.max(...firstSeries.points.map((p) => p.value), 1)

  return (
    <div>
      <div className="sr-only">
        <table>
          <caption>Funnel data for accessibility</caption>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {firstSeries.points.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2" role="img" aria-label="Funnel chart">
        {firstSeries.points.map((p, i) => (
          <div
            key={p.key}
            className="flex items-center gap-2"
            // Native tooltip — the non-recharts analogue of the chart widgets'
            // custom Tooltip render prop (AC 76).
            title={`${p.label}: ${p.value}`}
          >
            <div
              className="h-8 rounded"
              style={{
                width: `${Math.max(5, (p.value / maxValue) * 100)}%`,
                backgroundColor: WIDGET_SERIES_COLORS[i % WIDGET_SERIES_COLORS.length],
                opacity: 0.8,
              }}
            />
            <span className="shrink-0 text-xs font-medium text-slate-700">
              {p.label}: {p.value}
            </span>
          </div>
        ))}
      </div>
      {/* Hand-rolled legend: swatch + label + value (no datum encoded by colour alone) */}
      <div className="mt-2 flex flex-wrap gap-3" data-testid="funnel-legend">
        {firstSeries.points.map((p, i) => (
          <div key={p.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: WIDGET_SERIES_COLORS[i % WIDGET_SERIES_COLORS.length] }}
            />
            {p.label}: {p.value}
          </div>
        ))}
      </div>
    </div>
  )
}
