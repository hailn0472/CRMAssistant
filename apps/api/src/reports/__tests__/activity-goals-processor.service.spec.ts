/**
 * Story 6.8 (Contract D20-D22, F34): ActivityGoalProcessor unit tests with
 * mocked Prisma + NotificationsService. Focus: the exact 07:00 UTC cron,
 * per-tenant batching (take=batchSize, stable order), grouped window counts
 * (no N+1), the strict falling-behind threshold, one deduped notification
 * per goal/period (P2002 = idempotent success), no-alert on period start /
 * on-pace goals, not-started/inactive/deleted skips, per-batch failure
 * isolation and a deterministic injectable clock.
 */
import { ActivityGoalProcessor } from '../activity-goals-processor.service'

const TENANT_1 = 'tenant-1'
const TENANT_2 = 'tenant-2'
const GOAL_1 = 'goal-1'
const GOAL_2 = 'goal-2'
const SUBJECT_1 = 'user-rep1'
const SUBJECT_2 = 'user-rep2'

function goalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GOAL_1,
    tenantId: TENANT_1,
    name: '50 calls per week',
    activityType: 'CALL_MADE',
    targetCount: 50,
    period: 'WEEKLY',
    userId: SUBJECT_1,
    startsOn: new Date('2026-08-19T00:00:00.000Z'), // Wednesday anchor
    isActive: true,
    createdBy: 'user-manager',
    ...overrides,
  }
}

function makeProcessor(nowIso = '2026-08-22T07:00:00.000Z'): {
  processor: ActivityGoalProcessor
  prisma: {
    tenant: { findMany: jest.Mock }
    activityGoal: { findMany: jest.Mock }
    activity: { groupBy: jest.Mock }
  }
  notificationsService: { notifySafe: jest.Mock }
  clock: { now: () => Date }
} {
  const prisma = {
    tenant: { findMany: jest.fn() },
    activityGoal: { findMany: jest.fn() },
    activity: { groupBy: jest.fn() },
  }
  const notificationsService = { notifySafe: jest.fn().mockResolvedValue(true) }
  const clock = { now: (): Date => new Date(nowIso) }
  const processor = new ActivityGoalProcessor(
    prisma as never,
    notificationsService as never,
    clock,
    500,
    4,
  )
  return { processor, prisma, notificationsService, clock }
}

