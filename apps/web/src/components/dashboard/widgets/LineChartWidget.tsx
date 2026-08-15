'use client'

import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { WIDGET_SERIES_COLORS } from '@/lib/widget-format'
import type { WidgetResultData } from '@/services/dashboard.service'

type TooltipEntry = { value?: number | string; color?: string; name?: string }

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
}): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-900">{label}</p>
      {payload.map((p) => (
        <p key={p.name ?? 'value'} style={{ color: p.color }} className="tabular-nums">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export function LineChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data
  if (!series.length) return <p className="text-sm text-slate-500">No data available</p>

  // Flatten for recharts — each series becomes a line
  const allKeys = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.key)))).sort()
  const chartData = allKeys.map((key) => {
    const row: Record<string, string | number> = { key }
    for (const s of series) {
      const pt = s.points.find((p) => p.key === key)
      row[s.label] = pt?.value ?? 0
    }
    return row
  })

  return (
    <div>
      <div className="sr-only">
        <table>
          <caption>Chart data for accessibility</caption>
          <thead>
            <tr>
              <th>Label</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allKeys.map((key) => (
              <tr key={key}>
                <td>{key}</td>
                {series.map((s) => {
                  const pt = s.points.find((p) => p.key === key)
                  return <td key={s.key}>{pt?.value ?? 0}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div role="img" aria-label="Line chart">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.label}
                stroke={WIDGET_SERIES_COLORS[i % WIDGET_SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Hand-rolled legend: swatch + label + value (no datum encoded by colour alone) */}
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s, i) => {
          const total = s.points.reduce((sum, p) => sum + p.value, 0)
          return (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: WIDGET_SERIES_COLORS[i % WIDGET_SERIES_COLORS.length] }}
              />
              {s.label}: {total.toLocaleString()}
            </div>
          )
        })}
      </div>
    </div>
  )
}
