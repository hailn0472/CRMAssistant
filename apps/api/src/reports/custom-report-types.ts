/**
 * Story 6.3 (Contract A-B): closed custom-report vocabularies and the typed
 * CustomReportConfig shape.
 *
 * Single-source const tuples. Every TS union below and every Pothos enum in
 * reports.graphql.ts derives from these tuples — never hand-copy a second
 * vocabulary. The strict validator (custom-report-config.ts), the field
 * catalogue (custom-report-catalog.ts) and the execution engine
 * (custom-reports.service.ts) all consume these same definitions.
 */

export const CUSTOM_REPORT_DATA_SOURCES = ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const
export type CustomReportDataSource = (typeof CUSTOM_REPORT_DATA_SOURCES)[number]

export const CUSTOM_REPORT_AGGREGATIONS = [
  'COUNT',
  'DISTINCT_COUNT',
  'SUM',
  'AVERAGE',
  'MIN',
  'MAX',
] as const
export type CustomReportAggregation = (typeof CUSTOM_REPORT_AGGREGATIONS)[number]

export const CUSTOM_REPORT_GRANULARITIES = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const
export type CustomReportGranularity = (typeof CUSTOM_REPORT_GRANULARITIES)[number]

export const CUSTOM_REPORT_CHART_TYPES = [
  'TABLE',
  'LINE',
  'BAR',
  'PIE',
  'DONUT',
  'AREA',
  'FUNNEL',
  'SCATTER',
  'HEATMAP',
] as const
export type CustomReportChartType = (typeof CUSTOM_REPORT_CHART_TYPES)[number]

export const CUSTOM_REPORT_LEGEND_POSITIONS = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const
export type CustomReportLegendPosition = (typeof CUSTOM_REPORT_LEGEND_POSITIONS)[number]

/**
 * Story 6.4 (Contract A.1): closed color-token vocabulary mapped to the
 * approved shared chart palette. The web stage maps each token to its hex;
 * arbitrary CSS colors never reach the DOM/SVG. Token order doubles as the
 * default series order.
 */
export const CUSTOM_REPORT_COLOR_TOKENS = [
  'BLUE',
  'VIOLET',
  'GREEN',
  'AMBER',
  'RED',
  'CYAN',
  'PINK',
  'LIME',
  'INDIGO',
  'TEAL',
] as const
export type CustomReportColorToken = (typeof CUSTOM_REPORT_COLOR_TOKENS)[number]

/** Approved shared chart palette (hex) in token order — single source of truth. */
export const CUSTOM_REPORT_COLOR_TOKEN_HEX: Record<CustomReportColorToken, string> = {
  BLUE: '#2563eb',
  VIOLET: '#7c3aed',
  GREEN: '#059669',
  AMBER: '#d97706',
  RED: '#dc2626',
  CYAN: '#0891b2',
  PINK: '#db2777',
  LIME: '#65a30d',
  INDIGO: '#4f46e5',
  TEAL: '#0f766e',
}

/** Empty `colors` input normalizes to this full default palette (Contract A.2). */
export const CUSTOM_REPORT_DEFAULT_COLORS: readonly CustomReportColorToken[] = [
  ...CUSTOM_REPORT_COLOR_TOKENS,
]

export const CUSTOM_REPORT_VALUE_TYPES = [
  'STRING',
  'NUMBER',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'ENUM',
  'RELATION',
  'TAGS',
  'CURRENCY',
] as const
export type CustomReportValueType = (typeof CUSTOM_REPORT_VALUE_TYPES)[number]

export const CUSTOM_REPORT_FILTER_OPERATORS = [
  'EQ',
  'NOT_EQ',
  'CONTAINS',
  'IN',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'BETWEEN',
  'ON',
  'BEFORE',
  'AFTER',
  'HAS_ANY',
  'HAS_ALL',
] as const
export type CustomReportFilterOperator = (typeof CUSTOM_REPORT_FILTER_OPERATORS)[number]

export const CUSTOM_REPORT_SORT_DIRECTIONS = ['ASC', 'DESC'] as const
export type CustomReportSortDirection = (typeof CUSTOM_REPORT_SORT_DIRECTIONS)[number]

export const CUSTOM_REPORT_ORIENTATIONS = ['VERTICAL', 'HORIZONTAL'] as const
export type CustomReportOrientation = (typeof CUSTOM_REPORT_ORIENTATIONS)[number]

export const CUSTOM_REPORT_FIELD_ROLES = ['FILTER', 'DIMENSION', 'METRIC'] as const
export type CustomReportFieldRole = (typeof CUSTOM_REPORT_FIELD_ROLES)[number]

export const CUSTOM_REPORT_CALCULATED_DIMENSION_KINDS = ['DATE_PART', 'NUMBER_BUCKET'] as const
export type CustomReportCalculatedDimensionKind =
  (typeof CUSTOM_REPORT_CALCULATED_DIMENSION_KINDS)[number]

export const CUSTOM_REPORT_COLUMN_ROLES = ['DIMENSION', 'METRIC'] as const
export type CustomReportColumnRole = (typeof CUSTOM_REPORT_COLUMN_ROLES)[number]

export const CUSTOM_REPORT_RELATION_KINDS = [
  'OWNER',
  'TEAM',
  'STAGE',
  'CONTACT',
  'PRODUCT',
  'CREATOR',
  'ASSIGNEE',
  'DEAL',
] as const
export type CustomReportRelationKind = (typeof CUSTOM_REPORT_RELATION_KINDS)[number]

