/**
 * Story 6.5 — ScheduleReportDialog RTL unit tests (TDD RED phase).
 * Tests create and edit mode, frequency selection, conditional fields, recipient add/remove,
 * format selection, next run preview, and mutation execution with query invalidation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

import { ScheduleReportDialog } from '../ScheduleReportDialog'
import * as scheduleService from '@/services/report-schedule.service'
import type { ReportSchedule } from '@/services/report-schedule.service'

jest.mock('@/services/report-schedule.service', () => {
  const actual = jest.requireActual('@/services/report-schedule.service')
  return {
    ...actual,
    scheduleReport: jest.fn(),
    updateSchedule: jest.fn(),
  }
})

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockScheduleReport = scheduleService.scheduleReport as jest.Mock
const mockUpdateSchedule = scheduleService.updateSchedule as jest.Mock

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderDialog(props: React.ComponentProps<typeof ScheduleReportDialog>) {
  const queryClient = createTestQueryClient()
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ScheduleReportDialog {...props} />
      </QueryClientProvider>,
    ),
    queryClient,
  }
}

const SAMPLE_SCHEDULE: ReportSchedule = {
  id: 'sched-100',
  reportId: 'rep-100',
  report: {
    id: 'rep-100',
    name: 'Executive Sales Overview',
    type: 'SALES_OVERVIEW',
  },
  frequency: 'WEEKLY',
  recipients: ['alex@acme.corp', 'sarah@acme.corp'],
  format: 'PDF',
  timezone: 'UTC',
  scheduledTime: '08:00',
  dayOfWeek: 1,
  dayOfMonth: null,
  startMonth: null,
  cronExpression: null,
  nextRunAt: '2026-08-24T08:00:00.000Z',
  lastRunAt: null,
  isActive: true,
  lastExecution: null,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
}

describe('ScheduleReportDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders create dialog with report name and default fields', () => {
    renderDialog({
      open: true,
      onOpenChange: jest.fn(),
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
      reportType: 'SALES_OVERVIEW',
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /schedule report delivery/i })).toBeInTheDocument()
    expect(screen.getByText('Executive Sales Overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create schedule/i })).toBeInTheDocument()
  })

  it('allows adding and removing recipient emails with validation', async () => {
    const user = userEvent.setup()
    renderDialog({
      open: true,
      onOpenChange: jest.fn(),
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
    })

    const emailInput = screen.getByPlaceholderText(/colleague@acme.corp/i)
    const addBtn = screen.getByRole('button', { name: /^add$/i })

    // Add invalid email
    await user.type(emailInput, 'invalid-email')
    await user.click(addBtn)
    expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument()

    // Add valid email
    await user.clear(emailInput)
    await user.type(emailInput, 'test@acme.corp')
    await user.click(addBtn)

    expect(screen.queryByText(/please enter a valid email address/i)).not.toBeInTheDocument()
    expect(screen.getByText('test@acme.corp')).toBeInTheDocument()

    // Deduplication check
    await user.type(emailInput, 'test@acme.corp')
    await user.click(addBtn)
    expect(screen.getByText(/already added/i)).toBeInTheDocument()

    // Remove recipient
    const removeBtn = screen.getByRole('button', { name: /remove test@acme.corp/i })
    await user.click(removeBtn)
    expect(screen.queryByText('test@acme.corp')).not.toBeInTheDocument()
  })

  it('switches frequencies and reveals conditional cadence inputs', async () => {
    const user = userEvent.setup()
    renderDialog({
      open: true,
      onOpenChange: jest.fn(),
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
    })

    // Initially DAILY: no weekday/month inputs
    expect(screen.queryByText(/day of week/i)).not.toBeInTheDocument()

    // Switch to WEEKLY
    await user.click(screen.getByRole('button', { name: /^weekly$/i }))
    expect(screen.getByText(/day of week/i)).toBeInTheDocument()

    // Switch to MONTHLY
    await user.click(screen.getByRole('button', { name: /^monthly$/i }))
    expect(screen.getByText(/day of month/i)).toBeInTheDocument()

    // Switch to QUARTERLY
    await user.click(screen.getByRole('button', { name: /^quarterly$/i }))
    expect(screen.getByText(/quarter cycle/i)).toBeInTheDocument()

    // Switch to CUSTOM_CRON
    await user.click(screen.getByRole('button', { name: /^cron$/i }))
    expect(screen.getByPlaceholderText(/e\.g\. 0 8 \* \* 1-5/i)).toBeInTheDocument()
  })

  it('sets aria-pressed="true" on selected frequency and day-of-week pills (AA-3)', async () => {
    const user = userEvent.setup()
    renderDialog({
      open: true,
      onOpenChange: jest.fn(),
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
    })

    // Frequency pills: DAILY is default selected
    const dailyBtn = screen.getByRole('button', { name: /^daily$/i })
    const weeklyBtn = screen.getByRole('button', { name: /^weekly$/i })

    expect(dailyBtn).toHaveAttribute('aria-pressed', 'true')
    expect(weeklyBtn).toHaveAttribute('aria-pressed', 'false')

    // Click WEEKLY
    await user.click(weeklyBtn)
    expect(dailyBtn).toHaveAttribute('aria-pressed', 'false')
    expect(weeklyBtn).toHaveAttribute('aria-pressed', 'true')

    // Day of week pills: Monday (Mon) is default (1)
    const monBtn = screen.getByRole('button', { name: /^mon$/i })
    const tueBtn = screen.getByRole('button', { name: /^tue$/i })

    expect(monBtn).toHaveAttribute('aria-pressed', 'true')
    expect(tueBtn).toHaveAttribute('aria-pressed', 'false')

    await user.click(tueBtn)
    expect(monBtn).toHaveAttribute('aria-pressed', 'false')
    expect(tueBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('submits a valid create schedule and invalidates query cache', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()
    mockScheduleReport.mockResolvedValue(SAMPLE_SCHEDULE)

    const { queryClient } = renderDialog({
      open: true,
      onOpenChange,
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
    })

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    // Add recipient
    const emailInput = screen.getByPlaceholderText(/colleague@acme.corp/i)
    await user.type(emailInput, 'alex@acme.corp')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    // Click submit
    await user.click(screen.getByRole('button', { name: /create schedule/i }))

    await waitFor(() => {
      expect(mockScheduleReport).toHaveBeenCalledWith({
        reportId: 'rep-100',
        frequency: 'DAILY',
        recipients: ['alex@acme.corp'],
        format: 'PDF',
        timezone: expect.any(String),
        scheduledTime: '08:00',
        dayOfWeek: 1,
        dayOfMonth: 1,
        startMonth: 1,
        cronExpression: '0 8 * * 1-5',
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reportSchedules'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('populates existing schedule values in edit mode and calls updateSchedule', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()
    mockUpdateSchedule.mockResolvedValue({ ...SAMPLE_SCHEDULE, scheduledTime: '09:00' })

    renderDialog({
      open: true,
      onOpenChange,
      reportId: 'rep-100',
      reportName: 'Executive Sales Overview',
      schedule: SAMPLE_SCHEDULE,
    })

    expect(screen.getByRole('heading', { name: /edit report schedule/i })).toBeInTheDocument()
    expect(screen.getByText('alex@acme.corp')).toBeInTheDocument()
    expect(screen.getByText('sarah@acme.corp')).toBeInTheDocument()

    // Change scheduled time
    const timeInput = screen.getByLabelText(/delivery time/i)
    fireEvent.change(timeInput, { target: { value: '09:00' } })

    // Save changes
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        'sched-100',
        expect.objectContaining({
          frequency: 'WEEKLY',
          recipients: ['alex@acme.corp', 'sarah@acme.corp'],
          format: 'PDF',
          scheduledTime: '09:00',
        }),
      )
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
