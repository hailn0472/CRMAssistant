import { render, screen } from '@testing-library/react'
import { ActivityReportsPage } from '../ActivityReportsPage'
import * as activityReportService from '@/services/activity-report.service'
import * as permissionHook from '@/hooks/usePermission'

jest.mock('@/services/activity-report.service', () => ({
  ...jest.requireActual('@/services/activity-report.service'),
  getActivityReport: jest.fn(),
  getActivityGoals: jest.fn(),
  getActivityUserDrillDown: jest.fn(),
  deleteActivityGoal: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: jest.fn(),
}))

jest.mock('@/components/reports/charting/ReportChart', () => ({
  ReportChart: () => <div data-testid="mock-report-chart">Chart</div>,
}))

describe('ActivityReportsPage branches & empty states', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(permissionHook.useMyPermissions as jest.Mock).mockReturnValue({
      hasPermission: () => true,
      isLoading: false,
      permissions: [],
    })
  })

  it('renders error state when query fails', async () => {
    const queryClient = new (require('@tanstack/react-query').QueryClient)({
      defaultOptions: { queries: { retry: false } },
    })
    ;(activityReportService.getActivityReport as jest.Mock).mockRejectedValue(
      new Error('Database timeout error'),
    )
    ;(activityReportService.getActivityGoals as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    const { QueryClientProvider } = require('@tanstack/react-query')
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Could not load activity report')).toBeInTheDocument()
    expect(screen.getByText('Database timeout error')).toBeInTheDocument()
  })

  it('renders empty state when totalActivities is 0', async () => {
    const queryClient = new (require('@tanstack/react-query').QueryClient)({
      defaultOptions: { queries: { retry: false } },
    })
    ;(activityReportService.getActivityReport as jest.Mock).mockResolvedValue({
      summary: {
        totalActivities: 0,
        unattributedActivities: 0,
        completionRate: 0,
        completionRateNumerator: 0,
        completionRateDenominator: 0,
        tasksCompleted: 0,
        avgCompletionTimeHours: 0,
        overdueTasks: 0,
        timeTrackedSeconds: 0,
        meetingsScheduled: 0,
        startDate: '2026-08-01',
        endDate: '2026-08-22',
        calculationNote: '',
      },
      activitiesByType: [],
      activitiesByUser: [],
      activitiesByDate: [],
      heatmap: [],
      trend: [],
      leaderboard: [],
      teamComparison: [],
    })
    ;(activityReportService.getActivityGoals as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    const { QueryClientProvider } = require('@tanstack/react-query')
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('No activities found')).toBeInTheDocument()
  })
})
