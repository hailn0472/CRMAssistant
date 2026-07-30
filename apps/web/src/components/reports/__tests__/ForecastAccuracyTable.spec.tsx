import { render, screen } from '@testing-library/react'
import { ForecastAccuracyTable } from '../ForecastAccuracyTable'

const mockPeriods = [
  { periodStart: '2026-06-01', periodEnd: '2026-06-30', forecastValue: 50000, actualValue: 45000, variance: -5000, accuracyPct: 90 },
  { periodStart: '2026-05-01', periodEnd: '2026-05-31', forecastValue: null, actualValue: 30000, variance: null, accuracyPct: null },
]

describe('ForecastAccuracyTable', () => {
  it('renders period labels (YYYY-MM format)', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    expect(screen.getByText('2026-06')).toBeInTheDocument()
    expect(screen.getByText('2026-05')).toBeInTheDocument()
  })

  it('renders forecast and actual values', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('$45,000')).toBeInTheDocument()
  })

  it('shows dash for null forecast values', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    const dashElements = screen.getAllByText('—')
    expect(dashElements.length).toBeGreaterThanOrEqual(1)
  })

  it('renders accuracy percentage', () => {
    render(<ForecastAccuracyTable periods={mockPeriods} currency="USD" />)

    expect(screen.getByText('90%')).toBeInTheDocument()
  })

  it('renders with different accuracy bands', () => {
    const periods = [
      { periodStart: '2026-06-01', periodEnd: '2026-06-30', forecastValue: 50000, actualValue: 49000, variance: -1000, accuracyPct: 98 },
      { periodStart: '2026-05-01', periodEnd: '2026-05-31', forecastValue: 30000, actualValue: 24000, variance: -6000, accuracyPct: 80 },
      { periodStart: '2026-04-01', periodEnd: '2026-04-30', forecastValue: 20000, actualValue: 10000, variance: -10000, accuracyPct: 50 },
    ]
    render(<ForecastAccuracyTable periods={periods} currency="USD" />)

    expect(screen.getAllByText('98%')).toHaveLength(1)
    expect(screen.getAllByText('80%')).toHaveLength(1)
    expect(screen.getAllByText('50%')).toHaveLength(1)
  })

  it('renders empty state when no periods', () => {
    render(<ForecastAccuracyTable periods={[]} currency="USD" />)

    expect(screen.getByText(/No completed periods to show/i)).toBeInTheDocument()
  })

  it('renders all status bands for accuracy', () => {
    const allBands = [
      { periodStart: '2026-06-01', periodEnd: '2026-06-30', forecastValue: 50000, actualValue: 50000, variance: 0, accuracyPct: 100 },
      { periodStart: '2026-05-01', periodEnd: '2026-05-31', forecastValue: 20000, actualValue: 10000, variance: -10000, accuracyPct: 50 },
      { periodStart: '2026-04-01', periodEnd: '2026-04-30', forecastValue: 10000, actualValue: 1000, variance: -9000, accuracyPct: 10 },
    ]
    render(<ForecastAccuracyTable periods={allBands} currency="USD" />)

    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('50%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('10%').length).toBeGreaterThanOrEqual(1)
  })
})
