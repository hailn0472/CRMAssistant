/**
 * Story 6.5 (Contract D19): internal attachment renderer for scheduled report
 * email. Produces valid branded PDF (PDFKit), XLSX (ExcelJS) and CSV files
 * containing title/date range/summary/data. Bounded rows/columns/bytes — an
 * overflow is an actionable non-transient failure, never silent truncation.
 * No storage/history row is created (Story 6.6 owns user-triggered export).
 */
import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

import type {
  ScheduledReportCell,
  ScheduledReportPayload,
  ScheduledReportRow,
} from './scheduled-report-payload.service'
import { salesCrmUrl, AttachmentLimitError } from './scheduled-report-payload.service'

export type ReportAttachment = {
  filename: string
  contentType: string
  content: Buffer
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_ATTACHMENT_ROWS = 5_000
export const MAX_ATTACHMENT_COLUMNS = 50

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

function boundRows(payload: ScheduledReportPayload): ScheduledReportRow[] {
  if (payload.rows.length > MAX_ATTACHMENT_ROWS) {
    throw new AttachmentLimitError(
      `Attachment row limit exceeded: ${payload.rows.length} > ${MAX_ATTACHMENT_ROWS}`,
    )
  }
  return payload.rows
}

function boundColumns(payload: ScheduledReportPayload): typeof payload.columns {
  if (payload.columns.length > MAX_ATTACHMENT_COLUMNS) {
    throw new AttachmentLimitError(
      `Attachment column limit exceeded: ${payload.columns.length} > ${MAX_ATTACHMENT_COLUMNS}`,
    )
  }
  return payload.columns
}

function enforceByteLimit(buffer: Buffer): Buffer {
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentLimitError(
      `Attachment size limit exceeded: ${buffer.length} bytes > ${MAX_ATTACHMENT_BYTES}`,
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

// ─── PDF (PDFKit) ────────────────────────────────────────────────────────────

function renderPdf(payload: ScheduledReportPayload): Promise<Buffer> {
  // compress:false keeps streams deterministic and text-assertable in tests.
  const doc = new PDFDocument({ size: 'A4', margin: 48, compress: false })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

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

  doc.fontSize(12).text('Data')
  const columns = boundColumns(payload)
  const rows = boundRows(payload)
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
  doc.end()
  return done.then((buffer) => enforceByteLimit(buffer))
}

// ─── Excel (ExcelJS) ─────────────────────────────────────────────────────────

function renderExcel(payload: ScheduledReportPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CRMAssistant'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['Report', payload.reportName])
  summarySheet.addRow(['Date range', payload.dateRangeLabel])
  summarySheet.addRow(['Generated', new Date(payload.generatedAt).toISOString()])
  if (payload.currency) summarySheet.addRow(['Currency', payload.currency])
  summarySheet.addRow(['View in CRM', payload.crmUrl])
  summarySheet.addRow([])
  summarySheet.addRow(['Metric', 'Value'])
  for (const m of payload.summaryMetrics) {
    summarySheet.addRow([m.label, m.value === null ? null : m.value])
  }
  summarySheet.getColumn(1).width = 24
  summarySheet.getColumn(2).width = 28

  const columns = boundColumns(payload)
  const rows = boundRows(payload)
  const dataSheet = workbook.addWorksheet('Data')
  dataSheet.addRow(columns.map((c) => c.label))
  for (const row of rows) {
    dataSheet.addRow(
      columns.map((col) => {
        const cell = row.cells.find((c) => c.fieldId === col.fieldId)
        if (!cell || cell.isNull) return null
        if (cell.numberValue !== null) return cell.numberValue
        if (cell.booleanValue !== null) return cell.booleanValue
        if (cell.stringValue !== null) return neutralizeCellText(cell.stringValue)
        if (cell.dateValue !== null) return cell.dateValue
        return null
      }),
    )
  }
  dataSheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer().then((buf) => enforceByteLimit(Buffer.from(buf)))
}

// ─── CSV (pure serializer) ───────────────────────────────────────────────────

/** RFC-style quoting: quote when the field contains comma/quote/newline. */
export function csvEscape(value: string): string {
  const guarded = neutralizeCellText(value)
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

export function renderCsv(payload: ScheduledReportPayload): Buffer {
  const columns = boundColumns(payload)
  const rows = boundRows(payload)
  const lines: string[] = []
  lines.push(columns.map((c) => csvEscape(c.label)).join(','))
  for (const row of rows) {
    const values = columns.map((col) => {
      const cell = row.cells.find((c) => c.fieldId === col.fieldId)
      const value = cell ? cellDisplayValue(cell) : null
      return value === null ? '' : csvEscape(String(value))
    })
    lines.push(values.join(','))
  }
  const buffer = Buffer.from('\uFEFF' + lines.join('\n') + '\n', 'utf8') // UTF-8 BOM
  return enforceByteLimit(buffer)
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ReportAttachmentService {
  async render(
    payload: ScheduledReportPayload,
    format: 'PDF' | 'EXCEL' | 'CSV',
  ): Promise<ReportAttachment> {
    const filename = attachmentFilename(
      payload.reportName,
      payload.reportId,
      format,
      new Date(payload.generatedAt),
    )
    if (format === 'PDF') {
      const content = await renderPdf(payload)
      return { filename, contentType: ATTACHMENT_CONTENT_TYPES.PDF, content }
    }
    if (format === 'EXCEL') {
      const content = await renderExcel(payload)
      return { filename, contentType: ATTACHMENT_CONTENT_TYPES.EXCEL, content }
    }
    const content = renderCsv(payload)
    return { filename, contentType: ATTACHMENT_CONTENT_TYPES.CSV, content }
  }
}

export { salesCrmUrl, AttachmentLimitError }
