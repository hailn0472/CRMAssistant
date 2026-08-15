/**
 * Story 6.2 (AC 4-5, 42, 46): closed report vocabularies.
 *
 * Single-source const tuples. The TS unions below and every Pothos enum in
 * reports.graphql.ts derive from these tuples — never hand-copy a second
 * vocabulary (AC 55). Unknown persisted report types fail closed at run time
 * (AC 42) and drill targets are a closed vocabulary, never raw column names or
 * Prisma orderBy objects (AC 46).
 */

export const REPORT_TYPES = [
  'SALES_OVERVIEW',
  'PIPELINE_ANALYSIS',
  'WIN_LOSS',
  'REVENUE_FORECAST',
  'TEAM_PERFORMANCE',
  'DEAL_VELOCITY',
] as const

export type ReportType = (typeof REPORT_TYPES)[number]

/**
 * Story 6.3 (Contract C.22): the platform report vocabulary adds CUSTOM while
 * REPORT_TYPES stays the explicit six-value sales subset. CUSTOM reports are
 * never routed through the six-type sales calculation switch.
 */
export const PLATFORM_REPORT_TYPES = [...REPORT_TYPES, 'CUSTOM'] as const

export type PlatformReportType = (typeof PLATFORM_REPORT_TYPES)[number]

export const REPORT_GROUP_BY = ['MONTH', 'QUARTER', 'YEAR', 'OWNER', 'TEAM', 'PRODUCT'] as const

export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number]

export const COMPARISON_MODES = ['NONE', 'PREVIOUS_PERIOD', 'YEAR_OVER_YEAR', 'CUSTOM'] as const

export type ComparisonMode = (typeof COMPARISON_MODES)[number]

export const DATE_PRESETS = ['THIS_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'CUSTOM'] as const

export type DatePreset = (typeof DATE_PRESETS)[number]

export const REPORT_TREND_DIRECTIONS = ['UP', 'DOWN', 'FLAT'] as const

export type ReportTrendDirection = (typeof REPORT_TREND_DIRECTIONS)[number]

export const REPORT_DISPLAY_TOKENS = ['NONE', 'NEW'] as const

export type ReportDisplayToken = (typeof REPORT_DISPLAY_TOKENS)[number]

export const REPORT_DRILL_SCOPES = ['CURRENT', 'COMPARISON'] as const

export type ReportDrillScope = (typeof REPORT_DRILL_SCOPES)[number]

/**
 * Closed drill-target vocabulary (AC 46). Clients may only reference these
 * keys — never column names, Prisma orderBy objects or arbitrary predicates.
 */
export const REPORT_METRIC_KEYS = [
  'TOTAL_REVENUE',
  'WON_DEALS',
  'LOST_DEALS',
  'WIN_RATE',
  'AVERAGE_DEAL_SIZE',
  'OPEN_DEALS',
  'PIPELINE_VALUE',
  'WEIGHTED_PIPELINE_VALUE',
  'TOTAL_CLOSED',
  'WON_VALUE',
  'LOST_VALUE',
  'FORECAST_COMMIT',
  'FORECAST_BEST_CASE',
  'FORECAST_PIPELINE',
  'WON_REVENUE',
  'AVG_WON_DEAL_SIZE',
  'CLOSED_DEALS',
  'AVG_CYCLE_DAYS',
  'MEDIAN_CYCLE_DAYS',
  'EXCLUDED_ROWS',
] as const

export type ReportMetricKey = (typeof REPORT_METRIC_KEYS)[number]

/** Metrics that are drillable per report type (AC 47). */
export const REPORT_DRILL_METRICS: Record<ReportType, readonly ReportMetricKey[]> = {
  SALES_OVERVIEW: ['TOTAL_REVENUE', 'WON_DEALS', 'LOST_DEALS', 'AVERAGE_DEAL_SIZE'],
  PIPELINE_ANALYSIS: ['OPEN_DEALS', 'PIPELINE_VALUE', 'WEIGHTED_PIPELINE_VALUE'],
  WIN_LOSS: ['TOTAL_CLOSED', 'WON_DEALS', 'LOST_DEALS', 'WON_VALUE', 'LOST_VALUE'],
  REVENUE_FORECAST: ['FORECAST_COMMIT', 'FORECAST_BEST_CASE', 'FORECAST_PIPELINE', 'OPEN_DEALS'],
  TEAM_PERFORMANCE: ['WON_REVENUE', 'WON_DEALS', 'LOST_DEALS', 'AVG_WON_DEAL_SIZE'],
  DEAL_VELOCITY: ['CLOSED_DEALS'],
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value)
}

export function isPlatformReportType(value: unknown): value is PlatformReportType {
  return typeof value === 'string' && (PLATFORM_REPORT_TYPES as readonly string[]).includes(value)
}

export function isReportGroupBy(value: unknown): value is ReportGroupBy {
  return typeof value === 'string' && (REPORT_GROUP_BY as readonly string[]).includes(value)
}

export function isComparisonMode(value: unknown): value is ComparisonMode {
  return typeof value === 'string' && (COMPARISON_MODES as readonly string[]).includes(value)
}

export function isDatePreset(value: unknown): value is DatePreset {
  return typeof value === 'string' && (DATE_PRESETS as readonly string[]).includes(value)
}

export function isReportMetricKey(value: unknown): value is ReportMetricKey {
  return typeof value === 'string' && (REPORT_METRIC_KEYS as readonly string[]).includes(value)
}

export function isReportDrillScope(value: unknown): value is ReportDrillScope {
  return typeof value === 'string' && (REPORT_DRILL_SCOPES as readonly string[]).includes(value)
}