export const CUSTOM_REPORT_WARNING_CODES = [
  'DIVISION_BY_ZERO',
  'NON_FINITE_RESULT',
  'MIXED_CURRENCY',
  'INVALID_SAVED_CONFIG',
] as const
export type CustomReportWarningCode = (typeof CUSTOM_REPORT_WARNING_CODES)[number]

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isCustomReportDataSource(value: unknown): value is CustomReportDataSource {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_DATA_SOURCES as readonly string[]).includes(value)
  )
}

export function isCustomReportAggregation(value: unknown): value is CustomReportAggregation {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_AGGREGATIONS as readonly string[]).includes(value)
  )
}

export function isCustomReportGranularity(value: unknown): value is CustomReportGranularity {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_GRANULARITIES as readonly string[]).includes(value)
  )
}

export function isCustomReportChartType(value: unknown): value is CustomReportChartType {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_CHART_TYPES as readonly string[]).includes(value)
  )
}

export function isCustomReportLegendPosition(value: unknown): value is CustomReportLegendPosition {
  return (
    typeof value === 'string' &&
    (CUSTOM_REPORT_LEGEND_POSITIONS as readonly string[]).includes(value)
  )
}

export function isCustomReportColorToken(value: unknown): value is CustomReportColorToken {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_COLOR_TOKENS as readonly string[]).includes(value)
  )
}

export function isCustomReportFilterOperator(value: unknown): value is CustomReportFilterOperator {
  return (
    typeof value === 'string' &&
    (CUSTOM_REPORT_FILTER_OPERATORS as readonly string[]).includes(value)
  )
}

export function isCustomReportSortDirection(value: unknown): value is CustomReportSortDirection {
  return (
    typeof value === 'string' &&
    (CUSTOM_REPORT_SORT_DIRECTIONS as readonly string[]).includes(value)
  )
}

export function isCustomReportOrientation(value: unknown): value is CustomReportOrientation {
  return (
    typeof value === 'string' && (CUSTOM_REPORT_ORIENTATIONS as readonly string[]).includes(value)
  )
}

export function isCustomReportCalculatedDimensionKind(
  value: unknown,
): value is CustomReportCalculatedDimensionKind {
  return (
    typeof value === 'string' &&
    (CUSTOM_REPORT_CALCULATED_DIMENSION_KINDS as readonly string[]).includes(value)
  )
}

// ─── Typed config shape (persisted in Report.config for type='CUSTOM') ───────

export interface CustomReportFilter {
  id: string
  fieldId: string
  operator: CustomReportFilterOperator
  /** Exactly one typed value slot is non-null — enforced by the strict validator. */
  stringValue: string | null
  numberValue: number | null
  booleanValue: boolean | null
  dateValue: string | null
  stringValues: string[] | null
  numberValues: number[] | null
  dateValues: string[] | null
}

export type CustomReportCalculatedDimension =
  | {
      kind: 'DATE_PART'
      sourceFieldId: string
      granularity: CustomReportGranularity
    }
  | {
      kind: 'NUMBER_BUCKET'
      sourceFieldId: string
      bucketSize: number
    }

export interface CustomReportDimension {
  id: string
  /** Catalogue field key — non-null for catalogue dimensions, null when calculated. */
  fieldId: string | null
  calculation: CustomReportCalculatedDimension | null
  /** Required for date/datetime dimensions. */
  granularity: CustomReportGranularity | null
}

export interface CustomReportMetric {
  id: string
  fieldId: string
  aggregation: CustomReportAggregation
  /** Effective alias used by calculated-field expressions; defaults to the id. */
  alias: string
}

export interface CustomReportCalculatedField {
  id: string
  alias: string
  label: string | null
  expression: string
}

export interface CustomReportVisualization {
  type: CustomReportChartType
  title: string | null
  showLegend: boolean
  showDataLabels: boolean
  xAxisLabel: string | null
  yAxisLabel: string | null
  /** Only valid for BAR; v2 normalizes a missing BAR orientation to VERTICAL. */
  orientation: CustomReportOrientation | null
  /** 1–10 approved tokens in series order; empty input normalizes to the default palette. */
  colors: CustomReportColorToken[]
  legendPosition: CustomReportLegendPosition
}

/** Story 6.3 persisted v1 visualization shape (no colors/legendPosition). */
export interface CustomReportVisualizationV1 {
  type: CustomReportChartType
  title: string | null
  showLegend: boolean
  showDataLabels: boolean
  xAxisLabel: string | null
  yAxisLabel: string | null
  /** Only valid for BAR. */
  orientation: CustomReportOrientation | null
}

export interface CustomReportSort {
  id: string
  /** References a selected dimension/metric/calculated field id. */
  targetId: string
  direction: CustomReportSortDirection
}

export interface CustomReportConfig {
  /** In-memory configs are always normalized v2 (v1 input is normalized on load). */
  version: 2
  dataSource: CustomReportDataSource
  filters: CustomReportFilter[]
  dimensions: CustomReportDimension[]
  metrics: CustomReportMetric[]
  calculatedFields: CustomReportCalculatedField[]
  visualization: CustomReportVisualization
  sort: CustomReportSort[]
}

/** The persisted Story 6.3 v1 config shape (accepted for read + lazy re-save). */
export interface CustomReportConfigV1 {
  version: 1
  dataSource: CustomReportDataSource
  filters: CustomReportFilter[]
  dimensions: CustomReportDimension[]
  metrics: CustomReportMetric[]
  calculatedFields: CustomReportCalculatedField[]
  visualization: CustomReportVisualizationV1
  sort: CustomReportSort[]
}

export const CUSTOM_REPORT_CONFIG_VERSION = 2
export const CUSTOM_REPORT_CONFIG_VERSION_V1 = 1
