import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ShareDashboardDialog } from '../ShareDashboardDialog'

const mockShareDashboard = jest.fn()
const mockUnshareDashboard = jest.fn()
const mockFetchDashboardShares = jest.fn()

jest.mock('@/services/dashboard.service', () => ({
  ...jest.requireActual('@/services/dashboard.service'),
  shareDashboard: (...args: unknown[]) => mockShareDashboard(...args),
  unshareDashboard: (...args: unknown[]) => mockUnshareDashboard(...args),
  fetchDashboardShares: (...args: unknown[]) => mockFetchDashboardShares(...args),
  fetchDashboard: jest.fn(),
}))

const mockGetUsers = jest.fn()
jest.mock('@/services/user.service', () => ({
  getUsers: (...args: unknown[]) => mockGetUsers(...args),
}))

const mockGetTeams = jest.fn()
jest.mock('@/services/team.service', () => ({
  getTeams: (...args: unknown[]) => mockGetTeams(...args),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}))
const mockToastSuccess = toast.success as jest.Mock
const mockToastError = toast.error as jest.Mock

const mockQueryClient = {
  getQueryData: jest.fn(),
  setQueryData: jest.fn(),
  cancelQueries: jest.fn(),
  invalidateQueries: jest.fn(),
}

const mockMutationConfigs: Array<Record<string, unknown>> = []
const mockUseQueryCalls: Array<{ queryKey: unknown[]; queryFn?: () => unknown }> = []

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query') as Record<string, unknown>
  return {
    ...actual,
    useQuery: jest.fn(
      (opts: { queryKey: unknown[]; queryFn?: () => unknown; enabled?: boolean }) => {
        mockUseQueryCalls.push(opts)
        if (opts.enabled === false) {
          return { data: undefined, isLoading: false, isError: false }
        }
        const key0 = opts.queryKey?.[0]
        if (key0 === 'users') {
          return {
            data: [
              { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
              { id: 'u-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
            ],
            isLoading: false,
            isError: false,
          }
        }
        if (key0 === 'teams') {
          return {
            data: [{ id: 't-1', name: 'Sales Team' }],
            isLoading: false,
            isError: false,
          }
        }
        if (key0 === 'dashboardShares') {
          return {
            data: [
              {
                id: 's-1',
                resourceId: 'dash-1',
                sharedWithUserId: 'u-1',
                sharedWithTeamId: null,
                accessLevel: 'READ',
              },
            ],
            isLoading: false,
            isError: false,
          }
        }
        return { data: undefined, isLoading: false, isError: false }
      },
    ),
    useQueryClient: () => mockQueryClient,
    useMutation: jest.fn((config: Record<string, unknown>) => {
      mockMutationConfigs.push(config)
      return {
        mutate: (vars: unknown) => {
          void Promise.resolve(
            (config.mutationFn as (v: unknown) => Promise<unknown>)?.(vars),
          ).catch(() => {})
        },
        mutateAsync: jest.fn().mockResolvedValue({ id: 'share-1' }),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        reset: jest.fn(),
      }
    }),
  }
})

function renderDialog(overrides: Partial<Parameters<typeof ShareDashboardDialog>[0]> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const base = {
    open: true,
    onOpenChange: jest.fn(),
    dashboardId: 'dash-1',
    ...overrides,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ShareDashboardDialog {...base} />
    </QueryClientProvider>,
  )
}

