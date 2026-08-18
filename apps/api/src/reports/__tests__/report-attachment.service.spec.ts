/**
 * Story 6.5 (Contract D19, AC 11): attachment renderer tests that PARSE the
 * produced artifacts (PDF signature/text, XLSX sheets/cells, CSV quoting and
 * formula mitigation) rather than only checking non-empty buffers.
 */
import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'

import {
  ReportAttachmentService,
  AttachmentLimitError,
  attachmentFilename,
  csvEscape,
  neutralizeCellText,
  MAX_ATTACHMENT_ROWS,
  MAX_ATTACHMENT_BYTES,
} from '../report-attachment.service'
import type {
  ScheduledReportPayload,
  ScheduledReportRow,
  ScheduledReportCell,
} from '../scheduled-report-payload.service'

function payload(overrides: Partial<ScheduledReportPayload> = {}): ScheduledReportPayload {
  return {
    reportId: 'rep-1234567890',
    reportType: 'PIPELINE_ANALYSIS',
    reportName: 'Q1 Pipeline Report',
    generatedAt: '2026-02-01T12:00:00.000Z',
    dateRangeLabel: '2026-01-01 — 2026-01-31',
    summaryMetrics: [
      { key: 'PIPELINE_VALUE', label: 'Total value', value: 125000, unit: 'CURRENCY' },
      { key: 'OPEN_DEALS', label: 'Open deals', value: 42, unit: 'COUNT' },
      { key: 'WIN_RATE', label: 'Win rate', value: null, unit: 'PERCENT' },
    ],
    columns: [
      {
        fieldId: 'bucket.label',
        label: 'Period',
        valueType: 'STRING',
        role: 'DIMENSION',
        aggregation: null,
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'bucket.value',
        label: 'Value',
        valueType: 'CURRENCY',
        role: 'METRIC',
        aggregation: 'SUM',
        granularity: null,
        isCalculated: false,
      },
    ],
    rows: [
      {
        key: '2026-01',
        cells: [
          {
            fieldId: 'bucket.label',
            label: 'Period',
            valueType: 'STRING',
            stringValue: 'Jan 2026',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
          {
            fieldId: 'bucket.value',
            label: 'Value',
            valueType: 'CURRENCY',
            stringValue: null,
            numberValue: 125000,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
        ],
      },
      {
        key: '2026-02',
        cells: [
          {
            fieldId: 'bucket.label',
            label: 'Period',
            valueType: 'STRING',
            stringValue: '=SUM(A1:A9)',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
          {
            fieldId: 'bucket.value',
            label: 'Value',
            valueType: 'CURRENCY',
            stringValue: null,
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: true,
          },
        ],
      },
    ],
    totalRows: 2,
    warnings: [{ code: 'MIXED_CURRENCY', message: 'Mixed currencies detected' }],
    currency: 'USD',
    mixedCurrencies: true,
    crmUrl: 'https://crm.example/reports/sales?reportId=rep-1234567890',
    // Story 6.6 shared-payload fields (additive; schedule output unchanged)
    filterSummary: 'All configured data',
    dateRangeStart: '2026-01-01',
    dateRangeEnd: '2026-01-31',
    visualization: null,
    chartSeries: [],
    calculatedFields: [],
    metricAliases: [],
    filterTokens: [],
    ...overrides,
  }
}

describe('attachmentFilename', () => {
  it('produces deterministic safe names', () => {
    const at = new Date('2026-02-01T12:00:00Z')
    expect(attachmentFilename('Q1 Pipeline Report', 'rep-1234567890', 'PDF', at)).toBe(
      'q1-pipeline-report-rep-1234-20260201.pdf',
    )
    expect(attachmentFilename('Weird <name> & stuff!!', 'rep-1', 'EXCEL', at)).toBe(
      'weird-name-stuff-rep-1-20260201.xlsx',
    )
    expect(attachmentFilename('', 'rep-1', 'CSV', at)).toBe('report-rep-1-20260201.csv')
  })
})

describe('csvEscape / neutralizeCellText', () => {
  it('neutralizes spreadsheet formulas like the ExportService precedent', () => {
    expect(neutralizeCellText('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(neutralizeCellText('+cmd|/C calc')).toBe("'+cmd|/C calc")
    expect(neutralizeCellText('@cmd')).toBe("'@cmd")
    expect(neutralizeCellText('-123')).toBe("'-123")
    expect(neutralizeCellText('plain text')).toBe('plain text')
    expect(neutralizeCellText('2026-01-01')).toBe('2026-01-01')
  })

  it('RFC-quotes fields containing commas, quotes or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('plain')).toBe('plain')
    // Formula prefix is applied before quoting.
    expect(csvEscape('=1+1')).toBe("'=1+1")
  })
})

describe('ReportAttachmentService', () => {
  const service = new ReportAttachmentService()

  /** PDFKit hex-encodes text into <...> TJ arrays (with kerning splits). */
  function pdfText(buffer: Buffer): string {
    const text = buffer.toString('latin1')
    const hexStrings = text.match(/<([0-9a-fA-F]{2,})>/g) ?? []
    return hexStrings
      .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
      .join(' ')
      .replace(/\s+/g, '')
  }

  /** Kerning splits tokens mid-word, so compare whitespace-insensitively. */
  const compact = (s: string): string => s.replace(/\s+/g, '')

  it('renders a parseable PDF with title/date/summary/data and CRM link', async () => {
    const attachment = await service.render(payload(), 'PDF')
    expect(attachment.contentType).toBe('application/pdf')
    expect(attachment.filename.endsWith('.pdf')).toBe(true)
    expect(attachment.content.subarray(0, 5).toString()).toBe('%PDF-')
    const text = pdfText(attachment.content)
    expect(text).toContain(compact('Q1 Pipeline Report'))
    // The em-dash glyph is not in the AFM font; assert the dates themselves.
    expect(text).toContain(compact('2026-01-01'))
    expect(text).toContain(compact('2026-01-31'))
    expect(text).toContain(compact('Total value'))
    expect(text).toContain(compact('View in CRM'))
    expect(text).toContain(compact('https://crm.example/reports/sales?reportId=rep-1234567890'))
    expect(text).toContain('MIXED_CURRENCY')
  })

  it('renders an XLSX with Summary and Data sheets and typed cells', async () => {
    const attachment = await service.render(payload(), 'EXCEL')
    expect(attachment.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(attachment.content.subarray(0, 2).toString()).toBe('PK') // zip magic

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(attachment.content as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Summary', 'Data'])

    const summary = workbook.getWorksheet('Summary')!
    const cells = new Map<string, string>()
    summary.eachRow((row) => {
      const key = String(row.getCell(1).value ?? '')
      cells.set(key, String(row.getCell(2).value ?? ''))
    })
    expect(cells.get('Report')).toBe('Q1 Pipeline Report')
    expect(cells.get('Date range')).toBe('2026-01-01 — 2026-01-31')
    expect(cells.get('Total value')).toBe('125000')

    const data = workbook.getWorksheet('Data')!
    expect(data.getCell('A1').value).toBe('Period')
    expect(data.getCell('B1').value).toBe('Value')
    // typed number cell preserved
    expect(data.getCell('B2').value).toBe(125000)
    // null cell preserved (never coerced to zero)
    expect(data.getCell('B3').value).toBeNull()
    // formula string neutralized
    expect(data.getCell('A3').value).toBe("'=SUM(A1:A9)")
  })

  it('renders UTF-8 CSV with BOM, stable headers and quoted/formula-safe values', async () => {
    const attachment = await service.render(payload(), 'CSV')
    expect(attachment.contentType).toBe('text/csv; charset=utf-8')
    expect(attachment.content.subarray(0, 3).toString()).toBe('\uFEFF')

    const records = parseCsv(attachment.content.toString('utf8').replace(/^\uFEFF/, ''), {
      bom: false,
      columns: true,
    }) as Record<string, string>[]
    expect(records).toHaveLength(2)
    expect(Object.keys(records[0]!)).toEqual(['Period', 'Value'])
    expect(records[0]).toMatchObject({ Period: 'Jan 2026', Value: '125000' })
    // formula neutralized inside the CSV body
    expect(records[1]!.Period).toBe("'=SUM(A1:A9)")
    expect(records[1]!.Value).toBe('')
  })

  it('fails on row overflow instead of truncating silently', async () => {
    const rows: ScheduledReportRow[] = Array.from({ length: MAX_ATTACHMENT_ROWS + 1 }, (_, i) => ({
      key: `r${i}`,
      cells: [
        {
          fieldId: 'bucket.label',
          label: 'Period',
          valueType: 'STRING',
          stringValue: 'x',
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
      ],
    }))
    await expect(service.render(payload({ rows }), 'CSV')).rejects.toThrow(AttachmentLimitError)
  })

  it('fails when the rendered bytes exceed the attachment limit', async () => {
    // 5000 rows (at the row cap) with very long cell strings push past 10 MB.
    const rows: ScheduledReportRow[] = Array.from({ length: MAX_ATTACHMENT_ROWS }, (_, i) => ({
      key: `r${i}`,
      cells: [
        {
          fieldId: 'bucket.label',
          label: 'Period',
          valueType: 'STRING',
          stringValue: `row ${i} `.repeat(3000),
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
        {
          fieldId: 'bucket.value',
          label: 'Value',
          valueType: 'CURRENCY',
          stringValue: null,
          numberValue: i,
          booleanValue: null,
          dateValue: null,
          isNull: false,
        },
      ],
    }))
    await expect(service.render(payload({ rows }), 'CSV')).rejects.toThrow(AttachmentLimitError)
    expect(MAX_ATTACHMENT_BYTES).toBeGreaterThan(0)
  })

  // ─── I2: type-aware CSV serialization ─────────────────────────────────────

  function numericCell(fieldId: string, label: string, numberValue: number): ScheduledReportCell {
    return {
      fieldId,
      label,
      valueType: 'CURRENCY' as const,
      stringValue: null,
      numberValue,
      booleanValue: null,
      dateValue: null,
      isNull: false,
    }
  }

  function stringCell(fieldId: string, label: string, stringValue: string): ScheduledReportCell {
    return {
      fieldId,
      label,
      valueType: 'STRING' as const,
      stringValue,
      numberValue: null,
      booleanValue: null,
      dateValue: null,
      isNull: false,
    }
  }

  it('I2: writes legitimate negative finite numbers as raw numerics in CSV (never text)', async () => {
    const attachment = await service.render(
      payload({
        columns: [
          {
            fieldId: 'bucket.label',
            label: 'Period',
            valueType: 'STRING',
            role: 'DIMENSION',
            aggregation: null,
            granularity: null,
            isCalculated: false,
          },
          {
            fieldId: 'bucket.value',
            label: 'Value',
            valueType: 'CURRENCY',
            role: 'METRIC',
            aggregation: 'SUM',
            granularity: null,
            isCalculated: false,
          },
        ],
        rows: [
          {
            key: 'r1',
            cells: [
              stringCell('bucket.label', 'Period', 'Jan'),
              numericCell('bucket.value', 'Value', -5000),
            ],
          },
          {
            key: 'r2',
            cells: [
              stringCell('bucket.label', 'Period', 'Feb'),
              numericCell('bucket.value', 'Value', -12.5),
            ],
          },
        ],
      }),
      'CSV',
    )

    const records = parseCsv(attachment.content.toString('utf8').replace(/^\uFEFF/, ''), {
      bom: false,
      columns: true,
    }) as Record<string, string>[]
    expect(records[0]!.Value).toBe('-5000')
    expect(records[1]!.Value).toBe('-12.5')
    // raw tokens: never quoted, never apostrophe-neutralized
    expect(attachment.content.toString('utf8')).not.toContain("'-5000")
    expect(attachment.content.toString('utf8')).not.toContain("'-12.5")
    expect(attachment.content.toString('utf8')).not.toContain('"-5000"')
  })

  it('I2: numeric-looking STRING cells stay neutralized safe text; injection probes are quoted', async () => {
    const attachment = await service.render(
      payload({
        columns: [
          {
            fieldId: 'c1',
            label: 'Text',
            valueType: 'STRING',
            role: 'DIMENSION',
            aggregation: null,
            granularity: null,
            isCalculated: false,
          },
        ],
        rows: [
          { key: 'r1', cells: [stringCell('c1', 'Text', '-5000')] }, // numeric-LOOKING string
          { key: 'r2', cells: [stringCell('c1', 'Text', '=SUM(A1:A9)')] },
          { key: 'r3', cells: [stringCell('c1', 'Text', '@cmd')] },
          { key: 'r4', cells: [stringCell('c1', 'Text', '+123')] },
          { key: 'r5', cells: [stringCell('c1', 'Text', 'plain')] },
        ],
      }),
      'CSV',
    )

    const records = parseCsv(attachment.content.toString('utf8').replace(/^\uFEFF/, ''), {
      bom: false,
      columns: true,
    }) as Record<string, string>[]
    expect(records[0]!.Text).toBe("'-5000") // string source → neutralized, safe text
    expect(records[1]!.Text).toBe("'=SUM(A1:A9)")
    expect(records[2]!.Text).toBe("'@cmd")
    expect(records[3]!.Text).toBe("'+123")
    expect(records[4]!.Text).toBe('plain')
  })

  it('I2: null, boolean and date cells round-trip type-appropriately', async () => {
    const attachment = await service.render(
      payload({
        columns: [
          {
            fieldId: 'c1',
            label: 'Flag',
            valueType: 'BOOLEAN',
            role: 'DIMENSION',
            aggregation: null,
            granularity: null,
            isCalculated: false,
          },
          {
            fieldId: 'c2',
            label: 'When',
            valueType: 'DATE',
            role: 'DIMENSION',
            aggregation: null,
            granularity: null,
            isCalculated: false,
          },
          {
            fieldId: 'c3',
            label: 'Empty',
            valueType: 'CURRENCY',
            role: 'METRIC',
            aggregation: 'SUM',
            granularity: null,
            isCalculated: false,
          },
        ],
        rows: [
          {
            key: 'r1',
            cells: [
              {
                fieldId: 'c1',
                label: 'Flag',
                valueType: 'BOOLEAN',
                stringValue: null,
                numberValue: null,
                booleanValue: true,
                dateValue: null,
                isNull: false,
              },
              {
                fieldId: 'c2',
                label: 'When',
                valueType: 'DATE',
                stringValue: null,
                numberValue: null,
                booleanValue: null,
                dateValue: '2026-01-15',
                isNull: false,
              },
              {
                fieldId: 'c3',
                label: 'Empty',
                valueType: 'CURRENCY',
                stringValue: null,
                numberValue: null,
                booleanValue: null,
                dateValue: null,
                isNull: true,
              },
            ],
          },
        ],
      }),
      'CSV',
    )

    const records = parseCsv(attachment.content.toString('utf8').replace(/^\uFEFF/, ''), {
      bom: false,
      columns: true,
    }) as Record<string, string>[]
    expect(records[0]!.Flag).toBe('true')
    expect(records[0]!.When).toBe('2026-01-15')
    expect(records[0]!.Empty).toBe('')
  })

  // ─── M6: XLSX metadata-cell formula neutralization ────────────────────────

  it('M6: Summary/Charts metadata cells are formula-neutralized and ordinary values pass through', async () => {
    const attachment = await service.render(
      payload({
        reportName: '=HYPERLINK("http://evil.example","Q1")',
        filterSummary: '=-1+2',
        visualization: {
          type: 'BAR',
          title: '=cmd|/C calc',
          showLegend: true,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: 'VERTICAL',
          colors: ['#2563eb'],
          legendPosition: 'BOTTOM',
        },
        chartSeries: [
          {
            metricId: 'm1',
            label: '=SUM(A1)',
            points: [{ key: 'p1', label: '=-5', value: 10, dimensionLabels: [] }],
          },
        ],
        summaryMetrics: [{ key: 'k', label: 'Plain metric', value: 5, unit: 'COUNT' }],
      }),
      'EXCEL',
      { profile: 'USER_EXPORT' },
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(attachment.content as unknown as ArrayBuffer)

    const summary = workbook.getWorksheet('Summary')!
    expect(summary.getCell('B1').value).toBe('\'=HYPERLINK("http://evil.example","Q1")')
    expect(typeof summary.getCell('B1').value).toBe('string') // never a formula object
    expect(summary.getCell('B5').value).toBe("'=-1+2") // Filters row

    const charts = workbook.getWorksheet('Charts')!
    // Chart metadata rows sit below the embedded image; scan for the labels.
    const metaCells: Record<string, ExcelJS.Cell | undefined> = {}
    charts.getColumn(1).eachCell((cell, rowNumber) => {
      const label = String(cell.value ?? '')
      if (label === 'Chart title' || label === 'Chart type') {
        metaCells[label] = charts.getCell(rowNumber, 2)
      }
      if (label === 'Series') {
        // Data row below the header: col1 = series label, col2 = point label
        metaCells['series'] = charts.getCell(rowNumber + 1, 1)
        metaCells['point'] = charts.getCell(rowNumber + 1, 2)
      }
    })
    expect(metaCells['Chart title']?.value).toBe("'=cmd|/C calc")
    expect(metaCells['Chart type']?.value).toBe('BAR') // enum value preserved ordinary
    expect(metaCells['series']?.value).toBe("'=SUM(A1)")
    expect(metaCells['point']?.value).toBe("'=-5")
  })

  it('M6: ordinary metadata values are preserved unchanged in the reopened workbook', async () => {
    const attachment = await service.render(payload(), 'EXCEL', { profile: 'USER_EXPORT' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(attachment.content as unknown as ArrayBuffer)

    const summary = workbook.getWorksheet('Summary')!
    expect(summary.getCell('B1').value).toBe('Q1 Pipeline Report')
    expect(summary.getCell('B3').value).toBe('2026-01-01 — 2026-01-31') // Date range row (USER_EXPORT adds Tenant at row 2)
  })
})
