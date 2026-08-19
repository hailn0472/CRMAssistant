/**
 * Pure unit tests for the customer-analytics score module (Story 6.7).
 * Mirrors test-plan section 5 (F1–F28): exact boundaries 29.9/30/70/70.1,
 * UTC day math, LTV/win-rate/engagement/inactivity, money safety, recommended
 * action precedence and the tenant-level percentile threshold.
 */
import {
  CUSTOMER_CHURN_RISKS,
  calculateChurnRiskScore,
  calculateDealWinRate,
  calculateEngagementScore,
  calculateEngagementRisk,
  calculateInactivityRisk,
  calculateLifetimeValue,
  calculateWinRateRisk,
  categorizeChurnRisk,
  daysBetweenUtc,
  isHighLifetimeValue,
  isQualifyingActivity,
  percentile75,
  percentile75FromOrderStatistics,
  p75OrderStatisticIndices,
  RECOMMENDED_ACTIONS,
  recommendedActionFor,
  buildCurrencyBreakdown,
  ENGAGEMENT_WINDOW_DAYS,
  INACTIVITY_HORIZON_DAYS,
  QUALIFYING_ACTIVITY_TYPES,
  toUtcMidnight,
} from '../customer-analytics-score'

const UTC_MS_PER_DAY = 86_400_000

function utcDate(iso: string): Date {
  return new Date(iso)
}

