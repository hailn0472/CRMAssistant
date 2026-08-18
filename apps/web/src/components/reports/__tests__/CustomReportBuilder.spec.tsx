/**
 * Story 6.3 (AC 3-4, 10, 11, 15, 16, S6, E6): CustomReportBuilder RTL.
 * Three-section workflow layout, debounced/cancelled preview, save/create/
 * edit flow with invalidation + URL transition, and permission gating.
 * Recharts and the custom-report service are mocked; @dnd-kit renders for
 * real (its sensors are exercised by the e2e spec).
 */
jest.mock('recharts', () => {
  const React = require('react')
  const MockContainer = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  return {
    ResponsiveContainer: MockContainer,
    LineChart: MockContainer,
    Line: () => React.createElement('div'),
    BarChart: MockContainer,
    Bar: () => React.createElement('div'),
    PieChart: MockContainer,
    Pie: () => React.createElement('div'),
    FunnelChart: MockContainer,
    Funnel: () => React.createElement('div'),
    Cell: () => React.createElement('div'),
    LabelList: () => React.createElement('div'),
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: () => React.createElement('div'),
    Legend: () => React.createElement('div'),
  }
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { CustomReportBuilder } from '../CustomReportBuilder'
import type { CustomReportCatalog, CustomReportResult } from '@/services/custom-report.service'

// ─── Mocks ─────────────────────────────────────────────────────────────

const permissionGrants: Record<string, boolean> = {}
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) =>
    permissionGrants[`${resource}:${action}`] ?? false,
}))

let mockSearchParams = new URLSearchParams()
const mockRouterReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useSearchParams: (): URLSearchParams => mockSearchParams,
  useRouter: (): { replace: jest.Mock } => ({ replace: mockRouterReplace }),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

import toast from 'react-hot-toast'

const mockGetCatalog = jest.fn()
const mockPreview = jest.fn()
const mockGetData = jest.fn()
const mockSave = jest.fn()
jest.mock('@/services/custom-report.service', () => {
  const actual = jest.requireActual('@/services/custom-report.service')
  return {
    ...actual,
    getCustomReportFieldCatalog: (...args: unknown[]) => mockGetCatalog(...args),
    previewCustomReport: (...args: unknown[]) => mockPreview(...args),
    getCustomReportData: (...args: unknown[]) => mockGetData(...args),
    saveCustomReport: (...args: unknown[]) => mockSave(...args),
  }
})

// ─── Fixtures ──────────────────────────────────────────────────────────

