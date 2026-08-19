/**
 * Story 6.6 (Contract C13-C15): shared report document payload.
 *
 * Common sales/custom normalization consumed by BOTH the Story 6.5 scheduled
 * email pipeline and the Story 6.6 user-triggered export pipeline — one
 * renderer input, never two divergent adapters. All values are plain
 * JSON-safe primitives; nulls are preserved (never coerced to zero).
 *
 * Pure module: no Nest imports, no Prisma imports — framework-free and
 * unit-testable in isolation.
 */
import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { SalesReportsService, type ReportData, type ReportRow } from './sales-reports.service'
import {
  CustomReportsService,
  type CustomReportCell,
  type CustomReportColumn,
  type CustomReportResult,
  type CustomReportRow,
  type CustomReportSeries,
  type CustomReportWarning,
} from './custom-reports.service'
import type { CustomReportConfig, CustomReportFilter } from './custom-report-types'
import { CUSTOM_REPORT_COLOR_TOKEN_HEX } from './custom-report-types'
import type { ReportConfig } from './report-config'
import { parseCustomReportConfig, type CustomConfigParseResult } from './custom-report-config'
import { isPlatformReportType } from './report-types'

/** Bounded full-export row window for scheduled custom reports (Contract D17). */
export const SCHEDULED_CUSTOM_REPORT_PAGE = 1
export const SCHEDULED_CUSTOM_REPORT_PAGE_SIZE = 100

/**
 * Non-transient attachment overflow. Thrown when the bounded custom-report
 * page is smaller than the full result — silent truncation is forbidden by
 * Contract D19. The canonical definition lives here (the lower-level module)
 * and is re-exported by `report-attachment.service.ts` so consumers can mark
 * the execution non-retryably against one shared error identity.
 */
export class AttachmentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentLimitError'
  }
}

export type ReportDocumentSummaryMetric = {
  key: string
  label: string
  value: number | null
  unit: 'CURRENCY' | 'COUNT' | 'PERCENT' | 'DAYS'
}

export type ReportDocumentColumn = CustomReportColumn

export type ReportDocumentCell = CustomReportCell

export type ReportDocumentRow = {
  key: string
  cells: ReportDocumentCell[]
}

export type ReportDocumentWarning = {
  code: string
  message: string
}

/** One normalized chart series point (server-renderer input). */
export type ReportDocumentChartPoint = {
  key: string
  label: string
  value: number | null
  dimensionLabels: string[]
}

export type ReportDocumentChartSeries = {
  metricId: string
  label: string
  points: ReportDocumentChartPoint[]
}

/** Closed server chart-artifact configuration derived from the saved config. */
export type ReportDocumentVisualization = {
  type: string // LINE|BAR|PIE|DONUT|AREA|FUNNEL|SCATTER|HEATMAP|TABLE
  title: string | null
  showLegend: boolean
  showDataLabels: boolean
  xAxisLabel: string | null
  yAxisLabel: string | null
  orientation: 'VERTICAL' | 'HORIZONTAL' | null
  colors: string[] // hex values from the approved palette
  legendPosition: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' | null
}

/**
 * Bounded, renderer-friendly snapshot of one report occurrence. Fields added
 * in Story 6.6 (filterSummary, dateRangeStart/End, visualization,
 * chartSeries) are populated by the shared builder for every consumer.
 */
