/**
 * Pure recurrence logic (Story 4.6, AC 26-28).
 *
 * Framework-free — no NestJS, no Prisma imports. All arithmetic is native
 * `Date`, UTC only (getUTCFullYear/getUTCMonth/getUTCDate/Date.UTC). No
 * date library.
 *
 * 🚨 Do NOT use `setMonth` / `setDate` for month rollover. 4.5's verbatim
 * note: "Avoid `setMonth` for grid maths — 31 Jan + 1 month is 3 March."
 * The clamp rule is explicit and must be unit-tested:
 *   - MONTHLY: same day-of-month in the next month, clamped to that month's
 *     last day. 31 Jan → 28 Feb (29 Feb in a leap year). 31 Mar → 30 Apr.
 *   - YEARLY: same month/day next year, clamped. 29 Feb 2028 → 28 Feb 2029.
 *   - DAILY / WEEKLY: setUTCDate(getUTCDate() + 1 | + 7) — safe across month
 *     and year boundaries.
 */

import type { RecurrencePattern } from './task-due-status'
import { toUtcMidnight } from './task-due-status'

/**
 * Returns the number of days in the given month (0-indexed month, 4-digit
 * year). Used for day-clamping when advancing by MONTHLY or YEARLY.
 */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month gives us the last day of the current month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * Advance a UTC-midnight date by one occurrence of the given pattern.
 * Returns a new Date normalised to UTC midnight.
 *
 * AC 27: month rollover is clamped, never overflowed.
 * AC 28: every returned date is toUtcMidnight-normalised.
 */
export function advanceByPattern(from: Date, pattern: RecurrencePattern): Date {
  const d = toUtcMidnight(from)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const date = d.getUTCDate()

  switch (pattern) {
    case 'DAILY':
      return toUtcMidnight(new Date(Date.UTC(year, month, date + 1)))

    case 'WEEKLY':
      return toUtcMidnight(new Date(Date.UTC(year, month, date + 7)))

    case 'MONTHLY': {
      let nextMonth = month + 1
      let nextYear = year
      if (nextMonth > 11) {
        nextMonth = 0
        nextYear++
      }
      const clamped = Math.min(date, daysInMonth(nextYear, nextMonth))
      return toUtcMidnight(new Date(Date.UTC(nextYear, nextMonth, clamped)))
    }

    case 'YEARLY': {
      const nextYear = year + 1
      const clamped = Math.min(date, daysInMonth(nextYear, month))
      return toUtcMidnight(new Date(Date.UTC(nextYear, month, clamped)))
    }
  }
}

/**
 * Compute all due-date occurrences for a recurring task.
 *
 * @param anchor  — the date to advance from (typically the task's dueDate or
 *                  the MAX(dueDate) across existing occurrences)
 * @param pattern — DAILY | WEEKLY | MONTHLY | YEARLY
 * @param endDate — optional end date (inclusive)
 * @param today   — the current date (UTC-midnight normalised)
 * @param max     — hard cap per call (default 30)
 * @returns       — array of Date objects, each normalised to UTC midnight
 *
 * AC 30: stops at recurrenceEndDate (inclusive).
 * AC 30f: max cap is 30 per template per run.
 */
export function computeDueOccurrences(
  anchor: Date,
  pattern: RecurrencePattern,
  endDate: Date | null | undefined,
  today: Date,
  max: number = 30,
): Date[] {
  const results: Date[] = []
  const todayMs = toUtcMidnight(today).getTime()
  const endMs = endDate ? toUtcMidnight(endDate).getTime() : null

  let next = advanceByPattern(anchor, pattern)

  while (results.length < max) {
    const nextMs = next.getTime()

    // Stop after today (AC 30e: generate while next <= today)
    if (nextMs > todayMs) break

    // Stop at endDate (inclusive) (AC 30e)
    if (endMs !== null && nextMs > endMs) break

    results.push(next)
    next = advanceByPattern(next, pattern)
  }

  return results
}
