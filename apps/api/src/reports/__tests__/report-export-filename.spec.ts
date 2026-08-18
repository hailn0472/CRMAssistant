/**
 * Story 6.6 (AC 12, Contract C15): deterministic safe filenames from
 * sanitized report name + effective date range + short safe filter tokens.
 */
import {
  customFilterTokens,
  exportFilename,
  shortIdToken,
  salesFilterTokens,
} from '../report-document-payload'
import type { ReportConfig } from '../report-config'
import type { CustomReportFilter } from '../custom-report-types'

describe('exportFilename', () => {
  const generatedAt = new Date('2026-05-31T12:00:00Z')

  it('builds the canonical pattern with a bounded date range', () => {
    const name = exportFilename({
      reportName: 'Sales Report',
      dateRangeStart: '2026-05-01',
      dateRangeEnd: '2026-05-31',
      filterTokens: ['owner-a1b2c3d4'],
      format: 'PDF',
      generatedAt,
    })
    expect(name).toBe('sales-report_2026-05-01_to_2026-05-31_owner-a1b2c3d4.pdf')
  })

  it('uses as-of_YYYY-MM-DD when no bounded date range exists', () => {
    const name = exportFilename({
      reportName: 'Sales Report',
      dateRangeStart: null,
      dateRangeEnd: null,
      filterTokens: [],
      format: 'CSV',
      generatedAt,
    })
    expect(name).toBe('sales-report_as-of_2026-05-31.csv')
  })

  it('sanitizes hostile report names (path/control chars) and caps basenames', () => {
    const name = exportFilename({
      reportName: 'a/../../etc\\passwd\u0000 Report!!!',
      dateRangeStart: '2026-05-01',
      dateRangeEnd: '2026-05-31',
      filterTokens: [],
      format: 'EXCEL',
      generatedAt,
    })
    expect(name).not.toMatch(/[\/\\\u0000]/)
    expect(name.endsWith('.xlsx')).toBe(true)

    const long = exportFilename({
      reportName: 'x'.repeat(300),
      dateRangeStart: '2026-05-01',
      dateRangeEnd: '2026-05-31',
      filterTokens: ['owner-a1b2c3d4', 'team-b2c3d4e5'],
      format: 'PDF',
      generatedAt,
    })
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long.endsWith('.pdf')).toBe(true)
  })

  it('maps formats to the correct extensions', () => {
    expect(
      exportFilename({
        reportName: 'R',
        dateRangeStart: null,
        dateRangeEnd: null,
        filterTokens: [],
        format: 'PDF',
        generatedAt,
      }).endsWith('.pdf'),
    ).toBe(true)
    expect(
      exportFilename({
        reportName: 'R',
        dateRangeStart: null,
        dateRangeEnd: null,
        filterTokens: [],
        format: 'EXCEL',
        generatedAt,
      }).endsWith('.xlsx'),
    ).toBe(true)
    expect(
      exportFilename({
        reportName: 'R',
        dateRangeStart: null,
        dateRangeEnd: null,
        filterTokens: [],
        format: 'CSV',
        generatedAt,
      }).endsWith('.csv'),
    ).toBe(true)
  })
})

describe('shortIdToken', () => {
  it('produces short deterministic tokens and null for missing ids', () => {
    expect(shortIdToken('owner', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe('owner-a1b2c3d4')
    expect(shortIdToken('owner', null)).toBeNull()
    expect(shortIdToken('owner', undefined)).toBeNull()
    // Separators stripped — tokens can never break a filename path.
    expect(shortIdToken('team', 'a/b\\c..d')).not.toMatch(/[\/\\.]/)
  })
})

describe('salesFilterTokens', () => {
  it('derives owner/team/stage/product tokens from the effective config', () => {
    const config: ReportConfig = {
      datePreset: 'CUSTOM',
      startDate: null,
      endDate: null,
      comparisonMode: 'NONE',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: '11112222-3333-4444-5555-666677778888',
      teamId: null,
      stageId: '99998888-aaaa-bbbb-cccc-ddddeeeeffff',
      productId: '77776666-1111-2222-3333-444455556666',
      currency: null,
    }
    const tokens = salesFilterTokens(config)
    expect(tokens).toEqual(['owner-11112222', null, 'stage-99998888', 'product-77776666'])
  })
})

describe('customFilterTokens', () => {
  const base = (overrides: Partial<CustomReportFilter>): CustomReportFilter => ({
    id: 'f1',
    fieldId: 'deal.ownerId',
    operator: 'EQ',
    stringValue: '11112222-3333-4444-5555-666677778888',
    numberValue: null,
    booleanValue: null,
    dateValue: null,
    stringValues: null,
    numberValues: null,
    dateValues: null,
    ...overrides,
  })

  it('returns one deterministic short hash token when non-date filters are applied', () => {
    const tokens = customFilterTokens([base({})])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatch(/^filters-[0-9a-f]{8}$/)
    // deterministic: same immutable filter set → same token
    expect(customFilterTokens([base({})])).toEqual(tokens)
    // a different filter value changes the token
    const other = customFilterTokens([
      base({ stringValue: '99998888-aaaa-bbbb-cccc-ddddeeeeffff' }),
    ])
    expect(other).not.toEqual(tokens)
  })

  it('skips date filters (already reflected in the date-range segment)', () => {
    expect(
      customFilterTokens([
        base({ operator: 'BETWEEN', dateValues: ['2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z'] }),
      ]),
    ).toEqual([])
    expect(customFilterTokens([])).toEqual([])
  })

  it('feeds the token into the production filename', () => {
    const tokens = customFilterTokens([
      base({ operator: 'EQ', stringValue: '11112222-3333-4444-5555-666677778888' }),
    ])
    const name = exportFilename({
      reportName: 'Custom Report',
      dateRangeStart: null,
      dateRangeEnd: null,
      filterTokens: tokens,
      format: 'PDF',
      generatedAt: new Date('2026-05-31T12:00:00Z'),
    })
    expect(name).toBe(`custom-report_as-of_2026-05-31_${tokens[0]}.pdf`)
  })
})
