import {
  AT_RISK_SCORE_THRESHOLD,
  CLOSING_SOON_DAYS,
  CRITICAL_ACTIVITY_DAYS,
  DEAL_HEALTH_SIGNALS,
  DEAL_HEALTH_STATUSES,
  PROBABILITY_MISMATCH_POINTS,
  STALE_ACTIVITY_DAYS,
  STALE_SCORE_THRESHOLD,
  daysBetweenUtc,
  scoreDealHealth,
  toUtcMidnight,
} from '../deal-health-score'
import type { DealHealthInput } from '../deal-health-score'

const NOW = new Date('2026-08-01T10:30:00.000Z')

function healthyInput(overrides: Partial<DealHealthInput> = {}): DealHealthInput {
  return {
    stageIsWon: false,
    stageIsLost: false,
    stageProbability: 25,
    dealProbability: 25,
    expectedCloseDate: new Date('2026-08-20T00:00:00.000Z'),
    lastActivityAt: new Date('2026-07-30T00:00:00.000Z'),
    ...overrides,
  }
}

describe('deal-health-score constants and tuples', () => {
  it('exports the exact constants declared in AC 1', () => {
    expect(STALE_ACTIVITY_DAYS).toBe(7)
    expect(CRITICAL_ACTIVITY_DAYS).toBe(14)
    expect(CLOSING_SOON_DAYS).toBe(3)
    expect(PROBABILITY_MISMATCH_POINTS).toBe(25)
    expect(AT_RISK_SCORE_THRESHOLD).toBe(70)
    expect(STALE_SCORE_THRESHOLD).toBe(40)
  })

  it('exports exactly three statuses and no Blocked', () => {
    expect(DEAL_HEALTH_STATUSES).toEqual(['HEALTHY', 'AT_RISK', 'STALE'])
    expect(DEAL_HEALTH_STATUSES).toHaveLength(3)
    expect(DEAL_HEALTH_STATUSES).not.toContain('BLOCKED')
    expect(DEAL_HEALTH_STATUSES).not.toContain('Blocked')
  })

  it('exports exactly the six signals in the fixed order of AC 3', () => {
    expect(DEAL_HEALTH_SIGNALS).toEqual([
      'NO_ACTIVITY_7D',
      'NO_ACTIVITY_14D',
      'NO_CLOSE_DATE',
      'PAST_CLOSE_DATE',
      'CLOSING_SOON',
      'PROBABILITY_MISMATCH',
    ])
    expect(DEAL_HEALTH_SIGNALS).toHaveLength(6)
  })
})

describe('toUtcMidnight', () => {
  it('normalizes any time of day to UTC midnight', () => {
    expect(toUtcMidnight(new Date('2026-08-01T23:59:59.999Z'))).toEqual(
      new Date('2026-08-01T00:00:00.000Z'),
    )
    expect(toUtcMidnight(new Date('2026-08-01T00:00:00.000Z'))).toEqual(
      new Date('2026-08-01T00:00:00.000Z'),
    )
  })

  it('does not shift across DST-like boundaries because it is UTC-based', () => {
    // Local time zones with DST would shift a local-midnight construction;
    // a UTC-midnight construction is stable regardless of the host zone.
    const result = toUtcMidnight(new Date('2026-03-08T12:00:00.000Z')) // US DST start
    expect(result).toEqual(new Date('2026-03-08T00:00:00.000Z'))
    expect(result.getUTCHours()).toBe(0)
    expect(result.getUTCMinutes()).toBe(0)
  })
})

