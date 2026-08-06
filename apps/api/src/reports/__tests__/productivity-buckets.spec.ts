import {
  bucketKey,
  collapseToTopN,
  enumerateBuckets,
  percentageOf,
  toUtcMidnight,
} from '../productivity-buckets'
import type { TaskTimeRow } from '../productivity-buckets'

// All assertions use explicit UTC instants and the module's getUTC* math —
// the answers are TZ-independent by construction (T5 trap: never construct
// bare date-only strings and compare them across machines).

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d))
}

describe('toUtcMidnight', () => {
  it('returns UTC midnight for a normal date', () => {
    expect(toUtcMidnight(new Date('2026-01-15T14:32:05.123Z'))).toEqual(utc(2026, 0, 15))
  })

  it('leaves an already-midnight date unchanged', () => {
    const midnight = utc(2026, 5, 1)
    expect(toUtcMidnight(midnight)).toEqual(midnight)
  })

  it('is TZ-independent across a DST boundary', () => {
    // US DST starts 2026-03-08 — the UTC midnight must not shift.
    expect(toUtcMidnight(new Date('2026-03-08T01:30:00.000Z'))).toEqual(utc(2026, 2, 8))
    expect(toUtcMidnight(new Date('2026-03-08T23:59:59.999Z'))).toEqual(utc(2026, 2, 8))
    // Northern-hemisphere DST end 2026-11-01.
    expect(toUtcMidnight(new Date('2026-11-01T00:30:00.000Z'))).toEqual(utc(2026, 10, 1))
  })
})

describe('bucketKey', () => {
  it('DAY: yyyy-mm-dd', () => {
    expect(bucketKey(new Date('2026-01-15T09:00:00.000Z'), 'DAY')).toBe('2026-01-15')
  })

  it('WEEK: the Monday UTC-midnight of the ISO week', () => {
    // 2026-01-15 is a Thursday → Monday 2026-01-12.
    expect(bucketKey(new Date('2026-01-15T09:00:00.000Z'), 'WEEK')).toBe('2026-01-12')
    // A Monday itself stays in its own week.
    expect(bucketKey(new Date('2026-01-12T00:00:00.000Z'), 'WEEK')).toBe('2026-01-12')
    // The Sunday at the end of the same ISO week.
    expect(bucketKey(new Date('2026-01-18T23:59:00.000Z'), 'WEEK')).toBe('2026-01-12')
    // A Sunday belongs to the week STARTING on the Monday before it.
    expect(bucketKey(new Date('2026-01-04T12:00:00.000Z'), 'WEEK')).toBe('2025-12-29')
  })

  it('MONTH: the 1st of the month', () => {
    expect(bucketKey(new Date('2026-01-15T09:00:00.000Z'), 'MONTH')).toBe('2026-01-01')
    expect(bucketKey(new Date('2026-12-31T23:00:00.000Z'), 'MONTH')).toBe('2026-12-01')
  })
})

