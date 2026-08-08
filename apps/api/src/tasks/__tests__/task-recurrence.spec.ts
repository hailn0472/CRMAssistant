import { advanceByPattern, computeDueOccurrences } from '../task-recurrence'

describe('task-recurrence', () => {
  describe('advanceByPattern', () => {
    it('DAILY: advances by 1 day', () => {
      const from = new Date('2026-08-01T00:00:00.000Z')
      const result = advanceByPattern(from, 'DAILY')
      expect(result.toISOString()).toBe('2026-08-02T00:00:00.000Z')
    })

    it('WEEKLY: advances by 7 days', () => {
      const from = new Date('2026-08-01T00:00:00.000Z')
      const result = advanceByPattern(from, 'WEEKLY')
      expect(result.toISOString()).toBe('2026-08-08T00:00:00.000Z')
    })

    it('WEEKLY: crosses month boundary', () => {
      const from = new Date('2026-08-28T00:00:00.000Z')
      const result = advanceByPattern(from, 'WEEKLY')
      expect(result.toISOString()).toBe('2026-09-04T00:00:00.000Z')
    })

    it('MONTHLY: advances by 1 month', () => {
      const from = new Date('2026-01-15T00:00:00.000Z')
      const result = advanceByPattern(from, 'MONTHLY')
      expect(result.toISOString()).toBe('2026-02-15T00:00:00.000Z')
    })

    it('MONTHLY: 31 Jan → 28 Feb (clamp to 28 in non-leap year)', () => {
      const from = new Date('2026-01-31T00:00:00.000Z')
      const result = advanceByPattern(from, 'MONTHLY')
      expect(result.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    })

    it('MONTHLY: 31 Jan → 29 Feb (clamp to 29 in leap year)', () => {
      const from = new Date('2028-01-31T00:00:00.000Z')
      const result = advanceByPattern(from, 'MONTHLY')
      expect(result.toISOString()).toBe('2028-02-29T00:00:00.000Z')
    })

    it('MONTHLY: 31 Mar → 30 Apr (clamp to 30)', () => {
      const from = new Date('2026-03-31T00:00:00.000Z')
      const result = advanceByPattern(from, 'MONTHLY')
      expect(result.toISOString()).toBe('2026-04-30T00:00:00.000Z')
    })

    it('MONTHLY: Dec → Jan year rollover', () => {
      const from = new Date('2026-12-15T00:00:00.000Z')
      const result = advanceByPattern(from, 'MONTHLY')
      expect(result.toISOString()).toBe('2027-01-15T00:00:00.000Z')
    })

    it('YEARLY: advances by 1 year', () => {
      const from = new Date('2026-06-15T00:00:00.000Z')
      const result = advanceByPattern(from, 'YEARLY')
      expect(result.toISOString()).toBe('2027-06-15T00:00:00.000Z')
    })

    it('YEARLY: 29 Feb 2028 → 28 Feb 2029 (clamp)', () => {
      const from = new Date('2028-02-29T00:00:00.000Z')
      const result = advanceByPattern(from, 'YEARLY')
      expect(result.toISOString()).toBe('2029-02-28T00:00:00.000Z')
    })

    it('always returns UTC-midnight normalised date', () => {
      const from = new Date('2026-08-01T14:30:00.000Z')
      const result = advanceByPattern(from, 'DAILY')
      expect(result.getUTCHours()).toBe(0)
      expect(result.getUTCMinutes()).toBe(0)
      expect(result.getUTCSeconds()).toBe(0)
      expect(result.getUTCMilliseconds()).toBe(0)
    })
  })

  describe('computeDueOccurrences', () => {
    it('generates daily occurrences up to today', () => {
      const anchor = new Date('2026-08-01T00:00:00.000Z')
      const today = new Date('2026-08-04T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'DAILY', null, today, 30)
      // Anchor is Aug 1, advance gives Aug 2, 3, 4 (all <= today)
      expect(result).toEqual([
        new Date('2026-08-02T00:00:00.000Z'),
        new Date('2026-08-03T00:00:00.000Z'),
        new Date('2026-08-04T00:00:00.000Z'),
      ])
    })

    it('respects max cap', () => {
      const anchor = new Date('2026-01-01T00:00:00.000Z')
      const today = new Date('2026-12-31T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'DAILY', null, today, 5)
      expect(result).toHaveLength(5)
    })

    it('respects recurrenceEndDate (inclusive)', () => {
      const anchor = new Date('2026-08-01T00:00:00.000Z')
      const endDate = new Date('2026-08-03T00:00:00.000Z')
      const today = new Date('2026-08-10T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'DAILY', endDate, today, 30)
      // Aug 2, Aug 3 (endDate inclusive), Aug 4 would exceed endDate
      expect(result).toEqual([
        new Date('2026-08-02T00:00:00.000Z'),
        new Date('2026-08-03T00:00:00.000Z'),
      ])
    })

    it('generates no occurrences when anchor is today', () => {
      const anchor = new Date('2026-08-04T00:00:00.000Z')
      const today = new Date('2026-08-04T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'DAILY', null, today, 30)
      // advanceByPattern gives Aug 5, which is > today
      expect(result).toHaveLength(0)
    })

    it('generates no occurrences when today is before the first next occurrence', () => {
      const anchor = new Date('2026-08-01T00:00:00.000Z')
      const today = new Date('2026-08-01T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'WEEKLY', null, today, 30)
      expect(result).toHaveLength(0)
    })

    it('weekly occurrences', () => {
      const anchor = new Date('2026-08-01T00:00:00.000Z')
      const today = new Date('2026-08-22T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'WEEKLY', null, today, 30)
      expect(result).toEqual([
        new Date('2026-08-08T00:00:00.000Z'),
        new Date('2026-08-15T00:00:00.000Z'),
        new Date('2026-08-22T00:00:00.000Z'),
      ])
    })

    it('monthly occurrences', () => {
      const anchor = new Date('2026-01-15T00:00:00.000Z')
      const today = new Date('2026-04-15T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'MONTHLY', null, today, 30)
      expect(result).toEqual([
        new Date('2026-02-15T00:00:00.000Z'),
        new Date('2026-03-15T00:00:00.000Z'),
        new Date('2026-04-15T00:00:00.000Z'),
      ])
    })

    it('yearly occurrences', () => {
      const anchor = new Date('2026-06-15T00:00:00.000Z')
      const today = new Date('2029-06-15T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'YEARLY', null, today, 30)
      expect(result).toEqual([
        new Date('2027-06-15T00:00:00.000Z'),
        new Date('2028-06-15T00:00:00.000Z'),
        new Date('2029-06-15T00:00:00.000Z'),
      ])
    })

    it('every returned date is UTC-midnight normalised', () => {
      const anchor = new Date('2026-08-01T14:30:00.000Z')
      const today = new Date('2026-08-05T00:00:00.000Z')
      const result = computeDueOccurrences(anchor, 'DAILY', null, today, 3)
      for (const date of result) {
        expect(date.getUTCHours()).toBe(0)
        expect(date.getUTCMinutes()).toBe(0)
        expect(date.getUTCSeconds()).toBe(0)
      }
    })
  })
})
