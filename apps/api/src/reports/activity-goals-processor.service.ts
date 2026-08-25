/**
 * Story 6.8 (Contract D20-D22): daily activity-goal alert processor.
 *
 * Runs at 07:00 UTC (six-field Nest cron). Every active, non-deleted,
 * already-started goal of every tenant is evaluated against its current
 * period window: `actualCount < expectedPace(targetCount, elapsedFraction)`
 * → exactly one `ACTIVITY_GOAL_AT_RISK` notification per goal/period via
 * `notifySafe` with `dedupeKey = activity-goal-at-risk:<goalId>:<periodStart
 * YYYY-MM-DD>` — the Notification.dedupeKey unique index makes reruns and
 * concurrent instances idempotent (P2002 is swallowed inside notifySafe).
 *
 * No N+1: qualifying counts are one `activity.groupBy` per distinct period
 * window per goal batch (pattern CustomerAnalyticsProcessor). Failure is
 * isolated per batch/goal — a failed batch is counted and logged with
 * tenant/batch identifiers only (never PII) and processing continues.
 */
import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import {
  goalPeriodWindow,
  isFallingBehind,
  expectedPace,
  round1,
  utcDayKey,
} from './activity-report-metrics'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'

export const ACTIVITY_GOAL_PROCESSOR_DEFAULT_BATCH_SIZE = 500
export const ACTIVITY_GOAL_PROCESSOR_DEFAULT_CONCURRENCY = 4
const TENANT_BATCH_SIZE = 1000

