import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DashboardWorkspace } from '../DashboardWorkspace'

// ─── Mock data ───────────────────────────────────────────────────────────────

const mockWidgets = [
  {
    id: 'w-1',
    type: 'METRIC_CARD',
    title: 'Pipeline Value',
    config: { source: 'PIPELINE_VALUE', dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
    position: 0,
    size: '1x1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'w-2',
    type: 'BAR_CHART',
    title: 'Pipeline by Stage',
    config: {
      source: 'PIPELINE_BY_STAGE',
      dateRangeDays: 30,
      stageId: null,
      ownerId: null,
      limit: 5,
    },
    position: 1,
    size: '2x2',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'w-3',
    type: 'TABLE',
    title: 'At-Risk Deals',
    config: { source: 'AT_RISK_DEALS', dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
    position: 2,
    size: '3x2',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

// ─── Service mocks ───────────────────────────────────────────────────────────

const mockFetchMyDashboard = jest.fn()
const mockFetchDashboard = jest.fn()
const mockFetchDashboards = jest.fn()
const mockFetchWidgetData = jest.fn()
const mockReorderWidgets = jest.fn()
const mockUpdateWidget = jest.fn()
const mockRemoveWidget = jest.fn()
const mockAddWidget = jest.fn()
const mockShareDashboard = jest.fn()
const mockUnshareDashboard = jest.fn()
const mockFetchDashboardShares = jest.fn()

jest.mock('@/services/dashboard.service', () => ({
  fetchMyDashboard: (...args: unknown[]) => mockFetchMyDashboard(...args),
  fetchDashboard: (...args: unknown[]) => mockFetchDashboard(...args),
  fetchDashboards: (...args: unknown[]) => mockFetchDashboards(...args),
  fetchWidgetData: (...args: unknown[]) => mockFetchWidgetData(...args),
  reorderWidgets: (...args: unknown[]) => mockReorderWidgets(...args),
  updateWidget: (...args: unknown[]) => mockUpdateWidget(...args),
  removeWidget: (...args: unknown[]) => mockRemoveWidget(...args),
  addWidget: (...args: unknown[]) => mockAddWidget(...args),
  shareDashboard: (...args: unknown[]) => mockShareDashboard(...args),
  unshareDashboard: (...args: unknown[]) => mockUnshareDashboard(...args),
  fetchDashboardShares: (...args: unknown[]) => mockFetchDashboardShares(...args),
}))

let mockCurrentUser: { userId: string } | null = { userId: 'u-1' }
jest.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: { user: { userId: string } | null }) => unknown) =>
    selector({ user: mockCurrentUser }),
}))

// ─── DnD mocks ───────────────────────────────────────────────────────────────

let mockDndProps: Record<string, unknown> = {}

jest.mock('@dnd-kit/core', () => ({
  DndContext: (props: Record<string, unknown>) => {
    mockDndProps = props
    return <div data-testid="dnd-context">{props.children as React.ReactNode}</div>
  },
  PointerSensor: jest.fn(),
  TouchSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  useSensor: jest.fn(() => ({})),
  useSensors: jest.fn(() => ({})),
  DragOverlay: (props: Record<string, unknown>) => (
    <div data-testid="drag-overlay">{props.children as React.ReactNode}</div>
  ),
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: Record<string, unknown>) => (
    <div data-testid="sortable-context">{props.children as React.ReactNode}</div>
  ),
  rectSortingStrategy: {},
  useSortable: jest.fn(() => ({
    attributes: {},
    listeners: undefined,
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
}))

// ─── Child component mocks (WidgetFrame/WidgetRenderer are covered by their own specs) ──

jest.mock('../WidgetFrame', () => ({
  WidgetFrame: (props: Record<string, unknown>) => {
    const widget = props.widget as { id: string; title: string }
    return (
      <div data-testid={`frame-${widget.id}`}>
        <span>{widget.title}</span>
        {!props.isLoading && !props.isError && !props.isPermissionLimited
          ? (props.children as React.ReactNode)
          : null}
        <button type="button" onClick={props.onMoveUp as () => void}>
          move-up-{widget.id}
        </button>
        <button type="button" onClick={props.onMoveDown as () => void}>
          move-down-{widget.id}
        </button>
        <button type="button" onClick={() => (props.onResize as (size: string) => void)?.('2x2')}>
          resize-{widget.id}
        </button>
        <button type="button" onClick={props.onRemove as () => void}>
          remove-{widget.id}
        </button>
      </div>
    )
  },
}))

jest.mock('../WidgetRenderer', () => ({
  WidgetRenderer: (props: Record<string, unknown>) => (
    <div data-testid={`renderer-${(props.widget as { id: string }).id}`} />
  ),
}))

jest.mock('../DashboardSwitcher', () => ({
  DashboardSwitcher: () => <div data-testid="dashboard-switcher" />,
}))

jest.mock('../WidgetLibraryDialog', () => ({
  WidgetLibraryDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="widget-library-dialog" /> : null,
}))

jest.mock('../ShareDashboardDialog', () => ({
  ShareDashboardDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="share-dashboard-dialog" /> : null,
}))

// ─── Navigation / toast mocks ────────────────────────────────────────────────

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}))
const mockToastSuccess = toast.success as jest.Mock
const mockToastError = toast.error as jest.Mock

