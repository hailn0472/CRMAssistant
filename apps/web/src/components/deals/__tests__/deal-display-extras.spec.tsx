import { formatCurrency } from '@/components/deals/deal-display'

describe('deal-display formatCurrency edge cases', () => {
  it('formats zero', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0')
  })

  it('formats large numbers', () => {
    expect(formatCurrency(1000000, 'USD')).toBe('$1,000,000')
  })

  it('formats VND', () => {
    expect(formatCurrency(15000000, 'VND')).toBe('₫15,000,000')
  })
})
