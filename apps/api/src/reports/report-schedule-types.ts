/**
 * Story 6.5 (Contract B6-B7): closed schedule vocabulary, strict input
 * validation and normalization. Pure module — no Nest or Prisma imports so it
 * stays framework-free and unit-testable in isolation.
 *
 * Pothos and the service layer derive from the const tuples here; the GraphQL
 * enums in report-schedules.graphql.ts mirror them (never hand-copy a second
 * vocabulary).
 */

export const REPORT_SCHEDULE_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'CUSTOM_CRON',
] as const
export type ReportScheduleFrequency = (typeof REPORT_SCHEDULE_FREQUENCIES)[number]

export const REPORT_DELIVERY_FORMATS = ['PDF', 'EXCEL', 'CSV'] as const
export type ReportDeliveryFormat = (typeof REPORT_DELIVERY_FORMATS)[number]

export const REPORT_SCHEDULE_EXECUTION_STATUSES = [
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
] as const
export type ReportScheduleExecutionStatus = (typeof REPORT_SCHEDULE_EXECUTION_STATUSES)[number]

/** Durable terminal statuses (AC 13). PROCESSING is never a completed run. */
export const TERMINAL_EXECUTION_STATUSES: readonly ReportScheduleExecutionStatus[] = [
  'SUCCESS',
  'FAILED',
  'SKIPPED',
] as const

// ─── Bounds ──────────────────────────────────────────────────────────────────

export const MIN_RECIPIENTS = 1
export const MAX_RECIPIENTS = 50
export const MAX_RECIPIENT_LENGTH = 254
export const MAX_CRON_EXPRESSION_LENGTH = 100
export const SCHEDULED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const DAY_OF_WEEK_MIN = 0
export const DAY_OF_WEEK_MAX = 6
export const DAY_OF_MONTH_MIN = 1
export const DAY_OF_MONTH_MAX = 31
export const START_MONTH_MIN = 1
export const START_MONTH_MAX = 12

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Closed keys accepted by a schedule create/update payload. */
export const SCHEDULE_INPUT_KEYS = [
  'reportId',
  'frequency',
  'recipients',
  'format',
  'timezone',
  'scheduledTime',
  'dayOfWeek',
  'dayOfMonth',
  'startMonth',
  'cronExpression',
] as const

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleValidationError'
  }
}

/** Injectable clock so processor/service tests never sleep (Contract E25). */
export type Clock = { now(): Date }

export const SYSTEM_CLOCK: Clock = { now: () => new Date() }

export type NormalizedScheduleInput = {
  reportId?: string
  frequency: ReportScheduleFrequency
  recipients: string[]
  format: ReportDeliveryFormat
  timezone: string
  scheduledTime: string
  dayOfWeek?: number
  dayOfMonth?: number
  startMonth?: number
  cronExpression?: string
}

export type CadenceFields = Pick<
  NormalizedScheduleInput,
  'timezone' | 'scheduledTime' | 'dayOfWeek' | 'dayOfMonth' | 'startMonth' | 'cronExpression'
>

// ─── Validators ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ScheduleValidationError(`${field} must be a string`)
  }
  return value
}

function requireIntInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ScheduleValidationError(`${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

/** Valid IANA zone check via the runtime's own tz database (throws RangeError). */
export function isValidIanaTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function isValidScheduledTime(value: string): boolean {
  return typeof value === 'string' && SCHEDULED_TIME_PATTERN.test(value)
}

/**
 * Validates 1-50 trimmed, case-insensitively deduplicated email addresses.
 * Rejects CR/LF header injection and over-long addresses. Returns the
 * normalized list (lower-cased, trimmed, deduped).
 */
export function validateRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ScheduleValidationError('recipients must be an array of email addresses')
  }
  if (value.length < MIN_RECIPIENTS || value.length > MAX_RECIPIENTS) {
    throw new ScheduleValidationError(
      `recipients must contain between ${MIN_RECIPIENTS} and ${MAX_RECIPIENTS} addresses`,
    )
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new ScheduleValidationError('recipients must contain only email strings')
    }
    const email = raw.trim().toLowerCase()
    if (email.length === 0 || email.length > MAX_RECIPIENT_LENGTH) {
      throw new ScheduleValidationError('recipient address has an invalid length')
    }
    // Header injection / control characters are never valid in an address.
    if (/[\r\n\t]/.test(email) || !EMAIL_PATTERN.test(email)) {
      throw new ScheduleValidationError('invalid recipient email address')
    }
    if (!seen.has(email)) {
      seen.add(email)
      out.push(email)
    }
  }
  return out
}

/**
 * Frequency-specific field consistency (Contract B7):
 * - DAILY: no day/month/cron fields;
 * - WEEKLY: exactly one dayOfWeek (0-6);
 * - MONTHLY: exactly one dayOfMonth (1-31);
 * - QUARTERLY: dayOfMonth + startMonth (1-12);
 * - CUSTOM_CRON: exactly one validated five-field expression (no seconds,
 *   cadence no more frequent than hourly).
 */
export function validateCadenceConsistency(
  frequency: ReportScheduleFrequency,
  fields: CadenceFields,
): void {
  if (typeof fields.timezone !== 'string' || !isValidIanaTimezone(fields.timezone)) {
    throw new ScheduleValidationError('timezone must be a valid IANA timezone identifier')
  }
  if (!isValidScheduledTime(fields.scheduledTime)) {
    throw new ScheduleValidationError('scheduledTime must be in HH:mm local form')
  }

  const has = (key: keyof CadenceFields): boolean =>
    fields[key] !== undefined && fields[key] !== null
  const absent = (key: keyof CadenceFields): boolean => !has(key)

  switch (frequency) {
    case 'DAILY':
      if (
        !absent('dayOfWeek') ||
        !absent('dayOfMonth') ||
        !absent('startMonth') ||
        !absent('cronExpression')
      ) {
        throw new ScheduleValidationError('DAILY schedules must not include day/month/cron fields')
      }
      break
    case 'WEEKLY':
      if (
        !has('dayOfWeek') ||
        !absent('dayOfMonth') ||
        !absent('startMonth') ||
        !absent('cronExpression')
      ) {
        throw new ScheduleValidationError('WEEKLY schedules require exactly one dayOfWeek (0-6)')
      }
      requireIntInRange(fields.dayOfWeek, 'dayOfWeek', DAY_OF_WEEK_MIN, DAY_OF_WEEK_MAX)
      break
    case 'MONTHLY':
      if (!has('dayOfMonth') || has('startMonth') || has('dayOfWeek') || has('cronExpression')) {
        throw new ScheduleValidationError('MONTHLY schedules require exactly one dayOfMonth (1-31)')
      }
      requireIntInRange(fields.dayOfMonth, 'dayOfMonth', DAY_OF_MONTH_MIN, DAY_OF_MONTH_MAX)
      break
    case 'QUARTERLY':
      if (!has('dayOfMonth') || !has('startMonth') || has('dayOfWeek') || has('cronExpression')) {
        throw new ScheduleValidationError(
          'QUARTERLY schedules require dayOfMonth (1-31) plus startMonth (1-12)',
        )
      }
      requireIntInRange(fields.dayOfMonth, 'dayOfMonth', DAY_OF_MONTH_MIN, DAY_OF_MONTH_MAX)
      requireIntInRange(fields.startMonth, 'startMonth', START_MONTH_MIN, START_MONTH_MAX)
      break
    case 'CUSTOM_CRON':
      if (!has('cronExpression') || has('dayOfWeek') || has('dayOfMonth') || has('startMonth')) {
        throw new ScheduleValidationError(
          'CUSTOM_CRON schedules require exactly one cronExpression',
        )
      }
      if (typeof fields.cronExpression !== 'string' || fields.cronExpression.length === 0) {
        throw new ScheduleValidationError('cronExpression must be a string')
      }
      if (fields.cronExpression.length > MAX_CRON_EXPRESSION_LENGTH) {
        throw new ScheduleValidationError(
          `cronExpression must be at most ${MAX_CRON_EXPRESSION_LENGTH} characters`,
        )
      }
      validateCronExpressionShape(fields.cronExpression, fields.timezone)
      break
  }
}

/**
 * Validates a five-field cron expression: exactly five fields, no seconds
 * field, syntactically valid and with a cadence no more frequent than hourly.
 * Uses cron-parser directly (declared dependency, never a transitive import).
 */
export function validateCronExpressionShape(
  expression: string,
  timezone: string,
  reference = new Date(),
): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CronExpressionParser } = require('cron-parser') as typeof import('cron-parser')
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new ScheduleValidationError(
      'cronExpression must be a five-field expression (no seconds field)',
    )
  }
  if (fields.some((f) => f.length === 0)) {
    throw new ScheduleValidationError('cronExpression contains an empty field')
  }
  let expr: ReturnType<typeof CronExpressionParser.parse>
  try {
    expr = CronExpressionParser.parse(expression, { currentDate: reference, tz: timezone })
  } catch (error) {
    throw new ScheduleValidationError(
      `invalid cronExpression: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let first: Date
  let second: Date
  try {
    first = expr.next().toDate()
    second = expr.next().toDate()
  } catch (error) {
    throw new ScheduleValidationError(
      `cronExpression has no recurring valid occurrence: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const gapMs = second.getTime() - first.getTime()
  if (gapMs < 60 * 60 * 1000) {
    throw new ScheduleValidationError('cronExpression must not run more frequently than hourly')
  }
}

/**
 * Strictly validates an UPDATE payload: only provided keys are validated
 * (unknown keys rejected, reportId never allowed). The caller merges the
 * result into the persisted schedule and re-validates the merged cadence via
 * validateCadenceConsistency.
 */
export function normalizeAndValidateScheduleUpdate(
  input: unknown,
): Partial<NormalizedScheduleInput> {
  if (!isRecord(input)) {
    throw new ScheduleValidationError('schedule input must be an object')
  }
  const unknownKeys = Object.keys(input).filter(
    (key) => !(SCHEDULE_INPUT_KEYS as readonly string[]).includes(key),
  )
  if (unknownKeys.length > 0) {
    throw new ScheduleValidationError(`unknown schedule input field(s): ${unknownKeys.join(', ')}`)
  }
  if (input.reportId !== undefined) {
    throw new ScheduleValidationError('reportId is not allowed in this payload')
  }
  const out: Partial<NormalizedScheduleInput> = {}
  if (input.frequency !== undefined) {
    if (!(REPORT_SCHEDULE_FREQUENCIES as readonly unknown[]).includes(input.frequency)) {
      throw new ScheduleValidationError(`unsupported frequency: ${String(input.frequency)}`)
    }
    out.frequency = input.frequency as ReportScheduleFrequency
  }
  if (input.format !== undefined) {
    if (!(REPORT_DELIVERY_FORMATS as readonly unknown[]).includes(input.format)) {
      throw new ScheduleValidationError(`unsupported delivery format: ${String(input.format)}`)
    }
    out.format = input.format as ReportDeliveryFormat
  }
  if (input.recipients !== undefined) {
    out.recipients = validateRecipients(input.recipients)
  }
  if (input.timezone !== undefined) {
    out.timezone = requireString(input.timezone, 'timezone')
    if (!isValidIanaTimezone(out.timezone)) {
      throw new ScheduleValidationError('timezone must be a valid IANA timezone identifier')
    }
  }
  if (input.scheduledTime !== undefined) {
    out.scheduledTime = requireString(input.scheduledTime, 'scheduledTime')
    if (!isValidScheduledTime(out.scheduledTime)) {
      throw new ScheduleValidationError('scheduledTime must be in HH:mm local form')
    }
  }
  for (const key of ['dayOfWeek', 'dayOfMonth', 'startMonth'] as const) {
    if (input[key] !== undefined) {
      const range =
        key === 'dayOfWeek'
          ? { min: DAY_OF_WEEK_MIN, max: DAY_OF_WEEK_MAX }
          : key === 'dayOfMonth'
            ? { min: DAY_OF_MONTH_MIN, max: DAY_OF_MONTH_MAX }
            : { min: START_MONTH_MIN, max: START_MONTH_MAX }
      out[key] = requireIntInRange(input[key], key, range.min, range.max)
    }
  }
  if (input.cronExpression !== undefined) {
    const expression = requireString(input.cronExpression, 'cronExpression')
    if (expression.length > MAX_CRON_EXPRESSION_LENGTH) {
      throw new ScheduleValidationError(
        `cronExpression must be at most ${MAX_CRON_EXPRESSION_LENGTH} characters`,
      )
    }
    out.cronExpression = expression
  }
  return out
}

/**
 * Strictly validates and normalizes a full schedule input (create).
 * Rejects unknown keys, unsupported frequency/format, invalid recipients,
 * timezone/time, and mixed incompatible cadence fields. `reportId` is
 * optional here so the same function can validate update payloads.
 */
export function normalizeAndValidateScheduleInput(
  input: unknown,
  opts: { allowReportId?: boolean } = { allowReportId: true },
): NormalizedScheduleInput {
  if (!isRecord(input)) {
    throw new ScheduleValidationError('schedule input must be an object')
  }
  const unknownKeys = Object.keys(input).filter(
    (key) => !(SCHEDULE_INPUT_KEYS as readonly string[]).includes(key),
  )
  if (unknownKeys.length > 0) {
    throw new ScheduleValidationError(`unknown schedule input field(s): ${unknownKeys.join(', ')}`)
  }
  if (input.reportId !== undefined && !opts.allowReportId) {
    throw new ScheduleValidationError('reportId is not allowed in this payload')
  }

  const frequency = input.frequency
  if (!(REPORT_SCHEDULE_FREQUENCIES as readonly unknown[]).includes(frequency)) {
    throw new ScheduleValidationError(`unsupported frequency: ${String(frequency)}`)
  }
  const format = input.format
  if (!(REPORT_DELIVERY_FORMATS as readonly unknown[]).includes(format)) {
    throw new ScheduleValidationError(`unsupported delivery format: ${String(format)}`)
  }

  const recipients = validateRecipients(input.recipients)
  const timezone = requireString(input.timezone, 'timezone')
  const scheduledTime = requireString(input.scheduledTime, 'scheduledTime')

  const fields: CadenceFields = {
    timezone,
    scheduledTime,
    dayOfWeek: input.dayOfWeek as number | undefined,
    dayOfMonth: input.dayOfMonth as number | undefined,
    startMonth: input.startMonth as number | undefined,
    cronExpression: input.cronExpression as string | undefined,
  }
  validateCadenceConsistency(frequency as ReportScheduleFrequency, fields)

  return {
    reportId: input.reportId as string | undefined,
    frequency: frequency as ReportScheduleFrequency,
    recipients,
    format: format as ReportDeliveryFormat,
    timezone,
    scheduledTime,
    dayOfWeek: fields.dayOfWeek,
    dayOfMonth: fields.dayOfMonth,
    startMonth: fields.startMonth,
    cronExpression: fields.cronExpression,
  }
}
