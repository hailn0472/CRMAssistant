/**
 * Story 6.5 (Contract B6-B7, AC 4/17): pure closed-vocabulary and validation
 * tests. Framework-free — no Nest/Prisma imports (Contract G36).
 */
import {
  REPORT_SCHEDULE_FREQUENCIES,
  REPORT_DELIVERY_FORMATS,
  REPORT_SCHEDULE_EXECUTION_STATUSES,
  ScheduleValidationError,
  normalizeAndValidateScheduleInput,
  normalizeAndValidateScheduleUpdate,
  validateRecipients,
  isValidIanaTimezone,
  isValidScheduledTime,
  validateCadenceConsistency,
  MAX_RECIPIENTS,
  MAX_RECIPIENT_LENGTH,
} from '../report-schedule-types'

describe('report-schedule-types', () => {
  describe('closed vocabularies', () => {
    it('exposes exactly the five epic frequencies', () => {
      expect(REPORT_SCHEDULE_FREQUENCIES).toEqual([
        'DAILY',
        'WEEKLY',
        'MONTHLY',
        'QUARTERLY',
        'CUSTOM_CRON',
      ])
      expect(REPORT_SCHEDULE_FREQUENCIES.length).toBe(5)
    })

    it('exposes exactly the three delivery formats', () => {
      expect(REPORT_DELIVERY_FORMATS).toEqual(['PDF', 'EXCEL', 'CSV'])
      expect(REPORT_DELIVERY_FORMATS.length).toBe(3)
    })

    it('exposes PROCESSING plus the three terminal statuses', () => {
      expect(REPORT_SCHEDULE_EXECUTION_STATUSES).toEqual([
        'PROCESSING',
        'SUCCESS',
        'FAILED',
        'SKIPPED',
      ])
      expect(REPORT_SCHEDULE_EXECUTION_STATUSES.length).toBe(4)
    })
  })

  describe('validateRecipients', () => {
    it('trims, lower-cases and case-insensitively dedupes addresses', () => {
      const out = validateRecipients(['  A@B.com ', 'a@b.com', 'c@d.io'])
      expect(out).toEqual(['a@b.com', 'c@d.io'])
    })

    it('rejects non-arrays, empty and oversized lists', () => {
      expect(() => validateRecipients('nope' as unknown)).toThrow(ScheduleValidationError)
      expect(() => validateRecipients([])).toThrow(ScheduleValidationError)
      expect(() =>
        validateRecipients(Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `${i}@x.io`)),
      ).toThrow(ScheduleValidationError)
    })

    it('rejects CR/LF header injection and control characters', () => {
      expect(() => validateRecipients(['a@b.com\r\nBcc: evil@x.io'])).toThrow(
        ScheduleValidationError,
      )
      expect(() => validateRecipients(['a@b.com\nTo: evil@x.io'])).toThrow(ScheduleValidationError)
    })

    it('rejects malformed and over-long addresses', () => {
      expect(() => validateRecipients(['not-an-email'])).toThrow(ScheduleValidationError)
      expect(() => validateRecipients(['@nodomain'])).toThrow(ScheduleValidationError)
      expect(() => validateRecipients(['a@'.padEnd(MAX_RECIPIENT_LENGTH + 2, 'x')])).toThrow(
        ScheduleValidationError,
      )
    })
  })

  describe('isValidIanaTimezone / isValidScheduledTime', () => {
    it('accepts real IANA zones and rejects garbage', () => {
      expect(isValidIanaTimezone('UTC')).toBe(true)
      expect(isValidIanaTimezone('America/New_York')).toBe(true)
      expect(isValidIanaTimezone('Asia/Ho_Chi_Minh')).toBe(true)
      expect(isValidIanaTimezone('Not/AZone')).toBe(false)
      expect(isValidIanaTimezone('')).toBe(false)
    })

    it('accepts exact HH:mm and rejects everything else', () => {
      expect(isValidScheduledTime('00:00')).toBe(true)
      expect(isValidScheduledTime('09:30')).toBe(true)
      expect(isValidScheduledTime('23:59')).toBe(true)
      expect(isValidScheduledTime('24:00')).toBe(false)
      expect(isValidScheduledTime('9:30')).toBe(false)
      expect(isValidScheduledTime('09:60')).toBe(false)
      expect(isValidScheduledTime('')).toBe(false)
    })
  })

  describe('validateCadenceConsistency', () => {
    const base = { timezone: 'UTC', scheduledTime: '09:00' }

    it('DAILY rejects any day/month/cron field', () => {
      expect(() => validateCadenceConsistency('DAILY', { ...base, dayOfWeek: 1 })).toThrow(
        ScheduleValidationError,
      )
      expect(() => validateCadenceConsistency('DAILY', { ...base, dayOfMonth: 1 })).toThrow(
        ScheduleValidationError,
      )
      expect(() =>
        validateCadenceConsistency('DAILY', { ...base, cronExpression: '0 9 * * *' }),
      ).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('DAILY', base)).not.toThrow()
    })

    it('WEEKLY requires exactly one dayOfWeek in 0-6', () => {
      expect(() => validateCadenceConsistency('WEEKLY', base)).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('WEEKLY', { ...base, dayOfWeek: 7 })).toThrow(
        ScheduleValidationError,
      )
      expect(() =>
        validateCadenceConsistency('WEEKLY', { ...base, dayOfWeek: 0, dayOfMonth: 5 }),
      ).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('WEEKLY', { ...base, dayOfWeek: 3 })).not.toThrow()
    })

    it('MONTHLY requires exactly one dayOfMonth in 1-31', () => {
      expect(() => validateCadenceConsistency('MONTHLY', base)).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('MONTHLY', { ...base, dayOfMonth: 0 })).toThrow(
        ScheduleValidationError,
      )
      expect(() => validateCadenceConsistency('MONTHLY', { ...base, dayOfMonth: 32 })).toThrow(
        ScheduleValidationError,
      )
      expect(() =>
        validateCadenceConsistency('MONTHLY', { ...base, dayOfMonth: 15, startMonth: 3 }),
      ).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('MONTHLY', { ...base, dayOfMonth: 15 })).not.toThrow()
    })

    it('QUARTERLY requires dayOfMonth plus startMonth in 1-12', () => {
      expect(() => validateCadenceConsistency('QUARTERLY', base)).toThrow(ScheduleValidationError)
      expect(() => validateCadenceConsistency('QUARTERLY', { ...base, dayOfMonth: 1 })).toThrow(
        ScheduleValidationError,
      )
      expect(() =>
        validateCadenceConsistency('QUARTERLY', { ...base, dayOfMonth: 1, startMonth: 13 }),
      ).toThrow(ScheduleValidationError)
      expect(() =>
        validateCadenceConsistency('QUARTERLY', { ...base, dayOfMonth: 31, startMonth: 1 }),
      ).not.toThrow()
    })

    it('CUSTOM_CRON requires a validated five-field, at-most-hourly expression', () => {
      expect(() => validateCadenceConsistency('CUSTOM_CRON', base)).toThrow(ScheduleValidationError)
      expect(() =>
        validateCadenceConsistency('CUSTOM_CRON', { ...base, cronExpression: '0 9 * * *' }),
      ).not.toThrow()
      // seconds field is rejected
      expect(() =>
        validateCadenceConsistency('CUSTOM_CRON', { ...base, cronExpression: '0 0 9 * * *' }),
      ).toThrow(ScheduleValidationError)
      // sub-hourly cadence is rejected
      expect(() =>
        validateCadenceConsistency('CUSTOM_CRON', { ...base, cronExpression: '*/30 * * * *' }),
      ).toThrow(ScheduleValidationError)
      expect(() =>
        validateCadenceConsistency('CUSTOM_CRON', { ...base, cronExpression: 'bogus' }),
      ).toThrow(ScheduleValidationError)
    })
  })

  describe('normalizeAndValidateScheduleUpdate', () => {
    it('validates only the provided keys and rejects unknown/reportId', () => {
      expect(() => normalizeAndValidateScheduleUpdate({ reportId: 'x' })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ evil: 1 })).toThrow(ScheduleValidationError)
      expect(() => normalizeAndValidateScheduleUpdate({ dayOfWeek: 9 })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ dayOfMonth: 0 })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ startMonth: 13 })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ cronExpression: 'x'.repeat(200) })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ timezone: 'Nope/Nope' })).toThrow(
        ScheduleValidationError,
      )
      expect(() => normalizeAndValidateScheduleUpdate({ scheduledTime: '9am' })).toThrow(
        ScheduleValidationError,
      )
      const out = normalizeAndValidateScheduleUpdate({ recipients: ['A@x.io'], format: 'CSV' })
      expect(out).toMatchObject({ recipients: ['a@x.io'], format: 'CSV' })
    })
  })

  describe('normalizeAndValidateScheduleInput', () => {
    it('rejects unknown keys', () => {
      expect(() =>
        normalizeAndValidateScheduleInput({
          frequency: 'DAILY',
          recipients: ['a@b.com'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '09:00',
          evil: true,
        }),
      ).toThrow(ScheduleValidationError)
    })

    it('rejects an unsupported frequency/format', () => {
      expect(() =>
        normalizeAndValidateScheduleInput({
          frequency: 'HOURLY',
          recipients: ['a@b.com'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '09:00',
        }),
      ).toThrow(ScheduleValidationError)
      expect(() =>
        normalizeAndValidateScheduleInput({
          frequency: 'DAILY',
          recipients: ['a@b.com'],
          format: 'DOCX',
          timezone: 'UTC',
          scheduledTime: '09:00',
        }),
      ).toThrow(ScheduleValidationError)
    })

    it('rejects mixed incompatible fields', () => {
      expect(() =>
        normalizeAndValidateScheduleInput({
          frequency: 'DAILY',
          recipients: ['a@b.com'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '09:00',
          dayOfWeek: 1,
        }),
      ).toThrow(ScheduleValidationError)
    })

    it('normalizes a valid create input', () => {
      const out = normalizeAndValidateScheduleInput({
        reportId: 'rep-1',
        frequency: 'WEEKLY',
        recipients: ['B@x.io', 'b@x.io', 'a@x.io'],
        format: 'EXCEL',
        timezone: 'America/New_York',
        scheduledTime: '08:30',
        dayOfWeek: 4,
      })
      expect(out).toEqual({
        reportId: 'rep-1',
        frequency: 'WEEKLY',
        recipients: ['b@x.io', 'a@x.io'],
        format: 'EXCEL',
        timezone: 'America/New_York',
        scheduledTime: '08:30',
        dayOfWeek: 4,
        dayOfMonth: undefined,
        startMonth: undefined,
        cronExpression: undefined,
      })
    })
  })
})
