import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DashboardSwitcher } from '../DashboardSwitcher'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}))
const mockToastSuccess = toast.success as jest.Mock
const mockToastError = toast.error as jest.Mock

const mockCreateDashboard = jest.fn()
const mockDeleteDashboard = jest.fn()
const mockUpdateDashboard = jest.fn()
jest.mock('@/services/dashboard.service', () => ({
  fetchDashboards: jest.fn(),
  createDashboard: (...args: unknown[]) => mockCreateDashboard(...args),
  updateDashboard: (...args: unknown[]) => mockUpdateDashboard(...args),
  deleteDashboard: (...args: unknown[]) => mockDeleteDashboard(...args),
}))

const mockQueryClient = {
  getQueryData: jest.fn(),
  setQueryData: jest.fn(),
  cancelQueries: jest.fn(),
  invalidateQueries: jest.fn(),
}

const mockMutationConfigs: Array<Record<string, unknown>> = []

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query') as Record<string, unknown>
  return {
    ...actual,
    useQuery: jest.fn(({ queryKey, enabled }: { queryKey: string[]; enabled?: boolean }) => {
      if (enabled === false) {
        return { data: undefined, isLoading: false, isError: false }
      }
      if (queryKey[0] === 'dashboards') {
        return {
          data: {
            owned: [
              {
                id: 'd-1',
                name: 'My Dashboard',
                isDefault: true,
                isSystemGenerated: true,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
              {
                id: 'd-2',
                name: 'Sales Pipeline',
                isDefault: false,
                isSystemGenerated: false,
                createdAt: '2026-02-01T00:00:00Z',
                updatedAt: '2026-02-01T00:00:00Z',
              },
            ],
            sharedWithMe: [
              {
                id: 'd-3',
                name: 'Team Forecast',
                isDefault: false,
                isSystemGenerated: false,
                createdAt: '2026-03-01T00:00:00Z',
                updatedAt: '2026-03-01T00:00:00Z',
              },
            ],
          },
          isLoading: false,
          isError: false,
        }
      }
      return { data: undefined, isLoading: false, isError: false }
    }),
    useQueryClient: () => mockQueryClient,
    useMutation: jest.fn((config: Record<string, unknown>) => {
      mockMutationConfigs.push(config)
      return {
        mutate: (vars: unknown) => {
          void Promise.resolve(
            (config.mutationFn as (v: unknown) => Promise<unknown>)?.(vars),
          ).catch(() => {})
        },
        mutateAsync: jest.fn().mockResolvedValue({ id: 'new-id', name: 'New Dashboard' }),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        reset: jest.fn(),
      }
    }),
  }
})

function renderSwitcher(overrides: Partial<Parameters<typeof DashboardSwitcher>[0]> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const base = {
    currentDashboardId: 'd-1',
    ...overrides,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardSwitcher {...base} />
    </QueryClientProvider>,
  )
}

async function openPopover(): Promise<void> {
  const trigger = screen.getByLabelText('Switch dashboard')
  await userEvent.setup().click(trigger)
}

