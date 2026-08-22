/**
 * Story 6.8 (Contract C9-C16): activity reports + team productivity metrics.
 *
 * The report is a read-model over the EXISTING Activity/Task/TimeEntry/Deal
 * tables — nothing is written, nothing is mutated. Every data access layers
 * the standard shared predicates (ActivityService.buildFeedWhere,
 * TasksService.buildTaskWhere, TimeEntriesService.buildTimeEntryWhere,
 * DealsService.buildDealWhere) — never a second hand-rolled visibility
 * predicate (finding 3.7-F4 was a divergence of exactly this class).
 *
 * Security invariants (Contract C12-C14, story invariants 1-3):
 * - Every query carries `tenantId` (via the shared predicates).
 * - User scope (leaderboard rows, drill-down subjects, userId/teamId filters)
 *   is derived from `resolveVisibilityFilter` — OWN → caller only, TEAM/ALL →
 *   member id set, ADMIN/ALL → unrestricted (undefined). A createdBy String
 *   that is not a visible user never appears in a row.
 * - `dealId` is authorized through DealsService.findOne FIRST; the activity
 *   scope is DEAL-provenance OR bounded task-provenance — never a broaden to
 *   Deal.contactId.
 *
 * Bounds (Contract B6): range <= 366 days (pure validator), raw activity
 * rows <= ACTIVITY_REPORT_MAX_ROWS (throw, never silent truncation),
 * aggregates are DB groupBy — no N+1, one batched user label lookup.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import type { ActivityType, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { ActivityService, type ActivityFeedFilter } from '../activities/activities.service'
import { TasksService } from '../tasks/tasks.service'
import { TimeEntriesService } from '../time-tracking/time-entries.service'
import { DealsService } from '../deals/deals.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'
import {
  ACTIVITY_REPORT_MAX_ROWS,
  ActivityReportValidationError,
  avgCompletionHours,
  bucketKey,
  completionRate,
  enumerateBuckets,
  enumerateHeatmapCells,
  enumerateUtcDays,
  heatmapKey,
  normalizeActivityReportFilters,
  toUtcMidnight,
  utcDayKey,
  type ActivityReportBucket,
  type ActivityReportFilterInput,
  type ActivityReportSortBy,
  type ActivityTypeValue,
  type HeatmapCell,
  type NormalizedActivityReportFilters,
} from './activity-report-metrics'

// ─── Typed result contract (ref/select lockstep — Contract C15/C16) ─────────

export type ActivityReportSummary = {
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

export type ActivityByTypeRow = {
  type: string
  count: number
}

export type ActivityByUserRow = {
  userId: string
  firstName: string
  lastName: string
  teamId: string | null
  count: number
}

export type ActivityByDateRow = {
  date: string
  count: number
}

export type ActivityTrendPoint = {
  bucketStart: string
  count: number
}

export type ActivityLeaderboardRow = {
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

export type ActivityTeamComparisonRow = {
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

export type ActivityReport = {
  summary: ActivityReportSummary
  activitiesByType: ActivityByTypeRow[]
  activitiesByUser: ActivityByUserRow[]
  activitiesByDate: ActivityByDateRow[]
  heatmap: HeatmapCell[]
  trend: ActivityTrendPoint[]
  leaderboard: ActivityLeaderboardRow[]
  teamComparison: ActivityTeamComparisonRow[]
}

export type RecentActivityItem = {
  id: string
  type: string
  title: string
  createdAt: string
}

export type ActivityUserDrillDown = {
  user: { id: string; firstName: string; lastName: string; teamId: string | null }
  summary: ActivityReportSummary
  activitiesByType: ActivityByTypeRow[]
  activitiesByDate: ActivityByDateRow[]
  dealsClosed: number
  recentActivities: {
    items: RecentActivityItem[]
    total: number
    page: number
    pageSize: number
  }
}

/**
 * The immutable, JSON-safe filter snapshot persisted on ACTIVITY_REPORT
 * export rows (Contract E30) — derived from the pure normalizer; replaying
 * it re-runs the identical scope.
 */
