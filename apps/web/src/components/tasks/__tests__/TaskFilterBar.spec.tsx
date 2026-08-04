import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskFilterBar, emptyTaskFilters } from '../TaskFilterBar'
import { searchUsers } from '@/services/owner.service'

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskFilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(searchUsers as jest.Mock).mockResolvedValue([])
  })

  it('renders the search box, filter triggers and the mine-only checkbox', () => {
    renderWithQueryClient(<TaskFilterBar filters={emptyTaskFilters} onFiltersChange={jest.fn()} />)

    expect(screen.getByPlaceholderText('Search tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All statuses/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All priorities/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assignee/ })).toBeInTheDocument()
    expect(screen.getByLabelText('My tasks only')).toBeInTheDocument()
  })

  it('calls onFiltersChange when the search box changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar filters={emptyTaskFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.type(screen.getByPlaceholderText('Search tasks'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyTaskFilters, search: 'A' })
  })

  it('selects a status from the status filter', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar filters={emptyTaskFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /All statuses/ }))
    await user.click(screen.getByText('In progress'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyTaskFilters, status: 'IN_PROGRESS' })
  })

  it('selects a priority from the priority filter', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar filters={emptyTaskFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /All priorities/ }))
    await user.click(screen.getByText('Urgent'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyTaskFilters, priority: 'URGENT' })
  })

  it('shows the applied value on an active filter trigger', () => {
    renderWithQueryClient(
      <TaskFilterBar
        filters={{ ...emptyTaskFilters, status: 'TODO' }}
        onFiltersChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /All statuses: To do/ })).toBeInTheDocument()
  })

  it('selects an assignee from the assignee filter', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([
      { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar filters={emptyTaskFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /Assignee/ }))
    await user.click(await screen.findByText('Ada Lovelace'))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyTaskFilters,
      assignee: { id: 'user-1', name: 'Ada Lovelace' },
    })
  })

  it('toggles mineOnly', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar filters={emptyTaskFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByLabelText('My tasks only'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyTaskFilters, mineOnly: true })
  })

  it('renders the trailing slot', () => {
    renderWithQueryClient(
      <TaskFilterBar
        filters={emptyTaskFilters}
        onFiltersChange={jest.fn()}
        trailing={<span>168 tasks</span>}
      />,
    )

    expect(screen.getByText('168 tasks')).toBeInTheDocument()
  })

  it('does not render the clear-all action when no filters are active', () => {
    renderWithQueryClient(<TaskFilterBar filters={emptyTaskFilters} onFiltersChange={jest.fn()} />)

    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('clears every filter but keeps the search term', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <TaskFilterBar
        filters={{ ...emptyTaskFilters, search: 'acme', status: 'TODO', mineOnly: true }}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByText('Clear all'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyTaskFilters, search: 'acme' })
  })
})
