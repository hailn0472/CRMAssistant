import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DealFilterBar, emptyDealFilters } from '../DealFilterBar'
import { getDealStages } from '@/services/deal.service'
import { searchUsers } from '@/services/owner.service'

jest.mock('@/services/deal.service', () => ({
  getDealStages: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealFilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDealStages as jest.Mock).mockResolvedValue([])
    ;(searchUsers as jest.Mock).mockResolvedValue([])
  })

  it('renders the search box and every filter trigger', () => {
    renderWithQueryClient(<DealFilterBar filters={emptyDealFilters} onFiltersChange={jest.fn()} />)

    expect(screen.getByPlaceholderText('Search deals')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Stage/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Owner/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Close date/ })).toBeInTheDocument()
  })

  it('calls onFiltersChange when the search box changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar filters={emptyDealFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.type(screen.getByPlaceholderText('Search deals'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyDealFilters, search: 'A' })
  })

  it('selects a stage from the stage filter', async () => {
    ;(getDealStages as jest.Mock).mockResolvedValue([
      {
        id: 'stage-1',
        name: 'Qualified',
        order: 0,
        probability: 30,
        isWon: false,
        isLost: false,
        color: '#10B981',
      },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar filters={emptyDealFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Stage/ }))
    await user.click(await screen.findByRole('button', { name: 'Qualified' }))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyDealFilters,
      stage: { id: 'stage-1', name: 'Qualified' },
    })
  })

  it('shows the applied value on the stage trigger and can clear it', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar
        filters={{ ...emptyDealFilters, stage: { id: 'stage-1', name: 'Qualified' } }}
        onFiltersChange={onFiltersChange}
      />,
    )

    expect(screen.getByRole('button', { name: 'Stage: Qualified ▾' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stage: Qualified ▾' }))
    await user.click(screen.getByText('Clear stage'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyDealFilters, stage: null })
  })

  it('selects an owner from the owner filter', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([
      { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar filters={emptyDealFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Owner/ }))
    await user.click(await screen.findByText('Ada Lovelace'))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyDealFilters,
      owner: { id: 'user-1', name: 'Ada Lovelace' },
    })
  })

  it('sets a close-date range from the close date filter', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar filters={emptyDealFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Close date/ }))
    const fromInput = await screen.findByLabelText('From')
    await user.type(fromInput, '2026-08-01')

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyDealFilters,
      closeDateFrom: '2026-08-01',
    })
  })

  it('renders the trailing slot', () => {
    renderWithQueryClient(
      <DealFilterBar
        filters={emptyDealFilters}
        onFiltersChange={jest.fn()}
        trailing={<span>42 deals</span>}
      />,
    )

    expect(screen.getByText('42 deals')).toBeInTheDocument()
  })

  it('does not render the clear-all action when no filters are active', () => {
    renderWithQueryClient(<DealFilterBar filters={emptyDealFilters} onFiltersChange={jest.fn()} />)

    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('clears every filter but keeps the search term', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <DealFilterBar
        filters={{
          ...emptyDealFilters,
          search: 'acme',
          stage: { id: 'stage-1', name: 'Qualified' },
        }}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByText('Clear all'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyDealFilters, search: 'acme' })
  })
})
