/**
 * Story 6.7 — Pure helper tests for lib/customer-analytics.ts
 */
import {
  formatCustomerLtv,
  formatRiskScore,
  getChurnRiskBadgeDetails,
  validateAnalyticsFilterRange,
  buildLtvDistributionChartData,
  buildChurnDistributionChartData,
  buildLtvTrendChartData,
  buildCohortChartData,
} from '../customer-analytics'
import type { CustomerAnalyticsResult } from '@/services/customer-analytics.service'

const SAMPLE_DATA: CustomerAnalyticsResult = {
  summary: {
    totalLifetimeValue: 1845600,
    averageLifetimeValue: 12997,
    customerCount: 150,
    calculatedCustomerCount: 142,
    highLtvThreshold: 24500,
    latestCalculatedAt: '2026-08-19T02:00:00.000Z',
    mixedCurrencies: false,
    currencyBreakdown: [{ currency: 'USD', value: 1845600 }],
  },
  ltvDistribution: [
    { label: '$0 - $5k', min: 0, max: 5000, count: 48 },
    { label: '$5k - $15k', min: 5000, max: 15000, count: 38 },
  ],
  churnRiskDistribution: [
    { risk: 'LOW', count: 84, percentage: 59.2 },
    { risk: 'MEDIUM', count: 40, percentage: 28.1 },
    { risk: 'HIGH', count: 18, percentage: 12.7 },
  ],
  customers: {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  },
  ltvTrend: [
    {
      snapshotDate: '2026-05-21',
      totalLtv: 1120000,
      averageLtv: 10467,
      customerCount: 107,
    },
    {
      snapshotDate: '2026-08-19',
      totalLtv: 1845600,
      averageLtv: 12997,
      customerCount: 142,
    },
  ],
  cohorts: [
    {
      cohort: '2026-03',
      customerCount: 28,
      totalLtv: 599200,
      averageLtv: 21400,
    },
    {
      cohort: '2026-04',
      customerCount: 32,
      totalLtv: 537600,
      averageLtv: 16800,
    },
  ],
}

