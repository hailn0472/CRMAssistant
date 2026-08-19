/**
 * Story 6.7 (Contract C16–C25, F47): daily bounded analytics processor.
 * Exercises tenant/contact batching, fixed per-batch aggregate query shape
 * (no N+1), UTC snapshot date, idempotent current+snapshot materialization,
 * P2034/P2002 bounded retry, HIGH-transition task creation (via a fake
 * TasksService recording automation calls) and per-batch failure continuation
 * with a non-PII summary.
 */
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { CustomerAnalyticsProcessor } from '../customer-analytics-processor.service'
import { PrismaService } from '../../prisma/prisma.service'
import { TasksService } from '../../tasks/tasks.service'

const TENANT = 'tenant-1'
const FIXED_NOW = new Date('2026-08-15T02:00:00.000Z') // 02:00 UTC — cron hour

type MockPrisma = {
  tenant: { findMany: jest.Mock }
  contact: { findMany: jest.Mock }
  activity: { groupBy: jest.Mock }
  deal: { groupBy: jest.Mock }
  user: { findFirst: jest.Mock }
  customerAnalyticsSnapshot: {
    findFirst: jest.Mock
    upsert: jest.Mock
    update: jest.Mock
  }
  $transaction: jest.Mock
  /** The tx.contact.update mock passed into every $transaction callback. */
  txContactUpdate: jest.Mock
}

function buildPrismaMock(): MockPrisma {
  const snapshotDelegate = {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  }
  const txContactUpdate = jest.fn().mockResolvedValue({ id: 'contact-1' })
  return {
    tenant: { findMany: jest.fn() },
    contact: { findMany: jest.fn() },
    activity: { groupBy: jest.fn() },
    deal: { groupBy: jest.fn() },
    user: { findFirst: jest.fn() },
    customerAnalyticsSnapshot: snapshotDelegate,
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        contact: { update: txContactUpdate },
        customerAnalyticsSnapshot: snapshotDelegate,
      }),
    ),
    txContactUpdate,
  }
}

function contactRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contact-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@test.local',
    ownerId: 'user-owner',
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    ...overrides,
  }
}

function makeProcessor(
  prisma: MockPrisma,
  overrides: { batchSize?: number; concurrency?: number; retryAttempts?: number } = {},
): {
  processor: CustomerAnalyticsProcessor
  tasks: { createAutomatedTask: jest.Mock }
  logger: { error: jest.Mock; warn: jest.Mock; log: jest.Mock }
} {
  const tasks = { createAutomatedTask: jest.fn() }
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
  const processor = new CustomerAnalyticsProcessor(
    prisma as unknown as PrismaService,
    tasks as unknown as TasksService,
    () => FIXED_NOW,
    overrides.batchSize ?? 500,
    overrides.concurrency ?? 4,
    overrides.retryAttempts ?? 3,
  )
  ;(processor as unknown as { logger: typeof logger }).logger = logger
  return { processor, tasks, logger }
}

/** Default happy-path DB state: one tenant, one LOW-risk contact. */
function seedSingleContact(prisma: MockPrisma): void {
  prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
  prisma.tenant.findMany.mockResolvedValueOnce([])
  prisma.contact.findMany.mockResolvedValueOnce([contactRow()])
  prisma.contact.findMany.mockResolvedValueOnce([])
  // Default: LOW-risk contact (activity today + 10 qualifying activities →
  // engagement 100, inactivity 0; neutral win rate 50 → score 15 → LOW) so
  // the happy path never enters the task-transition branch.
  prisma.activity.groupBy.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where.type !== undefined) {
      return Promise.resolve([{ contactId: 'contact-1', _count: { _all: 10 } }])
    }
    return Promise.resolve([{ contactId: 'contact-1', _max: { createdAt: FIXED_NOW } }])
  })
  prisma.deal.groupBy.mockResolvedValue([])
  prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
  prisma.customerAnalyticsSnapshot.upsert.mockImplementation(
    ({ create }: { create: Record<string, unknown> }) => ({ id: 'snap-1', ...create }),
  )
}

/** Force the fixture contact into HIGH churn risk (no activity, no wins). */
function makeContactHighRisk(prisma: MockPrisma): void {
  prisma.activity.groupBy.mockResolvedValue([])
  prisma.deal.groupBy.mockResolvedValue([])
}

