import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActivityReportsPage } from '../ActivityReportsPage'
import * as activityReportService from '@/services/activity-report.service'
import * as ownerService from '@/services/owner.service'
import * as teamService from '@/services/team.service'
import * as permissionHook from '@/hooks/usePermission'

jest.mock('@/services/activity-report.service', () => ({
  ...jest.requireActual('@/services/activity-report.service'),
  getActivityReport: jest.fn(),
  getActivityGoals: jest.fn(),
  getActivityUserDrillDown: jest.fn(),
  deleteActivityGoal: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn(),
}))

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: jest.fn(),
}))

// Recharts element-form tooltip / chart mock
jest.mock('@/components/reports/charting/ReportChart', () => ({
  ReportChart: ({ chart }: { chart: { title: string } }) => (
    <div data-testid="mock-report-chart">{chart.title}</div>
  ),
}))

const mockedGetActivityReport = activityReportService.getActivityReport as jest.MockedFunction<
  typeof activityReportService.getActivityReport
>
const mockedGetActivityGoals = activityReportService.getActivityGoals as jest.MockedFunction<
  typeof activityReportService.getActivityGoals
>
const mockedGetDrillDown = activityReportService.getActivityUserDrillDown as jest.MockedFunction<
  typeof activityReportService.getActivityUserDrillDown
>
const mockedDeleteGoal = activityReportService.deleteActivityGoal as jest.MockedFunction<
  typeof activityReportService.deleteActivityGoal
>
const mockedSearchUsers = ownerService.searchUsers as jest.MockedFunction<
  typeof ownerService.searchUsers
>
const mockedGetTeams = teamService.getTeams as jest.MockedFunction<typeof teamService.getTeams>
const mockedUseMyPermissions = permissionHook.useMyPermissions as jest.MockedFunction<
  typeof permissionHook.useMyPermissions
>

