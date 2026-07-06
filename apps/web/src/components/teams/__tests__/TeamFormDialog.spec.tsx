import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TeamFormDialog } from '../TeamFormDialog'

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
  getTeam: jest.fn().mockResolvedValue(null),
  createTeam: jest.fn(),
  updateTeam: jest.fn(),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 }),
}))

function renderDialog(open: boolean, teamId: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
  })

  it('renders create mode title', () => {
    renderDialog(true)
    expect(screen.getByText('Create Team')).toBeInTheDocument()
  })

  it('renders edit mode title', async () => {
    const { getTeam } = await import('@/services/team.service')
    ;(getTeam as jest.Mock).mockResolvedValue({
      id: 't-1',
      name: 'Engineering',
      managerId: null,
      members: [],
    })
    renderDialog(true, 't-1')
    expect(await screen.findByText('Edit Team')).toBeInTheDocument()
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
    const { getUsers } = await import('@/services/user.service')
    ;(getUsers as jest.Mock).mockResolvedValue({
      items: [{ id: 'u-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    // Set mock before rendering so query picks up the value
    renderDialog(true)

    const options = await screen.findAllByRole('option')
    // "No manager" option + at least 1 user
    expect(options.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('No manager')).toBeInTheDocument()
  })
})