describe('CustomerAnalyticsProcessor', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
  })

  it('registers the daily 02:00 UTC cron (6-field) (C16)', () => {
    const meta = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      CustomerAnalyticsProcessor.prototype.runDailyProcessing,
    )
    expect(meta.cronTime).toBe('0 0 2 * * *')
  })

  it('materializes current Contact fields + one snapshot per contact/day (C19)', async () => {
    seedSingleContact(prisma)
    const { processor, tasks } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(result).toEqual({
      tenants: 1,
      contactsSucceeded: 1,
      contactsFailed: 0,
      tasksCreated: 0,
      taskFailures: 0,
    })
    // Snapshot is upserted on the unique (tenant, contact, snapshotDate) with
    // the UTC midnight snapshot date of the injected clock.
    expect(prisma.customerAnalyticsSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_contactId_snapshotDate: {
            tenantId: TENANT,
            contactId: 'contact-1',
            snapshotDate: new Date('2026-08-15T00:00:00.000Z'),
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          contactId: 'contact-1',
          snapshotDate: new Date('2026-08-15T00:00:00.000Z'),
          acquisitionCohort: '2026-01',
          lifetimeValue: 0,
          churnRiskScore: expect.any(Number),
          churnRisk: expect.stringMatching(/^LOW|MEDIUM|HIGH$/),
          wonDealCount: 0,
          lostDealCount: 0,
          qualifyingActivityCount: 10,
        }),
      }),
    )
    // Current Contact fields are updated inside the same short transaction.
    const tx = prisma.$transaction.mock.calls[0][0]
    expect(typeof tx).toBe('function')
    expect(tasks.createAutomatedTask).not.toHaveBeenCalled()
  })

  it('runs the tenant-wide job without any user visibility filter (S3)', async () => {
    seedSingleContact(prisma)
    const { processor } = makeProcessor(prisma)

    await processor.runDailyProcessing()

    const contactWhere = prisma.contact.findMany.mock.calls[0][0].where
    expect(contactWhere).toEqual({ tenantId: TENANT, deletedAt: null })
  })

  it('reads contact batches with a stable (createdAt, id) order and bounded take (C17, B1)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockResolvedValueOnce([
      contactRow({ id: 'c1' }),
      contactRow({ id: 'c2' }),
    ])
    prisma.contact.findMany.mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([])
    prisma.deal.groupBy.mockResolvedValue([])
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
    prisma.customerAnalyticsSnapshot.upsert.mockResolvedValue({ id: 's' })

    const { processor } = makeProcessor(prisma, { batchSize: 2 })
    await processor.runDailyProcessing()

    expect(prisma.contact.findMany.mock.calls[0][0].take).toBe(2)
    expect(prisma.contact.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ])
  })

  it('uses exactly 4 fixed aggregate queries per batch — never per contact (C18, B2, S9)', async () => {
    const contacts = Array.from({ length: 200 }, (_, i) =>
      contactRow({ id: `c${i}`, email: `c${i}@test.local` }),
    )
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockResolvedValueOnce(contacts)
    prisma.contact.findMany.mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([])
    prisma.deal.groupBy.mockResolvedValue([])
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
    prisma.customerAnalyticsSnapshot.upsert.mockResolvedValue({ id: 's' })

    const { processor } = makeProcessor(prisma, { batchSize: 500 })
    await processor.runDailyProcessing()

    // 2 activity groupBys + 2 deal groupBys for the batch — not 200×n.
    expect(prisma.activity.groupBy).toHaveBeenCalledTimes(2)
    expect(prisma.deal.groupBy).toHaveBeenCalledTimes(2)
    const batchIds = contacts.map((c) => c.id)
    for (const call of [...prisma.activity.groupBy.mock.calls, ...prisma.deal.groupBy.mock.calls]) {
      const where = call[0].where
      expect(where.tenantId).toBe(TENANT)
      expect(where.contactId).toEqual({ in: batchIds })
    }
    // Contact list query is bounded, never an unbounded findMany.
    expect(prisma.contact.findMany.mock.calls[0][0].take).toBe(500)
  })

  it('aggregates won deals per (contact, currency) and derives LTV + currency mix (B14, F25)', async () => {
    seedSingleContact(prisma)
    prisma.deal.groupBy.mockImplementation(({ by }: { by: string[] }) => {
      if (by.includes('currency')) {
        return Promise.resolve([
          { contactId: 'contact-1', currency: 'USD', _sum: { value: 350.5 }, _count: { _all: 3 } },
          {
            contactId: 'contact-1',
            currency: 'VND',
            _sum: { value: 1_000_000 },
            _count: { _all: 1 },
          },
        ])
      }
      return Promise.resolve([])
    })
    const { processor } = makeProcessor(prisma)

    await processor.runDailyProcessing()

    const create = prisma.customerAnalyticsSnapshot.upsert.mock.calls[0][0].create
    expect(create.lifetimeValue).toBe(1_000_350.5)
    expect(create.wonDealCount).toBe(4)
  })

  it('combines latest activity + qualifying 90-day engagement into the score (C18)', async () => {
    seedSingleContact(prisma)
    prisma.activity.groupBy.mockImplementation(
      (args: { _max?: unknown; where: Record<string, unknown> }) => {
        if (args._max) {
          return Promise.resolve([
            { contactId: 'contact-1', _max: { createdAt: new Date('2026-08-01T00:00:00.000Z') } },
          ])
        }
        if (args.where.type !== undefined) {
          return Promise.resolve([{ contactId: 'contact-1', _count: { _all: 3 } }])
        }
        return Promise.resolve([])
      },
    )
    const { processor } = makeProcessor(prisma)

    await processor.runDailyProcessing()

    const create = prisma.customerAnalyticsSnapshot.upsert.mock.calls[0][0].create
    // engagement 3×10 = 30; last activity 2026-08-01 vs snapshot 2026-08-15 → 14 days
    expect(create.qualifyingActivityCount).toBe(3)
    expect(create.engagementScore).toBe(30)
    expect(create.lastActivityDate?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('handles a HIGH transition: creates exactly one task and links it (C21)', async () => {
    // Contact with no activity and no won deals → win rate neutral 50,
    // engagement 0 → risk = 0.4*100 + 0.3*50 + 0.3*100 = 85 → HIGH.
    seedSingleContact(prisma)
    makeContactHighRisk(prisma) // no activity, no won deals → score 85 → HIGH
    prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' }) // active owner
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null) // no previous
    const task = { id: 'task-1' }
    const { processor, tasks, logger } = makeProcessor(prisma)
    tasks.createAutomatedTask.mockResolvedValue(task)

    const result = await processor.runDailyProcessing()

    expect(tasks.createAutomatedTask).toHaveBeenCalledTimes(1)
    const input = tasks.createAutomatedTask.mock.calls[0][1]
    expect(input).toMatchObject({
      title: 'Follow up with Ada Lovelace — high churn risk',
      priority: 'HIGH',
      assignedTo: 'user-owner',
      contactId: 'contact-1',
      automationSource: 'CHURN_RISK',
      automationKey: 'CHURN_RISK:contact-1:2026-08-15',
    })
    expect(input.dueDate.toISOString()).toBe('2026-08-16T00:00:00.000Z') // snapshot + 1 UTC day
    // task id is persisted onto the snapshot
    expect(prisma.customerAnalyticsSnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ churnPreventionTaskId: 'task-1' }),
      }),
    )
    expect(result.tasksCreated).toBe(1)
    expect(logger.error).not.toHaveBeenCalled()
  })

  describe('task description (C21)', () => {
    it('states score, ISO last activity and /contacts/<id> intent when the contact has activity', async () => {
      seedSingleContact(prisma)
      // One far-past activity → lastActivity is a real date, but inactivity
      // still clamps to 100 → score 85 → HIGH.
      prisma.activity.groupBy.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where.type !== undefined) {
            return Promise.resolve([]) // no qualifying engagement activities
          }
          return Promise.resolve([
            {
              contactId: 'contact-1',
              _max: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
            },
          ])
        },
      )
      prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
      prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
      const { processor, tasks } = makeProcessor(prisma)
      tasks.createAutomatedTask.mockResolvedValue({ id: 'task-1' })

      await processor.runDailyProcessing()

      expect(tasks.createAutomatedTask).toHaveBeenCalledTimes(1)
      const description = tasks.createAutomatedTask.mock.calls[0][1].description as string
      expect(description).toContain('85.0') // score formatted to one decimal
      expect(description).toContain('2026-01-01T00:00:00.000Z') // last activity ISO UTC
      expect(description).toContain('/contacts/contact-1') // follow-up intent, no secrets
    })

    it("uses 'No activity recorded' when the contact has no activity (C21)", async () => {
      seedSingleContact(prisma)
      makeContactHighRisk(prisma) // no activity at all → lastActivity null
      prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
      prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
      const { processor, tasks } = makeProcessor(prisma)
      tasks.createAutomatedTask.mockResolvedValue({ id: 'task-1' })

      await processor.runDailyProcessing()

      expect(tasks.createAutomatedTask).toHaveBeenCalledTimes(1)
      const description = tasks.createAutomatedTask.mock.calls[0][1].description as string
      expect(description).toContain('85.0')
      expect(description).toContain('No activity recorded')
      expect(description).toContain('/contacts/contact-1')
    })
  })

  it('does not create a task when the previous snapshot was already HIGH (C23)', async () => {
    seedSingleContact(prisma)
    makeContactHighRisk(prisma)
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue({ churnRisk: 'HIGH' })
    const { processor, tasks } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(tasks.createAutomatedTask).not.toHaveBeenCalled()
    expect(result.tasksCreated).toBe(0)
  })

  it('creates a NEW task after HIGH→MEDIUM→HIGH (C23)', async () => {
    seedSingleContact(prisma)
    makeContactHighRisk(prisma)
    prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue({ churnRisk: 'MEDIUM' })
    const { processor, tasks } = makeProcessor(prisma)
    tasks.createAutomatedTask.mockResolvedValue({ id: 'task-2' })

    const result = await processor.runDailyProcessing()

    expect(tasks.createAutomatedTask).toHaveBeenCalledTimes(1)
    expect(result.tasksCreated).toBe(1)
  })

  it('is idempotent on same-day rerun — task already linked on the snapshot (B4)', async () => {
    seedSingleContact(prisma)
    makeContactHighRisk(prisma)
    prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
    prisma.customerAnalyticsSnapshot.findFirst
      .mockResolvedValueOnce({ churnRisk: 'LOW' }) // previous snapshot read
      .mockResolvedValueOnce({ churnPreventionTaskId: 'task-1' }) // linked read
    const { processor, tasks } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(tasks.createAutomatedTask).not.toHaveBeenCalled()
    expect(result.tasksCreated).toBe(0)
  })

  it('saves the snapshot but logs a safe task failure when the owner is inactive (C23)', async () => {
    seedSingleContact(prisma)
    makeContactHighRisk(prisma)
    prisma.user.findFirst.mockResolvedValue(null) // owner gone/inactive
    const { processor, tasks, logger } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(prisma.customerAnalyticsSnapshot.upsert).toHaveBeenCalled()
    expect(tasks.createAutomatedTask).not.toHaveBeenCalled()
    expect(result.taskFailures).toBe(1)
    expect(logger.warn).toHaveBeenCalled()
    // No PII in the log payload — only tenant/contact ids and counts (S8).
    const logArgs = JSON.stringify(logger.warn.mock.calls)
    expect(logArgs).not.toContain('ada@test.local')
  })

  it('retries P2034 transaction conflicts a bounded number of times (B6)', async () => {
    seedSingleContact(prisma)
    const p2034 = new PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034',
      clientVersion: 'x',
    })
    prisma.$transaction
      .mockRejectedValueOnce(p2034)
      .mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
        cb({
          contact: { update: jest.fn().mockResolvedValue({ id: 'contact-1' }) },
          customerAnalyticsSnapshot: prisma.customerAnalyticsSnapshot,
        }),
      )
    const { processor, logger } = makeProcessor(prisma, { retryAttempts: 3 })

    const result = await processor.runDailyProcessing()

    expect(result.contactsSucceeded).toBe(1)
    expect(result.contactsFailed).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2) // 1 failure + 1 success
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('continues with other batches after a failing batch and reports failures (C20, B7)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    const good = contactRow({ id: 'good', email: 'good@test.local' })
    const bad = contactRow({ id: 'bad', email: 'bad@test.local' })
    prisma.contact.findMany.mockResolvedValueOnce([good, bad])
    prisma.contact.findMany.mockResolvedValueOnce([])
    prisma.activity.groupBy.mockResolvedValue([])
    prisma.deal.groupBy.mockResolvedValue([])
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
    prisma.customerAnalyticsSnapshot.upsert
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        id: 's',
      })

    const { processor, logger } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(result.contactsSucceeded).toBe(1)
    expect(result.contactsFailed).toBe(1)
    // Failure is logged with tenant/batch identifiers (no raw rows/PII).
    expect(logger.error).toHaveBeenCalled()
    const logged = JSON.stringify(logger.error.mock.calls)
    expect(logged).toContain(TENANT)
    expect(logged).not.toContain('good@test.local')
    expect(logged).not.toContain('bad@test.local')
  })

  it('iterates all tenants and never mixes tenant data (C17)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: 'tenant-a' }, { id: 'tenant-b' }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockResolvedValue([])
    prisma.activity.groupBy.mockResolvedValue([])
    prisma.deal.groupBy.mockResolvedValue([])
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)

    const { processor } = makeProcessor(prisma)
    const result = await processor.runDailyProcessing()

    expect(result.tenants).toBe(2)
    const tenantIds = prisma.contact.findMany.mock.calls.map((c) => c[0].where.tenantId)
    expect(tenantIds).toEqual(['tenant-a', 'tenant-b'])
  })

  it('logs a tenant failure and continues when a tenant batch load throws (C20)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockRejectedValue('db exploded') // non-Error rejection
    const { processor, logger } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(result.tenants).toBe(1)
    expect(result.contactsSucceeded).toBe(0)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(TENANT))
    // No PII in the tenant-failure log.
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('@test.local')
  })

  it('counts a failed aggregate batch in contactsFailed and continues to later batches (C20, R2-F2)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockResolvedValueOnce([
      contactRow({ id: 'c1' }),
      contactRow({ id: 'c2' }),
    ])
    prisma.contact.findMany.mockResolvedValueOnce([
      contactRow({ id: 'c3' }),
      contactRow({ id: 'c4' }),
    ])
    prisma.contact.findMany.mockResolvedValueOnce([])
    // Batch 1's aggregate load fails; batches 2+ succeed. Batch 2 contacts
    // are kept LOW risk (activity today + 10 qualifying) so no task path runs.
    prisma.activity.groupBy
      .mockRejectedValueOnce(new Error('aggregate load exploded'))
      .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.type !== undefined) {
          return Promise.resolve([
            { contactId: 'c3', _count: { _all: 10 } },
            { contactId: 'c4', _count: { _all: 10 } },
          ])
        }
        return Promise.resolve([
          { contactId: 'c3', _max: { createdAt: FIXED_NOW } },
          { contactId: 'c4', _max: { createdAt: FIXED_NOW } },
        ])
      })
    prisma.deal.groupBy.mockResolvedValue([])
    prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null)
    prisma.customerAnalyticsSnapshot.upsert.mockResolvedValue({ id: 's' })

    const { processor, logger } = makeProcessor(prisma, { batchSize: 2 })
    const result = await processor.runDailyProcessing()

    // The failed batch's 2 contacts are accounted for and the later batch
    // still ran — never a silent "clean run" summary.
    expect(result).toEqual({
      tenants: 1,
      contactsSucceeded: 2,
      contactsFailed: 2,
      tasksCreated: 0,
      taskFailures: 0,
    })
    // Only the surviving batch's contacts are processed per-contact.
    expect(prisma.customerAnalyticsSnapshot.upsert).toHaveBeenCalledTimes(2)
    // Batch failure log: tenant id + deterministic batch metadata
    // (offset/count), never contact ids/names/PII.
    const errorLogs = logger.error.mock.calls.map((c) => String(c[0]))
    const batchLog = errorLogs.find((m) => m.includes('offset=0'))
    expect(batchLog).toBeTruthy()
    expect(batchLog).toContain(TENANT)
    expect(batchLog).toContain('count=2')
    const logged = JSON.stringify(errorLogs)
    expect(logged).not.toContain('@test.local')
    expect(logged).not.toContain('c1')
  })

  it('reports the failed count when every aggregate batch fails — no false success (C20, R2-F2)', async () => {
    prisma.tenant.findMany.mockResolvedValueOnce([{ id: TENANT }])
    prisma.tenant.findMany.mockResolvedValueOnce([])
    prisma.contact.findMany.mockResolvedValueOnce([
      contactRow({ id: 'c1' }),
      contactRow({ id: 'c2' }),
    ])
    prisma.contact.findMany.mockResolvedValueOnce([
      contactRow({ id: 'c3' }),
      contactRow({ id: 'c4' }),
    ])
    prisma.contact.findMany.mockResolvedValueOnce([])
    prisma.activity.groupBy.mockRejectedValue(new Error('aggregate load exploded'))
    prisma.deal.groupBy.mockRejectedValue(new Error('aggregate load exploded'))

    const { processor } = makeProcessor(prisma, { batchSize: 2 })
    const result = await processor.runDailyProcessing()

    expect(result.contactsSucceeded).toBe(0)
    expect(result.contactsFailed).toBe(4)
    // A failed aggregate batch is never processed per-contact.
    expect(prisma.customerAnalyticsSnapshot.upsert).not.toHaveBeenCalled()
  })

  it('exhausts bounded P2034 retries and reports the contact as failed (B6)', async () => {
    seedSingleContact(prisma)
    const p2034 = new PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034',
      clientVersion: 'x',
    })
    prisma.$transaction.mockRejectedValue(p2034)
    const { processor, logger } = makeProcessor(prisma, { retryAttempts: 3 })

    const result = await processor.runDailyProcessing()

    expect(result.contactsSucceeded).toBe(0)
    expect(result.contactsFailed).toBe(1)
    expect(prisma.$transaction).toHaveBeenCalledTimes(3) // bounded attempts
    expect(logger.error).toHaveBeenCalled()
  })

  it('logs a safe task-creation failure without PII (C20, S8)', async () => {
    seedSingleContact(prisma)
    makeContactHighRisk(prisma)
    prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
    const { processor, tasks, logger } = makeProcessor(prisma)
    tasks.createAutomatedTask.mockRejectedValue(new Error('assignee validation failed'))

    const result = await processor.runDailyProcessing()

    expect(result.taskFailures).toBe(1)
    expect(result.tasksCreated).toBe(0)
    expect(logger.warn).toHaveBeenCalled()
    const logged = JSON.stringify(logger.warn.mock.calls)
    expect(logged).not.toContain('ada@test.local')
    expect(logged).toContain(TENANT)
  })

  it('tolerates aggregate groups with null counts/sums (bounded fallbacks)', async () => {
    seedSingleContact(prisma)
    prisma.activity.groupBy.mockImplementation(() =>
      Promise.resolve([{ contactId: 'contact-1', _count: null, _max: null }]),
    )
    prisma.deal.groupBy.mockImplementation(() =>
      Promise.resolve([{ contactId: 'contact-1', currency: 'USD', _count: null, _sum: null }]),
    )
    const { processor } = makeProcessor(prisma)

    const result = await processor.runDailyProcessing()

    expect(result.contactsSucceeded).toBe(1)
    const create = prisma.customerAnalyticsSnapshot.upsert.mock.calls[0][0].create
    expect(create.wonDealCount).toBe(0)
    expect(create.lifetimeValue).toBe(0)
    expect(create.qualifyingActivityCount).toBe(0)
  })

  describe('tenant-scoped DML — exact where clauses (F3)', () => {
    it('updates the current Contact with { id, tenantId, deletedAt: null }, never id-only', async () => {
      seedSingleContact(prisma)
      const { processor } = makeProcessor(prisma)

      await processor.runDailyProcessing()

      expect(prisma.txContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1', tenantId: TENANT, deletedAt: null },
        }),
      )
    })

    it('reads the snapshot task link via findFirst scoped to { id, tenantId, deletedAt: null }', async () => {
      seedSingleContact(prisma)
      makeContactHighRisk(prisma)
      prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
      prisma.customerAnalyticsSnapshot.findFirst.mockResolvedValue(null) // no previous
      const { processor, tasks } = makeProcessor(prisma)
      tasks.createAutomatedTask.mockResolvedValue({ id: 'task-1' })

      await processor.runDailyProcessing()

      const linkedRead = prisma.customerAnalyticsSnapshot.findFirst.mock.calls.find(
        (c) => (c[0].where as { id?: string }).id === 'snap-1',
      )
      expect(linkedRead).toBeTruthy()
      expect(linkedRead![0].where).toEqual(
        expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      )
      // The linked read must be a findFirst — the old id-only findUnique
      // path is gone (F3).
      expect(
        prisma.customerAnalyticsSnapshot.findFirst.mock.calls.filter(
          (c) => (c[0].where as { id?: string }).id !== undefined,
        ).length,
      ).toBe(1)
    })

    it('links the churn task onto the snapshot with { id, tenantId, deletedAt: null }, never id-only', async () => {
      seedSingleContact(prisma)
      makeContactHighRisk(prisma)
      prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' })
      const { processor, tasks } = makeProcessor(prisma)
      tasks.createAutomatedTask.mockResolvedValue({ id: 'task-1' })

      await processor.runDailyProcessing()

      expect(prisma.customerAnalyticsSnapshot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'snap-1', tenantId: TENANT, deletedAt: null },
        }),
      )
    })
  })
})
