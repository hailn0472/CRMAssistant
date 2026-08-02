import { findCalendarConflict, overlaps } from '../calendar-conflict'
import type { CalendarBusySlot } from '../calendar-provider.types'

// Pure overlap matrix (AC 27). Adjacency (touching boundaries) must NOT count
// as a conflict; our own event must be excluded by externalEventId.

function slot(
  start: string,
  end: string,
  externalEventId?: string | null,
  title?: string | null,
): CalendarBusySlot {
  return {
    start: new Date(start),
    end: new Date(end),
    externalEventId: externalEventId ?? null,
    title: title ?? null,
  }
}

const WINDOW_START = new Date('2026-08-05T09:00:00.000Z')
const WINDOW_END = new Date('2026-08-05T09:30:00.000Z')

describe('overlaps (half-open interval semantics)', () => {
  it('returns true for a partial head overlap', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T08:45:00.000Z'),
        new Date('2026-08-05T09:15:00.000Z'),
      ),
    ).toBe(true)
  })

  it('returns true for a partial tail overlap', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T09:15:00.000Z'),
        new Date('2026-08-05T09:45:00.000Z'),
      ),
    ).toBe(true)
  })

  it('returns true for containment (busy event fully inside the window)', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T09:05:00.000Z'),
        new Date('2026-08-05T09:10:00.000Z'),
      ),
    ).toBe(true)
  })

  it('returns true for exact match', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T09:00:00.000Z'),
        new Date('2026-08-05T09:30:00.000Z'),
      ),
    ).toBe(true)
  })

  it('returns false when the busy event ends exactly at the window start (adjacency)', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T08:30:00.000Z'),
        new Date('2026-08-05T09:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('returns false when the busy event starts exactly at the window end (adjacency)', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T09:30:00.000Z'),
        new Date('2026-08-05T10:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('returns false for no overlap at all', () => {
    expect(
      overlaps(
        WINDOW_START,
        WINDOW_END,
        new Date('2026-08-05T11:00:00.000Z'),
        new Date('2026-08-05T12:00:00.000Z'),
      ),
    ).toBe(false)
  })
})

describe('findCalendarConflict', () => {
  it('returns no conflict when the window is free', () => {
    expect(findCalendarConflict([], WINDOW_START, WINDOW_END)).toEqual({
      conflict: false,
      summary: null,
    })
  })

  it('returns a conflict with a human-readable summary for an overlapping titled event', () => {
    const result = findCalendarConflict(
      [slot('2026-08-05T09:10:00.000Z', '2026-08-05T09:40:00.000Z', 'evt-other', 'Standup')],
      WINDOW_START,
      WINDOW_END,
    )
    expect(result.conflict).toBe(true)
    expect(result.summary).toMatch(/Overlaps "Standup" \(09:10–09:40\)/)
  })

  it('falls back to a generic label when the occupying event has no title', () => {
    const result = findCalendarConflict(
      [slot('2026-08-05T09:10:00.000Z', '2026-08-05T09:40:00.000Z')],
      WINDOW_START,
      WINDOW_END,
    )
    expect(result.conflict).toBe(true)
    expect(result.summary).toMatch(/Overlaps an existing event \(09:10–09:40\)/)
  })

  it('does not flag a conflict for an adjacent (touching) event', () => {
    const result = findCalendarConflict(
      [slot('2026-08-05T08:00:00.000Z', '2026-08-05T09:00:00.000Z', 'evt-prev', 'Morning block')],
      WINDOW_START,
      WINDOW_END,
    )
    expect(result.conflict).toBe(false)
    expect(result.summary).toBeNull()
  })

  it('excludes our own event by externalEventId (self-exclusion)', () => {
    const result = findCalendarConflict(
      [slot('2026-08-05T09:10:00.000Z', '2026-08-05T09:40:00.000Z', 'our-event-1', 'Our task')],
      WINDOW_START,
      WINDOW_END,
      'our-event-1',
    )
    expect(result.conflict).toBe(false)
    expect(result.summary).toBeNull()
  })

  it('reports the FIRST overlapping slot only', () => {
    const result = findCalendarConflict(
      [
        slot('2026-08-05T08:00:00.000Z', '2026-08-05T09:10:00.000Z', 'evt-1', 'First'),
        slot('2026-08-05T09:20:00.000Z', '2026-08-05T09:50:00.000Z', 'evt-2', 'Second'),
      ],
      WINDOW_START,
      WINDOW_END,
    )
    expect(result.conflict).toBe(true)
    expect(result.summary).toContain('"First"')
  })
})
