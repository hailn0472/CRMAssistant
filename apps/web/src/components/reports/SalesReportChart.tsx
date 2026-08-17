'use client'

/**
 * Story 6.2 / 6.4 (Contract F.33) — SalesReportChart adapter for ReportChart.
 *
 * Converts sales report series data into a NormalizedBarChart and renders via
 * the shared ReportChart framework. Preserves role="img", custom title,
 * keyboard drill path, sr-only table, empty behavior, and onDrill callback.
 */
import React, { useMemo } from 'react'

import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedBarChart } from '@/lib/report-chart'

export type ChartDatum = {
  key: string
  label: string
  value: number
  count: number
  formatted: string
}

export type SalesReportChartProps = {
  title: string
  ariaLabel: string
  series: ChartDatum[]
  onDrill: (bucketKey: string) => void
  emptyMessage?: string
}

type TooltipPayloadItem = {
  value?: number
  payload?: { label?: string; count?: number; formatted?: string }
}

function SalesReportTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  const datum = item?.payload
  if (!datum) return null
  return (
    <div className="rounded-lg border border-[#e6e6eb] bg-white px-3 py-2 shadow-md">
      <p className="text-[12px] font-semibold text-[#1b1b1f]">{datum.label}</p>
      <p className="text-[12px] text-[#4b4b55]">
        {datum.formatted ?? String(item.value ?? '')}
        {typeof datum.count === 'number' ? ` · ${datum.count} deals` : ''}
      </p>
    </div>
  )
}

export function SalesReportChart({
  title,
  ariaLabel,
  series,
  onDrill,
  emptyMessage = 'No data for the selected period.',
}: SalesReportChartProps): React.JSX.Element {
  const seriesByLabel = useMemo(() => new Map(series.map((d) => [d.label, d])), [series])

  const normalizedChart: NormalizedBarChart = useMemo(
    () => ({
      type: 'BAR',
      title,
      showLegend: true,
      showDataLabels: false,
      colors: ['BLUE'],
      legendPosition: 'BOTTOM',
      orientation: 'VERTICAL',
      xAxisLabel: null,
      yAxisLabel: null,
      series: [
        {
          metricId: 'value',
          label: title,
        },
      ],
      points: series.map((datum) => ({
        key: datum.key,
        label: datum.label,
        dimensionLabels: [datum.label],
        values: {
          value: datum.value,
        },
      })),
      totalPoints: series.length,
      srTable: {
        headers: ['Period', 'Value', 'Deals'],
        rows: series.map((datum) => [datum.label, datum.formatted, String(datum.count)]),
      },
    }),
    [title, series],
  )

  const customTooltip: React.ComponentProps<typeof ReportChart>['customTooltip'] = (props) => {
    if (!props.active || !props.payload || props.payload.length === 0) return null
    const item = props.payload[0]
    const label = item?.payload?.label
    const datum = label ? seriesByLabel.get(label) : undefined
    return (
      <SalesReportTooltip
        active={props.active}
        payload={[
          {
            value: item?.value as number | undefined,
            payload: datum ?? { label },
          },
        ]}
      />
    )
  }

  return (
    <section
      aria-labelledby="sales-report-chart-title"
      className="rounded-[14px] border border-[#ececf0] bg-white p-[18px]"
    >
      <h3 id="sales-report-chart-title" className="text-[15px] font-semibold text-[#1b1b1f]">
        {title}
      </h3>
      {series.length === 0 ? (
        <p className="mt-6 text-center text-[13px] text-[#8c8c96]">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-4">
            <ReportChart
              chart={normalizedChart}
              minHeight={280}
              hideControls={true}
              hideSrTable={true}
              hideDrillMarksBar={true}
              ariaLabel={ariaLabel}
              customTooltip={customTooltip}
              onDrillDown={(req) => onDrill(req.pointKey)}
            />
          </div>

          {/* Keyboard path: an explicit "View underlying deals" button per datum (AC 72). */}
          <ul
            className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto"
            aria-label={`${title} drill buttons`}
          >
            {series.map((datum) => (
              <li key={datum.key}>
                <button
                  type="button"
                  onClick={() => onDrill(datum.key)}
                  className="min-h-[44px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-3 text-[12px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f0f0f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1b1f]"
                >
                  View underlying deals: {datum.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Complete sr-only alternative table with every datum (AC 73). */}
          <table className="sr-only" aria-label={ariaLabel}>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Value</th>
                <th scope="col">Deals</th>
              </tr>
            </thead>
            <tbody>
              {series.map((datum) => (
                <tr key={datum.key} className="sr-only">
                  <td>{datum.label}</td>
                  <td>{datum.formatted}</td>
                  <td>{datum.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
