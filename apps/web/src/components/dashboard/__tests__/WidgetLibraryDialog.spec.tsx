import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { WidgetLibraryDialog } from '../WidgetLibraryDialog'

const mockAddWidget = jest.fn()
jest.mock('@/services/dashboard.service', () => ({
  ...jest.requireActual('@/services/dashboard.service'),
  addWidget: (...args: unknown[]) => mockAddWidget(...args),
  fetchDashboard: jest.fn(),
}))

let mockHasPermission: (resource: string, action: string) => boolean = () => true
jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    permissions: [],
    isLoading: false,
    hasPermission: (resource: string, action: string) => mockHasPermission(resource, action),
  }),
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

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query') as Record<string, unknown>
  return {
    ...actual,
    useQuery: jest.fn(({ enabled }: { enabled?: boolean }) => {
      if (enabled === false) {
        return { data: undefined, isLoading: false, isError: false }
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
        mutateAsync: jest.fn(),
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        reset: jest.fn(),
      }
    }),
  }
})

function renderDialog(overrides: Partial<Parameters<typeof WidgetLibraryDialog>[0]> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const base = {
    open: true,
    onOpenChange: jest.fn(),
    dashboardId: 'dash-1',
    ...overrides,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <WidgetLibraryDialog {...base} />
    </QueryClientProvider>,
  )
}

describe('WidgetLibraryDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMutationConfigs.length = 0
    mockHasPermission = () => true
  })

  it('renders dialog with heading when open', () => {
    renderDialog()
    const headings = screen.getAllByText('Add Widget')
    expect(headings.length).toBeGreaterThanOrEqual(1)
  })

  it('does not render when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Add Widget')).toBeNull()
  })

  it('renders source entries from WIDGET_SOURCES', () => {
    renderDialog()
    expect(screen.getByText('Pipeline by Stage')).toBeDefined()
    expect(screen.getByText('Pipeline Value')).toBeDefined()
    expect(screen.getByText('Sales Forecast')).toBeDefined()
    expect(screen.getByText('Win/Loss Analysis')).toBeDefined()
    expect(screen.getByText('At-Risk Deals')).toBeDefined()
    expect(screen.getByText('My Tasks')).toBeDefined()
    expect(screen.getByText('Task Stats')).toBeDefined()
    expect(screen.getByText('Recent Activity')).toBeDefined()
    expect(screen.getByText('Time Tracked')).toBeDefined()
    expect(screen.getByText('Contact Count')).toBeDefined()
  })

  it('renders a description for each source (AC 79)', () => {
    renderDialog()
    expect(screen.getByText('Total value of your open pipeline.')).toBeDefined()
    expect(screen.getByText('Your open tasks ordered by due date.')).toBeDefined()
  })

  it('hides sources the caller lacks permission for (AC 79)', () => {
    mockHasPermission = (resource) => resource !== 'DEAL'
    renderDialog()
    // DEAL-backed sources are hidden, REPORT/TASK/CONTACT sources remain
    expect(screen.queryByText('Pipeline by Stage')).toBeNull()
    expect(screen.queryByText('Pipeline Value')).toBeNull()
    expect(screen.queryByText('At-Risk Deals')).toBeNull()
    expect(screen.getByText('Sales Forecast')).toBeDefined()
    expect(screen.getByText('My Tasks')).toBeDefined()
    expect(screen.getByText('Contact Count')).toBeDefined()
  })

  it('shows allowed widget types when a source is clicked', async () => {
    renderDialog()
    const sourceBtn = screen.getByLabelText('Select source Pipeline Value')
    await userEvent.setup().click(sourceBtn)
    expect(screen.getByText('Metric Card')).toBeDefined()
  })

  it('shows multiple types for multi-type sources', async () => {
    renderDialog()
    const sourceBtn = screen.getByLabelText('Select source Pipeline by Stage')
    await userEvent.setup().click(sourceBtn)
    expect(screen.getByText('Bar Chart')).toBeDefined()
    expect(screen.getByText('Funnel')).toBeDefined()
    expect(screen.getByText('Table')).toBeDefined()
  })

  it('adds a widget when source and type are selected', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Select source Pipeline Value'))
    await user.click(screen.getByLabelText('Select Metric Card for Pipeline Value'))
    await user.click(screen.getByRole('button', { name: 'Add Widget' }))
    expect(mockAddWidget).toHaveBeenCalledWith('dash-1', {
      type: 'METRIC_CARD',
      source: 'PIPELINE_VALUE',
      title: 'Pipeline Value',
      config: {
        source: 'PIPELINE_VALUE',
        dateRangeDays: 30,
        stageId: null,
        ownerId: null,
        limit: 5,
      },
      size: '1x1',
    })
  })

  it('uses 2x2 size for non metric-card widgets', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Select source Pipeline by Stage'))
    await user.click(screen.getByLabelText('Select Bar Chart for Pipeline by Stage'))
    await user.click(screen.getByRole('button', { name: 'Add Widget' }))
    expect(mockAddWidget).toHaveBeenCalledWith(
      'dash-1',
      expect.objectContaining({ type: 'BAR_CHART', size: '2x2' }),
    )
  })

  it('calls onOpenChange with false when cancel button is clicked', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const cancelBtn = screen.getByText('Cancel')
    await userEvent.setup().click(cancelBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has a close button that calls onOpenChange', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const closeBtn = screen.getByLabelText('Close')
    await userEvent.setup().click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('handles add-widget success', () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    const onSuccess = mockMutationConfigs[0].onSuccess as () => void
    act(() => {
      onSuccess()
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'dash-1'],
    })
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'my'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Widget added')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('handles add-widget error with an Error instance', () => {
    renderDialog()
    const onError = mockMutationConfigs[0].onError as (error: unknown) => void
    act(() => {
      onError(new Error('Cannot add'))
    })
    expect(mockToastError).toHaveBeenCalledWith('Cannot add')
  })

  it('handles add-widget error with a non-Error value', () => {
    renderDialog()
    const onError = mockMutationConfigs[0].onError as (error: unknown) => void
    act(() => {
      onError('nope')
    })
    expect(mockToastError).toHaveBeenCalledWith('Failed to add widget')
  })
})
