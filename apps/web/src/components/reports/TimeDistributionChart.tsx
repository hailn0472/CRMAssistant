'use client'

/**
 * Story 6.4 (Contract F.34) — TimeDistributionChart adapter for ReportChart PIE primitive.
 *
 * Renders time distribution pie chart via ReportChart framework. Preserves
 * duration formatters, Other slice color, hand-rolled legend, sr-only table,
 * and aria-labels.
 */
import React, { useMemo } from 'react'

import { ReportChart } from '@/components/reports/charting/ReportChart'
import type { NormalizedPieChart } from '@/lib/report-chart'
import { TIME_CHART_COLORS, TIME_OTHER_COLOR, formatDurationShort } from '@/lib/time-format'
import type { ProductivityTaskBucket } from '@/services/productivity.service'

export function TimeDistributionChart({
  byTask,
}: {
  byTask: ProductivityTaskBucket[]
}): React.JSX.Element {
  const ariaLabel = 'Time distribution by task'
  const totalSeconds = byTask.reduce((sum, entry) => sum + entry.totalSeconds, 0)

  const normalizedChart: NormalizedPieChart = useMemo(() => {
    const slices = byTask.map((entry) => ({
      key: entry.taskId || entry.taskTitle,
      label: entry.taskTitle,
      value: entry.totalSeconds,
      percentage: entry.percentage,
      dimensionLabels: [entry.taskTitle],
      metricId: 'totalSeconds',
    }))

    return {
      type: 'PIE',
      isDonut: false,
      title: null,
      showLegend: false,
      showDataLabels: false,
      colors: ['BLUE', 'VIOLET', 'GREEN', 'AMBER', 'RED'],
      legendPosition: 'BOTTOM',
      metricId: 'totalSeconds',
      metricLabel: 'Time Tracked',
      total: totalSeconds,
      slices,
      totalPoints: slices.length,
      srTable: {
        headers: ['Task', 'Time tracked', 'Share'],
        rows: byTask.map((entry) => [
          entry.taskTitle,
          formatDurationShort(entry.totalSeconds),
          `${entry.percentage}%`,
        ]),
      },
    }
  }, [byTask, totalSeconds])

  return (
    <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] pb-4 pt-5">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Time by task</h2>
          <span className="text-[12.5px] text-[#8c8c96]">
            {formatDurationShort(totalSeconds)} tracked
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

      {/* sr-only table for accessibility (AC 42) */}
      <table className="sr-only" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th>Task</th>
            <th>Time tracked</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {byTask.map((entry) => (
            <tr key={entry.taskId}>
              <td>{entry.taskTitle}</td>
              <td>{formatDurationShort(entry.totalSeconds)}</td>
              <td>{entry.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Hand-rolled legend: swatch + label + value (LossReasonsChart pattern). */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[#f2f2f5] pt-2.5">
        {byTask.map((entry, index) => (
          <span key={entry.taskId} className="flex items-center gap-1.5 text-[12px] text-[#6b6b76]">
            <span
              className="block h-[9px] w-[9px] flex-none rounded-[3px]"
              style={{
                background:
                  entry.taskTitle === 'Other'
                    ? TIME_OTHER_COLOR
                    : TIME_CHART_COLORS[index % TIME_CHART_COLORS.length],
              }}
            />
            {entry.taskTitle}
            <span className="font-medium text-[#1b1b1f]">
              {formatDurationShort(entry.totalSeconds)}
            </span>
          </span>
        ))}
      </div>
    </section>
  )
}