describe('ActivityGoalProcessor', () => {
  it('registers the daily 07:00 UTC cron (6-field)', () => {
    const meta = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ActivityGoalProcessor.prototype.runDaily,
    ) as { cronTime: string }
    expect(meta.cronTime).toBe('0 0 7 * * *')
  })

  it('evaluates every tenant in batches and notifies once when behind pace', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany
      .mockResolvedValueOnce([{ id: TENANT_1 }, { id: TENANT_2 }])
      .mockResolvedValueOnce([])
    // tenant-1: goal-1 behind (4 of 50 calls by day 4 of 7 → expected 28.6); tenant-2: on pace.
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([goalRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([goalRow({ id: GOAL_2, tenantId: TENANT_2, userId: SUBJECT_2 })])
      .mockResolvedValueOnce([])
    // window 2026-08-19..08-26 for both tenants' goals (same anchor).
    prisma.activity.groupBy
      .mockResolvedValueOnce([{ createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ createdBy: SUBJECT_2, type: 'CALL_MADE', _count: { _all: 40 } }])

    const summary = await processor.runDaily()

    expect(summary.tenants).toBe(2)
    expect(summary.goalsSucceeded).toBe(2)
    expect(summary.goalsFailed).toBe(0)
    expect(summary.notificationsCreated).toBe(1)
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
    const call = notificationsService.notifySafe.mock.calls[0]!
    expect(call[0]).toBe(TENANT_1)
    expect(call[2]).toMatchObject({
      recipientUserId: SUBJECT_1,
      type: 'ACTIVITY_GOAL_AT_RISK',
      title: 'Activity goal behind: 50 calls per week',
      dedupeKey: 'activity-goal-at-risk:goal-1:2026-08-19',
    })
    expect(call[2].body).toContain('4 of 50')
  })

  it('does not notify on-pace goals and never alerts at period start', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    // On pace: 40 >= expected 28.6 → no alert.
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([goalRow({ activityType: null })]) // TOTAL goal, 40 of all types
      .mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([
      { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 40 } },
    ])
    const summary = await processor.runDaily()
    expect(summary.notificationsCreated).toBe(0)
    expect(notificationsService.notifySafe).not.toHaveBeenCalled()

    // Period start: now == window start exactly → elapsedFraction 0 → no
    // alert even when actual (0) is below the target.
    const {
      processor: p2,
      prisma: prisma2,
      notificationsService: notify2,
    } = makeProcessor('2026-08-19T00:00:00.000Z')
    prisma2.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma2.activityGoal.findMany.mockResolvedValueOnce([goalRow()]).mockResolvedValueOnce([])
    prisma2.activity.groupBy.mockResolvedValue([])
    await p2.runDaily()
    expect(notify2.notifySafe).not.toHaveBeenCalled()
  })

  it('skips not-started, inactive and soft-deleted goals (query predicate)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany.mockResolvedValue([]) // nothing started/active
    const summary = await processor.runDaily()
    expect(prisma.activityGoal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_1,
          isActive: true,
          deletedAt: null,
          startsOn: { lte: new Date('2026-08-22T07:00:00.000Z') },
        }),
      }),
    )
    expect(summary.goalsSucceeded).toBe(0)
    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
  })

  it('is idempotent per goal/period: identical dedupeKey across reruns', async () => {
    // notifySafe never throws in production (it swallows P2002 on the
    // Notification.dedupeKey unique index) — idempotency is the SAME
    // deterministic dedupe identity `activity-goal-at-risk:<goalId>:<periodStart>`.
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    for (let run = 0; run < 2; run += 1) {
      prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
      prisma.activityGoal.findMany.mockResolvedValueOnce([goalRow()]).mockResolvedValueOnce([])
      prisma.activity.groupBy.mockResolvedValue([
        { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } },
      ])
      await processor.runDaily() // rerun — same goal/period
    }

    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(2)
    const keys = notificationsService.notifySafe.mock.calls.map((call) => call[2].dedupeKey)
    expect(keys).toEqual([
      'activity-goal-at-risk:goal-1:2026-08-19',
      'activity-goal-at-risk:goal-1:2026-08-19',
    ])
  })

  it('does NOT count a deduped notification (notifySafe=false) in notificationsCreated (M5)', async () => {
    // Rerun of the same period: the DB dedupeKey already exists, so notifySafe
    // returns false (row NOT created). The summary must not over-count.
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany.mockResolvedValueOnce([goalRow()]).mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([
      { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } },
    ])
    notificationsService.notifySafe.mockResolvedValue(false) // deduped — no row created

    const summary = await processor.runDaily()
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
    expect(summary.goalsSucceeded).toBe(1)
    expect(summary.notificationsCreated).toBe(0) // dedupe must NOT increment
  })

  it('counts only actually-created notifications across a mixed run (M5)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([goalRow({ id: GOAL_1 }), goalRow({ id: GOAL_2 })])
      .mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([
      { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } },
    ])
    // goal-1 created a row; goal-2 was deduped on the same period rerun.
    notificationsService.notifySafe.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const summary = await processor.runDaily()
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(2)
    expect(summary.notificationsCreated).toBe(1)
  })

  it('counts a throwing notifySafe as a goal failure and continues (isolation)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([goalRow({ id: GOAL_1 }), goalRow({ id: GOAL_2 })])
      .mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([
      { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } },
    ])
    notificationsService.notifySafe.mockRejectedValueOnce(new Error('boom'))
    const summary = await processor.runDaily()
    expect(summary.goalsFailed).toBe(1) // failing goal isolated
    expect(summary.goalsSucceeded).toBe(1) // second goal still processed
    expect(summary.notificationsCreated).toBe(1)
  })

  it('isolates a failed aggregate batch: counts goals failed and continues', async () => {
    const { processor, prisma, notificationsService } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    // batch 1 (2 goals) fails aggregate load; batch 2 (1 goal) succeeds.
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([goalRow(), goalRow({ id: GOAL_2 })])
      .mockResolvedValueOnce([goalRow({ id: 'goal-3' })])
      .mockResolvedValueOnce([])
    prisma.activity.groupBy
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce([{ createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 4 } }])

    const summary = await processor.runDaily()
    expect(summary.goalsFailed).toBe(2) // whole failed batch counted
    expect(summary.goalsSucceeded).toBe(1)
    expect(summary.notificationsCreated).toBe(1)
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
  })

  it('batches goals with stable order and take = batchSize (no N+1)', async () => {
    const { processor, prisma } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany.mockResolvedValue([])
    await processor.runDaily()
    expect(prisma.activityGoal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 500,
      }),
    )
    // groupBy never called with no goals; one query per window when goals exist.
  })

  it('uses ONE grouped window aggregate for goals sharing a window (no N+1)', async () => {
    const { processor, prisma } = makeProcessor('2026-08-22T07:00:00.000Z')
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT_1 }]).mockResolvedValueOnce([])
    prisma.activityGoal.findMany
      .mockResolvedValueOnce([
        goalRow({ id: 'goal-a', activityType: 'CALL_MADE' }),
        goalRow({
          id: 'goal-b',
          activityType: 'EMAIL_SENT',
          startsOn: new Date('2026-08-19T00:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([
      { createdBy: SUBJECT_1, type: 'CALL_MADE', _count: { _all: 3 } },
      { createdBy: SUBJECT_1, type: 'EMAIL_SENT', _count: { _all: 2 } },
    ])
    await processor.runDaily()
    // both goals share the same WEEKLY window → exactly one groupBy call.
    expect(prisma.activity.groupBy).toHaveBeenCalledTimes(1)
    expect(prisma.activity.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['createdBy', 'type'],
        where: expect.objectContaining({
          tenantId: TENANT_1,
          createdAt: {
            gte: new Date('2026-08-19T00:00:00.000Z'),
            lt: new Date('2026-08-26T00:00:00.000Z'),
          },
        }),
        _count: { _all: true },
      }),
    )
  })
})
