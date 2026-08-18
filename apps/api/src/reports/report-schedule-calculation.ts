/**
 * Story 6.5 (Contract B8, B10): deterministic next-run calculation.
 * Pure module — no Nest or Prisma imports. All timestamps are UTC instants;
 * local wall-clock/timezone semantics are applied through the Intl runtime
 * (the same tz database the rest of the platform uses).
 *
 * Semantics:
 * - `calculateNextRun(cadence, after)` returns the first instant strictly
 *   after `after` (never the same UTC instant twice).
 * - Month-end clamp: day 29-31 → last local day of short months.
 * - DST gap: the nonexistent wall-clock occurrence is skipped (first valid
 *   future occurrence), matching cron-parser's own behavior for CUSTOM_CRON.
 * - DST overlap: the earlier (first) occurrence wins — no duplicate wall-clock
 *   semantics, no repeated UTC instants.
 */

import { CronExpressionParser } from 'cron-parser'

import type { ReportScheduleFrequency } from './report-schedule-types'

export type ScheduleCadence = {
  frequency: ReportScheduleFrequency
  timezone: string
  scheduledTime: string
  dayOfWeek?: number
  dayOfMonth?: number
  startMonth?: number
  cronExpression?: string
}

/** One initial attempt plus three retries (Contract E25). */
export const MAX_ATTEMPTS = 4
const RETRY_BASE_MS = 60_000

/** Exponential retry delay from a one-minute base: 1, 2, 4 minutes. */
export function retryDelayMsForAttempt(attemptNumber: number): number {
  return RETRY_BASE_MS * 2 ** (attemptNumber - 1)
}

/** Safety bound for the calendar iteration (covers quarterly + DST edges). */
const MAX_CALCULATION_ITERATIONS = 400

const SCHEDULED_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Validates a five-field cron expression (Contract B7): no seconds field,
 * syntactically valid, cadence no more frequent than hourly. Re-exported from
 * report-schedule-types so cadence callers have one import surface.
 */
export { validateCronExpressionShape as validateCronExpression } from './report-schedule-types'

// ─── Local wall-clock helpers (Intl-backed) ──────────────────────────────────

export type LocalFields = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function formatInZone(utc: Date, timezone: string): LocalFields {
  let dtf = dtfCache.get(timezone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    dtfCache.set(timezone, dtf)
  }
  const parts = dtf.formatToParts(utc)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  }
}

export type LocalToUtcResult = { utc: Date } | { gap: true }

/**
 * Maps a local wall-clock (calendar date + HH:mm) in an IANA zone to a UTC
 * instant. Corrects for the zone offset iteratively; when the wall-clock
 * falls inside a DST gap the correction oscillates and the result is a `gap`
 * (the caller skips the occurrence, like cron-parser does). Overlaps resolve
 * to the first (earlier) instant.
 */
export function localWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): LocalToUtcResult {
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  let prevDelta = 0
  for (let i = 0; i < 4; i++) {
    const local = formatInZone(new Date(guess), timezone)
    if (
      local.year === year &&
      local.month === month &&
      local.day === day &&
      local.hour === hour &&
      local.minute === minute
    ) {
      return { utc: new Date(guess) }
    }
    const localNaive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
    // Correction = naive(desired wall-clock) - naive(current local wall-clock),
    // applied to the UTC guess. Converges in 1-2 iterations; oscillates on a
    // DST gap (the wall-clock does not exist in this zone on this date).
    const desiredNaive = Date.UTC(year, month - 1, day, hour, minute)
    const delta = desiredNaive - localNaive
    if (delta === 0) break
    if (i > 0 && delta === -prevDelta) return { gap: true }
    prevDelta = delta
    guess += delta
  }
  return { gap: true }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function clampedDay(year: number, month: number, dayOfMonth: number): number {
  return Math.min(dayOfMonth, lastDayOfMonth(year, month))
}

function isQuarterMonth(month: number, startMonth: number): boolean {
  return (month - startMonth + 12) % 3 === 0
}

function candidateDateMatches(
  cadence: ScheduleCadence,
  year: number,
  month: number,
  day: number,
): boolean {
  switch (cadence.frequency) {
    case 'DAILY':
      return true
    case 'WEEKLY': {
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      return dow === cadence.dayOfWeek
    }
    case 'MONTHLY':
      return day === clampedDay(year, month, cadence.dayOfMonth ?? 1)
    case 'QUARTERLY':
      return (
        isQuarterMonth(month, cadence.startMonth ?? 1) &&
        day === clampedDay(year, month, cadence.dayOfMonth ?? 1)
      )
    case 'CUSTOM_CRON':
      // Handled separately in calculateNextRun.
      return false
  }
}

function nextCalendarDay(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

/**
 * Returns the first instant strictly after `after` at which the cadence fires,
 * as a UTC Date. For CUSTOM_CRON the occurrence is computed by cron-parser in
 * the schedule's timezone; for the calendar frequencies the local wall-clock
 * is preserved (with month-end clamp and DST-gap skipping).
 */
export function calculateNextRun(cadence: ScheduleCadence, after: Date): Date {
  if (cadence.frequency === 'CUSTOM_CRON') {
    const expression = cadence.cronExpression ?? ''
    const expr = CronExpressionParser.parse(expression, {
      currentDate: after,
      tz: cadence.timezone,
    })
    return expr.next().toDate()
  }

  const match = SCHEDULED_TIME_PATTERN.exec(cadence.scheduledTime)
  const hour = match ? Number(match[1]) : 9
  const minute = match ? Number(match[2]) : 0

  const startLocal = formatInZone(after, cadence.timezone)
  let cursor = { year: startLocal.year, month: startLocal.month, day: startLocal.day }

  for (let i = 0; i < MAX_CALCULATION_ITERATIONS; i++) {
    if (candidateDateMatches(cadence, cursor.year, cursor.month, cursor.day)) {
      const result = localWallClockToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        hour,
        minute,
        cadence.timezone,
      )
      if ('utc' in result && result.utc.getTime() > after.getTime()) {
        return result.utc
      }
    }
    cursor = nextCalendarDay(cursor.year, cursor.month, cursor.day)
  }
  throw new Error('calculateNextRun: no future occurrence found for schedule cadence')
}
