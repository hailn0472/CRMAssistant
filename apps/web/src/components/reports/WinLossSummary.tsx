'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatWinRate } from '@/lib/win-loss-format'
import { Card, CardContent } from '@/components/ui/card'

interface WinLossSummaryProps {
  wonCount: number
  lostCount: number
  winRate: number
  wonValue: number
  lostValue: number
  currency: string
}

/**
 * Summary cards for the win/loss report. The win rate is explicitly labelled
 * "Win rate (closed deals)" — it is NOT a pipeline conversion rate.
 */
export function WinLossSummary({
  wonCount,
  lostCount,
  winRate,
  wonValue,
  lostValue,
  currency,
}: WinLossSummaryProps): React.JSX.Element {
  const cards = [
    {
      label: 'Won deals',
      value: String(wonCount),
      tone: 'text-green-600',
    },
    {
      label: 'Lost deals',
      value: String(lostCount),
      tone: 'text-red-600',
    },
    {
      label: 'Win rate (closed deals)',
      value: formatWinRate(winRate),
      tone: 'text-slate-900',
    },
    {
      label: 'Won value',
      value: formatCurrency(wonValue, currency),
      tone: 'text-green-600',
    },
    {
      label: 'Lost value',
      value: formatCurrency(lostValue, currency),
      tone: 'text-red-600',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {card.label}
              </p>
              <p className={`mt-1 text-lg font-semibold ${card.tone}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-400">Amounts are summed without currency conversion.</p>
    </div>
  )
}
