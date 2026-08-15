/**
 * Story 6.2 (AC 6-7): framework-free ReportConfig module.
 *
 * Mirrors the Story 6.1 Widget.config typed-JSON precedent (widget-config.ts):
 * - validateReportConfig (write path) is STRICT — throws on malformed writes,
 *   unknown keys, unknown vocabularies, impossible date ranges and invalid
 *   custom-comparison dates.
 * - parseReportConfig (read path) is DEFENSIVE — never throws; returns safe
 *   type-specific defaults for a corrupt persisted row so one bad row can
 *   never blank the report list.
 *
 * Dates cross GraphQL as ISO YYYY-MM-DD strings; raw config JSON never does.
 */
import { isReportType, isReportGroupBy, isComparisonMode, isDatePreset } from './report-types'
import type { ReportType, ReportGroupBy, ComparisonMode, DatePreset } from './report-types'
import {
  daysInclusive,
  parseIsoDay,
  assertMaxRangeMonths,
  resolveCurrentRange,
} from './report-periods'

export interface ReportConfig {
  datePreset: DatePreset
  startDate: string | null
  endDate: string | null
  comparisonMode: ComparisonMode
  comparisonStartDate: string | null
  comparisonEndDate: string | null
  groupBy: ReportGroupBy
  ownerId: string | null
  teamId: string | null
  stageId: string | null
  productId: string | null
  currency: string | null
}

export const MAX_ACTIVE_REPORTS_PER_CREATOR = 50
export const MAX_REPORT_NAME_LENGTH = 120

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime())
}

function parseOptionalIsoDay(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (!isValidIsoDay(value)) {
    throw new Error(`Report config ${label} must be an ISO YYYY-MM-DD date`)
  }
  return value
}

function validateDatePair(
  start: string | null,
  end: string | null,
  labelStart: string,
  labelEnd: string,
  maxMonthsCheck = true,
): void {
  if (start === null && end === null) return
  if (start === null || end === null) {
    throw new Error(`Report config requires both ${labelStart} and ${labelEnd}`)
  }
  const startDate = parseIsoDay(start, labelStart)
  const endDate = parseIsoDay(end, labelEnd)
  if (endDate < startDate) {
    throw new Error(`Report config ${labelEnd} must be >= ${labelStart}`)
  }
  if (maxMonthsCheck) {
    assertMaxRangeMonths(startDate, endDate)
  }
}

/** Strict write-path validation (AC 6-7). Throws on any malformed input. */
export function validateReportConfig(raw: unknown, now: Date = new Date()): ReportConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Report config must be an object')
  }

  const ALLOWED_KEYS = [
    'datePreset',
    'startDate',
    'endDate',
    'comparisonMode',
    'comparisonStartDate',
    'comparisonEndDate',
    'groupBy',
    'ownerId',
    'teamId',
    'stageId',
    'productId',
    'currency',
  ] as const

  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Report config has unknown key: ${key}`)
    }
  }

  if (!isDatePreset(obj.datePreset)) {
    throw new Error('Report config datePreset is required and must be a valid DatePreset')
  }
  if (!isComparisonMode(obj.comparisonMode)) {
    throw new Error('Report config comparisonMode is required and must be a valid ComparisonMode')
  }
  if (!isReportGroupBy(obj.groupBy)) {
    throw new Error('Report config groupBy is required and must be a valid ReportGroupBy')
  }

  const startDate = parseOptionalIsoDay(obj.startDate, 'startDate')
  const endDate = parseOptionalIsoDay(obj.endDate, 'endDate')
  const comparisonStartDate = parseOptionalIsoDay(obj.comparisonStartDate, 'comparisonStartDate')
  const comparisonEndDate = parseOptionalIsoDay(obj.comparisonEndDate, 'comparisonEndDate')

  if (obj.datePreset === 'CUSTOM') {
    validateDatePair(startDate, endDate, 'startDate', 'endDate')
  }

  const optionalId = (value: unknown, label: string): string | null => {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Report config ${label} must be a non-empty string`)
    }
    return value
  }

  const currencyRaw = obj.currency
  let currency: string | null = null
  if (currencyRaw !== undefined && currencyRaw !== null) {
    if (typeof currencyRaw !== 'string' || currencyRaw.trim().length === 0) {
      throw new Error('Report config currency must be a non-empty string')
    }
    currency = currencyRaw.trim().toUpperCase()
  }

  if (obj.comparisonMode === 'CUSTOM') {
    if (comparisonStartDate === null || comparisonEndDate === null) {
      throw new Error(
        'Report config comparisonMode CUSTOM requires both comparisonStartDate and comparisonEndDate',
      )
    }
    validateDatePair(
      comparisonStartDate,
      comparisonEndDate,
      'comparisonStartDate',
      'comparisonEndDate',
      false,
    )
    // Custom comparison must have the same inclusive day count as the current
    // range (AC 23-24) so the comparison is apples-to-apples.
    const current = resolveCurrentRange(
      { datePreset: obj.datePreset as DatePreset, startDate, endDate },
      now,
    )
    const comparison = resolveCurrentRange(
      { datePreset: 'CUSTOM', startDate: comparisonStartDate, endDate: comparisonEndDate },
      now,
    )
    if (
      daysInclusive(current.start, current.end) !== daysInclusive(comparison.start, comparison.end)
    ) {
      throw new Error(
        'Report config custom comparison range must have the same day count as the current range',
      )
    }
  }

  return {
    datePreset: obj.datePreset as DatePreset,
    startDate,
    endDate,
    comparisonMode: obj.comparisonMode as ComparisonMode,
    comparisonStartDate,
    comparisonEndDate,
    groupBy: obj.groupBy as ReportGroupBy,
    ownerId: optionalId(obj.ownerId, 'ownerId'),
    teamId: optionalId(obj.teamId, 'teamId'),
    stageId: optionalId(obj.stageId, 'stageId'),
    productId: optionalId(obj.productId, 'productId'),
    currency,
  }
}

