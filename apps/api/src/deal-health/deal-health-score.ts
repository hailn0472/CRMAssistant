/**
 * Pure deal-health scoring module (Story 3.7).
 *
 * This module must stay free of `@nestjs/*` and Prisma imports so it can be
 * unit-tested in isolation and shared by the service and the sweep. All day
 * arithmetic is UTC-midnight based so a score is stable regardless of the
 * server's local time and of the hour a sweep runs.
 *
 * NOTE: getTodayUtcMidnight in apps/api/src/reports/forecast.service.ts:59
 * duplicates the three-line UTC-midnight construction below (it is not
 * exported). Keep the two implementations in sync — hand-duplication with a
 * cross-reference comment is the established convention (docs/project-context.md).
 * Story 4.1's apps/api/src/tasks/task-due-status.ts duplicates toUtcMidnight
 * the same way (also not imported from here — see its header comment).
 */

export const STALE_ACTIVITY_DAYS = 7
export const CRITICAL_ACTIVITY_DAYS = 14
export const CLOSING_SOON_DAYS = 3
export const PROBABILITY_MISMATCH_POINTS = 25
export const AT_RISK_SCORE_THRESHOLD = 70
export const STALE_SCORE_THRESHOLD = 40

export const DEAL_HEALTH_STATUSES = ['HEALTHY', 'AT_RISK', 'STALE'] as const
export type DealHealthStatus = (typeof DEAL_HEALTH_STATUSES)[number]

// Fixed evaluation order — signals are returned in this order regardless of
// how many apply, so snapshots are stable.
export const DEAL_HEALTH_SIGNALS = [
  'NO_ACTIVITY_7D',
  'NO_ACTIVITY_14D',
  'NO_CLOSE_DATE',
  'PAST_CLOSE_DATE',
  'CLOSING_SOON',
  'PROBABILITY_MISMATCH',
] as const
export type DealHealthSignal = (typeof DEAL_HEALTH_SIGNALS)[number]

export type DealHealthInput = {
  stageIsWon: boolean
  stageIsLost: boolean
  stageProbability: number
  dealProbability: number
  expectedCloseDate: Date | null
  lastActivityAt: Date
}

export type DealHealthResult = {
  status: DealHealthStatus
  score: number
  signals: DealHealthSignal[]
}

/** Normalize any instant to the UTC midnight of its UTC calendar day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Whole UTC days from `from` to `to` (midnight-to-midnight, integer). */
export function daysBetweenUtc(from: Date, to: Date): number {
  const fromMidnight = toUtcMidnight(from).getTime()
  const toMidnight = toUtcMidnight(to).getTime()
  return Math.round((toMidnight - fromMidnight) / 86_400_000)
}

/**
 * Score one open deal's health.
 *
 * Returns `null` when the deal is closed (stage flags only — never
 * winLossReason or actualCloseDate, which survive a reopen). Scoring starts at
 * 100 and applies every matching deduction; the final score is clamped to
 * 0..100. Signals are populated in the fixed DEAL_HEALTH_SIGNALS order, and a
 * non-HEALTHY result always carries at least one signal (a status without a
 * reason violates the UX rule that a critical status must explain itself).
 */
export function scoreDealHealth(input: DealHealthInput, now: Date): DealHealthResult | null {
  if (input.stageIsWon || input.stageIsLost) {
    return null
  }

  const signals: DealHealthSignal[] = []
  let score = 100

  const daysSinceLastActivity = daysBetweenUtc(input.lastActivityAt, now)
  if (daysSinceLastActivity >= CRITICAL_ACTIVITY_DAYS) {
    score -= 40
    signals.push('NO_ACTIVITY_14D')
  } else if (daysSinceLastActivity >= STALE_ACTIVITY_DAYS) {
    score -= 20
    signals.push('NO_ACTIVITY_7D')
  }

  if (input.expectedCloseDate === null) {
    score -= 10
    signals.push('NO_CLOSE_DATE')
  } else {
    const daysUntilClose = daysBetweenUtc(now, input.expectedCloseDate)
    if (daysUntilClose < 0) {
      score -= 40
      signals.push('PAST_CLOSE_DATE')
    } else if (daysUntilClose <= CLOSING_SOON_DAYS) {
      score -= 15
      signals.push('CLOSING_SOON')
    }
  }

  if (Math.abs(input.dealProbability - input.stageProbability) >= PROBABILITY_MISMATCH_POINTS) {
    score -= 20
    signals.push('PROBABILITY_MISMATCH')
  }

  const clampedScore = Math.max(0, Math.min(100, score))

  let status: DealHealthStatus
  if (clampedScore >= AT_RISK_SCORE_THRESHOLD) {
    status = 'HEALTHY'
  } else if (clampedScore >= STALE_SCORE_THRESHOLD) {
    status = 'AT_RISK'
  } else {
    status = 'STALE'
  }

  return { status, score: clampedScore, signals }
}
