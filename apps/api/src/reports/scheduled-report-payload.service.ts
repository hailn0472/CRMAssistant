/**
 * Story 6.5 (Contract D17-D18): scheduled-delivery payload adapter.
 *
 * Dispatches the unified Report row into the authoritative execution paths —
 * `SalesReportsService.reportData` for the six sales types and
 * `CustomReportsService.customReportData` for CUSTOM — and converts their typed
 * results into one bounded `ScheduledReportPayload` for the attachment renderer
 * and the email template. Never duplicates metric/filter/grouping/currency or
 * visibility logic.
 */
import { BadRequestException, Injectable, Optional } from '@nestjs/common'

import { SalesReportsService, type ReportData, type ReportRow } from './sales-reports.service'
import {
  CustomReportsService,
  type CustomReportCell,
  type CustomReportColumn,
  type CustomReportResult,
  type CustomReportRow,
  type CustomReportWarning,
} from './custom-reports.service'
import type { CustomReportDataSource } from './custom-report-types'
import { isPlatformReportType } from './report-types'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'

/** Bounded full-export row window for scheduled custom reports (Contract D17). */
export const SCHEDULED_CUSTOM_REPORT_PAGE = 1
export const SCHEDULED_CUSTOM_REPORT_PAGE_SIZE = 100

/**
 * Non-transient attachment overflow. Thrown when the bounded custom-report
 * page is smaller than the full result — silent truncation is forbidden by
 * Contract D19. The canonical definition lives here (the lower-level module)
 * and is re-exported by `report-attachment.service.ts` so the processor can
 * mark the execution non-retryably against one shared error identity.
 */
export class AttachmentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentLimitError'
  }
}

export type ScheduledReportSummaryMetric = {
  key: string
  label: string
  value: number | null
  unit: 'CURRENCY' | 'COUNT' | 'PERCENT' | 'DAYS'
}

export type ScheduledReportColumn = CustomReportColumn

export type ScheduledReportCell = CustomReportCell

export type ScheduledReportRow = {
  key: string
  cells: ScheduledReportCell[]
}

export type ScheduledReportWarning = {
  code: string
  message: string
}

/**
 * Bounded, renderer-friendly snapshot of one scheduled occurrence. All values
 * are plain JSON-safe primitives; nulls are preserved (never coerced to zero).
 */
export type ScheduledReportPayload = {
  reportId: string
  reportType: string // a sales ReportType or 'CUSTOM'
  reportName: string
  generatedAt: string // ISO UTC
  dateRangeLabel: string
  summaryMetrics: ScheduledReportSummaryMetric[]
  columns: ScheduledReportColumn[]
  rows: ScheduledReportRow[]
  totalRows: number
  warnings: ScheduledReportWarning[]
  currency: string | null
  mixedCurrencies: boolean
  crmUrl: string
}

function isoDateOnly(iso: string): string {
  return iso.slice(0, 10)
}

function salesRows(data: ReportData): ScheduledReportRow[] {
  return data.current.buckets.map((bucket) => ({
    key: bucket.key,
    cells: [
      {
        fieldId: 'bucket.label',
        label: 'Period',
        valueType: 'STRING',
        stringValue: bucket.label,
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
        numberValue: bucket.value,
        booleanValue: null,
        dateValue: null,
        isNull: bucket.value === null,
      },
      {
        fieldId: 'bucket.count',
        label: 'Deals',
        valueType: 'NUMBER',
        stringValue: null,
        numberValue: bucket.count,
        booleanValue: null,
        dateValue: null,
        isNull: false,
      },
      {
        fieldId: 'bucket.comparisonValue',
        label: 'Comparison',
        valueType: 'CURRENCY',
        stringValue: null,
        numberValue: bucket.comparisonValue,
        booleanValue: null,
        dateValue: null,
        isNull: bucket.comparisonValue === null,
      },
      {
        fieldId: 'bucket.percentageChange',
        label: 'Change %',
        valueType: 'NUMBER',
        stringValue: null,
        numberValue: bucket.percentageChange,
        booleanValue: null,
        dateValue: null,
        isNull: bucket.percentageChange === null,
      },
    ],
  }))
}