// ─── React Query mocks ───────────────────────────────────────────────────────

const mockQueryClient = {
  getQueryData: jest.fn(),
  setQueryData: jest.fn(),
  cancelQueries: jest.fn(),
  invalidateQueries: jest.fn(),
}

const mockMutationConfigs: Array<Record<string, unknown>> = []
const mockMutates: jest.Mock[] = []
const mockUseQueryCalls: Array<{ queryKey: unknown[]; queryFn?: () => unknown }> = []

let mockDashboardQueryResult: Record<string, unknown>
let mockDashListResult: Record<string, unknown>
let mockWidgetDataResult: Record<string, unknown>

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query') as Record<string, unknown>
  return {
    ...actual,
    useQuery: jest.fn((opts: { queryKey: unknown[]; queryFn?: () => unknown }) => {
      mockUseQueryCalls.push(opts)
      const key0 = opts.queryKey?.[0]
      if (key0 === 'dashboards') return mockDashListResult
      if (key0 === 'widgetData') return mockWidgetDataResult
      if (key0 === 'dashboard') return mockDashboardQueryResult
      return { data: undefined, isLoading: false, isError: false }
    }),
    useMutation: jest.fn((config: Record<string, unknown>) => {
      mockMutationConfigs.push(config)
      const mutate = jest.fn()
      mockMutates.push(mutate)
      return {
        mutate,
        mutateAsync: jest.fn(),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        reset: jest.fn(),
      }
    }),
    useQueryClient: () => mockQueryClient,
  }
})

function renderWorkspace(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardWorkspace />
    </QueryClientProvider>,
  )
}

