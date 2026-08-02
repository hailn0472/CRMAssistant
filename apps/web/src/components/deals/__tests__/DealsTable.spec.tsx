import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'

import { DealsTable } from '../DealsTable'
import { getDeals } from '@/services/deal.service'

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn(),
}))

// Mock ResizeObserver for ResponsiveTableWrapper
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealsTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders empty state when no deals exist', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })

    renderWithQueryClient(<DealsTable />)

    expect(await screen.findByText('No deals yet')).toBeInTheDocument()
  })

  it('renders deals in a table', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'deal-1',
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Qualified', color: '#10B981' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
    })

    renderWithQueryClient(<DealsTable />)

    expect(await screen.findByText('Big Deal')).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
  })

  it('renders scrollable table region', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'deal-1',
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Qualified', color: '#10B981' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
    })

    renderWithQueryClient(<DealsTable />)

    await screen.findByText('Big Deal')

    expect(screen.getByRole('region', { name: 'Scrollable table' })).toBeInTheDocument()
  })

  it('renders error state with retry button when loading fails', async () => {
    ;(getDeals as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<DealsTable />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('clicking retry button refetches deals', async () => {
    ;(getDeals as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<DealsTable />)

    const retryButton = await screen.findByRole('button', { name: /try again/i })

    // Change mock to resolve before clicking retry
    ;(getDeals as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'deal-1',
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Qualified', color: '#10B981' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
    })

    fireEvent.click(retryButton)

    expect(await screen.findByText('Big Deal')).toBeInTheDocument()
  })

  it('renders pagination when deals exceed page size', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `deal-${i + 1}`,
      title: `Deal ${i + 1}`,
      value: 10000 * (i + 1),
      currency: 'USD',
      probability: 10,
      stageId: 'stage-1',
      contactId: 'contact-1',
      ownerId: 'user-1',
      stage: { id: 'stage-1', name: 'Lead', color: '#3B82F6' },
      contact: {
        id: 'contact-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      },
      owner: { id: 'user-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
      expectedCloseDate: null,
      actualCloseDate: null,
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
    }))
    ;(getDeals as jest.Mock).mockResolvedValue({
      total: 25,
      page: 1,
      pageSize: 10,
      items,
    })

    renderWithQueryClient(<DealsTable />)

    // Wait for pagination to appear: page 1 button is active (highlighted)
    const page1Btn = await screen.findByRole('button', { name: '1' })
    expect(page1Btn).toHaveClass('bg-slate-900')
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument()
  })

  it('navigates to next page', async () => {
    ;(getDeals as jest.Mock)
      .mockResolvedValueOnce({
        total: 25,
        page: 1,
        pageSize: 10,
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `deal-${i + 1}`,
          title: `Deal ${i + 1}`,
          value: 10000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Lead', color: '#3B82F6' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        })),
      })
      .mockResolvedValueOnce({
        total: 25,
        page: 2,
        pageSize: 10,
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `deal-${i + 11}`,
          title: `Deal ${i + 11}`,
          value: 10000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Lead', color: '#3B82F6' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        })),
      })

    renderWithQueryClient(<DealsTable />)

    // Wait for page 1 button to appear (pagination rendered)
    const page1Btn = await screen.findByRole('button', { name: '1' })
    expect(page1Btn).toHaveClass('bg-slate-900')

    // Click page 2
    fireEvent.click(screen.getByRole('button', { name: '2' }))

    // Page 2 should now be active
    const page2Btn = await screen.findByRole('button', { name: '2' })
    expect(page2Btn).toHaveClass('bg-slate-900')
  })

  it('renders stage badge with name', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'deal-1',
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          stage: { id: 'stage-1', name: 'Closed Won', color: '#10B981' },
          contact: {
            id: 'contact-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
          },
          owner: {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
          },
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
    })

    renderWithQueryClient(<DealsTable />)

    expect(await screen.findByText('Closed Won')).toBeInTheDocument()
  })
})
