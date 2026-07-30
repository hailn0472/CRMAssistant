import { render, screen } from '@testing-library/react'
import { ForecastBands } from '../ForecastBands'

const mockPipeline = {
  weightedValue: 52500,
  totalValue: 80000,
  count: 2,
}

const defaultProps = {
  commit: { weightedValue: 37500, totalValue: 50000, count: 1 },
  bestCase: mockPipeline,
  pipeline: mockPipeline,
  currency: 'USD',
}

describe('ForecastBands', () => {
  it('renders all three band cards with values', () => {
    render(<ForecastBands {...defaultProps} />)

    expect(screen.getByText(/commit/i)).toBeInTheDocument()
    expect(screen.getByText(/best case/i)).toBeInTheDocument()
    expect(screen.getByText(/pipeline/i)).toBeInTheDocument()

    expect(screen.getByText('$37,500')).toBeInTheDocument()
    expect(screen.getByText('$52,500')).toBeInTheDocument()
    expect(screen.getByText('$80,000')).toBeInTheDocument()
  })

  it('shows deal count for each band', () => {
    render(<ForecastBands {...defaultProps} />)

    const dealCounts = screen.getAllByText(/1 deal|2 deals/)
    expect(dealCounts).toHaveLength(3)
  })
})