export type ReportDocumentPayload = {
  reportId: string
  reportType: string // a sales ReportType or 'CUSTOM'
  reportName: string
  generatedAt: string // ISO UTC
  dateRangeLabel: string
  filterSummary: string // safe human-readable effective scope
  dateRangeStart: string | null // ISO YYYY-MM-DD when bounded
  dateRangeEnd: string | null
  // Short deterministic filename tokens derived from the immutable effective
  // filters (Contract C15) — sales scoping ids, custom non-date filter hash.
  // The human-readable filterSummary stays complete even when the filename
  // is capped/shortened.
  filterTokens: (string | null)[]
  summaryMetrics: ReportDocumentSummaryMetric[]
  columns: ReportDocumentColumn[]
  rows: ReportDocumentRow[]
  totalRows: number
  warnings: ReportDocumentWarning[]
  currency: string | null
  mixedCurrencies: boolean
  crmUrl: string
  visualization: ReportDocumentVisualization | null
  chartSeries: ReportDocumentChartSeries[]
  // Story 6.6 formula support (Contract C19): validated calculated-field
  // expressions and base-metric alias→column mapping for AST→A1 translation.
  calculatedFields: { id: string; alias: string; label: string | null; expression: string }[]
  metricAliases: { fieldId: string; alias: string }[]
}

// ─── ISO helpers ─────────────────────────────────────────────────────────────

function isoDateOnly(iso: string): string {
  return iso.slice(0, 10)
}

// ─── Sales normalization (moved verbatim from Story 6.5) ────────────────────

function salesRows(data: ReportData): ReportDocumentRow[] {
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

function salesColumns(): ReportDocumentColumn[] {
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

function salesSummary(data: ReportData): ReportDocumentSummaryMetric[] {
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

// ─── Custom normalization (moved verbatim from Story 6.5) ───────────────────

type CustomDateRange = { label: string | null; start: string | null; end: string | null }

function customDateRange(result: CustomReportResult): CustomDateRange {
  const dateFilters = result.config.filters.filter((f) =>
    ['BETWEEN', 'ON', 'BEFORE', 'AFTER'].includes(f.operator),
  )
  if (dateFilters.length === 0) return { label: null, start: null, end: null }
  const parts: string[] = []
  let start: string | null = null
  let end: string | null = null
  for (const filter of dateFilters.slice(0, 2)) {
    if (filter.operator === 'BETWEEN' && filter.dateValues && filter.dateValues.length >= 2) {
      const from = isoDateOnly(filter.dateValues[0]!)
      const to = isoDateOnly(filter.dateValues[1]!)
      parts.push(`${from} — ${to}`)
      if (start === null) start = from
      else if (start > from) start = from
      if (end === null) end = to
      else if (end < to) end = to
    } else if (filter.dateValue) {
      const day = isoDateOnly(filter.dateValue)
      const prefix =
        filter.operator === 'ON' ? 'on ' : filter.operator === 'BEFORE' ? 'before ' : 'after '
      parts.push(`${prefix}${day}`)
      if (filter.operator === 'ON') {
        if (start === null) start = day
        else if (start > day) start = day
        if (end === null) end = day
        else if (end < day) end = day
      } else if (filter.operator === 'AFTER') {
        if (start === null) start = day
        else if (start > day) start = day
      } else if (filter.operator === 'BEFORE') {
        if (end === null) end = day
        else if (end < day) end = day
      }
    }
  }
  return { label: parts.length > 0 ? parts.join('; ') : null, start, end }
}

function customSummary(result: CustomReportResult): ReportDocumentSummaryMetric[] {
  // Derive exact aggregates only where the aggregation engine's own series
  // supports it (COUNT/SUM over grouped points). AVERAGE/other metrics are
  // surfaced as null rather than fabricating a client-side sum of percentages
  // or averages (Contract D18).
  const metrics: ReportDocumentSummaryMetric[] = []
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

function customRows(result: CustomReportResult): ReportDocumentRow[] {
  return result.rows.map((row: CustomReportRow) => ({
    key: row.key,
    cells: row.cells.map((cell: CustomReportCell) => ({ ...cell })),
  }))
}

function customWarnings(result: CustomReportResult): ReportDocumentWarning[] {
  return result.warnings.map((warning: CustomReportWarning) => ({
    code: warning.code,
    message: warning.message,
  }))
}

// ─── Chart series / visualization normalization (Story 6.6) ──────────────────

function salesVisualization(): ReportDocumentVisualization {
  // Sales bucket reports render a deterministic server-side BAR chart over
  // the authoritative current-period buckets. Story 6.4's browser chart
  // remains the interactive surface; this is the closed document artifact.
  return {
    type: 'BAR',
    title: null,
    showLegend: true,
    showDataLabels: false,
    xAxisLabel: 'Period',
    yAxisLabel: 'Value',
    orientation: 'VERTICAL',
    colors: ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626'],
    legendPosition: 'BOTTOM',
  }
}

function salesChartSeries(data: ReportData): ReportDocumentChartSeries[] {
  return [
    {
      metricId: 'value',
      label: 'Value',
      points: data.current.buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        value: bucket.value,
        dimensionLabels: [bucket.label],
      })),
    },
  ]
}

function customVisualization(config: CustomReportConfig): ReportDocumentVisualization | null {
  const viz = config.visualization
  if (!viz || viz.type === 'TABLE') {
    return viz && viz.type === 'TABLE'
      ? {
          type: 'TABLE',
          title: viz.title ?? null,
          showLegend: false,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: null,
          colors: [],
          legendPosition: null,
        }
      : null
  }
  return {
    type: viz.type,
    title: viz.title ?? null,
    showLegend: viz.showLegend,
    showDataLabels: viz.showDataLabels,
    xAxisLabel: viz.xAxisLabel ?? null,
    yAxisLabel: viz.yAxisLabel ?? null,
    orientation: viz.orientation ?? null,
    colors: viz.colors.map((token) => CUSTOM_REPORT_COLOR_TOKEN_HEX[token]),
    legendPosition: viz.legendPosition ?? null,
  }
}

function customChartSeries(result: CustomReportResult): ReportDocumentChartSeries[] {
  return result.series.map((series: CustomReportSeries) => ({
    metricId: series.metricId,
    label: series.label,
    points: series.points.map((point) => ({
      key: point.key,
      label: point.label,
      value: point.value,
      dimensionLabels: point.dimensionLabels,
    })),
  }))
}

// ─── Filter summaries (Contract C15) ─────────────────────────────────────────

const PRESET_LABELS: Record<string, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  THIS_WEEK: 'This week',
  LAST_WEEK: 'Last week',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  THIS_QUARTER: 'This quarter',
  LAST_QUARTER: 'Last quarter',
  THIS_YEAR: 'This year',
  LAST_YEAR: 'Last year',
  ALL_TIME: 'All time',
  CUSTOM_RANGE: 'Custom range',
}

