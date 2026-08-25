/**
 * Story 6.8 (Contract C9-C16, D17, E30, F33, R-010/R-011): activity report +
 * goals schema surface. Asserts after registerActivityReportsGraphql +
 * builder.toSchema() that the queries/mutations, enums, closed inputs and
 * every result field exist (module/barrel/ref lockstep), that the typed
 * permission gates fire, and that ActivityType is a single reused enum
 * (never registered twice).
 */
import { ForbiddenException } from '@nestjs/common'
import { graphql, printSchema } from 'graphql'

// Must import BEFORE schema (Pothos registration order — R-010).
import '../activity-reports.graphql'
import { schema } from '../../graphql/schema'
import { registerActivityReportsGraphql } from '../activity-reports.graphql'
import { registerReportExportsGraphql } from '../report-exports.graphql'
import { requirePermission } from '../../common/guards/permission-check'
import type { ActivityReportsService } from '../activity-reports.service'
import type { ActivityGoalsService } from '../activity-goals.service'

jest.mock('../../common/guards/permission-check', () => ({
  requirePermission: jest.fn(),
}))

const mockRequirePermission = requirePermission as jest.Mock

const mockActivityReport = {
  summary: {
    totalActivities: 5,
    unattributedActivities: 0,
    completionRate: 0.75,
    completionRateNumerator: 3,
    completionRateDenominator: 4,
    tasksCompleted: 2,
    avgCompletionTimeHours: 3,
    overdueTasks: 1,
    timeTrackedSeconds: 7200,
    meetingsScheduled: 1,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    calculationNote: '',
  },
  activitiesByType: [{ type: 'CALL_MADE', count: 3 }],
  activitiesByUser: [
    { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', teamId: null, count: 5 },
  ],
  activitiesByDate: [{ date: '2026-08-05', count: 5 }],
  heatmap: [{ dayOfWeek: 3, hour: 10, count: 5 }],
  trend: [{ bucketStart: '2026-08-01T00:00:00.000Z', count: 5 }],
  leaderboard: [
    {
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: null,
      activitiesLogged: 5,
      tasksCompleted: 2,
      dealsClosed: 1,
      timeTrackedSeconds: 7200,
      rank: 1,
    },
  ],
  teamComparison: [],
}

const mockDrillDown = {
  user: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', teamId: null },
  summary: mockActivityReport.summary,
  activitiesByType: [{ type: 'CALL_MADE', count: 3 }],
  activitiesByDate: [{ date: '2026-08-05', count: 5 }],
  dealsClosed: 1,
  recentActivities: {
    items: [
      { id: 'a1', type: 'CALL_MADE', title: 'Called Ada', createdAt: '2026-08-05T10:00:00.000Z' },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  },
}

const mockGoal = {
  id: 'goal-1',
  name: '50 calls per week',
  activityType: 'CALL_MADE',
  targetCount: 50,
  period: 'WEEKLY',
  userId: 'user-1',
  startsOn: '2026-08-19T00:00:00.000Z',
  isActive: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  qualifyingCount: 4,
  progress: 0.08,
  progressPercent: 8,
  user: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
}

const mockGoalConnection = { items: [mockGoal], total: 1, page: 1, pageSize: 20 }

function registerMockServices(): {
  service: jest.Mocked<ActivityReportsService>
  goalsService: jest.Mocked<ActivityGoalsService>
} {
  const service = {
    activityReport: jest.fn().mockResolvedValue(mockActivityReport),
    activityUserDrillDown: jest.fn().mockResolvedValue(mockDrillDown),
    __validateForExport: jest.fn(),
  } as unknown as jest.Mocked<ActivityReportsService>
  const goalsService = {
    activityGoals: jest.fn().mockResolvedValue(mockGoalConnection),
    createActivityGoal: jest.fn().mockResolvedValue(mockGoal),
    updateActivityGoal: jest.fn().mockResolvedValue(mockGoal),
    deleteActivityGoal: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<ActivityGoalsService>
  registerActivityReportsGraphql(service, goalsService)
  registerReportExportsGraphql({} as never)
  return { service, goalsService }
}

const CONTEXT = {
  user: {
    sub: 'user-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['SALES_MANAGER'],
    email: 'manager@test.local',
  },
}

describe('activity reports GraphQL schema (Story 6.8)', () => {
  beforeEach(() => {
    mockRequirePermission.mockReset()
    mockRequirePermission.mockResolvedValue(undefined)
  })

  it('registers queries/mutations, enums, closed inputs and result shapes in the SDL (G1-G3)', () => {
    const sdl = printSchema(schema)

    // Queries
    expect(sdl).toContain('activityReport(filters: ActivityReportFilterInput!): ActivityReport!')
    expect(sdl).toContain(
      'activityUserDrillDown(filters: ActivityReportFilterInput!, pagination: ActivityReportPaginationInput, userId: ID!): ActivityUserDrillDown!',
    )
    expect(sdl).toContain(
      'activityGoals(filter: ActivityGoalFilterInput, pagination: ActivityReportPaginationInput): ActivityGoalConnection!',
    )
    // Mutations
    expect(sdl).toContain('createActivityGoal(input: CreateActivityGoalInput!): ActivityGoal!')
    expect(sdl).toContain(
      'updateActivityGoal(id: ID!, input: UpdateActivityGoalInput!): ActivityGoal!',
    )
    expect(sdl).toContain('deleteActivityGoal(id: ID!): Boolean!')
    expect(sdl).toContain(
      'exportActivityReport(filters: ActivityReportFilterInput!, format: ReportDeliveryFormat!): ReportExport!',
    )

    // Enums
    expect(sdl).toContain('enum ActivityReportBucket')
    expect(sdl).toContain('WEEK')
    expect(sdl).toContain('MONTH')
    expect(sdl).toContain('enum ActivityReportSortBy')
    expect(sdl).toContain('TASKS_COMPLETED')
    expect(sdl).toContain('DEALS_CLOSED')
    expect(sdl).toContain('TIME_TRACKED')
    expect(sdl).toContain('enum ActivityGoalPeriod')
    expect(sdl).toContain('enum ReportExportSourceType')
    expect(sdl).toContain('SAVED_REPORT')
    expect(sdl).toContain('ACTIVITY_REPORT')
    // ActivityType is reused — exactly ONE enum declaration.
    expect(sdl.match(/enum ActivityType/g)).toHaveLength(1)

    // Inputs
    expect(sdl).toContain('input ActivityReportFilterInput')
    expect(sdl).toContain('startDate: String!')
    expect(sdl).toContain('endDate: String!')
    expect(sdl).toContain('comparisonTeamIds: [ID!]')
    expect(sdl).toContain('activityTypes: [ActivityType!]')
    expect(sdl).toContain('input ActivityGoalFilterInput')
    expect(sdl).toContain('input CreateActivityGoalInput')
    expect(sdl).toContain('input UpdateActivityGoalInput')
    // Update input must NOT contain a userId field (no silent subject move).
    const updateInputMatch = sdl.match(/input UpdateActivityGoalInput \{([^}]*)\}/)
    expect(updateInputMatch![1]).not.toContain('userId')
    expect(sdl).toContain('input ActivityReportPaginationInput')

    // Result shapes
    expect(sdl).toContain('type ActivityReportSummary')
    for (const field of [
      'totalActivities: Int!',
      'completionRate: Float!',
      'completionRateNumerator: Int!',
      'completionRateDenominator: Int!',
      'tasksCompleted: Int!',
      'avgCompletionTimeHours: Float!',
      'overdueTasks: Int!',
      'timeTrackedSeconds: Int!',
      'meetingsScheduled: Int!',
      'startDate: String!',
      'endDate: String!',
      'calculationNote: String!',
    ]) {
      expect(sdl).toContain(field)
    }
    expect(sdl).toContain('type ActivityByType')
    expect(sdl).toContain('type ActivityByUser')
    expect(sdl).toContain('type ActivityByDate')
    expect(sdl).toContain('type ActivityHeatmapCell')
    expect(sdl).toContain('type ActivityTrendPoint')
    expect(sdl).toContain('type ActivityLeaderboardRow')
    expect(sdl).toContain('type ActivityTeamComparisonRow')
    expect(sdl).toContain('type ActivityReport')
    expect(sdl).toContain('summary: ActivityReportSummary!')
    expect(sdl).toContain('activitiesByType: [ActivityByType!]!')
    expect(sdl).toContain('activitiesByUser: [ActivityByUser!]!')
    expect(sdl).toContain('activitiesByDate: [ActivityByDate!]!')
    expect(sdl).toContain('heatmap: [ActivityHeatmapCell!]!')
    expect(sdl).toContain('trend: [ActivityTrendPoint!]!')
    expect(sdl).toContain('leaderboard: [ActivityLeaderboardRow!]!')
    expect(sdl).toContain('teamComparison: [ActivityTeamComparisonRow!]!')
    expect(sdl).toContain('type ActivityUserDrillDown')
    expect(sdl).toContain('recentActivities: ActivityRecentConnection!')
    expect(sdl).toContain('type ActivityGoal')
    expect(sdl).toContain('progress: Float!')
    expect(sdl).toContain('progressPercent: Float!')
    expect(sdl).toContain('qualifyingCount: Int!')
    expect(sdl).toContain('type ActivityGoalConnection')
    // ReportExport exposes sourceType (Story 6.8).
    expect(sdl).toContain('sourceType: ReportExportSourceType!')
  })

  it('emits NON-NULL list items for comparisonTeamIds/activityTypes (Contract C10 — M6)', () => {
    const sdl = printSchema(schema)
    // Contract C10: [ID!] / [ActivityType!] — nullable list (optional input
    // field), non-null ITEMS. Pothos v4 must never emit the nullable-item form.
    expect(sdl).toContain('comparisonTeamIds: [ID!]')
    expect(sdl).toContain('activityTypes: [ActivityType!]')
    expect(sdl).not.toContain('comparisonTeamIds: [ID]')
    expect(sdl).not.toContain('activityTypes: [ActivityType]')
  })

  it('executes activityReport through the service with tenant/user context', async () => {
    const { service } = registerMockServices()
    const source = `
      query {
        activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) {
          summary { totalActivities completionRate }
          leaderboard { userId rank activitiesLogged }
          heatmap { dayOfWeek hour count }
        }
      }
    `
    const result = await graphql({ schema, source, contextValue: CONTEXT })
    expect(result.errors).toBeUndefined()
    expect(service.activityReport).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({ startDate: '2026-08-01', endDate: '2026-08-31' }),
    )
    expect(result.data).toMatchObject({
      activityReport: {
        summary: { totalActivities: 5, completionRate: 0.75 },
        leaderboard: [{ userId: 'user-1', rank: 1, activitiesLogged: 5 }],
        heatmap: [{ dayOfWeek: 3, hour: 10, count: 5 }],
      },
    })
  })

  it('executes activityUserDrillDown and goal mutations through their services', async () => {
    const { service, goalsService } = registerMockServices()
    const result = await graphql({
      schema,
      source: `
        query {
          activityUserDrillDown(
            userId: "user-1"
            filters: { startDate: "2026-08-01", endDate: "2026-08-31" }
          ) {
            user { id }
            recentActivities { total items { id title } }
          }
        }
      `,
      contextValue: CONTEXT,
    })
    expect(result.errors).toBeUndefined()
    expect(service.activityUserDrillDown).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'user-1',
      expect.any(Object),
      expect.objectContaining({}),
    )

    const createResult = await graphql({
      schema,
      source: `
        mutation {
          createActivityGoal(input: {
            name: "50 calls"
            targetCount: 50
            period: WEEKLY
            userId: "user-1"
            startsOn: "2026-08-19T00:00:00.000Z"
          }) { id progressPercent }
        }
      `,
      contextValue: CONTEXT,
    })
    expect(createResult.errors).toBeUndefined()
    expect(goalsService.createActivityGoal).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({ name: '50 calls', targetCount: 50, period: 'WEEKLY' }),
    )

    const deleteResult = await graphql({
      schema,
      source: `mutation { deleteActivityGoal(id: "goal-1") }`,
      contextValue: CONTEXT,
    })
    expect(deleteResult.errors).toBeUndefined()
    expect(goalsService.deleteActivityGoal).toHaveBeenCalledWith('tenant-1', 'user-1', 'goal-1')
  })

  it('enforces the exact permission gates (C11/D17/E30)', async () => {
    const { service, goalsService } = registerMockServices()
    const context = {
      user: {
        sub: 'user-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        roles: ['SALES_MANAGER'],
        email: 'manager@test.local',
      },
    }
    const source = `
      query {
        activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) { summary { totalActivities } }
      }
    `
    await graphql({ schema, source, contextValue: context })
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'REPORT', 'READ')
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'CONTACT', 'READ')
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'TASK', 'READ')
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'DEAL', 'READ')
    mockRequirePermission.mockClear()

    await graphql({
      schema,
      source: `mutation { createActivityGoal(input: { name: "x", targetCount: 1, period: WEEKLY, userId: "user-1", startsOn: "2026-08-19T00:00:00.000Z" }) { id } }`,
      contextValue: context,
    })
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'REPORT', 'CREATE')
    mockRequirePermission.mockClear()

    await graphql({
      schema,
      source: `mutation { updateActivityGoal(id: "g", input: { targetCount: 5 }) { id } }`,
      contextValue: context,
    })
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'REPORT', 'UPDATE')
    mockRequirePermission.mockClear()

    await graphql({
      schema,
      source: `mutation { deleteActivityGoal(id: "g") }`,
      contextValue: context,
    })
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'REPORT', 'DELETE')
    mockRequirePermission.mockClear()

    await graphql({
      schema,
      source: `query { activityGoals { total } }`,
      contextValue: context,
    })
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), 'REPORT', 'READ')
    void service
    void goalsService
  })

  it('propagates a ForbiddenException from the permission gate as a GraphQL error', async () => {
    registerMockServices()
    mockRequirePermission.mockRejectedValue(
      new ForbiddenException('Missing required permission: REPORT:READ'),
    )
    const result = await graphql({
      schema,
      source: `
        query {
          activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) { summary { totalActivities } }
        }
      `,
      contextValue: CONTEXT,
    })
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toContain('REPORT:READ')
  })

  it('requires authentication (UnauthorizedException) without a JWT user', async () => {
    registerMockServices()
    const result = await graphql({
      schema,
      source: `
        query {
          activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) { summary { totalActivities } }
        }
      `,
      contextValue: {},
    })
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toContain('Authentication required')
  })
})
