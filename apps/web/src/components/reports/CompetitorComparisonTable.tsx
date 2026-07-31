'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatWinRate } from '@/lib/win-loss-format'
import { ResponsiveTableWrapper } from '@/components/shared/ResponsiveTableWrapper'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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
    <Card>
      <CardHeader>
        <CardTitle>Competitor Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        {competitors.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No competitors recorded for closed deals in this range.
          </p>
        ) : (
          <ResponsiveTableWrapper>
            <table className="w-full text-sm">
              <caption className="sr-only">Win/loss outcomes per competitor</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">
                    Competitor
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Won
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Lost
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Win rate
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Total value
                  </th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((competitor) => (
                  <tr
                    key={competitor.competitorId}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium">{competitor.competitorName}</td>
                    <td className="px-4 py-3 text-green-600">{competitor.wonCount}</td>
                    <td className="px-4 py-3 text-red-600">{competitor.lostCount}</td>
                    <td className="px-4 py-3">{formatWinRate(competitor.winRate)}</td>
                    <td className="px-4 py-3">{formatCurrency(competitor.totalValue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Amounts are summed without currency conversion.
        </p>
      </CardContent>
    </Card>
  )
}