describe('lib/customer-analytics format & transforms', () => {
  describe('formatCustomerLtv', () => {
    it('returns em dash for null or undefined LTV', () => {
      expect(formatCustomerLtv(null)).toBe('—')
      expect(formatCustomerLtv(undefined)).toBe('—')
    })

    it('formats sole EUR currency with EUR/€ symbol', () => {
      const formatted = formatCustomerLtv(12500, false, 'EUR')
      expect(formatted).toContain('12,500')
      expect(formatted).toMatch(/€|EUR/)
      expect(formatted).not.toContain('$')
    })

    it('formats single currency values with currency symbol', () => {
      expect(formatCustomerLtv(12500, false, 'USD')).toBe('$12,500')
      expect(formatCustomerLtv(0, false, 'USD')).toBe('$0')
      // When currency is not provided, defaults to USD formatting or neutral fallback
    })

    it('formats mixed currency values with neutral number and no currency symbol', () => {
      const formatted = formatCustomerLtv(1845600, true)
      expect(formatted).toBe('1,845,600')
      expect(formatted).not.toContain('$')
      expect(formatted).not.toContain('₫')
      expect(formatted).not.toContain('€')
    })

    it('formats unknown/no breakdown neutral numeric when currency is null/undefined', () => {
      const formatted = formatCustomerLtv(1845600, false, null as unknown as string)
      expect(formatted).toBe('1,845,600')
      expect(formatted).not.toContain('$')
    })
  })

  describe('formatRiskScore', () => {
    it('returns em dash for null or undefined score', () => {
      expect(formatRiskScore(null)).toBe('—')
      expect(formatRiskScore(undefined)).toBe('—')
    })

    it('formats numeric scores to 1 decimal place', () => {
      expect(formatRiskScore(5.23)).toBe('5.2')
      expect(formatRiskScore(70.0)).toBe('70.0')
      expect(formatRiskScore(82.55)).toBe('82.6')
    })
  })

  describe('getChurnRiskBadgeDetails', () => {
    it('returns correct label and color classes for LOW risk', () => {
      const details = getChurnRiskBadgeDetails('LOW')
      expect(details.label).toBe('Low')
      expect(details.colorClass).toContain('emerald')
    })

    it('returns correct label and color classes for MEDIUM risk', () => {
      const details = getChurnRiskBadgeDetails('MEDIUM')
      expect(details.label).toBe('Medium')
      expect(details.colorClass).toContain('amber')
    })

    it('returns correct label and color classes for HIGH risk', () => {
      const details = getChurnRiskBadgeDetails('HIGH')
      expect(details.label).toBe('High')
      expect(details.colorClass).toContain('rose')
    })

    it('returns Not calculated for null or NOT_CALCULATED risk', () => {
      expect(getChurnRiskBadgeDetails(null).label).toBe('Not calculated')
      expect(getChurnRiskBadgeDetails('NOT_CALCULATED').label).toBe('Not calculated')
    })
  })

  describe('validateAnalyticsFilterRange', () => {
    it('returns null error when min <= max or one is null', () => {
      expect(validateAnalyticsFilterRange({ minLtv: 100, maxLtv: 200 })).toBeNull()
      expect(validateAnalyticsFilterRange({ minLtv: 100, maxLtv: null })).toBeNull()
      expect(validateAnalyticsFilterRange({ minLtv: null, maxLtv: 200 })).toBeNull()
      expect(
        validateAnalyticsFilterRange({ fromDate: '2026-01-01', toDate: '2026-02-01' }),
      ).toBeNull()
    })

    it('returns error string when minLtv or maxLtv is not a finite number', () => {
      expect(validateAnalyticsFilterRange({ minLtv: Number.POSITIVE_INFINITY })).toBe(
        'LTV must be a finite number.',
      )
      expect(validateAnalyticsFilterRange({ maxLtv: Number.NaN })).toBe(
        'LTV must be a finite number.',
      )
    })

    it('returns error string when minLtv > maxLtv', () => {
      const err = validateAnalyticsFilterRange({ minLtv: 500, maxLtv: 200 })
      expect(err).toBe('Min LTV cannot be greater than Max LTV.')
    })

    it('returns error string when fromDate > toDate', () => {
      const err = validateAnalyticsFilterRange({ fromDate: '2026-05-01', toDate: '2026-04-01' })
      expect(err).toBe('From date cannot be after To date.')
    })
  })

  describe('Chart Builders for ReportChart', () => {
    it('builds valid NormalizedBarChart for LTV distribution', () => {
      const chart = buildLtvDistributionChartData(SAMPLE_DATA.ltvDistribution)
      expect(chart.type).toBe('BAR')
      expect(chart.totalPoints).toBe(2)
      expect(chart.points[0].label).toBe('$0 - $5k')
      expect(chart.points[0].values['count']).toBe(48)
      expect(chart.srTable.headers).toEqual(['LTV Range', 'Customers'])
    })

    it('builds valid NormalizedPieChart for Churn Risk distribution', () => {
      const chart = buildChurnDistributionChartData(SAMPLE_DATA.churnRiskDistribution)
      expect(chart.type).toBe('PIE')
      expect(chart.isDonut).toBe(true)
      expect(chart.slices).toHaveLength(3)
      expect(chart.slices[0].label).toBe('LOW')
      expect(chart.slices[0].value).toBe(84)
      expect(chart.srTable.headers).toEqual(['Risk Level', 'Customers', 'Percentage'])
    })

    it('builds valid NormalizedLineChart for LTV Trend with currency formatting', () => {
      const chart = buildLtvTrendChartData(SAMPLE_DATA.ltvTrend, false, 'USD')
      expect(chart.type).toBe('LINE')
      expect(chart.totalPoints).toBe(2)
      expect(chart.points[0].label).toBe('2026-05-21')
      expect(chart.points[0].values['totalLtv']).toBe(1120000)
      expect(chart.points[0].values['averageLtv']).toBe(10467)
      expect(chart.srTable.headers).toEqual([
        'Snapshot Date',
        'Total LTV',
        'Average LTV',
        'Customer Count',
      ])
      expect(chart.srTable.rows[0][1]).toBe('$1,120,000')

      // Mixed currency trend chart has no $ or currency symbol
      const mixedChart = buildLtvTrendChartData(SAMPLE_DATA.ltvTrend, true)
      expect(mixedChart.srTable.rows[0][1]).toBe('1,120,000')
      expect(mixedChart.srTable.rows[0][1]).not.toContain('$')
    })

    it('builds valid NormalizedBarChart for Cohort analysis with currency formatting', () => {
      const chart = buildCohortChartData(SAMPLE_DATA.cohorts, false, 'USD')
      expect(chart.type).toBe('BAR')
      expect(chart.totalPoints).toBe(2)
      expect(chart.points[0].label).toBe('2026-03')
      expect(chart.points[0].values['totalLtv']).toBe(599200)
      expect(chart.points[0].values['averageLtv']).toBe(21400)
      expect(chart.srTable.headers).toEqual([
        'Acquisition Cohort',
        'Customer Count',
        'Total LTV',
        'Average LTV',
      ])
      expect(chart.srTable.rows[0][2]).toBe('$599,200')

      // Mixed currency cohort chart has no $ or currency symbol
      const mixedChart = buildCohortChartData(SAMPLE_DATA.cohorts, true)
      expect(mixedChart.srTable.rows[0][2]).toBe('599,200')
      expect(mixedChart.srTable.rows[0][2]).not.toContain('$')
    })
  })
})
