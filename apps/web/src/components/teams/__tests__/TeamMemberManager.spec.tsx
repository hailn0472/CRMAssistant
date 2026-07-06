import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TeamMemberManager } from '../TeamMemberManager'

jest.mock('@/services/team.service', () => ({
  getTeam: jest.fn(),
  setTeamMembers: jest.fn(),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn(),
}))

function renderManager(teamId = 't-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamMemberManager teamId={teamId} />
    </QueryClientProvider>,
  )
}

describe('TeamMemberManager', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { getTeam } = await import('@/services/team.service')
    const { getUsers } = await import('@/services/user.service')
    ;(getTeam as jest.Mock).mockResolvedValue({
      id: 't-1',
      name: 'Engineering',
      members: [{ id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' }],
    })
    ;(getUsers as jest.Mock).mockResolvedValue({
      items: [
        { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
        { id: 'u-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    })
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
    const { getTeam } = await import('@/services/team.service')
    ;(getTeam as jest.Mock).mockResolvedValue({
      id: 't-1',
      name: 'Engineering',
      members: [],
    })
    renderManager()
    expect(await screen.findByText('No members yet')).toBeInTheDocument()
  })

  it('shows empty state when all users are in team', async () => {
    const { getTeam } = await import('@/services/team.service')
    ;(getTeam as jest.Mock).mockResolvedValue({
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
})
