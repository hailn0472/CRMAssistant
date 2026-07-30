'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatVariance, accuracyBand } from '@/lib/forecast-format'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ForecastAccuracyPeriod } from '@/services/forecast.service'

interface ForecastAccuracyTableProps {
  periods: ForecastAccuracyPeriod[]
  currency: string
}

export function ForecastAccuracyTable({
  periods,
  currency,
}: ForecastAccuracyTableProps): React.JSX.Element {
  if (periods.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forecast Accuracy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">No completed periods to show.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast Accuracy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-slate-500 uppercase">
                <th className="pb-2 pr-4">Period</th>
                <th className="pb-2 pr-4">Forecast</th>
                <th className="pb-2 pr-4">Actual</th>
                <th className="pb-2 pr-4">Variance</th>
                <th className="pb-2 pr-4">Accuracy</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const periodLabel = p.periodStart.slice(0, 7)
                return (
                  <tr key={p.periodStart} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{periodLabel}</td>
                    <td className="py-2 pr-4">
                      {p.forecastValue !== null ? (
                        formatCurrency(p.forecastValue, currency)
                      ) : (
                        <span
                          className="text-slate-400 cursor-help"
                          title="No snapshot recorded for this period"
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{formatCurrency(p.actualValue, currency)}</td>
                    <td className="py-2 pr-4">
                      {p.variance !== null ? (
                        <span className={p.variance >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatVariance(p.variance)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {p.accuracyPct !== null ? (
                        `${Math.round(p.accuracyPct)}%`
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {p.accuracyPct !== null ? (
                        <span
                          className={
                            p.accuracyPct >= 95
                              ? 'text-green-600'
                              : p.accuracyPct >= 80
                                ? 'text-yellow-600'
                                : 'text-red-600'
                          }
                        >
                          {accuracyBand(p.accuracyPct)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {p.accuracyPct === null && <span className="sr-only">No data</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
