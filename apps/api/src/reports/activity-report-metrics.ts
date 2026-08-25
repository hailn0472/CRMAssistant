/**
 * Story 6.8 (Contract B6-B8): pure activity-report metric contract.
 *
 * Framework-free, Prisma-free, Nest-free — exhaustively unit-tested in
 * activity-report-metrics.spec.ts (boundaries F1-F20). All day arithmetic is
 * UTC-midnight based so heatmap cells, by-date rows, trend buckets and goal
 * period windows are stable regardless of the server's local timezone
 * (finding 3.7-F4: a UTC timestamp must never land in a local-time bucket).
 *
 * This module is the single source of truth for the closed vocabularies:
 * Pothos enums in activity-reports.graphql.ts and the service validators
 * derive from the const tuples here — never hand-copy a second vocabulary.
 */
import { bucketKey, enumerateBuckets } from './productivity-buckets'

// ─── Closed constants ───────────────────────────────────────────────────────

/** Matches `ProductivityService.MAX_RANGE_DAYS` (Contract B6). */
export const ACTIVITY_REPORT_MAX_RANGE_DAYS = 366

/** Raw/drill row bound — exceeding throws, never silent truncation. */
export const ACTIVITY_REPORT_MAX_ROWS = 20000

export const LEADERBOARD_METRICS = [
  'ACTIVITIES_LOGGED',
  'TASKS_COMPLETED',
  'DEALS_CLOSED',
  'TIME_TRACKED',
] as const
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number]

export const ACTIVITY_REPORT_SORT_BYS = [
  'ACTIVITIES',
  'TASKS_COMPLETED',
  'DEALS_CLOSED',
  'TIME_TRACKED',
] as const
export type ActivityReportSortBy = (typeof ACTIVITY_REPORT_SORT_BYS)[number]

export const ACTIVITY_REPORT_BUCKETS = ['DAY', 'WEEK', 'MONTH'] as const
export type ActivityReportBucket = (typeof ACTIVITY_REPORT_BUCKETS)[number]

export const ACTIVITY_GOAL_PERIODS = ['WEEKLY', 'MONTHLY'] as const
export type ActivityGoalPeriod = (typeof ACTIVITY_GOAL_PERIODS)[number]

/** Mirrors the Prisma `ActivityType` enum (hand-duplication house rule). */
export const ACTIVITY_TYPES = [
  'EMAIL_SENT',
  'CALL_MADE',
  'MEETING_SCHEDULED',
  'NOTE_ADDED',
  'DEAL_CREATED',
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONTACT_OWNER_CHANGED',
  'TASK_COMPLETED',
  'DEAL_STAGE_CHANGED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
] as const
export type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number]

/** Max comparison teams for the side-by-side team comparison. */
export const ACTIVITY_REPORT_MAX_COMPARISON_TEAMS = 4

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ─── Numeric helpers ────────────────────────────────────────────────────────

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
}

/**
 * F1-F6: task due-cohort completion rate. `totalDue === 0 → 0` (never NaN);
 * a numerator above the denominator is a DATA error and is rejected rather
 * than silently clamped (Contract B6 — never hide bad data).
 */
export function completionRate(completedDue: number, totalDue: number): number {
  assertFinite(completedDue, 'completedDue')
  assertFinite(totalDue, 'totalDue')
  if (totalDue === 0) return 0
  if (completedDue > totalDue) {
    throw new Error(`completionRate numerator (${completedDue}) exceeds denominator (${totalDue})`)
  }
  if (completedDue < 0 || totalDue < 0) {
    throw new Error('completionRate inputs must not be negative')
  }
  return clamp(round2(completedDue / totalDue), 0, 1)
}

/**
 * F7-F8: average task completion time in hours from a list of millisecond
 * durations. Empty → 0; non-finite inputs are rejected (never NaN results).
 */
export function avgCompletionHours(millisList: number[]): number {
  if (millisList.length === 0) return 0
  for (const millis of millisList) {
    assertFinite(millis, 'completion duration')
  }
  const total = millisList.reduce((sum, millis) => sum + millis, 0)
  return round1(total / millisList.length / (60 * 60 * 1000))
}

// ─── UTC day math ───────────────────────────────────────────────────────────

