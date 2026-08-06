'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { TIME_CHART_COLORS, TIME_OTHER_COLOR, formatDurationShort } from '@/lib/time-format'
import type { ProductivityTaskBucket } from '@/services/productivity.service'

// Story 4.5 time-distribution pie (AC 41-42). recharts PieChart is a first
// use in this repo — the house contract from ForecastChart applies: plain
// card shell, custom Tooltip render prop, role="img" wrapper, sr-only table
// with every datum, hand-rolled legend (swatch + label + value). No datum may
// be encoded by colour alone.
export function TimeDistributionChart({
  byTask,
}: {
  byTask: ProductivityTaskBucket[]
}): React.JSX.Element {
  const ariaLabel = 'Time distribution by task'
  const totalSeconds = byTask.reduce((sum, entry) => sum + entry.totalSeconds, 0)

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
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={byTask}
              dataKey="totalSeconds"
              nameKey="taskTitle"
              cx="50%"
              cy="50%"
              outerRadius={90}
            >
              {byTask.map((entry, index) => (
                <Cell
                  key={entry.taskId}
                  fill={
                    entry.taskTitle === 'Other'
                      ? TIME_OTHER_COLOR
                      : TIME_CHART_COLORS[index % TIME_CHART_COLORS.length]
                  }
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const datum = payload[0]?.payload as ProductivityTaskBucket | undefined
                if (!datum) return null
                return (
                  <div className="rounded-[9px] border border-[#ececf0] bg-white px-3 py-2 text-[13px] shadow-md">
                    <p className="font-medium text-[#1b1b1f]">{datum.taskTitle}</p>
                    <p className="text-[#4b4b55]">
                      {formatDurationShort(datum.totalSeconds)} · {datum.percentage}%
                    </p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
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