function salesColumns(): ScheduledReportColumn[] {
  return [
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
    {
      fieldId: 'bucket.count',
      label: 'Deals',
      valueType: 'NUMBER',
      role: 'METRIC',
      aggregation: 'COUNT',
      granularity: null,
      isCalculated: false,
    },
    {
      fieldId: 'bucket.comparisonValue',
      label: 'Comparison',
      valueType: 'CURRENCY',
      role: 'METRIC',
      aggregation: 'SUM',
      granularity: null,
      isCalculated: false,
    },
    {
      fieldId: 'bucket.percentageChange',
      label: 'Change %',
      valueType: 'NUMBER',
      role: 'METRIC',
      aggregation: null,
      granularity: null,
      isCalculated: true,
    },
  ]
}

function salesSummary(data: ReportData): ScheduledReportSummaryMetric[] {
  // Sales metrics are authoritative current-period metrics — never re-derived.
  return data.current.metrics.map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: metric.value,
    unit: metric.unit,
  }))
}

function salesDateRangeLabel(data: ReportData): string {
  return `${isoDateOnly(data.current.startDate)} — ${isoDateOnly(data.current.endDate)}`
}

function customDateRangeLabel(result: CustomReportResult): string | null {
  const dateFilters = result.config.filters.filter((f) =>
    ['BETWEEN', 'ON', 'BEFORE', 'AFTER'].includes(f.operator),
  )
  if (dateFilters.length === 0) return null
  const parts: string[] = []
  for (const filter of dateFilters.slice(0, 2)) {
    if (filter.operator === 'BETWEEN' && filter.dateValues && filter.dateValues.length >= 2) {
      parts.push(`${isoDateOnly(filter.dateValues[0])} — ${isoDateOnly(filter.dateValues[1])}`)
    } else if (filter.dateValue) {
      const prefix =
        filter.operator === 'ON' ? 'on ' : filter.operator === 'BEFORE' ? 'before ' : 'after '
      parts.push(`${prefix}${isoDateOnly(filter.dateValue)}`)
    }
  }
  return parts.length > 0 ? parts.join('; ') : null
}

function customSummary(result: CustomReportResult): ScheduledReportSummaryMetric[] {
  // Derive exact aggregates only where the aggregation engine's own series
  // supports it (COUNT/SUM over grouped points). AVERAGE/other metrics are
  // surfaced as null rather than fabricating a client-side sum of percentages
  // or averages (Contract D18).
  const metrics: ScheduledReportSummaryMetric[] = []
  const byMetricId = new Map(result.series.map((s) => [s.metricId, s]))
  for (const metric of result.config.metrics) {
    const series = byMetricId.get(metric.id)
    let value: number | null = null
    if (series && (metric.aggregation === 'COUNT' || metric.aggregation === 'SUM')) {
      const total = series.points.reduce<number>((acc, p) => acc + (p.value ?? 0), 0)
      value = Number.isFinite(total) ? Math.round(total * 100) / 100 : null
    }
    metrics.push({
      key: metric.id,
      label: metric.alias || metric.fieldId,
      value,
      unit:
        metric.fieldId.startsWith('deal.') && /value|amount|price/i.test(metric.fieldId)
          ? 'CURRENCY'
          : 'COUNT',
    })
  }
  metrics.push({ key: 'totalRows', label: 'Total rows', value: result.totalRows, unit: 'COUNT' })
  return metrics
}

function customRows(result: CustomReportResult): ScheduledReportRow[] {
  return result.rows.map((row: CustomReportRow) => ({
    key: row.key,
    cells: row.cells.map((cell: CustomReportCell) => ({ ...cell })),
  }))
}

function customWarnings(result: CustomReportResult): ScheduledReportWarning[] {
  return result.warnings.map((warning: CustomReportWarning) => ({
    code: warning.code,
    message: warning.message,
  }))
}

/**
 * Builds a bounded payload for one schedule occurrence under the schedule
 * owner's CURRENT identity, so own/team/all and sharing scope stay current
 * (Contract C15, E26). Throws for unknown report types (the processor turns
 * that into a non-retryable SKIPPED + deactivation).
 */
