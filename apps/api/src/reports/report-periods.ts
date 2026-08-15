/**
 * Story 6.2 (AC 23): pure UTC period resolver.
 *
 * All ranges are inclusive: start is start-of-day (00:00:00.000 UTC), end is
 * end-of-day (23:59:59.999 UTC). No Nest imports — framework-free so the
 * resolver is unit-testable in isolation and reusable by report-config.ts.
 */
import type { DatePreset } from './report-types'

export const MAX_RANGE_MONTHS = 36

export const MS_PER_DAY = 86_400_000

export interface DayRange {
  start: Date
  end: Date
}

export interface CurrentRangeConfig {
  datePreset: DatePreset
  startDate: string | null
  endDate: string | null
}

export interface ComparisonRangeConfig {
  comparisonMode: 'NONE' | 'PREVIOUS_PERIOD' | 'YEAR_OVER_YEAR' | 'CUSTOM'
  comparisonStartDate: string | null
  comparisonEndDate: string | null
}

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Parse an ISO YYYY-MM-DD day into UTC midnight. Throws Error on malformed input. */
export function parseIsoDay(value: string, label: string): Date {
  if (!ISO_DAY_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: expected ISO YYYY-MM-DD, got "${value}"`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: "${value}" is not a real calendar date`)
  }
  return parsed
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  )
}

/** Inclusive day count between two start-of-day dates. */
export function daysInclusive(start: Date, end: Date): number {
  const s = startOfDay(start)
  const e = endOfDay(end)
  const dayBoundaries =
    (Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) -
      Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())) /
    MS_PER_DAY
  return Math.floor(dayBoundaries) + 1
}

/** Immediately preceding range with equal inclusive day count (AC 23). */
export function previousPeriod(start: Date, end: Date): DayRange {
  const dayCount = daysInclusive(start, end)
  const compEnd = endOfDay(new Date(startOfDay(start).getTime() - 1))
  const compStart = new Date(compEnd.getTime() - (dayCount - 1) * MS_PER_DAY)
  return { start: startOfDay(compStart), end: compEnd }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Shift one UTC year back with leap-day clamping (Feb 29 → Feb 28). */
function shiftYearBackClamped(date: Date): Date {
  const year = date.getUTCFullYear() - 1
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const clampedDay = month === 1 && day === 29 && !isLeapYear(year) ? 28 : day
  return new Date(
    Date.UTC(
      year,
      month,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
}

/** Same inclusive range one UTC year earlier, leap-day clamped (AC 23). */
export function yearOverYear(start: Date, end: Date): DayRange {
  return {
    start: shiftYearBackClamped(startOfDay(start)),
    end: endOfDay(shiftYearBackClamped(end)),
  }
}

/** Maximum 36-month guard (AC 23). */
export function assertMaxRangeMonths(start: Date, end: Date): void {
  const monthsDiff =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  if (monthsDiff > MAX_RANGE_MONTHS) {
    throw new Error(`Report range must not exceed ${MAX_RANGE_MONTHS} months`)
  }
}

function monthRange(year: number, month: number): DayRange {
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  }
}

function quarterRange(year: number, quarter: number): DayRange {
  return {
    start: new Date(Date.UTC(year, quarter * 3, 1)),
    end: new Date(Date.UTC(year, quarter * 3 + 3, 0, 23, 59, 59, 999)),
  }
}

function yearRange(year: number): DayRange {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  }
}

/** Resolve the current period range from preset + explicit dates (AC 23). */
export function resolveCurrentRange(config: CurrentRangeConfig, now: Date): DayRange {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const quarter = Math.floor(month / 3)

  switch (config.datePreset) {
    case 'THIS_MONTH':
      return monthRange(year, month)
    case 'THIS_QUARTER':
      return quarterRange(year, quarter)
    case 'THIS_YEAR':
      return yearRange(year)
    case 'CUSTOM': {
      if (config.startDate === null || config.endDate === null) {
        throw new Error('CUSTOM date preset requires both startDate and endDate')
      }
      const start = parseIsoDay(config.startDate, 'startDate')
      const end = parseIsoDay(config.endDate, 'endDate')
      if (end < start) {
        throw new Error('endDate must be >= startDate')
      }
      assertMaxRangeMonths(start, end)
      return { start, end: endOfDay(end) }
    }
  }
}

/** Resolve the optional comparison range (AC 23-24). */
export function resolveComparisonRange(
  config: ComparisonRangeConfig,
  current: DayRange,
): DayRange | null {
  switch (config.comparisonMode) {
    case 'NONE':
      return null
    case 'PREVIOUS_PERIOD':
      return previousPeriod(current.start, current.end)
    case 'YEAR_OVER_YEAR':
      return yearOverYear(current.start, current.end)
    case 'CUSTOM': {
      if (config.comparisonStartDate === null || config.comparisonEndDate === null) {
        throw new Error(
          'CUSTOM comparison mode requires both comparisonStartDate and comparisonEndDate',
        )
      }
      const start = parseIsoDay(config.comparisonStartDate, 'comparisonStartDate')
      const end = parseIsoDay(config.comparisonEndDate, 'comparisonEndDate')
      if (end < start) {
        throw new Error('comparisonEndDate must be >= comparisonStartDate')
      }
      const comparison = { start, end: endOfDay(end) }
      if (
        daysInclusive(current.start, current.end) !==
        daysInclusive(comparison.start, comparison.end)
      ) {
        throw new Error('CUSTOM comparison range must have the same day count as the current range')
      }
      return comparison
    }
  }
}

// ─── AC 53: time-bucket drill → comparison-period mapping ───────────────────

/** Time-grouping dimensions whose buckets can be mapped by index. */
export type TimeGroupBy = 'MONTH' | 'QUARTER' | 'YEAR'

function timeBucketStep(groupBy: TimeGroupBy): number {
  if (groupBy === 'MONTH') return 1
  if (groupBy === 'QUARTER') return 3
  return 12
}

/** UTC bucket start of the period containing the given instant. */
function startOfTimeBucket(date: Date, groupBy: TimeGroupBy): Date {
  const year = date.getUTCFullYear()
  if (groupBy === 'MONTH') return new Date(Date.UTC(year, date.getUTCMonth(), 1))
  if (groupBy === 'QUARTER')
    return new Date(Date.UTC(year, Math.floor(date.getUTCMonth() / 3) * 3, 1))
  return new Date(Date.UTC(year, 0, 1))
}

/** Shift a bucket start by `count` whole buckets (Date.UTC normalizes overflow). */
function shiftTimeBuckets(start: Date, count: number, groupBy: TimeGroupBy): Date {
  const step = timeBucketStep(groupBy)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + count * step, 1))
}