/** Normalize any instant to the UTC midnight of its UTC calendar day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** YYYY-MM-DD of the UTC day (the byDate/trend bucket key). */
export function utcDayKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * F17: dense zero-fill day list — start-inclusive, end-exclusive (end is the
 * UTC midnight after the last requested day).
 */
export function enumerateUtcDays(startInclusive: Date, endExclusive: Date): string[] {
  const keys: string[] = []
  const cursor = toUtcMidnight(startInclusive)
  const end = toUtcMidnight(endExclusive)
  while (cursor < end) {
    keys.push(utcDayKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

// ─── Heatmap (F9-F11) ───────────────────────────────────────────────────────

export type HeatmapCell = { dayOfWeek: number; hour: number; count: number }

/** F9: UTC day-of-week (0=Sunday..6=Saturday) × UTC hour (0..23). */
export function heatmapKey(date: Date): { dayOfWeek: number; hour: number } {
  return { dayOfWeek: date.getUTCDay(), hour: date.getUTCHours() }
}

/** F10/F11: exactly 168 zero-filled cells — no cell may vanish. */
export function enumerateHeatmapCells(): HeatmapCell[] {
  const cells: HeatmapCell[] = []
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({ dayOfWeek, hour, count: 0 })
    }
  }
  return cells
}

// ─── Goal period windows (F12-F14) ──────────────────────────────────────────

export type GoalPeriodWindow = { start: Date; end: Date } // end is EXCLUSIVE

/**
 * F12-F14: the current goal period window ending at UTC midnight.
 * - WEEKLY: 7-day periods anchored on `startsOn` (a Wednesday anchor keeps
 *   Wednesday-to-Tuesday windows — never calendar Sun/Mon).
 * - MONTHLY: the calendar UTC month containing `now`.
 * A not-started goal (now < startsOn) windows to its first period.
 */
export function goalPeriodWindow(
  startsOn: Date,
  period: ActivityGoalPeriod,
  now: Date,
): GoalPeriodWindow {
  const anchor = toUtcMidnight(startsOn)
  if (period === 'MONTHLY') {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    }
  }
  const today = toUtcMidnight(now)
  if (today <= anchor) {
    return { start: anchor, end: new Date(anchor.getTime() + 7 * MS_PER_DAY) }
  }
  const periodsElapsed = Math.floor((today.getTime() - anchor.getTime()) / (7 * MS_PER_DAY))
  const start = new Date(anchor.getTime() + periodsElapsed * 7 * MS_PER_DAY)
  return { start, end: new Date(start.getTime() + 7 * MS_PER_DAY) }
}

/** F15: clamp(targetCount × elapsedFraction, 0, targetCount). */
export function expectedPace(targetCount: number, elapsedFraction: number): number {
  assertFinite(targetCount, 'targetCount')
  assertFinite(elapsedFraction, 'elapsedFraction')
  return clamp(targetCount * elapsedFraction, 0, targetCount)
}

/** F16: strict — actual equal to expected is NOT falling behind. */
export function isFallingBehind(actual: number, expected: number): boolean {
  return actual < expected
}

// ─── Filter normalization (shared by query + export) ────────────────────────

export class ActivityReportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActivityReportValidationError'
  }
}

export type ActivityReportFilterInput = {
  startDate: string
  endDate: string
  userId?: string | null
  teamId?: string | null
  comparisonTeamIds?: string[] | null
  activityTypes?: ActivityTypeValue[] | null
  contactId?: string | null
  dealId?: string | null
  bucket?: ActivityReportBucket | null
  sortBy?: ActivityReportSortBy | null
}

