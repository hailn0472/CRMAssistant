'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatVariance, accuracyBand } from '@/lib/forecast-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
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
      <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] py-5">
        <h2 className="mb-3 text-[15px] font-semibold text-[#1b1b1f]">Forecast Accuracy</h2>
        <p className="text-[13px] text-[#8c8c96]">No completed periods to show.</p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
      <div className="border-b border-[#f2f2f5] px-[22px] py-4">
        <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Forecast Accuracy</h2>
      </div>
      <ResponsiveTableWrapper>
        <table className="w-full min-w-[640px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
              <th className="py-2.5 pl-[22px] pr-4">Period</th>
              <th className="py-2.5 pr-4">Forecast</th>
              <th className="py-2.5 pr-4">Actual</th>
              <th className="py-2.5 pr-4">Variance</th>
              <th className="py-2.5 pr-4">Accuracy</th>
              <th className="py-2.5 pr-[22px]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f4f4f7]">
            {periods.map((p) => {
              const periodLabel = p.periodStart.slice(0, 7)
              return (
                <tr key={p.periodStart}>
                  <td className="py-3 pl-[22px] pr-4 font-medium text-[#1b1b1f]">{periodLabel}</td>
                  <td className="py-3 pr-4 font-mono text-[12.5px] text-[#4b4b55]">
                    {p.forecastValue !== null ? (
                      formatCurrency(p.forecastValue, currency)
                    ) : (
                      <span
                        className="cursor-help text-[#a0a0aa]"
                        title="No snapshot recorded for this period"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12.5px] text-[#1b1b1f]">
                    {formatCurrency(p.actualValue, currency)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12.5px]">
                    {p.variance !== null ? (
                      <span style={{ color: p.variance >= 0 ? '#22a06b' : '#b91c1c' }}>
                        {formatVariance(p.variance)}
                      </span>
                    ) : (
                      <span className="text-[#a0a0aa]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[12.5px] text-[#1b1b1f]">
                    {p.accuracyPct !== null ? (
                      `${Math.round(p.accuracyPct)}%`
                    ) : (
                      <span className="text-[#a0a0aa]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-[22px] text-[12.5px] font-medium">
                    {p.accuracyPct !== null ? (
                      <span
                        style={{
                          color:
                            p.accuracyPct >= 95
                              ? '#22a06b'
                              : p.accuracyPct >= 80
                                ? '#c2860a'
                                : '#b91c1c',
                        }}
                      >
                        {accuracyBand(p.accuracyPct)}
                      </span>
                    ) : (
                      <span className="text-[#a0a0aa]">—</span>
                    )}
                    {p.accuracyPct === null && <span className="sr-only">No data</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </section>
  )
}
