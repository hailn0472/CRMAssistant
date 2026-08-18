/**
 * Story 6.5 — ReportSchedulesPage RTL tests (TDD RED phase).
 * Tests loading, error, empty state, schedules list display, format badges,
 * active/paused switch toggle, row actions (Edit, Pause, Resume, Delete with confirmation),
 * localized next run time with <time dateTime>, last execution status, and responsive layout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

import { ReportSchedulesPage } from '../ReportSchedulesPage'
import * as scheduleService from '@/services/report-schedule.service'
import type { ReportSchedule } from '@/services/report-schedule.service'

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    hasPermission: () => true,
    isLoading: false,
    permissions: [],
  }),
}))

jest.mock('@/services/report-schedule.service', () => {
  const actual = jest.requireActual('@/services/report-schedule.service')
  return {
    ...actual,
    getReportSchedules: jest.fn(),
    deleteSchedule: jest.fn(),
    pauseSchedule: jest.fn(),
    resumeSchedule: jest.fn(),
  }
})

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockGetReportSchedules = scheduleService.getReportSchedules as jest.Mock
const mockDeleteSchedule = scheduleService.deleteSchedule as jest.Mock
const mockPauseSchedule = scheduleService.pauseSchedule as jest.Mock
const mockResumeSchedule = scheduleService.resumeSchedule as jest.Mock

const SAMPLE_SCHEDULES: ReportSchedule[] = [
  {
    id: 'sched-1',
    reportId: 'rep-1',
    report: { id: 'rep-1', name: 'Executive Sales Overview', type: 'SALES_OVERVIEW' },
    frequency: 'WEEKLY',
    recipients: ['alex@acme.corp', 'sarah@acme.corp', 'finance@acme.corp'],
    format: 'PDF',
    timezone: 'UTC',
    scheduledTime: '08:00',
    dayOfWeek: 1,
    dayOfMonth: null,
    startMonth: null,
    cronExpression: null,
    nextRunAt: '2026-08-24T08:00:00.000Z',
    lastRunAt: '2026-08-17T08:00:00.000Z',
    isActive: true,
    lastExecution: {
      id: 'exec-1',
      status: 'SUCCESS',
      scheduledFor: '2026-08-17T08:00:00.000Z',
      attemptCount: 1,
      nextRetryAt: null,
      completedAt: '2026-08-17T08:00:01.000Z',
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-17T08:00:00.000Z',
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'sched-2',
    reportId: 'rep-2',
    report: { id: 'rep-2', name: 'Q3 Deals Pipeline & Win-Loss', type: 'CUSTOM' },
    frequency: 'MONTHLY',
    recipients: ['vp@acme.corp'],
    format: 'EXCEL',
    timezone: 'UTC',
    scheduledTime: '09:00',
    dayOfWeek: null,
    dayOfMonth: 1,
    startMonth: null,
    cronExpression: null,
    nextRunAt: '2026-09-01T09:00:00.000Z',
    lastRunAt: null,
    isActive: false, // Paused
    lastExecution: {
      id: 'exec-2',
      status: 'SKIPPED',
      scheduledFor: '2026-08-01T09:00:00.000Z',
      attemptCount: 1,
      nextRetryAt: null,
      completedAt: null,
      errorCode: 'SCHEDULE_PAUSED',
      errorMessage: 'Schedule is paused',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'sched-3',
    reportId: 'rep-3',
    report: { id: 'rep-3', name: 'Daily Sales Velocity', type: 'SALES_OVERVIEW' },
    frequency: 'CUSTOM_CRON',
    recipients: ['admin@acme.corp'],
    format: 'CSV',
    timezone: 'UTC',
    scheduledTime: '07:00',
    dayOfWeek: null,
    dayOfMonth: null,
    startMonth: null,
    cronExpression: '0 7 * * 1-5',
    nextRunAt: '2026-08-19T07:00:00.000Z',
    lastRunAt: '2026-08-18T07:00:00.000Z',
    isActive: true,
    lastExecution: {
      id: 'exec-3',
      status: 'FAILED',
      scheduledFor: '2026-08-18T07:00:00.000Z',
      attemptCount: 4,
      nextRetryAt: null,
      completedAt: '2026-08-18T07:07:00.000Z',
      errorCode: 'SMTP_TIMEOUT',
      errorMessage: 'SMTP connection timed out',
      createdAt: '2026-08-18T07:00:00.000Z',
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
]

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ReportSchedulesPage />
      </QueryClientProvider>,
    ),
    queryClient,
  }
}

describe('ReportSchedulesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders loading state initially', () => {
    mockGetReportSchedules.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('schedules-loading-skeleton')).toBeInTheDocument()
  })

  it('renders error state when query fails', async () => {
    mockGetReportSchedules.mockRejectedValue(new Error('Network error'))
    renderPage()
    expect(await screen.findByText(/network error/i)).toBeInTheDocument()
  })

  it('renders empty state when there are no scheduled reports', async () => {
    mockGetReportSchedules.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    renderPage()
    expect(await screen.findByText(/no scheduled report deliveries yet/i)).toBeInTheDocument()
  })

  it('renders table with scheduled reports, badges, formatted times and executions', async () => {
    mockGetReportSchedules.mockResolvedValue({
      items: SAMPLE_SCHEDULES,
      total: 3,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    expect(await screen.findByText('Executive Sales Overview')).toBeInTheDocument()
    expect(screen.getByText('Q3 Deals Pipeline & Win-Loss')).toBeInTheDocument()
    expect(screen.getByText('Daily Sales Velocity')).toBeInTheDocument()

    // Format badges
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('EXCEL')).toBeInTheDocument()
    expect(screen.getByText('CSV')).toBeInTheDocument()

    // Execution statuses
    expect(screen.getByText(/SUCCESS/i)).toBeInTheDocument()
    expect(screen.getByText(/SKIPPED/i)).toBeInTheDocument()
    expect(screen.getByText(/FAILED/i)).toBeInTheDocument()

    // Next run <time dateTime="..."> check
    const timeEls = screen.getAllByRole('time')
    expect(timeEls.length).toBeGreaterThan(0)
    expect(timeEls[0]).toHaveAttribute('dateTime', '2026-08-24T08:00:00.000Z')
  })

  it('toggles pause and resume with mutation call', async () => {
    const user = userEvent.setup()
    mockGetReportSchedules.mockResolvedValue({
      items: SAMPLE_SCHEDULES,
      total: 3,
      page: 1,
      pageSize: 20,
    })
    mockPauseSchedule.mockResolvedValue({ ...SAMPLE_SCHEDULES[0], isActive: false })
    mockResumeSchedule.mockResolvedValue({ ...SAMPLE_SCHEDULES[1], isActive: true })

    renderPage()
    await screen.findByText('Executive Sales Overview')

    // Find switches
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(3)

    // First is active (true), click to pause
    await user.click(switches[0])
    expect(mockPauseSchedule).toHaveBeenCalledWith('sched-1')

    // Second is paused (false), click to resume
    await user.click(switches[1])
    expect(mockResumeSchedule).toHaveBeenCalledWith('sched-2')
  })

  it('handles delete action with confirmation dialog', async () => {
    const user = userEvent.setup()
    mockGetReportSchedules.mockResolvedValue({
      items: SAMPLE_SCHEDULES,
      total: 3,
      page: 1,
      pageSize: 20,
    })
    mockDeleteSchedule.mockResolvedValue(true)

    renderPage()
    await screen.findByText('Executive Sales Overview')

    // Click delete on first row
    const deleteBtn = screen.getByRole('button', {
      name: /delete executive sales overview schedule/i,
    })
    await user.click(deleteBtn)

    // Confirm dialog appears
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/are you sure you want to delete this schedule/i)).toBeInTheDocument()

    // Click confirm delete
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i })
    await user.click(confirmBtn)

    expect(mockDeleteSchedule).toHaveBeenCalledWith('sched-1')
  })

  it('handles pagination controls and navigates pages (AA-2)', async () => {
    const user = userEvent.setup()
    mockGetReportSchedules.mockResolvedValue({
      items: SAMPLE_SCHEDULES,
      total: 45,
      page: 1,
      pageSize: 20,
    })

    renderPage()
    expect(await screen.findByText('Executive Sales Overview')).toBeInTheDocument()

    // Page indicator
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument()

    const prevBtn = screen.getByRole('button', { name: /previous page/i })
    const nextBtn = screen.getByRole('button', { name: /next page/i })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).toBeEnabled()

    mockGetReportSchedules.mockResolvedValue({
      items: SAMPLE_SCHEDULES,
      total: 45,
      page: 2,
      pageSize: 20,
    })

    await user.click(nextBtn)
    expect(mockGetReportSchedules).toHaveBeenCalledWith({ page: 2, pageSize: 20 }, true)
  })
})