export type ActivityReportExportSnapshot = {
  startDate: string
  endDate: string
  userId: string | null
  teamId: string | null
  comparisonTeamIds: string[]
  activityTypes: ActivityTypeValue[]
  contactId: string | null
  dealId: string | null
  bucket: ActivityReportBucket
  sortBy: ActivityReportSortBy
}

export type { ActivityReportFilterInput }

const MAX_TEAM_TASK_IDS = 1000

type ReportScope = {
  /** Effective user set for aggregates; null = unrestricted (ADMIN/ALL). */
  scopeUserIds: string[] | null
  /** Drill-down: force every aggregate to this single subject. */
  subjectUserId?: string
}

@Injectable()
export class ActivityReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivityService,
    private readonly tasksService: TasksService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly dealsService: DealsService,
    // Injectable clock (deterministic overdue "as-of now"; pattern
    // CustomerAnalyticsProcessor + Contract D20 house Clock shape) — a
    // function object `{ now() }`, never a Date captured at construction.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  // ─── Query surface ─────────────────────────────────────────────────────────

  async activityReport(
    tenantId: string,
    callerUserId: string,
    input: ActivityReportFilterInput,
  ): Promise<ActivityReport> {
    const n = this.validateAndNormalize(input)
    const scope = await this.resolveUserScope(tenantId, callerUserId, n)
    const { provenance: dealProvenance, taskTruncated } = await this.resolveDealProvenance(
      tenantId,
      callerUserId,
      n,
    )

    const computed = await this.computeOverview(
      tenantId,
      callerUserId,
      n,
      scope,
      dealProvenance,
      taskTruncated,
    )

    const teamComparison =
      n.comparisonTeamIds.length > 0
        ? await this.computeTeamComparison(tenantId, callerUserId, n, scope, dealProvenance)
        : []

    return {
      summary: computed.summary,
      activitiesByType: computed.byType,
      activitiesByUser: computed.byUser,
      activitiesByDate: computed.byDate,
      heatmap: computed.heatmap,
      trend: computed.trend,
      leaderboard: computed.leaderboard,
      teamComparison,
    }
  }

  /**
   * Contract C15: lazy per-user drill-down. The subject is locked to the
   * `userId` ARGUMENT — client-supplied userId/comparisonTeamIds in the
   * filters are stripped before normalization, and the subject must sit
   * inside the caller's visibility scope (NotFound, never a leak).
   */
  async activityUserDrillDown(
    tenantId: string,
    callerUserId: string,
    userId: string,
    input: ActivityReportFilterInput,
    pagination: { page?: number; pageSize?: number } = {},
  ): Promise<ActivityUserDrillDown> {
    const visibilityFilter = await resolveVisibilityFilter(callerUserId, tenantId)
    if (visibilityFilter !== undefined) {
      const allowed =
        typeof visibilityFilter === 'string'
          ? visibilityFilter === userId
          : (visibilityFilter as { in: string[] }).in.includes(userId)
      if (!allowed) {
        throw new NotFoundException('User not found')
      }
    }

    // Strip client-supplied subject/comparison keys — the argument owns the
    // subject (Contract C15).
    const strippedInput: ActivityReportFilterInput = { ...(input ?? {}) }
    delete (strippedInput as Partial<ActivityReportFilterInput>).userId
    delete (strippedInput as Partial<ActivityReportFilterInput>).comparisonTeamIds
    const n = this.validateAndNormalize(strippedInput)

    const scope: ReportScope = { scopeUserIds: null, subjectUserId: userId }
    const { provenance: dealProvenance, taskTruncated } = await this.resolveDealProvenance(
      tenantId,
      callerUserId,
      n,
    )
    const computed = await this.computeOverview(
      tenantId,
      callerUserId,
      n,
      scope,
      dealProvenance,
      taskTruncated,
    )

    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 20, 1), 100)
    const recentWhere = computed.subjectActivityWhere
    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where: recentWhere,
        select: { id: true, type: true, title: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.activity.count({ where: recentWhere }),
    ])

    const userRow = computed.userById.get(userId)
    return {
      user: userRow
        ? {
            id: userRow.id,
            firstName: userRow.firstName,
            lastName: userRow.lastName,
            teamId: userRow.teamId,
          }
        : { id: userId, firstName: '', lastName: '', teamId: null },
      summary: computed.summary,
      activitiesByType: computed.byType,
      activitiesByDate: computed.byDate,
      dealsClosed: computed.dealsClosedByUser.get(userId) ?? 0,
      recentActivities: {
        items: items.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      },
    }
  }

  /**
   * Shared export-path validator/normalizer (Contract E30): the durable
   * snapshot is the pure-normalized, JSON-safe filter shape. Requires the
   * request scope — the method is internal to the export flow; direct
   * invocation without the caller identity is rejected (defensive misuse
   * guard), so export validation can never bypass tenant/user binding.
   */
  __validateForExport(
    input: ActivityReportFilterInput | null | undefined,
    scope?: { tenantId: string; userId: string },
  ): ActivityReportExportSnapshot {
    if (!scope || !scope.tenantId || !scope.userId) {
      throw new BadRequestException('Activity report export validation requires a request scope')
    }
    const normalized = this.normalizePure(input)
    return {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      userId: normalized.userId,
      teamId: normalized.teamId,
      comparisonTeamIds: normalized.comparisonTeamIds,
      activityTypes: normalized.activityTypes,
      contactId: normalized.contactId,
      dealId: normalized.dealId,
      bucket: normalized.bucket,
      sortBy: normalized.sortBy,
    }
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  private validateAndNormalize(input: ActivityReportFilterInput): NormalizedActivityReportFilters {
    return this.normalizePure(input)
  }

  private normalizePure(
    input: ActivityReportFilterInput | null | undefined,
  ): NormalizedActivityReportFilters {
    try {
      return normalizeActivityReportFilters(input)
    } catch (error) {
      if (error instanceof ActivityReportValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }

  // ─── Visibility + filters ──────────────────────────────────────────────────

  /**
   * Contract C12/C15: user scope via `resolveVisibilityFilter` — never a
   * copy. userId/teamId filters narrow the scope; a userId outside the
   * caller's visibility is Forbidden, an unknown team is NotFound, and a
   * userId that does not belong to the team is a BadRequest.
   */
  private async resolveUserScope(
    tenantId: string,
    callerUserId: string,
    n: NormalizedActivityReportFilters,
  ): Promise<ReportScope> {
    const visibilityFilter = await resolveVisibilityFilter(callerUserId, tenantId)
    let scopeUserIds: string[] | null
    if (visibilityFilter === undefined) {
      scopeUserIds = null
    } else if (typeof visibilityFilter === 'string') {
      scopeUserIds = [visibilityFilter]
    } else {
      scopeUserIds = (visibilityFilter as { in: string[] }).in
    }

    if (n.userId) {
      if (scopeUserIds !== null && !scopeUserIds.includes(n.userId)) {
        throw new ForbiddenException(
          "You do not have permission to view this user's activity data.",
        )
      }
      scopeUserIds = [n.userId]
    }

    if (n.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: n.teamId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!team) {
        throw new NotFoundException('Team not found')
      }
      const members = await this.prisma.user.findMany({
        where: { teamId: n.teamId, tenantId, deletedAt: null },
        select: { id: true },
      })
      const memberIds = members.map((m) => m.id)
      if (n.userId && !memberIds.includes(n.userId)) {
        throw new BadRequestException('userId does not belong to teamId')
      }
      if (scopeUserIds !== null) {
        const scopeSet = new Set(scopeUserIds)
        scopeUserIds = memberIds.filter((id) => scopeSet.has(id))
      } else {
        scopeUserIds = memberIds
      }
    }

    return { scopeUserIds }
  }

  /**
   * Contract C14: dealId two-step authorization. The deal is authorized via
   * DealsService.findOne FIRST; the activity scope is direct DEAL provenance
   * OR bounded TASK provenance — never a broaden to Deal.contactId (that
   * would attribute unrelated email/call activity to the deal).
   *
   * M3 (no silent truncation): the task-provenance fetch is bounded to
   * MAX_TEAM_TASK_IDS. When the fetched list length equals the cap the list
   * MAY be truncated (there could be more active tasks) — that MUST be
   * surfaced to the caller via `taskTruncated` so the summary note carries
   * it, instead of silently narrowing the activity scope.
   */
  private async resolveDealProvenance(
    tenantId: string,
    callerUserId: string,
    n: NormalizedActivityReportFilters,
  ): Promise<{ provenance: Prisma.ActivityWhereInput | null; taskTruncated: boolean }> {
    if (!n.dealId) return { provenance: null, taskTruncated: false }
    const deal = await this.dealsService.findOne(tenantId, callerUserId, n.dealId)
    if (n.contactId && deal.contactId !== n.contactId) {
      throw new BadRequestException('dealId does not belong to contactId')
    }
    const tasks = await this.prisma.task.findMany({
      where: { tenantId, dealId: n.dealId, deletedAt: null },
      select: { id: true },
      take: MAX_TEAM_TASK_IDS,
    })
    const taskIds = tasks.map((t) => t.id)
    const or: Prisma.ActivityWhereInput[] = [{ source: 'DEAL', sourceId: n.dealId }]
    if (taskIds.length > 0) {
      or.push({ source: 'TASK', sourceId: { in: taskIds } })
    }
    return {
      provenance: { OR: or },
      taskTruncated: tasks.length === MAX_TEAM_TASK_IDS,
    }
  }

  // ─── Overview aggregates (no N+1 — Contract B7/S9) ─────────────────────────

  private async computeOverview(
    tenantId: string,
    callerUserId: string,
    n: NormalizedActivityReportFilters,
    scope: ReportScope,
    dealProvenance: Prisma.ActivityWhereInput | null,
    taskTruncated = false,
  ): Promise<{
    summary: ActivityReportSummary
    byType: ActivityByTypeRow[]
    byUser: ActivityByUserRow[]
    byDate: ActivityByDateRow[]
    heatmap: HeatmapCell[]
    trend: ActivityTrendPoint[]
    leaderboard: ActivityLeaderboardRow[]
    userById: Map<
      string,
      { id: string; firstName: string; lastName: string; teamId: string | null }
    >
    dealsClosedByUser: Map<string, number>
    subjectActivityWhere: Prisma.ActivityWhereInput
  }> {
    const now = toUtcMidnight(this.clock.now())
    const overdueBound = n.end < now ? n.end : now

    // ── Shared predicates (layered, never re-derived) ────────────────────
    const feedFilter: ActivityFeedFilter = { contactId: n.contactId ?? undefined }
    const activityBase = await this.activitiesService.buildFeedWhere(
      tenantId,
      callerUserId,
      feedFilter,
    )
    const taskBase = await this.tasksService.buildTaskWhere(tenantId, callerUserId, {})
    const timeEntryBase = await this.timeEntriesService.buildTimeEntryWhere(
      tenantId,
      callerUserId,
      {},
    )
    const dealBase = await this.dealsService.buildDealWhere(tenantId, callerUserId, {})

    const userCondition =
      scope.subjectUserId !== undefined
        ? { createdBy: scope.subjectUserId as string }
        : scope.scopeUserIds !== null
          ? { createdBy: { in: scope.scopeUserIds as string[] } }
          : null
    const assigneeCondition =
      scope.subjectUserId !== undefined
        ? { assignedTo: scope.subjectUserId as string }
        : scope.scopeUserIds !== null
          ? { assignedTo: { in: scope.scopeUserIds as string[] } }
          : null
    const entryUserCondition =
      scope.subjectUserId !== undefined
        ? { userId: scope.subjectUserId as string }
        : scope.scopeUserIds !== null
          ? { userId: { in: scope.scopeUserIds as string[] } }
          : null
    const dealOwnerCondition =
      scope.subjectUserId !== undefined
        ? { ownerId: scope.subjectUserId as string }
        : scope.scopeUserIds !== null
          ? { ownerId: { in: scope.scopeUserIds as string[] } }
          : null

    const activityConditions: Prisma.ActivityWhereInput[] = [
      { createdAt: { gte: n.start, lt: n.end } },
    ]
    if (n.activityTypes.length > 0) {
      activityConditions.push({ type: { in: n.activityTypes as ActivityType[] } })
    }
    if (userCondition) activityConditions.push(userCondition)
    if (dealProvenance) activityConditions.push(dealProvenance)
    const activityWhere = this.mergeAnd(activityBase, activityConditions)

    const taskConditions: Prisma.TaskWhereInput[] = []
    if (assigneeCondition) taskConditions.push(assigneeCondition)
    const taskWhere = this.mergeAnd(taskBase, taskConditions)

    const timeEntryConditions: Prisma.TimeEntryWhereInput[] = [
      { endTime: { not: null } }, // running entries excluded (Contract B7/B10)
      { startTime: { gte: n.start, lt: n.end } },
    ]
    if (entryUserCondition) timeEntryConditions.push(entryUserCondition)
    const timeEntryWhere = this.mergeAnd(timeEntryBase, timeEntryConditions)

    const dealConditions: Prisma.DealWhereInput[] = [
      { stage: { isWon: true, deletedAt: null } },
      { actualCloseDate: { gte: n.start, lt: n.end } },
    ]
    if (dealOwnerCondition) dealConditions.push(dealOwnerCondition)
    const dealWhere = this.mergeAnd(dealBase, dealConditions)

    // ── Aggregate batch 1: activities ────────────────────────────────────
    // totalActivities is derived from the scoped byUser groupBy below (same
    // where clause as a raw count; createdBy is NOT NULL so groupBy loses no
    // rows) — a separate totalCount query would be redundant (M2).
    const [meetingsScheduled, byTypeGroups, byUserGroups, activityRows] = await Promise.all([
      this.prisma.activity.count({ where: { ...activityWhere, type: 'MEETING_SCHEDULED' } }),
      this.prisma.activity.groupBy({
        by: ['type'],
        where: activityWhere,
        _count: { _all: true },
      }),
      this.prisma.activity.groupBy({
        by: ['createdBy'],
        where: activityWhere,
        _count: { _all: true },
      }),
      this.prisma.activity.findMany({
        where: activityWhere,
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: ACTIVITY_REPORT_MAX_ROWS + 1,
      }),
    ])

    if (activityRows.length > ACTIVITY_REPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Activity report exceeds ${ACTIVITY_REPORT_MAX_ROWS} rows in this range — narrow the date range.`,
      )
    }

    // ── Aggregate batch 2: tasks / time entries / deals ──────────────────
    const [
      tasksCompleted,
      cohortDenominator,
      cohortNumerator,
      overdueTasks,
      avgRows,
      taskUserGroups,
    ] = await Promise.all([
      this.prisma.task.count({
        where: { ...taskWhere, completedAt: { gte: n.start, lt: n.end } },
      }),
      this.prisma.task.count({
        where: {
          ...taskWhere,
          dueDate: { gte: n.start, lt: n.end },
          status: { notIn: ['CANCELLED'] },
        },
      }),
      this.prisma.task.count({
        where: { ...taskWhere, dueDate: { gte: n.start, lt: n.end }, status: 'COMPLETED' },
      }),
      this.prisma.task.count({
        where: {
          ...taskWhere,
          status: { in: ['TODO', 'IN_PROGRESS'] },
          dueDate: { gte: n.start, lt: overdueBound },
        },
      }),
      this.prisma.task.findMany({
        where: { ...taskWhere, completedAt: { gte: n.start, lt: n.end } },
        select: { createdAt: true, completedAt: true },
        orderBy: { id: 'asc' },
        take: ACTIVITY_REPORT_MAX_ROWS + 1,
      }),
      this.prisma.task.groupBy({
        by: ['assignedTo'],
        where: { ...taskWhere, completedAt: { gte: n.start, lt: n.end } },
        _count: { _all: true },
      }),
    ])

    const [timeAgg, timeUserGroups, dealUserGroups, wonWithNullCloseDate] = await Promise.all([
      this.prisma.timeEntry.aggregate({ where: timeEntryWhere, _sum: { durationSeconds: true } }),
      this.prisma.timeEntry.groupBy({
        by: ['userId'],
        where: timeEntryWhere,
        _sum: { durationSeconds: true },
      }),
      this.prisma.deal.groupBy({ by: ['ownerId'], where: dealWhere, _count: { _all: true } }),
      this.prisma.deal.count({
        where: {
          ...dealBase,
          stage: { isWon: true, deletedAt: null },
          actualCloseDate: null,
          ...(dealOwnerCondition ?? {}),
        },
      }),
    ])

    if (avgRows.length > ACTIVITY_REPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Activity report exceeds ${ACTIVITY_REPORT_MAX_ROWS} completed tasks in this range — narrow the date range.`,
      )
    }

    // ── One batched user label lookup (no N+1 — Contract S9) ─────────────
    const labelIds = new Set<string>()
    for (const group of byUserGroups) if (group.createdBy) labelIds.add(group.createdBy)
    for (const group of taskUserGroups) if (group.assignedTo) labelIds.add(group.assignedTo)
    for (const group of dealUserGroups) if (group.ownerId) labelIds.add(group.ownerId)
    for (const group of timeUserGroups) if (group.userId) labelIds.add(group.userId)
    if (scope.subjectUserId) labelIds.add(scope.subjectUserId)

    const userById = new Map<
      string,
      { id: string; firstName: string; lastName: string; teamId: string | null }
    >()
    if (labelIds.size > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...labelIds] }, tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, teamId: true },
      })
      for (const user of users) {
        userById.set(user.id, {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          teamId: user.teamId,
        })
      }
    }

    // ── Derive day/hour buckets from the bounded activity rows ───────────
    const byDateMap = new Map<string, number>()
    const heatmapMap = new Map<string, number>()
    const trendMap = new Map<string, number>()
    for (const row of activityRows) {
      const day = utcDayKey(row.createdAt)
      byDateMap.set(day, (byDateMap.get(day) ?? 0) + 1)
      const { dayOfWeek, hour } = heatmapKey(row.createdAt)
      const cellKey = `${dayOfWeek}:${hour}`
      heatmapMap.set(cellKey, (heatmapMap.get(cellKey) ?? 0) + 1)
      const trendKey = bucketKey(row.createdAt, n.bucket)
      trendMap.set(trendKey, (trendMap.get(trendKey) ?? 0) + 1)
    }

    const byDate = enumerateUtcDays(n.start, n.end).map((date) => ({
      date,
      count: byDateMap.get(date) ?? 0,
    }))
    const heatmap = enumerateHeatmapCells().map((cell) => ({
      ...cell,
      count: heatmapMap.get(`${cell.dayOfWeek}:${cell.hour}`) ?? 0,
    }))
    const trend = enumerateBuckets(n.start, new Date(n.end.getTime() - 1), n.bucket).map((key) => ({
      bucketStart: new Date(`${key}T00:00:00.000Z`).toISOString(),
      count: trendMap.get(key) ?? 0,
    }))

    // ── Summary ──────────────────────────────────────────────────────────
    // totalActivities = sum of the scoped byUser groupBy — the same where
    // clause as a raw count, but authoritative on the "visible users only"
    // set so a system/foreign createdBy can never inflate the total.
    const totalActivities = byUserGroups.reduce((sum, group) => sum + (group._count?._all ?? 0), 0)
    const attributedCount = byUserGroups.reduce(
      (sum, group) => sum + (userById.has(group.createdBy) ? group._count?._all ?? 0 : 0),
      0,
    )
    const noteParts: string[] = []
    if (cohortDenominator === 0) {
      noteParts.push('Completion rate: no due tasks in range (0/0).')
    }
    if (wonWithNullCloseDate > 0) {
      noteParts.push(
        `${wonWithNullCloseDate} won deal(s) without a close date are not period-attributed.`,
      )
    }
    if (taskTruncated && n.dealId) {
      // M3: the task-provenance fetch hit MAX_TEAM_TASK_IDS — the activity
      // scope may be truncated. Never silent: surface it in the summary note.
      noteParts.push(`activity scope truncated at ${MAX_TEAM_TASK_IDS} tasks for deal ${n.dealId}.`)
    }

    const summary: ActivityReportSummary = {
      totalActivities,
      unattributedActivities: Math.max(totalActivities - attributedCount, 0),
      completionRate: completionRate(cohortNumerator, cohortDenominator),
      completionRateNumerator: cohortNumerator,
      completionRateDenominator: cohortDenominator,
      tasksCompleted,
      avgCompletionTimeHours: avgCompletionHours(
        avgRows
          .filter(
            (row) =>
              row.completedAt instanceof Date &&
              row.createdAt instanceof Date &&
              Number.isFinite(row.completedAt.getTime()) &&
              Number.isFinite(row.createdAt.getTime()),
          )
          .map((row) => row.completedAt!.getTime() - row.createdAt.getTime()),
      ),
      overdueTasks,
      timeTrackedSeconds: timeAgg._sum.durationSeconds ?? 0,
      meetingsScheduled,
      startDate: n.startDate,
      endDate: n.endDate,
      calculationNote: noteParts.join(' '),
    }

    // ── byType / byUser ──────────────────────────────────────────────────
    const byType = byTypeGroups.map((group) => ({
      type: group.type,
      count: group._count?._all ?? 0,
    }))
    const byUser: ActivityByUserRow[] = byUserGroups
      .filter((group) => userById.has(group.createdBy))
      .map((group) => {
        const user = userById.get(group.createdBy)!
        return {
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          teamId: user.teamId,
          count: group._count?._all ?? 0,
        }
      })

    // ── Leaderboard (4 metrics, sortBy desc, tie-break id asc) ───────────
    const activitiesByUserMap = new Map(byUserGroups.map((g) => [g.createdBy, g._count?._all ?? 0]))
    const tasksByUserMap = new Map(taskUserGroups.map((g) => [g.assignedTo, g._count?._all ?? 0]))
    const dealsByUserMap = new Map(dealUserGroups.map((g) => [g.ownerId, g._count?._all ?? 0]))
    const timeByUserMap = new Map(
      timeUserGroups.map((g) => [g.userId, g._sum.durationSeconds ?? 0]),
    )
    const dealsClosedByUser = dealsByUserMap

    type LeaderboardSortable = {
      activitiesLogged: number
      tasksCompleted: number
      dealsClosed: number
      timeTrackedSeconds: number
    }
    const metricKey: Record<ActivityReportSortBy, keyof LeaderboardSortable> = {
      ACTIVITIES: 'activitiesLogged',
      TASKS_COMPLETED: 'tasksCompleted',
      DEALS_CLOSED: 'dealsClosed',
      TIME_TRACKED: 'timeTrackedSeconds',
    }
    const sortMetric = metricKey[n.sortBy]

    const leaderboard: ActivityLeaderboardRow[] = [...userById.values()]
      .map((user) => ({
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        teamId: user.teamId,
        activitiesLogged: activitiesByUserMap.get(user.id) ?? 0,
        tasksCompleted: tasksByUserMap.get(user.id) ?? 0,
        dealsClosed: dealsByUserMap.get(user.id) ?? 0,
        timeTrackedSeconds: timeByUserMap.get(user.id) ?? 0,
        rank: 0,
      }))
      .sort((a, b) => {
        const byMetric = b[sortMetric] - a[sortMetric]
        if (byMetric !== 0) return byMetric
        return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
      })
      .map((row, index) => ({ ...row, rank: index + 1 }))

    return {
      summary,
      byType,
      byUser,
      byDate,
      heatmap,
      trend,
      leaderboard,
      userById,
      dealsClosedByUser,
      subjectActivityWhere: activityWhere,
    }
  }

  // ─── Team comparison (Contract C15/AC11) ───────────────────────────────────

  /**
   * Only the requested teams are returned (never every tenant team). Teams
   * must be tenant-local — an unknown/missing team id is an
   * indistinguishable NotFound. Members outside the caller's visibility
   * scope are excluded from each team's metrics (no leak).
   */
  private async computeTeamComparison(
    tenantId: string,
    callerUserId: string,
    n: NormalizedActivityReportFilters,
    scope: ReportScope,
    dealProvenance: Prisma.ActivityWhereInput | null,
  ): Promise<ActivityTeamComparisonRow[]> {
    const teams = await this.prisma.team.findMany({
      where: { id: { in: n.comparisonTeamIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (teams.length !== n.comparisonTeamIds.length) {
      throw new NotFoundException('Team not found')
    }

    const feedFilter: ActivityFeedFilter = { contactId: n.contactId ?? undefined }
    const activityBase = await this.activitiesService.buildFeedWhere(
      tenantId,
      callerUserId,
      feedFilter,
    )
    const taskBase = await this.tasksService.buildTaskWhere(tenantId, callerUserId, {})
    const timeEntryBase = await this.timeEntriesService.buildTimeEntryWhere(
      tenantId,
      callerUserId,
      {},
    )

    const rows: ActivityTeamComparisonRow[] = []
    for (const team of teams) {
      const members = await this.prisma.user.findMany({
        where: { teamId: team.id, tenantId, deletedAt: null },
        select: { id: true },
      })
      let memberIds = members.map((m) => m.id)
      if (scope.scopeUserIds !== null) {
        const scopeSet = new Set(scope.scopeUserIds)
        memberIds = memberIds.filter((id) => scopeSet.has(id))
      }

      const activityConditions: Prisma.ActivityWhereInput[] = [
        { createdAt: { gte: n.start, lt: n.end } },
        { createdBy: { in: memberIds } },
      ]
      if (n.activityTypes.length > 0) {
        activityConditions.push({ type: { in: n.activityTypes as ActivityType[] } })
      }
      if (dealProvenance) activityConditions.push(dealProvenance)
      const teamActivityWhere = this.mergeAnd(activityBase, activityConditions)
      const teamTaskWhere = this.mergeAnd(taskBase, [{ assignedTo: { in: memberIds } }])
      const teamTimeWhere = this.mergeAnd(timeEntryBase, [
        { userId: { in: memberIds } },
        { endTime: { not: null } },
        { startTime: { gte: n.start, lt: n.end } },
      ])

      const now = toUtcMidnight(this.clock.now())
      const overdueBound = n.end < now ? n.end : now

      const [
        totalActivities,
        meetingsScheduled,
        tasksCompleted,
        cohortDenominator,
        cohortNumerator,
        overdueTasks,
        avgRows,
        timeAgg,
      ] = await Promise.all([
        this.prisma.activity.count({ where: teamActivityWhere }),
        this.prisma.activity.count({ where: { ...teamActivityWhere, type: 'MEETING_SCHEDULED' } }),
        this.prisma.task.count({
          where: { ...teamTaskWhere, completedAt: { gte: n.start, lt: n.end } },
        }),
        this.prisma.task.count({
          where: {
            ...teamTaskWhere,
            dueDate: { gte: n.start, lt: n.end },
            status: { notIn: ['CANCELLED'] },
          },
        }),
        this.prisma.task.count({
          where: { ...teamTaskWhere, dueDate: { gte: n.start, lt: n.end }, status: 'COMPLETED' },
        }),
        this.prisma.task.count({
          where: {
            ...teamTaskWhere,
            status: { in: ['TODO', 'IN_PROGRESS'] },
            dueDate: { gte: n.start, lt: overdueBound },
          },
        }),
        this.prisma.task.findMany({
          where: { ...teamTaskWhere, completedAt: { gte: n.start, lt: n.end } },
          select: { createdAt: true, completedAt: true },
          orderBy: { id: 'asc' },
          take: ACTIVITY_REPORT_MAX_ROWS + 1,
        }),
        this.prisma.timeEntry.aggregate({
          where: teamTimeWhere,
          _sum: { durationSeconds: true },
        }),
      ])

      rows.push({
        teamId: team.id,
        teamName: team.name,
        totalActivities,
        tasksCompleted,
        avgCompletionTimeHours: avgCompletionHours(
          avgRows
            .filter(
              (row) =>
                row.completedAt instanceof Date &&
                row.createdAt instanceof Date &&
                Number.isFinite(row.completedAt.getTime()) &&
                Number.isFinite(row.createdAt.getTime()),
            )
            .map((row) => row.completedAt!.getTime() - row.createdAt.getTime()),
        ),
        overdueTasks,
        timeTrackedSeconds: timeAgg._sum.durationSeconds ?? 0,
        meetingsScheduled,
        completionRate: completionRate(cohortNumerator, cohortDenominator),
      })
    }
    return rows
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Layered AND merge that preserves any predicate AND the shared builder set. */
  private mergeAnd(
    where: Record<string, unknown>,
    conditions: Record<string, unknown>[],
  ): Record<string, unknown> {
    if (conditions.length === 0) return where
    const existing = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
    return { ...where, AND: [...existing, ...conditions] }
  }
}
