import {
  roundMoney,
  computeLineItemTotal,
  sumLineItemTotals,
  formatDiscount,
} from '../line-item-format'

describe('line-item-format', () => {
  describe('roundMoney', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundMoney(56.661)).toBe(56.66)
      expect(roundMoney(1.005)).toBe(1)
      expect(roundMoney(0)).toBe(0)
    })
  })

  describe('computeLineItemTotal', () => {
    it('matches the API worked example: 3 * 250 * (1 - 10/100) = 675.00', () => {
      expect(computeLineItemTotal({ quantity: 3, unitPrice: 250, discount: 10 })).toBe(675.0)
    })

    it('with discount=0 returns quantity * unitPrice', () => {
      expect(computeLineItemTotal({ quantity: 1, unitPrice: 99.99, discount: 0 })).toBe(99.99)
    })

    it('with discount=100 returns 0', () => {
      expect(computeLineItemTotal({ quantity: 5, unitPrice: 100, discount: 100 })).toBe(0)
    })

    it('handles fractional quantity', () => {
      expect(computeLineItemTotal({ quantity: 2.5, unitPrice: 40, discount: 0 })).toBe(100.0)
    })

    it('matches API formula for 2 * 33.33 * (1 - 15/100) = 56.66', () => {
      expect(computeLineItemTotal({ quantity: 2, unitPrice: 33.33, discount: 15 })).toBe(56.66)
    })
  })

  describe('sumLineItemTotals', () => {
    it('returns 0 for empty array', () => {
      expect(sumLineItemTotals([])).toBe(0)
    })

    it('sums multiple items correctly', () => {
      const items = [{ total: 100 }, { total: 200.5 }, { total: 50.25 }]
      expect(sumLineItemTotals(items)).toBe(350.75)
    })
  })

  describe('formatDiscount', () => {
    it('renders as "10%"', () => {
      expect(formatDiscount(10)).toBe('10%')
    })

    it('renders "0%" for 0', () => {
      expect(formatDiscount(0)).toBe('0%')
    })

    it('renders "100%" for 100', () => {
      expect(formatDiscount(100)).toBe('100%')
    })
  })
})
