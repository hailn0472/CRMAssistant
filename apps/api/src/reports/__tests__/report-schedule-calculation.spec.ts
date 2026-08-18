/**
 * Story 6.5 (Contract B8, AC 17): deterministic next-run calculation tests.
 * Framework-free pure functions with fixed UTC instants and named IANA zones.
 */
import {
  calculateNextRun,
  validateCronExpression,
  retryDelayMsForAttempt,
  MAX_ATTEMPTS,
  type ScheduleCadence,
} from '../report-schedule-calculation'

const TZ = 'America/New_York'

function cadence(
  overrides: Partial<ScheduleCadence> & { frequency: ScheduleCadence['frequency'] },
): ScheduleCadence {
  return {
    timezone: 'UTC',
    scheduledTime: '09:00',
    ...overrides,
  } as ScheduleCadence
}

describe('report-schedule-calculation', () => {
  describe('DAILY', () => {
    it('returns the next local occurrence strictly after `after`', () => {
      const next = calculateNextRun(
        cadence({ frequency: 'DAILY' }),
        new Date('2026-01-01T08:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-01-01T09:00:00.000Z')
    })

    it('never returns the same UTC instant twice and is strictly future', () => {
      const after = new Date('2026-01-01T09:00:00.000Z')
      const next = calculateNextRun(cadence({ frequency: 'DAILY' }), after)
      expect(next.getTime()).toBeGreaterThan(after.getTime())
      expect(next.toISOString()).toBe('2026-01-02T09:00:00.000Z')
    })

    it('preserves wall-clock across DST spring-forward (gap day is skipped)', () => {
      // 2026-03-08 02:30 America/New_York does not exist (spring forward at
      // 02:00). The Mar 8 occurrence is skipped; the next valid one is
      // Mar 9 02:30 EDT — same wall-clock, matching cron-parser behavior.
      const next = calculateNextRun(
        cadence({ frequency: 'DAILY', timezone: TZ, scheduledTime: '02:30' }),
        new Date('2026-03-07T08:00:00Z'), // after the Mar 7 07:30Z occurrence
      )
      expect(next.toISOString()).toBe('2026-03-09T06:30:00.000Z') // 02:30 EDT
    })

    it('DST fall-back does not produce duplicate wall-clocks; earlier instant wins', () => {
      // 2026-11-01: 01:30 local exists twice (EDT then EST). First occurrence wins.
      const next = calculateNextRun(
        cadence({ frequency: 'DAILY', timezone: TZ, scheduledTime: '01:30' }),
        new Date('2026-10-31T06:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-11-01T05:30:00.000Z') // 01:30 EDT
    })

    it('honours a non-UTC zone without DST shift', () => {
      const next = calculateNextRun(
        cadence({ frequency: 'DAILY', timezone: 'Asia/Ho_Chi_Minh', scheduledTime: '08:00' }),
        new Date('2026-01-01T00:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-01-01T01:00:00.000Z') // 08:00 +07
    })
  })

  describe('WEEKLY', () => {
    it('finds the next matching weekday', () => {
      // Sunday=0. 2026-01-01 is a Thursday; dayOfWeek 4 is the same day, but the
      // 09:00 occurrence is already past 08:00Z? after = 08:00Z on Thu; 09:00Z
      // on Thu is still ahead, so next is Thursday itself.
      const next = calculateNextRun(
        cadence({ frequency: 'WEEKLY', dayOfWeek: 4 }),
        new Date('2026-01-01T08:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-01-01T09:00:00.000Z')
    })

    it('rolls to next week when the weekday occurrence is in the past', () => {
      const next = calculateNextRun(
        cadence({ frequency: 'WEEKLY', dayOfWeek: 4 }),
        new Date('2026-01-01T10:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-01-08T09:00:00.000Z')
    })
  })

  describe('MONTHLY and month-end clamp', () => {
    it('clamps day 31 to the last day of short months', () => {
      // April has 30 days → clamped to Apr 30.
      const next = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 31 }),
        new Date('2026-03-01T00:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-03-31T09:00:00.000Z')
      const afterApril = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 31 }),
        new Date('2026-04-30T09:00:00Z'),
      )
      expect(afterApril.toISOString()).toBe('2026-05-31T09:00:00.000Z')
    })

    it('handles February 29 on leap years and clamps on non-leap years', () => {
      const leap = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 29 }),
        new Date('2026-01-01T00:00:00Z'),
      )
      expect(leap.toISOString()).toBe('2026-01-29T09:00:00.000Z')
      // 2028 is a leap year; Feb 29 exists. From Jan 2028 → Feb 29 2028.
      const leapFeb = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 29 }),
        new Date('2028-01-30T00:00:00Z'),
      )
      expect(leapFeb.toISOString()).toBe('2028-02-29T09:00:00.000Z')
      // 2027 is not a leap year; Feb 29 clamps to Feb 28.
      const nonLeap = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 29 }),
        new Date('2027-01-30T00:00:00Z'),
      )
      expect(nonLeap.toISOString()).toBe('2027-02-28T09:00:00.000Z')
    })

    it('rolls over the year boundary', () => {
      const next = calculateNextRun(
        cadence({ frequency: 'MONTHLY', dayOfMonth: 15 }),
        new Date('2026-12-20T00:00:00Z'),
      )
      expect(next.toISOString()).toBe('2027-01-15T09:00:00.000Z')
    })
  })

  describe('QUARTERLY', () => {
    it('repeats every three months from startMonth', () => {
      const c = cadence({ frequency: 'QUARTERLY', dayOfMonth: 1, startMonth: 2 })
      // Feb 2026 → May 2026 → Aug 2026 → Nov 2026 → Feb 2027
      const first = calculateNextRun(c, new Date('2026-01-15T00:00:00Z'))
      expect(first.toISOString()).toBe('2026-02-01T09:00:00.000Z')
      const second = calculateNextRun(c, new Date('2026-03-01T00:00:00Z'))
      expect(second.toISOString()).toBe('2026-05-01T09:00:00.000Z')
    })

    it('rolls the year over when startMonth + 3n crosses December', () => {
      const c = cadence({ frequency: 'QUARTERLY', dayOfMonth: 10, startMonth: 11 })
      const next = calculateNextRun(c, new Date('2026-12-01T00:00:00Z'))
      expect(next.toISOString()).toBe('2027-02-10T09:00:00.000Z')
    })

    it('clamps month-end days like MONTHLY', () => {
      const c = cadence({ frequency: 'QUARTERLY', dayOfMonth: 31, startMonth: 4 })
      const next = calculateNextRun(c, new Date('2026-03-01T00:00:00Z'))
      expect(next.toISOString()).toBe('2026-04-30T09:00:00.000Z')
    })
  })

  describe('CUSTOM_CRON', () => {
    it('returns the next five-field occurrence in the given timezone', () => {
      const next = calculateNextRun(
        cadence({
          frequency: 'CUSTOM_CRON',
          timezone: TZ,
          cronExpression: '0 9 * * 1', // Mondays 09:00 NY
        }),
        new Date('2026-01-01T00:00:00Z'),
      )
      expect(next.toISOString()).toBe('2026-01-05T14:00:00.000Z') // Mon Jan 5 09:00 EST
    })
  })

  describe('validateCronExpression', () => {
    it('accepts an hourly or slower five-field expression', () => {
      expect(() =>
        validateCronExpression('0 * * * *', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).not.toThrow()
      expect(() =>
        validateCronExpression('0 9 * * 1', TZ, new Date('2026-01-01T00:00:00Z')),
      ).not.toThrow()
    })

    it('rejects seconds-field and sub-hourly expressions', () => {
      expect(() =>
        validateCronExpression('0 0 9 * * *', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).toThrow()
      expect(() =>
        validateCronExpression('*/30 * * * *', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).toThrow()
      expect(() =>
        validateCronExpression('* * * * *', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).toThrow()
    })

    it('rejects syntactically invalid expressions', () => {
      expect(() =>
        validateCronExpression('bogus', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).toThrow()
      expect(() =>
        validateCronExpression('0 99 * * *', 'UTC', new Date('2026-01-01T00:00:00Z')),
      ).toThrow()
    })
  })

  describe('retry budget', () => {
    it('defines one initial attempt plus three retries at 1/2/4 minutes', () => {
      expect(MAX_ATTEMPTS).toBe(4)
      expect(retryDelayMsForAttempt(1)).toBe(60_000)
      expect(retryDelayMsForAttempt(2)).toBe(120_000)
      expect(retryDelayMsForAttempt(3)).toBe(240_000)
    })
  })
})
