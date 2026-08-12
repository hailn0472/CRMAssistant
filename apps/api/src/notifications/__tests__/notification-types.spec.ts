import {
  NOTIFICATION_TYPES,
  isNotificationType,
  assertValidNotificationType,
  resolveNotificationTarget,
  MAX_NOTIFICATION_TITLE_LENGTH,
  MAX_NOTIFICATION_BODY_LENGTH,
  normalizeNotificationTitle,
  normalizeNotificationBody,
  DEAL_REMINDER_REASON_LABELS,
} from '../notification-types'

describe('notification-types', () => {
  describe('NOTIFICATION_TYPES', () => {
    it('contains exactly three members', () => {
      expect(NOTIFICATION_TYPES).toEqual(['TASK_ASSIGNED', 'DEAL_REMINDER', 'DEAL_MENTION'])
    })
  })

  describe('isNotificationType', () => {
    it('returns true for every known type', () => {
      for (const type of NOTIFICATION_TYPES) {
        expect(isNotificationType(type)).toBe(true)
      }
    })

    it('returns false for an unknown string', () => {
      expect(isNotificationType('UNKNOWN')).toBe(false)
    })
  })

  describe('assertValidNotificationType', () => {
    it('does not throw for valid types', () => {
      for (const type of NOTIFICATION_TYPES) {
        expect(() => assertValidNotificationType(type)).not.toThrow()
      }
    })

    it('throws for an invalid type', () => {
      expect(() => assertValidNotificationType('INVALID')).toThrow(
        'Invalid notification type: INVALID',
      )
    })
  })

  describe('resolveNotificationTarget', () => {
    it('returns DEAL for a deal-only input', () => {
      expect(resolveNotificationTarget({ dealId: 'd-1', taskId: null })).toEqual({
        target: 'DEAL',
        id: 'd-1',
      })
    })

    it('returns TASK for a task-only input', () => {
      expect(resolveNotificationTarget({ dealId: null, taskId: 't-1' })).toEqual({
        target: 'TASK',
        id: 't-1',
      })
    })

    it('returns NONE for neither', () => {
      expect(resolveNotificationTarget({ dealId: null, taskId: null })).toEqual({
        target: 'NONE',
        id: null,
      })

      expect(resolveNotificationTarget({})).toEqual({
        target: 'NONE',
        id: null,
      })
    })

    it('throws when both are set', () => {
      expect(() => resolveNotificationTarget({ dealId: 'd-1', taskId: 't-1' })).toThrow(
        'A notification may reference at most one of dealId or taskId',
      )
    })
  })

  describe('normalizeNotificationTitle', () => {
    it('trims whitespace', () => {
      expect(normalizeNotificationTitle('  hello  ')).toBe('hello')
    })

    it('truncates at MAX_NOTIFICATION_TITLE_LENGTH (boundary)', () => {
      const atMax = 'x'.repeat(MAX_NOTIFICATION_TITLE_LENGTH)
      expect(normalizeNotificationTitle(atMax)).toHaveLength(MAX_NOTIFICATION_TITLE_LENGTH)
    })

    it('truncates at MAX + 1', () => {
      const overMax = 'x'.repeat(MAX_NOTIFICATION_TITLE_LENGTH + 1)
      const result = normalizeNotificationTitle(overMax)
      expect(result).toHaveLength(MAX_NOTIFICATION_TITLE_LENGTH)
    })

    it('never throws on any input', () => {
      expect(() => normalizeNotificationTitle('x'.repeat(10000))).not.toThrow()
    })
  })

  describe('normalizeNotificationBody', () => {
    it('returns null for null input', () => {
      expect(normalizeNotificationBody(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(normalizeNotificationBody(undefined)).toBeNull()
    })

    it('returns null for whitespace-only string', () => {
      expect(normalizeNotificationBody('   ')).toBeNull()
    })

    it('trims and returns trimmed string', () => {
      expect(normalizeNotificationBody('  hello  ')).toBe('hello')
    })

    it('truncates at MAX_NOTIFICATION_BODY_LENGTH', () => {
      const atMax = 'x'.repeat(MAX_NOTIFICATION_BODY_LENGTH)
      expect(normalizeNotificationBody(atMax)).toHaveLength(MAX_NOTIFICATION_BODY_LENGTH)
    })

    it('truncates at MAX + 1', () => {
      const overMax = 'x'.repeat(MAX_NOTIFICATION_BODY_LENGTH + 1)
      const result = normalizeNotificationBody(overMax)
      expect(result).toHaveLength(MAX_NOTIFICATION_BODY_LENGTH)
    })

    it('never throws on any input', () => {
      expect(() => normalizeNotificationBody('x'.repeat(10000))).not.toThrow()
    })
  })

  describe('DEAL_REMINDER_REASON_LABELS', () => {
    it('maps every expected reason', () => {
      expect(DEAL_REMINDER_REASON_LABELS['NO_ACTIVITY_7D']).toBe('No activity for 7 days')
      expect(DEAL_REMINDER_REASON_LABELS['CLOSING_SOON_3D']).toBe('Closing soon')
      expect(DEAL_REMINDER_REASON_LABELS['AT_RISK']).toBe('Deal at risk')
    })
  })
})
