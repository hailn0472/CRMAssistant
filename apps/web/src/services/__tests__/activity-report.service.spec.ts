import {
  getActivityReport,
  getActivityUserDrillDown,
  getActivityGoals,
  createActivityGoal,
  updateActivityGoal,
  deleteActivityGoal,
  activityReportKeys,
  type ActivityReportFilterInput,
  type ActivityReport,
  type ActivityUserDrillDown,
  type ActivityGoal,
} from '../activity-report.service'
import { graphqlRequest } from '@/lib/graphql-client'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockedGraphqlRequest = graphqlRequest as jest.MockedFunction<typeof graphqlRequest>

describe('activity-report.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('activityReportKeys', () => {
    it('defines distinct child keys for overview, drill-down, and goals', () => {
      const filters: ActivityReportFilterInput = {
        startDate: '2026-08-01',
        endDate: '2026-08-22',
        sortBy: 'ACTIVITIES',
      }

      expect(activityReportKeys.all).toEqual(['activityReport'])
      expect(activityReportKeys.overview(filters)).toEqual(['activityReport', 'overview', filters])
      expect(activityReportKeys.drillDown('u1', filters, { page: 1, pageSize: 20 })).toEqual([
        'activityReport',
        'drillDown',
        'u1',
        filters,
        { page: 1, pageSize: 20 },
      ])
      expect(activityReportKeys.drillDown('u1', filters)).toEqual([
        'activityReport',
        'drillDown',
        'u1',
        filters,
        undefined,
      ])
      expect(activityReportKeys.goals({ activeOnly: true }, { page: 1, pageSize: 10 })).toEqual([
        'activityReport',
        'goals',
        { activeOnly: true },
        { page: 1, pageSize: 10 },
      ])
      expect(activityReportKeys.goals()).toEqual(['activityReport', 'goals', undefined, undefined])
    })
  })

  describe('getActivityReport', () => {
    it('executes activityReport query and unwraps result', async () => {
      const mockReport: ActivityReport = {
        summary: {
          totalActivities: 50,
          unattributedActivities: 0,
          completionRate: 0.85,
          completionRateNumerator: 17,
          completionRateDenominator: 20,
          tasksCompleted: 15,
          avgCompletionTimeHours: 4.2,
          overdueTasks: 2,
          timeTrackedSeconds: 36000,
          meetingsScheduled: 5,
          startDate: '2026-08-01',
          endDate: '2026-08-22',
          calculationNote: '',
        },
        activitiesByType: [{ type: 'CALL_MADE', count: 30 }],
        activitiesByUser: [
          { userId: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1', count: 50 },
        ],
        activitiesByDate: [{ date: '2026-08-01', count: 5 }],
        heatmap: [{ dayOfWeek: 1, hour: 9, count: 3 }],
        trend: [{ bucketStart: '2026-08-01', count: 5 }],
        leaderboard: [
          {
            userId: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            activitiesLogged: 50,
            tasksCompleted: 15,
            dealsClosed: 3,
            timeTrackedSeconds: 36000,
            rank: 1,
          },
        ],
        teamComparison: [
          {
            teamId: 't1',
            teamName: 'Sales Team',
            totalActivities: 50,
            tasksCompleted: 15,
            avgCompletionTimeHours: 4.2,
            overdueTasks: 2,
            timeTrackedSeconds: 36000,
            meetingsScheduled: 5,
            completionRate: 0.85,
          },
        ],
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ activityReport: mockReport })

      const filters: ActivityReportFilterInput = {
        startDate: '2026-08-01',
        endDate: '2026-08-22',
      }

      const res = await getActivityReport(filters)

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ActivityReport'),
        { filters },
      )
      expect(res).toEqual(mockReport)
    })
  })

  describe('getActivityUserDrillDown', () => {
    it('executes activityUserDrillDown query and unwraps result', async () => {
      const mockDrillDown: ActivityUserDrillDown = {
        user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', teamId: 't1' },
        summary: {
          totalActivities: 50,
          unattributedActivities: 0,
          completionRate: 0.85,
          completionRateNumerator: 17,
          completionRateDenominator: 20,
          tasksCompleted: 15,
          avgCompletionTimeHours: 4.2,
          overdueTasks: 2,
          timeTrackedSeconds: 36000,
          meetingsScheduled: 5,
          startDate: '2026-08-01',
          endDate: '2026-08-22',
          calculationNote: '',
        },
        activitiesByType: [{ type: 'CALL_MADE', count: 30 }],
        activitiesByDate: [{ date: '2026-08-01', count: 5 }],
        dealsClosed: 3,
        recentActivities: {
          items: [
            { id: 'a1', type: 'CALL_MADE', title: 'Intro call', createdAt: '2026-08-22T08:00:00Z' },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ activityUserDrillDown: mockDrillDown })

      const filters: ActivityReportFilterInput = {
        startDate: '2026-08-01',
        endDate: '2026-08-22',
      }

      const res = await getActivityUserDrillDown('u1', filters, { page: 1, pageSize: 20 })

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ActivityUserDrillDown'),
        {
          userId: 'u1',
          filters,
          pagination: { page: 1, pageSize: 20 },
        },
      )
      expect(res).toEqual(mockDrillDown)
    })
  })

  describe('goals CRUD', () => {
    it('fetches goals connection', async () => {
      const mockGoal: ActivityGoal = {
        id: 'g1',
        name: '50 calls per week',
        activityType: 'CALL_MADE',
        targetCount: 50,
        period: 'WEEKLY',
        userId: 'u1',
        startsOn: '2026-08-17T00:00:00Z',
        isActive: true,
        createdAt: '2026-08-17T00:00:00Z',
        updatedAt: '2026-08-17T00:00:00Z',
        qualifyingCount: 25,
        progress: 0.5,
        progressPercent: 50,
        user: { id: 'u1', firstName: 'Alice', lastName: 'Smith' },
      }

      mockedGraphqlRequest.mockResolvedValueOnce({
        activityGoals: { items: [mockGoal], total: 1, page: 1, pageSize: 20 },
      })

      const res = await getActivityGoals({ activeOnly: true }, { page: 1, pageSize: 20 })

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query ActivityGoals'),
        {
          filter: { activeOnly: true },
          pagination: { page: 1, pageSize: 20 },
        },
      )
      expect(res.items).toHaveLength(1)
      expect(res.items[0]).toEqual(mockGoal)
    })

    it('creates an activity goal', async () => {
      const input = {
        name: '50 calls per week',
        activityType: 'CALL_MADE' as const,
        targetCount: 50,
        period: 'WEEKLY' as const,
        userId: 'u1',
        startsOn: '2026-08-17T00:00:00Z',
      }

      const mockCreated = {
        id: 'g1',
        ...input,
        isActive: true,
        createdAt: '2026-08-17T00:00:00Z',
        updatedAt: '2026-08-17T00:00:00Z',
        qualifyingCount: 0,
        progress: 0,
        progressPercent: 0,
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ createActivityGoal: mockCreated })

      const res = await createActivityGoal(input)

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation CreateActivityGoal'),
        { input },
      )
      expect(res).toEqual(mockCreated)
    })

    it('updates an activity goal', async () => {
      const updateInput = { targetCount: 60 }
      const mockUpdated = {
        id: 'g1',
        name: '50 calls per week',
        activityType: 'CALL_MADE' as const,
        targetCount: 60,
        period: 'WEEKLY' as const,
        userId: 'u1',
        startsOn: '2026-08-17T00:00:00Z',
        isActive: true,
        createdAt: '2026-08-17T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        qualifyingCount: 30,
        progress: 0.5,
        progressPercent: 50,
      }

      mockedGraphqlRequest.mockResolvedValueOnce({ updateActivityGoal: mockUpdated })

      const res = await updateActivityGoal('g1', updateInput)

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation UpdateActivityGoal'),
        { id: 'g1', input: updateInput },
      )
      expect(res).toEqual(mockUpdated)
    })

    it('deletes an activity goal', async () => {
      mockedGraphqlRequest.mockResolvedValueOnce({ deleteActivityGoal: true })

      const res = await deleteActivityGoal('g1')

      expect(mockedGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation DeleteActivityGoal'),
        { id: 'g1' },
      )
      expect(res).toBe(true)
    })
  })
})
