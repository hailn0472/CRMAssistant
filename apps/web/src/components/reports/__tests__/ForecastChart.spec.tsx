import { render, screen } from '@testing-library/react'

import { ForecastChart } from '../ForecastChart'
import { formatCurrency } from '@/components/deals/deal-display'
import type { ForecastBucket, ForecastGroupBy } from '@/services/forecast.service'

// Mock recharts ResponsiveContainer — jsdom cannot render SVG
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}))

const CURRENCY = 'EUR'
const GROUP_BY: ForecastGroupBy = 'MONTH'

const mockBuckets: ForecastBucket[] = [
  {
    key: '2026-08',
    label: 'Aug 2026',
    periodStart: null,
    periodEnd: null,
    weightedValue: 50000,
    totalValue: 100000,
    count: 3,
  },
  {
    key: '2026-09',
    label: 'Sep 2026',
    periodStart: null,
    periodEnd: null,
    weightedValue: 75000,
    totalValue: 120000,
    count: 4,
  },
]

describe('ForecastChart', () => {
  it('renders card title', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy={GROUP_BY} currency={CURRENCY} />)

    expect(screen.getByText('Forecast Trend')).toBeInTheDocument()
  })

  it('renders aria-label on the chart region', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy={GROUP_BY} currency={CURRENCY} />)

    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Weighted sales forecast by month',
    )
  })

  it('renders sr-only table with bucket data', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy={GROUP_BY} currency={CURRENCY} />)

    // The sr-only table has an aria-label matching the chart
    const srTable = screen.getByRole('table', { hidden: true })
    expect(srTable).toHaveClass('sr-only')
    expect(srTable).toHaveAttribute('aria-label', 'Weighted sales forecast by month')

    // Check bucket labels appear
    expect(screen.getByText('Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('Sep 2026')).toBeInTheDocument()

    // Check formatted values
    expect(screen.getByText(formatCurrency(50000, CURRENCY))).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(75000, CURRENCY))).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(100000, CURRENCY))).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(120000, CURRENCY))).toBeInTheDocument()

    // Check deal counts
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders with empty buckets', () => {
    render(<ForecastChart buckets={[]} groupBy={GROUP_BY} currency={CURRENCY} />)

    expect(screen.getByText('Forecast Trend')).toBeInTheDocument()
    // sr-only table body should be empty
    expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(1) // only header row
  })

  it('uses correct aria-label for QUARTER groupBy', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy="QUARTER" currency={CURRENCY} />)

    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Weighted sales forecast by quarter',
    )
  })

  it('uses correct aria-label for OWNER groupBy', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy="OWNER" currency={CURRENCY} />)

    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Weighted sales forecast by owner',
    )
  })

  it('uses correct aria-label for TEAM groupBy', () => {
    render(<ForecastChart buckets={mockBuckets} groupBy="TEAM" currency={CURRENCY} />)

    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Weighted sales forecast by team')
  })
})
