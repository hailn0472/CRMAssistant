import {
  WIDGET_TYPES,
  WIDGET_SIZES,
  WIDGET_SOURCES,
  isWidgetType,
  isWidgetSize,
  isWidgetSource,
  assertValidWidgetType,
  assertValidWidgetSize,
  assertValidWidgetSource,
  assertTypeMatchesSource,
  normalizeWidgetTitle,
  MAX_WIDGET_TITLE_LENGTH,
  MAX_WIDGETS_PER_DASHBOARD,
  MAX_DASHBOARDS_PER_USER,
  MAX_LIST_WIDGET_ROWS,
  MAX_CHART_POINTS,
  resolveWidgetSpan,
} from '../widget-types'

describe('widget-types', () => {
  // ─── AC 11 ──────────────────────────────────────────────────────
  describe('WIDGET_TYPES', () => {
    it('contains exactly eight members', () => {
      expect(WIDGET_TYPES).toEqual([
        'METRIC_CARD',
        'LINE_CHART',
        'BAR_CHART',
        'PIE_CHART',
        'TABLE',
        'FUNNEL',
        'ACTIVITY_FEED',
        'TASK_LIST',
      ])
    })
  })

  // ─── AC 12 ──────────────────────────────────────────────────────
  describe('WIDGET_SIZES', () => {
    it('contains exactly four members', () => {
      expect(WIDGET_SIZES).toEqual(['1x1', '2x1', '2x2', '3x2'])
    })
  })

  // ─── AC 13 ──────────────────────────────────────────────────────
  describe('WIDGET_SOURCES', () => {
    it('has five lead-management entries', () => {
      expect(Object.keys(WIDGET_SOURCES)).toHaveLength(5)
    })

    it('each entry carries permission, allowedTypes, defaultTitle', () => {
      for (const source of Object.keys(WIDGET_SOURCES)) {
        const entry = WIDGET_SOURCES[source as keyof typeof WIDGET_SOURCES]
        expect(entry.permission).toBeDefined()
        expect(entry.permission.resource).toBeTruthy()
        expect(entry.permission.action).toBe('READ')
        expect(Array.isArray(entry.allowedTypes)).toBe(true)
        expect(entry.allowedTypes.length).toBeGreaterThan(0)
        expect(typeof entry.defaultTitle).toBe('string')
        expect(entry.defaultTitle.length).toBeGreaterThan(0)
      }
    })
  })

  // ─── AC 14 ──────────────────────────────────────────────────────
  describe('isWidgetType', () => {
    it('returns true for every known type', () => {
      for (const type of WIDGET_TYPES) {
        expect(isWidgetType(type)).toBe(true)
      }
    })

    it('returns false for an unknown string', () => {
      expect(isWidgetType('UNKNOWN')).toBe(false)
    })
  })

  describe('isWidgetSize', () => {
    it('returns true for every known size', () => {
      for (const size of WIDGET_SIZES) {
        expect(isWidgetSize(size)).toBe(true)
      }
    })

    it('returns false for an unknown size', () => {
      expect(isWidgetSize('4x4')).toBe(false)
    })
  })

  describe('isWidgetSource', () => {
    it('returns true for every known source', () => {
      for (const source of Object.keys(WIDGET_SOURCES)) {
        expect(isWidgetSource(source)).toBe(true)
      }
    })

    it('returns false for an unknown source', () => {
      expect(isWidgetSource('UNKNOWN_SOURCE')).toBe(false)
    })
  })

  describe('assertValidWidgetType', () => {
    it('does not throw for valid types', () => {
      for (const type of WIDGET_TYPES) {
        expect(() => assertValidWidgetType(type)).not.toThrow()
      }
    })

    it('throws for an invalid type', () => {
      expect(() => assertValidWidgetType('INVALID')).toThrow('Invalid widget type')
    })
  })

  describe('assertValidWidgetSize', () => {
    it('does not throw for valid sizes', () => {
      for (const size of WIDGET_SIZES) {
        expect(() => assertValidWidgetSize(size)).not.toThrow()
      }
    })

    it('throws for an invalid size', () => {
      expect(() => assertValidWidgetSize('9x9')).toThrow('Invalid widget size')
    })
  })

  describe('assertValidWidgetSource', () => {
    it('does not throw for valid sources', () => {
      for (const source of Object.keys(WIDGET_SOURCES)) {
        expect(() => assertValidWidgetSource(source)).not.toThrow()
      }
    })

    it('throws for an invalid source', () => {
      expect(() => assertValidWidgetSource('MADE_UP')).toThrow('Invalid widget source')
    })
  })

  // ─── AC 15 ──────────────────────────────────────────────────────
  describe('assertTypeMatchesSource', () => {
    it('throws for PIE_CHART over MY_TASKS', () => {
      expect(() => assertTypeMatchesSource('PIE_CHART', 'MY_TASKS')).toThrow(
        'Widget type PIE_CHART cannot render source MY_TASKS',
      )
    })

    it('succeeds for all valid pairs in WIDGET_SOURCES', () => {
      for (const [source, entry] of Object.entries(WIDGET_SOURCES)) {
        for (const type of entry.allowedTypes) {
          expect(() =>
            assertTypeMatchesSource(type, source as keyof typeof WIDGET_SOURCES),
          ).not.toThrow()
        }
      }
    })
  })

  // ─── AC 16 ──────────────────────────────────────────────────────
  describe('normalizeWidgetTitle', () => {
    it('trims whitespace', () => {
      expect(normalizeWidgetTitle('  hello  ')).toBe('hello')
    })

    it('collapses internal whitespace', () => {
      expect(normalizeWidgetTitle('hello   world')).toBe('hello world')
    })

    it('throws on empty string', () => {
      expect(() => normalizeWidgetTitle('')).toThrow('Widget title must not be empty')
    })

    it('throws on whitespace-only', () => {
      expect(() => normalizeWidgetTitle('   ')).toThrow('Widget title must not be empty')
    })

    it('throws on string exceeding MAX_WIDGET_TITLE_LENGTH', () => {
      const tooLong = 'x'.repeat(MAX_WIDGET_TITLE_LENGTH + 1)
      expect(() => normalizeWidgetTitle(tooLong)).toThrow(
        `Widget title must not exceed ${MAX_WIDGET_TITLE_LENGTH} characters`,
      )
    })

    it('accepts string at exactly MAX_WIDGET_TITLE_LENGTH', () => {
      const atMax = 'x'.repeat(MAX_WIDGET_TITLE_LENGTH)
      expect(normalizeWidgetTitle(atMax)).toBe(atMax)
    })
  })

  // ─── AC 17 ──────────────────────────────────────────────────────
  describe('constants', () => {
    it('MAX_WIDGETS_PER_DASHBOARD = 12', () => {
      expect(MAX_WIDGETS_PER_DASHBOARD).toBe(12)
    })

    it('MAX_DASHBOARDS_PER_USER = 10', () => {
      expect(MAX_DASHBOARDS_PER_USER).toBe(10)
    })

    it('MAX_LIST_WIDGET_ROWS = 5', () => {
      expect(MAX_LIST_WIDGET_ROWS).toBe(5)
    })

    it('MAX_CHART_POINTS = 24', () => {
      expect(MAX_CHART_POINTS).toBe(24)
    })
  })

  // ─── AC 18 ──────────────────────────────────────────────────────
  describe('resolveWidgetSpan', () => {
    it.each([
      ['1x1', 4, { colSpan: 1, rowSpan: 1 }],
      ['2x1', 4, { colSpan: 2, rowSpan: 1 }],
      ['2x2', 4, { colSpan: 2, rowSpan: 2 }],
      ['3x2', 4, { colSpan: 3, rowSpan: 2 }],
      ['1x1', 2, { colSpan: 1, rowSpan: 1 }],
      ['2x1', 2, { colSpan: 2, rowSpan: 1 }],
      ['2x2', 2, { colSpan: 2, rowSpan: 2 }],
      ['3x2', 2, { colSpan: 2, rowSpan: 2 }],
      ['1x1', 1, { colSpan: 1, rowSpan: 1 }],
      ['2x1', 1, { colSpan: 1, rowSpan: 1 }],
      ['2x2', 1, { colSpan: 1, rowSpan: 2 }],
      ['3x2', 1, { colSpan: 1, rowSpan: 2 }],
    ])('%s with %d columns → %p', (size, columns, expected) => {
      expect(resolveWidgetSpan(size as never, columns)).toEqual(expected)
    })

    it('colSpan never exceeds columns', () => {
      for (const size of WIDGET_SIZES) {
        for (const columns of [1, 2, 4]) {
          const { colSpan } = resolveWidgetSpan(size, columns)
          expect(colSpan).toBeLessThanOrEqual(columns)
        }
      }
    })
  })
})
