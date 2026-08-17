'use client'

/**
 * Story 6.4 (Contract F.34) — ForecastChart adapter for ReportChart AREA primitive.
 *
 * Renders sales forecast trend via the ReportChart framework. Preserves
 * currency/duration formatters, range subtitle, header legend, sr-only
 * accessibility table, and aria-labels.
 */
import React, { useMemo } from 'react'

import { formatCurrency } from '@/components/deals/deal-display'
import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedAreaChart } from '@/lib/report-chart'
import type { ForecastBucket, ForecastGroupBy } from '@/services/forecast.service'

interface ForecastChartProps {
  buckets: ForecastBucket[]
  groupBy: ForecastGroupBy
  currency: string
}

const GROUP_BY_LABEL: Record<ForecastGroupBy, string> = {
  MONTH: 'month',
  QUARTER: 'quarter',
  OWNER: 'owner',
  TEAM: 'team',
}

export function ForecastChart({
  buckets,
  groupBy,
  currency,
}: ForecastChartProps): React.JSX.Element {
  const groupByLabel = GROUP_BY_LABEL[groupBy]
  const ariaLabel = `Weighted sales forecast by ${groupByLabel}`
  const rangeLabel =
    buckets.length > 1
      ? `${buckets[0]!.label} – ${buckets[buckets.length - 1]!.label}`
      : buckets[0]?.label

  const normalizedChart: NormalizedAreaChart = useMemo(() => {
    return {
      type: 'AREA',
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: ['INDIGO'],
      legendPosition: 'BOTTOM',
      xAxisLabel: null,
      yAxisLabel: null,
      series: [
        {
          metricId: 'weightedValue',
          label: 'Weighted Forecast',
        },
      ],
      points: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        dimensionLabels: [b.label],
        values: {
          weightedValue: b.weightedValue,
        },
        rawValues: {
          weightedValue: b.weightedValue,
        },
      })),
      totalPoints: buckets.length,
      srTable: {
        headers: ['Period', 'Weighted Value', 'Total Value', 'Deal Count'],
        rows: buckets.map((b) => [
          b.label,
          formatCurrency(b.weightedValue, currency),
          formatCurrency(b.totalValue, currency),
          String(b.count),
        ]),
      },
    }
  }, [buckets, currency])

  return (
    <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] pb-4 pt-5">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Forecast trend</h2>
          <span className="text-[12.5px] text-[#8c8c96]">
            Weighted value by {groupByLabel}
            {rangeLabel ? ` · ${rangeLabel}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3.5 text-[12px] text-[#6b6b76]">
          <span className="flex items-center gap-1.5">
            <span className="block h-0.5 w-4 bg-[#4f46e5]" />
            Weighted
          </span>
        </div>
      </div>

      <div role="img" aria-label={ariaLabel}>
        <ReportChart
          chart={normalizedChart}
          minHeight={250}
          hideControls={true}
          hideSrTable={true}
        />
      </div>
      {/* sr-only table for accessibility */}
      <table className="sr-only" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th>Period</th>
            <th>Weighted Value</th>
            <th>Total Value</th>
            <th>Deal Count</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key}>
              <td>{b.label}</td>
              <td>{formatCurrency(b.weightedValue, currency)}</td>
              <td>{formatCurrency(b.totalValue, currency)}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
