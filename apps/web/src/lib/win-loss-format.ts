/**
 * Pure formatting helpers for the win/loss report.
 * Kept free of recharts/React so the numbers are unit-testable without
 * rendering charts (same tactic as lib/forecast-format.ts).
 */

export const WIN_LOSS_REASON_LABELS: Record<string, string> = {
  PRICE: 'Price',
  FEATURES: 'Features',
  TIMING: 'Timing',
  COMPETITOR: 'Competitor',
  BUDGET: 'Budget',
  OTHER: 'Other',
}

/**
 * Human-readable label for a win/loss reason value.
 */
export function formatReasonLabel(reason: string): string {
  return WIN_LOSS_REASON_LABELS[reason] ?? reason
}

/**
 * Win rate with exactly one decimal place: 62.5 → "62.5%", 0 → "0.0%".
 */
export function formatWinRate(rate: number): string {
  return `${rate.toFixed(1)}%`
}

/**
 * A percentage value with one decimal place: 50 → "50.0%".
 */
export function formatPercent(percentage: number): string {
  return `${percentage.toFixed(1)}%`
}

/**
 * Y-axis tick for the reason chart: 25 → "25%".
 */
export function formatPercentTick(value: number): string {
  return `${Math.round(value)}%`
}

/**
 * ISO date (YYYY-MM-DD) for a Date, in UTC — used by the date inputs.
 */
export function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * First day of the current UTC quarter as a Date (start of day).
 */
export function startOfCurrentQuarterUtc(now: Date = new Date()): Date {
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1))
}

/**
 * Today (UTC, start of day) as a Date.
 */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
