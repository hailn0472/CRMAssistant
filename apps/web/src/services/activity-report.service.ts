/**
 * Story 6.8 — Activity Reports Service.
 *
 * Hand-written GraphQL service over graphqlRequest (no Apollo, no codegen).
 * Query keys rooted strictly at ['activityReport'] with child keys for
 * overview, drill-down and goals.
 */
import { graphqlRequest } from '@/lib/graphql-client'
import type { ActivityTypeValue } from '@/types/activity.types'

// ─── Enums & Vocabularies ───────────────────────────────────────────────────

export type ActivityReportBucket = 'DAY' | 'WEEK' | 'MONTH'

export type ActivityReportSortBy =
  | 'ACTIVITIES'
  | 'TASKS_COMPLETED'
  | 'DEALS_CLOSED'
  | 'TIME_TRACKED'

export type ActivityGoalPeriod = 'WEEKLY' | 'MONTHLY'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActivityReportFilterInput {
  startDate: string
  endDate: string
  userId?: string | null
  teamId?: string | null
  comparisonTeamIds?: string[] | null
  activityTypes?: ActivityTypeValue[] | null
  contactId?: string | null
  dealId?: string | null
  bucket?: ActivityReportBucket | null
  sortBy?: ActivityReportSortBy | null
}

export interface ActivityReportPaginationInput {
  page?: number | null
  pageSize?: number | null
}

export interface ActivityReportSummary {
  totalActivities: number
  unattributedActivities: number
  completionRate: number
  completionRateNumerator: number
  completionRateDenominator: number
  tasksCompleted: number
  avgCompletionTimeHours: number
  overdueTasks: number
  timeTrackedSeconds: number
  meetingsScheduled: number
  startDate: string
  endDate: string
  calculationNote: string
}

export interface ActivityByTypeRow {
  type: string
  count: number
}

export interface ActivityByUserRow {
  userId: string
  firstName: string
  lastName: string
  teamId: string | null
  count: number
}

export interface ActivityByDateRow {
  date: string
  count: number
}

export interface ActivityHeatmapCell {
  dayOfWeek: number
  hour: number
  count: number
}

export interface ActivityTrendPoint {
  bucketStart: string
  count: number
}

export interface ActivityLeaderboardRow {
  userId: string
  firstName: string
  lastName: string
  teamId: string | null
  activitiesLogged: number
  tasksCompleted: number
  dealsClosed: number
  timeTrackedSeconds: number
  rank: number
}

export interface ActivityTeamComparisonRow {
  teamId: string
  teamName: string
  totalActivities: number
  tasksCompleted: number
  avgCompletionTimeHours: number
  overdueTasks: number
  timeTrackedSeconds: number
  meetingsScheduled: number
  completionRate: number
}

export interface ActivityReport {
  summary: ActivityReportSummary
  activitiesByType: ActivityByTypeRow[]
  activitiesByUser: ActivityByUserRow[]
  activitiesByDate: ActivityByDateRow[]
  heatmap: ActivityHeatmapCell[]
  trend: ActivityTrendPoint[]
  leaderboard: ActivityLeaderboardRow[]
  teamComparison: ActivityTeamComparisonRow[]
}

export interface ActivityReportUser {
  id: string
  firstName: string
  lastName: string
  teamId: string | null
}

export interface RecentActivityItem {
  id: string
  type: ActivityTypeValue
  title: string
  createdAt: string
}

export interface ActivityRecentConnection {
  items: RecentActivityItem[]
  total: number
  page: number
  pageSize: number
}

export interface ActivityUserDrillDown {
  user: ActivityReportUser
  summary: ActivityReportSummary
  activitiesByType: ActivityByTypeRow[]
  activitiesByDate: ActivityByDateRow[]
  dealsClosed: number
  recentActivities: ActivityRecentConnection
}

export interface ActivityGoalUser {
  id: string
  firstName: string
  lastName: string
}

export interface ActivityGoal {
  id: string
  name: string
  activityType: ActivityTypeValue | null
  targetCount: number
  period: ActivityGoalPeriod
  userId: string
  startsOn: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  qualifyingCount: number
  progress: number
  progressPercent: number
  user?: ActivityGoalUser | null
}

export interface ActivityGoalConnection {
  items: ActivityGoal[]
  total: number
  page: number
  pageSize: number
}

export interface ActivityGoalFilterInput {
  userId?: string | null
  activityType?: ActivityTypeValue | null
  period?: ActivityGoalPeriod | null
  activeOnly?: boolean | null
}

export interface CreateActivityGoalInput {
  name: string
  activityType?: ActivityTypeValue | null
  targetCount: number
  period: ActivityGoalPeriod
  userId: string
  startsOn: string
}

