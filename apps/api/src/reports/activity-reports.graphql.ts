import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { ActivityTypeEnum } from '../activities/activities.graphql'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import {
  ACTIVITY_REPORT_BUCKETS,
  ACTIVITY_REPORT_SORT_BYS,
  ACTIVITY_GOAL_PERIODS,
  type ActivityTypeValue,
} from './activity-report-metrics'
import type {
  ActivityByDateRow,
  ActivityByTypeRow,
  ActivityByUserRow,
  ActivityLeaderboardRow,
  ActivityReport,
  ActivityReportSummary,
  ActivityReportsService,
  ActivityTeamComparisonRow,
  ActivityTrendPoint,
  ActivityUserDrillDown,
  RecentActivityItem,
} from './activity-reports.service'
import type {
  ActivityGoalConnection,
  ActivityGoalFilterInput,
  ActivityGoalView,
  ActivityGoalsService,
  CreateActivityGoalInput,
  UpdateActivityGoalInput,
} from './activity-goals.service'

// ─── Enums (derive from the closed const tuples — one vocabulary only) ──────

const ActivityReportBucketRef = builder.enumType('ActivityReportBucket', {
  values: ACTIVITY_REPORT_BUCKETS,
})
const ActivityReportSortByRef = builder.enumType('ActivityReportSortBy', {
  values: ACTIVITY_REPORT_SORT_BYS,
})
const ActivityGoalPeriodRef = builder.enumType('ActivityGoalPeriod', {
  values: ACTIVITY_GOAL_PERIODS,
})

// ─── Input types ─────────────────────────────────────────────────────────────

export const ActivityReportFilterInputRef = builder.inputType('ActivityReportFilterInput', {
  fields: (t) => ({
    startDate: t.string({ required: true }),
    endDate: t.string({ required: true }),
    userId: t.id(),
    teamId: t.id(),
    // Contract C10: [ID!] / [ActivityType!] — nullable LIST (optional input
    // field) with NON-NULL items. Pothos v4 defaults input list items to
    // required, but we pin it explicitly so a future Pothos default change
    // can never silently regress the contract SDL (M6).
    comparisonTeamIds: t.idList({ required: { items: true, list: false } }),
    activityTypes: t.field({ type: [ActivityTypeEnum], required: { items: true, list: false } }),
    contactId: t.id(),
    dealId: t.id(),
    bucket: t.field({ type: ActivityReportBucketRef }),
    sortBy: t.field({ type: ActivityReportSortByRef }),
  }),
})

const ActivityReportPaginationInputRef = builder.inputType('ActivityReportPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const ActivityGoalFilterInputRef = builder.inputType('ActivityGoalFilterInput', {
  fields: (t) => ({
    userId: t.id(),
    activityType: t.field({ type: ActivityTypeEnum }),
    period: t.field({ type: ActivityGoalPeriodRef }),
    activeOnly: t.boolean(),
  }),
})

const CreateActivityGoalInputRef = builder.inputType('CreateActivityGoalInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    activityType: t.field({ type: ActivityTypeEnum }),
    targetCount: t.int({ required: true }),
    period: t.field({ type: ActivityGoalPeriodRef, required: true }),
    userId: t.id({ required: true }),
    startsOn: t.string({ required: true }),
  }),
})

const UpdateActivityGoalInputRef = builder.inputType('UpdateActivityGoalInput', {
  // Deliberately NO userId — a goal's subject can never be silently moved.
  fields: (t) => ({
    name: t.string(),
    activityType: t.field({ type: ActivityTypeEnum }),
    targetCount: t.int(),
    period: t.field({ type: ActivityGoalPeriodRef }),
    startsOn: t.string(),
    isActive: t.boolean(),
  }),
})

// ─── Result refs (service return shapes — ref/select lockstep) ──────────────

const ActivityReportSummaryRef = builder.objectRef<ActivityReportSummary>('ActivityReportSummary')

ActivityReportSummaryRef.implement({
  fields: (t) => ({
    totalActivities: t.exposeInt('totalActivities', { nullable: false }),
    unattributedActivities: t.exposeInt('unattributedActivities', { nullable: false }),
    completionRate: t.exposeFloat('completionRate', { nullable: false }),
    completionRateNumerator: t.exposeInt('completionRateNumerator', { nullable: false }),
    completionRateDenominator: t.exposeInt('completionRateDenominator', { nullable: false }),
    tasksCompleted: t.exposeInt('tasksCompleted', { nullable: false }),
    avgCompletionTimeHours: t.exposeFloat('avgCompletionTimeHours', { nullable: false }),
    overdueTasks: t.exposeInt('overdueTasks', { nullable: false }),
    timeTrackedSeconds: t.exposeInt('timeTrackedSeconds', { nullable: false }),
    meetingsScheduled: t.exposeInt('meetingsScheduled', { nullable: false }),
    startDate: t.exposeString('startDate', { nullable: false }),
    endDate: t.exposeString('endDate', { nullable: false }),
    calculationNote: t.exposeString('calculationNote', { nullable: false }),
  }),
})

