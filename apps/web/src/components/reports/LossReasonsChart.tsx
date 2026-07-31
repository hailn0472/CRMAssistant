'use client'

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

import { formatReasonLabel } from '@/lib/win-loss-format'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { WinLossReasonBucket } from '@/services/win-loss.service'

interface LossReasonsChartProps {
  winReasons: WinLossReasonBucket[]
  lossReasons: WinLossReasonBucket[]
  currency: string
}

/**
 * Bar chart of win/loss reason counts. Won = green, lost = red per the
 * semantic colour map — violet is reserved for AI surfaces and never used here.
 */
export function LossReasonsChart({
  winReasons,
  lossReasons,
  currency,
}: LossReasonsChartProps): React.JSX.Element {
  const reasons = new Map<string, { wonCount: number; lostCount: number }>()
  for (const bucket of winReasons) {
    reasons.set(bucket.reason, {
      wonCount: bucket.count,
      lostCount: reasons.get(bucket.reason)?.lostCount ?? 0,
    })
  }
  for (const bucket of lossReasons) {
    const existing = reasons.get(bucket.reason) ?? { wonCount: 0, lostCount: 0 }
    reasons.set(bucket.reason, { ...existing, lostCount: bucket.count })
  }

  const chartData = Array.from(reasons.entries()).map(([reason, counts]) => ({
    reason,
    label: formatReasonLabel(reason),
    wonCount: counts.wonCount,
    lostCount: counts.lostCount,
  }))

  const ariaLabel = `Win and loss reasons for closed deals (${currency})`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Win/Loss Reasons</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-md border bg-white px-3 py-2 text-sm shadow-md">
                      <p className="font-medium">{payload[0].payload.label}</p>
                      {payload.map((entry) => (
                        <p
                          key={String(entry.dataKey)}
                          className={
                            entry.dataKey === 'wonCount' ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          {entry.dataKey === 'wonCount' ? 'Won' : 'Lost'}: {Number(entry.value)}
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Bar dataKey="wonCount" name="Won" fill="#16A34A" radius={[4, 4, 0, 0]} />
              <Bar dataKey="lostCount" name="Lost" fill="#DC2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* sr-only table for accessibility */}
        <table className="sr-only" aria-label={ariaLabel}>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Won deals</th>
              <th>Lost deals</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((row) => (
              <tr key={row.reason}>
                <td>{row.label}</td>
                <td>{row.wonCount}</td>
                <td>{row.lostCount}</td>
              </tr>
            ))}
            {chartData.length === 0 && (
              <tr>
                <td colSpan={3}>No reasons recorded</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-400">
          Amounts are summed without currency conversion.
        </p>
      </CardContent>
    </Card>
  )
}
