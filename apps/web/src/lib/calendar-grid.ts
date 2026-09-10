/**
 * Pure calendar-grid date maths (Story 4.4, AC 28). React-free by design so
 * every branch is unit-testable without jsdom — this module carries a large
 * share of the web coverage load.
 *
 * 🚨 ALL day maths runs on UTC-midnight instants via `toUtcMidnight` from
 * `@/lib/task-format` — `Task.dueDate` is stored at UTC midnight
 * (`tasks.service.ts:166`) and the API's date filters are day-granular, so
 * the grid, the badges and the API must agree on where a day starts. Using
 * local-time `getDate()` here would put a UTC-midnight dueDate in the wrong
 * cell for anyone west of UTC (finding 3.7-F4).
 *
 * No date library. Native `Date` only — `setUTCDate(getUTCDate() + n)`
 * rolls months and years correctly.
 */

import { toUtcMidnight } from '@/lib/task-format'

export type CalendarMode = 'month' | 'week' | 'day'

export type CalendarCell = {
  /** UTC-midnight instant of the cell's day. */
  date: Date
  /** True when the cell belongs to the anchor's month (month grid only). */
  isCurrentMonth: boolean
  /** True when the cell is the caller's "today". */
  isToday: boolean
}

/** The UTC calendar day key (`yyyy-mm-dd`) of any instant — the bucketing key shared by grid, badges and API filters. */
export function utcDayKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getUTCFullYear()
  const month = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** Weekday of the anchor's UTC day, shifted so `weekStartsOn` is 0 (Sunday). */
function weekOffset(date: Date, weekStartsOn: 0 | 1): number {
  return (date.getUTCDay() - weekStartsOn + 7) % 7
}

function toCell(date: Date, todayKey: string, isCurrentMonth: boolean): CalendarCell {
  return {
    date,
    isCurrentMonth,
    isToday: utcDayKey(date) === todayKey,
  }
}

/**
 * 6 rows × 7 columns = 42 cells, always. The grid always starts on the
 * week-start day on or before the 1st of the anchor's month, so the layout
 * never jumps between months. `now` is injectable for deterministic `isToday`
 * assertions; it defaults to the current instant.
 */
export function buildMonthGrid(
  anchor: Date,
  weekStartsOn: 0 | 1 = 0,
  now: Date = new Date(),
): CalendarCell[] {
  const anchorDay = toUtcMidnight(anchor)
  const firstOfMonth = new Date(Date.UTC(anchorDay.getUTCFullYear(), anchorDay.getUTCMonth(), 1))
  const gridStart = addDays(firstOfMonth, -weekOffset(firstOfMonth, weekStartsOn))
  const todayKey = utcDayKey(now)
  const anchorMonth = anchorDay.getUTCMonth()

  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i)
    return toCell(date, todayKey, date.getUTCMonth() === anchorMonth)
  })
}

/** 7 cells, from the week-start day on or before the anchor's day. */
export function buildWeekGrid(
  anchor: Date,
  weekStartsOn: 0 | 1 = 0,
  now: Date = new Date(),
): CalendarCell[] {
  const anchorDay = toUtcMidnight(anchor)
  const gridStart = addDays(anchorDay, -weekOffset(anchorDay, weekStartsOn))
  const todayKey = utcDayKey(now)
  const anchorMonth = anchorDay.getUTCMonth()

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(gridStart, i)
    return toCell(date, todayKey, date.getUTCMonth() === anchorMonth)
  })
}

/** 1 cell — the anchor's UTC day. */
export function buildDayGrid(anchor: Date, now: Date = new Date()): CalendarCell[] {
  const date = toUtcMidnight(anchor)
  return [toCell(date, utcDayKey(now), true)]
}

export type CalendarRange = {
  /** First day of the window, UTC midnight (inclusive). */
  from: Date
  /** Last day of the window, UTC midnight (inclusive). */
  to: Date
}

/**
 * The exact window handed to the queries (AC 29):
 * - month: the first cell of the 42-cell grid → the last cell;
 * - week: Sunday of the anchor's week → Saturday;
 * - day: the anchor's UTC day.
 * Both ends are UTC midnights of inclusive days; callers convert to
 * `yyyy-mm-dd` with `utcDayKey` for `dueDateFrom/dueDateTo` /
 * `createdFrom/createdTo` (the API's date args are day-granular).
 */
export function rangeFor(mode: CalendarMode, anchor: Date): CalendarRange {
  const anchorDay = toUtcMidnight(anchor)
  switch (mode) {
    case 'day':
      return { from: anchorDay, to: anchorDay }
    case 'week': {
      const start = addDays(anchorDay, -weekOffset(anchorDay, 0))
      return { from: start, to: addDays(start, 6) }
    }
    case 'month': {
      const firstOfMonth = new Date(
        Date.UTC(anchorDay.getUTCFullYear(), anchorDay.getUTCMonth(), 1),
      )
      const start = addDays(firstOfMonth, -weekOffset(firstOfMonth, 0))
      return { from: start, to: addDays(start, 41) }
    }
  }
}

/**
 * Buckets items by their UTC calendar day — tasks on `dueDate`, activities on
 * `createdAt`. The returned Map preserves insertion order and the keys are
 * `utcDayKey` strings, so a cell can look up its chips in O(1).
 */
export function groupByDay<T>(items: T[], dateOf: (item: T) => Date | string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = utcDayKey(dateOf(item))
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  return groups
}
