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

describe('ActivityReportsPage filters & interactions', () => {
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
    activitiesByType: [{ type: 'CALL_MADE', count: 50 }],
    activitiesByUser: [
      { userId: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1', count: 70 },
    ],
    activitiesByDate: [{ date: '2026-08-01', count: 10 }],
    heatmap: [{ dayOfWeek: 1, hour: 9, count: 5 }],
    trend: [{ bucketStart: '2026-08-01', count: 10 }],
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

  beforeEach(() => {
    jest.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    ;(permissionHook.useMyPermissions as jest.Mock).mockReturnValue({
      hasPermission: () => true,
      isLoading: false,
      permissions: [],
    })
    ;(ownerService.searchUsers as jest.Mock).mockResolvedValue([
      { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    ])
    ;(teamService.getTeams as jest.Mock).mockResolvedValue([
      { id: 't1', name: 'Alpha Team', memberCount: 1, createdAt: '2026-01-01' },
    ])
    ;(activityReportService.getActivityReport as jest.Mock).mockResolvedValue(mockReportData)
    ;(activityReportService.getActivityGoals as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
  })

  it('allows selecting user, team, activity types, text inputs and resetting filters', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )

    // Wait for user and team options to load into the selects
    expect(await screen.findAllByText('Alice Smith')).not.toHaveLength(0)
    expect(await screen.findAllByText('Alpha Team')).not.toHaveLength(0)

    const userSelect = screen.getByRole('combobox', { name: 'Team Member' })
    fireEvent.change(userSelect, { target: { value: 'u1' } })

    const teamSelect = screen.getByRole('combobox', { name: 'Team' })
    fireEvent.change(teamSelect, { target: { value: 't1' } })

    const contactInput = screen.getByPlaceholderText('Contact UUID')
    fireEvent.change(contactInput, { target: { value: 'c-1' } })

    const dealInput = screen.getByPlaceholderText('Deal UUID')
    fireEvent.change(dealInput, { target: { value: 'd-1' } })

    const teamAlphaComparisonChip = screen.getByRole('button', { name: 'Alpha Team' })
    fireEvent.click(teamAlphaComparisonChip)

    const callMadeChip = screen.getByRole('button', { name: 'Call Made' })
    fireEvent.click(callMadeChip)

    // Toggle on and off
    const emailChip = screen.getByRole('button', { name: 'Email Sent' })
    fireEvent.click(emailChip)
    fireEvent.click(emailChip)

    const applyBtn = screen.getByRole('button', { name: 'Apply Filters' })
    fireEvent.click(applyBtn)

    await waitFor(() => {
      expect(activityReportService.getActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          teamId: 't1',
          comparisonTeamIds: ['t1'],
          contactId: 'c-1',
          dealId: 'd-1',
          activityTypes: ['CALL_MADE'],
        }),
      )
    })

    const resetBtn = screen.getByRole('button', { name: 'Reset Filters' })
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(activityReportService.getActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          teamId: null,
          comparisonTeamIds: null,
          contactId: null,
          dealId: null,
          activityTypes: null,
        }),
      )
    })
  })

  it('allows clicking different leaderboard sort buttons', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )

    const dealsSortBtn = await screen.findByRole('button', { name: 'Deals Closed' })
    fireEvent.click(dealsSortBtn)

    await waitFor(() => {
      expect(activityReportService.getActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'DEALS_CLOSED' }),
      )
    })

    const timeSortBtn = await screen.findByRole('button', { name: 'Time Tracked' })
    fireEvent.click(timeSortBtn)

    await waitFor(() => {
      expect(activityReportService.getActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'TIME_TRACKED' }),
      )
    })

    const activitiesSortBtn = await screen.findByRole('button', { name: 'Activities Logged' })
    fireEvent.click(activitiesSortBtn)

    await waitFor(() => {
      expect(activityReportService.getActivityReport).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'ACTIVITIES' }),
      )
    })
  })

  it('opens create goal dialog when clicking Set Activity Target and supports edit goal', async () => {
    const mockGoal = {
      id: 'g1',
      name: 'Weekly 50 Calls',
      activityType: 'CALL_MADE' as const,
      targetCount: 50,
      period: 'WEEKLY' as const,
      userId: 'u1',
      startsOn: '2026-08-17T00:00:00Z',
      isActive: true,
      createdAt: '2026-08-17T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
      qualifyingCount: 35,
      progress: 0.7,
      progressPercent: 70,
      user: { id: 'u1', firstName: 'Alice', lastName: 'Smith' },
    }

    ;(activityReportService.getActivityGoals as jest.Mock).mockResolvedValue({
      items: [mockGoal],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReportsPage />
      </QueryClientProvider>,
    )

    const setTargetBtn = await screen.findByRole('button', { name: 'Set Activity Target' })
    fireEvent.click(setTargetBtn)

    expect(await screen.findByRole('heading', { name: 'Create Activity Goal' })).toBeInTheDocument()

    // Close modal
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelBtn)

    // Edit button on goal card
    const editBtn = await screen.findByRole('button', { name: 'Edit Weekly 50 Calls' })
    fireEvent.click(editBtn)

    expect(await screen.findByRole('heading', { name: 'Edit Activity Goal' })).toBeInTheDocument()
  })
})
