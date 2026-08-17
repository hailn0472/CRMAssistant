'use client'

/**
 * Story 6.4 (Contract F.33) — FunnelWidget adapter for ReportChart.
 *
 * Adapts WidgetResultData to NormalizedFunnelChart and renders via ReportChart.
 * Preserves widget legend (swatch + label + total), sr-only accessibility table,
 * empty state behavior, and color assignments.
 */
import React, { useMemo } from 'react'

import { getPaletteHexArray } from '@/components/reports/charting/report-chart-theme'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedFunnelChart } from '@/lib/report-chart'
import type { CustomReportColorToken } from '@/services/custom-report.service'
import type { WidgetResultData } from '@/services/dashboard.service'

const WIDGET_CHART_COLORS: CustomReportColorToken[] = ['BLUE', 'GREEN', 'AMBER', 'RED', 'VIOLET']
const WIDGET_PALETTE_HEX = getPaletteHexArray(WIDGET_CHART_COLORS)

export function FunnelWidget({ data }: { data: WidgetResultData }): React.JSX.Element {
  const { series } = data

  const firstSeries = series[0]

  const normalizedChart: NormalizedFunnelChart | null = useMemo(() => {
    if (!firstSeries) return null
    const stages = firstSeries.points.map((p, idx) => {
      const prevVal = idx > 0 ? firstSeries.points[idx - 1]!.value : null
      const firstVal = firstSeries.points[0]?.value ?? 0
      const prevRate =
        prevVal !== null && prevVal > 0 ? Math.round((p.value / prevVal) * 100) : null
      const overallRate = firstVal > 0 ? Math.round((p.value / firstVal) * 100) : null

      return {
        key: p.key,
        stageName: p.label,
        value: p.value,
        previousConversionRate: prevRate,
        overallConversionRate: overallRate,
        dimensionLabels: [p.label],
        metricId: firstSeries.key,
      }
    })

    return {
      type: 'FUNNEL',
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: WIDGET_CHART_COLORS,
      legendPosition: 'BOTTOM',
      metricId: firstSeries.key,
      metricLabel: firstSeries.label,
      stages,
      totalPoints: stages.length,
      srTable: {
        headers: ['Stage', 'Value'],
        rows: firstSeries.points.map((p) => [p.label, String(p.value)]),
      },
    }
  }, [firstSeries])

  if (!series.length || !firstSeries || !normalizedChart) {
    return <p className="text-sm text-slate-500">No data available</p>
  }

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
      <ReportChart chart={normalizedChart} minHeight={200} hideControls={true} hideSrTable={true} />
      {/* Hand-rolled legend: swatch + label + value (no datum encoded by colour alone) */}
      <div className="mt-2 flex flex-wrap gap-3" data-testid="funnel-legend">
        {firstSeries.points.map((p, i) => (
          <div key={p.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: WIDGET_PALETTE_HEX[i % WIDGET_PALETTE_HEX.length] }}
            />
            {p.label}: {p.value}
          </div>
        ))}
      </div>
    </div>
  )
}
