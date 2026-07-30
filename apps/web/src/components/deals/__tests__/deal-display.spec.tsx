import { render, screen } from '@testing-library/react'
import { StageBadge, formatCurrency } from '../deal-display'

describe('deal-display', () => {
  describe('formatCurrency', () => {
    it('formats USD value with commas', () => {
      expect(formatCurrency(50000, 'USD')).toBe('$50,000')
    })

    it('formats EUR value with currency symbol', () => {
      expect(formatCurrency(100000, 'EUR')).toBe('€100,000')
    })

    it('handles zero value', () => {
      expect(formatCurrency(0, 'USD')).toBe('$0')
    })

    it('handles very large values', () => {
      expect(formatCurrency(9999999, 'USD')).toBe('$9,999,999')
    })
  })

  describe('StageBadge', () => {
    it('renders null when stage is null', () => {
      const { container } = render(<StageBadge stage={null} />)
      expect(container.innerHTML).toBe('')
    })

    it('renders null when stage is undefined', () => {
      const { container } = render(<StageBadge stage={undefined} />)
      expect(container.innerHTML).toBe('')
    })

    it('renders stage name and color dot', () => {
      render(<StageBadge stage={{ name: 'Qualified', color: '#3B82F6' }} />)
      expect(screen.getByText('Qualified')).toBeInTheDocument()
    })
  })
})