describe('customer-analytics-score (pure)', () => {
  describe('constants (B7)', () => {
    it('exposes the closed churn risk vocabulary', () => {
      expect(CUSTOMER_CHURN_RISKS).toEqual(['LOW', 'MEDIUM', 'HIGH'])
    })

    it('exposes the qualifying engagement activity types', () => {
      expect(QUALIFYING_ACTIVITY_TYPES).toEqual([
        'EMAIL_SENT',
        'CALL_MADE',
        'MEETING_SCHEDULED',
        'MESSAGE_RECEIVED',
        'MESSAGE_SENT',
      ])
    })

    it('exposes exact label constants for recommended actions (F28)', () => {
      expect(RECOMMENDED_ACTIONS).toEqual([
        { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
        { code: 'UPSELL_OPPORTUNITY', label: 'Upsell opportunity' },
        { code: 'MONITOR', label: 'Monitor' },
      ])
      expect(ENGAGEMENT_WINDOW_DAYS).toBe(90)
      expect(INACTIVITY_HORIZON_DAYS).toBe(90)
    })
  })

  describe('UTC day math (F1, F7)', () => {
    it('normalizes any instant to the UTC midnight of its UTC day (F7)', () => {
      const lateLocal = new Date('2026-08-15T23:59:59.999Z')
      expect(toUtcMidnight(lateLocal).toISOString()).toBe('2026-08-15T00:00:00.000Z')
      const early = new Date('2026-08-15T00:00:00.001Z')
      expect(toUtcMidnight(early).toISOString()).toBe('2026-08-15T00:00:00.000Z')
    })

    it('computes whole UTC days between instants on UTC boundaries (F7)', () => {
      const from = utcDate('2026-08-01T23:59:59.999Z')
      const to = utcDate('2026-08-03T00:00:00.000Z')
      // midnight(08-01) → midnight(08-03) = 2 days regardless of the time-of-day
      expect(daysBetweenUtc(from, to)).toBe(2)
    })
  })

  describe('inactivity risk (F1–F6)', () => {
    const snapshot = toUtcMidnight(utcDate('2026-08-15T02:00:00.000Z'))

    it('day 0 → risk 0 (F1)', () => {
      const today = toUtcMidnight(utcDate('2026-08-15T10:00:00.000Z'))
      expect(calculateInactivityRisk(today, today, snapshot)).toBe(0)
    })

    it('day 89 → 89/90*100 ≈ 98.888… without premature rounding (F2)', () => {
      const last = new Date(snapshot.getTime() - 89 * UTC_MS_PER_DAY)
      expect(calculateInactivityRisk(last, last, snapshot)).toBeCloseTo(98.88888888888889, 5)
    })

    it('day 90 → exactly 100 (F3)', () => {
      const last = new Date(snapshot.getTime() - 90 * UTC_MS_PER_DAY)
      expect(calculateInactivityRisk(last, last, snapshot)).toBe(100)
    })

    it('day 91 → clamped 100 (F4)', () => {
      const last = new Date(snapshot.getTime() - 91 * UTC_MS_PER_DAY)
      expect(calculateInactivityRisk(last, last, snapshot)).toBe(100)
    })

    it('no activity falls back to Contact.createdAt (F5)', () => {
      const createdAt = new Date(snapshot.getTime() - 45 * UTC_MS_PER_DAY)
      expect(calculateInactivityRisk(null, createdAt, snapshot)).toBeCloseTo(50, 5)
    })

    it('future timestamps / bad clock skew clamp to 0 days, never negative (F6)', () => {
      const future = new Date(snapshot.getTime() + 5 * UTC_MS_PER_DAY)
      expect(calculateInactivityRisk(future, future, snapshot)).toBe(0)
      expect(calculateInactivityRisk(future, future, snapshot)).toBeGreaterThanOrEqual(0)
    })
  })

  describe('deal win rate (F8–F10)', () => {
    it('0% when nothing won (F8)', () => {
      expect(calculateDealWinRate(0, 2)).toBe(0)
    })
    it('50% when 2/4 closed (F8)', () => {
      expect(calculateDealWinRate(2, 2)).toBe(50)
    })
    it('100% when nothing lost (F8)', () => {
      expect(calculateDealWinRate(2, 0)).toBe(100)
    })
    it('no closed deals → neutral 50, no division by zero (F9)', () => {
      expect(calculateDealWinRate(0, 0)).toBe(50)
    })
    it('open deals never enter the denominator (F10)', () => {
      // won=1, open=5, lost=0 → closed = 1 → 100%
      expect(calculateDealWinRate(1, 0)).toBe(100)
    })
    it('win-rate risk mirrors the rate (B10)', () => {
      expect(calculateWinRateRisk(50)).toBe(50)
      expect(calculateWinRateRisk(100)).toBe(0)
      expect(calculateWinRateRisk(0)).toBe(100)
    })
  })

  describe('engagement score (F11–F13)', () => {
    const snapshot = toUtcMidnight(utcDate('2026-08-15T02:00:00.000Z'))

    it('qualifying types only — internal types never count (F11)', () => {
      expect(isQualifyingActivity('EMAIL_SENT', snapshot, snapshot)).toBe(true)
      expect(isQualifyingActivity('CALL_MADE', snapshot, snapshot)).toBe(true)
      expect(isQualifyingActivity('MEETING_SCHEDULED', snapshot, snapshot)).toBe(true)
      expect(isQualifyingActivity('MESSAGE_RECEIVED', snapshot, snapshot)).toBe(true)
      expect(isQualifyingActivity('MESSAGE_SENT', snapshot, snapshot)).toBe(true)
      for (const nonQualifying of [
        'NOTE_ADDED',
        'TASK_COMPLETED',
        'DEAL_STAGE_CHANGED',
        'CONTACT_CREATED',
        'CONTACT_UPDATED',
        'CONTACT_OWNER_CHANGED',
        'DEAL_CREATED',
        'TASK_CREATED',
      ]) {
        expect(isQualifyingActivity(nonQualifying, snapshot, snapshot)).toBe(false)
      }
    })

    it('90-day window: exactly windowStart counts, windowStart − 1ms does not (F12)', () => {
      const windowStart = new Date(snapshot.getTime() - 90 * UTC_MS_PER_DAY)
      expect(isQualifyingActivity('EMAIL_SENT', windowStart, snapshot)).toBe(true)
      const justBefore = new Date(windowStart.getTime() - 1)
      expect(isQualifyingActivity('EMAIL_SENT', justBefore, snapshot)).toBe(false)
    })

    it('end-of-snapshot-day inclusive; next day midnight excluded (F12)', () => {
      const endOfDay = new Date(snapshot.getTime() + UTC_MS_PER_DAY - 1)
      expect(isQualifyingActivity('CALL_MADE', endOfDay, snapshot)).toBe(true)
      const nextDay = new Date(snapshot.getTime() + UTC_MS_PER_DAY)
      expect(isQualifyingActivity('CALL_MADE', nextDay, snapshot)).toBe(false)
    })

    it('clamps at 100 and counts zero activities as 0 (F13)', () => {
      expect(calculateEngagementScore(0)).toBe(0)
      expect(calculateEngagementScore(3)).toBe(30)
      expect(calculateEngagementScore(10)).toBe(100)
      expect(calculateEngagementScore(11)).toBe(100)
    })

    it('engagement risk mirrors the score (B10)', () => {
      expect(calculateEngagementRisk(30)).toBe(70)
      expect(calculateEngagementRisk(100)).toBe(0)
      expect(calculateEngagementRisk(0)).toBe(100)
    })
  })

  describe('weighted churn score + exact category boundaries (F14–F19)', () => {
    it('(0.4·50 + 0.3·50 + 0.3·70) = 56 → round1 56 (F14)', () => {
      expect(
        calculateChurnRiskScore({ inactivityRisk: 50, winRateRisk: 50, engagementRisk: 70 }),
      ).toBe(56)
    })

    it('score 29.9 → LOW (F15)', () => {
      expect(categorizeChurnRisk(29.9)).toBe('LOW')
    })

    it('score exactly 30 → MEDIUM (F16)', () => {
      expect(categorizeChurnRisk(30)).toBe('MEDIUM')
      // weighted 29.94 (0.4·74.85) → round1 29.9 → LOW; weighted 29.96 (0.4·74.9) → round1 30.0 → MEDIUM
      expect(
        calculateChurnRiskScore({ inactivityRisk: 74.85, winRateRisk: 0, engagementRisk: 0 }),
      ).toBe(29.9)
      expect(
        calculateChurnRiskScore({ inactivityRisk: 74.9, winRateRisk: 0, engagementRisk: 0 }),
      ).toBe(30)
      expect(
        categorizeChurnRisk(
          calculateChurnRiskScore({ inactivityRisk: 74.9, winRateRisk: 0, engagementRisk: 0 }),
        ),
      ).toBe('MEDIUM')
    })

    it('score exactly 70 → MEDIUM (F17)', () => {
      expect(categorizeChurnRisk(70)).toBe('MEDIUM')
      // weighted 70.04 (0.4·175.1) → round1 70.0 → MEDIUM
      expect(
        calculateChurnRiskScore({ inactivityRisk: 175.1, winRateRisk: 0, engagementRisk: 0 }),
      ).toBe(70)
      expect(
        categorizeChurnRisk(
          calculateChurnRiskScore({ inactivityRisk: 175.1, winRateRisk: 0, engagementRisk: 0 }),
        ),
      ).toBe('MEDIUM')
    })

    it('score 70.1 → HIGH (F18)', () => {
      expect(categorizeChurnRisk(70.1)).toBe('HIGH')
      // weighted 70.06 (0.4·175.15) → round1 70.1 → HIGH
      expect(
        calculateChurnRiskScore({ inactivityRisk: 175.15, winRateRisk: 0, engagementRisk: 0 }),
      ).toBe(70.1)
      expect(
        categorizeChurnRisk(
          calculateChurnRiskScore({ inactivityRisk: 175.15, winRateRisk: 0, engagementRisk: 0 }),
        ),
      ).toBe('HIGH')
    })

    it('clamps the weighted score to 0..100 (F19)', () => {
      expect(
        calculateChurnRiskScore({ inactivityRisk: 200, winRateRisk: 200, engagementRisk: 200 }),
      ).toBe(100)
      expect(
        calculateChurnRiskScore({ inactivityRisk: -5, winRateRisk: -5, engagementRisk: -5 }),
      ).toBe(0)
    })

    it('exactly 30 and 70 are MEDIUM — HIGH only above 70 (contract B12)', () => {
      expect(categorizeChurnRisk(30)).toBe('MEDIUM')
      expect(categorizeChurnRisk(70)).toBe('MEDIUM')
      expect(categorizeChurnRisk(70.0001)).toBe('HIGH')
      expect(categorizeChurnRisk(29.9999)).toBe('LOW')
    })
  })

  describe('LTV money math (F20–F25)', () => {
    it('sums won deal values and rounds to 2 decimals (F20)', () => {
      expect(calculateLifetimeValue([100, 250.5])).toBe(350.5)
      expect(calculateLifetimeValue([0.005])).toBe(0.01) // round-half-up with EPSILON guard
    })

    it('zero won deals → 0 (F21)', () => {
      expect(calculateLifetimeValue([])).toBe(0)
    })

    it('rejects non-finite money values (F24)', () => {
      expect(() => calculateLifetimeValue([Number.NaN])).toThrow(RangeError)
      expect(() => calculateLifetimeValue([Infinity])).toThrow(RangeError)
      expect(() => calculateLifetimeValue([-Infinity])).toThrow(RangeError)
    })

    it('builds a currency breakdown and mixedCurrencies flag (F25)', () => {
      const single = buildCurrencyBreakdown([
        { value: 100, currency: 'USD' },
        { value: 250.5, currency: 'USD' },
      ])
      expect(single).toEqual({
        entries: [{ currency: 'USD', value: 350.5 }],
        mixedCurrencies: false,
      })

      const mixed = buildCurrencyBreakdown([
        { value: 100, currency: 'USD' },
        { value: 250.5, currency: 'USD' },
        { value: 1_000_000, currency: 'VND' },
      ])
      expect(mixed.mixedCurrencies).toBe(true)
      expect(mixed.entries).toEqual([
        { currency: 'USD', value: 350.5 },
        { currency: 'VND', value: 1_000_000 },
      ])
    })
  })

  describe('high-LTV percentile threshold (F27, B14)', () => {
    it('computes a deterministic p75 (Tukey hinges) over positive LTV values (F27)', () => {
      expect(percentile75([100, 200, 300, 400])).toBe(350)
      expect(percentile75([100])).toBe(100)
      expect(percentile75([50, 100])).toBe(100)
      expect(percentile75([100, 200, 300])).toBe(250)
    })

    it('empty positive set → null threshold, nobody is high-LTV (F27)', () => {
      expect(percentile75([])).toBeNull()
      expect(isHighLifetimeValue(100, null)).toBe(false)
      expect(isHighLifetimeValue(0, 100)).toBe(false)
    })

    it('requires lifetimeValue > 0 and >= threshold (B14)', () => {
      expect(isHighLifetimeValue(400, 350)).toBe(true)
      expect(isHighLifetimeValue(350, 350)).toBe(true)
      expect(isHighLifetimeValue(349.99, 350)).toBe(false)
      expect(isHighLifetimeValue(0, 350)).toBe(false)
    })

    it('maps every n to at most 2 exact order-statistic indices (D32)', () => {
      expect(p75OrderStatisticIndices(0)).toEqual([])
      expect(p75OrderStatisticIndices(1)).toEqual([0])
      expect(p75OrderStatisticIndices(2)).toEqual([1])
      expect(p75OrderStatisticIndices(3)).toEqual([1, 2])
      expect(p75OrderStatisticIndices(4)).toEqual([2, 3])
      expect(p75OrderStatisticIndices(5)).toEqual([3])
      expect(p75OrderStatisticIndices(6)).toEqual([4])
      expect(p75OrderStatisticIndices(7)).toEqual([4, 5])
      expect(p75OrderStatisticIndices(8)).toEqual([5, 6])
      expect(p75OrderStatisticIndices(1_000_000).length).toBeLessThanOrEqual(2)
    })

    it('reproduces the exact full-set Tukey-hinges p75 from the bounded indices for n=0..1000 (D32)', () => {
      for (let n = 0; n <= 1000; n++) {
        const values = Array.from({ length: n }, (_, i) => (i + 1) * 10)
        const indices = p75OrderStatisticIndices(n)
        expect(indices.length).toBeLessThanOrEqual(2)
        if (n === 0) {
          expect(percentile75FromOrderStatistics([])).toBeNull()
          continue
        }
        const fetched = indices.map((i) => values[i])
        expect(percentile75FromOrderStatistics(fetched)).toBe(percentile75(values))
      }
    })

    it('derives the threshold value from 1 or 2 fetched order statistics (D32)', () => {
      expect(percentile75FromOrderStatistics([350.5])).toBe(350.5)
      expect(percentile75FromOrderStatistics([1000, 500100])).toBe(250550)
    })
  })

  describe('recommended action precedence (F26, B13)', () => {
    const threshold = 350

    it('HIGH wins over every LTV (F26)', () => {
      expect(recommendedActionFor('HIGH', 400, threshold)).toEqual({
        code: 'SCHEDULE_FOLLOW_UP',
        label: 'Schedule follow-up',
      })
      expect(recommendedActionFor('HIGH', 0, threshold)).toEqual({
        code: 'SCHEDULE_FOLLOW_UP',
        label: 'Schedule follow-up',
      })
    })

    it('MEDIUM is never an upsell, even with high LTV (F26)', () => {
      expect(recommendedActionFor('MEDIUM', 400, threshold)).toEqual({
        code: 'MONITOR',
        label: 'Monitor',
      })
    })

    it('LOW + high-LTV → UPSELL_OPPORTUNITY (F26)', () => {
      expect(recommendedActionFor('LOW', 400, threshold)).toEqual({
        code: 'UPSELL_OPPORTUNITY',
        label: 'Upsell opportunity',
      })
    })

    it('LOW without high LTV → MONITOR (F26)', () => {
      expect(recommendedActionFor('LOW', 100, threshold)).toEqual({
        code: 'MONITOR',
        label: 'Monitor',
      })
    })

    it('tenant without positive LTV → never upsell (F27)', () => {
      expect(recommendedActionFor('LOW', 100, null)).toEqual({ code: 'MONITOR', label: 'Monitor' })
    })
  })
})
