import { render, screen } from '@testing-library/react'
import { ForecastAccuracyTable } from '../ForecastAccuracyTable'

const mockPeriods = [
  { periodStart: '2026-06-01', periodEnd: '2026-06-30', forecastValue: 50000, actualValue: 45000, variance: -5000, accuracyPct: 90 },
  { periodStart: '2026-05-01', periodEnd: '2026-05-31', forecastValue: null, actualValue: 30000, variance: null, accuracyPct: null },
]

describe('ForecastAccuracyTable', () => {
  it('renders periods with accuracy data', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    expect(screen.getByText('Jun 2026')).toBeInTheDocument()
    expect(screen.getByText('May 2026')).toBeInTheDocument()
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('$45,000')).toBeInTheDocument()
  })

  it('shows dash for null forecast values', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    const dashElements = screen.getAllByText('—')
    expect(dashElements.length).toBeGreaterThanOrEqual(1)
  })

  it('renders empty state when no periods', () => {
    render(<ForecastAccuracyTable periods={[]} currency="USD" />)

    expect(screen.getByText(/no forecast accuracy/i)).toBeInTheDocument()
  })
})
