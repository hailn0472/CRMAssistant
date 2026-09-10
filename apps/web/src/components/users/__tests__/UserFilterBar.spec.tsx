import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { UserFilterBar, emptyUserFilters } from '../UserFilterBar'
import { getRoles } from '@/services/role.service'
import { getTeams } from '@/services/team.service'

jest.mock('@/services/role.service', () => ({
  getRoles: jest.fn(),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('UserFilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRoles as jest.Mock).mockResolvedValue([])
    ;(getTeams as jest.Mock).mockResolvedValue([])
  })

  it('renders the search box and every filter trigger', () => {
    renderWithQueryClient(<UserFilterBar filters={emptyUserFilters} onFiltersChange={jest.fn()} />)

    expect(screen.getByPlaceholderText('Search users')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Role/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Status/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Team/ })).toBeInTheDocument()
  })

  it('calls onFiltersChange when the search box changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <UserFilterBar filters={emptyUserFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.type(screen.getByPlaceholderText('Search users'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyUserFilters, search: 'A' })
  })

  it('selects a role from the role filter', async () => {
    ;(getRoles as jest.Mock).mockResolvedValue([
      {
        id: 'role-1',
        name: 'Admin',
        description: null,
        isSystem: true,
        userCount: 1,
        createdAt: '',
        updatedAt: '',
      },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <UserFilterBar filters={emptyUserFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Role/ }))
    await user.click(await screen.findByRole('button', { name: 'Admin' }))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyUserFilters,
      role: { id: 'role-1', name: 'Admin' },
    })
  })

  it('selects a status from the status filter', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <UserFilterBar filters={emptyUserFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Status/ }))
    await user.click(screen.getByText('Deactivated'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyUserFilters, status: 'deactivated' })
  })

  it('selects a team from the team filter', async () => {
    ;(getTeams as jest.Mock).mockResolvedValue([
      { id: 'team-1', name: 'Sales EMEA', memberCount: 3, createdAt: '' },
    ])
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <UserFilterBar filters={emptyUserFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Team/ }))
    await user.click(await screen.findByText('Sales EMEA'))

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyUserFilters,
      team: { id: 'team-1', name: 'Sales EMEA' },
    })
  })

  it('shows the applied value on an active filter trigger', () => {
    renderWithQueryClient(
      <UserFilterBar
        filters={{ ...emptyUserFilters, status: 'active' }}
        onFiltersChange={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Status: Active/ })).toBeInTheDocument()
  })

  it('renders the trailing slot', () => {
    renderWithQueryClient(
      <UserFilterBar
        filters={emptyUserFilters}
        onFiltersChange={jest.fn()}
        trailing={<span>6 users</span>}
      />,
    )

    expect(screen.getByText('6 users')).toBeInTheDocument()
  })

  it('does not render the clear-all action when no filters are active', () => {
    renderWithQueryClient(<UserFilterBar filters={emptyUserFilters} onFiltersChange={jest.fn()} />)

    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('clears every filter but keeps the search term', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <UserFilterBar
        filters={{ ...emptyUserFilters, search: 'ada', status: 'active' }}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByText('Clear all'))

    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyUserFilters, search: 'ada' })
  })
})
