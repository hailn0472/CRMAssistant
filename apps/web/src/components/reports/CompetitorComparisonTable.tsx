'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatWinRate } from '@/lib/win-loss-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import type { CompetitorOutcome } from '@/services/win-loss.service'

interface CompetitorComparisonTableProps {
  competitors: CompetitorOutcome[]
  currency: string
}

export function CompetitorComparisonTable({
  competitors,
  currency,
}: CompetitorComparisonTableProps): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#ececf0] bg-white">
      <div className="border-b border-[#f2f2f5] px-[22px] py-4">
        <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Competitor Comparison</h2>
        <p className="text-[12.5px] text-[#8c8c96]">Head-to-head on closed deals</p>
      </div>

      {competitors.length === 0 ? (
        <p className="px-[22px] py-6 text-center text-[13px] text-[#8c8c96]">
          No competitors recorded for closed deals in this range.
        </p>
      ) : (
        <ResponsiveTableWrapper>
          <table className="w-full min-w-[520px] text-left text-[13.5px]">
            <caption className="sr-only">Win/loss outcomes per competitor</caption>
            <thead>
              <tr className="border-b border-[#f2f2f5] bg-[#fafafb] text-[11px] font-semibold uppercase tracking-wider text-[#8c8c96]">
                <th scope="col" className="py-2.5 pl-[22px] pr-4">
                  Competitor
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right">
                  Won
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right">
                  Lost
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right">
                  Win rate
                </th>
                <th scope="col" className="py-2.5 pr-[22px] text-right">
                  Total value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f7]">
              {competitors.map((competitor) => (
                <tr key={competitor.competitorId} className="hover:bg-[#fafafb]">
                  <td className="py-3 pl-[22px] pr-4 font-medium text-[#1b1b1f]">
                    {competitor.competitorName}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-[12.5px] text-[#22a06b]">
                    {competitor.wonCount}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-[12.5px] text-[#b91c1c]">
                    {competitor.lostCount}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-[12.5px] font-medium text-[#1b1b1f]">
                    {formatWinRate(competitor.winRate)}
                  </td>
                  <td className="py-3 pr-[22px] text-right font-mono text-[12.5px] text-[#4b4b55]">
                    {formatCurrency(competitor.totalValue, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      <p className="px-[22px] py-3 text-[12px] text-[#a0a0aa]">
        Amounts are summed without currency conversion.
      </p>
    </section>
  )
}
