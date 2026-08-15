/**
 * Story 6.2 — pure formatting helpers (AC 71) and templates (AC 66).
 */
import {
  formatMoney,
  formatPercent,
  formatCount,
  formatDays,
  formatDate,
  changePresentation,
  chartSeries,
  REPORT_TYPE_TEMPLATES,
  defaultTemplateFor,
} from '../sales-report-format'
import type { ReportMetric } from '@/services/sales-report.service'

function metric(overrides: Partial<ReportMetric>): ReportMetric {
  return {
    key: 'WON_DEALS',
    label: 'Won deals',
    value: 10,
    unit: 'COUNT',
    comparisonValue: 5,
    percentageChange: 100,
    direction: 'UP',
    displayToken: 'NONE',
    ...overrides,
  }
}

describe('sales-report-format (AC 71)', () => {
  describe('formatMoney', () => {
    it('formats with the currency', () => {
      expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50')
    })
    it('falls back to USD when currency is null', () => {
      expect(formatMoney(10, null)).toContain('10.00')
    })
    it('returns an em dash for null values', () => {
      expect(formatMoney(null, 'USD')).toBe('—')
    })
    it('does not crash on unknown currency codes', () => {
      expect(formatMoney(5, 'NOPE!')).toBe('NOPE! 5.00')
    })
  })

  it('formatPercent / formatCount / formatDays / formatDate handle nulls', () => {
    expect(formatPercent(12.34)).toBe('12.3%')
    expect(formatPercent(null)).toBe('—')
    expect(formatCount(1200)).toBe('1,200')
    expect(formatCount(null)).toBe('—')
    expect(formatDays(41.5)).toBe('41.5 days')
    expect(formatDays(null)).toBe('—')
    expect(formatDate('2026-08-15T00:00:00.000Z')).toBe('2026-08-15')
    expect(formatDate(null)).toBe('—')
  })

  describe('changePresentation (AC 25, 71)', () => {
    it('renders Up/Down/No change/New labels with icons', () => {
      expect(changePresentation(metric({ direction: 'UP', percentageChange: 12.3 }))).toEqual({
        label: 'Up 12.3%',
        icon: 'up',
      })
      expect(changePresentation(metric({ direction: 'DOWN', percentageChange: 4 }))).toEqual({
        label: 'Down 4.0%',
        icon: 'down',
      })
      expect(changePresentation(metric({ direction: 'FLAT', percentageChange: 0 }))).toEqual({
        label: 'No change',
        icon: 'flat',
      })
      expect(
        changePresentation(
          metric({ displayToken: 'NEW', direction: 'UP', percentageChange: null }),
        ),
      ).toEqual({
        label: 'New',
        icon: 'new',
      })
    })

    it('returns a plain dash when there is no comparison', () => {
      expect(
        changePresentation(
          metric({ direction: null, percentageChange: null, displayToken: 'NONE' }),
        ),
      ).toEqual({ label: '—', icon: 'none' })
    })
  })

  describe('chartSeries', () => {
    it('uses the value when present and falls back to count', () => {
      const series = chartSeries(
        [
          { key: '2026-08', label: 'Aug 2026', value: 1000, count: 3 },
          { key: '2026-09', label: 'Sep 2026', value: null, count: 7 },
        ],
        'USD',
      )
      expect(series[0]).toMatchObject({ key: '2026-08', value: 1000, count: 3 })
      expect(series[1]).toMatchObject({ key: '2026-09', value: 7, count: 7 })
      expect(series[0].formatted).toContain('$1,000')
      expect(series[1].formatted).toBe('7')
    })
  })

  describe('templates (AC 66)', () => {
    it('provides six templates with stable configs', () => {
      expect(REPORT_TYPE_TEMPLATES).toHaveLength(6)
      expect(REPORT_TYPE_TEMPLATES[0].type).toBe('SALES_OVERVIEW')
      expect(REPORT_TYPE_TEMPLATES[0].config.comparisonMode).toBe('PREVIOUS_PERIOD')
    })

    it('defaultTemplateFor returns a fresh config per type', () => {
      const team = defaultTemplateFor('TEAM_PERFORMANCE')
      expect(team.groupBy).toBe('OWNER')
      team.groupBy = 'MONTH'
      expect(defaultTemplateFor('TEAM_PERFORMANCE').groupBy).toBe('OWNER')
    })
  })
})
