/**
 * Story 6.2 (AC 4-5): closed report vocabularies are single-source const tuples.
 * Every TS union / GraphQL enum must derive from the same tuples — never a
 * hand-copied second vocabulary.
 */
import {
  REPORT_TYPES,
  REPORT_GROUP_BY,
  COMPARISON_MODES,
  DATE_PRESETS,
  REPORT_METRIC_KEYS,
  REPORT_DRILL_METRICS,
  isReportType,
  isReportGroupBy,
  isComparisonMode,
  isDatePreset,
  isReportMetricKey,
} from '../report-types'
import type { ReportType, ReportGroupBy, ComparisonMode, DatePreset } from '../report-types'

describe('report-types (AC 4-5)', () => {
  it('defines REPORT_TYPES with exactly the six report types in order', () => {
    expect(REPORT_TYPES).toEqual([
      'SALES_OVERVIEW',
      'PIPELINE_ANALYSIS',
      'WIN_LOSS',
      'REVENUE_FORECAST',
      'TEAM_PERFORMANCE',
      'DEAL_VELOCITY',
    ])
  })

  it('derives the ReportType union from the tuple (single source of truth)', () => {
    const type: ReportType = 'SALES_OVERVIEW'
    expect(REPORT_TYPES).toContain(type)
    // @ts-expect-error — a value outside the tuple must not type-check
    const invalid: ReportType = 'INVENTORY'
    void invalid
  })

  it('defines REPORT_GROUP_BY exactly', () => {
    expect(REPORT_GROUP_BY).toEqual(['MONTH', 'QUARTER', 'YEAR', 'OWNER', 'TEAM', 'PRODUCT'])
    const gb: ReportGroupBy = 'YEAR'
    expect(REPORT_GROUP_BY).toContain(gb)
  })

  it('defines COMPARISON_MODES exactly', () => {
    expect(COMPARISON_MODES).toEqual(['NONE', 'PREVIOUS_PERIOD', 'YEAR_OVER_YEAR', 'CUSTOM'])
    const cm: ComparisonMode = 'YEAR_OVER_YEAR'
    expect(COMPARISON_MODES).toContain(cm)
  })

  it('defines DATE_PRESETS exactly', () => {
    expect(DATE_PRESETS).toEqual(['THIS_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'CUSTOM'])
    const preset: DatePreset = 'THIS_QUARTER'
    expect(DATE_PRESETS).toContain(preset)
  })

  it('defines a closed REPORT_METRIC_KEYS vocabulary for drill targets', () => {
    expect(REPORT_METRIC_KEYS.length).toBeGreaterThan(0)
    expect(new Set(REPORT_METRIC_KEYS).size).toBe(REPORT_METRIC_KEYS.length)
    // Clients never submit column names / arbitrary predicates (AC 46)
    expect(REPORT_METRIC_KEYS).not.toContain('title')
    expect(REPORT_METRIC_KEYS).not.toContain('ownerId')
    expect(REPORT_METRIC_KEYS).not.toContain('value')
  })

  it('maps every report type to a non-empty drillable metric set drawn from the vocabulary', () => {
    for (const type of REPORT_TYPES) {
      const drillable = REPORT_DRILL_METRICS[type]
      expect(drillable.length).toBeGreaterThan(0)
      for (const key of drillable) {
        expect(REPORT_METRIC_KEYS).toContain(key)
      }
    }
  })

  it('isReportType / isReportGroupBy / isComparisonMode / isDatePreset / isReportMetricKey guard unknown values', () => {
    expect(isReportType('SALES_OVERVIEW')).toBe(true)
    expect(isReportType('BOGUS')).toBe(false)
    expect(isReportType(undefined)).toBe(false)
    expect(isReportGroupBy('MONTH')).toBe(true)
    expect(isReportGroupBy('DAY')).toBe(false)
    expect(isComparisonMode('CUSTOM')).toBe(true)
    expect(isComparisonMode('LAST_QUARTER')).toBe(false)
    expect(isDatePreset('THIS_YEAR')).toBe(true)
    expect(isDatePreset('EVER')).toBe(false)
    expect(isReportMetricKey('WON_DEALS')).toBe(true)
    expect(isReportMetricKey('title')).toBe(false)
  })
})