const CATALOG: CustomReportCatalog = {
  dataSource: 'DEALS',
  fields: [
    {
      key: 'deal.id',
      label: 'Deal ID',
      valueType: 'STRING',
      roles: ['METRIC'],
      aggregations: ['COUNT', 'DISTINCT_COUNT'],
      filterOperators: [],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
    {
      key: 'deal.createdAt',
      label: 'Created at',
      valueType: 'DATETIME',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['ON', 'BEFORE', 'AFTER'],
      relationKind: null,
      isNumeric: false,
      isCurrency: false,
      isDate: true,
    },
    {
      key: 'deal.stage',
      label: 'Stage',
      valueType: 'RELATION',
      roles: ['FILTER', 'DIMENSION'],
      aggregations: [],
      filterOperators: ['EQ', 'NOT_EQ', 'IN'],
      relationKind: 'STAGE',
      isNumeric: false,
      isCurrency: false,
      isDate: false,
    },
    {
      key: 'deal.value',
      label: 'Value',
      valueType: 'CURRENCY',
      roles: ['FILTER', 'METRIC'],
      aggregations: ['SUM', 'AVERAGE', 'MIN', 'MAX'],
      filterOperators: ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'],
      relationKind: null,
      isNumeric: true,
      isCurrency: true,
      isDate: false,
    },
  ],
}

const RESULT: CustomReportResult = {
  reportId: null,
  generatedAt: '2026-08-16T12:00:00.000Z',
  config: {
    version: 1,
    dataSource: 'DEALS',
    filters: [],
    dimensions: [
      { id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' },
    ],
    metrics: [{ id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: null,
      showLegend: true,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: 'VERTICAL',
    },
    sort: [],
  },
  columns: [],
  rows: [],
  totalRows: 0,
  series: [],
  warnings: [],
  pagination: { page: 1, pageSize: 50, totalPages: 0 },
  truncated: false,
}

function grantAll(): void {
  for (const resource of ['REPORT', 'CONTACT', 'DEAL', 'TASK']) {
    for (const action of ['READ', 'CREATE', 'UPDATE']) {
      permissionGrants[`${resource}:${action}`] = true
    }
  }
}

function renderBuilder(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CustomReportBuilder />
    </QueryClientProvider>,
  )
}

describe('CustomReportBuilder (AC 3-4, 10-11, 15-16)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    grantAll()
    mockSearchParams = new URLSearchParams()
    mockRouterReplace.mockReset()
    mockGetCatalog.mockResolvedValue(CATALOG)
    mockPreview.mockResolvedValue(RESULT)
    mockGetData.mockResolvedValue({ ...RESULT, reportId: 'report-1' })
    mockSave.mockResolvedValue({
      id: 'report-1',
      name: 'My report',
      isPublic: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
      createdBy: 'user-1',
      config: RESULT.config,
    })
  })

  it('renders the three required sections in workflow order (AC 4)', () => {
    renderBuilder()
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['Data Source', 'Fields', 'Visualization'])
  })

  it('shows PermissionLimitedState without REPORT:READ (S6)', () => {
    permissionGrants['REPORT:READ'] = false
    renderBuilder()
    expect(screen.getByText(/Reports access limited/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Data Source' })).not.toBeInTheDocument()
  })

  it('shows PermissionLimitedState when no source read permission exists (S6)', () => {
    for (const r of ['CONTACT', 'DEAL', 'TASK']) permissionGrants[`${r}:READ`] = false
    renderBuilder()
    expect(screen.getByText(/source.*read|Reports access limited/i)).toBeInTheDocument()
  })

  it('fetches the field catalogue for the selected source', async () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() => expect(mockGetCatalog).toHaveBeenCalledWith('DEALS'))
  })

  it('debounces valid preview config by 300 ms (E6)', async () => {
    jest.useFakeTimers()
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    // Flush the catalogue query: first microtasks (queryFn resolves and the
    // TanStack notify is scheduled), then the setTimeout(0) notification.
    await act(async () => {})
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Created at as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))

    // Before the debounce window elapses no preview request fires.
    expect(mockPreview).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    await act(async () => {
      jest.runOnlyPendingTimers()
    })
    expect(mockPreview).toHaveBeenCalledTimes(1)
    const [config] = mockPreview.mock.calls[0]
    expect(config.dataSource).toBe('DEALS')
    expect(config.metrics[0].fieldId).toBe('deal.id')
  })

  it('never requests previews for invalid drafts (E6)', async () => {
    jest.useFakeTimers()
    renderBuilder()
    // Source selected but no dimensions/metrics — invalid.
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    expect(mockPreview).not.toHaveBeenCalled()
  })

  it('supersedes a pending debounce when the config changes again (E6)', async () => {
    jest.useFakeTimers()
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await act(async () => {})
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Created at as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))
    // Change the config again before the timer fires.
    await act(async () => {
      jest.advanceTimersByTime(150)
    })
    fireEvent.click(screen.getByRole('button', { name: /Add Value as metric/ }))
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(mockPreview).toHaveBeenCalledTimes(1)
    const [config] = mockPreview.mock.calls[0]
    expect(config.metrics).toHaveLength(2)
  })

  it('renders the preview data state with a live region announcement', async () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add Created at as dimension' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Created at as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))
    await waitFor(() => expect(mockPreview).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((s) => s.textContent?.includes('Preview updated')),
      ).toBe(true),
    )
  })

  it('disables Save until the config passes server-equivalent validation (AC 15)', async () => {
    renderBuilder()
    const saveButton = screen.getByRole('button', { name: /Save report/ })
    expect(saveButton).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Stage as dimension' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Stage as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))
    expect(screen.getByRole('button', { name: /Save report/ })).toBeEnabled()
  })

  it('hides the save button without REPORT:CREATE in create mode (S6 — no fake affordance)', () => {
    permissionGrants['REPORT:CREATE'] = false
    renderBuilder()
    expect(screen.queryByRole('button', { name: /Save report/ })).not.toBeInTheDocument()
  })

  it('saves a valid draft: invalidates query keys, toasts and transitions URL to edit mode (AC 11)', async () => {
    const queryClientSpy = jest.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Stage as dimension' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Stage as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))

    fireEvent.click(screen.getByRole('button', { name: /Save report/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Report name'), {
      target: { value: 'Revenue by month' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Create report/ }))

    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    const saveInput = mockSave.mock.calls[0][0]
    expect(saveInput.name).toBe('Revenue by month')
    expect(saveInput.reportId).toBeUndefined()
    expect(saveInput.config.dataSource).toBe('DEALS')

    await waitFor(() =>
      expect(queryClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['customReports'] }),
      ),
    )
    expect(queryClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['salesReports', 'list'] }),
    )
    expect(toast.success).toHaveBeenCalledWith('Report created')
    expect(mockRouterReplace).toHaveBeenCalledWith('/reports/builder?reportId=report-1')
  })

  it('serializes sort rules into the saved config (AC 14)', async () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Stage as dimension' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Stage as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))

    // Open the sort editor and add a rule (default target: the Stage dimension).
    fireEvent.click(screen.getByRole('button', { name: /Add sort rule/ }))
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add sort rule/ }))

    fireEvent.click(screen.getByRole('button', { name: /Save report/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Report name'), {
      target: { value: 'Sorted report' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Create report/ }))

    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    const saveInput = mockSave.mock.calls[0][0]
    expect(saveInput.config.sort).toHaveLength(1)
    expect(saveInput.config.sort[0]).toMatchObject({ direction: 'ASC' })
    // The rule references the selected dimension that was added in the builder.
    expect(saveInput.config.sort[0].targetId).toBe(saveInput.config.dimensions[0].id)
  })

  it('validates the name field inline in the save dialog (RHF + Zod)', async () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Stage as dimension' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Stage as dimension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Deal ID as metric' }))
    fireEvent.click(screen.getByRole('button', { name: /Save report/ }))
    fireEvent.click(screen.getByRole('button', { name: /Create report/ }))
    expect(await screen.findByText(/Report name is required/)).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  describe('edit mode (?reportId=…)', () => {
    it('loads the saved config into the draft and previews it (AC 16)', async () => {
      mockSearchParams = new URLSearchParams('reportId=report-1')
      renderBuilder()
      await waitFor(() => expect(mockGetData).toHaveBeenCalledWith('report-1'))
      // The saved config seeds the draft: catalogue fetched for DEALS and a
      // preview request fires for the restored config.
      await waitFor(() => expect(mockGetCatalog).toHaveBeenCalledWith('DEALS'))
      await waitFor(() => expect(mockPreview).toHaveBeenCalled())
      const [config] = mockPreview.mock.calls[0]
      expect(config.metrics[0].fieldId).toBe('deal.id')
    })

    it('re-saves to the same report id and keeps the URL stable (AC 16)', async () => {
      mockSearchParams = new URLSearchParams('reportId=report-1')
      renderBuilder()
      await waitFor(() => expect(mockGetData).toHaveBeenCalled())
      // The saved config seeds a valid draft, enabling Save.
      await waitFor(() => expect(screen.getByRole('button', { name: /Save report/ })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: /Save report/ }))
      const dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Report name'), {
        target: { value: 'Renamed report' },
      })
      fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }))
      await waitFor(() => expect(mockSave).toHaveBeenCalled())
      const saveInput = mockSave.mock.calls[0][0]
      expect(saveInput.reportId).toBe('report-1')
      expect(mockRouterReplace).not.toHaveBeenCalled()
    })

    it('hides save without REPORT:UPDATE in edit mode (S6)', async () => {
      permissionGrants['REPORT:UPDATE'] = false
      mockSearchParams = new URLSearchParams('reportId=report-1')
      renderBuilder()
      await waitFor(() => expect(mockGetData).toHaveBeenCalled())
      expect(screen.queryByRole('button', { name: /Save report/ })).not.toBeInTheDocument()
    })

    it('enables Schedule button in edit mode and disables in draft mode', async () => {
      mockSearchParams = new URLSearchParams('reportId=report-1')
      renderBuilder()
      await waitFor(() => expect(mockGetData).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /save report/i })).toBeInTheDocument(),
      )
      expect(screen.getByRole('button', { name: /schedule report delivery/i })).toBeEnabled()
    })
  })

  it('shows an error state when the saved report cannot be loaded', async () => {
    mockSearchParams = new URLSearchParams('reportId=report-missing')
    mockGetData.mockRejectedValue(new Error('Report not found'))
    renderBuilder()
    expect(await screen.findByText(/Report not found/)).toBeInTheDocument()
  })
})