describe('DashboardWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockDndProps = {}
    mockMutationConfigs.length = 0
    mockMutates.length = 0
    mockUseQueryCalls.length = 0
    mockDashboardQueryResult = {
      data: {
        id: 'd-1',
        name: 'My Dashboard',
        userId: 'u-1',
        ownerName: null,
        isDefault: true,
        isSystemGenerated: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        widgets: mockWidgets,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }
    mockCurrentUser = { userId: 'u-1' }
    mockDashListResult = {
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
        ],
        sharedWithMe: [],
      },
      isLoading: false,
      isError: false,
    }
    mockWidgetDataResult = { data: undefined, isLoading: false, isError: false }
    mockQueryClient.getQueryData.mockReturnValue({ id: 'd-1', widgets: [...mockWidgets] })
    mockQueryClient.setQueryData.mockImplementation((_key: unknown, updater: unknown) => {
      if (typeof updater === 'function') {
        return updater(mockQueryClient.getQueryData(_key))
      }
      return updater
    })
  })

  it('renders dashboard name', () => {
    renderWorkspace()
    expect(screen.getByText('My Dashboard')).toBeDefined()
  })

  it('renders edit toggle button', () => {
    renderWorkspace()
    const buttons = screen.getAllByLabelText('Edit dashboard')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders Add widget and Share buttons', () => {
    renderWorkspace()
    expect(screen.getByLabelText('Add widget')).toBeDefined()
    expect(screen.getByLabelText('Share dashboard')).toBeDefined()
  })

  it('opens the widget library dialog when Add widget is clicked', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByLabelText('Add widget'))
    expect(screen.getByTestId('widget-library-dialog')).toBeDefined()
  })

  it('opens the share dialog when Share is clicked', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByLabelText('Share dashboard'))
    expect(screen.getByTestId('share-dashboard-dialog')).toBeDefined()
  })

  it('shows read-only badge and hides edit controls for a shared dashboard (AC 72)', () => {
    mockCurrentUser = { userId: 'u-other' }
    mockDashboardQueryResult = {
      ...mockDashboardQueryResult,
      data: {
        id: 'd-shared',
        name: 'Team Dashboard',
        userId: 'u-1',
        ownerName: 'Alice Smith',
        isDefault: false,
        isSystemGenerated: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        widgets: mockWidgets,
      },
    }
    renderWorkspace()
    expect(screen.getByText('Shared by Alice Smith · Read only')).toBeDefined()
    expect(screen.queryByLabelText('Edit dashboard')).toBeNull()
    expect(screen.queryByLabelText('Add widget')).toBeNull()
    expect(screen.queryByLabelText('Share dashboard')).toBeNull()
  })

  it('toggles edit mode on Edit button click', async () => {
    renderWorkspace()
    const user = userEvent.setup()
    await user.click(screen.getAllByLabelText('Edit dashboard')[0])
    expect(screen.getAllByLabelText('Done editing').length).toBeGreaterThanOrEqual(1)
    await user.click(screen.getAllByLabelText('Done editing')[0])
    expect(screen.getAllByLabelText('Edit dashboard').length).toBeGreaterThanOrEqual(1)
  })

  it('renders DashboardGrid section with accessible label', () => {
    renderWorkspace()
    const section = screen.getByRole('region', { name: 'Dashboard widgets' })
    expect(section).toBeDefined()
  })

  it('renders dashboard count text', () => {
    renderWorkspace()
    expect(screen.getByText('1 dashboard available')).toBeDefined()
  })

  it('renders loading skeleton while dashboard loads', () => {
    mockDashboardQueryResult = { data: undefined, isLoading: true, isError: false }
    renderWorkspace()
    expect(screen.getByLabelText('Loading dashboard')).toBeDefined()
  })

  it('renders error state with retry when dashboard fails', async () => {
    const mockRefetch = jest.fn()
    mockDashboardQueryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Boom'),
      refetch: mockRefetch,
    }
    renderWorkspace()
    expect(screen.getByText('Could not load dashboard')).toBeDefined()
    expect(screen.getByText('Boom')).toBeDefined()
    await userEvent.setup().click(screen.getByText('Try again'))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('renders empty state when no dashboard', () => {
    mockDashboardQueryResult = { data: undefined, isLoading: false, isError: false }
    renderWorkspace()
    expect(screen.getByText('No dashboard found')).toBeDefined()
  })

  it('sets active id on drag start and shows DragOverlay', () => {
    renderWorkspace()
    const onDragStart = mockDndProps.onDragStart as (e: { active: { id: string } }) => void
    act(() => {
      onDragStart({ active: { id: 'w-1' } })
    })
    const overlay = screen.getByTestId('drag-overlay')
    expect(within(overlay).getByText('Pipeline Value')).toBeDefined()
  })

  it('reorders widgets on drag end', () => {
    renderWorkspace()
    const onDragEnd = mockDndProps.onDragEnd as (e: {
      active: { id: string }
      over: { id: string } | null
    }) => void
    act(() => {
      onDragEnd({ active: { id: 'w-1' }, over: { id: 'w-2' } })
    })
    const reorderMutate = mockMutates[0] as jest.Mock
    expect(reorderMutate).toHaveBeenCalledWith({ orderedIds: ['w-2', 'w-1', 'w-3'] })
  })

  it('does not reorder when dropping on itself', () => {
    renderWorkspace()
    const onDragEnd = mockDndProps.onDragEnd as (e: {
      active: { id: string }
      over: { id: string } | null
    }) => void
    act(() => {
      onDragEnd({ active: { id: 'w-1' }, over: { id: 'w-1' } })
    })
    expect(mockMutates[0]).not.toHaveBeenCalled()
  })

  it('does not reorder when dropping over nothing', () => {
    renderWorkspace()
    const onDragEnd = mockDndProps.onDragEnd as (e: { active: { id: string }; over: null }) => void
    act(() => {
      onDragEnd({ active: { id: 'w-1' }, over: null })
    })
    expect(mockMutates[0]).not.toHaveBeenCalled()
  })

  it('moves widget up', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('move-up-w-2'))
    expect(mockMutates[0]).toHaveBeenCalledWith({ orderedIds: ['w-2', 'w-1', 'w-3'] })
  })

  it('moves widget down', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('move-down-w-1'))
    expect(mockMutates[0]).toHaveBeenCalledWith({ orderedIds: ['w-2', 'w-1', 'w-3'] })
  })

  it('does nothing when moving first widget up', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('move-up-w-1'))
    expect(mockMutates[0]).not.toHaveBeenCalled()
  })

  it('does nothing when moving last widget down', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('move-down-w-3'))
    expect(mockMutates[0]).not.toHaveBeenCalled()
  })

  it('resizes a widget', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('resize-w-1'))
    expect(mockMutates[1]).toHaveBeenCalledWith({ widgetId: 'w-1', size: '2x2' })
  })

  it('removes a widget', async () => {
    renderWorkspace()
    await userEvent.setup().click(screen.getByText('remove-w-1'))
    expect(mockMutates[2]).toHaveBeenCalledWith('w-1')
  })

  it('calls reorderWidgets service in reorder mutationFn', async () => {
    renderWorkspace()
    const mutationFn = mockMutationConfigs[0].mutationFn as (vars: {
      orderedIds: string[]
    }) => Promise<unknown>
    await act(async () => {
      await mutationFn({ orderedIds: ['w-2', 'w-1', 'w-3'] })
    })
    expect(mockReorderWidgets).toHaveBeenCalledWith('d-1', ['w-2', 'w-1', 'w-3'])
  })

  it('calls updateWidget service in resize mutationFn', async () => {
    renderWorkspace()
    const mutationFn = mockMutationConfigs[1].mutationFn as (vars: {
      widgetId: string
      size: string
    }) => Promise<unknown>
    await act(async () => {
      await mutationFn({ widgetId: 'w-1', size: '2x2' })
    })
    expect(mockUpdateWidget).toHaveBeenCalledWith('w-1', { size: '2x2' })
  })

  it('calls removeWidget service in remove mutationFn', async () => {
    renderWorkspace()
    const mutationFn = mockMutationConfigs[2].mutationFn as (widgetId: string) => Promise<unknown>
    await act(async () => {
      await mutationFn('w-1')
    })
    expect(mockRemoveWidget).toHaveBeenCalledWith('w-1')
  })

  it('optimistically reorders in reorder onMutate', async () => {
    renderWorkspace()
    const onMutate = mockMutationConfigs[0].onMutate as (vars: {
      orderedIds: string[]
    }) => Promise<unknown>
    await act(async () => {
      await onMutate({ orderedIds: ['w-3', 'w-1', 'w-2'] })
    })
    expect(mockQueryClient.cancelQueries).toHaveBeenCalledWith({ queryKey: ['dashboard', 'my'] })
    expect(mockQueryClient.getQueryData).toHaveBeenCalled()
    expect(mockQueryClient.setQueryData).toHaveBeenCalled()
  })

  it('rolls back on reorder error with previous data', async () => {
    renderWorkspace()
    const onError = mockMutationConfigs[0].onError as (
      err: unknown,
      vars: unknown,
      ctx: { prev?: unknown },
    ) => void
    const prev = { id: 'd-1', widgets: [...mockWidgets] }
    await act(async () => {
      onError(new Error('x'), {}, { prev })
    })
    expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(['dashboard', 'my'], prev)
    expect(mockToastError).toHaveBeenCalledWith('Failed to reorder widgets. Please try again.')
  })

  it('toasts on reorder error without previous data', async () => {
    renderWorkspace()
    const onError = mockMutationConfigs[0].onError as (
      err: unknown,
      vars: unknown,
      ctx: { prev?: unknown },
    ) => void
    await act(async () => {
      onError(new Error('x'), {}, {})
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to reorder widgets. Please try again.')
  })

  it('invalidates queries on reorder settled', () => {
    renderWorkspace()
    const onSettled = mockMutationConfigs[0].onSettled as () => void
    act(() => {
      onSettled()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'my'],
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
  })

  it('optimistically resizes in resize onMutate', async () => {
    renderWorkspace()
    const onMutate = mockMutationConfigs[1].onMutate as (vars: {
      widgetId: string
      size: string
    }) => Promise<unknown>
    await act(async () => {
      await onMutate({ widgetId: 'w-1', size: '2x2' })
    })
    expect(mockQueryClient.cancelQueries).toHaveBeenCalledWith({ queryKey: ['dashboard', 'my'] })
    expect(mockQueryClient.setQueryData).toHaveBeenCalled()
  })

  it('rolls back on resize error with previous data', async () => {
    renderWorkspace()
    const onError = mockMutationConfigs[1].onError as (
      err: unknown,
      vars: unknown,
      ctx: { prev?: unknown },
    ) => void
    const prev = { id: 'd-1', widgets: [...mockWidgets] }
    await act(async () => {
      onError(new Error('x'), {}, { prev })
    })
    expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(['dashboard', 'my'], prev)
    expect(mockToastError).toHaveBeenCalledWith('Failed to resize widget. Please try again.')
  })

  it('invalidates queries on resize settled', () => {
    renderWorkspace()
    const onSettled = mockMutationConfigs[1].onSettled as () => void
    act(() => {
      onSettled()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'my'],
    })
  })

  it('invalidates dashboard queries on remove success', () => {
    renderWorkspace()
    const onSuccess = mockMutationConfigs[2].onSuccess as () => void
    act(() => {
      onSuccess()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'd-1'],
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'my'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Widget removed')
  })

  it('toasts on remove error', () => {
    renderWorkspace()
    const onError = mockMutationConfigs[2].onError as () => void
    act(() => {
      onError()
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to remove widget. Please try again.')
  })

  it('resolves dashboard via fetchMyDashboard when no dashboard param', async () => {
    renderWorkspace()
    const mainQuery = mockUseQueryCalls.find((c) => c.queryKey[0] === 'dashboard')
    await act(async () => {
      await mainQuery!.queryFn!()
    })
    expect(mockFetchMyDashboard).toHaveBeenCalled()
  })

  it('resolves dashboard via fetchDashboard when dashboard param present', async () => {
    mockSearchParams = new URLSearchParams('dashboard=d-9')
    renderWorkspace()
    const mainQuery = mockUseQueryCalls.find((c) => c.queryKey[0] === 'dashboard')
    await act(async () => {
      await mainQuery!.queryFn!()
    })
    expect(mockFetchDashboard).toHaveBeenCalledWith('d-9')
  })

  it('fetches dashboards list via queryFn', async () => {
    renderWorkspace()
    const listQuery = mockUseQueryCalls.find((c) => c.queryKey[0] === 'dashboards')
    await act(async () => {
      await listQuery!.queryFn!()
    })
    expect(mockFetchDashboards).toHaveBeenCalled()
  })

  it('fetches widget data via widgetData queryFn', async () => {
    renderWorkspace()
    const widgetQuery = mockUseQueryCalls.find((c) => c.queryKey[0] === 'widgetData')
    await act(async () => {
      await widgetQuery!.queryFn!()
    })
    expect(mockFetchWidgetData).toHaveBeenCalledWith('w-1')
  })

  it('provides drag accessibility announcements', () => {
    renderWorkspace()
    const announcements = (
      mockDndProps.accessibility as { announcements: Record<string, (e: unknown) => string> }
    ).announcements
    expect(announcements.onDragStart({ active: { id: 'w-1' } })).toBe('Picked up widget w-1')
    expect(announcements.onDragOver({ active: { id: 'w-1' }, over: { id: 'w-2' } })).toBe(
      'Widget w-1 is over widget w-2',
    )
    expect(announcements.onDragOver({ active: { id: 'w-1' }, over: null })).toBe(
      'Widget w-1 is not over a target',
    )
    expect(announcements.onDragEnd({ active: { id: 'w-1' }, over: { id: 'w-2' } })).toBe(
      'Dropped widget w-1 after widget w-2',
    )
    expect(announcements.onDragCancel({ active: { id: 'w-1' } })).toBe(
      'Dragging cancelled. Widget w-1 was returned.',
    )
  })
})
