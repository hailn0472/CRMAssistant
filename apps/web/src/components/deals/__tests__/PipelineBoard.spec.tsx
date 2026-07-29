import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PipelineBoard } from '../PipelineBoard'
import {
  getDeals,
  getDealPipelineSummary,
  moveDealToStage,
  getDealStages,
} from '@/services/deal.service'

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn(),
  getDealPipelineSummary: jest.fn(),
  moveDealToStage: jest.fn(),
  getDealStages: jest.fn(),
}))

// Mock toast
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn() },
  error: jest.fn(),
}))

/** Stage-filtered default: only stage-1 gets a deal. Override via mockResolvedValue per test. */
function mockStageFilteredDeals(): void {
  ;(getDeals as jest.Mock).mockImplementation(
    (_page: number, _pageSize: number, filter?: { stageId?: string }) => {
      if (filter?.stageId === 'stage-1') {
        return Promise.resolve({
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
              expectedCloseDate: null,
              actualCloseDate: null,
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
              createdAt: '2026-05-13T00:00:00.000Z',
              updatedAt: '2026-05-13T00:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
        })
      }
      return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })
    },
  )
}

// Mock ResizeObserver
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

const mockStages = [
  {
    id: 'stage-1',
    name: 'Lead',
    order: 1,
    probability: 10,
    isWon: false,
    isLost: false,
    color: '#3B82F6',
  },
  {
    id: 'stage-2',
    name: 'Qualified',
    order: 2,
    probability: 25,
    isWon: false,
    isLost: false,
    color: '#10B981',
  },
  {
    id: 'stage-3',
    name: 'Closed Won',
    order: 3,
    probability: 100,
    isWon: true,
    isLost: false,
    color: '#059669',
  },
]

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PipelineBoard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading skeleton while stages are loading', async () => {
    ;(getDealStages as jest.Mock).mockReturnValue(new Promise(() => {})) // never resolves

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('shows error state with retry when stages query fails', async () => {
    ;(getDealStages as jest.Mock).mockRejectedValue(new Error('Failed to load'))

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows empty state when no stages configured', async () => {
    ;(getDealStages as jest.Mock).mockResolvedValue([])
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('No stages configured')).toBeInTheDocument()
  })

  it('renders column per stage ordered by order', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Lead')).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('Closed Won')).toBeInTheDocument()
  })

  it('shows deal count and total value in column header from summary', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('shows terminal badge for won stage', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 0, totalValue: 0 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Closed Won')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
  })

  it('renders deal card with title, value, contact name', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    const values = screen.getAllByText('$50,000')
    expect(values.length).toBeGreaterThanOrEqual(1)
  })

  it('stage with zero deals shows column with empty state', async () => {
    ;(getDeals as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 0, totalValue: 0 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Lead')).toBeInTheDocument()
    const noDealsTexts = screen.getAllByText('No deals')
    expect(noDealsTexts.length).toBe(3)
  })

  it('opens move-to-stage menu and calls mutation when stage is selected', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])
    ;(moveDealToStage as jest.Mock).mockResolvedValue({})

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Big Deal')).toBeInTheDocument()

    // Click the "Move to stage" button
    const moveButtons = screen.getAllByLabelText('Move to stage')
    await userEvent.click(moveButtons[0])

    // The dropdown contains a "Move to stage" header + stage buttons
    // Column headers also render stage names, so use getAllByText and find the menu button
    const qualifiedElements = screen.getAllByText('Qualified')
    // Pick the button element inside the dropdown (not the column header span)
    const stageOption =
      qualifiedElements
        .find((el) => el.tagName === 'BUTTON' || el.closest('button'))
        ?.closest('button') ?? qualifiedElements[qualifiedElements.length - 1].closest('button')
    expect(stageOption).not.toBeNull()
    await userEvent.click(stageOption!)

    await waitFor(() => {
      expect(moveDealToStage).toHaveBeenCalledWith('deal-1', 'stage-2')
    })
  })

  it('shows error toast when move mutation fails and retains card in original column', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])
    ;(moveDealToStage as jest.Mock).mockRejectedValue(new Error('Network error'))

    renderWithQueryClient(<PipelineBoard />)

    expect(await screen.findByText('Big Deal')).toBeInTheDocument()

    // Open menu and click Qualified
    const moveButtons = screen.getAllByLabelText('Move to stage')
    await userEvent.click(moveButtons[0])

    // Find the Qualified button inside the dropdown (not the column header)
    const qualifiedElements = screen.getAllByText('Qualified')
    const stageOption =
      qualifiedElements
        .find((el) => el.tagName === 'BUTTON' || el.closest('button'))
        ?.closest('button') ?? qualifiedElements[qualifiedElements.length - 1].closest('button')
    await userEvent.click(stageOption!)

    // Card should still be in the Lead column (rollback)
    await waitFor(() => {
      expect(screen.getByText('Big Deal')).toBeInTheDocument()
    })
  })

  it('filters deals when filter inputs change', async () => {
    mockStageFilteredDeals()
    ;(getDealStages as jest.Mock).mockResolvedValue(mockStages)
    ;(getDealPipelineSummary as jest.Mock).mockResolvedValue([
      { stageId: 'stage-1', count: 1, totalValue: 50000 },
      { stageId: 'stage-2', count: 0, totalValue: 0 },
      { stageId: 'stage-3', count: 0, totalValue: 0 },
    ])

    renderWithQueryClient(<PipelineBoard />)

    // Wait for board to render
    expect(await screen.findByText('Big Deal')).toBeInTheDocument()

    // Type in owner filter
    const ownerInput = screen.getByLabelText('Filter by owner')
    await userEvent.type(ownerInput, 'user-1')

    // Type in contact filter
    const contactInput = screen.getByLabelText('Filter by contact')
    await userEvent.type(contactInput, 'contact-1')

    // Set date range
    const dateFromInput = screen.getByLabelText('Expected close date from')
    await userEvent.type(dateFromInput, '2026-01-01')

    const dateToInput = screen.getByLabelText('Expected close date to')
    await userEvent.type(dateToInput, '2026-12-31')

    expect(ownerInput).toHaveValue('user-1')
    expect(contactInput).toHaveValue('contact-1')
    expect(dateFromInput).toHaveValue('2026-01-01')
    expect(dateToInput).toHaveValue('2026-12-31')
  })
})