describe('ShareDashboardDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMutationConfigs.length = 0
    mockUseQueryCalls.length = 0
  })

  it('renders dialog title when open', () => {
    renderDialog()
    expect(screen.getByText('Share Dashboard')).toBeDefined()
  })

  it('does not render when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Share Dashboard')).toBeNull()
  })

  it('renders user/team radio selector', () => {
    renderDialog()
    expect(screen.getByLabelText('User')).toBeDefined()
    expect(screen.getByLabelText('Team')).toBeDefined()
  })

  it('renders access level selector', () => {
    renderDialog()
    expect(screen.getByText('Access level')).toBeDefined()
  })

  it('renders user options in the selector', () => {
    renderDialog()
    expect(screen.getByText('Alice Smith (alice@example.com)')).toBeDefined()
    expect(screen.getByText('Bob Jones (bob@example.com)')).toBeDefined()
  })

  it('renders the existing-share list with the resolved user name (AC 81)', () => {
    renderDialog()
    expect(screen.getByText('Shared with')).toBeDefined()
    expect(screen.getByText('Alice Smith')).toBeDefined()
  })

  it('revokes access via unshareDashboard', async () => {
    renderDialog()
    await userEvent.setup().click(screen.getByLabelText('Revoke access for Alice Smith'))
    expect(mockUnshareDashboard).toHaveBeenCalledWith('s-1')
  })

  it('resolves shares via fetchDashboardShares queryFn', async () => {
    mockFetchDashboardShares.mockResolvedValue([
      {
        id: 's-9',
        resourceId: 'dash-1',
        sharedWithUserId: 'u-2',
        sharedWithTeamId: null,
        accessLevel: 'READ',
      },
    ])
    renderDialog()
    const sharesQuery = mockUseQueryCalls.find(
      (c) => (c.queryKey as string[])[0] === 'dashboardShares',
    )
    await act(async () => {
      await sharesQuery!.queryFn!()
    })
    expect(mockFetchDashboardShares).toHaveBeenCalledWith('dash-1')
  })

  it('renders team options after switching to team', async () => {
    renderDialog()
    await userEvent.setup().click(screen.getByLabelText('Team'))
    expect(screen.getByLabelText('Select team')).toBeDefined()
    expect(screen.getByText('Sales Team')).toBeDefined()
  })

  it('resolves users via getUsers queryFn', async () => {
    mockGetUsers.mockResolvedValue({
      items: [{ id: 'u-9', firstName: 'Zed', lastName: 'Zee', email: 'zed@example.com' }],
    })
    renderDialog()
    const usersQuery = mockUseQueryCalls.find((c) => (c.queryKey as string[])[0] === 'users')
    await act(async () => {
      await usersQuery!.queryFn!()
    })
    expect(mockGetUsers).toHaveBeenCalledWith(1, 200)
  })

  it('calls onOpenChange with false when cancel clicked', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const cancelBtn = screen.getByText('Cancel')
    await userEvent.setup().click(cancelBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has a close button', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const closeBtn = screen.getByLabelText('Close')
    await userEvent.setup().click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shares dashboard with a selected user', async () => {
    renderDialog()
    const user = userEvent.setup()
    fireEvent.change(screen.getByLabelText('Select user'), { target: { value: 'u-1' } })
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(mockShareDashboard).toHaveBeenCalledWith('dash-1', 'u-1', undefined)
  })

  it('shares dashboard with a selected team', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Team'))
    fireEvent.change(screen.getByLabelText('Select team'), { target: { value: 't-1' } })
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(mockShareDashboard).toHaveBeenCalledWith('dash-1', undefined, 't-1')
  })

  it('handles share success', () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const onSuccess = mockMutationConfigs[0].onSuccess as () => void
    act(() => {
      onSuccess()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboardShares', 'dash-1'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Dashboard shared successfully')
    // The dialog stays open so the caller sees the new entry in the share list.
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('handles share error with an Error instance', () => {
    renderDialog()
    const onError = mockMutationConfigs[0].onError as (error: unknown) => void
    act(() => {
      onError(new Error('Not allowed'))
    })
    expect(mockToastError).toHaveBeenCalledWith('Not allowed')
  })

  it('handles share error with a non-Error value', () => {
    renderDialog()
    const onError = mockMutationConfigs[0].onError as (error: unknown) => void
    act(() => {
      onError('boom')
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to share dashboard')
  })
})
