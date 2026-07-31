/**
 * Win/loss reason catalog for closed deals (AC #6).
 *
 * Plain TS const tuple — deliberately NOT a Prisma enum. The `Deal.winLossReason`
 * column stays `String?` and values are validated in the service layer.
 */
export const WIN_LOSS_REASONS = [
  'PRICE',
  'FEATURES',
  'TIMING',
  'COMPETITOR',
  'BUDGET',
  'OTHER',
] as const

export type WinLossReason = (typeof WIN_LOSS_REASONS)[number]

export function isWinLossReason(value: string): value is WinLossReason {
  return (WIN_LOSS_REASONS as readonly string[]).includes(value)
}
