import { BadRequestException } from '@nestjs/common'
import {
  roundMoney,
  computeLineItemTotal,
  sumLineItemTotals,
  assertLineItemNumbers,
} from '../line-item-math'

describe('line-item-math', () => {
  describe('roundMoney', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundMoney(56.661)).toBe(56.66)
      expect(roundMoney(1.005)).toBe(1)
      expect(roundMoney(0)).toBe(0)
    })

    it('handles bankers rounding edge values', () => {
      expect(roundMoney(1.005)).toBe(1)
      expect(roundMoney(1.004)).toBe(1.0)
    })
  })

  describe('computeLineItemTotal', () => {
    it('matches the worked example: 3 * 250 * (1 - 10/100) = 675.00', () => {
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

    it('handles 2 * 33.33 * (1 - 15/100) = round2(56.661) = 56.66', () => {
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

  describe('assertLineItemNumbers', () => {
    it('throws BadRequestException when quantity <= 0', () => {
      expect(() => assertLineItemNumbers({ quantity: 0, unitPrice: 100, discount: 0 })).toThrow(
        BadRequestException,
      )
      expect(() => assertLineItemNumbers({ quantity: -1, unitPrice: 100, discount: 0 })).toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException for quantity > 1_000_000', () => {
      expect(() =>
        assertLineItemNumbers({ quantity: 1_000_001, unitPrice: 100, discount: 0 }),
      ).toThrow(BadRequestException)
    })

    it('throws BadRequestException when unitPrice < 0', () => {
      expect(() => assertLineItemNumbers({ quantity: 1, unitPrice: -1, discount: 0 })).toThrow(
        BadRequestException,
      )
    })

    it('allows unitPrice = 0', () => {
      expect(() => assertLineItemNumbers({ quantity: 1, unitPrice: 0, discount: 0 })).not.toThrow()
    })

    it('throws BadRequestException when discount < 0', () => {
      expect(() => assertLineItemNumbers({ quantity: 1, unitPrice: 100, discount: -1 })).toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException when discount > 100', () => {
      expect(() => assertLineItemNumbers({ quantity: 1, unitPrice: 100, discount: 101 })).toThrow(
        BadRequestException,
      )
    })

    it('rejects NaN / Infinity / -Infinity', () => {
      expect(() => assertLineItemNumbers({ quantity: NaN, unitPrice: 100, discount: 0 })).toThrow(
        BadRequestException,
      )
      expect(() =>
        assertLineItemNumbers({ quantity: 1, unitPrice: Infinity, discount: 0 }),
      ).toThrow(BadRequestException)
      expect(() =>
        assertLineItemNumbers({ quantity: 1, unitPrice: 100, discount: -Infinity }),
      ).toThrow(BadRequestException)
    })

    it('passes valid values silently', () => {
      expect(() =>
        assertLineItemNumbers({ quantity: 5, unitPrice: 100, discount: 15 }),
      ).not.toThrow()
    })
  })
})