/** Human-readable effective sales filter scope (never raw config JSON). */
export function salesFilterSummary(config: ReportConfig): string {
  const parts: string[] = []
  const preset = config.datePreset ? PRESET_LABELS[config.datePreset] ?? config.datePreset : null
  if (config.startDate && config.endDate) {
    parts.push(`Dates: ${config.startDate} to ${config.endDate}`)
  } else if (preset) {
    parts.push(`Period: ${preset}`)
  }
  if (config.comparisonMode && config.comparisonMode !== 'NONE') {
    if (config.comparisonStartDate && config.comparisonEndDate) {
      parts.push(`Comparison: ${config.comparisonStartDate} to ${config.comparisonEndDate}`)
    } else {
      parts.push(`Comparison: ${config.comparisonMode}`)
    }
  }
  if (config.groupBy) parts.push(`Group by: ${config.groupBy}`)
  if (config.ownerId) parts.push('Owner filtered')
  if (config.teamId) parts.push('Team filtered')
  if (config.stageId) parts.push('Stage filtered')
  if (config.productId) parts.push('Product filtered')
  if (config.currency) parts.push(`Currency: ${config.currency}`)
  if (parts.length === 0) return 'All configured data'
  return parts.join('; ')
}

function customFilterSummary(result: CustomReportResult): string {
  const parts: string[] = []
  for (const filter of result.config.filters) {
    if (filter.operator === 'BETWEEN' && filter.dateValues && filter.dateValues.length >= 2) {
      parts.push(
        `${filter.fieldId} between ${isoDateOnly(filter.dateValues[0]!)} and ${isoDateOnly(filter.dateValues[1]!)}`,
      )
    } else if (filter.dateValue) {
      parts.push(
        `${filter.fieldId} ${filter.operator.toLowerCase()} ${isoDateOnly(filter.dateValue)}`,
      )
    } else if (filter.stringValue !== null && filter.stringValue !== undefined) {
      parts.push(`${filter.fieldId} ${filter.operator.toLowerCase()} "${filter.stringValue}"`)
    } else if (filter.numberValue !== null && filter.numberValue !== undefined) {
      parts.push(`${filter.fieldId} ${filter.operator.toLowerCase()} ${filter.numberValue}`)
    } else if (filter.stringValues && filter.stringValues.length > 0) {
      parts.push(`${filter.fieldId} in [${filter.stringValues.join(', ')}]`)
    }
  }
  if (parts.length === 0) return 'All configured data'
  return parts.join('; ')
}

