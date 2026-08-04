import { render, screen } from '@testing-library/react'
import { ForecastBands } from '../ForecastBands'

const mockBand = { weightedValue: 52500, totalValue: 80000, count: 2 }

const defaultProps = {
  commit: { weightedValue: 37500, totalValue: 50000, count: 1 },
  bestCase: mockBand,
  pipeline: mockBand,
  currency: 'USD',
}

describe('ForecastBands', () => {
  it('renders all three band cards with labels', () => {
    render(<ForecastBands {...defaultProps} />)

    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByText('Best case')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('renders weighted value for commit band', () => {
    render(<ForecastBands {...defaultProps} />)

    expect(screen.getByText('$37,500')).toBeInTheDocument()
  })

  it('shows deal count for each band', () => {
    render(<ForecastBands {...defaultProps} />)

    expect(screen.getAllByText('2')).toHaveLength(2)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders total value text', () => {
    render(<ForecastBands {...defaultProps} />)

    const totalValues = screen.getAllByText('$80,000')
    expect(totalValues).toHaveLength(2)
  })

  it('formats values with EUR currency', () => {
    render(<ForecastBands {...defaultProps} currency="EUR" />)

    expect(screen.getByText('€37,500')).toBeInTheDocument()
    expect(screen.getAllByText('€52,500')).toHaveLength(2)
  })
})
