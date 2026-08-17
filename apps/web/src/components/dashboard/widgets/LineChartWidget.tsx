'use client'

/**
 * Story 6.4 (Contract F.33) — LineChartWidget adapter for ReportChart.
 *
 * Adapts WidgetResultData to NormalizedLineChart and renders via ReportChart.
 * Preserves widget legend (swatch + label + total), sr-only accessibility table,
 * empty state behavior, and color assignments.
 */
import React, { useMemo } from 'react'

import { getPaletteHexArray } from '@/components/reports/charting/report-chart-theme'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedLineChart } from '@/lib/report-chart'
import type { CustomReportColorToken } from '@/services/custom-report.service'
import type { WidgetResultData } from '@/services/dashboard.service'

const WIDGET_CHART_COLORS: CustomReportColorToken[] = ['BLUE', 'GREEN', 'AMBER', 'RED', 'VIOLET']
const WIDGET_PALETTE_HEX = getPaletteHexArray(WIDGET_CHART_COLORS)

export function LineChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data

  // Flatten for chart points — each unique point key across series becomes a point
  const allKeys = useMemo(
    () => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.key)))).sort(),
    [series],
  )

  const normalizedChart: NormalizedLineChart = useMemo(() => {
    const points = allKeys.map((key) => {
      const values: Record<string, number | null> = {}
      for (const s of series) {
        const pt = s.points.find((p) => p.key === key)
        values[s.key] = pt?.value ?? 0
      }
      return {
        key,
        label: key,
        dimensionLabels: [key],
        values,
      }
    })

    const srHeaders = ['Label', ...series.map((s) => s.label)]
    const srRows = allKeys.map((key) => {
      const row = [key]
      for (const s of series) {
        const pt = s.points.find((p) => p.key === key)
        row.push(String(pt?.value ?? 0))
      }
      return row
    })

    return {
      type: 'LINE',
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: WIDGET_CHART_COLORS,
      legendPosition: 'BOTTOM',
      xAxisLabel: null,
      yAxisLabel: null,
      series: series.map((s) => ({
        metricId: s.key,
        label: s.label,
      })),
      points,
      totalPoints: points.length,
      srTable: {
        headers: srHeaders,
        rows: srRows,
      },
    }
  }, [allKeys, series])

  if (!series.length) return <p className="text-sm text-slate-500">No data available</p>

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
      <ReportChart chart={normalizedChart} minHeight={200} hideControls={true} hideSrTable={true} />
      {/* Hand-rolled legend: swatch + label + value (no datum encoded by colour alone) */}
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s, i) => {
          const total = s.points.reduce((sum, p) => sum + p.value, 0)
          return (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: WIDGET_PALETTE_HEX[i % WIDGET_PALETTE_HEX.length] }}
              />
              {s.label}: {total.toLocaleString()}
            </div>
          )
        })}
      </div>
    </div>
  )
}