export type NormalizedActivityReportFilters = {
  startDate: string
  endDate: string
  start: Date // UTC midnight, inclusive
  end: Date // UTC midnight of the day AFTER endDate — exclusive
  userId: string | null
  teamId: string | null
  comparisonTeamIds: string[]
  activityTypes: ActivityTypeValue[]
  contactId: string | null
  dealId: string | null
  bucket: ActivityReportBucket
  sortBy: ActivityReportSortBy
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireDateOnly(value: unknown, field: string): { date: Date; key: string } {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ActivityReportValidationError(`${field} must be a valid ISO date`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ActivityReportValidationError(`${field} must be a valid ISO date`)
  }
  return { date, key: utcDayKey(date) }
}

/**
 * Shared pure validator/normalizer for BOTH the `activityReport` query and
 * `exportActivityReport`. Throws ActivityReportValidationError; callers wrap
 * it into BadRequestException. The returned normalized shape is what gets
 * persisted as the immutable export snapshot (Contract E30).
 */
export function normalizeActivityReportFilters(
  input: ActivityReportFilterInput | null | undefined,
): NormalizedActivityReportFilters {
  if (!isRecord(input ?? {})) {
    throw new ActivityReportValidationError('filters must be an object')
  }
  const raw = (input ?? {}) as Record<string, unknown>

  const start = requireDateOnly(raw.startDate, 'startDate')
  const end = requireDateOnly(raw.endDate, 'endDate')

  if (end.date < start.date) {
    throw new ActivityReportValidationError('endDate must be >= startDate')
  }
  if ((end.date.getTime() - start.date.getTime()) / MS_PER_DAY > ACTIVITY_REPORT_MAX_RANGE_DAYS) {
    throw new ActivityReportValidationError(
      `Activity report range must not exceed ${ACTIVITY_REPORT_MAX_RANGE_DAYS} days`,
    )
  }

  let bucket: ActivityReportBucket = 'DAY'
  if (raw.bucket !== undefined && raw.bucket !== null) {
    if (!(ACTIVITY_REPORT_BUCKETS as readonly string[]).includes(String(raw.bucket))) {
      throw new ActivityReportValidationError(
        `unsupported bucket: ${String(raw.bucket)} (expected DAY, WEEK or MONTH)`,
      )
    }
    bucket = raw.bucket as ActivityReportBucket
  }

  let sortBy: ActivityReportSortBy = 'ACTIVITIES'
  if (raw.sortBy !== undefined && raw.sortBy !== null) {
    if (!(ACTIVITY_REPORT_SORT_BYS as readonly string[]).includes(String(raw.sortBy))) {
      throw new ActivityReportValidationError(
        `unsupported sortBy: ${String(raw.sortBy)} (expected ${ACTIVITY_REPORT_SORT_BYS.join(', ')})`,
      )
    }
    sortBy = raw.sortBy as ActivityReportSortBy
  }

  let comparisonTeamIds: string[] = []
  if (raw.comparisonTeamIds !== undefined && raw.comparisonTeamIds !== null) {
    if (!Array.isArray(raw.comparisonTeamIds)) {
      throw new ActivityReportValidationError('comparisonTeamIds must be an array')
    }
    const ids = raw.comparisonTeamIds.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    )
    if (new Set(ids).size !== ids.length) {
      throw new ActivityReportValidationError('comparisonTeamIds must be unique')
    }
    if (ids.length > ACTIVITY_REPORT_MAX_COMPARISON_TEAMS) {
      throw new ActivityReportValidationError(
        `comparisonTeamIds must contain at most ${ACTIVITY_REPORT_MAX_COMPARISON_TEAMS} teams`,
      )
    }
    comparisonTeamIds = ids
  }

  let activityTypes: ActivityTypeValue[] = []
  if (raw.activityTypes !== undefined && raw.activityTypes !== null) {
    if (!Array.isArray(raw.activityTypes)) {
      throw new ActivityReportValidationError('activityTypes must be an array')
    }
    const unknown = raw.activityTypes.filter(
      (v) => typeof v !== 'string' || !(ACTIVITY_TYPES as readonly string[]).includes(v),
    )
    if (unknown.length > 0) {
      throw new ActivityReportValidationError(
        `unsupported activityTypes: ${unknown.join(', ')} (expected ActivityType values)`,
      )
    }
    activityTypes = [...new Set(raw.activityTypes as ActivityTypeValue[])]
  }

  const optionalString = (value: unknown): string | null => {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || value.length === 0) return null
    return value
  }

  return {
    startDate: start.key,
    endDate: end.key,
    start: toUtcMidnight(start.date),
    end: new Date(toUtcMidnight(end.date).getTime() + MS_PER_DAY),
    userId: optionalString(raw.userId),
    teamId: optionalString(raw.teamId),
    comparisonTeamIds,
    activityTypes,
    contactId: optionalString(raw.contactId),
    dealId: optionalString(raw.dealId),
    bucket,
    sortBy,
  }
}

/** Re-export the bucket helpers for trend zero-filling (pure, shared). */
export { bucketKey, enumerateBuckets }
