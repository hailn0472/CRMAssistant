import {
  WIDGET_TYPES,
  WIDGET_SIZES,
  WIDGET_SOURCES,
  WIDGET_SOURCE_PERMISSIONS,
  WIDGET_SOURCE_DESCRIPTIONS,
  WIDGET_SERIES_COLORS,
  resolveWidgetSpan,
  formatWidgetMetric,
  trendLabel,
  resolveWidgetReorder,
} from '../widget-format'
import { TIME_CHART_COLORS } from '@/lib/time-format'

describe('widget-format', () => {
  describe('label maps', () => {
    it('maps every widget type to a human label', () => {
      expect(WIDGET_TYPES.METRIC_CARD).toBe('Metric Card')
      expect(WIDGET_TYPES.LINE_CHART).toBe('Line Chart')
      expect(WIDGET_TYPES.BAR_CHART).toBe('Bar Chart')
      expect(WIDGET_TYPES.PIE_CHART).toBe('Pie Chart')
      expect(WIDGET_TYPES.TABLE).toBe('Table')
      expect(WIDGET_TYPES.FUNNEL).toBe('Funnel')
      expect(WIDGET_TYPES.ACTIVITY_FEED).toBe('Activity Feed')
      expect(WIDGET_TYPES.TASK_LIST).toBe('Task List')
    })

    it('maps every widget size to a human label', () => {
      expect(WIDGET_SIZES['1x1']).toBe('Small (1×1)')
      expect(WIDGET_SIZES['2x1']).toBe('Wide (2×1)')
      expect(WIDGET_SIZES['2x2']).toBe('Medium (2×2)')
      expect(WIDGET_SIZES['3x2']).toBe('Large (3×2)')
    })

    it('maps every widget source to a human label', () => {
      expect(WIDGET_SOURCES.PIPELINE_BY_STAGE).toBe('Pipeline by Stage')
      expect(WIDGET_SOURCES.SALES_FORECAST).toBe('Sales Forecast')
      expect(WIDGET_SOURCES.CONTACT_COUNT).toBe('Contact Count')
    })
  })

  describe('source metadata (AC 13 / AC 79)', () => {
    it('declares a permission for every source', () => {
      for (const source of Object.keys(WIDGET_SOURCES)) {
        expect(WIDGET_SOURCE_PERMISSIONS[source]).toBeDefined()
        expect(WIDGET_SOURCE_PERMISSIONS[source].resource).toBeTruthy()
        expect(WIDGET_SOURCE_PERMISSIONS[source].action).toBe('READ')
      }
    })

    it('declares a description for every source', () => {
      for (const source of Object.keys(WIDGET_SOURCES)) {
        expect(WIDGET_SOURCE_DESCRIPTIONS[source]).toBeTruthy()
      }
    })
  })

  describe('WIDGET_SERIES_COLORS (AC 61 — no violet)', () => {
    it('reuses TIME_CHART_COLORS', () => {
      expect(WIDGET_SERIES_COLORS).toEqual([...TIME_CHART_COLORS])
    })

    it('contains no violet/purple hues', () => {
      for (const color of WIDGET_SERIES_COLORS) {
        expect(color).not.toMatch(/^(#8b5cf6|#a855f7|#7c3aed|#6d28d9|#9333ea)$/i)
      }
    })
  })

  describe('resolveWidgetSpan', () => {
    it('returns 1x1 for size 1x1', () => {
      expect(resolveWidgetSpan('1x1', 4)).toEqual({
        colSpan: 1,
        rowSpan: 1,
        className: 'col-span-1 row-span-1',
      })
    })

    it('returns 2x1 for size 2x1', () => {
      expect(resolveWidgetSpan('2x1', 4)).toEqual({
        colSpan: 2,
        rowSpan: 1,
        className: 'col-span-2 row-span-1',
      })
    })

    it('returns 2x2 for size 2x2', () => {
      expect(resolveWidgetSpan('2x2', 4)).toEqual({
        colSpan: 2,
        rowSpan: 2,
        className: 'col-span-2 row-span-2',
      })
    })

    it('returns 3x2 for size 3x2', () => {
      expect(resolveWidgetSpan('3x2', 4)).toEqual({
        colSpan: 3,
        rowSpan: 2,
        className: 'col-span-3 row-span-2',
      })
    })

    it('clamps colSpan to the number of columns', () => {
      expect(resolveWidgetSpan('3x2', 2).colSpan).toBe(2)
      expect(resolveWidgetSpan('3x2', 2).className).toBe('col-span-2 row-span-2')
      expect(resolveWidgetSpan('3x2', 1).colSpan).toBe(1)
      expect(resolveWidgetSpan('2x2', 1).colSpan).toBe(1)
    })

    it('falls back to 1x1 for an unknown size', () => {
      expect(resolveWidgetSpan('9x9', 4)).toEqual({
        colSpan: 1,
        rowSpan: 1,
        className: 'col-span-1 row-span-1',
      })
    })
  })

  describe('formatWidgetMetric', () => {
    it('formats a percentage metric', () => {
      expect(formatWidgetMetric({ value: 62, label: 'Win rate', unit: '%' }, 'USD')).toBe('62%')
    })

    it('formats an hours metric', () => {
      expect(formatWidgetMetric({ value: 24, label: 'Time tracked', unit: 'hrs' }, 'USD')).toBe(
        'Time tracked: 24 hrs',
      )
    })

    it('formats a plain metric', () => {
      expect(formatWidgetMetric({ value: 42, label: 'Open tasks', unit: null }, 'USD')).toBe(
        'Open tasks: 42',
      )
    })

    it('prefixes $ for a USD metric', () => {
      expect(formatWidgetMetric({ value: 1500, label: 'Pipeline Value', unit: 'USD' }, 'USD')).toBe(
        'Pipeline Value: $1500',
      )
    })

    it('uses the currency symbol for a USD metric', () => {
      expect(formatWidgetMetric({ value: 1500, label: 'Pipeline Value', unit: 'USD' }, 'EUR')).toBe(
        'Pipeline Value: €1500',
      )
    })
  })

  describe('trendLabel', () => {
    it('returns empty for null direction', () => {
      expect(trendLabel(null, 5)).toBe('')
      expect(trendLabel('UP', null)).toBe('')
    })

    it('formats an upward trend', () => {
      expect(trendLabel('UP', 12)).toBe('12% increase')
    })

    it('formats a downward trend', () => {
      expect(trendLabel('DOWN', 8)).toBe('8% decrease')
    })

    it('formats a flat trend', () => {
      expect(trendLabel('FLAT', 0)).toBe('No change')
    })
  })

  describe('resolveWidgetReorder', () => {
    const ids = ['a', 'b', 'c', 'd']

    it('moves a widget down', () => {
      expect(resolveWidgetReorder(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    })

    it('moves a widget up', () => {
      expect(resolveWidgetReorder(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    })

    it('returns the same list when active equals over', () => {
      expect(resolveWidgetReorder(ids, 'b', 'b')).toEqual(ids)
    })

    it('returns the same list when an id is not found', () => {
      expect(resolveWidgetReorder(ids, 'x', 'b')).toEqual(ids)
      expect(resolveWidgetReorder(ids, 'b', 'x')).toEqual(ids)
    })
  })
})