describe('daysBetweenUtc', () => {
  it('returns 0 for two instants on the same UTC day', () => {
    expect(
      daysBetweenUtc(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-01T23:59:59.000Z')),
    ).toBe(0)
  })

  it('returns 1 for instants one UTC day apart regardless of the hour', () => {
    expect(
      daysBetweenUtc(new Date('2026-07-31T23:00:00.000Z'), new Date('2026-08-01T01:00:00.000Z')),
    ).toBe(1)
  })

  it('returns the integer day count for far-apart dates', () => {
    expect(
      daysBetweenUtc(new Date('2026-07-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')),
    ).toBe(31)
  })
})

describe('scoreDealHealth — closed deals', () => {
  it('returns null when the stage is won', () => {
    expect(scoreDealHealth(healthyInput({ stageIsWon: true }), NOW)).toBeNull()
  })

  it('returns null when the stage is lost', () => {
    expect(scoreDealHealth(healthyInput({ stageIsLost: true }), NOW)).toBeNull()
  })
})

describe('scoreDealHealth — deductions in isolation', () => {
  it('deducts 40 and flags NO_ACTIVITY_14D at exactly 14 days since last activity', () => {
    const result = scoreDealHealth(
      healthyInput({ lastActivityAt: new Date('2026-07-18T00:00:00.000Z') }),
      NOW,
    )
    expect(result?.score).toBe(60)
    expect(result?.signals).toContain('NO_ACTIVITY_14D')
    expect(result?.signals).not.toContain('NO_ACTIVITY_7D')
  })

  it('deducts 20 and flags NO_ACTIVITY_7D at exactly 7 days (not at 6)', () => {
    const atSeven = scoreDealHealth(
      healthyInput({ lastActivityAt: new Date('2026-07-25T00:00:00.000Z') }),
      NOW,
    )
    expect(atSeven?.score).toBe(80)
    expect(atSeven?.signals).toEqual(['NO_ACTIVITY_7D'])

    const atSix = scoreDealHealth(
      healthyInput({ lastActivityAt: new Date('2026-07-26T00:00:00.000Z') }),
      NOW,
    )
    expect(atSix?.score).toBe(100)
    expect(atSix?.signals).toEqual([])
  })

  it('deducts 10 and flags NO_CLOSE_DATE when expectedCloseDate is null', () => {
    const result = scoreDealHealth(healthyInput({ expectedCloseDate: null }), NOW)
    expect(result?.score).toBe(90)
    expect(result?.signals).toEqual(['NO_CLOSE_DATE'])
  })

  it('deducts 40 and flags PAST_CLOSE_DATE when the close date is 1 day past', () => {
    const result = scoreDealHealth(
      healthyInput({ expectedCloseDate: new Date('2026-07-31T00:00:00.000Z') }),
      NOW,
    )
    expect(result?.score).toBe(60)
    expect(result?.signals).toEqual(['PAST_CLOSE_DATE'])
  })

  it('deducts 15 and flags CLOSING_SOON when the close date is exactly today', () => {
    const result = scoreDealHealth(
      healthyInput({ expectedCloseDate: new Date('2026-08-01T00:00:00.000Z') }),
      NOW,
    )
    expect(result?.score).toBe(85)
    expect(result?.signals).toEqual(['CLOSING_SOON'])
  })

  it('deducts 15 when the close date is exactly 3 days out and nothing when 4 days out', () => {
    const atThree = scoreDealHealth(
      healthyInput({ expectedCloseDate: new Date('2026-08-04T00:00:00.000Z') }),
      NOW,
    )
    expect(atThree?.score).toBe(85)
    expect(atThree?.signals).toEqual(['CLOSING_SOON'])

    const atFour = scoreDealHealth(
      healthyInput({ expectedCloseDate: new Date('2026-08-05T00:00:00.000Z') }),
      NOW,
    )
    expect(atFour?.score).toBe(100)
    expect(atFour?.signals).toEqual([])
  })

  it('deducts 20 and flags PROBABILITY_MISMATCH at exactly 25 points difference, not at 24', () => {
    const atTwentyFive = scoreDealHealth(healthyInput({ dealProbability: 50 }), NOW)
    expect(atTwentyFive?.score).toBe(80)
    expect(atTwentyFive?.signals).toEqual(['PROBABILITY_MISMATCH'])

    const atTwentyFour = scoreDealHealth(healthyInput({ dealProbability: 49 }), NOW)
    expect(atTwentyFour?.score).toBe(100)
    expect(atTwentyFour?.signals).toEqual([])
  })

  it('clamps a negative score to 0', () => {
    const result = scoreDealHealth(
      healthyInput({
        lastActivityAt: new Date('2026-06-01T00:00:00.000Z'),
        expectedCloseDate: new Date('2026-06-01T00:00:00.000Z'),
        dealProbability: 0,
      }),
      NOW,
    )
    expect(result?.score).toBe(0)
  })

  it('never exceeds 100 even when no deduction applies', () => {
    const result = scoreDealHealth(healthyInput(), NOW)
    expect(result?.score).toBe(100)
  })
})

describe('scoreDealHealth — status mapping and signal ordering', () => {
  it('maps 100 to HEALTHY with no signals', () => {
    const result = scoreDealHealth(healthyInput(), NOW)
    expect(result?.status).toBe('HEALTHY')
    expect(result?.score).toBe(100)
    expect(result?.signals).toEqual([])
  })

  it('maps exactly 70 to HEALTHY (the AT_RISK_SCORE_THRESHOLD boundary)', () => {
    // 100 - 10 (NO_CLOSE_DATE) - 20 (NO_ACTIVITY_7D) = 70
    const result = scoreDealHealth(
      healthyInput({
        expectedCloseDate: null,
        lastActivityAt: new Date('2026-07-23T00:00:00.000Z'), // 9 days → -20
      }),
      NOW,
    )
    expect(result?.score).toBe(70)
    expect(result?.status).toBe('HEALTHY')
  })

  it('maps the highest score below 70 (65) to AT_RISK', () => {
    // 100 - 20 (NO_ACTIVITY_7D) - 15 (CLOSING_SOON) = 65
    const result = scoreDealHealth(
      healthyInput({
        lastActivityAt: new Date('2026-07-23T00:00:00.000Z'), // 9 days → -20
        expectedCloseDate: new Date('2026-08-01T00:00:00.000Z'), // today → -15
      }),
      NOW,
    )
    expect(result?.score).toBe(65)
    expect(result?.status).toBe('AT_RISK')
  })

  it('maps exactly 40 to AT_RISK (the STALE_SCORE_THRESHOLD boundary)', () => {
    // 100 - 40 (PAST_CLOSE_DATE) - 20 (NO_ACTIVITY_7D) = 40
    const result = scoreDealHealth(
      healthyInput({
        expectedCloseDate: new Date('2026-07-30T00:00:00.000Z'), // 2 days past → -40
        lastActivityAt: new Date('2026-07-23T00:00:00.000Z'), // 9 days → -20
      }),
      NOW,
    )
    expect(result?.score).toBe(40)
    expect(result?.status).toBe('AT_RISK')
  })

  it('maps the highest score below 40 (35) to STALE', () => {
    // 100 - 40 (NO_ACTIVITY_14D) - 20 (PROBABILITY_MISMATCH) - 5? — 35 is
    // unreachable (all deductions are multiples of 5 but 5 is not a
    // deduction). Reachable below-40: 20 via -40 (NO_ACTIVITY_14D) + -40
    // (PAST_CLOSE_DATE), and 35 via -40 + -15 + -10? -40 (NO_ACTIVITY_14D) +
    // -15 (CLOSING_SOON) + -10 (NO_CLOSE_DATE) are mutually exclusive on the
    // close date, so 35 is unreachable too. Assert 20 → STALE instead.
    const stale = scoreDealHealth(
      healthyInput({
        expectedCloseDate: new Date('2026-07-20T00:00:00.000Z'), // past → -40
        lastActivityAt: new Date('2026-07-01T00:00:00.000Z'), // 31 days → -40
      }),
      NOW,
    )
    expect(stale?.score).toBe(20)
    expect(stale?.status).toBe('STALE')
  })

  it('clamps the score to 0 and reports STALE', () => {
    const result = scoreDealHealth(
      healthyInput({
        lastActivityAt: new Date('2026-06-01T00:00:00.000Z'), // -40
        expectedCloseDate: new Date('2026-06-01T00:00:00.000Z'), // -40
        dealProbability: 0, // -20
      }),
      NOW,
    )
    expect(result?.score).toBe(0)
    expect(result?.status).toBe('STALE')
  })

  it('returns signals in the fixed AC 3 order regardless of evaluation order', () => {
    const result = scoreDealHealth(
      healthyInput({
        lastActivityAt: new Date('2026-07-01T00:00:00.000Z'), // NO_ACTIVITY_14D
        expectedCloseDate: new Date('2026-08-04T00:00:00.000Z'), // CLOSING_SOON
        dealProbability: 0, // PROBABILITY_MISMATCH
      }),
      NOW,
    )
    expect(result?.signals).toEqual(['NO_ACTIVITY_14D', 'CLOSING_SOON', 'PROBABILITY_MISMATCH'])
  })

  it('always populates signals for a non-HEALTHY result (AC 9)', () => {
    const results = [
      scoreDealHealth(healthyInput({ lastActivityAt: new Date('2026-07-01T00:00:00.000Z') }), NOW),
      scoreDealHealth(healthyInput({ expectedCloseDate: null }), NOW),
      scoreDealHealth(
        healthyInput({
          lastActivityAt: new Date('2026-07-01T00:00:00.000Z'),
          expectedCloseDate: null,
          dealProbability: 0,
        }),
        NOW,
      ),
    ]
    for (const result of results) {
      if (result && result.status !== 'HEALTHY') {
        expect(result.signals.length).toBeGreaterThan(0)
      }
    }
  })
})
