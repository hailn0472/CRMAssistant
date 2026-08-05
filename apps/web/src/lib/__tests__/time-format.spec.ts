import {
  TIME_CHART_COLORS,
  TIME_OTHER_COLOR,
  elapsedSeconds,
  formatDurationShort,
  formatDurationTick,
  formatElapsed,
} from '../time-format'

describe('formatElapsed', () => {
  it.each([
    [0, '0:00:00'],
    [59, '0:00:59'],
    [60, '0:01:00'],
    [3599, '0:59:59'],
    [3600, '1:00:00'],
    [86399, '23:59:59'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(formatElapsed(input as number)).toBe(expected)
  })

  it.each([-1, -3600])('clamps negative inputs to 0:00:00 (%s)', (input) => {
    expect(formatElapsed(input as number)).toBe('0:00:00')
  })
})

describe('formatDurationShort', () => {
  it.each([
    [30, '30s'],
    [2700, '45m'],
    [3600, '1h 0m'],
    [3661, '1h 1m'],
    [5400, '1h 30m'],
    [7200, '2h 0m'],
    [3599, '1h 0m'],
    [10799, '3h 0m'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(formatDurationShort(input as number)).toBe(expected)
  })

  it.each([0, -5])('renders the em-dash null convention for %s', (input) => {
    expect(formatDurationShort(input as number)).toBe('—')
  })

  it('renders the em-dash for NaN', () => {
    expect(formatDurationShort(NaN)).toBe('—')
  })
})

describe('formatDurationTick', () => {
  it.each([
    [0, '0h'],
    [1800, '0.5h'],
    [3600, '1h'],
    [5400, '1.5h'],
    [28800, '8h'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(formatDurationTick(input as number)).toBe(expected)
  })
})

describe('elapsedSeconds', () => {
  const startIso = '2026-01-01T10:00:00.000Z'

  it('is pure — no timers needed', () => {
    const nowMs = new Date('2026-01-01T10:00:30.000Z').getTime()
    expect(elapsedSeconds(startIso, nowMs)).toBe(30)
  })

  it('computes a 5-minute interval', () => {
    const nowMs = new Date('2026-01-01T10:05:00.000Z').getTime()
    expect(elapsedSeconds(startIso, nowMs)).toBe(300)
  })

  it('clamps a clock slightly behind the start to 0', () => {
    const nowMs = new Date('2026-01-01T09:59:59.000Z').getTime()
    expect(elapsedSeconds(startIso, nowMs)).toBe(0)
  })
})

describe('TIME_CHART_COLORS', () => {
  it('is a 6-entry categorical palette starting with the primary house hex', () => {
    expect(TIME_CHART_COLORS).toHaveLength(6)
    expect(TIME_CHART_COLORS[0]).toBe('#4f46e5')
  })

  it('contains no violet — violet is reserved for AI surfaces', () => {
    const violet = ['#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6']
    for (const color of TIME_CHART_COLORS) {
      expect(violet).not.toContain(color)
    }
  })

  it('reserves the grey Other colour outside the palette', () => {
    expect(TIME_OTHER_COLOR).toBe('#a0a0aa')
    expect(TIME_CHART_COLORS).not.toContain(TIME_OTHER_COLOR)
  })
})