/**
 * Map a time bucket from the current range to the equivalent bucket in the
 * comparison range by bucket INDEX (AC 53: the drill re-runs the same closed
 * predicate against the comparison period). The current bucket is the Nth
 * bucket from the current range start; the comparison bucket is the Nth
 * bucket from the comparison range start.
 *
 * Returns null when there is no equivalent bucket — the bucket lies before
 * the current range, or the index is beyond the comparison range (e.g. a
 * CUSTOM comparison whose range aligns differently and contains fewer
 * buckets). Callers MUST treat null as an EMPTY result and never fall back
 * to the current period's rows.
 */
export function mapTimeBucketToComparison(
  currentBucketStart: Date,
  groupBy: TimeGroupBy,
  currentRange: DayRange,
  comparisonRange: DayRange,
): DayRange | null {
  const step = timeBucketStep(groupBy)
  const currentStart = startOfTimeBucket(currentRange.start, groupBy)
  const bucketStart = startOfTimeBucket(currentBucketStart, groupBy)
  const monthsFromStart =
    (bucketStart.getUTCFullYear() - currentStart.getUTCFullYear()) * 12 +
    (bucketStart.getUTCMonth() - currentStart.getUTCMonth())
  const index = monthsFromStart / step
  if (!Number.isInteger(index) || index < 0) return null

  const comparisonStart = startOfTimeBucket(comparisonRange.start, groupBy)
  const mappedStart = shiftTimeBuckets(comparisonStart, index, groupBy)
  if (mappedStart > comparisonRange.end) return null

  const mappedEnd = new Date(shiftTimeBuckets(mappedStart, 1, groupBy).getTime() - 1)
  return { start: mappedStart, end: mappedEnd }
}
