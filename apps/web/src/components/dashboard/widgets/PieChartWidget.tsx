'use client'

/**
 * Story 6.4 (Contract F.33) — PieChartWidget adapter for ReportChart.
 *
 * Adapts WidgetResultData to NormalizedPieChart and renders via ReportChart.
 * Preserves widget legend (swatch + label + total), sr-only accessibility table,
 * empty state behavior, and color assignments.
 */
import React, { useMemo } from 'react'

import { getPaletteHexArray } from '@/components/reports/charting/report-chart-theme'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedPieChart } from '@/lib/report-chart'
import type { CustomReportColorToken } from '@/services/custom-report.service'
import type { WidgetResultData } from '@/services/dashboard.service'

const WIDGET_CHART_COLORS: CustomReportColorToken[] = ['BLUE', 'GREEN', 'AMBER', 'RED', 'VIOLET']
const WIDGET_PALETTE_HEX = getPaletteHexArray(WIDGET_CHART_COLORS)

export function PieChartWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data

  const firstSeries = series[0]

  const pieData = useMemo(() => {
    if (!firstSeries) return []
    return firstSeries.points.map((p, i) => ({
      name: p.label,
      value: p.value,
      color: WIDGET_PALETTE_HEX[i % WIDGET_PALETTE_HEX.length],
    }))
  }, [firstSeries])

  const normalizedChart: NormalizedPieChart | null = useMemo(() => {
    if (!firstSeries) return null
    const total = firstSeries.points.reduce((sum, p) => sum + p.value, 0)
    const slices = firstSeries.points.map((p) => {
      const percentage = total > 0 ? Math.round((p.value / total) * 100) : 0
      return {
        key: p.key,
        label: p.label,
        value: p.value,
        percentage,
        dimensionLabels: [p.label],
        metricId: firstSeries.key,
      }
    })

    return {
      type: 'PIE',
      isDonut: false,
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: WIDGET_CHART_COLORS,
      legendPosition: 'BOTTOM',
      metricId: firstSeries.key,
      metricLabel: firstSeries.label,
      total,
      slices,
      totalPoints: slices.length,
      srTable: {
        headers: ['Label', 'Value'],
        rows: firstSeries.points.map((p) => [p.label, String(p.value)]),
      },
    }
  }, [firstSeries])

  if (!series.length || !normalizedChart) {
    return <p className="text-sm text-slate-500">No data available</p>
  }

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
      <ReportChart chart={normalizedChart} minHeight={200} hideControls={true} hideSrTable={true} />
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
