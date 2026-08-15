/**
 * Story 6.2 (AC 6-7): ReportConfig strict-write / defensive-read.
 * validateReportConfig throws on malformed writes; parseReportConfig returns
 * safe type-specific defaults for corrupt persisted rows so one bad row can
 * never blank the report list.
 */
import { validateReportConfig, parseReportConfig, defaultReportConfig } from '../report-config'
import { REPORT_TYPES } from '../report-types'
import type { ReportConfig } from '../report-config'

const VALID: ReportConfig = {
  datePreset: 'CUSTOM',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  comparisonMode: 'NONE',
  comparisonStartDate: null,
  comparisonEndDate: null,
  groupBy: 'MONTH',
  ownerId: null,
  teamId: null,
  stageId: null,
  productId: null,
  currency: null,
}

describe('validateReportConfig (AC 6-7, strict write path)', () => {
  it('accepts a config with exactly the allowed keys', () => {
    expect(validateReportConfig(VALID)).toEqual(VALID)
  })

  it('rejects unknown keys', () => {
    expect(() => validateReportConfig({ ...VALID, chartType: 'pie' })).toThrow(
      /unknown key|unexpected key|chartType/i,
    )
  })

  it('rejects non-object configs', () => {
    expect(() => validateReportConfig(null)).toThrow()
    expect(() => validateReportConfig('nope')).toThrow()
    expect(() => validateReportConfig([])).toThrow()
    expect(() => validateReportConfig(42)).toThrow()
  })

  it('rejects unknown vocabulary values', () => {
    expect(() => validateReportConfig({ ...VALID, groupBy: 'DAY' })).toThrow()
    expect(() => validateReportConfig({ ...VALID, datePreset: 'EVER' })).toThrow()
    expect(() => validateReportConfig({ ...VALID, comparisonMode: 'LAST_QUARTER' })).toThrow()
  })

  it('rejects malformed ISO dates', () => {
    expect(() => validateReportConfig({ ...VALID, startDate: '2026-13-40' })).toThrow()
    expect(() => validateReportConfig({ ...VALID, startDate: '2026/08/01' })).toThrow()
    expect(() => validateReportConfig({ ...VALID, endDate: 'not-a-date' })).toThrow()
  })

  it('rejects reversed ranges', () => {
    expect(() =>
      validateReportConfig({ ...VALID, startDate: '2026-09-01', endDate: '2026-08-01' }),
    ).toThrow(/end|range|start/i)
  })

  it('rejects ranges longer than 36 months', () => {
    expect(() =>
      validateReportConfig({ ...VALID, startDate: '2020-01-01', endDate: '2026-01-01' }),
    ).toThrow(/36/i)
  })

  it('rejects CUSTOM comparison with missing or invalid comparison dates', () => {
    expect(() => validateReportConfig({ ...VALID, comparisonMode: 'CUSTOM' })).toThrow(
      /comparison/i,
    )
    expect(() =>
      validateReportConfig({
        ...VALID,
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-07-01',
      }),
    ).toThrow(/comparison/i)
    expect(() =>
      validateReportConfig({
        ...VALID,
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-07-05',
        comparisonEndDate: '2026-07-01',
      }),
    ).toThrow(/comparison/i)
  })

  it('rejects a CUSTOM comparison whose inclusive day count differs from the current range', () => {
    expect(() =>
      validateReportConfig({
        ...VALID,
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-07-01',
        comparisonEndDate: '2026-07-10', // 10 days vs 31 days
      }),
    ).toThrow(/day|comparison/i)
  })

  it('accepts a CUSTOM comparison with matching day count', () => {
    expect(() =>
      validateReportConfig({
        ...VALID,
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-06-01',
        comparisonEndDate: '2026-07-01', // 31 days inclusive
      }),
    ).not.toThrow()
  })

  it('rejects invalid optional ID/currency shapes (non-string)', () => {
    expect(() => validateReportConfig({ ...VALID, ownerId: 7 })).toThrow()
    expect(() => validateReportConfig({ ...VALID, currency: '' })).toThrow()
  })

  it('allows preset-based configs with null dates', () => {
    const presetConfig: ReportConfig = {
      ...VALID,
      datePreset: 'THIS_MONTH',
      startDate: null,
      endDate: null,
    }
    expect(validateReportConfig(presetConfig).datePreset).toBe('THIS_MONTH')
  })
})

describe('parseReportConfig (AC 7, defensive read path)', () => {
  it('parses a valid persisted config unchanged', () => {
    expect(parseReportConfig(VALID, 'SALES_OVERVIEW')).toEqual(VALID)
  })

  it('never throws on corrupt rows — returns type-specific defaults', () => {
    for (const corrupt of [
      null,
      undefined,
      'string',
      42,
      [],
      {},
      { groupBy: 'DAY' },
      { datePreset: 'EVER' },
    ]) {
      const parsed = parseReportConfig(corrupt, 'SALES_OVERVIEW')
      expect(parsed).toBeDefined()
      expect(parsed.groupBy).toBeDefined()
    }
  })

  it('returns safe defaults for an empty object', () => {
    const parsed = parseReportConfig({}, 'SALES_OVERVIEW')
    expect(parsed.datePreset).toBeDefined()
    expect(parsed.comparisonMode).toBe('NONE')
    expect(parsed.ownerId).toBeNull()
    expect(parsed.currency).toBeNull()
  })

  it('falls back field-by-field on malformed values instead of throwing', () => {
    const parsed = parseReportConfig(
      {
        datePreset: 'BOGUS',
        startDate: '2026-08-01',
        endDate: 'not-a-date',
        comparisonMode: 'CUSTOM', // missing comparison dates → mode falls back
        groupBy: 'MONTH',
      },
      'SALES_OVERVIEW',
    )
    expect(parsed.datePreset).toBe('THIS_MONTH')
    expect(parsed.endDate).toBeNull()
    expect(parsed.comparisonMode).toBe('NONE')
  })

  it('is type-specific: TEAM_PERFORMANCE and DEAL_VELOCITY get different default groupBy', () => {
    const team = parseReportConfig({}, 'TEAM_PERFORMANCE')
    const velocity = parseReportConfig({}, 'DEAL_VELOCITY')
    expect(team.groupBy).toBe('OWNER')
    expect(velocity.groupBy).toBe('MONTH')
  })

  it('handles unknown persisted report types defensively', () => {
    // A corrupt type string must still yield a safe config
    const parsed = parseReportConfig({}, 'NOT_A_REAL_TYPE')
    expect(parsed).toBeDefined()
    expect(parsed.comparisonMode).toBe('NONE')
  })

  it('defaultReportConfig returns a fresh object per call (no shared mutation)', () => {
    const a = defaultReportConfig('SALES_OVERVIEW')
    const b = defaultReportConfig('SALES_OVERVIEW')
    a.currency = 'EUR'
    expect(b.currency).toBeNull()
  })

  it('provides a default for every report type', () => {
    for (const type of REPORT_TYPES) {
      const cfg = defaultReportConfig(type)
      expect(cfg).toBeDefined()
      expect(cfg.groupBy).toBeDefined()
      expect(validateReportConfig(cfg)).toBeDefined()
    }
  })
})
