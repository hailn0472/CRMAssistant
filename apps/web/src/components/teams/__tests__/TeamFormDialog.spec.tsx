import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TeamFormDialog } from '../TeamFormDialog'

const mockCreateTeam = jest.fn()
const mockUpdateTeam = jest.fn()
const mockGetTeam = jest.fn()
const mockGetUsers = jest.fn()

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
  getTeam: (...args: unknown[]) => mockGetTeam(...args),
  createTeam: (...args: unknown[]) => mockCreateTeam(...args),
  updateTeam: (...args: unknown[]) => mockUpdateTeam(...args),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: (...args: unknown[]) => mockGetUsers(...args),
}))

function renderDialog(open: boolean, teamId: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onOpenChange = jest.fn()
  const onClose = jest.fn()
  return {
    onOpenChange,
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TeamFormDialog open={open} onOpenChange={onOpenChange} teamId={teamId} onClose={onClose} />
      </QueryClientProvider>,
    ),
  }
}

describe('TeamFormDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateTeam.mockResolvedValue({ id: 'new-1', name: 'New', memberCount: 0 })
    mockUpdateTeam.mockResolvedValue({ id: 't-1', name: 'Updated', memberCount: 3 })
    mockGetTeam.mockResolvedValue(null)
    mockGetUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
  })

  it('renders create mode title', () => {
    renderDialog(true)
    expect(screen.getByText('Create Team')).toBeInTheDocument()
  })

  it('submits create team form', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'My Team')
    await user.click(screen.getByRole('button', { name: 'Create team' }))

    await screen.findByText('Create Team')
    expect(mockCreateTeam).toHaveBeenCalled()
    expect(mockCreateTeam.mock.calls[0][0]).toMatchObject({ name: 'My Team' })
  })

  it('renders edit mode and submits update', async () => {
    mockGetTeam.mockResolvedValue({
      id: 't-1',
      name: 'Engineering',
      managerId: null,
      members: [],
    })
    renderDialog(true, 't-1')
    const user = userEvent.setup()

    expect(await screen.findByText('Edit Team')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByText('Edit Team')
    expect(mockUpdateTeam).toHaveBeenCalled()
    // updated team with same name (no change)
    expect(mockUpdateTeam.mock.calls[0][0]).toBe('t-1')
  })

  it('validates name is required', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByText('Team name is required')).toBeInTheDocument()
  })

  it('renders manager dropdown with users', async () => {
    mockGetUsers.mockResolvedValue({
      items: [{ id: 'u-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    renderDialog(true)
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('No manager')).toBeInTheDocument()
  })
})
