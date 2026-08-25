/**
 * Unit tests for pure activity report helper functions (Story 6.8).
 */

import {
  formatCompletionRate,
  formatDurationHours,
  formatDurationSeconds,
  validateActivityReportFilterRange,
  buildHeatmapMatrix,
  buildActivityTrendChartData,
  getHeatmapCellColor,
  DAY_NAMES,
  DAY_NAMES_VI,
} from '../activity-report'
import type { ActivityHeatmapCell } from '@/services/activity-report.service'

describe('activity-report lib', () => {
  describe('formatCompletionRate', () => {
    it('formats rate as percentage with 1 decimal place', () => {
      expect(formatCompletionRate(0.854)).toBe('85.4%')
      expect(formatCompletionRate(1)).toBe('100.0%')
      expect(formatCompletionRate(0)).toBe('0.0%')
    })
  })

  describe('formatDurationHours', () => {
    it('formats hours nicely', () => {
      expect(formatDurationHours(0)).toBe('0.0h')
      expect(formatDurationHours(4.25)).toBe('4.3h')
      expect(formatDurationHours(24)).toBe('24.0h')
    })
  })

  describe('formatDurationSeconds', () => {
    it('formats seconds into human readable duration', () => {
      expect(formatDurationSeconds(0)).toBe('0s')
      expect(formatDurationSeconds(45)).toBe('45s')
      expect(formatDurationSeconds(120)).toBe('2m')
      expect(formatDurationSeconds(3660)).toBe('1h 1m')
      expect(formatDurationSeconds(3665)).toBe('1h 1m')
      expect(formatDurationSeconds(7200)).toBe('2h')
      expect(formatDurationSeconds(7245)).toBe('2h')
    })
  })

  describe('validateActivityReportFilterRange', () => {
    it('returns null for valid date range', () => {
      expect(
        validateActivityReportFilterRange({
          startDate: '2026-08-01',
          endDate: '2026-08-22',
        }),
      ).toBeNull()
    })

    it('returns error when startDate or endDate is missing', () => {
      expect(
        validateActivityReportFilterRange({
          startDate: '',
          endDate: '2026-08-22',
        }),
      ).toBe('Start date and end date are required.')

      expect(
        validateActivityReportFilterRange({
          startDate: '2026-08-01',
          endDate: '',
        }),
      ).toBe('Start date and end date are required.')
    })

    it('returns error when endDate is earlier than startDate', () => {
      expect(
        validateActivityReportFilterRange({
          startDate: '2026-08-22',
          endDate: '2026-08-01',
        }),
      ).toBe('End date must be greater than or equal to start date.')
    })

    it('returns error when range exceeds 366 days', () => {
      expect(
        validateActivityReportFilterRange({
          startDate: '2025-01-01',
          endDate: '2026-01-05',
        }),
      ).toBe('Date range cannot exceed 366 days.')
    })
  })

  describe('buildHeatmapMatrix', () => {
    it('transforms 168 flat cells into a 7 x 24 matrix', () => {
      const cells: ActivityHeatmapCell[] = []
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          cells.push({ dayOfWeek: day, hour, count: day === 1 && hour === 9 ? 10 : 0 })
        }
      }

      const matrix = buildHeatmapMatrix(cells)
      expect(matrix).toHaveLength(7)
      expect(matrix[0]).toHaveLength(24)
      expect(matrix[1][9].count).toBe(10)
      expect(matrix[1][9].dayOfWeek).toBe(1)
      expect(matrix[1][9].hour).toBe(9)
      expect(matrix[0][0].count).toBe(0)
    })

    it('handles empty or incomplete cells array safely by zero-filling', () => {
      const matrix = buildHeatmapMatrix([])
      expect(matrix).toHaveLength(7)
      expect(matrix[0]).toHaveLength(24)
      expect(matrix[0][0].count).toBe(0)
    })
  })

  describe('buildActivityTrendChartData', () => {
    it('constructs NormalizedLineChart from trend points', () => {
      const trend = [
        { bucketStart: '2026-08-01', count: 10 },
        { bucketStart: '2026-08-02', count: 20 },
      ]
      const chart = buildActivityTrendChartData(trend)
      expect(chart.type).toBe('LINE')
      expect(chart.title).toBe('Activity Trend')
      expect(chart.totalPoints).toBe(2)
      expect(chart.points).toHaveLength(2)
      expect(chart.points[0].values.activities).toBe(10)
      expect(chart.srTable.rows).toHaveLength(2)
    })
  })

  describe('getHeatmapCellColor', () => {
    it('returns correct color intensity based on count and maxCount', () => {
      expect(getHeatmapCellColor(0, 10)).toBe('bg-slate-100 text-slate-400')
      expect(getHeatmapCellColor(1, 10)).toBe('bg-emerald-100 text-emerald-800')
      expect(getHeatmapCellColor(4, 10)).toBe('bg-emerald-300 text-emerald-900')
      expect(getHeatmapCellColor(7, 10)).toBe('bg-emerald-500 text-white')
      expect(getHeatmapCellColor(10, 10)).toBe('bg-emerald-700 text-white')
    })
  })

  describe('DAY_NAMES constants', () => {
    it('provides 7 day names starting from Sunday', () => {
      expect(DAY_NAMES).toHaveLength(7)
      expect(DAY_NAMES[0]).toBe('Sun')
      expect(DAY_NAMES[6]).toBe('Sat')
      expect(DAY_NAMES_VI).toHaveLength(7)
      expect(DAY_NAMES_VI[0]).toBe('CN')
    })
  })
})