describe('DashboardSwitcher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMutationConfigs.length = 0
  })

  it('renders the switcher trigger button', () => {
    renderSwitcher()
    expect(screen.getByLabelText('Switch dashboard')).toBeDefined()
  })

  it('shows owned dashboards when opened', async () => {
    renderSwitcher()
    await openPopover()
    const items = screen.getAllByText('My Dashboard')
    expect(items.length).toBeGreaterThanOrEqual(2) // trigger + popover
    expect(screen.getByText('Sales Pipeline')).toBeDefined()
  })

  it('shows shared with me group when opened', async () => {
    renderSwitcher()
    await openPopover()
    expect(screen.getByText('Shared with me')).toBeDefined()
    expect(screen.getByText('Team Forecast')).toBeDefined()
  })

  it('shows New Dashboard button in popover', async () => {
    renderSwitcher()
    await openPopover()
    expect(screen.getByText('New Dashboard')).toBeDefined()
  })

  it('navigates to selected dashboard on click', async () => {
    renderSwitcher()
    await openPopover()
    const salesLink = screen.getByText('Sales Pipeline')
    await userEvent.setup().click(salesLink)
    expect(mockPush).toHaveBeenCalledWith('/dashboard?dashboard=d-2')
  })

  it('navigates to shared dashboard on click', async () => {
    renderSwitcher()
    await openPopover()
    await userEvent.setup().click(screen.getByText('Team Forecast'))
    expect(mockPush).toHaveBeenCalledWith('/dashboard?dashboard=d-3')
  })

  it('creates a dashboard when New Dashboard clicked', async () => {
    renderSwitcher()
    await openPopover()
    await userEvent.setup().click(screen.getByText('New Dashboard'))
    expect(mockCreateDashboard).toHaveBeenCalledWith({ name: 'Untitled Dashboard' })
  })

  it('handles create success', () => {
    renderSwitcher()
    const onSuccess = mockMutationConfigs[0].onSuccess as (dash: {
      id: string
      name?: string
    }) => void
    act(() => {
      onSuccess({ id: 'new-1', name: 'New Dashboard' })
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
    expect(mockToastSuccess).toHaveBeenCalledWith('Dashboard created')
    expect(mockPush).toHaveBeenCalledWith('/dashboard?dashboard=new-1')
  })

  it('handles create error', () => {
    renderSwitcher()
    const onError = mockMutationConfigs[0].onError as () => void
    act(() => {
      onError()
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to create dashboard')
  })

  it('handles delete success', () => {
    renderSwitcher()
    const onSuccess = mockMutationConfigs[1].onSuccess as () => void
    act(() => {
      onSuccess()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'my'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Dashboard deleted')
  })

  it('handles delete error', () => {
    renderSwitcher()
    const onError = mockMutationConfigs[1].onError as () => void
    act(() => {
      onError()
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to delete dashboard')
  })

  it('handles set-default success', () => {
    renderSwitcher()
    const onSuccess = mockMutationConfigs[2].onSuccess as () => void
    act(() => {
      onSuccess()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
    expect(mockToastSuccess).toHaveBeenCalledWith('Default dashboard updated')
  })

  it('handles set-default error', () => {
    renderSwitcher()
    const onError = mockMutationConfigs[2].onError as () => void
    act(() => {
      onError()
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to set default dashboard')
  })

  it('sets default when star clicked on non-default dashboard', async () => {
    renderSwitcher()
    await openPopover()
    await userEvent.setup().click(screen.getByLabelText('Set Sales Pipeline as default'))
    expect(mockUpdateDashboard).toHaveBeenCalledWith('d-2', { isDefault: true })
  })

  it('deletes dashboard when trash clicked and confirmed', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    renderSwitcher()
    await openPopover()
    await userEvent.setup().click(screen.getByLabelText('Delete Sales Pipeline'))
    expect(mockDeleteDashboard).toHaveBeenCalledWith('d-2')
    confirmSpy.mockRestore()
  })

  it('does not delete when the confirmation is cancelled', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    renderSwitcher()
    await openPopover()
    await userEvent.setup().click(screen.getByLabelText('Delete Sales Pipeline'))
    expect(mockDeleteDashboard).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('opens the share dialog when Share is clicked (AC 80)', async () => {
    const onShareDashboard = jest.fn()
    renderSwitcher({ onShareDashboard })
    await openPopover()
    await userEvent.setup().click(screen.getByLabelText('Share Sales Pipeline'))
    expect(onShareDashboard).toHaveBeenCalledWith('d-2')
  })

  it('renames a dashboard via the inline input (AC 80)', async () => {
    renderSwitcher()
    await openPopover()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Rename My Dashboard'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed Dash{enter}')
    expect(mockUpdateDashboard).toHaveBeenCalledWith('d-1', { name: 'Renamed Dash' })
  })
})
