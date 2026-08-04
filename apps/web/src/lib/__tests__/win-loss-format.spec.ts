import {
  formatReasonLabel,
  formatWinRate,
  formatPercent,
  formatPercentTick,
  formatDateInput,
  startOfCurrentQuarterUtc,
  startOfLast30DaysUtc,
  startOfCurrentYearUtc,
  todayUtc,
  winLossAnalysisToCsv,
} from '../win-loss-format'

describe('win-loss-format', () => {
  describe('formatWinRate', () => {
    it('formats 62.5 → "62.5%"', () => {
      expect(formatWinRate(62.5)).toBe('62.5%')
    })

    it('formats 0 → "0.0%"', () => {
      expect(formatWinRate(0)).toBe('0.0%')
    })

    it('formats 100 → "100.0%"', () => {
      expect(formatWinRate(100)).toBe('100.0%')
    })

    it('formats a fraction to one decimal', () => {
      expect(formatWinRate(66.666)).toBe('66.7%')
    })
  })

  describe('formatPercent', () => {
    it('formats 50 → "50.0%"', () => {
      expect(formatPercent(50)).toBe('50.0%')
    })

    it('formats 33.33 → "33.3%"', () => {
      expect(formatPercent(33.33)).toBe('33.3%')
    })
  })

  describe('formatPercentTick', () => {
    it('rounds to an integer with % sign', () => {
      expect(formatPercentTick(25)).toBe('25%')
      expect(formatPercentTick(66.7)).toBe('67%')
      expect(formatPercentTick(0)).toBe('0%')
    })
  })

  describe('formatReasonLabel', () => {
    it('maps catalog values to human labels', () => {
      expect(formatReasonLabel('PRICE')).toBe('Price')
      expect(formatReasonLabel('FEATURES')).toBe('Features')
      expect(formatReasonLabel('TIMING')).toBe('Timing')
      expect(formatReasonLabel('COMPETITOR')).toBe('Competitor')
      expect(formatReasonLabel('BUDGET')).toBe('Budget')
      expect(formatReasonLabel('OTHER')).toBe('Other')
    })

    it('falls back to the raw value for unknown reasons', () => {
      expect(formatReasonLabel('MYSTERY')).toBe('MYSTERY')
    })
  })

  describe('formatDateInput', () => {
    it('renders a UTC YYYY-MM-DD date', () => {
      expect(formatDateInput(new Date('2026-07-31T12:00:00.000Z'))).toBe('2026-07-31')
    })
  })

  describe('startOfCurrentQuarterUtc', () => {
    it('returns the first day of the current UTC quarter', () => {
      expect(startOfCurrentQuarterUtc(new Date('2026-05-15T00:00:00.000Z')).toISOString()).toBe(
        '2026-04-01T00:00:00.000Z',
      )
      expect(startOfCurrentQuarterUtc(new Date('2026-02-01T00:00:00.000Z')).toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      )
      expect(startOfCurrentQuarterUtc(new Date('2026-12-31T00:00:00.000Z')).toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      )
    })
  })

  describe('todayUtc', () => {
    it('returns today at UTC midnight', () => {
      const now = new Date('2026-07-31T18:30:00.000Z')
      expect(todayUtc(now).toISOString()).toBe('2026-07-31T00:00:00.000Z')
    })
  })

  describe('startOfLast30DaysUtc', () => {
    it('returns 30 days before today at UTC midnight', () => {
      const now = new Date('2026-08-03T18:30:00.000Z')
      expect(startOfLast30DaysUtc(now).toISOString()).toBe('2026-07-04T00:00:00.000Z')
    })
  })

  describe('startOfCurrentYearUtc', () => {
    it('returns January 1st of the current UTC year', () => {
      expect(startOfCurrentYearUtc(new Date('2026-08-03T18:30:00.000Z')).toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      )
    })
  })

  describe('winLossAnalysisToCsv', () => {
    const analysis = {
      wonCount: 2,
      lostCount: 1,
      winRate: 66.7,
      wonValue: 30000,
      lostValue: 5000,
      winReasons: [{ reason: 'PRICE', count: 1, totalValue: 10000 }],
      lossReasons: [{ reason: 'BUDGET', count: 1, totalValue: 5000 }],
      competitors: [
        { competitorName: 'Acme Corp', wonCount: 1, lostCount: 0, winRate: 100, totalValue: 10000 },
      ],
    }

    it('renders summary, reason and competitor sections', () => {
      const csv = winLossAnalysisToCsv(analysis)
      const lines = csv.split('\n')

      expect(lines[0]).toBe('Won deals,2')
      expect(lines[1]).toBe('Lost deals,1')
      expect(lines[2]).toBe('Win rate,66.7%')
      expect(lines[3]).toBe('Won value,30000')
      expect(lines[4]).toBe('Lost value,5000')
      expect(lines[5]).toBe('')
      expect(lines[6]).toBe('Reason,Outcome,Count,Total value')
      expect(lines[7]).toBe('Price,Won,1,10000')
      expect(lines[8]).toBe('Budget,Lost,1,5000')
      expect(lines[9]).toBe('')
      expect(lines[10]).toBe('Competitor,Won,Lost,Win rate,Total value')
      expect(lines[11]).toBe('Acme Corp,1,0,100.0%,10000')
    })

    it('quotes competitor names containing a comma', () => {
      const csv = winLossAnalysisToCsv({
        ...analysis,
        competitors: [{ ...analysis.competitors[0]!, competitorName: 'Acme, Inc' }],
      })
      expect(csv).toContain('"Acme, Inc"')
    })
  })
})
