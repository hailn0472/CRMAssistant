'use client'

import { formatCurrency } from '@/components/deals/deal-display'
import { formatWinRate } from '@/lib/win-loss-format'

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
    { label: 'Won deals', value: String(wonCount), color: '#1b1b1f' },
    { label: 'Lost deals', value: String(lostCount), color: '#1b1b1f' },
    { label: 'Win rate (closed deals)', value: formatWinRate(winRate), color: '#1b1b1f' },
    { label: 'Won value', value: formatCurrency(wonValue, currency), color: '#22a06b' },
    { label: 'Lost value', value: formatCurrency(lostValue, currency), color: '#b91c1c' },
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-[#ececf0] bg-[#ececf0] sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="flex flex-col gap-1.5 bg-white px-[18px] py-4">
            <span className="text-[11.5px] font-medium text-[#8c8c96]">{card.label}</span>
            <span
              className="text-[21px] font-semibold tracking-[-0.02em]"
              style={{ color: card.color }}
            >
              {card.value}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-[#a0a0aa]">Amounts are summed without currency conversion.</p>
    </div>
  )
}
