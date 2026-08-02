import {
  HEALTH_SIGNAL_LABELS,
  HEALTH_STATUS_LABELS,
  formatDaysSince,
  formatSnoozedUntil,
  healthBadgeVariant,
} from '../deal-health-format'

describe('deal-health-format', () => {
  describe('HEALTH_STATUS_LABELS', () => {
    it('maps every status to its sentence-case label', () => {
      expect(HEALTH_STATUS_LABELS['HEALTHY']).toBe('Healthy')
      expect(HEALTH_STATUS_LABELS['AT_RISK']).toBe('At risk')
      expect(HEALTH_STATUS_LABELS['STALE']).toBe('Stale')
      expect(Object.keys(HEALTH_STATUS_LABELS)).toHaveLength(3)
    })
  })

  describe('healthBadgeVariant', () => {
    it('maps HEALTHY → success, AT_RISK → warning, STALE → danger (AC 47)', () => {
      expect(healthBadgeVariant('HEALTHY')).toBe('success')
      expect(healthBadgeVariant('AT_RISK')).toBe('warning')
      expect(healthBadgeVariant('STALE')).toBe('danger')
    })
  })

  describe('HEALTH_SIGNAL_LABELS', () => {
    it('maps every signal to a plain-sentence label', () => {
      expect(HEALTH_SIGNAL_LABELS['NO_ACTIVITY_7D']).toBe('No activity in 7+ days')
      expect(HEALTH_SIGNAL_LABELS['NO_ACTIVITY_14D']).toBe('No activity in 14+ days')
      expect(HEALTH_SIGNAL_LABELS['NO_CLOSE_DATE']).toBe('No expected close date set')
      expect(HEALTH_SIGNAL_LABELS['PAST_CLOSE_DATE']).toBe('Close date is past due')
      expect(HEALTH_SIGNAL_LABELS['CLOSING_SOON']).toBe('Closing within 3 days')
      expect(HEALTH_SIGNAL_LABELS['PROBABILITY_MISMATCH']).toBe(
        "Probability doesn't match the stage",
      )
      expect(Object.keys(HEALTH_SIGNAL_LABELS)).toHaveLength(6)
    })
  })

  describe('formatDaysSince', () => {
    it('formats 0 days as "today"', () => {
      const now = new Date('2026-08-01T10:00:00.000Z')
      expect(formatDaysSince('2026-08-01T00:00:00.000Z', now)).toBe('today')
    })

    it('formats 1 day as "1 day ago"', () => {
      const now = new Date('2026-08-01T10:00:00.000Z')
      expect(formatDaysSince('2026-07-31T00:00:00.000Z', now)).toBe('1 day ago')
    })

    it('formats many days as "N days ago"', () => {
      const now = new Date('2026-08-01T10:00:00.000Z')
      expect(formatDaysSince('2026-07-01T00:00:00.000Z', now)).toBe('31 days ago')
    })
  })

  describe('formatSnoozedUntil', () => {
    it('formats an ISO date into a human-readable date', () => {
      const result = formatSnoozedUntil('2026-08-08T00:00:00.000Z')
      expect(result).toBe(new Date('2026-08-08T00:00:00.000Z').toLocaleDateString())
    })
  })
})