// ─── Filename builder (Contract C15) ─────────────────────────────────────────

const FORMAT_EXTENSIONS = { PDF: 'pdf', EXCEL: 'xlsx', CSV: 'csv' } as const

function sanitizeNamePart(value: string, maxLength: number): string {
  return (
    value
      .toLowerCase()
      .replace(/[\u0000-\u001f\u007f/\\]+/g, '-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength) || 'report'
  )
}

/** Short deterministic filter token (e.g. `owner-a1b2c3d4`). */
export function shortIdToken(kind: string, id: string | null | undefined): string | null {
  if (!id) return null
  const cleaned = id.replace(/[^a-zA-Z0-9]/g, '')
  if (!cleaned) return null
  return `${kind}-${cleaned.slice(0, 8).toLowerCase()}`
}

/**
 * Deterministic filename: sanitized report name + effective date range +
 * short safe filter tokens. Unbounded date range → `as-of_YYYY-MM-DD`.
 * Basename is capped; path/control characters never survive.
 */
export function exportFilename(input: {
  reportName: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  filterTokens: (string | null)[]
  format: 'PDF' | 'EXCEL' | 'CSV'
  generatedAt: Date
  maxLength?: number
}): string {
  const maxLength = input.maxLength ?? 120
  const name = sanitizeNamePart(input.reportName, 40)
  const day = input.generatedAt.toISOString().slice(0, 10)
  const range =
    input.dateRangeStart && input.dateRangeEnd
      ? `${input.dateRangeStart}_to_${input.dateRangeEnd}`
      : `as-of_${day}`
  const tokens = input.filterTokens.filter((t): t is string => t !== null && t.length > 0)
  const ext = FORMAT_EXTENSIONS[input.format]
  let base = [name, range, ...tokens].join('_')
  if (base.length > maxLength) {
    base = `${base.slice(0, maxLength).replace(/[-_]+$/g, '')}`
  }
  return `${base}.${ext}`
}

// ─── Payload builder ─────────────────────────────────────────────────────────

/**
 * Builds a shared document payload from the authoritative execution results.
 * `report` must already be tenant/visibility-checked. Throws for unknown
 * report types (the processor turns that into a terminal outcome).
 */
export function buildReportDocumentPayload(input: {
  report: ReportRow
  reportData?: ReportData
  customReportData?: CustomReportResult
  crmUrl: string
  now?: Date
  /** page-1 metadata probe: allow a partial custom page without throwing */
  allowPartial?: boolean
}): ReportDocumentPayload {
  const { report, crmUrl } = input
  const generatedAt = (input.now ?? new Date()).toISOString()

  if (report.type !== 'CUSTOM') {
    const data = input.reportData
    if (!data) {
      throw new BadRequestException(`Report data not provided for type ${report.type}`)
    }
    const config = data.appliedFilters
    return {
      reportId: report.id,
      reportType: report.type,
      reportName: report.name,
      generatedAt,
      dateRangeLabel: salesDateRangeLabel(data),
      filterSummary: salesFilterSummary(config),
      dateRangeStart: isoDateOnly(data.current.startDate),
      dateRangeEnd: isoDateOnly(data.current.endDate),
      filterTokens: salesFilterTokens(config),
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
      visualization: salesVisualization(),
      chartSeries: salesChartSeries(data),
      calculatedFields: [],
      metricAliases: [],
    }
  }

  const result = input.customReportData
  if (!result) {
    throw new BadRequestException('Custom report data not provided')
  }
  if (result.totalRows > result.rows.length && !input.allowPartial) {
    throw new AttachmentLimitError(
      `Custom report has ${result.totalRows} rows but only ${result.rows.length} were loaded (page size ${SCHEDULED_CUSTOM_REPORT_PAGE_SIZE}); narrow the report to attach the full result`,
    )
  }
  const derived = customDateRange(result)
  return {
    reportId: report.id,
    reportType: 'CUSTOM',
    reportName: report.name,
    generatedAt,
    dateRangeLabel: derived.label ?? `All configured data as of ${isoDateOnly(generatedAt)}`,
    filterSummary: customFilterSummary(result),
    dateRangeStart: derived.start,
    dateRangeEnd: derived.end,
    filterTokens: customFilterTokens(result.config.filters),
    summaryMetrics: customSummary(result),
    columns: result.columns.map((c) => ({ ...c })),
    rows: customRows(result),
    totalRows: result.totalRows,
    warnings: customWarnings(result),
    currency: null,
    mixedCurrencies: result.warnings.some((w) => w.code === 'MIXED_CURRENCY'),
    crmUrl,
    visualization: customVisualization(result.config),
    chartSeries: customChartSeries(result),
    calculatedFields: result.config.calculatedFields.map((cf) => ({
      id: cf.id,
      alias: cf.alias,
      label: cf.label ?? null,
      expression: cf.expression,
    })),
    metricAliases: result.config.metrics.map((m) => ({ fieldId: m.id, alias: m.alias })),
  }
}

/** Sales-filter tokens for filenames from a validated effective config. */
export function salesFilterTokens(config: ReportConfig): (string | null)[] {
  return [
    shortIdToken('owner', config.ownerId),
    shortIdToken('team', config.teamId),
    shortIdToken('stage', config.stageId),
    shortIdToken('product', config.productId),
  ]
}

const CUSTOM_DATE_FILTER_OPERATORS = ['BETWEEN', 'ON', 'BEFORE', 'AFTER']

/**
 * Custom-filter tokens for filenames: one deterministic short hash over the
 * applied non-date filters. Date filters are already reflected in the date
 * range segment, so they are excluded — a report whose only filter is a date
 * range gets `as-of`/`_to_` segments and no redundant token. The hash is
 * derived from the immutable saved config filters, so replaying the same
 * snapshot always produces the same filename.
 */
export function customFilterTokens(filters: CustomReportFilter[]): (string | null)[] {
  const applied = filters.filter((f) => !CUSTOM_DATE_FILTER_OPERATORS.includes(f.operator))
  if (applied.length === 0) return []
  const hash = createHash('sha1').update(JSON.stringify(applied)).digest('hex').slice(0, 8)
  return [`filters-${hash}`]
}

export function salesCrmUrl(reportId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/reports/sales?reportId=${encodeURIComponent(reportId)}`
}

export function customCrmUrl(reportId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/reports/builder?reportId=${encodeURIComponent(reportId)}`
}

export function parseCustomReportConfigDefensively(raw: unknown): CustomConfigParseResult {
  return parseCustomReportConfig(raw)
}

export { isPlatformReportType }
export type { SalesReportsService, CustomReportsService, ReportRow }
