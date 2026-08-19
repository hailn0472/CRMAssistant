/**
 * Story 6.5 + 6.6 (Contract D19, C16-C21): internal report attachment
 * renderer for scheduled email AND user-triggered exports. Produces valid
 * branded PDF (PDFKit), XLSX (ExcelJS) and CSV files containing
 * title/date range/filter summary/summary/data — plus, for the USER_EXPORT
 * profile, tenant branding, a server-rendered chart PNG, numbered pages and
 * a three-sheet workbook with AST-derived formulas.
 *
 * Two explicit render profiles:
 * - SCHEDULED_EMAIL (default): preserves Story 6.5 behavior/limits exactly
 *   (10 MB / 5,000 rows / 50 columns, Summary+Data sheets, no chart).
 * - USER_EXPORT: 50 MB / 50,000 rows / 50 columns, chart PNG, branding,
 *   page numbers, Summary+Data+Charts sheets.
 *
 * Overflow is an actionable non-transient failure (typed AttachmentLimitError
 * / ExportLimitError), never silent truncation. The final byte count is
 * checked before the buffer leaves the renderer.
 */
import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

import type {
  ScheduledReportCell,
  ScheduledReportPayload,
  ScheduledReportRow,
} from './scheduled-report-payload.service'
import { AttachmentLimitError, exportFilename } from './report-document-payload'
import { sanitizeTenantBranding, type TenantBranding } from './report-email-template'
import type { ExpressionNode } from './custom-report-config'
import { parseExpression } from './custom-report-config'

