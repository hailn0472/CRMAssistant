/**
 * Story 6.5 (Contract F30) — report-schedule-form pure lib unit tests (TDD RED phase).
 * Tests Zod schema, conditional validations, defaults, next run preview calculation,
 * and frequency label summaries.
 */
import {
  reportScheduleFormSchema,
  getDefaultReportScheduleFormValues,
  calculateNextRunPreview,
  formatFrequencySummary,
  validateRecipientEmail,
  validateCronExpression,
} from '../report-schedule-form'
import type { ReportScheduleFormValues } from '../report-schedule-form'

describe('report-schedule-form lib', () => {
  describe('validateRecipientEmail', () => {
    it('accepts valid standard email addresses', () => {
      expect(validateRecipientEmail('user@example.com')).toBe(true)
      expect(validateRecipientEmail('alex.m@acme.corp.vn')).toBe(true)
    })

    it('rejects invalid email formats, whitespace, and injection attempts', () => {
      expect(validateRecipientEmail('')).toBe(false)
      expect(validateRecipientEmail('invalid-email')).toBe(false)
      expect(validateRecipientEmail('user@')).toBe(false)
      expect(validateRecipientEmail('user@domain\nadmin@domain.com')).toBe(false)
    })
  })

  describe('validateCronExpression', () => {
    it('accepts valid 5-field cron expressions with at least hourly cadence', () => {
      expect(validateCronExpression('0 8 * * 1-5')).toBe(true) // 8am on weekdays
      expect(validateCronExpression('30 14 * * 0')).toBe(true) // 2:30pm on Sundays
      expect(validateCronExpression('0 0 1 * *')).toBe(true)
    })

    it('rejects expressions that run more frequently than hourly (* * * * * or */15 * * * *)', () => {
      expect(validateCronExpression('* * * * *')).toBe(false)
      expect(validateCronExpression('*/15 * * * *')).toBe(false)
      expect(validateCronExpression('*/5 8 * * *')).toBe(false)
    })

    it('rejects invalid or non-5-field expressions', () => {
      expect(validateCronExpression('0 8 * *')).toBe(false)
      expect(validateCronExpression('0 0 8 * * 1-5')).toBe(false)
      expect(validateCronExpression('invalid cron')).toBe(false)
    })
  })

  describe('reportScheduleFormSchema', () => {
    const baseValid: ReportScheduleFormValues = {
      frequency: 'DAILY',
      recipients: ['team@acme.corp'],
      format: 'PDF',
      timezone: 'Asia/Ho_Chi_Minh',
      scheduledTime: '08:00',
      dayOfWeek: null,
      dayOfMonth: null,
      startMonth: null,
      cronExpression: null,
    }

    it('validates a valid DAILY schedule', () => {
      const res = reportScheduleFormSchema.safeParse(baseValid)
      expect(res.success).toBe(true)
    })

    it('requires at least one recipient and enforces email format', () => {
      const res1 = reportScheduleFormSchema.safeParse({ ...baseValid, recipients: [] })
      expect(res1.success).toBe(false)

      const res2 = reportScheduleFormSchema.safeParse({ ...baseValid, recipients: ['bad-email'] })
      expect(res2.success).toBe(false)
    })

    it('caps recipients at 50', () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `user${i}@acme.corp`)
      const res = reportScheduleFormSchema.safeParse({ ...baseValid, recipients: tooMany })
      expect(res.success).toBe(false)
    })

    it('validates WEEKLY frequency requiring dayOfWeek (0-6)', () => {
      const validWeekly: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'WEEKLY',
        dayOfWeek: 1,
      }
      expect(reportScheduleFormSchema.safeParse(validWeekly).success).toBe(true)

      const missingDow: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'WEEKLY',
        dayOfWeek: null,
      }
      expect(reportScheduleFormSchema.safeParse(missingDow).success).toBe(false)
    })

    it('validates MONTHLY frequency requiring dayOfMonth (1-31)', () => {
      const validMonthly: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'MONTHLY',
        dayOfMonth: 15,
      }
      expect(reportScheduleFormSchema.safeParse(validMonthly).success).toBe(true)

      const invalidDom: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'MONTHLY',
        dayOfMonth: 32,
      }
      expect(reportScheduleFormSchema.safeParse(invalidDom).success).toBe(false)
    })

    it('validates QUARTERLY frequency requiring startMonth (1-12) and dayOfMonth (1-31)', () => {
      const validQuarterly: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'QUARTERLY',
        startMonth: 1,
        dayOfMonth: 1,
      }
      expect(reportScheduleFormSchema.safeParse(validQuarterly).success).toBe(true)

      const missingStart: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'QUARTERLY',
        startMonth: null,
        dayOfMonth: 1,
      }
      expect(reportScheduleFormSchema.safeParse(missingStart).success).toBe(false)
    })

    it('validates CUSTOM_CRON frequency requiring a valid cron expression', () => {
      const validCron: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'CUSTOM_CRON',
        cronExpression: '0 8 * * 1-5',
      }
      expect(reportScheduleFormSchema.safeParse(validCron).success).toBe(true)

      const subHourlyCron: ReportScheduleFormValues = {
        ...baseValid,
        frequency: 'CUSTOM_CRON',
        cronExpression: '*/10 * * * *',
      }
      expect(reportScheduleFormSchema.safeParse(subHourlyCron).success).toBe(false)
    })
  })

  describe('getDefaultReportScheduleFormValues', () => {
    it('returns sensible defaults with local timezone and DAILY frequency', () => {
      const defaults = getDefaultReportScheduleFormValues()
      expect(defaults.frequency).toBe('DAILY')
      expect(defaults.format).toBe('PDF')
      expect(defaults.scheduledTime).toBe('08:00')
      expect(defaults.recipients).toEqual([])
      expect(typeof defaults.timezone).toBe('string')
      expect(defaults.timezone.length).toBeGreaterThan(0)
    })
  })

  describe('calculateNextRunPreview', () => {
    it('calculates the next occurrence correctly for DAILY schedule', () => {
      const after = new Date('2026-08-18T00:00:00.000Z')
      const preview = calculateNextRunPreview(
        {
          frequency: 'DAILY',
          recipients: ['a@a.com'],
          format: 'PDF',
          timezone: 'Asia/Ho_Chi_Minh',
          scheduledTime: '08:00',
        },
        after,
      )

      expect(preview).not.toBeNull()
      expect(preview?.toISOString()).toBe('2026-08-18T01:00:00.000Z') // 8:00 UTC+7 is 01:00 UTC
    })

    it('handles WEEKLY next run preview correctly', () => {
      // 2026-08-18 is a Tuesday (dow = 2). Target Monday (dow = 1).
      const after = new Date('2026-08-18T00:00:00.000Z')
      const preview = calculateNextRunPreview(
        {
          frequency: 'WEEKLY',
          recipients: ['a@a.com'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '09:00',
          dayOfWeek: 1,
        },
        after,
      )

      expect(preview).not.toBeNull()
      expect(preview?.toISOString()).toBe('2026-08-24T09:00:00.000Z')
    })

    it('returns null on invalid input configurations gracefully', () => {
      const preview = calculateNextRunPreview({
        frequency: 'CUSTOM_CRON',
        recipients: ['a@a.com'],
        format: 'PDF',
        timezone: 'UTC',
        scheduledTime: '08:00',
        cronExpression: 'invalid',
      })
      expect(preview).toBeNull()
    })

    it('calculates next run for monthly cron 0 8 1 * * (EC-4)', () => {
      const after = new Date('2026-08-18T00:00:00.000Z')
      const preview = calculateNextRunPreview(
        {
          frequency: 'CUSTOM_CRON',
          timezone: 'UTC',
          cronExpression: '0 8 1 * *',
        },
        after,
      )
      expect(preview).not.toBeNull()
      expect(preview?.toISOString()).toBe('2026-09-01T08:00:00.000Z')
    })

    it('calculates next run for step hour cron 0 */2 * * * (EC-4)', () => {
      const after = new Date('2026-08-18T07:30:00.000Z')
      const preview = calculateNextRunPreview(
        {
          frequency: 'CUSTOM_CRON',
          timezone: 'UTC',
          cronExpression: '0 */2 * * *',
        },
        after,
      )
      expect(preview).not.toBeNull()
      expect(preview?.toISOString()).toBe('2026-08-18T08:00:00.000Z')
    })
  })

  describe('formatFrequencySummary', () => {
    it('summarizes DAILY correctly', () => {
      expect(
        formatFrequencySummary({
          frequency: 'DAILY',
          scheduledTime: '08:00',
          timezone: 'UTC',
        }),
      ).toBe('Daily at 08:00 (UTC)')
    })

    it('summarizes WEEKLY with day name', () => {
      expect(
        formatFrequencySummary({
          frequency: 'WEEKLY',
          scheduledTime: '08:00',
          timezone: 'UTC',
          dayOfWeek: 1,
        }),
      ).toBe('Weekly on Monday at 08:00 (UTC)')
    })

    it('summarizes MONTHLY with day of month', () => {
      expect(
        formatFrequencySummary({
          frequency: 'MONTHLY',
          scheduledTime: '09:00',
          timezone: 'Asia/Ho_Chi_Minh',
          dayOfMonth: 1,
        }),
      ).toBe('Monthly on day 1 at 09:00 (Asia/Ho_Chi_Minh)')
    })

    it('summarizes QUARTERLY with cycle months', () => {
      expect(
        formatFrequencySummary({
          frequency: 'QUARTERLY',
          scheduledTime: '08:00',
          timezone: 'UTC',
          startMonth: 1,
          dayOfMonth: 15,
        }),
      ).toBe('Quarterly (Jan, Apr, Jul, Oct) on day 15 at 08:00 (UTC)')
    })

    it('summarizes CUSTOM_CRON with expression', () => {
      expect(
        formatFrequencySummary({
          frequency: 'CUSTOM_CRON',
          scheduledTime: '08:00',
          timezone: 'UTC',
          cronExpression: '0 8 * * 1-5',
        }),
      ).toBe('Cron (0 8 * * 1-5) in UTC')
    })
  })
})
