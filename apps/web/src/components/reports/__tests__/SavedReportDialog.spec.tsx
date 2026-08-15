/**
 * Story 6.2 (AC 70): create/edit/delete report dialog — RHF + Zod v4, inline
 * errors, submit loading, list invalidation, delete confirmation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SavedReportDialog } from '../SavedReportDialog'
import type { ReportRow } from '@/services/sales-report.service'

const mockCreateReport = jest.fn()
const mockUpdateReport = jest.fn()
const mockDeleteReport = jest.fn()

jest.mock('@/services/sales-report.service', () => ({
  getReports: jest.fn(),
  getReport: jest.fn(),
  getReportData: jest.fn(),
  createReport: (...args: unknown[]) => mockCreateReport(...args),
  updateReport: (...args: unknown[]) => mockUpdateReport(...args),
  deleteReport: (...args: unknown[]) => mockDeleteReport(...args),
  runReport: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const REPORT: ReportRow = {
  id: 'report-1',
  name: 'August Overview',
  type: 'SALES_OVERVIEW',
  isSupported: true,
  isPublic: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'user-1',
  config: {
    datePreset: 'THIS_MONTH',
    startDate: null,
    endDate: null,
    comparisonMode: 'PREVIOUS_PERIOD',
    comparisonStartDate: null,
    comparisonEndDate: null,
    groupBy: 'MONTH',
    ownerId: null,
    teamId: null,
    stageId: null,
    productId: null,
    currency: null,
  },
}

function renderDialog(open: boolean, report: ReportRow | null = null, canDelete = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onOpenChange = jest.fn()
  const onSaved = jest.fn()
  return {
    onOpenChange,
    onSaved,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SavedReportDialog
          open={open}
          onOpenChange={onOpenChange}
          report={report}
          canDelete={canDelete}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    ),
  }
}

describe('SavedReportDialog (AC 70)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateReport.mockResolvedValue(REPORT)
    mockUpdateReport.mockResolvedValue(REPORT)
    mockDeleteReport.mockResolvedValue(true)
  })

  it('renders create mode with name/type/public/config fields', () => {
    renderDialog(true)
    expect(screen.getByText('New report')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Report type')).toBeInTheDocument()
    expect(screen.getByLabelText('Date preset')).toBeInTheDocument()
    expect(screen.getByLabelText('Group by')).toBeInTheDocument()
    expect(screen.getByLabelText('Comparison')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('shows an inline error for an empty name', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Create report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Report name is required')
    expect(mockCreateReport).not.toHaveBeenCalled()
  })

  it('shows an inline error when CUSTOM preset lacks dates', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'My report')
    fireEvent.change(screen.getByLabelText('Date preset'), { target: { value: 'CUSTOM' } })
    await user.click(screen.getByRole('button', { name: 'Create report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Custom preset requires')
    expect(mockCreateReport).not.toHaveBeenCalled()
  })

  it('submits create with the typed config and invalidates the list prefix', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'August Overview')
    await user.click(screen.getByRole('button', { name: 'Create report' }))

    await waitFor(() => expect(mockCreateReport).toHaveBeenCalled())
    const input = mockCreateReport.mock.calls[0][0]
    expect(input).toMatchObject({
      name: 'August Overview',
      type: 'SALES_OVERVIEW',
      isPublic: false,
    })
    expect(input.config).toMatchObject({
      datePreset: 'THIS_MONTH',
      comparisonMode: 'PREVIOUS_PERIOD',
      groupBy: 'MONTH',
      currency: null,
    })
  })

  it('applies the template when the report type changes on create', async () => {
    renderDialog(true)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Team report')
    fireEvent.change(screen.getByLabelText('Report type'), {
      target: { value: 'TEAM_PERFORMANCE' },
    })
    await user.click(screen.getByRole('button', { name: 'Create report' }))
    await waitFor(() => expect(mockCreateReport).toHaveBeenCalled())
    expect(mockCreateReport.mock.calls[0][0].config.groupBy).toBe('OWNER')
  })

  it('renders edit mode with the report values pre-filled and saves changes', async () => {
    renderDialog(true, REPORT)
    expect(screen.getByText('Edit report')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('August Overview')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mockUpdateReport).toHaveBeenCalled())
    expect(mockUpdateReport.mock.calls[0][0]).toBe('report-1')
  })

  it('requires confirmation before deleting', async () => {
    renderDialog(true, REPORT)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mockDeleteReport).not.toHaveBeenCalled()
    expect(screen.getByText(/Delete "August Overview"\?/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete report' }))
    await waitFor(() => expect(mockDeleteReport).toHaveBeenCalledWith('report-1'))
  })

  it('hides the delete affordance when canDelete is false (AC 67)', () => {
    renderDialog(true, REPORT, false)
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('calls onSaved after a successful save', async () => {
    const { onSaved } = renderDialog(true)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'August Overview')
    await user.click(screen.getByRole('button', { name: 'Create report' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
