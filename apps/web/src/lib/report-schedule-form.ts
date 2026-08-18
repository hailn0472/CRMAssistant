/**
 * Story 6.5 — pure lib for report schedule form:
 * - Zod schema + Form types
 * - Default values
 * - Next run calculation preview
 * - Frequency summary helpers
 */
import { z } from 'zod'
import type {
  ReportDeliveryFormat,
  ReportScheduleFrequency,
} from '@/services/report-schedule.service'

export const REPORT_SCHEDULE_FREQUENCIES: [ReportScheduleFrequency, ...ReportScheduleFrequency[]] =
  ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM_CRON']

export const REPORT_DELIVERY_FORMATS: [ReportDeliveryFormat, ...ReportDeliveryFormat[]] = [
  'PDF',
  'EXCEL',
  'CSV',
]

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SCHEDULED_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validateRecipientEmail(email: string): boolean {
  if (!email || email.length > 254) return false
  if (email.includes('\n') || email.includes('\r')) return false
  return EMAIL_REGEX.test(email.trim())
}

export function validateCronExpression(expression: string): boolean {
  if (!expression) return false
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minute, hour] = parts

  // Sub-hourly check: minute cannot be '*' or step like '*/N' or comma list without fixed offset
  if (minute === '*' || minute.startsWith('*/') || minute.includes(',')) {
    return false
  }

  // Basic range validation
  const minNum = Number(minute)
  if (isNaN(minNum) || minNum < 0 || minNum > 59) return false

  if (hour !== '*' && !hour.startsWith('*/')) {
    // Basic hour range check for single or hyphen range
    const hourTokens = hour.split(',')
    for (const token of hourTokens) {
      if (token.includes('-')) {
        const [start, end] = token.split('-').map(Number)
        if (isNaN(start) || isNaN(end) || start < 0 || end > 23 || start > end) return false
      } else if (!isNaN(Number(token))) {
        const h = Number(token)
        if (h < 0 || h > 23) return false
      }
    }
  }

  return true
}

export const reportScheduleFormSchema = z
  .object({
    frequency: z.enum(REPORT_SCHEDULE_FREQUENCIES),
    recipients: z
      .array(z.string().refine(validateRecipientEmail, { message: 'Invalid email address' }))
      .min(1, 'At least one recipient email is required')
      .max(50, 'Maximum 50 recipients allowed'),
    format: z.enum(REPORT_DELIVERY_FORMATS),
    timezone: z.string().min(1, 'Timezone is required'),
    scheduledTime: z
      .string()
      .regex(SCHEDULED_TIME_PATTERN, 'Delivery time must be in HH:mm format'),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startMonth: z.number().int().min(1).max(12).nullable().optional(),
    cronExpression: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.frequency === 'WEEKLY') {
      if (val.dayOfWeek === null || val.dayOfWeek === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Day of week is required for weekly schedules',
          path: ['dayOfWeek'],
        })
      }
    }

    if (val.frequency === 'MONTHLY') {
      if (val.dayOfMonth === null || val.dayOfMonth === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Day of month is required for monthly schedules',
          path: ['dayOfMonth'],
        })
      }
    }

    if (val.frequency === 'QUARTERLY') {
      if (val.startMonth === null || val.startMonth === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quarter cycle start month is required for quarterly schedules',
          path: ['startMonth'],
        })
      }
      if (val.dayOfMonth === null || val.dayOfMonth === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Day of month is required for quarterly schedules',
          path: ['dayOfMonth'],
        })
      }
    }

    if (val.frequency === 'CUSTOM_CRON') {
      if (!val.cronExpression || !validateCronExpression(val.cronExpression)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Valid 5-field cron expression (minimum hourly) is required',
          path: ['cronExpression'],
        })
      }
    }
  })

export type ReportScheduleFormValues = z.infer<typeof reportScheduleFormSchema>

export function getDefaultBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function getDefaultReportScheduleFormValues(): ReportScheduleFormValues {
  return {
    frequency: 'DAILY',
    recipients: [],
    format: 'PDF',
    timezone: getDefaultBrowserTimezone(),
    scheduledTime: '08:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    startMonth: 1,
    cronExpression: '0 8 * * 1-5',
  }
}

// ─── Pure Next-Run Preview Calculation ────────────────────────

type LocalFields = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

function formatInZone(utc: Date, timezone: string): LocalFields {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(utc)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  }
}

function localWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): { utc: Date } | { gap: true } {
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  let prevDelta = 0
  for (let i = 0; i < 4; i++) {
    const local = formatInZone(new Date(guess), timezone)
    if (
      local.year === year &&
      local.month === month &&
      local.day === day &&
      local.hour === hour &&
      local.minute === minute
    ) {
      return { utc: new Date(guess) }
    }
    const localNaive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
    const desiredNaive = Date.UTC(year, month - 1, day, hour, minute)
    const delta = desiredNaive - localNaive
    if (delta === 0) break
    if (i > 0 && delta === -prevDelta) return { gap: true }
    prevDelta = delta
    guess += delta
  }
  return { gap: true }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function clampedDay(year: number, month: number, dayOfMonth: number): number {
  return Math.min(dayOfMonth, lastDayOfMonth(year, month))
}

function isQuarterMonth(month: number, startMonth: number): boolean {
  return (month - startMonth + 12) % 3 === 0
}

function candidateDateMatches(
  values: ReportScheduleFormValues,
  year: number,
  month: number,
  day: number,
): boolean {
  switch (values.frequency) {
    case 'DAILY':
      return true
    case 'WEEKLY': {
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      return dow === (values.dayOfWeek ?? 1)
    }
    case 'MONTHLY':
      return day === clampedDay(year, month, values.dayOfMonth ?? 1)
    case 'QUARTERLY':
      return (
        isQuarterMonth(month, values.startMonth ?? 1) &&
        day === clampedDay(year, month, values.dayOfMonth ?? 1)
      )
    case 'CUSTOM_CRON':
      return false
  }
}

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') {
    const res: number[] = []
    for (let i = min; i <= max; i++) res.push(i)
    return res
  }
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2))
    if (isNaN(step) || step <= 0) return null
    const res: number[] = []
    for (let i = min; i <= max; i += step) res.push(i)
    return res
  }
  const result: number[] = []
  const tokens = field.split(',')
  for (const token of tokens) {
    if (token.includes('-')) {
      const [start, end] = token.split('-').map(Number)
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) return null
      for (let i = start; i <= end; i++) result.push(i)
    } else {
      const val = Number(token)
      if (isNaN(val) || val < min || val > max) return null
      result.push(val)
    }
  }
  return Array.from(new Set(result)).sort((a, b) => a - b)
}