/** Type-specific default groupBy — the only meaningful per-type variation. */
const DEFAULT_GROUP_BY: Record<ReportType, ReportGroupBy> = {
  SALES_OVERVIEW: 'MONTH',
  PIPELINE_ANALYSIS: 'MONTH',
  WIN_LOSS: 'MONTH',
  REVENUE_FORECAST: 'MONTH',
  TEAM_PERFORMANCE: 'OWNER',
  DEAL_VELOCITY: 'MONTH',
}

const DEFAULT_PRESET: DatePreset = 'THIS_MONTH'

/** Fresh default config per call — callers must never share a mutable instance. */
export function defaultReportConfig(type: ReportType): ReportConfig {
  return {
    datePreset: DEFAULT_PRESET,
    startDate: null,
    endDate: null,
    comparisonMode: 'NONE',
    comparisonStartDate: null,
    comparisonEndDate: null,
    groupBy: DEFAULT_GROUP_BY[type] ?? 'MONTH',
    ownerId: null,
    teamId: null,
    stageId: null,
    productId: null,
    currency: null,
  }
}

/**
 * Defensive read-path parsing (AC 7). Never throws. A corrupt persisted row
 * falls back field-by-field to safe type-specific defaults. Unknown report
 * types (AC 42) still receive a safe config.
 */
export function parseReportConfig(raw: unknown, type: string): ReportConfig {
  const defaults = defaultReportConfig(isReportType(type) ? type : 'SALES_OVERVIEW')

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return defaults
  }

  const obj = raw as Record<string, unknown>

  const isoDay = (value: unknown): string | null =>
    isValidIsoDay(value) ? (value as string) : null

  const optionalId = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value : null

  const currencyRaw = obj.currency
  const currency =
    typeof currencyRaw === 'string' && currencyRaw.trim().length > 0
      ? currencyRaw.trim().toUpperCase()
      : defaults.currency

  const datePresetRaw = isDatePreset(obj.datePreset)
    ? (obj.datePreset as DatePreset)
    : defaults.datePreset
  const startDate = isoDay(obj.startDate)
  const endDate = isoDay(obj.endDate)
  // A CUSTOM preset with corrupt/missing dates is unsafe — fall back to the default preset.
  const datePreset =
    datePresetRaw === 'CUSTOM' && (startDate === null || endDate === null)
      ? defaults.datePreset
      : datePresetRaw
  const comparisonMode = isComparisonMode(obj.comparisonMode)
    ? (obj.comparisonMode as ComparisonMode)
    : 'NONE'
  const comparisonStartDate = isoDay(obj.comparisonStartDate)
  const comparisonEndDate = isoDay(obj.comparisonEndDate)

  // A CUSTOM mode with corrupt comparison dates is unsafe — fall back to NONE.
  const safeComparisonMode =
    comparisonMode === 'CUSTOM' && (comparisonStartDate === null || comparisonEndDate === null)
      ? 'NONE'
      : comparisonMode

  return {
    datePreset,
    startDate,
    endDate,
    comparisonMode: safeComparisonMode,
    comparisonStartDate,
    comparisonEndDate,
    groupBy: isReportGroupBy(obj.groupBy) ? (obj.groupBy as ReportGroupBy) : defaults.groupBy,
    ownerId: optionalId(obj.ownerId),
    teamId: optionalId(obj.teamId),
    stageId: optionalId(obj.stageId),
    productId: optionalId(obj.productId),
    currency,
  }
}
