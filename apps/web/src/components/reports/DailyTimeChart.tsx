'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatDurationShort, formatDurationTick } from '@/lib/time-format'
import type { ProductivityBucket, ProductivityTimeBucket } from '@/services/productivity.service'

// Story 4.5 daily/weekly/monthly bar chart (AC 41-42). BarChart is a first
// use in this repo; the theming block copies ForecastChart's AreaChart
// exactly (CartesianGrid #ececf0, axis ticks #8c8c96, custom Tooltip,
// role="img" + sr-only table).
export function DailyTimeChart({
  buckets,
  bucket,
}: {
  buckets: ProductivityTimeBucket[]
  bucket: ProductivityBucket
}): React.JSX.Element {
  const unitLabel = bucket === 'DAY' ? 'day' : bucket === 'WEEK' ? 'week' : 'month'
  const ariaLabel = `Time tracked per ${unitLabel}`
  const chartData = buckets.map((b) => ({
    ...b,
    label: b.bucketStart.slice(0, 10),
  }))

  return (
    <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] pb-4 pt-5">
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Tracked time trend</h2>
          <span className="text-[12.5px] text-[#8c8c96]">Per {unitLabel} · all times are UTC</span>
        </div>
      </div>

      <div role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid stroke="#ececf0" vertical={false} />
            <XAxis
              dataKey="label"
              fontSize={11.5}
              tick={{ fill: '#8c8c96' }}
              axisLine={{ stroke: '#ececf0' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              fontSize={11}
              tick={{ fill: '#a0a0aa' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatDurationTick}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const datum = payload[0]?.payload as
                  | { label: string; totalSeconds: number }
                  | undefined
                if (!datum) return null
                return (
                  <div className="rounded-[9px] border border-[#ececf0] bg-white px-3 py-2 text-[13px] shadow-md">
                    <p className="font-medium text-[#1b1b1f]">{datum.label}</p>
                    <p className="text-[#4f46e5]">{formatDurationShort(datum.totalSeconds)}</p>
                  </div>
                )
              }}
            />
            <Bar dataKey="totalSeconds" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
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
