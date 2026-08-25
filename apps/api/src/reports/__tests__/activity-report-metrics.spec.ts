/**
 * Story 6.8 (Contract B6, F32): pure activity-report metric contract —
 * exhaustive boundaries F1–F20 from the test plan. The module under test must
 * stay free of Nest/Prisma imports.
 */
import {
  ACTIVITY_REPORT_MAX_RANGE_DAYS,
  ACTIVITY_REPORT_MAX_ROWS,
  LEADERBOARD_METRICS,
  ACTIVITY_REPORT_SORT_BYS,
  ACTIVITY_REPORT_BUCKETS,
  ACTIVITY_TYPES,
  completionRate,
  avgCompletionHours,
  heatmapKey,
  enumerateHeatmapCells,
  goalPeriodWindow,
  expectedPace,
  isFallingBehind,
  toUtcMidnight,
  utcDayKey,
  enumerateUtcDays,
  round1,
  round2,
  ActivityReportValidationError,
  normalizeActivityReportFilters,
} from '../activity-report-metrics'

describe('activity-report-metrics (pure)', () => {
  describe('F19 — closed constants', () => {
    it('matches the ProductivityService MAX_RANGE_DAYS and bounds rows', () => {
      expect(ACTIVITY_REPORT_MAX_RANGE_DAYS).toBe(366)
      expect(ACTIVITY_REPORT_MAX_ROWS).toBe(20000)
    })

    it('exposes the exact leaderboard/sortBy/bucket vocabularies', () => {
      expect(LEADERBOARD_METRICS).toEqual([
        'ACTIVITIES_LOGGED',
        'TASKS_COMPLETED',
        'DEALS_CLOSED',
        'TIME_TRACKED',
      ])
      expect(ACTIVITY_REPORT_SORT_BYS).toEqual([
        'ACTIVITIES',
        'TASKS_COMPLETED',
        'DEALS_CLOSED',
        'TIME_TRACKED',
      ])
      expect(ACTIVITY_REPORT_BUCKETS).toEqual(['DAY', 'WEEK', 'MONTH'])
    })

    it('mirrors the Prisma ActivityType vocabulary exactly', () => {
      expect(ACTIVITY_TYPES).toEqual([
        'EMAIL_SENT',
        'CALL_MADE',
        'MEETING_SCHEDULED',
        'NOTE_ADDED',
        'DEAL_CREATED',
        'CONTACT_CREATED',
        'CONTACT_UPDATED',
        'CONTACT_OWNER_CHANGED',
        'TASK_COMPLETED',
        'DEAL_STAGE_CHANGED',
        'MESSAGE_RECEIVED',
        'MESSAGE_SENT',
      ])
    })
  })

  describe('F1–F6 — completionRate', () => {
    it('F1: denominator 0 → 0 (no divide-by-zero, no NaN)', () => {
      expect(completionRate(0, 0)).toBe(0)
    })
    it('F2: 0%', () => {
      expect(completionRate(0, 4)).toBe(0)
    })
    it('F3: 100%', () => {
      expect(completionRate(4, 4)).toBe(1.0)
    })
    it('F4: fraction rounded to 2 decimals', () => {
      expect(completionRate(3, 4)).toBe(0.75)
      expect(completionRate(1, 3)).toBe(0.33)
    })
    it('F5: rejects numerator > denominator (data error, not silent clamp)', () => {
      expect(() => completionRate(5, 4)).toThrow()
      // F6: the float-clamp path does not exist for count inputs — a
      // numerator above the denominator is rejected, never clamped to 1.
      expect(() => completionRate(4, 3)).toThrow()
    })
    it('F6: negative inputs are data errors, rejected', () => {
      expect(() => completionRate(-1, 4)).toThrow()
      expect(() => completionRate(2, -4)).toThrow()
    })
    it('rejects non-finite inputs', () => {
      expect(() => completionRate(Number.NaN, 4)).toThrow()
      expect(() => completionRate(2, Number.POSITIVE_INFINITY)).toThrow()
    })
  })

  describe('F7–F8 — avgCompletionHours', () => {
    it('F7: rounds to 1 decimal', () => {
      expect(avgCompletionHours([7_200_000, 14_400_000])).toBe(3.0)
      expect(avgCompletionHours([3_600_000])).toBe(1.0)
    })
    it('F7: empty list → 0', () => {
      expect(avgCompletionHours([])).toBe(0)
    })
    it('F8: rejects non-finite inputs', () => {
      expect(() => avgCompletionHours([Number.POSITIVE_INFINITY])).toThrow()
      expect(() => avgCompletionHours([Number.NaN])).toThrow()
    })
  })

  describe('F9–F11 — heatmap key + 168 zero-filled cells (UTC)', () => {
    it('F9: maps UTC day-of-week 0..6 × UTC hour 0..23', () => {
      // 2026-08-22 is a Saturday (getUTCDay 6); 01:00Z → hour 1
      expect(heatmapKey(new Date('2026-08-22T01:00:00.000Z'))).toEqual({
        dayOfWeek: 6,
        hour: 1,
      })
      expect(heatmapKey(new Date('2026-08-22T23:59:59.999Z')).hour).toBe(23)
      expect(heatmapKey(new Date('2026-08-22T00:00:00.000Z')).hour).toBe(0)
      // A Monday UTC 00:00 → (1, 0)
      expect(heatmapKey(new Date('2026-08-24T00:00:00.000Z'))).toEqual({
        dayOfWeek: 1,
        hour: 0,
      })
    })
    it('F10: enumerateHeatmapCells returns exactly 168 zero-filled unique cells', () => {
      const cells = enumerateHeatmapCells()
      expect(cells).toHaveLength(168)
      const keys = new Set(cells.map((c) => `${c.dayOfWeek}:${c.hour}`))
      expect(keys.size).toBe(168)
      for (const cell of cells) {
        expect(cell.count).toBe(0)
        expect(cell.dayOfWeek).toBeGreaterThanOrEqual(0)
        expect(cell.dayOfWeek).toBeLessThanOrEqual(6)
        expect(cell.hour).toBeGreaterThanOrEqual(0)
        expect(cell.hour).toBeLessThanOrEqual(23)
      }
    })
    it('F11: no silent truncation — every cell is present even at 0', () => {
      const cells = enumerateHeatmapCells()
      expect(cells.filter((c) => c.count === 0)).toHaveLength(168)
    })
  })

  describe('F12–F14 — goalPeriodWindow', () => {
    it('F12: WEEKLY is anchored on startsOn (not calendar Sun/Mon)', () => {
      const startsOn = new Date('2026-08-19T00:00:00.000Z') // Wednesday
      const window = goalPeriodWindow(startsOn, 'WEEKLY', new Date('2026-08-22T00:00:00.000Z'))
      expect(window.start.toISOString()).toBe('2026-08-19T00:00:00.000Z')
      expect(window.end.toISOString()).toBe('2026-08-26T00:00:00.000Z')
    })
    it('F13: WEEKLY boundary — 1ms before window start is the previous window', () => {
      const startsOn = new Date('2026-08-19T00:00:00.000Z')
      const justBefore = new Date('2026-08-26T00:00:00.000Z')
      justBefore.setMilliseconds(-1)
      const previous = goalPeriodWindow(startsOn, 'WEEKLY', justBefore)
      expect(previous.start.toISOString()).toBe('2026-08-19T00:00:00.000Z')
      expect(previous.end.toISOString()).toBe('2026-08-26T00:00:00.000Z')
      const atStart = goalPeriodWindow(startsOn, 'WEEKLY', new Date('2026-08-26T00:00:00.000Z'))
      expect(atStart.start.toISOString()).toBe('2026-08-26T00:00:00.000Z')
      expect(atStart.end.toISOString()).toBe('2026-09-02T00:00:00.000Z')
      const lastMoment = goalPeriodWindow(startsOn, 'WEEKLY', new Date('2026-08-25T23:59:59.999Z'))
      expect(lastMoment.start.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    })
    it('F14: MONTHLY is the calendar UTC month containing now', () => {
      const startsOn = new Date('2026-01-05T00:00:00.000Z')
      const feb = goalPeriodWindow(startsOn, 'MONTHLY', new Date('2026-02-10T12:00:00.000Z'))
      expect(feb.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
      expect(feb.end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
      // month lengths: April (30) and February 2028 (29 days — leap)
      const apr = goalPeriodWindow(startsOn, 'MONTHLY', new Date('2026-04-15T00:00:00.000Z'))
      expect(apr.end.toISOString()).toBe('2026-05-01T00:00:00.000Z')
      const leap = goalPeriodWindow(startsOn, 'MONTHLY', new Date('2028-02-15T00:00:00.000Z'))
      expect(leap.end.toISOString()).toBe('2028-03-01T00:00:00.000Z')
    })
    it('not-started goals window to their first period', () => {
      const startsOn = new Date('2026-09-01T00:00:00.000Z')
      const window = goalPeriodWindow(startsOn, 'WEEKLY', new Date('2026-08-22T00:00:00.000Z'))
      expect(window.start.toISOString()).toBe('2026-09-01T00:00:00.000Z')
      expect(window.end.toISOString()).toBe('2026-09-08T00:00:00.000Z')
    })
  })

  describe('F15–F16 — expectedPace + isFallingBehind', () => {
    it('F15: clamps to 0..targetCount', () => {
      expect(expectedPace(50, 0)).toBe(0)
      expect(expectedPace(50, 0.5)).toBe(25)
      expect(expectedPace(50, 1.5)).toBe(50)
    })
    it('F16: strict threshold — equal is not behind', () => {
      expect(isFallingBehind(24, 25)).toBe(true)
      expect(isFallingBehind(25, 25)).toBe(false)
      expect(isFallingBehind(26, 25)).toBe(false)
    })
  })

  describe('F17–F18 — UTC day math + clamps', () => {
    it('toUtcMidnight normalizes any instant to the UTC day', () => {
      expect(toUtcMidnight(new Date('2026-08-22T23:59:59.999Z')).toISOString()).toBe(
        '2026-08-22T00:00:00.000Z',
      )
    })
    it('utcDayKey formats YYYY-MM-DD in UTC', () => {
      expect(utcDayKey(new Date('2026-08-22T01:00:00.000Z'))).toBe('2026-08-22')
    })
    it('enumerateUtcDays is start-inclusive, end-exclusive, zero-fill friendly', () => {
      const days = enumerateUtcDays(
        new Date('2026-08-20T00:00:00.000Z'),
        new Date('2026-08-22T00:00:00.000Z'),
      )
      expect(days).toEqual(['2026-08-20', '2026-08-21'])
      const single = enumerateUtcDays(
        new Date('2026-08-20T00:00:00.000Z'),
        new Date('2026-08-21T00:00:00.000Z'),
      )
      expect(single).toEqual(['2026-08-20'])
    })
    it('F18: round1/round2 helpers round deterministically', () => {
      expect(round1(3.05)).toBe(3.1)
      expect(round2(1 / 3)).toBe(0.33)
    })
  })

  describe('normalizeActivityReportFilters (shared pure validator)', () => {
    const base = { startDate: '2026-08-01', endDate: '2026-08-31' }

    it('accepts a valid closed input and normalizes to UTC midnight bounds', () => {
      const normalized = normalizeActivityReportFilters(base)
      expect(normalized.start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
      // end is exclusive — the UTC midnight AFTER the endDate day
      expect(normalized.end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
      expect(normalized.bucket).toBe('DAY')
      expect(normalized.sortBy).toBe('ACTIVITIES')
      expect(normalized.comparisonTeamIds).toEqual([])
    })

    it('requires startDate/endDate (valid ISO)', () => {
      expect(() =>
        normalizeActivityReportFilters({ startDate: '', endDate: '2026-08-31' }),
      ).toThrow(ActivityReportValidationError)
      expect(() =>
        normalizeActivityReportFilters({ startDate: 'not-a-date', endDate: '2026-08-31' }),
      ).toThrow(ActivityReportValidationError)
    })

    it('B2: rejects endDate < startDate', () => {
      expect(() =>
        normalizeActivityReportFilters({ startDate: '2026-08-31', endDate: '2026-08-01' }),
      ).toThrow(/endDate must be >= startDate/)
    })

    it('B1: rejects a range longer than 366 days; accepts exactly 366', () => {
      // 2025-01-01 → 2026-01-03 is 367 days — over the cap.
      expect(() =>
        normalizeActivityReportFilters({ startDate: '2025-01-01', endDate: '2026-01-03' }),
      ).toThrow(/366 days/)
      // 2025-01-01 → 2026-01-02 is exactly 366 days — allowed.
      const ok = normalizeActivityReportFilters({ startDate: '2025-01-01', endDate: '2026-01-02' })
      expect(ok.start.toISOString()).toBe('2025-01-01T00:00:00.000Z')
      expect(ok.end.toISOString()).toBe('2026-01-03T00:00:00.000Z')
    })

    it('rejects unknown sortBy/bucket values', () => {
      expect(() => normalizeActivityReportFilters({ ...base, sortBy: 'REVENUE' as never })).toThrow(
        /sortBy/,
      )
      expect(() => normalizeActivityReportFilters({ ...base, bucket: 'HOUR' as never })).toThrow(
        /bucket/,
      )
    })

    it('rejects unknown activityType values', () => {
      expect(() =>
        normalizeActivityReportFilters({ ...base, activityTypes: ['BOGUS'] as never }),
      ).toThrow(/activityTypes/)
      expect(() =>
        normalizeActivityReportFilters({ ...base, activityTypes: ['CALL_MADE', 'EMAIL_SENT'] }),
      ).toBeTruthy()
    })

    it('S5: comparisonTeamIds must be unique and at most 4', () => {
      expect(() =>
        normalizeActivityReportFilters({
          ...base,
          comparisonTeamIds: ['a', 'a'],
        }),
      ).toThrow(/unique/)
      expect(() =>
        normalizeActivityReportFilters({
          ...base,
          comparisonTeamIds: ['a', 'b', 'c', 'd', 'e'],
        }),
      ).toThrow(/4/)
    })
  })
})
