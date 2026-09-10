import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { UsersWorkspace } from '../UsersWorkspace'
import { getUsers, getUserStats } from '@/services/user.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn(),
  getUserStats: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deactivateUsers: jest.fn(),
  reactivateUsers: jest.fn(),
}))

jest.mock('@/services/role.service', () => ({
  getRoles: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
}))

function renderWorkspace(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <UsersWorkspace />
    </QueryClientProvider>,
  )
}

describe('UsersWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getUsers as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    ;(getUserStats as jest.Mock).mockResolvedValue({
      total: 0,
      active: 0,
      deactivated: 0,
      admins: 0,
    })
  })

  it('renders the manage-roles link to the real settings/roles route', () => {
    renderWorkspace()

    expect(screen.getByRole('link', { name: 'Manage roles' })).toHaveAttribute(
      'href',
      '/settings/roles',
    )
  })

  it('opens the create-user drawer instead of navigating away', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create user' }))

    expect(await screen.findByRole('dialog', { name: 'New user' })).toBeInTheDocument()
  })

  it('closes the drawer from its close button', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Create user' }))
    await screen.findByRole('dialog', { name: 'New user' })

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
