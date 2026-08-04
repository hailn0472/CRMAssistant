import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactFilterBar, emptyContactFilters } from '../ContactFilterBar'
import { getSavedSegments, createSegment } from '@/services/segment.service'
import { searchUsers } from '@/services/owner.service'

jest.mock('@/services/segment.service', () => ({
  getSavedSegments: jest.fn(),
  createSegment: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ContactFilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getSavedSegments as jest.Mock).mockResolvedValue([])
    ;(searchUsers as jest.Mock).mockResolvedValue([])
  })

  it('renders the search box and every filter trigger', () => {
    renderWithQueryClient(
      <ContactFilterBar filters={emptyContactFilters} onFiltersChange={jest.fn()} />,
    )

    expect(screen.getByPlaceholderText('Search name or email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Company/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Job title/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Owner/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Created/ })).toBeInTheDocument()
  })

  it('calls onFiltersChange when the search box changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <ContactFilterBar filters={emptyContactFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.type(screen.getByPlaceholderText('Search name or email'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyContactFilters, search: 'A' })
  })

  it('calls onFiltersChange when the company filter changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <ContactFilterBar filters={emptyContactFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /Company/ }))
    await user.type(await screen.findByPlaceholderText('Company name'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyContactFilters, company: 'A' })
  })

  it('shows the applied value on an active filter trigger', () => {
    renderWithQueryClient(
      <ContactFilterBar
        filters={{ ...emptyContactFilters, company: 'Acme' }}
        onFiltersChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Company: Acme/ })).toBeInTheDocument()
  })

  it('selects an owner from the owner filter', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([
      { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <ContactFilterBar filters={emptyContactFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /Owner/ }))
    await user.click(await screen.findByText('Ada Lovelace'))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyContactFilters,
      owner: { id: 'user-1', name: 'Ada Lovelace' },
    })
  })

  it('renders the trailing slot', () => {
    renderWithQueryClient(
      <ContactFilterBar
        filters={emptyContactFilters}
        onFiltersChange={jest.fn()}
        trailing={<span>237 contacts</span>}
      />,
    )

    expect(screen.getByText('237 contacts')).toBeInTheDocument()
  })

  it('does not render the save or clear actions when no filters are active', () => {
    renderWithQueryClient(
      <ContactFilterBar filters={emptyContactFilters} onFiltersChange={jest.fn()} />,
    )

    expect(screen.queryByText('Save as segment')).not.toBeInTheDocument()
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('clears every filter but keeps the search term', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <ContactFilterBar
        filters={{ ...emptyContactFilters, search: 'ada', company: 'Acme' }}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByText('Clear all'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyContactFilters, search: 'ada' })
  })

  it('renders selected tags as removable chips', () => {
    renderWithQueryClient(
      <ContactFilterBar
        filters={{ ...emptyContactFilters, tags: [{ id: 'tag-1', name: 'VIP', color: '#EF4444' }] }}
        onFiltersChange={jest.fn()}
      />,
    )

    expect(screen.getByText('VIP')).toBeInTheDocument()
  })

  it('opens the save dialog and calls createSegment', async () => {
    ;(createSegment as jest.Mock).mockResolvedValue({
      id: 'segment-1',
      name: 'My Segment',
      filters: '{}',
    })
    const user = userEvent.setup()
    renderWithQueryClient(
      <ContactFilterBar
        filters={{ ...emptyContactFilters, company: 'Acme' }}
        onFiltersChange={jest.fn()}
      />,
    )

    await user.click(screen.getByText('Save as segment'))
    await user.type(await screen.findByPlaceholderText('Segment name'), 'My Segment')
    await user.click(screen.getByText('Save'))

    expect(createSegment).toHaveBeenCalled()
  })
})
