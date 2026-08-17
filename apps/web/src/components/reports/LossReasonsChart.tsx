'use client'

import { formatReasonLabel } from '@/lib/win-loss-format'
import type { WinLossReasonBucket } from '@/services/win-loss.service'

interface LossReasonsChartProps {
  winReasons: WinLossReasonBucket[]
  lossReasons: WinLossReasonBucket[]
  currency: string
}

/**
 * Per-reason won/lost breakdown for closed deals. Each row shows the reason,
 * its deal count as text (never colour alone), and a horizontal bar split by
 * won (green) vs lost (red). Preserves established won/lost styling classes.
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

  const rows = Array.from(reasons.entries()).map(([reason, counts]) => ({
    reason,
    label: formatReasonLabel(reason),
    wonCount: counts.wonCount,
    lostCount: counts.lostCount,
  }))

  const max = Math.max(1, ...rows.map((r) => r.wonCount + r.lostCount))

  return (
    <section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Win/Loss Reasons</h2>
          <span className="text-[12.5px] text-[#8c8c96]">
            Reason recorded at close · {rows.reduce((sum, r) => sum + r.wonCount + r.lostCount, 0)}{' '}
            closed deals
          </span>
        </div>
        <div className="flex items-center gap-3.5 text-[12px] text-[#6b6b76]">
          <span className="flex items-center gap-1.5">
            <span className="block h-[9px] w-[9px] rounded-[3px] bg-[#22a06b]" />
            Won
          </span>
          <span className="flex items-center gap-1.5">
            <span className="block h-[9px] w-[9px] rounded-[3px] bg-[#d98a8a]" />
            Lost
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[#8c8c96]">No reasons recorded</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {rows.map((row) => {
            const total = row.wonCount + row.lostCount
            const wonPct = (row.wonCount / max) * 100
            const lostPct = (row.lostCount / max) * 100
            return (
              <div key={row.reason} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-[#1b1b1f]">{row.label}</span>
                  <span className="font-mono text-[12px] text-[#8c8c96]">
                    {total} deals · {row.wonCount}W / {row.lostCount}L
                  </span>
                </div>
                <div className="flex h-[10px] overflow-hidden rounded-[6px] bg-[#f2f2f5]">
                  <span className="block h-full bg-[#22a06b]" style={{ width: `${wonPct}%` }} />
                  <span className="block h-full bg-[#d98a8a]" style={{ width: `${lostPct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-[12px] text-[#a0a0aa]">
        Amounts are summed without currency conversion ({currency}).
      </p>
    </section>
  )
}
