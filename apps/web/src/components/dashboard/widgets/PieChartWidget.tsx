'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { WIDGET_SERIES_COLORS } from '@/lib/widget-format'
import type { WidgetResultData } from '@/services/dashboard.service'

type TooltipEntry = { value?: number | string; color?: string; name?: string }

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipEntry[]
}): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-900">{p.name}</p>
      <p style={{ color: p.color }} className="tabular-nums">
        {p.value}
      </p>
    </div>
  )
}

export function PieChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data
  if (!series.length) return <p className="text-sm text-slate-500">No data available</p>

  const firstSeries = series[0]
  const pieData = firstSeries.points.map((p, i) => ({
    name: p.label,
    value: p.value,
    color: WIDGET_SERIES_COLORS[i % WIDGET_SERIES_COLORS.length],
  }))

  return (
    <div>
      <div className="sr-only">
        <table>
          <caption>Pie chart data for accessibility</caption>
          <thead>
            <tr>
              <th>Label</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {pieData.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div role="img" aria-label="Pie chart">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Hand-rolled legend: swatch + label + value (no datum encoded by colour alone) */}
      <div className="mt-2 flex flex-wrap gap-3">
        {pieData.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
            {d.name}: {d.value.toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  )
}