export type ReportAttachment = {
  filename: string
  contentType: string
  content: Buffer
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB (SCHEDULED_EMAIL)
export const MAX_ATTACHMENT_ROWS = 5_000 // SCHEDULED_EMAIL
export const MAX_ATTACHMENT_COLUMNS = 50

/** Explicit render profiles with their own bounds (Contract C17). */
export const RENDER_PROFILE_LIMITS = {
  SCHEDULED_EMAIL: { maxBytes: MAX_ATTACHMENT_BYTES, maxRows: MAX_ATTACHMENT_ROWS, maxColumns: 50 },
  USER_EXPORT: { maxBytes: 50 * 1024 * 1024, maxRows: 50_000, maxColumns: 50 },
} as const

export type RenderProfile = keyof typeof RENDER_PROFILE_LIMITS

export type ReportAttachmentRenderOptions = {
  profile?: RenderProfile
  branding?: TenantBranding | null
  chartPng?: Buffer | null
}

/**
 * Typed non-retryable export overflow. Extends AttachmentLimitError so the
 * Story 6.5 schedule processor's `instanceof AttachmentLimitError` check
 * keeps treating every overflow as non-retryable, while user exports get a
 * precise code for the FAILED history row.
 */
export class ExportLimitError extends AttachmentLimitError {
  constructor(
    message: string,
    public readonly code: 'FILE_TOO_LARGE' | 'ROW_LIMIT' | 'COLUMN_LIMIT' | 'DATA_CHANGED',
  ) {
    super(message)
    this.name = 'ExportLimitError'
  }
}

export { AttachmentLimitError }

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Deterministic, safe filename: sanitized report name + short id + UTC date. */
export function attachmentFilename(
  reportName: string,
  reportId: string,
  format: 'PDF' | 'EXCEL' | 'CSV',
  generatedAt: Date,
): string {
  const safeName =
    reportName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'report'
  const ext = format === 'EXCEL' ? 'xlsx' : format.toLowerCase()
  const day = generatedAt.toISOString().slice(0, 10).replace(/-/g, '')
  return `${safeName}-${reportId.slice(0, 8)}-${day}.${ext}`
}

/** Story 6.6 filename: report name + effective date range + filter tokens. */
export function exportRenderFilename(
  payload: ScheduledReportPayload,
  format: 'PDF' | 'EXCEL' | 'CSV',
  filterTokens: (string | null)[],
  generatedAt: Date,
): string {
  return exportFilename({
    reportName: payload.reportName,
    dateRangeStart: payload.dateRangeStart,
    dateRangeEnd: payload.dateRangeEnd,
    filterTokens,
    format,
    generatedAt,
  })
}

export const ATTACHMENT_CONTENT_TYPES = {
  PDF: 'application/pdf',
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv; charset=utf-8',
} as const

/** Spreadsheet-formula neutralization mirroring the ExportService precedent. */
export function neutralizeCellText(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`
  }
  return value
}

export function cellDisplayValue(cell: ScheduledReportCell): string | number | boolean | null {
  if (cell.isNull) return null
  if (cell.stringValue !== null) return neutralizeCellText(cell.stringValue)
  if (cell.numberValue !== null) return cell.numberValue
  if (cell.booleanValue !== null) return cell.booleanValue
  if (cell.dateValue !== null) return cell.dateValue
  return null
}

function limitsFor(profile: RenderProfile): {
  maxBytes: number
  maxRows: number
  maxColumns: number
} {
  const base = RENDER_PROFILE_LIMITS[profile]
  if (profile === 'USER_EXPORT') {
    // Provisioning/test knob: REPORT_EXPORT_MAX_BYTES lets deployments cap
    // the user-export byte limit below 50 MB (and lets integration tests
    // exercise the FILE_TOO_LARGE path without rendering a 50 MB buffer).
    const env = process.env['REPORT_EXPORT_MAX_BYTES']
    const parsed = env ? Number(env) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      return { ...base, maxBytes: parsed }
    }
  }
  return base
}

function boundRows(payload: ScheduledReportPayload, profile: RenderProfile): ScheduledReportRow[] {
  const { maxRows } = limitsFor(profile)
  if (payload.rows.length > maxRows) {
    throw new ExportLimitError(
      `Export row limit exceeded: ${payload.rows.length} > ${maxRows}`,
      'ROW_LIMIT',
    )
  }
  return payload.rows
}

function boundColumns(
  payload: ScheduledReportPayload,
  profile: RenderProfile,
): ScheduledReportPayload['columns'] {
  const { maxColumns } = limitsFor(profile)
  if (payload.columns.length > maxColumns) {
    throw new ExportLimitError(
      `Export column limit exceeded: ${payload.columns.length} > ${maxColumns}`,
      'COLUMN_LIMIT',
    )
  }
  return payload.columns
}

function enforceByteLimit(buffer: Buffer, profile: RenderProfile): Buffer {
  const { maxBytes } = limitsFor(profile)
  if (buffer.length > maxBytes) {
    throw new ExportLimitError(
      `Export size limit exceeded: ${buffer.length} bytes > ${maxBytes}`,
      'FILE_TOO_LARGE',
    )
  }
  return buffer
}

function summaryLines(payload: ScheduledReportPayload): string[] {
  return payload.summaryMetrics.map(
    (m) => `${m.label}: ${m.value === null ? 'n/a' : m.value}${m.unit === 'PERCENT' ? '%' : ''}`,
  )
}

function warningLines(payload: ScheduledReportPayload): string[] {
  return payload.warnings.map((w) => `[${w.code}] ${w.message}`)
}

// ─── A1 formula translation (Contract C19) ───────────────────────────────────

/** 1-based column index → spreadsheet column letters. */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * Translates a validated calculated-expression AST node into an A1 formula
 * string referencing same-row base cells. Returns null when any referenced
 * alias cannot be resolved or the node kind is unsupported — the caller then
 * writes the authoritative value with NO formula (never a raw expression).
 */
export function expressionToA1(
  node: ExpressionNode,
  resolveRef: (name: string) => string | null,
): string | null {
  switch (node.kind) {
    case 'num':
      return String(node.value)
    case 'ref': {
      const cell = resolveRef(node.name)
      return cell === null ? null : cell
    }
    case 'bin': {
      const left = expressionToA1(node.left, resolveRef)
      const right = expressionToA1(node.right, resolveRef)
      if (left === null || right === null) return null
      return `(${left}${node.op}${right})`
    }
    default:
      return null
  }
}

// ─── PDF (PDFKit) ────────────────────────────────────────────────────────────

function pdfHeader(
  payload: ScheduledReportPayload,
  branding: ReturnType<typeof sanitizeTenantBranding>,
  doc: PDFKit.PDFDocument,
): void {
  doc.fontSize(16).fillColor(branding.primaryColor).text(payload.reportName)
  doc.fillColor('black')
  doc.moveDown(0.5)
  doc.fontSize(10).text(`Tenant: ${branding.name}`)
  doc.text(`Date range: ${payload.dateRangeLabel}`)
  doc.text(`Generated: ${new Date(payload.generatedAt).toISOString()}`)
  if (payload.currency) doc.text(`Currency: ${payload.currency}`)
  if (payload.filterSummary) doc.text(`Filters: ${payload.filterSummary}`)
  doc.moveDown(0.5)

  doc.fontSize(12).text('Summary')
  for (const line of summaryLines(payload)) {
    doc.fontSize(9).text(`- ${line}`)
  }

  for (const warning of warningLines(payload)) {
    doc.moveDown(0.25)
    doc.fontSize(8).fillColor('#b45309').text(warning)
  }
  doc.fillColor('black')
  doc.moveDown(0.5)
}

function renderPdf(
  payload: ScheduledReportPayload,
  profile: RenderProfile,
  options: ReportAttachmentRenderOptions,
): Promise<Buffer> {
  // compress:false keeps streams deterministic and text-assertable in tests.
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    compress: false,
    ...(profile === 'USER_EXPORT' ? { bufferPages: true } : {}),
  })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const branding = sanitizeTenantBranding(options.branding)

  if (profile === 'SCHEDULED_EMAIL') {
    // Exact Story 6.5 output — never drift.
    doc.fontSize(16).text(payload.reportName)
    doc.moveDown(0.5)
    doc.fontSize(10).text(`Date range: ${payload.dateRangeLabel}`)
    doc.text(`Generated: ${new Date(payload.generatedAt).toISOString()}`)
    if (payload.currency) doc.text(`Currency: ${payload.currency}`)
    doc.moveDown(0.5)

    doc.fontSize(12).text('Summary')
    for (const line of summaryLines(payload)) {
      doc.fontSize(9).text(`- ${line}`)
    }

    for (const warning of warningLines(payload)) {
      doc.moveDown(0.25)
      doc.fontSize(8).fillColor('#b45309').text(warning)
    }
    doc.fillColor('black')
    doc.moveDown(0.5)
  } else {
    pdfHeader(payload, branding, doc)
  }

  // Chart image (USER_EXPORT only, when a chart is configured).
  const showChart = profile === 'USER_EXPORT' && options.chartPng && payload.chartSeries.length > 0
  if (showChart && options.chartPng) {
    doc.fontSize(12).text('Chart')
    doc.image(options.chartPng, 48, doc.y, { fit: [380, 180] })
    doc.moveDown(0.5)
  } else if (profile === 'USER_EXPORT' && payload.visualization?.type === 'TABLE') {
    doc.fontSize(10).fillColor('#6b7280').text('No chart configured (table report)')
    doc.fillColor('black')
    doc.moveDown(0.5)
  }

  doc.fontSize(12).text('Data')
  const columns = boundColumns(payload, profile)
  const rows = boundRows(payload, profile)
  const headers = columns.map((c) => c.label)
  const tableRows = rows.map((row) =>
    columns.map((col) => {
      const cell = row.cells.find((c) => c.fieldId === col.fieldId)
      const value = cell ? cellDisplayValue(cell) : null
      return value === null ? '' : String(value)
    }),
  )
  const colWidth = Math.max(60, Math.floor((595 - 96) / Math.max(headers.length, 1)))
  let y = doc.y
  const drawHeader = (): void => {
    doc.fontSize(8).fillColor('#1e3a5f')
    headers.forEach((h, i) => {
      doc.text(h, 48 + i * colWidth, y, { width: colWidth - 4, lineBreak: false })
    })
    doc.fillColor('black')
    y += 14
  }
  drawHeader()
  for (const rowText of tableRows) {
    if (y > 760) {
      doc.addPage()
      y = 48
      drawHeader()
    }
    doc.fontSize(7)
    rowText.forEach((text, i) => {
      doc.text(text.slice(0, 60), 48 + i * colWidth, y, { width: colWidth - 4, lineBreak: false })
    })
    y += 12
  }

  doc.text('', 48, y)
  doc.moveDown(0.5)
  doc.fontSize(8).fillColor('#6b7280').text(`View in CRM: ${payload.crmUrl}`)

  if (profile === 'USER_EXPORT') {
    // Page X of Y on every page via buffered pages. Right-align manually:
    // PDFKit's align/width wrap path overflows the bottom margin and would
    // append an empty page (observed 2026-08-18).
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i)
      const label = `Page ${i - range.start + 1} of ${range.count}`
      doc
        .fontSize(8)
        .fillColor('#6b7280')
        .text(label, 547 - doc.widthOfString(label), 790, { lineBreak: false })
    }
  }

  doc.end()
  return done.then((buffer) => enforceByteLimit(buffer, profile))
}

// ─── Excel (ExcelJS) ─────────────────────────────────────────────────────────

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  payload: ScheduledReportPayload,
  branding: ReturnType<typeof sanitizeTenantBranding>,
  profile: RenderProfile,
): void {
  const summarySheet = workbook.addWorksheet('Summary')
  // M6: user-controlled metadata cells are formula-neutralized (C19).
  summarySheet.addRow(['Report', neutralizeCellText(payload.reportName)])
  if (profile === 'USER_EXPORT') {
    summarySheet.addRow(['Tenant', neutralizeCellText(branding.name)])
  }
  summarySheet.addRow(['Date range', payload.dateRangeLabel])
  summarySheet.addRow(['Generated', new Date(payload.generatedAt).toISOString()])
  if (payload.filterSummary) {
    summarySheet.addRow(['Filters', neutralizeCellText(payload.filterSummary)])
  }
  if (payload.currency) summarySheet.addRow(['Currency', payload.currency])
  summarySheet.addRow(['View in CRM', payload.crmUrl])
  summarySheet.addRow([])
  summarySheet.addRow(['Metric', 'Value'])
  for (const m of payload.summaryMetrics) {
    summarySheet.addRow([m.label, m.value === null ? null : m.value])
  }
  if (payload.warnings.length > 0) {
    summarySheet.addRow([])
    summarySheet.addRow(['Warning', 'Message'])
    for (const w of payload.warnings) {
      summarySheet.addRow([w.code, w.message])
    }
  }
  summarySheet.getColumn(1).width = 24
  summarySheet.getColumn(2).width = 40
}

function writeDataSheet(
  workbook: ExcelJS.Workbook,
  payload: ScheduledReportPayload,
  profile: RenderProfile,
): void {
  const columns = boundColumns(payload, profile)
  const rows = boundRows(payload, profile)
  const dataSheet = workbook.addWorksheet('Data')
  dataSheet.addRow(columns.map((c) => c.label))

  // Formula plan: for each calculated column, translate the validated AST.
  // Defensive `?? []` — payloads built before Story 6.6 (or hand-built 6.5
  // test fixtures) may omit the formula metadata; value-only cells remain.
  const calcByFieldId = new Map((payload.calculatedFields ?? []).map((cf) => [cf.id, cf]))
  const aliasToFieldId = new Map((payload.metricAliases ?? []).map((ma) => [ma.alias, ma.fieldId]))
  const fieldIdToIndex = new Map(columns.map((c, i) => [c.fieldId, i + 1]))

  for (const row of rows) {
    const values = columns.map((col) => {
      const cell = row.cells.find((c) => c.fieldId === col.fieldId)
      if (!cell || cell.isNull) return null
      if (cell.numberValue !== null) return cell.numberValue
      if (cell.booleanValue !== null) return cell.booleanValue
      if (cell.stringValue !== null) return neutralizeCellText(cell.stringValue)
      if (cell.dateValue !== null) return cell.dateValue
      return null
    })
    // Add the row FIRST so row numbers are stable, then overlay formulas.
    const addedRow = dataSheet.addRow(values)
    const rowNumber = addedRow.number
    // Apply AST-derived formulas for calculated columns (Contract C19).
    for (const col of columns) {
      if (!col.isCalculated) continue
      const calc = calcByFieldId.get(col.fieldId)
      if (!calc) continue
      const cell = row.cells.find((c) => c.fieldId === col.fieldId)
      if (!cell || cell.numberValue === null) continue
      let node: ExpressionNode
      try {
        node = parseExpression(calc.expression, new Set(aliasToFieldId.keys()))
      } catch {
        continue // value-only cell; never a raw expression
      }
      const resolveRef = (name: string): string | null => {
        const fieldId = aliasToFieldId.get(name)
        const index = fieldId ? fieldIdToIndex.get(fieldId) : undefined
        return index === undefined ? null : `${columnLetter(index)}${rowNumber}`
      }
      const formula = expressionToA1(node, resolveRef)
      if (formula === null) continue
      const colIndex = fieldIdToIndex.get(col.fieldId)
      if (colIndex === undefined) continue
      dataSheet.getCell(`${columnLetter(colIndex)}${rowNumber}`).value = {
        formula: `=${formula}`,
        result: cell.numberValue,
      }
    }
  }

  const headerRow = dataSheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  const lastColumn = columnLetter(columns.length)
  dataSheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (rows.length > 0) {
    dataSheet.autoFilter = { from: 'A1', to: `${lastColumn}${rows.length + 1}` }
  }
  columns.forEach((col, i) => {
    dataSheet.getColumn(i + 1).width = Math.min(Math.max(col.label.length + 4, 10), 40)
  })
}

function writeChartsSheet(
  workbook: ExcelJS.Workbook,
  payload: ScheduledReportPayload,
  chartPng: Buffer | null,
): void {
  const chartsSheet = workbook.addWorksheet('Charts')
  const viz = payload.visualization
  if (!viz || viz.type === 'TABLE') {
    chartsSheet.addRow(['Chart', 'No chart configured (table report)'])
    return
  }
  if (chartPng) {
    const imageId = workbook.addImage({
      buffer: chartPng as unknown as ExcelJS.Buffer,
      extension: 'png',
    })
    chartsSheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 480, height: 240 } })
  }
  chartsSheet.addRow([])
  // M6: chart metadata (title/labels are user-controlled) is
  // formula-neutralized — ordinary values pass through unchanged (C19).
  chartsSheet.addRow(['Chart type', neutralizeCellText(viz.type)])
  chartsSheet.addRow(['Chart title', neutralizeCellText(viz.title ?? '')])
  chartsSheet.addRow(['Series', 'Point', 'Value'])
  for (const series of payload.chartSeries) {
    for (const point of series.points) {
      chartsSheet.addRow([
        neutralizeCellText(series.label),
        neutralizeCellText(point.label),
        point.value ?? null,
      ])
    }
  }
  chartsSheet.getColumn(1).width = 24
  chartsSheet.getColumn(2).width = 30
  chartsSheet.getColumn(3).width = 16
}

function renderExcel(
  payload: ScheduledReportPayload,
  profile: RenderProfile,
  options: ReportAttachmentRenderOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CRMAssistant'
  workbook.created = new Date()

  const branding = sanitizeTenantBranding(options.branding)
  writeSummarySheet(workbook, payload, branding, profile)
  writeDataSheet(workbook, payload, profile)
  if (profile === 'USER_EXPORT') {
    writeChartsSheet(workbook, payload, options.chartPng ?? null)
  }

  return workbook.xlsx.writeBuffer().then((buf) => enforceByteLimit(Buffer.from(buf), profile))
}

// ─── CSV (pure serializer) ───────────────────────────────────────────────────

/**
 * RFC-style quoting for STRING values: formula-injection prefixes
 * (=, +, -, @, tab, CR) are neutralized with a leading apostrophe, and
 * fields containing comma/quote/newline are double-quoted.
 */
export function csvEscape(value: string): string {
  const guarded = neutralizeCellText(value)
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/**
 * Type-aware CSV cell serialization (I2): a FINITE numeric cell is written
 * as a raw numeric token — never quoted, never neutralized — so legitimate
 * negative numbers (`-5000`, `-12.5`) survive as numbers for Excel/parsers.
 * String cells keep full injection protection: a numeric-LOOKING string
 * (`'-5000`) is neutralized and stays safe text. Non-finite numbers and
 * nulls serialize to empty cells (defensive — renderers never produce them).
 */
export function csvCellValue(cell: ScheduledReportCell): string {
  if (cell.isNull) return ''
  if (cell.numberValue !== null) {
    return Number.isFinite(cell.numberValue) ? String(cell.numberValue) : ''
  }
  if (cell.stringValue !== null) return csvEscape(cell.stringValue)
  if (cell.booleanValue !== null) return cell.booleanValue ? 'true' : 'false'
  if (cell.dateValue !== null) return csvEscape(cell.dateValue)
  return ''
}

export function renderCsv(
  payload: ScheduledReportPayload,
  profile: RenderProfile = 'SCHEDULED_EMAIL',
): Buffer {
  const columns = boundColumns(payload, profile)
  const rows = boundRows(payload, profile)
  const lines: string[] = []
  lines.push(columns.map((c) => csvEscape(c.label)).join(','))
  for (const row of rows) {
    const values = columns.map((col) => {
      const cell = row.cells.find((c) => c.fieldId === col.fieldId)
      return cell ? csvCellValue(cell) : ''
    })
    lines.push(values.join(','))
  }
  const buffer = Buffer.from('\uFEFF' + lines.join('\n') + '\n', 'utf8') // UTF-8 BOM
  return enforceByteLimit(buffer, profile)
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ReportAttachmentService {
  async render(
    payload: ScheduledReportPayload,
    format: 'PDF' | 'EXCEL' | 'CSV',
    options: ReportAttachmentRenderOptions = {},
  ): Promise<ReportAttachment> {
    const profile = options.profile ?? 'SCHEDULED_EMAIL'
    const filename =
      profile === 'USER_EXPORT'
        ? exportRenderFilename(payload, format, payload.filterTokens, new Date(payload.generatedAt))
        : attachmentFilename(
            payload.reportName,
            payload.reportId,
            format,
            new Date(payload.generatedAt),
          )
    if (format === 'PDF') {
      const content = await renderPdf(payload, profile, options)
      return { filename, contentType: ATTACHMENT_CONTENT_TYPES.PDF, content }
    }
    if (format === 'EXCEL') {
      const content = await renderExcel(payload, profile, options)
      return { filename, contentType: ATTACHMENT_CONTENT_TYPES.EXCEL, content }
    }
    const content = renderCsv(payload, profile)
    return { filename, contentType: ATTACHMENT_CONTENT_TYPES.CSV, content }
  }
}

export { sanitizeTenantBranding }
export type { TenantBranding }
