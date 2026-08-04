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

/** 30 days before today (UTC, start of day) — the "Last 30 days" quick range. */
export function startOfLast30DaysUtc(now: Date = new Date()): Date {
  const today = todayUtc(now)
  return new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
}

/** First day of the current UTC year — the "This year" quick range. */
export function startOfCurrentYearUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
}

type WinLossCsvReasonBucket = { reason: string; count: number; totalValue: number }
type WinLossCsvCompetitor = {
  competitorName: string
  wonCount: number
  lostCount: number
  winRate: number
  totalValue: number
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Renders the win/loss analysis (summary, reasons, competitors) as a CSV
 * string for the "Export CSV" download — pure so it stays unit-testable
 * without touching the DOM/Blob APIs.
 */
export function winLossAnalysisToCsv(analysis: {
  wonCount: number
  lostCount: number
  winRate: number
  wonValue: number
  lostValue: number
  winReasons: WinLossCsvReasonBucket[]
  lossReasons: WinLossCsvReasonBucket[]
  competitors: WinLossCsvCompetitor[]
}): string {
  const summary = [
    ['Won deals', String(analysis.wonCount)],
    ['Lost deals', String(analysis.lostCount)],
    ['Win rate', formatWinRate(analysis.winRate)],
    ['Won value', String(analysis.wonValue)],
    ['Lost value', String(analysis.lostValue)],
  ]

  const reasonHeader = ['Reason', 'Outcome', 'Count', 'Total value']
  const reasonRows = [
    ...analysis.winReasons.map((r) => [
      formatReasonLabel(r.reason),
      'Won',
      String(r.count),
      String(r.totalValue),
    ]),
    ...analysis.lossReasons.map((r) => [
      formatReasonLabel(r.reason),
      'Lost',
      String(r.count),
      String(r.totalValue),
    ]),
  ]

  const competitorHeader = ['Competitor', 'Won', 'Lost', 'Win rate', 'Total value']
  const competitorRows = analysis.competitors.map((c) => [
    c.competitorName,
    String(c.wonCount),
    String(c.lostCount),
    formatWinRate(c.winRate),
    String(c.totalValue),
  ])

  return [...summary, [], reasonHeader, ...reasonRows, [], competitorHeader, ...competitorRows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\n')
}
