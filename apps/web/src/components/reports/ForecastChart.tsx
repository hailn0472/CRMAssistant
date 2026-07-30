'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatAxisTick } from '@/lib/forecast-format'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ForecastBucket, ForecastGroupBy } from '@/services/forecast.service'

interface ForecastChartProps {
  buckets: ForecastBucket[]
  groupBy: ForecastGroupBy
  currency: string
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

  const ariaLabel = `Weighted sales forecast by ${groupBy === 'MONTH' ? 'month' : groupBy === 'QUARTER' ? 'quarter' : groupBy === 'OWNER' ? 'owner' : 'team'}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tickFormatter={formatAxisTick} fontSize={12} />
              <YAxis
                fontSize={12}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-md border bg-white px-3 py-2 text-sm shadow-md">
                      <p className="font-medium">{payload[0].payload.label}</p>
                      <p className="text-blue-600">
                        {formatCurrency(Number(payload[0].value), currency)}
                      </p>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="weightedValue"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Weighted Forecast"
              />
            </LineChart>
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
      </CardContent>
    </Card>
  )
}
