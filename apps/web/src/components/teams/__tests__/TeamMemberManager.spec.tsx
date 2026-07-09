import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TeamMemberManager } from '../TeamMemberManager'

const mockGetTeam = jest.fn()
const mockSetTeamMembers = jest.fn()
const mockGetUsers = jest.fn()

jest.mock('@/services/team.service', () => ({
  getTeam: (...args: unknown[]) => mockGetTeam(...args),
  setTeamMembers: (...args: unknown[]) => mockSetTeamMembers(...args),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: (...args: unknown[]) => mockGetUsers(...args),
}))

function renderManager(teamId = 't-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TeamMemberManager teamId={teamId} />
      </QueryClientProvider>,
    ),
  }
}

const BASE_MEMBERS = [
  { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
]
const BASE_USERS = [
  { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
  { id: 'u-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
]

describe('TeamMemberManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetTeam.mockResolvedValue({ id: 't-1', name: 'Engineering', members: BASE_MEMBERS })
    mockSetTeamMembers.mockResolvedValue({ id: 't-1', name: 'Engineering', members: [] })
    mockGetUsers.mockResolvedValue({ items: BASE_USERS, total: 2, page: 1, pageSize: 200 })
  })

  it('renders available users panel', async () => {
    renderManager()
    expect(await screen.findByText('Available Users')).toBeInTheDocument()
  })

  it('renders team members panel with member count', async () => {
    renderManager()
    expect(await screen.findByText(/Team Members/)).toBeInTheDocument()
    expect(await screen.findByText('Alice Smith')).toBeInTheDocument()
  })

  it('shows empty state when team has no members', async () => {
    mockGetTeam.mockResolvedValue({ id: 't-1', name: 'Engineering', members: [] })
    renderManager()
    expect(await screen.findByText('No members yet')).toBeInTheDocument()
  })

  it('shows empty state when all users are in team', async () => {
    mockGetTeam.mockResolvedValue({
      id: 't-1',
      name: 'Engineering',
      members: [
        { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
        { id: 'u-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
      ],
    })
    renderManager()
    expect(await screen.findByText('All users are in this team')).toBeInTheDocument()
  })

  it('adds selected users and saves', async () => {
    renderManager()
    const user = userEvent.setup()

    await screen.findByText('Available Users')

    // Select Bob in available list
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0]) // Bob

    // Click "Add selected" button
    const addBtn = await screen.findByRole('button', { name: /Add selected/ })
    await user.click(addBtn)

    await waitFor(() => {
      expect(mockSetTeamMembers).toHaveBeenCalled()
    })
  })

  it('removes a member and saves', async () => {
    renderManager()
    const user = userEvent.setup()

    await screen.findByText('Alice Smith')

    // Click Remove button
    const removeBtn = screen.getByRole('button', { name: 'Remove' })
    await user.click(removeBtn)

    await waitFor(() => {
      expect(mockSetTeamMembers).toHaveBeenCalled()
    })
  })

  it('filters available users by search', async () => {
    renderManager()
    const user = userEvent.setup()

    await screen.findByText('Available Users')
    const searchInput = screen.getByPlaceholderText('Search by name or email...')
    await user.type(searchInput, 'Bob')

    // Bob should still appear (filtered from available)
    expect(screen.queryByText(/Bob Jones/)).not.toBeNull()
  })
})