export function buildScheduledReportPayload(input: {
  report: ReportRow
  reportData?: ReportData
  customReportData?: CustomReportResult
  crmUrl: string
  now?: Date
}): ScheduledReportPayload {
  const { report, crmUrl } = input
  const generatedAt = (input.now ?? new Date()).toISOString()

  if (report.type !== 'CUSTOM') {
    const data = input.reportData
    if (!data) {
      throw new BadRequestException(`Report data not provided for type ${report.type}`)
    }
    return {
      reportId: report.id,
      reportType: report.type,
      reportName: report.name,
      generatedAt,
      dateRangeLabel: salesDateRangeLabel(data),
      summaryMetrics: salesSummary(data),
      columns: salesColumns(),
      rows: salesRows(data),
      totalRows: data.current.buckets.length,
      warnings: data.mixedCurrencies
        ? [{ code: 'MIXED_CURRENCY', message: 'Mixed currencies detected — money values are null' }]
        : [],
      currency: data.currency,
      mixedCurrencies: data.mixedCurrencies,
      crmUrl,
    }
  }

  const result = input.customReportData
  if (!result) {
    throw new BadRequestException('Custom report data not provided')
  }
  if (result.totalRows > result.rows.length) {
    throw new AttachmentLimitError(
      `Custom report has ${result.totalRows} rows but only ${result.rows.length} were loaded (page size ${SCHEDULED_CUSTOM_REPORT_PAGE_SIZE}); narrow the report to attach the full result`,
    )
  }
  const derivedLabel = customDateRangeLabel(result)
  return {
    reportId: report.id,
    reportType: 'CUSTOM',
    reportName: report.name,
    generatedAt,
    dateRangeLabel: derivedLabel ?? `All configured data as of ${isoDateOnly(generatedAt)}`,
    summaryMetrics: customSummary(result),
    columns: result.columns.map((c) => ({ ...c })),
    rows: customRows(result),
    totalRows: result.totalRows,
    warnings: customWarnings(result),
    currency: null,
    mixedCurrencies: result.warnings.some((w) => w.code === 'MIXED_CURRENCY'),
    crmUrl,
  }
}

export function salesCrmUrl(reportId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/reports/sales?reportId=${encodeURIComponent(reportId)}`
}

export function customCrmUrl(reportId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/reports/builder?reportId=${encodeURIComponent(reportId)}`
}

@Injectable()
export class ScheduledReportPayloadService {
  constructor(
    private readonly salesReportsService: SalesReportsService,
    private readonly customReportsService: CustomReportsService,
    // Injectable clock so generatedAt is deterministic in processor tests
    // (Contract E25) instead of wall-clock `new Date()`.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  /**
   * Executes the saved report under the owner's identity and builds the
   * bounded payload. `report` must already be tenant/visibility-checked.
   */
  async buildForReport(
    tenantId: string,
    ownerId: string,
    report: ReportRow,
    baseUrl: string,
  ): Promise<ScheduledReportPayload> {
    if (!isPlatformReportType(report.type)) {
      throw new BadRequestException(`Unsupported report type: ${report.type}`)
    }
    if (report.type === 'CUSTOM') {
      const result = await this.customReportsService.customReportData(
        tenantId,
        ownerId,
        report.id,
        { page: SCHEDULED_CUSTOM_REPORT_PAGE, pageSize: SCHEDULED_CUSTOM_REPORT_PAGE_SIZE },
      )
      return buildScheduledReportPayload({
        report,
        customReportData: result,
        crmUrl: customCrmUrl(report.id, baseUrl),
        now: this.clock.now(),
      })
    }
    const data = await this.salesReportsService.reportData(tenantId, ownerId, report.id)
    return buildScheduledReportPayload({
      report,
      reportData: data,
      crmUrl: salesCrmUrl(report.id, baseUrl),
      now: this.clock.now(),
    })
  }

  /** Background loader with the same owner-or-public visibility rule. */
  async loadReport(tenantId: string, ownerId: string, reportId: string): Promise<ReportRow | null> {
    try {
      return await this.salesReportsService.report(tenantId, ownerId, reportId)
    } catch {
      return null
    }
  }

  /** Background custom-source resolution for the source-domain read gate. */
  async resolveCustomSource(
    tenantId: string,
    ownerId: string,
    reportId: string,
  ): Promise<CustomReportDataSource> {
    return this.customReportsService.resolveReportDataSource(tenantId, ownerId, reportId)
  }
}
