/**
 * Pure calendar-grid maths (Story 4.4, AC 28/45). Every case the story names
 * is here: Sunday-start and Saturday-start months, leap February, a DST
 * boundary month, a year-change month, `isToday`, `rangeFor` for all three
 * modes, and UTC-midnight bucketing under a negative-UTC-offset TZ.
 */

import {
  buildMonthGrid,
  buildWeekGrid,
  buildDayGrid,
  rangeFor,
  groupByDay,
  utcDayKey,
  type CalendarCell,
} from '@/lib/calendar-grid'
import { toUtcMidnight } from '@/lib/task-format'

// All assertions run on UTC-midnight instants, so the host TZ is irrelevant —
// except the bucketing test, which pins TZ=America/New_York on purpose (T7).
const TZ = process.env.TZ

describe('calendar-grid (Story 4.4, AC 28)', () => {
  afterAll(() => {
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  })

  const cellKeys = (cells: CalendarCell[]): string[] => cells.map((c) => utcDayKey(c.date))
  const key = (date: Date | string): string => utcDayKey(date)

  describe('buildMonthGrid', () => {
    it('always returns exactly 42 cells (6 × 7)', () => {
      for (const anchor of [
        new Date('2026-08-05T00:00:00.000Z'),
        new Date('2024-02-15T00:00:00.000Z'),
        new Date('2025-12-25T00:00:00.000Z'),
        new Date('2026-03-15T00:00:00.000Z'),
      ]) {
        expect(buildMonthGrid(anchor)).toHaveLength(42)
      }
    })

    it('builds a correct grid for a month starting on Sunday (Aug 2026 starts Saturday, Nov 2026 starts Sunday)', () => {
      // 2026-11-01 is a Sunday.
      const grid = buildMonthGrid(new Date('2026-11-15T00:00:00.000Z'))
      expect(grid[0].date.toISOString()).toBe('2026-11-01T00:00:00.000Z')
      expect(grid[41].date.toISOString()).toBe('2026-12-12T00:00:00.000Z')
      expect(grid[0].isCurrentMonth).toBe(true)
    })

    it('builds a correct grid for a month starting on Saturday (Aug 2026)', () => {
      // 2026-08-01 is a Saturday. In a Sunday-start grid the week containing
      // the 1st begins on Sunday 2026-07-26, so the grid pads late July
      // before the month's own days.
      const grid = buildMonthGrid(new Date('2026-08-05T00:00:00.000Z'))
      expect(grid[0].date.toISOString()).toBe('2026-07-26T00:00:00.000Z')
      expect(grid[0].isCurrentMonth).toBe(false)
      expect(grid[6].date.toISOString()).toBe('2026-08-01T00:00:00.000Z')
      // 42 cells end 6 weeks later.
      expect(grid[41].date.toISOString()).toBe('2026-09-05T00:00:00.000Z')
      // Every August day is present; exactly 31 cells belong to the month.
      expect(cellKeys(grid)).toContain('2026-08-31')
      expect(grid.filter((c) => c.isCurrentMonth)).toHaveLength(31)
    })

    it('handles leap February 2024 without drift', () => {
      const grid = buildMonthGrid(new Date('2024-02-10T00:00:00.000Z'))
      expect(grid).toHaveLength(42)
      // 2024-02-01 is a Thursday → grid starts on Monday 2024-01-29 (Sunday-start: 2024-01-28).
      expect(grid[0].date.toISOString()).toBe('2024-01-28T00:00:00.000Z')
      expect(grid[0].isCurrentMonth).toBe(false)
      // 29 February exists in the leap year and is in the grid.
      expect(cellKeys(grid)).toContain('2024-02-29')
      expect(grid.filter((c) => c.isCurrentMonth)).toHaveLength(29)
    })

    it('handles the DST boundary month (March 2026 — US DST starts 2026-03-08) with no off-by-one', () => {
      // Pure UTC maths: a UTC-midnight anchor must land on the same cells
      // regardless of any DST transition in the host TZ.
      const grid = buildMonthGrid(new Date('2026-03-15T00:00:00.000Z'))
      expect(grid).toHaveLength(42)
      const keys = cellKeys(grid)
      expect(keys[0]).toBe('2026-03-01')
      expect(keys).toContain('2026-03-08')
      expect(keys[41]).toBe('2026-04-11')
      // Consecutive cells are consecutive UTC days — DST must not skip or repeat one.
      for (let i = 1; i < keys.length; i += 1) {
        const prev = new Date(`${keys[i - 1]}T00:00:00.000Z`).getTime()
        const curr = new Date(`${keys[i]}T00:00:00.000Z`).getTime()
        expect(curr - prev).toBe(24 * 60 * 60 * 1000)
      }
    })

    it('spans a year change correctly (December 2025 → January 2026)', () => {
      const grid = buildMonthGrid(new Date('2025-12-25T00:00:00.000Z'))
      const keys = cellKeys(grid)
      // 2025-12-01 is a Monday → the Sunday-start grid begins 2025-11-30.
      expect(keys[0]).toBe('2025-11-30')
      expect(keys[41]).toBe('2026-01-10')
      expect(keys).toContain('2026-01-01')
      expect(grid.filter((c) => c.isCurrentMonth)).toHaveLength(31)
    })

    it('marks isToday exactly on the injected now', () => {
      const now = new Date('2026-08-05T09:30:00.000Z')
      const grid = buildMonthGrid(new Date('2026-08-15T00:00:00.000Z'), 0, now)
      const todayCells = grid.filter((c) => c.isToday)
      expect(todayCells).toHaveLength(1)
      expect(utcDayKey(todayCells[0]!.date)).toBe('2026-08-05')
    })

    it('supports a Monday-start grid (weekStartsOn: 1)', () => {
      // Aug 2026 starts Saturday; Monday-start grid begins 2026-07-27.
      const grid = buildMonthGrid(new Date('2026-08-05T00:00:00.000Z'), 1)
      expect(grid[0].date.toISOString()).toBe('2026-07-27T00:00:00.000Z')
      expect(grid[6].date.toISOString()).toBe('2026-08-02T00:00:00.000Z')
    })
  })

  describe('buildWeekGrid / buildDayGrid', () => {
    it('builds 7 cells starting on the anchor week’s Sunday', () => {
      const grid = buildWeekGrid(new Date('2026-08-05T00:00:00.000Z'))
      expect(grid).toHaveLength(7)
      expect(grid[0].date.toISOString()).toBe('2026-08-02T00:00:00.000Z')
      expect(grid[6].date.toISOString()).toBe('2026-08-08T00:00:00.000Z')
    })

    it('builds 1 cell for the anchor day', () => {
      const grid = buildDayGrid(new Date('2026-08-05T14:20:00.000Z'))
      expect(grid).toHaveLength(1)
      expect(grid[0]!.date.toISOString()).toBe('2026-08-05T00:00:00.000Z')
      expect(grid[0]!.isCurrentMonth).toBe(true)
    })
  })

  describe('rangeFor', () => {
    const anchor = new Date('2026-08-15T00:00:00.000Z')

    it('day mode returns the anchor UTC day', () => {
      expect(rangeFor('day', anchor)).toEqual({
        from: new Date('2026-08-15T00:00:00.000Z'),
        to: new Date('2026-08-15T00:00:00.000Z'),
      })
    })

    it('week mode returns Sunday → Saturday of the anchor week', () => {
      expect(rangeFor('week', anchor)).toEqual({
        from: new Date('2026-08-09T00:00:00.000Z'),
        to: new Date('2026-08-15T00:00:00.000Z'),
      })
    })

    it('month mode returns the full 42-cell grid window', () => {
      // Aug 2026 starts Saturday → the Sunday-start 42-cell grid spans
      // 2026-07-26 → 2026-09-05.
      expect(rangeFor('month', anchor)).toEqual({
        from: new Date('2026-07-26T00:00:00.000Z'),
        to: new Date('2026-09-05T00:00:00.000Z'),
      })
    })
  })

  describe('groupByDay + UTC bucketing (T7)', () => {
    it('buckets a UTC-midnight dueDate under its own day, not the previous day, for a negative-UTC offset', () => {
      // America/New_York is UTC-5 in August (EDT). A dueDate stored at UTC
      // midnight must land in the 2026-08-05 cell, NOT 2026-08-04.
      process.env.TZ = 'America/New_York'
      const dueDate = new Date('2026-08-05T00:00:00.000Z')
      const items = [{ id: 't1', dueDate }]
      const groups = groupByDay(items, (t) => t.dueDate)
      expect([...groups.keys()]).toEqual(['2026-08-05'])
      expect(groups.get('2026-08-05')).toHaveLength(1)
    })

    it('groups by the dateOf accessor and preserves insertion order', () => {
      const items = [
        { id: 'a', at: '2026-08-05T10:00:00.000Z' },
        { id: 'b', at: '2026-08-03T00:00:00.000Z' },
        { id: 'c', at: '2026-08-05T23:59:59.999Z' },
      ]
      const groups = groupByDay(items, (i) => i.at)
      expect([...groups.keys()]).toEqual(['2026-08-05', '2026-08-03'])
      expect(groups.get('2026-08-05')!.map((i) => i.id)).toEqual(['a', 'c'])
    })

    it('toUtcMidnight and utcDayKey agree (the grid, the badges and the API use the same day start)', () => {
      const localEvening = new Date('2026-08-05T23:59:00.000Z')
      expect(utcDayKey(toUtcMidnight(localEvening))).toBe('2026-08-05')
      expect(key('2026-08-05T00:00:00.000Z')).toBe('2026-08-05')
    })
  })
})