export interface UpdateActivityGoalInput {
  name?: string
  activityType?: ActivityTypeValue | null
  targetCount?: number
  period?: ActivityGoalPeriod
  startsOn?: string
  isActive?: boolean
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

export const activityReportKeys = {
  all: ['activityReport'] as const,
  overview: (filters: ActivityReportFilterInput) =>
    ['activityReport', 'overview', filters] as const,
  drillDown: (
    userId: string,
    filters: ActivityReportFilterInput,
    pagination?: ActivityReportPaginationInput | null,
  ) => ['activityReport', 'drillDown', userId, filters, pagination] as const,
  goals: (
    filter?: ActivityGoalFilterInput | null,
    pagination?: ActivityReportPaginationInput | null,
  ) => ['activityReport', 'goals', filter, pagination] as const,
}

// ─── Fragments & Operations ─────────────────────────────────────────────────

const SUMMARY_FIELDS = `
  totalActivities
  unattributedActivities
  completionRate
  completionRateNumerator
  completionRateDenominator
  tasksCompleted
  avgCompletionTimeHours
  overdueTasks
  timeTrackedSeconds
  meetingsScheduled
  startDate
  endDate
  calculationNote
`

const ACTIVITY_REPORT_QUERY = `
  query ActivityReport($filters: ActivityReportFilterInput!) {
    activityReport(filters: $filters) {
      summary {
        ${SUMMARY_FIELDS}
      }
      activitiesByType {
        type
        count
      }
      activitiesByUser {
        userId
        firstName
        lastName
        teamId
        count
      }
      activitiesByDate {
        date
        count
      }
      heatmap {
        dayOfWeek
        hour
        count
      }
      trend {
        bucketStart
        count
      }
      leaderboard {
        userId
        firstName
        lastName
        teamId
        activitiesLogged
        tasksCompleted
        dealsClosed
        timeTrackedSeconds
        rank
      }
      teamComparison {
        teamId
        teamName
        totalActivities
        tasksCompleted
        avgCompletionTimeHours
        overdueTasks
        timeTrackedSeconds
        meetingsScheduled
        completionRate
      }
    }
  }
`

const ACTIVITY_USER_DRILL_DOWN_QUERY = `
  query ActivityUserDrillDown(
    $userId: ID!
    $filters: ActivityReportFilterInput!
    $pagination: ActivityReportPaginationInput
  ) {
    activityUserDrillDown(userId: $userId, filters: $filters, pagination: $pagination) {
      user {
        id
        firstName
        lastName
        teamId
      }
      summary {
        ${SUMMARY_FIELDS}
      }
      activitiesByType {
        type
        count
      }
      activitiesByDate {
        date
        count
      }
      dealsClosed
      recentActivities {
        items {
          id
          type
          title
          createdAt
        }
        total
        page
        pageSize
      }
    }
  }
`

const GOAL_FIELDS = `
  id
  name
  activityType
  targetCount
  period
  userId
  startsOn
  isActive
  createdAt
  updatedAt
  qualifyingCount
  progress
  progressPercent
  user {
    id
    firstName
    lastName
  }
`

const ACTIVITY_GOALS_QUERY = `
  query ActivityGoals($filter: ActivityGoalFilterInput, $pagination: ActivityReportPaginationInput) {
    activityGoals(filter: $filter, pagination: $pagination) {
      items {
        ${GOAL_FIELDS}
      }
      total
      page
      pageSize
    }
  }
`

const CREATE_ACTIVITY_GOAL_MUTATION = `
  mutation CreateActivityGoal($input: CreateActivityGoalInput!) {
    createActivityGoal(input: $input) {
      ${GOAL_FIELDS}
    }
  }
`

const UPDATE_ACTIVITY_GOAL_MUTATION = `
  mutation UpdateActivityGoal($id: ID!, $input: UpdateActivityGoalInput!) {
    updateActivityGoal(id: $id, input: $input) {
      ${GOAL_FIELDS}
    }
  }
`

const DELETE_ACTIVITY_GOAL_MUTATION = `
  mutation DeleteActivityGoal($id: ID!) {
    deleteActivityGoal(id: $id)
  }
`

// ─── Service Methods ────────────────────────────────────────────────────────

export async function getActivityReport(
  filters: ActivityReportFilterInput,
): Promise<ActivityReport> {
  const data = await graphqlRequest<{ activityReport: ActivityReport }>(ACTIVITY_REPORT_QUERY, {
    filters,
  })
  return data.activityReport
}

export async function getActivityUserDrillDown(
  userId: string,
  filters: ActivityReportFilterInput,
  pagination?: ActivityReportPaginationInput,
): Promise<ActivityUserDrillDown> {
  const data = await graphqlRequest<{ activityUserDrillDown: ActivityUserDrillDown }>(
    ACTIVITY_USER_DRILL_DOWN_QUERY,
    {
      userId,
      filters,
      pagination: pagination ?? null,
    },
  )
  return data.activityUserDrillDown
}

export async function getActivityGoals(
  filter?: ActivityGoalFilterInput,
  pagination?: ActivityReportPaginationInput,
): Promise<ActivityGoalConnection> {
  const data = await graphqlRequest<{ activityGoals: ActivityGoalConnection }>(
    ACTIVITY_GOALS_QUERY,
    {
      filter: filter ?? null,
      pagination: pagination ?? null,
    },
  )
  return data.activityGoals
}

export async function createActivityGoal(input: CreateActivityGoalInput): Promise<ActivityGoal> {
  const data = await graphqlRequest<{ createActivityGoal: ActivityGoal }>(
    CREATE_ACTIVITY_GOAL_MUTATION,
    { input },
  )
  return data.createActivityGoal
}

export async function updateActivityGoal(
  id: string,
  input: UpdateActivityGoalInput,
): Promise<ActivityGoal> {
  const data = await graphqlRequest<{ updateActivityGoal: ActivityGoal }>(
    UPDATE_ACTIVITY_GOAL_MUTATION,
    { id, input },
  )
  return data.updateActivityGoal
}

export async function deleteActivityGoal(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteActivityGoal: boolean }>(
    DELETE_ACTIVITY_GOAL_MUTATION,
    { id },
  )
  return data.deleteActivityGoal
}