describe('ActivityReportsPage', () => {
  let queryClient: QueryClient

  const mockReportData: activityReportService.ActivityReport = {
    summary: {
      totalActivities: 120,
      unattributedActivities: 5,
      completionRate: 0.85,
      completionRateNumerator: 17,
      completionRateDenominator: 20,
      tasksCompleted: 45,
      avgCompletionTimeHours: 3.5,
      overdueTasks: 4,
      timeTrackedSeconds: 72000,
      meetingsScheduled: 12,
      startDate: '2026-08-01',
      endDate: '2026-08-22',
      calculationNote: 'Test note',
    },
    activitiesByType: [
      { type: 'CALL_MADE', count: 50 },
      { type: 'EMAIL_SENT', count: 40 },
    ],
    activitiesByUser: [
      { userId: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1', count: 70 },
      { userId: 'u2', firstName: 'Bob', lastName: 'Jones', teamId: 't1', count: 50 },
    ],
    activitiesByDate: [
      { date: '2026-08-01', count: 10 },
      { date: '2026-08-02', count: 15 },
    ],
    heatmap: [
      { dayOfWeek: 1, hour: 9, count: 5 },
      { dayOfWeek: 2, hour: 14, count: 8 },
    ],
    trend: [
      { bucketStart: '2026-08-01', count: 10 },
      { bucketStart: '2026-08-02', count: 15 },
    ],
    leaderboard: [
      {
        userId: 'u1',
        firstName: 'Alice',
        lastName: 'Smith',
        teamId: 't1',
        activitiesLogged: 70,
        tasksCompleted: 25,
        dealsClosed: 4,
        timeTrackedSeconds: 40000,
        rank: 1,
      },
      {
        userId: 'u2',
        firstName: 'Bob',
        lastName: 'Jones',
        teamId: 't1',
        activitiesLogged: 50,
        tasksCompleted: 20,
        dealsClosed: 2,
        timeTrackedSeconds: 32000,
        rank: 2,
      },
    ],
    teamComparison: [
      {
        teamId: 't1',
        teamName: 'Alpha Team',
        totalActivities: 120,
        tasksCompleted: 45,
        avgCompletionTimeHours: 3.5,
        overdueTasks: 4,
        timeTrackedSeconds: 72000,
        meetingsScheduled: 12,
        completionRate: 0.85,
      },
    ],
  }

  const mockGoalsData: activityReportService.ActivityGoalConnection = {
    items: [
      {
        id: 'g1',
        name: 'Weekly 50 Calls',
        activityType: 'CALL_MADE',
        targetCount: 50,
        period: 'WEEKLY',
        userId: 'u1',
        startsOn: '2026-08-17T00:00:00Z',
        isActive: true,
        createdAt: '2026-08-17T00:00:00Z',
        updatedAt: '2026-08-17T00:00:00Z',
        qualifyingCount: 35,
        progress: 0.7,
        progressPercent: 70,
        user: { id: 'u1', firstName: 'Alice', lastName: 'Smith' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    mockedUseMyPermissions.mockReturnValue({
      hasPermission: () => true,
      isLoading: false,
      permissions: [],
    })

    mockedSearchUsers.mockResolvedValue([
      { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
      { id: 'u2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
    ])

    mockedGetTeams.mockResolvedValue([
      { id: 't1', name: 'Alpha Team', memberCount: 2, createdAt: '2026-01-01' },
    ])

    mockedGetActivityReport.mockResolvedValue(mockReportData)
    mockedGetActivityGoals.mockResolvedValue(mockGoalsData)
  })

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )
  }

  it('renders loading skeleton while permissions are loading', () => {
    mockedUseMyPermissions.mockReturnValue({
      hasPermission: () => false,
      isLoading: true,
      permissions: [],
    })

    renderPage()
    expect(screen.getByTestId('activity-report-loading-skeleton')).toBeInTheDocument()
  })

  it('renders permission denied state when user lacks required read permissions', () => {
    mockedUseMyPermissions.mockReturnValue({
      hasPermission: (resource) => resource !== 'REPORT',
      isLoading: false,
      permissions: [],
    })

    renderPage()
    expect(screen.getByText('Truy cập bị giới hạn quyền')).toBeInTheDocument()
  })

  it('renders dashboard with 7 metric cards, goals, heatmap, leaderboard, and team comparison', async () => {
    renderPage()

    // 7 KPI metric cards
    expect(await screen.findByText('Total Activities')).toBeInTheDocument()
    expect(screen.getAllByText('120').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Completion Rate')).toBeInTheDocument()
    expect(screen.getAllByText('85.0%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Tasks Completed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('45').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Avg Completion Time').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('3.5h').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Overdue Tasks').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Time Tracked').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('20h').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Meetings Scheduled').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1)

    // Goal progress
    expect(screen.getByText('Weekly 50 Calls')).toBeInTheDocument()
    expect(screen.getByText('35 / 50')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()

    // Heatmap
    expect(
      screen.getByRole('img', { name: /Activity heatmap showing volume distribution/i }),
    ).toBeInTheDocument()

    // Trend chart
    expect(screen.getByTestId('mock-report-chart')).toBeInTheDocument()

    // Leaderboard
    expect(screen.getByText('Top Performers Leaderboard')).toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-row-u1')).toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-row-u2')).toBeInTheDocument()

    // Team comparison
    expect(screen.getByText('Team Comparison')).toBeInTheDocument()
    expect(screen.getByTestId('team-card-t1')).toBeInTheDocument()
  })

  it('handles user drill-down interaction', async () => {
    const mockDrillDownData: activityReportService.ActivityUserDrillDown = {
      user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1' },
      summary: mockReportData.summary,
      activitiesByType: mockReportData.activitiesByType,
      activitiesByDate: mockReportData.activitiesByDate,
      dealsClosed: 4,
      recentActivities: {
        items: [
          {
            id: 'act-1',
            type: 'CALL_MADE',
            title: 'Intro discovery call',
            createdAt: '2026-08-22T08:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    }

    mockedGetDrillDown.mockResolvedValue(mockDrillDownData)

    renderPage()

    const drillDownBtn = await screen.findByRole('button', {
      name: 'View drill-down for Alice Smith',
    })
    fireEvent.click(drillDownBtn)

    expect(await screen.findByTestId('drill-down-panel')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: /Individual Performance Drill-Down/i }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Intro discovery call')).toBeInTheDocument()

    // Close panel
    const closeBtn = screen.getByRole('button', { name: 'Close drill-down' })
    fireEvent.click(closeBtn)

    expect(screen.queryByTestId('drill-down-panel')).not.toBeInTheDocument()
  })

  it('allows changing leaderboard sort column', async () => {
    renderPage()

    const tasksCompletedSortBtn = await screen.findByRole('button', { name: 'Tasks Completed' })
    fireEvent.click(tasksCompletedSortBtn)

    await waitFor(() => {
      expect(mockedGetActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'TASKS_COMPLETED',
        }),
      )
    })
  })

  it('validates filter range and blocks invalid dates inline', async () => {
    renderPage()

    const startDateInput = screen.getByLabelText(/Start Date/i)
    const endDateInput = screen.getByLabelText(/End Date/i)

    fireEvent.change(startDateInput, { target: { value: '2026-08-22' } })
    fireEvent.change(endDateInput, { target: { value: '2026-08-01' } })

    const applyBtn = screen.getByRole('button', { name: 'Apply Filters' })
    fireEvent.click(applyBtn)

    expect(
      await screen.findByText('End date must be greater than or equal to start date.'),
    ).toBeInTheDocument()
  })

  it('handles goal deletion confirmation modal and action', async () => {
    mockedDeleteGoal.mockResolvedValueOnce(true)

    renderPage()

    const deleteBtn = await screen.findByRole('button', { name: 'Delete Weekly 50 Calls' })
    fireEvent.click(deleteBtn)

    expect(screen.getByRole('heading', { name: 'Delete Activity Goal' })).toBeInTheDocument()

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete Goal' })
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(mockedDeleteGoal).toHaveBeenCalledWith('g1')
    })
  })

  it('renders error state when user drill-down fails and retries on click', async () => {
    mockedGetDrillDown.mockRejectedValueOnce(new Error('Drill-down network error'))

    renderPage()

    const drillDownBtn = await screen.findByRole('button', {
      name: 'View drill-down for Alice Smith',
    })
    fireEvent.click(drillDownBtn)

    expect(await screen.findByText('Could not load drill-down data')).toBeInTheDocument()
    expect(screen.getByText('Drill-down network error')).toBeInTheDocument()

    // Retry action
    const mockDrillDownData: activityReportService.ActivityUserDrillDown = {
      user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1' },
      summary: mockReportData.summary,
      activitiesByType: mockReportData.activitiesByType,
      activitiesByDate: mockReportData.activitiesByDate,
      dealsClosed: 4,
      recentActivities: {
        items: [
          {
            id: 'act-1',
            type: 'CALL_MADE',
            title: 'Intro discovery call',
            createdAt: '2026-08-22T08:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    }
    mockedGetDrillDown.mockResolvedValueOnce(mockDrillDownData)

    const retryBtn = screen.getByRole('button', { name: /Try again/i })
    fireEvent.click(retryBtn)

    expect(await screen.findByText('Intro discovery call')).toBeInTheDocument()
  })

  it('renders goal edit and delete buttons with at least 44px min dimensions', async () => {
    renderPage()

    const editBtn = await screen.findByRole('button', { name: 'Edit Weekly 50 Calls' })
    const deleteBtn = await screen.findByRole('button', { name: 'Delete Weekly 50 Calls' })

    expect(editBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]')
    expect(deleteBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]')
  })
})