export type ActivityGoalProcessorResult = {
  tenants: number
  goalsSucceeded: number
  goalsFailed: number
  notificationsCreated: number
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const current = index++
        if (current >= items.length) return
        results[current] = await worker(items[current]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

const GOAL_ROW_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  activityType: true,
  targetCount: true,
  period: true,
  userId: true,
  startsOn: true,
  isActive: true,
  createdBy: true,
} as const

type GoalRow = Prisma.ActivityGoalGetPayload<{ select: typeof GOAL_ROW_SELECT }>

@Injectable()
export class ActivityGoalProcessor {
  private readonly logger = new Logger(ActivityGoalProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    // Injectable clock/bounds for deterministic tests; defaults to system.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
    @Optional() private readonly batchSize: number = ACTIVITY_GOAL_PROCESSOR_DEFAULT_BATCH_SIZE,
    @Optional() private readonly concurrency: number = ACTIVITY_GOAL_PROCESSOR_DEFAULT_CONCURRENCY,
  ) {}

  /** Daily 07:00 UTC evaluation (six-field Nest cron — Contract D20). */
  @Cron('0 0 7 * * *')
  async runDaily(): Promise<ActivityGoalProcessorResult> {
    const now = this.clock.now()
    const summary: ActivityGoalProcessorResult = {
      tenants: 0,
      goalsSucceeded: 0,
      goalsFailed: 0,
      notificationsCreated: 0,
    }

    for await (const tenantIds of this.readTenantIdBatches()) {
      summary.tenants += tenantIds.length
      await mapWithConcurrency(tenantIds, this.concurrency, async (tenantId) => {
        try {
          await this.processTenant(tenantId, now, summary)
        } catch (error) {
          // Per-tenant failure isolation (Contract D21): log, count, continue.
          this.logger.error(
            `Activity goal processor tenant ${tenantId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      })
    }

    this.logger.log(
      `Activity goal run complete: ${summary.tenants} tenant(s), ` +
        `${summary.goalsSucceeded} goal(s) succeeded, ${summary.goalsFailed} failed, ` +
        `${summary.notificationsCreated} notification(s) created`,
    )
    return summary
  }

  private async *readTenantIdBatches(): AsyncGenerator<string[]> {
    let offset = 0
    for (;;) {
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        skip: offset,
        take: TENANT_BATCH_SIZE,
      })
      if (tenants.length === 0) return
      yield tenants.map((t) => t.id)
      offset += tenants.length
    }
  }

  private async processTenant(
    tenantId: string,
    now: Date,
    summary: ActivityGoalProcessorResult,
  ): Promise<void> {
    let offset = 0
    for (;;) {
      // Active, non-deleted, already-started goals in stable (createdAt, id)
      // order — deterministic across runs (Contract D22).
      const goals = await this.prisma.activityGoal.findMany({
        where: { tenantId, isActive: true, deletedAt: null, startsOn: { lte: now } },
        select: GOAL_ROW_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: this.batchSize,
      })
      if (goals.length === 0) return

      // One grouped aggregate load per batch — never per-goal (no N+1).
      let counts: Map<string, number>
      try {
        counts = await this.loadQualifyingCounts(tenantId, goals, now)
      } catch (error) {
        summary.goalsFailed += goals.length
        this.logger.error(
          `Activity goal batch failed [tenant=${tenantId}, offset=${offset}, count=${goals.length}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        offset += goals.length
        continue
      }

      const results = await mapWithConcurrency(goals, this.concurrency, (goal) =>
        this.processGoal(tenantId, goal, counts, now, summary),
      )
      summary.goalsSucceeded += results.filter((r) => r).length
      offset += goals.length
    }
  }

  /**
   * Contract D21: qualifying counts per goal via `activity.groupBy` — one
   * query per DISTINCT period window per batch (WEEKLY windows anchored on
   * startsOn, MONTHLY calendar months; goals sharing a window share the
   * query). Returns goalId → qualifying count.
   */
  private async loadQualifyingCounts(
    tenantId: string,
    goals: GoalRow[],
    now: Date,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
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
        if (goal.activityType === null) {
          const prefix = `${goal.userId}|`
          let qualifying = 0
          for (const [pair, count] of byUserType) {
            if (pair.startsWith(prefix)) qualifying += count
          }
          counts.set(goal.id, qualifying)
        } else {
          counts.set(goal.id, byUserType.get(`${goal.userId}|${goal.activityType}`) ?? 0)
        }
      }
    }
    return counts
  }

  /**
   * Contract D21/D22: falling-behind check + one deduped notification per
   * goal/period. No alert when the period just started (elapsedFraction 0) or
   * when the goal is on/above pace. notifySafe never throws — a P2002 on the
   * dedupe key (rerun/concurrent) is an idempotent success.
   */
  private async processGoal(
    tenantId: string,
    goal: GoalRow,
    counts: Map<string, number>,
    now: Date,
    summary: ActivityGoalProcessorResult,
  ): Promise<boolean> {
    try {
      const window = goalPeriodWindow(goal.startsOn, goal.period, now)
      const periodLengthMs = window.end.getTime() - window.start.getTime()
      const elapsedFraction = Math.min(
        Math.max((now.getTime() - window.start.getTime()) / periodLengthMs, 0),
        1,
      )
      const actual = counts.get(goal.id) ?? 0
      const expected = expectedPace(goal.targetCount, elapsedFraction)

      if (elapsedFraction > 0 && isFallingBehind(actual, expected)) {
        const progress = Math.min(Math.max(actual / goal.targetCount, 0), 1)
        const progressPercent = round1(progress * 100)
        const periodStartKey = utcDayKey(window.start)
        // notifySafe returns true ONLY when a row was actually created; a
        // P2002 dedupe on the same dedupeKey (rerun/concurrent instance)
        // returns false — that must not over-count the summary (M5).
        const created = await this.notificationsService.notifySafe(
          tenantId,
          goal.createdBy || 'system',
          {
            recipientUserId: goal.userId,
            type: 'ACTIVITY_GOAL_AT_RISK',
            title: `Activity goal behind: ${goal.name}`,
            body:
              `Activity goal "${goal.name}" is behind pace: ${actual} of ${goal.targetCount} ` +
              `(${progressPercent}%) in this ${goal.period.toLowerCase()} period.`,
            dedupeKey: `activity-goal-at-risk:${goal.id}:${periodStartKey}`,
          },
        )
        if (created) {
          summary.notificationsCreated += 1
        }
      }
      return true
    } catch (error) {
      // Per-goal failure isolation — identifiers only, never PII.
      summary.goalsFailed += 1
      this.logger.error(
        `Activity goal processor goal failed [tenant=${tenantId}, goal=${goal.id}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return false
    }
  }
}
