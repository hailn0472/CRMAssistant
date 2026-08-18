import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CustomReportDrillDownSheet } from '../CustomReportDrillDownSheet'
import { customReportDrillDown } from '@/services/custom-report.service'

jest.mock('@/services/custom-report.service', () => ({
  customReportDrillDown: jest.fn(),
}))

const mockDrill = customReportDrillDown as jest.Mock

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CustomReportDrillDownSheet (AC 15, Contract E.29)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders loading state initially and then lists items with links', async () => {
    mockDrill.mockResolvedValue({
      source: 'DEALS',
      pointLabel: 'January 2026',
      items: [
        {
          id: 'deal-123',
          primaryLabel: 'Acme Enterprise Deal',
          secondaryLabel: 'Negotiation',
          relatedRecordId: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })

    renderWithClient(
      <CustomReportDrillDownSheet
        open={true}
        onOpenChange={jest.fn()}
        reportId="rep-1"
        pointKey="2026-01"
        metricId="m1"
        pointLabel="January 2026"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Acme Enterprise Deal')).toBeInTheDocument()
      expect(screen.getByText('Negotiation')).toBeInTheDocument()
    })

    const viewLink = screen.getByRole('link', { name: /view/i })
    expect(viewLink).toHaveAttribute('href', '/deals/deal-123')
  })

  it('renders empty state when items list is empty', async () => {
    mockDrill.mockResolvedValue({
      source: 'DEALS',
      pointLabel: 'Empty Month',
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    })

    renderWithClient(
      <CustomReportDrillDownSheet
        open={true}
        onOpenChange={jest.fn()}
        reportId="rep-1"
        pointKey="empty"
        metricId="m1"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('No records found')).toBeInTheDocument()
    })
  })

  it('renders error state on API failure', async () => {
    mockDrill.mockRejectedValue(new Error('Permission denied for DEALS'))

    renderWithClient(
      <CustomReportDrillDownSheet
        open={true}
        onOpenChange={jest.fn()}
        reportId="rep-1"
        pointKey="err"
        metricId="m1"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Permission denied for DEALS')).toBeInTheDocument()
    })
  })
})
