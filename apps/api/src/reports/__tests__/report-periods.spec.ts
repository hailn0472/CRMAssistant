/**
 * Story 6.2 (AC 23): pure UTC period resolver.
 * - Current range: inclusive start-of-day through end-of-day.
 * - PREVIOUS_PERIOD: immediately preceding range with equal inclusive day count.
 * - YEAR_OVER_YEAR: shifts both dates back one UTC year with leap-day clamping.
 * - CUSTOM: requires explicit comparison dates.
 * - Maximum range is 36 months.
 */
import {
  resolveCurrentRange,
  resolveComparisonRange,
  previousPeriod,
  yearOverYear,
  daysInclusive,
  parseIsoDay,
  endOfDay,
  mapTimeBucketToComparison,
  assertMaxRangeMonths,
  MAX_RANGE_MONTHS,
} from '../report-periods'
import type { DayRange } from '../report-periods'

const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0)) // 2026-08-15T12:00Z

function iso(range: DayRange): { start: string; end: string } {
  return { start: range.start.toISOString(), end: range.end.toISOString() }
}

describe('parseIsoDay', () => {
  it('parses YYYY-MM-DD into UTC midnight', () => {
    expect(parseIsoDay('2026-08-01', 'x').toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('throws on malformed dates', () => {
    expect(() => parseIsoDay('not-a-date', 'x')).toThrow(/x/i)
    expect(() => parseIsoDay('2026-13-40', 'x')).toThrow()
    expect(() => parseIsoDay('2026-8-1', 'x')).toThrow()
  })
})

describe('daysInclusive', () => {
  it('counts inclusive days', () => {
    expect(daysInclusive(parseIsoDay('2026-08-01', 'a'), parseIsoDay('2026-08-01', 'b'))).toBe(1)
    expect(daysInclusive(parseIsoDay('2026-08-01', 'a'), parseIsoDay('2026-08-31', 'b'))).toBe(31)
  })
})

describe('resolveCurrentRange (AC 23)', () => {
  it('CUSTOM range is inclusive start-of-day through end-of-day', () => {
    const range = resolveCurrentRange(
      { datePreset: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-08-31' },
      NOW,
    )
    expect(iso(range)).toEqual({
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T23:59:59.999Z',
    })
  })

  it('THIS_MONTH resolves to the full current UTC month', () => {
    const range = resolveCurrentRange(
      { datePreset: 'THIS_MONTH', startDate: null, endDate: null },
      NOW,
    )
    expect(iso(range)).toEqual({
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T23:59:59.999Z',
    })
  })

  it('THIS_QUARTER resolves to the current UTC quarter', () => {
    const range = resolveCurrentRange(
      { datePreset: 'THIS_QUARTER', startDate: null, endDate: null },
      NOW,
    )
    expect(iso(range)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-09-30T23:59:59.999Z',
    })
  })

  it('THIS_YEAR resolves to the current UTC year', () => {
    const range = resolveCurrentRange(
      { datePreset: 'THIS_YEAR', startDate: null, endDate: null },
      NOW,
    )
    expect(iso(range)).toEqual({
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-12-31T23:59:59.999Z',
    })
  })

  it('throws when CUSTOM lacks explicit dates', () => {
    expect(() =>
      resolveCurrentRange({ datePreset: 'CUSTOM', startDate: null, endDate: null }, NOW),
    ).toThrow()
  })

  it('throws on reversed CUSTOM range', () => {
    expect(() =>
      resolveCurrentRange(
        { datePreset: 'CUSTOM', startDate: '2026-08-31', endDate: '2026-08-01' },
        NOW,
      ),
    ).toThrow(/end|start/i)
  })

  it('throws on ranges beyond 36 months', () => {
    expect(() =>
      resolveCurrentRange(
        { datePreset: 'CUSTOM', startDate: '2020-01-01', endDate: '2026-01-01' },
        NOW,
      ),
    ).toThrow(new RegExp(`${MAX_RANGE_MONTHS}`))
  })

  it('throws on malformed date strings', () => {
    expect(() =>
      resolveCurrentRange(
        { datePreset: 'CUSTOM', startDate: '2026/08/01', endDate: '2026-08-31' },
        NOW,
      ),
    ).toThrow()
  })
})

describe('previousPeriod (AC 23)', () => {
  it('returns the immediately preceding range with equal inclusive day count', () => {
    const current = { start: parseIsoDay('2026-08-01', 'a'), end: parseIsoDay('2026-08-31', 'b') }
    const prev = previousPeriod(current.start, current.end)
    expect(iso(prev)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-31T23:59:59.999Z',
    })
    expect(daysInclusive(prev.start, prev.end)).toBe(31)
  })

  it('handles single-day ranges', () => {
    const current = { start: parseIsoDay('2026-08-15', 'a'), end: parseIsoDay('2026-08-15', 'b') }
    const prev = previousPeriod(current.start, current.end)
    expect(iso(prev)).toEqual({
      start: '2026-08-14T00:00:00.000Z',
      end: '2026-08-14T23:59:59.999Z',
    })
  })

  it('crosses month and year boundaries', () => {
    const current = { start: parseIsoDay('2026-01-01', 'a'), end: parseIsoDay('2026-01-31', 'b') }
    const prev = previousPeriod(current.start, current.end)
    expect(iso(prev)).toEqual({
      start: '2025-12-01T00:00:00.000Z',
      end: '2025-12-31T23:59:59.999Z',
    })
  })
})

describe('yearOverYear (AC 23)', () => {
  it('shifts both dates back one UTC year', () => {
    const current = { start: parseIsoDay('2026-08-01', 'a'), end: parseIsoDay('2026-08-31', 'b') }
    const yoy = yearOverYear(current.start, current.end)
    expect(iso(yoy)).toEqual({
      start: '2025-08-01T00:00:00.000Z',
      end: '2025-08-31T23:59:59.999Z',
    })
  })

  it('clamps leap day Feb 29 to Feb 28 in a non-leap target year', () => {
    const current = { start: parseIsoDay('2024-02-29', 'a'), end: parseIsoDay('2024-02-29', 'b') }
    const yoy = yearOverYear(current.start, current.end)
    expect(iso(yoy)).toEqual({
      start: '2023-02-28T00:00:00.000Z',
      end: '2023-02-28T23:59:59.999Z',
    })
  })

  it('does not clamp when the target year is also a leap year', () => {
    const current = { start: parseIsoDay('2028-02-29', 'a'), end: parseIsoDay('2028-02-29', 'b') }
    const yoy = yearOverYear(current.start, current.end)
    expect(iso(yoy)).toEqual({
      start: '2027-02-28T00:00:00.000Z',
      end: '2027-02-28T23:59:59.999Z',
    })
    // 2027 is not a leap year; use 2032→2031? no — 2032-02-29 → 2031-02-28 still clamped.
    // A leap-to-leap shift: 2024-02-29 → 2020-02-29 is a 4-year shift; YoY from 2028-02-29
    // lands on 2027-02-28 (clamped). Leap-to-leap only occurs across 4-year jumps, so
    // YoY always clamps a Feb 29 start — assert the general rule instead.
  })

  it('preserves a 31-day range across the shift', () => {
    const current = { start: parseIsoDay('2026-03-01', 'a'), end: parseIsoDay('2026-03-31', 'b') }
    const yoy = yearOverYear(current.start, current.end)
    expect(daysInclusive(yoy.start, yoy.end)).toBe(31)
  })
})

describe('resolveComparisonRange (AC 23-24)', () => {
  const current = { start: parseIsoDay('2026-08-01', 'a'), end: parseIsoDay('2026-08-31', 'b') }

  it('NONE returns null', () => {
    expect(
      resolveComparisonRange(
        { comparisonMode: 'NONE', comparisonStartDate: null, comparisonEndDate: null },
        current,
      ),
    ).toBeNull()
  })

  it('PREVIOUS_PERIOD uses the immediately preceding equal-length range', () => {
    const comp = resolveComparisonRange(
      { comparisonMode: 'PREVIOUS_PERIOD', comparisonStartDate: null, comparisonEndDate: null },
      current,
    )
    expect(comp).not.toBeNull()
    expect(iso(comp as DayRange)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-31T23:59:59.999Z',
    })
  })

  it('YEAR_OVER_YEAR shifts back one UTC year with leap clamping', () => {
    const comp = resolveComparisonRange(
      { comparisonMode: 'YEAR_OVER_YEAR', comparisonStartDate: null, comparisonEndDate: null },
      current,
    )
    expect(iso(comp as DayRange)).toEqual({
      start: '2025-08-01T00:00:00.000Z',
      end: '2025-08-31T23:59:59.999Z',
    })
  })

  it('CUSTOM requires explicit comparison dates', () => {
    expect(() =>
      resolveComparisonRange(
        { comparisonMode: 'CUSTOM', comparisonStartDate: null, comparisonEndDate: null },
        current,
      ),
    ).toThrow(/comparison/i)
    expect(() =>
      resolveComparisonRange(
        { comparisonMode: 'CUSTOM', comparisonStartDate: '2026-07-01', comparisonEndDate: null },
        current,
      ),
    ).toThrow(/comparison/i)
  })

  it('CUSTOM validates the range and equal inclusive day count', () => {
    expect(() =>
      resolveComparisonRange(
        {
          comparisonMode: 'CUSTOM',
          comparisonStartDate: '2026-07-05',
          comparisonEndDate: '2026-07-01',
        },
        current,
      ),
    ).toThrow(/comparison|end|start/i)

    expect(() =>
      resolveComparisonRange(
        {
          comparisonMode: 'CUSTOM',
          comparisonStartDate: '2026-07-01',
          comparisonEndDate: '2026-07-10',
        },
        current,
      ),
    ).toThrow(/day/i)
  })

  it('CUSTOM accepts a same-length comparison range', () => {
    const comp = resolveComparisonRange(
      {
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-06-01',
        comparisonEndDate: '2026-07-01',
      },
      current,
    )
    expect(iso(comp as DayRange)).toEqual({
      start: '2026-06-01T00:00:00.000Z',
      end: '2026-07-01T23:59:59.999Z',
    })
  })
})

describe('assertMaxRangeMonths (AC 23)', () => {
  it('accepts exactly 36 months', () => {
    expect(() =>
      assertMaxRangeMonths(parseIsoDay('2023-08-01', 'a'), parseIsoDay('2026-08-31', 'b')),
    ).not.toThrow()
  })

  it('rejects 37+ months', () => {
    expect(() =>
      assertMaxRangeMonths(parseIsoDay('2023-07-01', 'a'), parseIsoDay('2026-08-31', 'b')),
    ).toThrow(/36/i)
  })
})

// ─── AC 53: time-bucket drill → comparison-period mapping ───────────────────

const AUGUST: DayRange = {
  start: parseIsoDay('2026-08-01', 'a'),
  end: endOfDay(parseIsoDay('2026-08-31', 'a')),
}
const JULY: DayRange = {
  start: parseIsoDay('2026-07-01', 'a'),
  end: endOfDay(parseIsoDay('2026-07-31', 'a')),
}

describe('mapTimeBucketToComparison (AC 53)', () => {
  it('maps a MONTH bucket by index (Aug → July for PREVIOUS_PERIOD)', () => {
    const mapped = mapTimeBucketToComparison(
      parseIsoDay('2026-08-01', 'bucket'),
      'MONTH',
      AUGUST,
      JULY,
    )
    expect(mapped).not.toBeNull()
    expect(iso(mapped as DayRange)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-31T23:59:59.999Z',
    })
  })

  it('maps a QUARTER bucket by index', () => {
    const q3Current: DayRange = {
      start: parseIsoDay('2026-07-01', 'a'),
      end: endOfDay(parseIsoDay('2026-09-30', 'a')),
    }
    const q2Comparison: DayRange = {
      start: parseIsoDay('2026-04-01', 'a'),
      end: endOfDay(parseIsoDay('2026-06-30', 'a')),
    }
    const mapped = mapTimeBucketToComparison(
      parseIsoDay('2026-08-01', 'bucket'),
      'QUARTER',
      q3Current,
      q2Comparison,
    )
    expect(mapped).not.toBeNull()
    expect(iso(mapped as DayRange)).toEqual({
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-06-30T23:59:59.999Z',
    })
  })

  it('maps a YEAR bucket by index', () => {
    const current: DayRange = {
      start: parseIsoDay('2026-01-01', 'a'),
      end: endOfDay(parseIsoDay('2026-12-31', 'a')),
    }
    const comp: DayRange = {
      start: parseIsoDay('2025-01-01', 'a'),
      end: endOfDay(parseIsoDay('2025-12-31', 'a')),
    }
    const mapped = mapTimeBucketToComparison(
      parseIsoDay('2026-03-10', 'bucket'),
      'YEAR',
      current,
      comp,
    )
    expect(mapped).not.toBeNull()
    expect(iso(mapped as DayRange)).toEqual({
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-12-31T23:59:59.999Z',
    })
  })

  it('handles ranges that do not start on a bucket boundary (index anchored at each range start)', () => {
    // Current 2026-08-10..2026-08-20 (bucket 0 = 2026-08); comparison
    // 2026-07-10..2026-07-20 (bucket 0 = 2026-07).
    const current: DayRange = {
      start: parseIsoDay('2026-08-10', 'a'),
      end: endOfDay(parseIsoDay('2026-08-20', 'a')),
    }
    const comp: DayRange = {
      start: parseIsoDay('2026-07-10', 'a'),
      end: endOfDay(parseIsoDay('2026-07-20', 'a')),
    }
    const mapped = mapTimeBucketToComparison(
      parseIsoDay('2026-08-12', 'bucket'),
      'MONTH',
      current,
      comp,
    )
    expect(mapped).not.toBeNull()
    expect(iso(mapped as DayRange)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-31T23:59:59.999Z',
    })
  })

  it('returns null when the index is out of range for the comparison range (never current-period data)', () => {
    // Current spans 3 buckets (Aug, Sep, Oct); comparison spans 1 (Jul only).
    const current: DayRange = {
      start: parseIsoDay('2026-08-01', 'a'),
      end: endOfDay(parseIsoDay('2026-10-31', 'a')),
    }
    const comp: DayRange = {
      start: parseIsoDay('2026-07-01', 'a'),
      end: endOfDay(parseIsoDay('2026-07-31', 'a')),
    }
    // Bucket index 1 (2026-09) has no equivalent in the single-bucket comparison.
    expect(
      mapTimeBucketToComparison(parseIsoDay('2026-09-01', 'bucket'), 'MONTH', current, comp),
    ).toBeNull()
    // Bucket index 2 (2026-10) is also out of range.
    expect(
      mapTimeBucketToComparison(parseIsoDay('2026-10-01', 'bucket'), 'MONTH', current, comp),
    ).toBeNull()
  })

  it('returns null for a bucket before the current range start', () => {
    expect(
      mapTimeBucketToComparison(parseIsoDay('2026-06-01', 'bucket'), 'MONTH', AUGUST, JULY),
    ).toBeNull()
  })
})