describe('enumerateBuckets', () => {
  it('DAY: single-day range yields one key', () => {
    expect(enumerateBuckets(utc(2026, 0, 15), utc(2026, 0, 15), 'DAY')).toEqual(['2026-01-15'])
  })

  it('DAY: a 30-day range is dense with no gaps', () => {
    const keys = enumerateBuckets(utc(2026, 0, 1), utc(2026, 0, 30), 'DAY')
    expect(keys).toHaveLength(30)
    expect(keys[0]).toBe('2026-01-01')
    expect(keys[29]).toBe('2026-01-30')
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T00:00:00.000Z`).getTime()
      const curr = new Date(`${keys[i]}T00:00:00.000Z`).getTime()
      expect(curr - prev).toBe(24 * 60 * 60 * 1000)
    }
  })

  it('DAY: spans a month boundary', () => {
    const keys = enumerateBuckets(utc(2026, 0, 30), utc(2026, 1, 2), 'DAY')
    expect(keys).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'])
  })

  it('DAY: spans a year boundary', () => {
    const keys = enumerateBuckets(utc(2025, 11, 30), utc(2026, 0, 2), 'DAY')
    expect(keys).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
  })

  it('DAY: includes 2024-02-29 in a leap February', () => {
    const keys = enumerateBuckets(utc(2024, 1, 1), utc(2024, 2, 1), 'DAY')
    expect(keys).toContain('2024-02-29')
    expect(keys).toHaveLength(30) // Feb 1..29 + Mar 1
  })

  it('WEEK: one week yields one key; a two-week range crossing Monday yields two', () => {
    // Mon 2026-01-12 .. Sun 2026-01-18
    expect(enumerateBuckets(utc(2026, 0, 12), utc(2026, 0, 18), 'WEEK')).toEqual(['2026-01-12'])
    // Thu 2026-01-15 .. Thu 2026-01-22 crosses into the next ISO week.
    expect(enumerateBuckets(utc(2026, 0, 15), utc(2026, 0, 22), 'WEEK')).toEqual([
      '2026-01-12',
      '2026-01-19',
    ])
  })

  it('WEEK: a range straddling a year boundary uses the Monday of the ISO week', () => {
    // 2026-01-01 is a Thursday in ISO week 2025-W53 → Monday 2025-12-29.
    expect(enumerateBuckets(utc(2026, 0, 1), utc(2026, 0, 4), 'WEEK')).toEqual(['2025-12-29'])
  })

  it('MONTH: a single month yields one key; three months yield three', () => {
    expect(enumerateBuckets(utc(2026, 0, 15), utc(2026, 0, 31), 'MONTH')).toEqual(['2026-01-01'])
    expect(enumerateBuckets(utc(2026, 0, 15), utc(2026, 2, 15), 'MONTH')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('MONTH: spans a year boundary without drift', () => {
    expect(enumerateBuckets(utc(2025, 11, 1), utc(2026, 1, 1), 'MONTH')).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
  })
})

describe('percentageOf', () => {
  it('rounds to one decimal', () => {
    expect(percentageOf(50, 200)).toBe(25)
    expect(percentageOf(1, 3)).toBe(33.3)
    expect(percentageOf(2, 3)).toBe(66.7)
    expect(percentageOf(1, 6)).toBe(16.7)
  })

  it('returns 0 when the total is 0 — never NaN', () => {
    expect(percentageOf(0, 0)).toBe(0)
    expect(percentageOf(100, 0)).toBe(0)
    expect(Number.isNaN(percentageOf(0, 0))).toBe(false)
  })
})

describe('collapseToTopN', () => {
  const row = (taskId: string, taskTitle: string, totalSeconds: number): TaskTimeRow => ({
    taskId,
    taskTitle,
    totalSeconds,
  })

  it('returns an empty array for no rows', () => {
    expect(collapseToTopN([], 8, 'Other')).toEqual([])
  })

  it('keeps every row when at or below the threshold', () => {
    const rows = [row('a', 'A', 100), row('b', 'B', 50)]
    expect(collapseToTopN(rows, 8, 'Other')).toHaveLength(2)
    expect(collapseToTopN(rows, 2, 'Other')).toHaveLength(2)
  })

  it('produces exactly n + 1 rows with an Other row summing the tail', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`t${i}`, `Task ${i}`, 100 - i))
    const result = collapseToTopN(rows, 8, 'Other')
    expect(result).toHaveLength(9)
    const other = result[8]!
    expect(other.taskTitle).toBe('Other')
    expect(other.taskId).toBe('')
    // Tail = rows 8 (92) after sorting desc; total of all = 900 - 36 = 864.
    expect(other.totalSeconds).toBe(
      rows.reduce((sum, r) => sum + r.totalSeconds, 0) -
        result.slice(0, 8).reduce((sum, r) => sum + r.totalSeconds, 0),
    )
  })

  it('caps 50 rows at n + 1, keeping the largest n first', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`t${i}`, `Task ${i}`, i))
    const result = collapseToTopN(rows, 8, 'Other')
    expect(result).toHaveLength(9)
    expect(result[0]!.totalSeconds).toBe(49)
    expect(result[7]!.totalSeconds).toBe(42)
    // Tail = 0..41 = 861.
    expect(result[8]!.totalSeconds).toBe(861)
  })

  it('preserves zero rows and gives Other zero when everything is zero', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`t${i}`, `Task ${i}`, 0))
    const result = collapseToTopN(rows, 8, 'Other')
    expect(result).toHaveLength(9)
    expect(result.every((r) => r.totalSeconds === 0)).toBe(true)
    expect(result[8]!.taskTitle).toBe('Other')
  })
})
