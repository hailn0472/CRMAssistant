/**
 * Story 6.8 (Contract D17-D18): activity goals CRUD + server-computed
 * progress.
 *
 * Validation: name non-empty <= 200 chars, targetCount int 1..10_000, period
 * WEEKLY|MONTHLY, activityType from the closed ActivityType vocabulary (null
 * = TOTAL), startsOn a UTC midnight, subject user active in the tenant AND
 * inside the caller's visibility scope. One active goal per
 * (user, period, activityType) — service check + race-safe partial unique
 * index (P2002 → ConflictException, never check-then-create alone).
 *
 * Progress is server-owned: qualifyingCount = Activity rows
 * (tenantId, createdBy = goal.userId, type = goal.activityType ?? any,
 * createdAt inside goalPeriodWindow(startsOn, period, now)); progress =
 * clamp(qualifying / target, 0, 1); progressPercent = round1(progress*100).
 * List progress is computed with one groupBy per distinct period window —
 * never per-goal queries (no N+1, Contract S9).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ActivityType, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'
import {
  ACTIVITY_GOAL_PERIODS,
  ACTIVITY_TYPES,
  goalPeriodWindow,
  round1,
  toUtcMidnight,
  type ActivityGoalPeriod,
} from './activity-report-metrics'

// ─── Bounds (Contract A5/D17) ────────────────────────────────────────────────

export const ACTIVITY_GOAL_NAME_MAX_LENGTH = 200
export const ACTIVITY_GOAL_TARGET_MIN = 1
export const ACTIVITY_GOAL_TARGET_MAX = 10_000

// ─── Typed result contract (ref/select lockstep — Contract C16) ─────────────

export type ActivityGoalView = {
  id: string
  name: string
  activityType: string | null
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
  user: { id: string; firstName: string; lastName: string } | null
}

export type ActivityGoalConnection = {
  items: ActivityGoalView[]
  total: number
  page: number
  pageSize: number
}

export type ActivityGoalFilterInput = {
  userId?: string | null
  activityType?: string | null
  period?: ActivityGoalPeriod | null
  activeOnly?: boolean | null
}

export type CreateActivityGoalInput = {
  name: string
  activityType?: string | null
  targetCount: number
  period: ActivityGoalPeriod
  userId: string
  startsOn: string
}

export type UpdateActivityGoalInput = {
  name?: string | null
  activityType?: string | null
  targetCount?: number | null
  period?: ActivityGoalPeriod | null
  startsOn?: string | null
  isActive?: boolean | null
}

const GOAL_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  activityType: true,
  targetCount: true,
  period: true,
  userId: true,
  startsOn: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
} as const

type GoalRow = Prisma.ActivityGoalGetPayload<{ select: typeof GOAL_SELECT }>

@Injectable()
export class ActivityGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    // Injectable clock (deterministic progress windows in tests; Contract
    // D20 house Clock shape `{ now() }` — never a bare function).
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  // ─── List + progress (Contract D17/D18) ───────────────────────────────────

  async activityGoals(
    tenantId: string,
    callerUserId: string,
    filter: ActivityGoalFilterInput = {},
    pagination: { page?: number; pageSize?: number } = {},
  ): Promise<ActivityGoalConnection> {
    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 20, 1), 100)

    const where: Prisma.ActivityGoalWhereInput = { tenantId, deletedAt: null }

    // Contract D17/S4: the list never returns goals whose SUBJECT is outside
    // the caller's visibility scope (ADMIN/ALL unrestricted).
    const visibilityFilter = await resolveVisibilityFilter(callerUserId, tenantId)
    const scopeIds =
      visibilityFilter === undefined
        ? null
        : typeof visibilityFilter === 'string'
          ? [visibilityFilter]
          : (visibilityFilter as { in: string[] }).in
    if (scopeIds !== null) {
      if (filter.userId && !scopeIds.includes(filter.userId)) {
        // Out-of-scope subject requested — indistinguishable empty result.
        return { items: [], total: 0, page, pageSize }
      }
      where.userId = filter.userId ?? { in: scopeIds }
    } else if (filter.userId) {
      where.userId = filter.userId
    }
    if (filter.activityType) where.activityType = filter.activityType as ActivityType
    if (filter.period) where.period = filter.period
    if (filter.activeOnly === true) where.isActive = true

    const [rows, total] = await Promise.all([
      this.prisma.activityGoal.findMany({
        where,
        select: GOAL_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.activityGoal.count({ where }),
    ])

    const [progressById, userById] = await Promise.all([
      this.computeProgress(tenantId, rows),
      this.loadUserLabels(tenantId, rows),
    ])

    return {
      items: rows.map((goal) =>
        this.toView(goal, progressById.get(goal.id), userById.get(goal.userId) ?? null),
      ),
      total,
      page,
      pageSize,
    }
  }

  // ─── Mutations (Contract D17) ──────────────────────────────────────────────

  async createActivityGoal(
    tenantId: string,
    callerUserId: string,
    input: CreateActivityGoalInput,
  ): Promise<ActivityGoalView> {
    const validated = this.validateCreateInput(input)
    await this.assertSubjectVisible(tenantId, callerUserId, validated.userId)

    await this.assertNoDuplicateActiveGoal(tenantId, {
      userId: validated.userId,
      period: validated.period,
      activityType: validated.activityType,
    })

    let goal: GoalRow
    try {
      goal = await this.prisma.activityGoal.create({
        data: {
          tenantId,
          name: validated.name,
          activityType: validated.activityType as ActivityType | null,
          targetCount: validated.targetCount,
          period: validated.period,
          userId: validated.userId,
          startsOn: validated.startsOn,
          createdBy: callerUserId,
          updatedBy: callerUserId,
        },
        select: GOAL_SELECT,
      })
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'An active goal already exists for this user, period and activity type',
        )
      }
      throw error
    }

    const [progress, users] = await Promise.all([
      this.computeProgress(tenantId, [goal]),
      this.loadUserLabels(tenantId, [goal]),
    ])
    return this.toView(goal, progress.get(goal.id), users.get(goal.userId) ?? null)
  }

  async updateActivityGoal(
    tenantId: string,
    callerUserId: string,
    id: string,
    input: UpdateActivityGoalInput,
  ): Promise<ActivityGoalView> {
    const goal = await this.findOwnedGoal(tenantId, id)
    await this.assertSubjectVisible(tenantId, callerUserId, goal.userId)

    const validated = this.validateUpdateInput(input, goal)

    await this.assertNoDuplicateActiveGoal(tenantId, {
      excludeId: goal.id,
      userId: goal.userId,
      period: validated.period ?? goal.period,
      activityType:
        validated.activityType !== undefined ? validated.activityType : goal.activityType,
    })

    let updated: GoalRow
    try {
      updated = await this.prisma.activityGoal.update({
        where: { id: goal.id },
        data: {
          ...(validated.name !== undefined ? { name: validated.name } : {}),
          ...(validated.activityType !== undefined
            ? { activityType: validated.activityType as ActivityType | null }
            : {}),
          ...(validated.targetCount !== undefined ? { targetCount: validated.targetCount } : {}),
          ...(validated.period !== undefined ? { period: validated.period } : {}),
          ...(validated.startsOn !== undefined ? { startsOn: validated.startsOn } : {}),
          ...(validated.isActive !== undefined ? { isActive: validated.isActive } : {}),
          updatedBy: callerUserId,
        },
        select: GOAL_SELECT,
      })
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'An active goal already exists for this user, period and activity type',
        )
      }
      throw error
    }

    const [progress, users] = await Promise.all([
      this.computeProgress(tenantId, [updated]),
      this.loadUserLabels(tenantId, [updated]),
    ])
    return this.toView(updated, progress.get(updated.id), users.get(updated.userId) ?? null)
  }

  async deleteActivityGoal(tenantId: string, callerUserId: string, id: string): Promise<boolean> {
    const goal = await this.findOwnedGoal(tenantId, id)
    await this.assertSubjectVisible(tenantId, callerUserId, goal.userId)
    const result = await this.prisma.activityGoal.updateMany({
      where: { id: goal.id, tenantId, deletedAt: null },
      data: { deletedAt: this.clock.now(), updatedBy: callerUserId },
    })
    return (result?.count ?? 0) === 1
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  private validateCreateInput(input: CreateActivityGoalInput): {
    name: string
    activityType: string | null
    targetCount: number
    period: ActivityGoalPeriod
    userId: string
    startsOn: Date
  } {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Goal input is required')
    }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length === 0 || name.length > ACTIVITY_GOAL_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `Goal name must be 1..${ACTIVITY_GOAL_NAME_MAX_LENGTH} characters`,
      )
    }
    const targetCount = input.targetCount
    if (
      !Number.isInteger(targetCount) ||
      targetCount < ACTIVITY_GOAL_TARGET_MIN ||
      targetCount > ACTIVITY_GOAL_TARGET_MAX
    ) {
      throw new BadRequestException(
        `targetCount must be an integer between ${ACTIVITY_GOAL_TARGET_MIN} and ${ACTIVITY_GOAL_TARGET_MAX}`,
      )
    }
    const period = this.validatePeriod(input.period)
    const activityType = this.validateActivityType(input.activityType)
    if (typeof input.userId !== 'string' || input.userId.length === 0) {
      throw new BadRequestException('userId is required')
    }
    const startsOn = this.validateStartsOn(input.startsOn)
    return { name, activityType, targetCount, period, userId: input.userId, startsOn }
  }

  private validateUpdateInput(
    input: UpdateActivityGoalInput,
    goal: GoalRow,
  ): {
    name?: string
    activityType?: string | null
    targetCount?: number
    period?: ActivityGoalPeriod
    startsOn?: Date
    isActive?: boolean
  } {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Goal input is required')
    }
    const out: {
      name?: string
      activityType?: string | null
      targetCount?: number
      period?: ActivityGoalPeriod
      startsOn?: Date
      isActive?: boolean
    } = {}
    if (input.name !== undefined && input.name !== null) {
      const name = String(input.name).trim()
      if (name.length === 0 || name.length > ACTIVITY_GOAL_NAME_MAX_LENGTH) {
        throw new BadRequestException(
          `Goal name must be 1..${ACTIVITY_GOAL_NAME_MAX_LENGTH} characters`,
        )
      }
      out.name = name
    }
    if (input.targetCount !== undefined && input.targetCount !== null) {
      if (
        !Number.isInteger(input.targetCount) ||
        input.targetCount < ACTIVITY_GOAL_TARGET_MIN ||
        input.targetCount > ACTIVITY_GOAL_TARGET_MAX
      ) {
        throw new BadRequestException(
          `targetCount must be an integer between ${ACTIVITY_GOAL_TARGET_MIN} and ${ACTIVITY_GOAL_TARGET_MAX}`,
        )
      }
      out.targetCount = input.targetCount
    }
    if (input.period !== undefined && input.period !== null) {
      out.period = this.validatePeriod(input.period)
    }
    if (input.activityType !== undefined) {
      out.activityType = this.validateActivityType(input.activityType ?? null)
    }
    if (input.startsOn !== undefined && input.startsOn !== null) {
      out.startsOn = this.validateStartsOn(input.startsOn)
    }
    if (input.isActive !== undefined && input.isActive !== null) {
      if (typeof input.isActive !== 'boolean') {
        throw new BadRequestException('isActive must be a boolean')
      }
      out.isActive = input.isActive
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestException('At least one updateable field is required')
    }
    void goal
    return out
  }

  private validatePeriod(period: unknown): ActivityGoalPeriod {
    if (
      typeof period !== 'string' ||
      !(ACTIVITY_GOAL_PERIODS as readonly string[]).includes(period)
    ) {
      throw new BadRequestException(`period must be one of ${ACTIVITY_GOAL_PERIODS.join(', ')}`)
    }
    return period as ActivityGoalPeriod
  }

  private validateActivityType(activityType: unknown): string | null {
    if (activityType === undefined || activityType === null) return null
    if (
      typeof activityType !== 'string' ||
      !(ACTIVITY_TYPES as readonly string[]).includes(activityType)
    ) {
      throw new BadRequestException(`activityType must be a valid ActivityType or null`)
    }
    return activityType
  }

  private validateStartsOn(startsOn: unknown): Date {
    if (typeof startsOn !== 'string' || startsOn.length === 0) {
      throw new BadRequestException('startsOn must be a valid ISO datetime')
    }
    const date = new Date(startsOn)
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('startsOn must be a valid ISO datetime')
    }
    if (toUtcMidnight(date).getTime() !== date.getTime()) {
      throw new BadRequestException('startsOn must be a UTC midnight (00:00:00.000Z)')
    }
    return date
  }

  // ─── Access guards ─────────────────────────────────────────────────────────

  private async findOwnedGoal(tenantId: string, id: string): Promise<GoalRow> {
    const goal = await this.prisma.activityGoal.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: GOAL_SELECT,
    })
    if (!goal) {
      throw new NotFoundException('Activity goal not found')
    }
    return goal
  }

  /** Contract D17/S4: the goal SUBJECT must sit inside the caller's scope. */
  private async assertSubjectVisible(
    tenantId: string,
    callerUserId: string,
    subjectUserId: string,
  ): Promise<void> {
    const subject = await this.prisma.user.findFirst({
      where: { id: subjectUserId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (!subject) {
      throw new NotFoundException('User not found')
    }
    const visibilityFilter = await resolveVisibilityFilter(callerUserId, tenantId)
    if (visibilityFilter !== undefined) {
      const allowed =
        typeof visibilityFilter === 'string'
          ? visibilityFilter === subjectUserId
          : (visibilityFilter as { in: string[] }).in.includes(subjectUserId)
      if (!allowed) {
        throw new ForbiddenException(
          'You do not have permission to manage activity goals for this user',
        )
      }
    }
  }

  private async assertNoDuplicateActiveGoal(
    tenantId: string,
    probe: {
      excludeId?: string
      userId: string
      period: ActivityGoalPeriod
      activityType: string | null
    },
  ): Promise<void> {
    const existing = await this.prisma.activityGoal.findFirst({
      where: {
        tenantId,
        userId: probe.userId,
        period: probe.period,
        activityType: probe.activityType as ActivityType | null,
        isActive: true,
        deletedAt: null,
        ...(probe.excludeId ? { id: { not: probe.excludeId } } : {}),
      },
      select: { id: true },
    })
    if (existing) {
      throw new BadRequestException(
        'An active goal already exists for this user, period and activity type',
      )
    }
  }

  // ─── Progress (server-computed, batched — Contract D18/S9) ─────────────────

  private async computeProgress(
    tenantId: string,
    goals: GoalRow[],
  ): Promise<Map<string, { qualifyingCount: number; progress: number; progressPercent: number }>> {
    const result = new Map<
      string,
      { qualifyingCount: number; progress: number; progressPercent: number }
    >()
    if (goals.length === 0) return result

    const now = this.clock.now()
    // Group goals by their current period window so ONE groupBy per window
    // covers every goal sharing it (typically a single query per page).
    const byWindow = new Map<string, GoalRow[]>()
    for (const goal of goals) {
      const window = goalPeriodWindow(goal.startsOn, goal.period, now)
      const key = `${window.start.toISOString()}|${window.end.toISOString()}`
      const bucket = byWindow.get(key) ?? []
      bucket.push(goal)
      byWindow.set(key, bucket)
    }

    for (const [key, windowGoals] of byWindow) {
      const separator = key.indexOf('|')
      const start = new Date(key.slice(0, separator))
      const end = new Date(key.slice(separator + 1))
      const userIds = [...new Set(windowGoals.map((goal) => goal.userId))]
      const groups = await this.prisma.activity.groupBy({
        by: ['createdBy', 'type'],
        where: { tenantId, createdBy: { in: userIds }, createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      })
      const byUserType = new Map<string, number>()
      for (const group of groups) {
        byUserType.set(`${group.createdBy}|${group.type}`, group._count?._all ?? 0)
      }
      for (const goal of windowGoals) {
        let qualifyingCount = 0
        if (goal.activityType === null) {
          const prefix = `${goal.userId}|`
          for (const [keyValue, count] of byUserType) {
            if (keyValue.startsWith(prefix)) qualifyingCount += count
          }
        } else {
          qualifyingCount = byUserType.get(`${goal.userId}|${goal.activityType}`) ?? 0
        }
        const progress = Math.min(Math.max(qualifyingCount / goal.targetCount, 0), 1)
        result.set(goal.id, {
          qualifyingCount,
          progress,
          progressPercent: round1(progress * 100),
        })
      }
    }
    return result
  }

  private async loadUserLabels(
    tenantId: string,
    goals: GoalRow[],
  ): Promise<Map<string, { id: string; firstName: string; lastName: string }>> {
    const userIds = [...new Set(goals.map((goal) => goal.userId))]
    if (userIds.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    return new Map(users.map((user) => [user.id, user]))
  }

  private toView(
    goal: GoalRow,
    progress: { qualifyingCount: number; progress: number; progressPercent: number } | undefined,
    user: { id: string; firstName: string; lastName: string } | null,
  ): ActivityGoalView {
    return {
      id: goal.id,
      name: goal.name,
      activityType: goal.activityType,
      targetCount: goal.targetCount,
      period: goal.period,
      userId: goal.userId,
      startsOn: goal.startsOn.toISOString(),
      isActive: goal.isActive,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
      qualifyingCount: progress?.qualifyingCount ?? 0,
      progress: progress?.progress ?? 0,
      progressPercent: progress?.progressPercent ?? 0,
      user,
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    // House pattern (segments/permissions): on ActivityGoal create/update a
    // P2002 can only come from the race-safe partial unique index (ids are
    // generated client-side) — map it to ConflictException.
    return error instanceof PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
