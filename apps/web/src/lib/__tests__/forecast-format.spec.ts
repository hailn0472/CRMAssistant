import { formatVariance, accuracyBand, formatAxisTick } from '../forecast-format'

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
})