export function calculateNextRunPreview(
  values: Partial<ReportScheduleFormValues>,
  after: Date = new Date(),
): Date | null {
  try {
    const timezone = values.timezone || 'UTC'
    const scheduledTime = values.scheduledTime || '08:00'
    const match = SCHEDULED_TIME_PATTERN.exec(scheduledTime)
    const hour = match ? Number(match[1]) : 8
    const minute = match ? Number(match[2]) : 0

    if (values.frequency === 'CUSTOM_CRON') {
      if (!values.cronExpression || !validateCronExpression(values.cronExpression)) {
        return null
      }
      const parts = values.cronExpression.trim().split(/\s+/)
      const minutes = parseCronField(parts[0], 0, 59)
      const hours = parseCronField(parts[1], 0, 23)
      const daysOfMonth = parseCronField(parts[2], 1, 31)
      const months = parseCronField(parts[3], 1, 12)
      const daysOfWeek = parseCronField(parts[4], 0, 6)

      if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
        return null
      }

      const startLocal = formatInZone(after, timezone)
      let cursor = { year: startLocal.year, month: startLocal.month, day: startLocal.day }

      for (let i = 0; i < 366; i++) {
        const monthMatches = parts[3] === '*' || months.includes(cursor.month)
        const domMatches = parts[2] === '*' || daysOfMonth.includes(cursor.day)
        const d = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day))
        const dow = d.getUTCDay()
        const dowMatches = parts[4] === '*' || daysOfWeek.includes(dow)

        // Standard cron day matching: if both DOM and DOW are restricted (not *), matching either or both depends on spec,
        // but standard POSIX cron is OR when both restricted, AND when either is *.
        let dayMatches = false
        if (parts[2] === '*' && parts[4] === '*') {
          dayMatches = true
        } else if (parts[2] !== '*' && parts[4] === '*') {
          dayMatches = domMatches
        } else if (parts[2] === '*' && parts[4] !== '*') {
          dayMatches = dowMatches
        } else {
          dayMatches = domMatches || dowMatches
        }

        if (monthMatches && dayMatches) {
          for (const h of hours) {
            for (const m of minutes) {
              const res = localWallClockToUtc(cursor.year, cursor.month, cursor.day, h, m, timezone)
              if ('utc' in res && res.utc.getTime() > after.getTime()) {
                return res.utc
              }
            }
          }
        }
        const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1))
        cursor = {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
        }
      }
      return null
    }

    const fullValues = {
      ...getDefaultReportScheduleFormValues(),
      ...values,
    } as ReportScheduleFormValues

    const startLocal = formatInZone(after, timezone)
    let cursor = { year: startLocal.year, month: startLocal.month, day: startLocal.day }

    for (let i = 0; i < 400; i++) {
      if (candidateDateMatches(fullValues, cursor.year, cursor.month, cursor.day)) {
        const result = localWallClockToUtc(
          cursor.year,
          cursor.month,
          cursor.day,
          hour,
          minute,
          timezone,
        )
        if ('utc' in result && result.utc.getTime() > after.getTime()) {
          return result.utc
        }
      }
      const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1))
      cursor = {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── Frequency Summary Helpers ────────────────────────────────

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatFrequencySummary(params: {
  frequency: ReportScheduleFrequency
  scheduledTime: string
  timezone: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  startMonth?: number | null
  cronExpression?: string | null
}): string {
  const { frequency, scheduledTime, timezone, dayOfWeek, dayOfMonth, startMonth, cronExpression } =
    params

  switch (frequency) {
    case 'DAILY':
      return `Daily at ${scheduledTime} (${timezone})`
    case 'WEEKLY': {
      const dayName = DAYS_OF_WEEK[dayOfWeek ?? 1] ?? 'Monday'
      return `Weekly on ${dayName} at ${scheduledTime} (${timezone})`
    }
    case 'MONTHLY':
      return `Monthly on day ${dayOfMonth ?? 1} at ${scheduledTime} (${timezone})`
    case 'QUARTERLY': {
      let cycle = 'Jan, Apr, Jul, Oct'
      if (startMonth === 2) cycle = 'Feb, May, Aug, Nov'
      else if (startMonth === 3) cycle = 'Mar, Jun, Sep, Dec'
      return `Quarterly (${cycle}) on day ${dayOfMonth ?? 1} at ${scheduledTime} (${timezone})`
    }
    case 'CUSTOM_CRON':
      return `Cron (${cronExpression ?? 'custom'}) in ${timezone}`
    default:
      return `${frequency} at ${scheduledTime}`
  }
}
