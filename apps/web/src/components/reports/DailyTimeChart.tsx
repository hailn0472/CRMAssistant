'use client'

/**
 * Story 6.4 (Contract F.34) — DailyTimeChart adapter for ReportChart BAR primitive.
 *
 * Renders daily/weekly/monthly tracked time bar chart via ReportChart framework.
 * Preserves duration formatters, sr-only accessibility table, and aria-labels.
 */
import React, { useMemo } from 'react'

import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedBarChart } from '@/lib/report-chart'
import { formatDurationShort } from '@/lib/time-format'
import type { ProductivityBucket, ProductivityTimeBucket } from '@/services/productivity.service'

export function DailyTimeChart({
  buckets,
  bucket,
}: {
  buckets: ProductivityTimeBucket[]
  bucket: ProductivityBucket
}): React.JSX.Element {
  const unitLabel = bucket === 'DAY' ? 'day' : bucket === 'WEEK' ? 'week' : 'month'
  const ariaLabel = `Time tracked per ${unitLabel}`

  const chartData = useMemo(
    () =>
      buckets.map((b) => ({
        ...b,
        label: b.bucketStart.slice(0, 10),
      })),
    [buckets],
  )

  const normalizedChart: NormalizedBarChart = useMemo(() => {
    return {
      type: 'BAR',
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: ['INDIGO'],
      legendPosition: 'BOTTOM',
      orientation: 'VERTICAL',
      xAxisLabel: null,
      yAxisLabel: null,
      series: [
        {
          metricId: 'totalSeconds',
          label: 'Total Seconds',
        },
      ],
      points: chartData.map((d) => ({
        key: d.bucketStart,
        label: d.label,
        dimensionLabels: [d.label],
        values: {
          totalSeconds: d.totalSeconds,
        },
      })),
      totalPoints: chartData.length,
      srTable: {
        headers: [
          unitLabel === 'day' ? 'Day' : unitLabel === 'week' ? 'Week starting' : 'Month',
          'Time tracked',
        ],
        rows: chartData.map((entry) => [entry.label, formatDurationShort(entry.totalSeconds)]),
      },
    }
  }, [chartData, unitLabel])

  return (
    <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] pb-4 pt-5">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Tracked time trend</h2>
          <span className="text-[12.5px] text-[#8c8c96]">Per {unitLabel} · all times are UTC</span>
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

      {/* sr-only table for accessibility (AC 42) */}
      <table className="sr-only" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th>
              {unitLabel === 'day' ? 'Day' : unitLabel === 'week' ? 'Week starting' : 'Month'}
            </th>
            <th>Time tracked</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((entry) => (
            <tr key={entry.bucketStart}>
              <td>{entry.label}</td>
              <td>{formatDurationShort(entry.totalSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
