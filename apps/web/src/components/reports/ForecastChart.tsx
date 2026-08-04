'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatAxisTick } from '@/lib/forecast-format'
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
  const chartData = buckets.map((b) => ({
    label: b.label,
    weightedValue: b.weightedValue,
    totalValue: b.totalValue,
    count: b.count,
  }))

  const groupByLabel = GROUP_BY_LABEL[groupBy]
  const ariaLabel = `Weighted sales forecast by ${groupByLabel}`
  const rangeLabel =
    buckets.length > 1
      ? `${buckets[0]!.label} – ${buckets[buckets.length - 1]!.label}`
      : buckets[0]?.label

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
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <CartesianGrid stroke="#ececf0" vertical={false} />
            <XAxis
              dataKey="label"
              tickFormatter={formatAxisTick}
              fontSize={11.5}
              tick={{ fill: '#8c8c96' }}
              axisLine={{ stroke: '#ececf0' }}
              tickLine={false}
            />
            <YAxis
              fontSize={11}
              tick={{ fill: '#a0a0aa' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-[9px] border border-[#ececf0] bg-white px-3 py-2 text-[13px] shadow-md">
                    <p className="font-medium text-[#1b1b1f]">{payload[0]!.payload.label}</p>
                    <p className="text-[#4f46e5]">
                      {formatCurrency(Number(payload[0]!.value), currency)}
                    </p>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="weightedValue"
              name="Weighted Forecast"
              stroke="#4f46e5"
              strokeWidth={2.5}
              fill="#4f46e5"
              fillOpacity={0.07}
              dot={{ r: 4, fill: '#fff', stroke: '#4f46e5', strokeWidth: 2.5 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
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