const ActivityByTypeRef = builder.objectRef<ActivityByTypeRow>('ActivityByType')

ActivityByTypeRef.implement({
  fields: (t) => ({
    type: t.exposeString('type', { nullable: false }),
    count: t.exposeInt('count', { nullable: false }),
  }),
})

const ActivityByUserRef = builder.objectRef<ActivityByUserRow>('ActivityByUser')

ActivityByUserRef.implement({
  fields: (t) => ({
    userId: t.exposeID('userId', { nullable: false }),
    firstName: t.exposeString('firstName', { nullable: false }),
    lastName: t.exposeString('lastName', { nullable: false }),
    teamId: t.exposeString('teamId', { nullable: true }),
    count: t.exposeInt('count', { nullable: false }),
  }),
})

const ActivityByDateRef = builder.objectRef<ActivityByDateRow>('ActivityByDate')

ActivityByDateRef.implement({
  fields: (t) => ({
    date: t.exposeString('date', { nullable: false }),
    count: t.exposeInt('count', { nullable: false }),
  }),
})

const HeatmapCellRef = builder.objectRef<{ dayOfWeek: number; hour: number; count: number }>(
  'ActivityHeatmapCell',
)

HeatmapCellRef.implement({
  fields: (t) => ({
    dayOfWeek: t.exposeInt('dayOfWeek', { nullable: false }),
    hour: t.exposeInt('hour', { nullable: false }),
    count: t.exposeInt('count', { nullable: false }),
  }),
})

const ActivityTrendPointRef = builder.objectRef<ActivityTrendPoint>('ActivityTrendPoint')

ActivityTrendPointRef.implement({
  fields: (t) => ({
    bucketStart: t.exposeString('bucketStart', { nullable: false }),
    count: t.exposeInt('count', { nullable: false }),
  }),
})

const ActivityLeaderboardRowRef =
  builder.objectRef<ActivityLeaderboardRow>('ActivityLeaderboardRow')

ActivityLeaderboardRowRef.implement({
  fields: (t) => ({
    userId: t.exposeID('userId', { nullable: false }),
    firstName: t.exposeString('firstName', { nullable: false }),
    lastName: t.exposeString('lastName', { nullable: false }),
    teamId: t.exposeString('teamId', { nullable: true }),
    activitiesLogged: t.exposeInt('activitiesLogged', { nullable: false }),
    tasksCompleted: t.exposeInt('tasksCompleted', { nullable: false }),
    dealsClosed: t.exposeInt('dealsClosed', { nullable: false }),
    timeTrackedSeconds: t.exposeInt('timeTrackedSeconds', { nullable: false }),
    rank: t.exposeInt('rank', { nullable: false }),
  }),
})

const ActivityTeamComparisonRowRef = builder.objectRef<ActivityTeamComparisonRow>(
  'ActivityTeamComparisonRow',
)

ActivityTeamComparisonRowRef.implement({
  fields: (t) => ({
    teamId: t.exposeID('teamId', { nullable: false }),
    teamName: t.exposeString('teamName', { nullable: false }),
    totalActivities: t.exposeInt('totalActivities', { nullable: false }),
    tasksCompleted: t.exposeInt('tasksCompleted', { nullable: false }),
    avgCompletionTimeHours: t.exposeFloat('avgCompletionTimeHours', { nullable: false }),
    overdueTasks: t.exposeInt('overdueTasks', { nullable: false }),
    timeTrackedSeconds: t.exposeInt('timeTrackedSeconds', { nullable: false }),
    meetingsScheduled: t.exposeInt('meetingsScheduled', { nullable: false }),
    completionRate: t.exposeFloat('completionRate', { nullable: false }),
  }),
})

const ActivityReportRef = builder.objectRef<ActivityReport>('ActivityReport')

