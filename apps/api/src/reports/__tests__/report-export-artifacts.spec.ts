/**
 * Story 6.6 (AC 5-7, 13-15, 17-18; test-plan §6): artifact validity tier —
 * real PDFKit/ExcelJS/CSV renderers with the USER_EXPORT profile, parsed and
 * reopened to prove branded numbered PDFs, three-sheet formula-aware XLSX and
 * UTF-8 CSV with injection mitigation.
 */
import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'

import {
  ReportAttachmentService,
  ExportLimitError,
  RENDER_PROFILE_LIMITS,
  expressionToA1,
  columnLetter,
} from '../report-attachment.service'
import type {
  ScheduledReportPayload,
  ScheduledReportRow,
} from '../scheduled-report-payload.service'
import { renderChartPng } from '../report-export-chart'
import type { ExpressionNode } from '../custom-report-config'

function payload(overrides: Partial<ScheduledReportPayload> = {}): ScheduledReportPayload {
  const rows: ScheduledReportRow[] = [
    {
      key: 'deal-1',
      cells: [
        {
          fieldId: 'dim.deal',
          label: 'Deal',
          valueType: 'STRING',
          stringValue: 'Nguyễn Văn A',
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'metric.dealValue',
          label: 'Deal Value',
          valueType: 'CURRENCY',
          stringValue: null,
          numberValue: 10_000,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'calc.commission',
          label: 'Commission',
          valueType: 'NUMBER',
          stringValue: null,
          numberValue: 800,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
      ],
    },
    {
      key: 'deal-2',
      cells: [
        {
          fieldId: 'dim.deal',
          label: 'Deal',
          valueType: 'STRING',
          stringValue: 'Công ty TNHH ABC, Inc.',
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'metric.dealValue',
          label: 'Deal Value',
          valueType: 'CURRENCY',
          stringValue: null,
          numberValue: 20_000,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'calc.commission',
          label: 'Commission',
          valueType: 'NUMBER',
          stringValue: null,
          numberValue: 1600,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
      ],
    },
    {
      key: 'deal-3',
      cells: [
        {
          fieldId: 'dim.deal',
          label: 'Deal',
          valueType: 'STRING',
          stringValue: '=1+1',
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'metric.dealValue',
          label: 'Deal Value',
          valueType: 'CURRENCY',
          stringValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: true,
        },
        {
          fieldId: 'calc.commission',
          label: 'Commission',
          valueType: 'NUMBER',
          stringValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: true,
        },
      ],
    },
  ]
  return {
    reportId: 'rep-1234567890',
    reportType: 'CUSTOM',
    reportName: 'Commission Analysis',
    generatedAt: '2026-05-31T12:00:00.000Z',
    dateRangeLabel: '2026-05-01 — 2026-05-31',
    filterSummary: 'Dates: 2026-05-01 to 2026-05-31; Stage filtered',
    dateRangeStart: '2026-05-01',
    dateRangeEnd: '2026-05-31',
    summaryMetrics: [
      { key: 'totalRows', label: 'Total rows', value: 3, unit: 'COUNT' },
      { key: 'winRate', label: 'Win rate', value: null, unit: 'PERCENT' },
    ],
    columns: [
      {
        fieldId: 'dim.deal',
        label: 'Deal',
        valueType: 'STRING',
        role: 'DIMENSION',
        aggregation: null,
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'metric.dealValue',
        label: 'Deal Value',
        valueType: 'CURRENCY',
        role: 'METRIC',
        aggregation: 'SUM',
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'calc.commission',
        label: 'Commission',
        valueType: 'NUMBER',
        role: 'METRIC',
        aggregation: null,
        granularity: null,
        isCalculated: true,
      },
    ],
    rows,
    totalRows: 3,
    warnings: [{ code: 'EXCLUDED_ROWS', message: '2 rows excluded' }],
    currency: 'USD',
    mixedCurrencies: false,
    crmUrl: 'https://crm.example/reports/builder?reportId=rep-1234567890',
    visualization: {
      type: 'BAR',
      title: 'Commission by deal',
      showLegend: true,
      showDataLabels: false,
      xAxisLabel: 'Deal',
      yAxisLabel: 'USD',
      orientation: 'VERTICAL',
      colors: ['#2563eb'],
      legendPosition: 'BOTTOM',
    },
    chartSeries: [
      {
        metricId: 'calc.commission',
        label: 'Commission',
        points: [
          { key: 'deal-1', label: 'Nguyễn Văn A', value: 800, dimensionLabels: ['Nguyễn Văn A'] },
          { key: 'deal-2', label: 'ABC, Inc.', value: 1600, dimensionLabels: ['ABC, Inc.'] },
        ],
      },
    ],
    calculatedFields: [
      {
        id: 'calc.commission',
        alias: 'Commission',
        label: 'Commission',
        expression: 'dealValue * 0.08',
      },
    ],
    metricAliases: [{ fieldId: 'metric.dealValue', alias: 'dealValue' }],
    filterTokens: [],
    ...overrides,
  }
}

const service = new ReportAttachmentService()

/** PDFKit hex-encodes text into <...> TJ arrays; decode and compact. */
function pdfText(buffer: Buffer): string {
  const text = buffer.toString('latin1')
  const hexStrings = text.match(/<([0-9a-fA-F]{2,})>/g) ?? []
  return hexStrings
    .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join(' ')
    .replace(/\s+/g, '')
}

function pdfPageCount(buffer: Buffer): number {
  const text = buffer.toString('latin1')
  // `/Type /Page\b` matches page objects only, never the `/Type /Pages` tree.
  return (text.match(/\/Type \/Page\b/g) ?? []).length
}

describe('report export artifacts (USER_EXPORT profile)', () => {
  it('renders a branded numbered PDF with title/date/filter/summary/chart/image', async () => {
    const png = await renderChartPng({
      visualization: payload().visualization!,
      series: payload().chartSeries,
    })
    const attachment = await service.render(payload({}), 'PDF', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme CRM', primaryColor: '#2563eb' },
      chartPng: png,
    })
    expect(attachment.contentType).toBe('application/pdf')
    expect(attachment.content.subarray(0, 5).toString()).toBe('%PDF-')
    expect(attachment.filename).toMatch(/^commission-analysis_2026-05-01_to_2026-05-31\.pdf$/)
    const text = pdfText(attachment.content)
    expect(text).toContain('CommissionAnalysis')
    expect(text).toContain('AcmeCRM')
    expect(text).toContain('2026-05-01')
    expect(text).toContain('2026-05-31')
    expect(text).toContain('Stagefiltered')
    expect(text).toContain('EXCLUDED_ROWS')
    expect(text).toContain('Totalrows')
    // Chart embedded as a raster image XObject
    expect(attachment.content.toString('latin1')).toContain('/Subtype /Image')
    // Page X of Y on every page
    const count = pdfPageCount(attachment.content)
    expect(count).toBeGreaterThanOrEqual(1)
    expect(text).toContain(`Page1of${count}`)
  })

  it('renders a table-only PDF with a "No chart configured" note and no image', async () => {
    const tablePayload = payload({
      visualization: {
        type: 'TABLE',
        title: null,
        showLegend: false,
        showDataLabels: false,
        xAxisLabel: null,
        yAxisLabel: null,
        orientation: null,
        colors: [],
        legendPosition: null,
      },
      chartSeries: [],
    })
    const attachment = await service.render(tablePayload, 'PDF', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme CRM', primaryColor: null },
    })
    const raw = attachment.content.toString('latin1')
    expect(raw).not.toContain('/Subtype /Image')
    expect(pdfText(attachment.content)).toContain('Nochartconfigured(tablereport)')
  })

  it('renders an XLSX with Summary/Data/Charts, frozen autofiltered table, AST formulas and chart image', async () => {
    const png = await renderChartPng({
      visualization: payload().visualization!,
      series: payload().chartSeries,
    })
    const attachment = await service.render(payload(), 'EXCEL', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme CRM', primaryColor: '#2563eb' },
      chartPng: png,
    })
    expect(attachment.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(attachment.content.subarray(0, 2).toString()).toBe('PK')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(attachment.content as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Summary', 'Data', 'Charts'])

    const summary = workbook.getWorksheet('Summary')!
    const cells = new Map<string, string>()
    summary.eachRow((row) => {
      cells.set(String(row.getCell(1).value ?? ''), String(row.getCell(2).value ?? ''))
    })
    expect(cells.get('Report')).toBe('Commission Analysis')
    expect(cells.get('Tenant')).toBe('Acme CRM')
    expect(cells.get('Filters')).toBe('Dates: 2026-05-01 to 2026-05-31; Stage filtered')
    // warnings block: header row then code/message rows
    expect(cells.get('Warning')).toBe('Message')
    expect(cells.get('EXCLUDED_ROWS')).toBe('2 rows excluded')

    const data = workbook.getWorksheet('Data')!
    expect(data.getCell('A1').value).toBe('Deal')
    expect(data.getCell('B1').value).toBe('Deal Value')
    expect(data.getCell('C1').value).toBe('Commission')
    // typed values preserved; null never zeroed
    expect(data.getCell('B2').value).toBe(10_000)
    expect(data.getCell('B4').value).toBeNull()
    // injection probe is a literal string, never a formula
    expect(data.getCell('A4').value).toBe("'=1+1")
    // AST-derived formula with authoritative cached result
    const formulaCell = data.getCell('C2').value as { formula: string; result: number }
    expect(formulaCell.formula).toMatch(/^=\(B2\*0\.08\)$/)
    expect(formulaCell.result).toBe(800)
    // null calculated cell has no formula
    expect(data.getCell('C4').value).toBeNull()
    // frozen first row + autofilter spanning the table
    expect(data.views[0]?.state).toBe('frozen')
    expect((data.views[0] as { ySplit?: number } | undefined)?.ySplit).toBe(1)
    expect(data.autoFilter).toBe('A1:C4')
    const charts = workbook.getWorksheet('Charts')!
    // The embedded image occupies the first rows; find the metadata block.
    let chartTypeRow: number | null = null
    charts.getColumn(1).eachCell((cell, rowNumber) => {
      if (cell.value === 'Chart type') chartTypeRow = rowNumber
    })
    expect(chartTypeRow).not.toBeNull()
    // value lives in column B of the 'Chart type' row
    expect(charts.getCell(`B${chartTypeRow ?? 1}` as unknown as number).value).toBe('BAR')
    // chart image present
    expect(workbook.model.media?.length ?? 0).toBeGreaterThan(0)
  })

  it('writes the explicit table-only note on the Charts sheet for TABLE reports', async () => {
    const tablePayload = payload({
      visualization: {
        type: 'TABLE',
        title: null,
        showLegend: false,
        showDataLabels: false,
        xAxisLabel: null,
        yAxisLabel: null,
        orientation: null,
        colors: [],
        legendPosition: null,
      },
      chartSeries: [],
    })
    const attachment = await service.render(tablePayload, 'EXCEL', { profile: 'USER_EXPORT' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(attachment.content as unknown as ArrayBuffer)
    const charts = workbook.getWorksheet('Charts')!
    expect(String(charts.getCell('B1').value)).toContain('No chart configured')
  })

  it('renders UTF-8 CSV with BOM, RFC quoting, Vietnamese round-trip and neutralized probes', async () => {
    const attachment = await service.render(payload(), 'CSV', { profile: 'USER_EXPORT' })
    expect(attachment.contentType).toBe('text/csv; charset=utf-8')
    expect(attachment.content.subarray(0, 3).toString()).toBe('\uFEFF')
    expect(attachment.filename.endsWith('.csv')).toBe(true)

    const text = attachment.content.toString('utf8').replace(/^\uFEFF/, '')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('\r')

    const records = parseCsv(text, { bom: false, columns: true }) as Record<string, string>[]
    expect(records).toHaveLength(3)
    expect(Object.keys(records[0]!)).toEqual(['Deal', 'Deal Value', 'Commission'])
    // Vietnamese + embedded comma round-trip losslessly
    expect(records[0]!.Deal).toBe('Nguyễn Văn A')
    expect(records[1]!.Deal).toBe('Công ty TNHH ABC, Inc.')
    expect(records[1]!['Deal Value']).toBe('20000')
    // formula probe neutralized to literal text
    expect(records[2]!.Deal).toBe("'=1+1")
    // no summary/chart pseudo-rows
    expect(records.some((r) => r.Deal === 'Total rows')).toBe(false)
  })

  it('threads deterministic payload filter tokens into the USER_EXPORT filename (production path)', async () => {
    // The processor passes the payload straight through render(); the tokens
    // must come from the payload, not from an empty default (AC 12 / C15).
    const tokenized = payload({ filterTokens: ['owner-11112222', 'stage-99998888'] })
    const csv = await service.render(tokenized, 'CSV', { profile: 'USER_EXPORT' })
    expect(csv.filename).toBe(
      'commission-analysis_2026-05-01_to_2026-05-31_owner-11112222_stage-99998888.csv',
    )
    const pdf = await service.render(tokenized, 'PDF', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme', primaryColor: '#2563eb' },
    })
    expect(pdf.filename).toContain('owner-11112222_stage-99998888.pdf')
    // No filters → date range alone, no token segment (still includes as-of/range).
    const plain = await service.render(payload({ filterTokens: [] }), 'EXCEL', {
      profile: 'USER_EXPORT',
    })
    expect(plain.filename).toBe('commission-analysis_2026-05-01_to_2026-05-31.xlsx')
    // SCHEDULED_EMAIL profile keeps the exact Story 6.5 filename contract.
    const scheduled = await service.render(tokenized, 'CSV', {})
    expect(scheduled.filename).toBe('commission-analysis-rep-1234-20260531.csv')
  })

  it('enforces USER_EXPORT 50 MB / 50,000 row / 50 column bounds as typed errors', () => {
    expect(RENDER_PROFILE_LIMITS.USER_EXPORT).toEqual({
      maxBytes: 50 * 1024 * 1024,
      maxRows: 50_000,
      maxColumns: 50,
    })
    const rows = Array.from(
      { length: 50_001 },
      (_, i): ScheduledReportRow => ({
        key: `r${i}`,
        cells: [
          {
            fieldId: 'dim.deal',
            label: 'Deal',
            valueType: 'STRING',
            stringValue: 'x',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
        ],
      }),
    )
    expect(() =>
      service.render(payload({ rows }), 'CSV', { profile: 'USER_EXPORT' }),
    ).rejects.toThrow(ExportLimitError)
  })

  it('checks the final byte count before the buffer leaves the renderer', async () => {
    const rows = Array.from(
      { length: 50_000 },
      (_, i): ScheduledReportRow => ({
        key: `r${i}`,
        cells: [
          {
            fieldId: 'dim.deal',
            label: 'Deal',
            valueType: 'STRING',
            stringValue: `row ${i} `.repeat(500),
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
        ],
      }),
    )
    await expect(
      service.render(payload({ rows }), 'CSV', { profile: 'USER_EXPORT' }),
    ).rejects.toThrow(ExportLimitError)
  })
})

describe('AST → A1 formula translation (Contract C19)', () => {
  it('translates validated nodes and refuses unresolved aliases', () => {
    expect(columnLetter(1)).toBe('A')
    expect(columnLetter(26)).toBe('Z')
    expect(columnLetter(27)).toBe('AA')
    const resolve = (name: string): string | null => (name === 'dealValue' ? 'B2' : null)
    const ast: ExpressionNode = {
      kind: 'bin',
      op: '*',
      left: { kind: 'ref', name: 'dealValue' },
      right: { kind: 'num', value: 0.08 },
    }
    expect(expressionToA1(ast, resolve)).toBe('(B2*0.08)')
    expect(expressionToA1({ kind: 'ref', name: 'missing' }, resolve)).toBeNull()
    expect(expressionToA1({ kind: 'num', value: 3 }, resolve)).toBe('3')
  })
})
