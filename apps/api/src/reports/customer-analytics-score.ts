/**
 * Pure customer-analytics scoring module (Story 6.7, Contract B7–B15).
 *
 * This module must stay free of `@nestjs/*` and Prisma imports so it can be
 * unit-tested in isolation (test-plan §5 F1–F28). All day arithmetic is
 * UTC-midnight based so a score is stable regardless of the server's local
 * time and of the hour the daily processor runs.
 *
 * NOTE: toUtcMidnight/daysBetweenUtc duplicate the implementations in
 * apps/api/src/deal-health/deal-health-score.ts and
 * apps/api/src/tasks/task-due-status.ts (not exported from either). Keep the
 * three implementations in sync — hand-duplication with a cross-reference
 * comment is the established convention (docs/project-context.md).
 */

export const CUSTOMER_CHURN_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type CustomerChurnRisk = (typeof CUSTOMER_CHURN_RISKS)[number]

export function isCustomerChurnRisk(value: string): value is CustomerChurnRisk {
  return (CUSTOMER_CHURN_RISKS as readonly string[]).includes(value)
}

// Closed server constants (Contract B7) — no client-tunable weights.
export const CHURN_WEIGHTS = {
  inactivity: 0.4,
  winRate: 0.3,
  engagement: 0.3,
} as const

export const ENGAGEMENT_WINDOW_DAYS = 90
export const ENGAGEMENT_POINTS_PER_ACTIVITY = 10
export const INACTIVITY_HORIZON_DAYS = 90

// Customer-touch engagement activity types (Contract B11). Internal/system
// types (NOTE_ADDED, TASK_COMPLETED, DEAL_STAGE_CHANGED, CRUD events…) never
// count as engagement.
export const QUALIFYING_ACTIVITY_TYPES = [
  'EMAIL_SENT',
  'CALL_MADE',
  'MEETING_SCHEDULED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
] as const
export type QualifyingActivityType = (typeof QUALIFYING_ACTIVITY_TYPES)[number]