ActivityReportRef.implement({
  fields: (t) => ({
    summary: t.field({
      type: ActivityReportSummaryRef,
      nullable: false,
      resolve: (report) => report.summary,
    }),
    activitiesByType: t.field({
      type: [ActivityByTypeRef],
      nullable: false,
      resolve: (report) => report.activitiesByType,
    }),
    activitiesByUser: t.field({
      type: [ActivityByUserRef],
      nullable: false,
      resolve: (report) => report.activitiesByUser,
    }),
    activitiesByDate: t.field({
      type: [ActivityByDateRef],
      nullable: false,
      resolve: (report) => report.activitiesByDate,
    }),
    heatmap: t.field({
      type: [HeatmapCellRef],
      nullable: false,
      resolve: (report) => report.heatmap,
    }),
    trend: t.field({
      type: [ActivityTrendPointRef],
      nullable: false,
      resolve: (report) => report.trend,
    }),
    leaderboard: t.field({
      type: [ActivityLeaderboardRowRef],
      nullable: false,
      resolve: (report) => report.leaderboard,
    }),
    teamComparison: t.field({
      type: [ActivityTeamComparisonRowRef],
      nullable: false,
      resolve: (report) => report.teamComparison,
    }),
  }),
})

const ActivityReportUserRef = builder.objectRef<{
  id: string
  firstName: string
  lastName: string
  teamId: string | null
}>('ActivityReportUser')

ActivityReportUserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: false }),
    firstName: t.exposeString('firstName', { nullable: false }),
    lastName: t.exposeString('lastName', { nullable: false }),
    teamId: t.exposeString('teamId', { nullable: true }),
  }),
})

const RecentActivityRef = builder.objectRef<RecentActivityItem>('RecentActivity')

RecentActivityRef.implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: false }),
    type: t.field({
      type: ActivityTypeEnum,
      nullable: false,
      resolve: (item) => item.type as ActivityTypeValue,
    }),
    title: t.exposeString('title', { nullable: false }),
    createdAt: t.exposeString('createdAt', { nullable: false }),
  }),
})

const ActivityRecentConnectionRef = builder.objectRef<{
  items: RecentActivityItem[]
  total: number
  page: number
  pageSize: number
}>('ActivityRecentConnection')

ActivityRecentConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [RecentActivityRef], nullable: false, resolve: (c) => c.items }),
    total: t.exposeInt('total', { nullable: false }),
    page: t.exposeInt('page', { nullable: false }),
    pageSize: t.exposeInt('pageSize', { nullable: false }),
  }),
})

const ActivityUserDrillDownRef = builder.objectRef<ActivityUserDrillDown>('ActivityUserDrillDown')

ActivityUserDrillDownRef.implement({
  fields: (t) => ({
    user: t.field({
      type: ActivityReportUserRef,
      nullable: false,
      resolve: (drill) => drill.user,
    }),
    summary: t.field({
      type: ActivityReportSummaryRef,
      nullable: false,
      resolve: (drill) => drill.summary,
    }),
    activitiesByType: t.field({
      type: [ActivityByTypeRef],
      nullable: false,
      resolve: (drill) => drill.activitiesByType,
    }),
    activitiesByDate: t.field({
      type: [ActivityByDateRef],
      nullable: false,
      resolve: (drill) => drill.activitiesByDate,
    }),
    dealsClosed: t.exposeInt('dealsClosed', { nullable: false }),
    recentActivities: t.field({
      type: ActivityRecentConnectionRef,
      nullable: false,
      resolve: (drill) => drill.recentActivities,
    }),
  }),
})

// ─── Goal refs ───────────────────────────────────────────────────────────────

const ActivityGoalUserRef = builder.objectRef<{ id: string; firstName: string; lastName: string }>(
  'ActivityGoalUser',
)

ActivityGoalUserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: false }),
    firstName: t.exposeString('firstName', { nullable: false }),
    lastName: t.exposeString('lastName', { nullable: false }),
  }),
})

const ActivityGoalRef = builder.objectRef<ActivityGoalView>('ActivityGoal')

ActivityGoalRef.implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: false }),
    name: t.exposeString('name', { nullable: false }),
    activityType: t.field({
      type: ActivityTypeEnum,
      nullable: true,
      resolve: (goal) => goal.activityType as ActivityTypeValue | null,
    }),
    targetCount: t.exposeInt('targetCount', { nullable: false }),
    period: t.field({
      type: ActivityGoalPeriodRef,
      nullable: false,
      resolve: (goal) => goal.period,
    }),
    userId: t.exposeID('userId', { nullable: false }),
    startsOn: t.exposeString('startsOn', { nullable: false }),
    isActive: t.exposeBoolean('isActive', { nullable: false }),
    createdAt: t.exposeString('createdAt', { nullable: false }),
    updatedAt: t.exposeString('updatedAt', { nullable: false }),
    qualifyingCount: t.exposeInt('qualifyingCount', { nullable: false }),
    progress: t.exposeFloat('progress', { nullable: false }),
    progressPercent: t.exposeFloat('progressPercent', { nullable: false }),
    user: t.field({
      type: ActivityGoalUserRef,
      nullable: true,
      resolve: (goal) => goal.user,
    }),
  }),
})

