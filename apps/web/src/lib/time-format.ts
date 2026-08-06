/**
 * Pure time formatting + chart palette module (Story 4.5, AC 31).
 * No React, no component imports — the ticking readout, duration labels and
 * chart colors all live here so components stay thin and the coverage gates
 * are met by pure, testable code.
 *
 * This is the FRONTEND TWIN of apps/api/src/reports/productivity-buckets.ts:
 * the api side owns the day/week/month bucket keys, this side owns the
 * display strings and the categorical palette. The two implementations MUST
 * agree on the UTC boundary semantics. There is no shared packages/* — keep
 * both files in sync (docs/project-context.md › "Consequence of the empty
 * packages": hand-duplication with a cross-reference comment).
 */

/**
 * Categorical palette for the time-distribution pie, drawn from the existing
 * house hexes (ForecastChart/LossReasonsChart use the same family). Violet is
 * reserved for AI surfaces and must never appear here (AC 31;
 * ux-design-specification-basic-revision.md:120-135).
 */
export const TIME_CHART_COLORS = [
  '#4f46e5',
  '#22a06b',
  '#c2860a',
  '#0e7490',
  '#b91c1c',
  '#6b6b76',
] as const

/** Reserved for the aggregated `Other` slice of the pie (AC 24/31). */
export const TIME_OTHER_COLOR = '#a0a0aa'

/**
 * The ticking readout: H:MM:SS, clamping negatives to 0:00:00. Hours are
 * unbounded (a 30-hour timer is not a bug), minutes/seconds are zero-padded.
 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/**
 * Compact duration label: `2h 15m` / `45m` / `30s`. Renders the em-dash for
 * 0 / NaN / negative — the same null convention as formatDueDate
 * (task-format.ts:75).
 */
export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.floor(seconds)
  if (total < 60) return `${total}s`
  let hours = Math.floor(total / 3600)
  let minutes = Math.round((total % 3600) / 60)
  // Rounding 59m30s+ would otherwise render "60m" / "2h 60m" — carry into the hour.
  if (minutes === 60) {
    hours += 1
    minutes = 0
  }
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

/**
 * Chart-axis tick formatter: `2h` / `0.5h` — the analogue of formatAxisTick
 * (forecast-format.ts:25). Never renders NaN.
 */
export function formatDurationTick(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0h'
  const hours = seconds / 3600
  return `${Math.round(hours * 10) / 10}h`
}

/**
 * Pure elapsed-seconds computation so the live timer is testable without
 * touching timers (AC 36): floor((nowMs - start) / 1000), clamped at 0.
 */
export function elapsedSeconds(startIso: string, nowMs: number): number {
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((nowMs - start) / 1000))
}
