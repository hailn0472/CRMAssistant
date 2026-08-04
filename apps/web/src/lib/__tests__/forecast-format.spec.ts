import {
  formatVariance,
  accuracyBand,
  formatAxisTick,
  salesForecastToCsv,
} from '../forecast-format'

describe('forecast-format', () => {
  describe('formatVariance', () => {
    it('returns "—" for null', () => {
      expect(formatVariance(null)).toBe('—')
    })

    it('prefixes positive values with +', () => {
      expect(formatVariance(5000)).toBe('+5,000')
    })

    it('keeps negative sign', () => {
      expect(formatVariance(-2000)).toBe('-2,000')
    })

    it('returns 0 for zero', () => {
      expect(formatVariance(0)).toBe('0')
    })
  })

  describe('accuracyBand', () => {
    it('returns "No data" for null', () => {
      expect(accuracyBand(null)).toBe('No data')
    })

    it('returns "On track" for >= 95', () => {
      expect(accuracyBand(95)).toBe('On track')
      expect(accuracyBand(100)).toBe('On track')
      expect(accuracyBand(150)).toBe('On track')
    })

    it('returns "Close" for >= 80', () => {
      expect(accuracyBand(80)).toBe('Close')
      expect(accuracyBand(94.9)).toBe('Close')
    })

    it('returns "Off track" for >= 50', () => {
      expect(accuracyBand(50)).toBe('Off track')
      expect(accuracyBand(79)).toBe('Off track')
    })

    it('returns "Significantly off" for < 50', () => {
      expect(accuracyBand(49)).toBe('Significantly off')
      expect(accuracyBand(0)).toBe('Significantly off')
    })
  })

  describe('formatAxisTick', () => {
    it('extracts first word from "Aug 2026"', () => {
      expect(formatAxisTick('Aug 2026')).toBe('Aug')
    })

    it('extracts "Q3" from "Q3 2026"', () => {
      expect(formatAxisTick('Q3 2026')).toBe('Q3')
    })

    it('returns first word for multi-word labels', () => {
      expect(formatAxisTick('Alice Smith')).toBe('Alice')
    })
  })

  describe('salesForecastToCsv', () => {
    const forecast = {
      buckets: [{ label: 'Aug 2026', weightedValue: 50000, totalValue: 100000, count: 3 }],
      commit: { weightedValue: 30000, totalValue: 60000, count: 2 },
      bestCase: { weightedValue: 50000, totalValue: 100000, count: 3 },
      pipeline: { weightedValue: 80000, totalValue: 150000, count: 5 },
    }

    it('renders a header row, one row per bucket, then the three bands', () => {
      const csv = salesForecastToCsv(forecast)
      const lines = csv.split('\n')

      expect(lines[0]).toBe('Period,Weighted value,Total value,Deals')
      expect(lines[1]).toBe('Aug 2026,50000,100000,3')
      expect(lines[2]).toBe('')
      expect(lines[3]).toBe('Commit,30000,60000,2')
      expect(lines[4]).toBe('Best case,50000,100000,3')
      expect(lines[5]).toBe('Pipeline,80000,150000,5')
    })

    it('quotes fields containing a comma', () => {
      const csv = salesForecastToCsv({
        ...forecast,
        buckets: [{ label: 'Aug, 2026', weightedValue: 1, totalValue: 1, count: 1 }],
      })
      expect(csv).toContain('"Aug, 2026"')
    })
  })
})
