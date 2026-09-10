import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'

import { UsersTable } from '../UsersTable'
import { getUsers, deactivateUsers } from '@/services/user.service'

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn(),
  deactivateUsers: jest.fn(),
  reactivateUsers: jest.fn(),
}))

jest.mock('@/services/role.service', () => ({
  getRoles: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/users',
}))

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('UsersTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders empty state when no users exist', async () => {
    ;(getUsers as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })

    renderWithQueryClient(<UsersTable />)

    expect(await screen.findByText('No users yet')).toBeInTheDocument()
  })

  it('renders users in a table', async () => {
    ;(getUsers as jest.Mock).mockResolvedValue({
      total: 2,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          roles: [{ id: 'role-1', name: 'ADMIN' }],
          isActive: true,
          jobTitle: 'Engineer',
          department: 'Engineering',
          lastLoginAt: '2026-06-28T00:00:00.000Z',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          avatar: null,
          phone: null,
          tenantId: 'tenant-1',
        },
        {
          id: 'user-2',
          email: 'bob@example.com',
          firstName: 'Bob',
          lastName: 'Smith',
          roles: [{ id: 'role-2', name: 'SALES_REP' }],
          isActive: false,
          lastLoginAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          avatar: null,
          phone: null,
          jobTitle: null,
          department: null,
          tenantId: 'tenant-1',
        },
      ],
    })

    renderWithQueryClient(<UsersTable />)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('SALES REP')).toBeInTheDocument()
    expect(screen.getByText('Deactivated')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
  })

  it('renders error state with retry button when loading fails', async () => {
    ;(getUsers as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<UsersTable />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('clicking retry button refetches users', async () => {
    ;(getUsers as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<UsersTable />)

    const retryButton = await screen.findByRole('button', { name: /try again/i })
    ;(getUsers as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          roles: [{ id: 'role-1', name: 'ADMIN' }],
          isActive: true,
          lastLoginAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          avatar: null,
          phone: null,
          jobTitle: null,
          department: null,
          tenantId: 'tenant-1',
        },
      ],
    })

    fireEvent.click(retryButton)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('renders loading skeleton initially', () => {
    ;(getUsers as jest.Mock).mockReturnValue(new Promise(() => {}))

    renderWithQueryClient(<UsersTable />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('keeps the filter bar reachable when a filter matches nothing', async () => {
    ;(getUsers as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          roles: [{ id: 'role-1', name: 'ADMIN' }],
          isActive: true,
          lastLoginAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          avatar: null,
          phone: null,
          jobTitle: null,
          department: null,
          tenantId: 'tenant-1',
        },
      ],
    })
    renderWithQueryClient(<UsersTable />)

    const searchBox = await screen.findByLabelText('Search users')
    ;(getUsers as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    fireEvent.change(searchBox, { target: { value: 'nowhere' } })

    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Search users')).toBeInTheDocument()
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument()
  })

  it('renders pagination with correct page info', async () => {
    ;(getUsers as jest.Mock).mockResolvedValue({
      total: 25,
      page: 1,
      pageSize: 10,
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i + 1}`,
        email: `user${i + 1}@example.com`,
        firstName: 'First',
        lastName: `Last${i + 1}`,
        roles: [{ id: 'role-2', name: 'SALES_REP' }],
        isActive: true,
        lastLoginAt: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        avatar: null,
        phone: null,
        jobTitle: null,
        department: null,
        tenantId: 'tenant-1',
      })),
    })

    renderWithQueryClient(<UsersTable />)

    await screen.findByText('First Last1')

    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
    expect(screen.getAllByText(/25 users/).length).toBeGreaterThan(0)
  })

  it('calls deactivateUsers on bulk deactivate', async () => {
    ;(getUsers as jest.Mock).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          roles: [{ id: 'role-1', name: 'ADMIN' }],
          isActive: true,
          lastLoginAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          avatar: null,
          phone: null,
          jobTitle: null,
          department: null,
          tenantId: 'tenant-1',
        },
      ],
    })
    ;(deactivateUsers as jest.Mock).mockResolvedValue(1)

    renderWithQueryClient(<UsersTable />)

    const checkbox = await screen.findByLabelText('Select Ada Lovelace')
    fireEvent.click(checkbox)

    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))

    expect(deactivateUsers).toHaveBeenCalledWith(['user-1'])
    await screen.findByText('Ada Lovelace')
  })
})