export const RECOMMENDED_ACTIONS = [
  { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
  { code: 'UPSELL_OPPORTUNITY', label: 'Upsell opportunity' },
  { code: 'MONITOR', label: 'Monitor' },
] as const
export type RecommendedActionCode = (typeof RECOMMENDED_ACTIONS)[number]['code']
export type RecommendedAction = { code: RecommendedActionCode; label: string }

const MS_PER_DAY = 86_400_000

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Round money at every materialized write — repo rule, never only for display. */
function round2(value: number): number {
  // Inputs are validated (assertFiniteMoney) or clamped before reaching here,
  // so the EPSILON-guarded round is always finite.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Round the weighted score to 1 decimal (Contract B12). */
function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

/** Normalize any instant to the UTC midnight of its UTC calendar day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Whole UTC days from `from` to `to` (midnight-to-midnight, integer). */
export function daysBetweenUtc(from: Date, to: Date): number {
  const fromMidnight = toUtcMidnight(from).getTime()
  const toMidnight = toUtcMidnight(to).getTime()
  return Math.round((toMidnight - fromMidnight) / MS_PER_DAY)
}

/** Money safety (B15, F24): non-finite deal values are rejected, not summed. */
export function assertFiniteMoney(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Non-finite deal value: ${value}`)
  }
}

/**
 * LTV (AC 4 / B9): round2 sum of active won deal values. Zero won deals → 0.
 * Eligibility (active deal + active DealStage.isWon) is decided by the caller;
 * this pure function only sums already-eligible values and validates them.
 */
export function calculateLifetimeValue(wonDealValues: number[]): number {
  for (const value of wonDealValues) {
    assertFiniteMoney(value)
  }
  return round2(wonDealValues.reduce((sum, value) => sum + value, 0))
}

export type CurrencyBreakdown = {
  entries: Array<{ currency: string; value: number }>
  mixedCurrencies: boolean
}

/**
 * Money safety (B15 / F25): group raw won values by ISO currency, round each
 * group at write time. A single currency never sets mixedCurrencies; more
 * than one means the API/UI must NOT label the total with one symbol and must
 * not perform FX conversion.
 */
export function buildCurrencyBreakdown(
  wonDeals: Array<{ value: number; currency: string }>,
): CurrencyBreakdown {
  const byCurrency = new Map<string, number>()
  for (const deal of wonDeals) {
    assertFiniteMoney(deal.value)
    byCurrency.set(deal.currency, (byCurrency.get(deal.currency) ?? 0) + deal.value)
  }
  const entries = [...byCurrency.entries()]
    .map(([currency, value]) => ({ currency, value: round2(value) }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
  return { entries, mixedCurrencies: entries.length > 1 }
}

/**
 * Inactivity risk (B8): days since the reference instant (last customer
 * activity, falling back to Contact.createdAt when there is no activity),
 * normalized to UTC midnight and clamped against future clock skew.
 * risk = clamp(daysSinceReference / 90 * 100, 0, 100).
 */
export function calculateInactivityRisk(
  lastActivityDate: Date | null,
  contactCreatedAt: Date,
  snapshotDate: Date,
): number {
  const reference = lastActivityDate ?? contactCreatedAt
  const days = Math.max(daysBetweenUtc(reference, snapshotDate), 0)
  const risk = (days / INACTIVITY_HORIZON_DAYS) * 100
  return clamp(risk, 0, 100)
}

/**
 * Win rate (B10): won / (won + lost) * 100 over ACTIVE closed deals. No
 * closed deals → neutral 50 so missing history never auto-assigns max risk.
 */
export function calculateDealWinRate(wonCount: number, lostCount: number): number {
  const closed = wonCount + lostCount
  if (closed <= 0) return 50
  return clamp((wonCount / closed) * 100, 0, 100)
}

export function calculateWinRateRisk(winRate: number): number {
  return clamp(100 - winRate, 0, 100)
}

/**
 * Engagement score (B11): qualifying customer-touch activities within the
 * rolling 90 UTC-day window, 10 points each, clamped 0..100.
 */
export function calculateEngagementScore(qualifyingActivityCount: number): number {
  return clamp(qualifyingActivityCount * ENGAGEMENT_POINTS_PER_ACTIVITY, 0, 100)
}

export function calculateEngagementRisk(engagementScore: number): number {
  return clamp(100 - engagementScore, 0, 100)
}

/** Whether an activity falls inside the qualifying window for a snapshot day. */
export function isQualifyingActivity(type: string, createdAt: Date, snapshotDate: Date): boolean {
  if (!(QUALIFYING_ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return false
  }
  const snapshotMidnight = toUtcMidnight(snapshotDate).getTime()
  const windowStart = snapshotMidnight - ENGAGEMENT_WINDOW_DAYS * MS_PER_DAY
  const windowEndExclusive = snapshotMidnight + MS_PER_DAY // end-of-snapshot-day inclusive
  const ts = createdAt.getTime()
  return ts >= windowStart && ts < windowEndExclusive
}

/**
 * Weighted churn score (B12): round1(0.40·inactivity + 0.30·winRateRisk +
 * 0.30·engagementRisk), clamped 0..100.
 */
export function calculateChurnRiskScore(input: {
  inactivityRisk: number
  winRateRisk: number
  engagementRisk: number
}): number {
  const weighted =
    CHURN_WEIGHTS.inactivity * input.inactivityRisk +
    CHURN_WEIGHTS.winRate * input.winRateRisk +
    CHURN_WEIGHTS.engagement * input.engagementRisk
  return clamp(round1(weighted), 0, 100)
}

/**
 * Category mapping keeps the epic's exact boundaries (AC 6 / B12):
 * LOW < 30, MEDIUM 30..70 inclusive, HIGH > 70. Exactly 30 and 70 are MEDIUM.
 */
export function categorizeChurnRisk(score: number): CustomerChurnRisk {
  if (score < 30) return 'LOW'
  if (score <= 70) return 'MEDIUM'
  return 'HIGH'
}

/**
 * Percentile 75 of the positive-LTV values of the tenant's active contacts
 * (B14). Deterministic Tukey-hinges rule: median of the upper half (median
 * included for odd counts). Null when the tenant has no positive LTV so no
 * contact is ever labelled high-LTV.
 */
export function percentile75(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return null
  if (n === 1) return sorted[0]
  const mid = Math.floor(n / 2)
  const upper = sorted.slice(mid)
  const upperLen = upper.length
  if (upperLen % 2 === 1) return upper[Math.floor(upperLen / 2)]
  return (upper[upperLen / 2 - 1] + upper[upperLen / 2]) / 2
}

export function isHighLifetimeValue(
  lifetimeValue: number,
  highLtvThreshold: number | null,
): boolean {
  return highLtvThreshold !== null && lifetimeValue > 0 && lifetimeValue >= highLtvThreshold
}

/**
 * B14/D32 bounded p75: the 0-based ascending order-statistic indices needed to
 * reproduce the exact Tukey-hinges p75 WITHOUT materializing the full sorted
 * set. At most two indices; [] for an empty set. Parity with percentile75 is
 * locked by tests for n=0..1000.
 *
 *  - n === 0 → [] (no positive LTV → null threshold)
 *  - n === 1 → [0] (single value IS the threshold)
 *  - upper half length odd → its middle element (1 index)
 *  - upper half length even → its two middle elements (2 indices, averaged)
 */
export function p75OrderStatisticIndices(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0]
  const mid = Math.floor(n / 2)
  const upperLen = n - mid // median included for odd counts (Tukey hinges)
  const upperMid = Math.floor(upperLen / 2)
  if (upperLen % 2 === 1) return [mid + upperMid]
  return [mid + upperMid - 1, mid + upperMid]
}

/**
 * Value of the Tukey-hinges p75 from ONLY the order statistics returned by
 * p75OrderStatisticIndices (ascending values): 1 value → itself (odd upper
 * half), 2 values → their average (even upper half), 0 → null.
 */
export function percentile75FromOrderStatistics(values: number[]): number | null {
  if (values.length === 0) return null
  if (values.length === 1) return values[0]
  return (values[0] + values[1]) / 2
}

/**
 * Recommended action (B13): HIGH always schedules a follow-up; LOW + high-LTV
 * group is an upsell opportunity; everything else (including contacts whose
 * analytics are not calculated yet — null risk) is monitored. Server-derived
 * only — never persisted as free text.
 */
export function recommendedActionFor(
  risk: CustomerChurnRisk | null,
  lifetimeValue: number,
  highLtvThreshold: number | null,
): RecommendedAction {
  if (risk === 'HIGH') {
    return RECOMMENDED_ACTIONS[0] // SCHEDULE_FOLLOW_UP / Schedule follow-up
  }
  if (risk === 'LOW' && isHighLifetimeValue(lifetimeValue, highLtvThreshold)) {
    return RECOMMENDED_ACTIONS[1] // UPSELL_OPPORTUNITY / Upsell opportunity
  }
  return RECOMMENDED_ACTIONS[2] // MONITOR / Monitor
}