const ActivityGoalConnectionRef =
  builder.objectRef<ActivityGoalConnection>('ActivityGoalConnection')

ActivityGoalConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [ActivityGoalRef], nullable: false, resolve: (c) => c.items }),
    total: t.exposeInt('total', { nullable: false }),
    page: t.exposeInt('page', { nullable: false }),
    pageSize: t.exposeInt('pageSize', { nullable: false }),
  }),
})

// ─── Service singletons ──────────────────────────────────────────────────────

let activityReportsService: ActivityReportsService | undefined
let activityGoalsService: ActivityGoalsService | undefined

function getActivityReportsService(): ActivityReportsService {
  if (!activityReportsService) {
    throw new Error('ActivityReportsService is not initialized')
  }
  return activityReportsService
}

function getActivityGoalsService(): ActivityGoalsService {
  if (!activityGoalsService) {
    throw new Error('ActivityGoalsService is not initialized')
  }
  return activityGoalsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

/** Contract C11: query gate = REPORT:READ + CONTACT:READ + TASK:READ + DEAL:READ. */
async function requireActivityReportPermissions(context: GraphqlContext): Promise<void> {
  await requirePermission(context, 'REPORT', 'READ')
  await requirePermission(context, 'CONTACT', 'READ')
  await requirePermission(context, 'TASK', 'READ')
  await requirePermission(context, 'DEAL', 'READ')
}

// ─── Queries ────────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  // Contract C10: bounded activity report (Contract B6: range <= 366 days).
  activityReport: t.field({
    type: ActivityReportRef,
    nullable: false,
    args: {
      filters: t.arg({ type: ActivityReportFilterInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requireActivityReportPermissions(context)
      return getActivityReportsService().activityReport(user.tenantId, user.userId, args.filters)
    },
  }),
  // Contract C15: lazy per-user drill-down (subject locked to the argument).
  activityUserDrillDown: t.field({
    type: ActivityUserDrillDownRef,
    nullable: false,
    args: {
      userId: t.arg.id({ required: true }),
      filters: t.arg({ type: ActivityReportFilterInputRef, required: true }),
      pagination: t.arg({ type: ActivityReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requireActivityReportPermissions(context)
      return getActivityReportsService().activityUserDrillDown(
        user.tenantId,
        user.userId,
        args.userId,
        args.filters,
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  // Contract D17: goal list with server-computed progress (REPORT:READ).
  activityGoals: t.field({
    type: ActivityGoalConnectionRef,
    nullable: false,
    args: {
      filter: t.arg({ type: ActivityGoalFilterInputRef }),
      pagination: t.arg({ type: ActivityReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getActivityGoalsService().activityGoals(
        user.tenantId,
        user.userId,
        (args.filter as ActivityGoalFilterInput | null | undefined) ?? {},
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
}))

// ─── Mutations ───────────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  // Contract D17: goal CUD gated by REPORT:CREATE / UPDATE / DELETE.
  createActivityGoal: t.field({
    type: ActivityGoalRef,
    nullable: false,
    args: {
      input: t.arg({ type: CreateActivityGoalInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'CREATE')
      return getActivityGoalsService().createActivityGoal(
        user.tenantId,
        user.userId,
        args.input as CreateActivityGoalInput,
      )
    },
  }),
  updateActivityGoal: t.field({
    type: ActivityGoalRef,
    nullable: false,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateActivityGoalInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'UPDATE')
      return getActivityGoalsService().updateActivityGoal(
        user.tenantId,
        user.userId,
        args.id,
        args.input as UpdateActivityGoalInput,
      )
    },
  }),
  deleteActivityGoal: t.field({
    type: 'Boolean',
    nullable: false,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'DELETE')
      return getActivityGoalsService().deleteActivityGoal(user.tenantId, user.userId, args.id)
    },
  }),
}))

// ─── Registration ───────────────────────────────────────────────────────────

export function registerActivityReportsGraphql(
  service: ActivityReportsService,
  goalsService: ActivityGoalsService,
): void {
  activityReportsService = service
  activityGoalsService = goalsService
}
